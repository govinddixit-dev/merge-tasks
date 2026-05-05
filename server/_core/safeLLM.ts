/**
 * safeLLM.ts — Privacy-Safe LLM Invocation Wrapper
 *
 * Orchestrates the full 5-layer AI privacy stack before calling the LLM:
 *
 *   1. sanitizeMessages()  — Layer 1 (regex) + Layer 2 (Presidio NLP)
 *   2. logOutboundPrompt() — Layer 5 (pre-flight audit log, fire-and-forget)
 *   3. invokeLLM()         — Layer 4 (ZDR header applied inside llm.ts)
 *
 * Layer 3 (contextSanitizer) runs earlier in the pipeline — inside copilot.ts
 * when DB context is first loaded, before prompt assembly.
 *
 * Usage: Replace direct `invokeLLM()` calls with `safeLLM()` in copilot.ts
 * and any other file that sends user-influenced content to the LLM.
 */

import { createHash } from "crypto";
import { gzipSync } from "zlib";
import { invokeLLM, type InvokeParams, type InvokeResult } from "./llm";
import { sanitizeMessages } from "./aiGatekeeper";
import { getLogger } from "../utils/logger";
import { getPool } from "../db";

const log = getLogger("safeLLM");

/* ------------------------------------------------------------------ */
/*  Layer 5: Pre-flight audit logging                                  */
/* ------------------------------------------------------------------ */

interface AuditEntry {
  organizationId?: number | null;
  userId?: number | null;
  messageCount: number;
  toolCount: number;
  model: string;
  promptHash: string;
  promptSizeBytes: number;
  /** Gzip-compressed payload (stored as binary in MEDIUMTEXT via base64) */
  sanitizedPayload: string;
  compressed: boolean;
  timestamp: string;
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Log the sanitized prompt to the aiAuditLog table.
 * Fire-and-forget — never blocks the LLM call.
 */
async function logOutboundPrompt(entry: AuditEntry): Promise<void> {
  try {
    const pool = getPool();
    if (!pool) return;

    await pool.execute(
      `INSERT INTO aiAuditLog
         (organizationId, userId, messageCount, toolCount, model,
          promptHash, promptSizeBytes, sanitizedPayload, compressed, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.organizationId ?? null,
        entry.userId ?? null,
        entry.messageCount,
        entry.toolCount,
        entry.model,
        entry.promptHash,
        entry.promptSizeBytes,
        entry.sanitizedPayload,
        entry.compressed ? 1 : 0,
        new Date(entry.timestamp),
      ]
    );
  } catch (err) {
    // Never let audit logging block the LLM call
    log.warn("Failed to persist AI audit log entry", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface SafeLLMContext {
  /** Organization ID for audit trail (optional) */
  organizationId?: number | null;
  /** User ID for audit trail (optional) */
  userId?: number | null;
}

/**
 * Privacy-safe LLM invocation.
 *
 * 1. Sanitizes all messages through Layers 1 + 2
 * 2. Logs the sanitized prompt (Layer 5, fire-and-forget)
 * 3. Calls invokeLLM with Layer 4 ZDR header
 *
 * Drop-in replacement for invokeLLM() — same params, same return type.
 */
export async function safeLLM(
  params: InvokeParams,
  ctx?: SafeLLMContext
): Promise<InvokeResult> {
  // Step 1: Sanitize messages (Layers 1 + 2)
  const sanitizedMsgs = await sanitizeMessages(params.messages);
  const sanitizedParams: InvokeParams = { ...params, messages: sanitizedMsgs };

  // Step 2: Pre-flight audit log (Layer 5) — fire-and-forget
  const payloadJson = JSON.stringify({
    messages: sanitizedMsgs,
    tools: params.tools,
    model: params.model,
  });

  // Compress payload for storage (~80% reduction on typical prompts)
  let storedPayload: string;
  let compressed = false;
  try {
    const gzipped = gzipSync(Buffer.from(payloadJson, "utf8"));
    storedPayload = gzipped.toString("base64");
    compressed = true;
  } catch {
    // Fallback to raw JSON if compression fails
    storedPayload = payloadJson;
  }

  const auditEntry: AuditEntry = {
    organizationId: ctx?.organizationId,
    userId: ctx?.userId,
    messageCount: sanitizedMsgs.length,
    toolCount: params.tools?.length ?? 0,
    model: params.model || "default",
    promptHash: sha256(payloadJson),
    promptSizeBytes: Buffer.byteLength(payloadJson, "utf8"),
    sanitizedPayload: storedPayload,
    compressed,
    timestamp: new Date().toISOString(),
  };

  logOutboundPrompt(auditEntry).catch(() => {
    // Swallowed — logOutboundPrompt already logs its own warning
  });

  // Step 3: Call the LLM (Layer 4 ZDR header applied inside llm.ts)
  return invokeLLM(sanitizedParams);
}
