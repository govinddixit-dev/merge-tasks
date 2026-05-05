/**
 * aiGatekeeper.ts — Layers 1 + 2: PII Sanitization Pipeline
 *
 * Layer 1: Regex-based masking of structured PII (~95% coverage)
 *   - Emails:  j***@acme.com  (first char + domain preserved for context)
 *   - Phones:  [PHONE-1234]   (last 4 digits preserved for identity context)
 *   - SSNs:    [SSN]          (fully redacted; negative lookbehind prevents
 *                              false positives on order/ZIP+4 numbers)
 *   - Credit cards, API tokens, addresses, IPs fully redacted
 *
 * Layer 2: Presidio NLP-based detection of unstructured PII (~98% coverage)
 *   - Names in prose, spelled-out numbers, context-dependent PII
 *   - Fails open — if Presidio is down, Layer 1 regex still applies
 *   - **Batched**: all text parts in a conversation are joined with a unique
 *     separator and sent as a single HTTP call, then split back. This reduces
 *     a 20-message conversation from 20 round-trips to 1.
 *
 * All sanitization is async to support the Presidio HTTP calls.
 */

import { randomUUID } from "crypto";
import { sanitizeWithPresidio } from "../utils/presidioClient";
import type { Message, MessageContent } from "./llm";

/* ------------------------------------------------------------------ */
/*  Layer 1: Regex patterns for structured PII                         */
/* ------------------------------------------------------------------ */

/**
 * Mask an email address to: firstChar***@domain.tld
 * e.g. john.doe@acme.com → j***@acme.com
 *
 * Preserves the domain for context ("the contact at Acme") while
 * preventing the AI from learning or leaking the full address.
 */
function maskEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return "[EMAIL]";
  const firstChar = email[0];
  const domain = email.slice(atIdx); // includes @
  return `${firstChar}***${domain}`;
}

/**
 * Mask a phone number to: [PHONE-XXXX] where XXXX = last 4 digits.
 * e.g. (555) 867-5309 → [PHONE-5309]
 *
 * Preserves the last 4 digits for identity verification context
 * (e.g. "the client whose number ends in 5309").
 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return last4.length === 4 ? `[PHONE-${last4}]` : "[PHONE]";
}

interface RegexRule {
  pattern: RegExp;
  /** String replacement or a function for dynamic masking. */
  replacement: string | ((match: string) => string);
}

const REGEX_RULES: RegexRule[] = [
  // ── Email addresses — partial mask: j***@acme.com ─────────────────
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: maskEmail,
  },

  // ── US phone numbers (various formats) — last-4 preserved ─────────
  // Matches: (555) 867-5309 | 555.867.5309 | +1 555 867 5309 | ext. 42
  {
    pattern:
      /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:ext|x|ext\.)\s*\d{1,5})?/g,
    replacement: maskPhone,
  },

  // ── Social Security Numbers — fully redacted ───────────────────────
  // Pattern: 3-2-4 digit groups with optional separator (-, ., space)
  //
  // False-positive mitigations:
  //   1. Negative lookbehind for '#' prevents matching order numbers
  //      like "Order #123-45-6789"
  //   2. Negative lookbehind for 'ZIP ' / 'ZIP: ' prevents ZIP+4 codes
  //   3. Negative lookbehind for a digit prevents matching the middle of
  //      a longer number (e.g. a 10-digit phone already handled above)
  //   4. Negative lookahead for a digit prevents matching the start of
  //      a longer number
  //
  // Note: JS lookbehind requires a fixed-width pattern, so we use
  // alternation inside the lookbehind group.
  {
    pattern:
      /(?<!(?:#|Order\s|ZIP\s|ZIP:\s|\d))\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}(?!\d)\b/g,
    replacement: "[SSN]",
  },

  // ── Credit card numbers (13–19 digits with optional separators) ────
  {
    pattern: /\b(?:\d[-.\s]?){13,19}\b/g,
    replacement: "[CREDIT_CARD]",
  },

  // ── API keys / tokens (long hex or base64 strings) ─────────────────
  {
    pattern:
      /\b(?:sk|pk|api|token|key|secret|bearer)[-_]?[a-zA-Z0-9]{20,}\b/gi,
    replacement: "[API_TOKEN]",
  },

  // ── US street addresses (number + street name + type) ──────────────
  {
    pattern:
      /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Court|Ct|Place|Pl|Way|Circle|Cir|Trail|Trl)\b\.?/gi,
    replacement: "[ADDRESS]",
  },

  // ── IP addresses (IPv4) ────────────────────────────────────────────
  {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP_ADDRESS]",
  },
];

/**
 * Layer 1: Apply regex-based PII masking to a string.
 * Synchronous — always runs, never fails.
 */
