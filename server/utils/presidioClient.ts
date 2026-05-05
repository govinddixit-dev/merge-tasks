/**
 * presidioClient.ts — Layer 2: NLP-based PII detection via Microsoft Presidio
 *
 * Calls the Presidio analyzer + anonymizer sidecars to detect and mask
 * unstructured PII that regex patterns miss (e.g. names in prose,
 * spelled-out numbers). Fails open — if Presidio is down, text passes
 * through unchanged (Layer 1 regex still applies).
 */

import { getLogger } from "./logger";

const log = getLogger("presidio");

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PresidioEntity {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

interface PresidioConfig {
  analyzerUrl: string;
  anonymizerUrl: string;
  enabled: boolean;
  minScore: number;
  language: string;
  timeout: number;
}

interface AnonymizeOperator {
  type: string;
  masking_char?: string;
  chars_to_mask?: number;
  from_end?: boolean;
  new_value?: string;
}

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

function loadConfig(): PresidioConfig {
  return {
    analyzerUrl: process.env.PRESIDIO_ANALYZER_URL || "http://localhost:5001",
    anonymizerUrl: process.env.PRESIDIO_ANONYMIZER_URL || "http://localhost:5002",
    enabled: process.env.PRESIDIO_ENABLED === "true",
    minScore: 0.7,
    language: "en",
    timeout: 2000, // 2 seconds — fail fast
  };
}

/* ------------------------------------------------------------------ */
/*  Entity types to detect                                             */
/* ------------------------------------------------------------------ */

const DETECT_ENTITIES = [
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "PERSON",
  "CREDIT_CARD",
  "US_SSN",
  "LOCATION",
  "IP_ADDRESS",
  "US_BANK_NUMBER",
  "IBAN_CODE",
  "NRP",
];

/* ------------------------------------------------------------------ */
/*  Per-entity anonymization operators                                 */
/* ------------------------------------------------------------------ */

const ANONYMIZE_OPERATORS: Record<string, AnonymizeOperator> = {
  // Mask partially — AI may need domain context
  EMAIL_ADDRESS: { type: "mask", masking_char: "*", chars_to_mask: 6, from_end: false },
  PHONE_NUMBER: { type: "mask", masking_char: "*", chars_to_mask: 7, from_end: false },

  // Keep — AI needs names to function (client names, contact names)
  PERSON: { type: "keep" },

  // Full redaction — never needed by AI
  CREDIT_CARD: { type: "replace", new_value: "[REDACTED]" },
  US_SSN: { type: "replace", new_value: "[REDACTED]" },
  IP_ADDRESS: { type: "replace", new_value: "[REDACTED]" },
  US_BANK_NUMBER: { type: "replace", new_value: "[REDACTED]" },
  IBAN_CODE: { type: "replace", new_value: "[REDACTED]" },

  // Keep — nationality/religion not PII for our use case
  NRP: { type: "keep" },

  // Keep — city/state is useful context; full addresses caught by Layer 1 regex
  LOCATION: { type: "keep" },
};

/* ------------------------------------------------------------------ */
/*  Health check with 60-second cache                                  */
/* ------------------------------------------------------------------ */

let healthyUntil = 0;
let lastHealthy = false;

async function isHealthy(cfg: PresidioConfig): Promise<boolean> {
  const now = Date.now();
  if (now < healthyUntil) return lastHealthy;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeout);

    const resp = await fetch(`${cfg.analyzerUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    lastHealthy = resp.ok;
  } catch {
    lastHealthy = false;
  }

  healthyUntil = now + 60_000; // cache for 60 seconds
  return lastHealthy;
}

/* ------------------------------------------------------------------ */
/*  Analyze — detect PII entities in text                              */
/* ------------------------------------------------------------------ */

async function analyzeText(
  text: string,
  cfg: PresidioConfig
): Promise<PresidioEntity[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout);

  try {
    const resp = await fetch(`${cfg.analyzerUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: cfg.language,
        entities: DETECT_ENTITIES,
        score_threshold: cfg.minScore,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      log.warn(`Presidio analyzer returned ${resp.status}`);
      return [];
    }

    return (await resp.json()) as PresidioEntity[];
  } catch (err) {
    clearTimeout(timer);
    log.warn("Presidio analyzer call failed", err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Anonymize — mask detected entities                                 */
/* ------------------------------------------------------------------ */

async function anonymizeText(
  text: string,
  entities: PresidioEntity[],
  cfg: PresidioConfig
): Promise<string> {
  if (entities.length === 0) return text;

  // Filter out entities with "keep" operator — no need to send them
  const actionableEntities = entities.filter((e) => {
    const op = ANONYMIZE_OPERATORS[e.entity_type];
    return op && op.type !== "keep";
  });

  if (actionableEntities.length === 0) return text;

  // Build per-entity operator map for the anonymizer
  const operators: Record<string, AnonymizeOperator> = {};
  for (const entity of actionableEntities) {
    if (!operators[entity.entity_type]) {
      operators[entity.entity_type] = ANONYMIZE_OPERATORS[entity.entity_type];
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout);

  try {
    const resp = await fetch(`${cfg.anonymizerUrl}/anonymize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        analyzer_results: actionableEntities,
        operators,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      log.warn(`Presidio anonymizer returned ${resp.status}`);
      return text; // fail open
    }

    const result = (await resp.json()) as { text: string };
    return result.text;
  } catch (err) {
    clearTimeout(timer);
    log.warn("Presidio anonymizer call failed", err);
    return text; // fail open
  }
}

/* ------------------------------------------------------------------ */
/*  Public API — single entry point                                    */
/* ------------------------------------------------------------------ */

/**
 * Sanitize text using Presidio NLP (Layer 2).
 * Checks health first, analyzes for PII, then anonymizes.
 * Fails open — returns original text if Presidio is unavailable.
 */
export async function sanitizeWithPresidio(text: string): Promise<string> {
  const cfg = loadConfig();

  if (!cfg.enabled) return text;
  if (!text || text.trim().length === 0) return text;

  const healthy = await isHealthy(cfg);
  if (!healthy) {
    log.debug("Presidio unhealthy, skipping NLP scan");
    return text;
  }

  const entities = await analyzeText(text, cfg);
  if (entities.length === 0) return text;

  return anonymizeText(text, entities, cfg);
}
