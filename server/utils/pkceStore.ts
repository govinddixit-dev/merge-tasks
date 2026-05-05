/**
 * PKCE Code Verifier Store
 *
 * Stores OIDC PKCE code_verifier values server-side instead of embedding them
 * in the browser-visible state parameter. Uses Redis when available,
 * falls back to in-memory with TTL-based expiry.
 *
 * Each verifier is keyed by a random nonce that travels in the state parameter.
 * The nonce is opaque and reveals nothing about the verifier.
 */
import { randomBytes } from "crypto";
import { getLogger } from "./logger";
import { redisConnection } from "../queue/redisClient";
const log = getLogger("pkceStore");

interface PkceEntry {
  codeVerifier: string;
  expiresAt: number;
}

/** TTL for stored verifiers — 10 minutes is generous for an OIDC round-trip */
const VERIFIER_TTL_MS = 10 * 60 * 1000;

// ── In-memory store ──────────────────────────────────────────────────────────

const memoryStore = new Map<string, PkceEntry>();

// Prune expired entries every 2 minutes
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  memoryStore.forEach((entry, key) => {
    if (entry.expiresAt < now) keysToDelete.push(key);
  });
  keysToDelete.forEach(k => memoryStore.delete(k));
}, 2 * 60 * 1000).unref();

// ── Public API ───────────────────────────────────────────────────────────────

const REDIS_KEY_PREFIX = "pkce:";

/**
 * Store a code_verifier server-side and return a nonce to embed in the state parameter.
 * The nonce is a random 32-byte hex string — it reveals nothing about the verifier.
 */
export async function storeCodeVerifier(codeVerifier: string): Promise<string> {
  const nonce = randomBytes(32).toString("hex");

  if (redisConnection) {
    try {
      await redisConnection.set(
        `${REDIS_KEY_PREFIX}${nonce}`,
        codeVerifier,
        "PX",
        VERIFIER_TTL_MS,
      );
      return nonce;
    } catch (err) {
      log.warn("Failed to store PKCE verifier in Redis, falling back to memory", err);
    }
  }

  // In-memory fallback (test mode, or Redis error)
  memoryStore.set(nonce, {
    codeVerifier,
    expiresAt: Date.now() + VERIFIER_TTL_MS,
  });
  return nonce;
}

/**
 * Retrieve and delete a code_verifier by its nonce.
 * Returns null if the nonce is not found or has expired.
 * The verifier is consumed (deleted) on retrieval to prevent replay.
 */
export async function consumeCodeVerifier(nonce: string): Promise<string | null> {
  if (redisConnection) {
    try {
      // GETDEL atomically retrieves and deletes — prevents replay
      const value = await redisConnection.getdel(`${REDIS_KEY_PREFIX}${nonce}`);
      if (value) return value;
    } catch (err) {
      log.warn("Failed to retrieve PKCE verifier from Redis, trying memory", err);
    }
  }

  // In-memory fallback (test mode, or Redis miss/error)
  const entry = memoryStore.get(nonce);
  if (!entry) return null;
  memoryStore.delete(nonce); // Consume on read

  if (entry.expiresAt < Date.now()) return null; // Expired
  return entry.codeVerifier;
}