function regexSanitize(text: string): string {
  let result = text;
  for (const rule of REGEX_RULES) {
    if (typeof rule.replacement === "function") {
      // Dynamic replacement — e.g. maskEmail, maskPhone
      result = result.replace(rule.pattern, rule.replacement);
    } else {
      // Static string replacement — e.g. "[SSN]", "[CREDIT_CARD]"
      result = result.replace(rule.pattern, rule.replacement);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Combined sanitization (Layer 1 → Layer 2)                          */
/* ------------------------------------------------------------------ */

/**
 * Sanitize a single string through both layers:
 * 1. Regex masking (synchronous, always runs)
 * 2. Presidio NLP (async, fails open)
 */
export async function sanitizeContent(text: string): Promise<string> {
  // Layer 1: regex — catches structured patterns
  let sanitized = regexSanitize(text);

  // Layer 2: Presidio NLP — catches unstructured PII
  sanitized = await sanitizeWithPresidio(sanitized);

  return sanitized;
}

/* ------------------------------------------------------------------ */
/*  Batched Presidio call for message arrays (Issue 5)                 */
/* ------------------------------------------------------------------ */

/**
 * A text segment extracted from a message, with enough metadata to
 * map the Presidio result back to the original message structure.
 */
interface TextSegment {
  msgIdx: number;
  contentIdx: number | null; // null for string content, index for array content
  text: string;
}

/**
 * Extract all sanitizable text segments from a message array.
 * Each segment records its position so we can reassemble after batching.
 */
function extractTextSegments(messages: Message[]): TextSegment[] {
  const segments: TextSegment[] = [];

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];

    if (typeof msg.content === "string") {
      segments.push({ msgIdx: mi, contentIdx: null, text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (let ci = 0; ci < msg.content.length; ci++) {
        const part = msg.content[ci];
        if (typeof part === "string") {
          segments.push({ msgIdx: mi, contentIdx: ci, text: part });
        } else if (part.type === "text") {
          segments.push({ msgIdx: mi, contentIdx: ci, text: part.text });
        }
        // image_url, file_url — skip (no text to sanitize)
      }
    }
  }

  return segments;
}

/**
 * Batch-sanitize all text segments through Presidio in a single HTTP call.
 *
 * Strategy:
 *   1. Apply Layer 1 (regex) to each segment individually
 *   2. Join all regex-sanitized texts with a UUID-based separator
 *      (UUID avoids collisions with real message content)
 *   3. Send the joined string to Presidio as one call
 *   4. Split the result back on the separator
 *   5. Map each piece back to its original message position
 *
 * If Presidio fails, the regex-sanitized texts are used (fail-open).
 */
async function batchSanitizeSegments(
  segments: TextSegment[]
): Promise<Map<string, string>> {
  // Key: "msgIdx:contentIdx" → sanitized text
  const resultMap = new Map<string, string>();

  if (segments.length === 0) return resultMap;

  // Step 1: regex-sanitize each segment
  const regexSanitized = segments.map((seg) => ({
    ...seg,
    text: regexSanitize(seg.text),
  }));

  // Step 2: join with UUID separator for single Presidio call
  const separator = `\n<<<${randomUUID()}>>>\n`;
  const joined = regexSanitized.map((s) => s.text).join(separator);

  // Step 3: single Presidio call
  let presidioResult: string;
  try {
    presidioResult = await sanitizeWithPresidio(joined);
  } catch {
    // Fail open — use regex-only results
    for (const seg of regexSanitized) {
      const key = `${seg.msgIdx}:${seg.contentIdx}`;
      resultMap.set(key, seg.text);
    }
    return resultMap;
  }

  // Step 4: split back
  const parts = presidioResult.split(separator);

  // Step 5: map back (if split count doesn't match, fall back to regex-only)
  if (parts.length === regexSanitized.length) {
    for (let i = 0; i < parts.length; i++) {
      const seg = regexSanitized[i];
      const key = `${seg.msgIdx}:${seg.contentIdx}`;
      resultMap.set(key, parts[i]);
    }
  } else {
    // Separator appeared in real content — fall back to regex-only
    for (const seg of regexSanitized) {
      const key = `${seg.msgIdx}:${seg.contentIdx}`;
      resultMap.set(key, seg.text);
    }
  }

  return resultMap;
}

/* ------------------------------------------------------------------ */
/*  Message-level sanitization (public API)                            */
/* ------------------------------------------------------------------ */

/**
 * Sanitize all messages in a conversation.
 * Returns a new array — original messages are not mutated.
 *
 * Uses batched Presidio: all text parts are sent in a single HTTP call
 * instead of one call per message part. A 20-message conversation that
 * previously made 20 round-trips now makes 1.
 */
export async function sanitizeMessages(
  messages: Message[]
): Promise<Message[]> {
  // Extract all text segments
  const segments = extractTextSegments(messages);

  // Batch-sanitize through regex + Presidio (single HTTP call)
  const sanitizedMap = await batchSanitizeSegments(segments);

  // Reassemble messages with sanitized text
  return messages.map((msg, mi) => {
    if (typeof msg.content === "string") {
      const key = `${mi}:null`;
      const sanitized = sanitizedMap.get(key) ?? msg.content;
      return { ...msg, content: sanitized };
    }

    if (Array.isArray(msg.content)) {
      const sanitizedParts = msg.content.map((part, ci) => {
        const key = `${mi}:${ci}`;
        const sanitized = sanitizedMap.get(key);

        if (typeof part === "string") {
          return sanitized ?? part;
        }
        if (part.type === "text" && sanitized) {
          return { ...part, text: sanitized };
        }
        return part;
      });
      return { ...msg, content: sanitizedParts };
    }

    return msg;
  });
}
