/**
 * Token Blocklist — server-side JWT revocation for emergency session invalidation.
 *
 * Supports two backends:
 *   1. In-memory (default) — suitable for single-instance deployments
 *   2. Redis — required for multi-instance / clustered deployments
 *
 * Backend is selected automatically based on REDIS_URL.
 *
 * Usage:
 *   - blockToken(jti, expiresInMs)  → block a single token
 *   - blockAllForUser(openId)       → block all tokens issued before now
 *   - isBlocked(jti, openId, iat)   → check if a token is revoked
 *
 * The blocklist stores:
 *   1. Individual token JTIs (for single-session logout)
 *   2. Per-user "revoked-before" timestamps (for logout-all-devices / account suspension)
 *
 * Entries auto-expire after the token's max lifetime (refresh = 7 days) to prevent
 * unbounded growth. In Redis, TTL handles this. In-memory, a periodic sweep runs.
 */

import type { Redis } from "ioredis";
import { getLogger } from "./logger";
import { redisConnection } from "../queue/redisClient";
const log = getLogger("tokenBlocklist");

/** Max token lifetime — refresh tokens live 7 days, so blocklist entries expire after 7d */
const MAX_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

// ── Backend interface ───────────────────────────────────────────────────────

interface BlocklistBackend {
  /** Block a specific token by JTI. expiresInMs = time until the token would naturally expire. */
  blockToken(jti: string, expiresInMs: number): Promise<void>;
  /** Block all tokens for a user issued before now. */
  blockAllForUser(openId: string): Promise<void>;
  /** Check if a specific token JTI is blocked. */
  isTokenBlocked(jti: string): Promise<boolean>;
  /** Get the "revoked-before" timestamp for a user. Returns 0 if none set. */
  getUserRevokedBefore(openId: string): Promise<number>;
  /** Check if Redis/backend is healthy */
  isHealthy(): Promise<boolean>;
}

// ── In-memory backend ───────────────────────────────────────────────────────

class InMemoryBlocklist implements BlocklistBackend {
  /** Map of JTI → expiry timestamp */
  private blockedTokens = new Map<string, number>();
  /** Map of openId → "all tokens issued before this timestamp are revoked" */
  private userRevokedBefore = new Map<string, number>();

  constructor() {
    // Sweep expired entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      this.blockedTokens.forEach((expiresAt, jti) => {
        if (expiresAt <= now) this.blockedTokens.delete(jti);
      });
    }, 5 * 60 * 1000).unref();
  }

  async blockToken(jti: string, expiresInMs: number): Promise<void> {
    this.blockedTokens.set(jti, Date.now() + expiresInMs);
  }

  async blockAllForUser(openId: string): Promise<void> {
    this.userRevokedBefore.set(openId, Date.now());
  }

  async isTokenBlocked(jti: string): Promise<boolean> {
    const expiresAt = this.blockedTokens.get(jti);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this.blockedTokens.delete(jti);
      return false;
    }
    return true;
  }

  async getUserRevokedBefore(openId: string): Promise<number> {
    return this.userRevokedBefore.get(openId) || 0;
  }

  async isHealthy(): Promise<boolean> {
    return true; // In-memory is always healthy
  }
}

// ── Redis backend ───────────────────────────────────────────────────────────

class RedisBlocklist implements BlocklistBackend {
  constructor(private client: Redis) {}

  async blockToken(jti: string, expiresInMs: number): Promise<void> {
    const ttlSeconds = Math.ceil(expiresInMs / 1000);
    await this.client.setex(`bl:tok:${jti}`, ttlSeconds, "1");
  }

  async blockAllForUser(openId: string): Promise<void> {
    // Store the timestamp; TTL = max token lifetime so it auto-cleans
    const ttlSeconds = Math.ceil(MAX_TOKEN_LIFETIME_MS / 1000);
    await this.client.setex(`bl:user:${openId}`, ttlSeconds, String(Date.now()));
  }

