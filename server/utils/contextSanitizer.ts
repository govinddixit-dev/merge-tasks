/**
 * contextSanitizer.ts — Layer 3: Free-Text Field Pre-Scanning
 *
 * Scans DB record fields (notes, descriptions, addresses) through
 * Layers 1 + 2 before they are injected into LLM prompts.
 *
 * Key behaviors:
 * - Deep-copies records — original DB data is never mutated
 * - Per-entity field maps — only scans fields likely to contain PII
 * - Session-level caching — sanitize once, reuse for the session
 * - Fails open — if sanitization errors, original data passes through
 */

import { sanitizeContent } from "../_core/aiGatekeeper";
import { getLogger } from "./logger";

const log = getLogger("contextSanitizer");

/* ------------------------------------------------------------------ */
/*  Field maps — which fields to scan per entity type                  */
/* ------------------------------------------------------------------ */

export const SANITIZABLE_FIELDS: Record<string, string[]> = {
  clients: ["notes", "address", "contactEmail", "contactPhone"],
  products: ["description", "notes"],
  proposals: ["notes", "internalNotes"],
  orders: ["notes", "shippingAddress"],
  stores: ["description", "customContent"],
};

/* ------------------------------------------------------------------ */
/*  Core sanitization logic                                            */
/* ------------------------------------------------------------------ */

/**
 * Deep-copy an array of records and sanitize specified string fields
 * through Layers 1 + 2 (regex + Presidio NLP).
 *
 * @param records   Array of DB rows (any shape)
 * @param fieldsToScan  Field names to sanitize (from SANITIZABLE_FIELDS)
 * @returns New array with sanitized copies — originals untouched
 */
export async function sanitizeContextData<T extends Record<string, unknown>>(
  records: T[],
  fieldsToScan: string[]
): Promise<T[]> {
  if (!records || records.length === 0) return records;
  if (!fieldsToScan || fieldsToScan.length === 0) return records;

  return Promise.all(
    records.map(async (record) => {
      // Deep copy to avoid mutating the original
      const copy = { ...record } as Record<string, unknown>;

      for (const field of fieldsToScan) {
        const value = copy[field];
        if (typeof value === "string" && value.trim().length > 0) {
          try {
            copy[field] = await sanitizeContent(value);
          } catch (err) {
            // Fail open — keep original value
            log.warn(`Failed to sanitize field "${field}"`, err);
          }
        }
      }

      return copy as T;
    })
  );
}

/* ------------------------------------------------------------------ */
/*  Session-level caching                                              */
/* ------------------------------------------------------------------ */

interface CopilotSessionCache {
  /** Sanitized context keyed by entity type (e.g. "clients", "products") */
  sanitizedContext: Map<string, unknown[]>;
  /** Timestamp when the cache was built */
  builtAt: number;
}

/** In-memory cache keyed by session/conversation ID */
const sessionCaches = new Map<string, CopilotSessionCache>();

/** Cache TTL — 10 minutes (session-level, not permanent) */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Get or build sanitized context for a copilot session.
 * If cached and fresh, returns immediately. Otherwise sanitizes and caches.
 *
 * @param sessionId  Unique session/conversation identifier
 * @param entityType  Entity type key (e.g. "clients", "products")
 * @param records     Raw DB records to sanitize
 * @returns Sanitized records (from cache or freshly sanitized)
 */
export async function getOrSanitizeContext<T extends Record<string, unknown>>(
  sessionId: string,
  entityType: string,
  records: T[]
): Promise<T[]> {
  const now = Date.now();

  // Check cache
  let cache = sessionCaches.get(sessionId);
  if (cache && now - cache.builtAt < CACHE_TTL_MS) {
    const cached = cache.sanitizedContext.get(entityType);
    if (cached) return cached as T[];
  }

  // Build or refresh cache
  if (!cache || now - cache.builtAt >= CACHE_TTL_MS) {
    cache = { sanitizedContext: new Map(), builtAt: now };
    sessionCaches.set(sessionId, cache);
  }

  const fields = SANITIZABLE_FIELDS[entityType] || [];
  const sanitized = await sanitizeContextData(records, fields);
  cache.sanitizedContext.set(entityType, sanitized);

  return sanitized;
}

/**
 * Invalidate the cache for a specific session (e.g. on context reload).
 */
export function invalidateSessionCache(sessionId: string): void {
  sessionCaches.delete(sessionId);
}

/**
 * Periodic cleanup — remove expired caches to prevent memory leaks.
 * Call this on a timer or at the start of each copilot request.
 */
export function cleanupExpiredCaches(): void {
  const now = Date.now();
  for (const [id, cache] of Array.from(sessionCaches.entries())) {
    if (now - cache.builtAt >= CACHE_TTL_MS) {
      sessionCaches.delete(id);
    }
  }
}