  async isTokenBlocked(jti: string): Promise<boolean> {
    const result = await this.client.exists(`bl:tok:${jti}`);
    return result === 1;
  }

  async getUserRevokedBefore(openId: string): Promise<number> {
    const val = await this.client.get(`bl:user:${openId}`);
    return val ? parseInt(val, 10) : 0;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _backend: BlocklistBackend | null = null;

function getBackend(): BlocklistBackend {
  if (!_backend) {
    if (!redisConnection) {
      // Test mode: REDIS_URL is absent. Use per-process in-memory storage so
      // tests can exercise real revocation semantics (block → isBlocked=true).
      _backend = new InMemoryBlocklist();
      log.info("Token blocklist using in-memory backend (test mode — no Redis).");
    } else {
      try {
        _backend = new RedisBlocklist(redisConnection);
        log.info("Token blocklist using Redis backend");
      } catch (err) {
        log.warn("Failed to init Redis blocklist, falling back to in-memory", err);
        _backend = new InMemoryBlocklist();
      }
    }
  }
  return _backend;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Block a single token by its JTI (JWT ID).
 * The entry auto-expires after the token's remaining lifetime.
 */
export async function blockToken(jti: string, expiresInMs: number): Promise<void> {
  await getBackend().blockToken(jti, expiresInMs);
  log.info(`Blocked token ${jti.substring(0, 8)}… (expires in ${Math.ceil(expiresInMs / 1000)}s)`);
}

/**
 * Revoke ALL sessions for a user — any token issued before now is invalid.
 * Use for "log out all devices" or emergency account suspension.
 */
export async function revokeAllUserSessions(openId: string): Promise<void> {
  await getBackend().blockAllForUser(openId);
  log.info(`Revoked all sessions for user ${openId}`);
}

/**
 * Check if a token should be rejected.
 *
 * A token is blocked if:
 *   1. Its JTI is in the blocklist (single-token revocation), OR
 *   2. It was issued before the user's "revoked-before" timestamp (bulk revocation)
 *
 * @param jti   - The token's unique ID (from the `jti` claim)
 * @param openId - The user's openId (from the `openId` claim)
 * @param iatMs  - The token's issued-at time in milliseconds
 */
export async function isTokenRevoked(
  jti: string | undefined,
  openId: string,
  iatMs: number
): Promise<boolean> {
  const backend = getBackend();

  // Check per-user bulk revocation first (cheaper — single key lookup)
  const revokedBefore = await backend.getUserRevokedBefore(openId);
  if (revokedBefore > 0 && iatMs < revokedBefore) {
    return true;
  }

  // Check individual token blocklist
  if (jti) {
    return backend.isTokenBlocked(jti);
  }

  return false;
}

/**
 * Check if the blocklist backend (Redis) is healthy.
 */
export async function isBlocklistHealthy(): Promise<boolean> {
  return getBackend().isHealthy();
}

/**
 * Tier-A wrapper around isTokenRevoked.
 *
 * Session validation, billing, and admin paths must fail-closed when the
 * blocklist backend is unreachable: a Redis outage cannot be allowed to
 * silently disable revocation across the fleet. On error, this returns
 * `true` (treat as revoked) and emits a structured log line for alerting.
 *
 * `checker` is injectable so callers / tests can substitute the backend.
 */
export async function isTokenRevokedFailClosed(
  jti: string | undefined,
  openId: string,
  iatMs: number,
  deps: {
    checker?: typeof isTokenRevoked;
    log?: { error: (msg: string) => void };
  } = {}
): Promise<boolean> {
  const checker = deps.checker ?? isTokenRevoked;
  const errorLog = deps.log?.error ?? ((m: string) => log.error(m));
  try {
    return await checker(jti, openId, iatMs);
  } catch (err) {
    errorLog(
      JSON.stringify({
        event: "token_blocklist_fail_closed",
        tier: "A",
        openId,
        err: err instanceof Error ? err.message : String(err),
      })
    );
    return true;
  }
}
