/**
 * Rate Limiter — sliding window rate limiter backed by Redis.
 *
 * Redis is mandatory (Decision 27). REDIS_URL is validated at startup; the
 * shared connection is imported from server/queue/redisClient.ts.
 */

import { getLogger } from "./logger";
import { redisConnection } from "../queue/redisClient";
const log = getLogger("rateLimiter");

// ── Store interface ──────────────────────────────────────────────────────────

interface RateLimitStoreBackend {
  /** Get current request count within the window, then record the new request */
  increment(key: string, windowMs: number): Promise<{ count: number; oldestTs: number }>;
}

// ── In-memory store (test mode — no Redis) ──────────────────────────────────
//
// Sliding-window limiter backed by a Map<key, number[]> of request timestamps.
// Each increment prunes timestamps older than the window, appends `now`, and
// returns count + oldestTs — same contract as RedisStore. Per-process only,
// which is exactly what Vitest runs need.

class MemoryStore implements RateLimitStoreBackend {
  private store = new Map<string, number[]>();

  async increment(key: string, windowMs: number): Promise<{ count: number; oldestTs: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `rl:${key}`;

    const existing = this.store.get(redisKey) ?? [];
    const filtered = existing.filter((ts) => ts > windowStart);
    filtered.push(now);
    this.store.set(redisKey, filtered);

    return { count: filtered.length, oldestTs: filtered[0] ?? now };
  }
}

// ── Redis store ──────────────────────────────────────────────────────────────

class RedisStore implements RateLimitStoreBackend {
  private client: NonNullable<typeof redisConnection>;

  constructor(client: NonNullable<typeof redisConnection>) {
    this.client = client;
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; oldestTs: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `rl:${key}`;

    // Use a Redis sorted set: score = timestamp, member = unique request ID
    const pipeline = this.client.pipeline();
    // Remove entries outside the window
    pipeline.zremrangebyscore(redisKey, 0, windowStart);
    // Add the current request
    pipeline.zadd(redisKey, now, `${now}:${Math.random()}`);
    // Count entries in the window
    pipeline.zcard(redisKey);
    // Get the oldest entry
    pipeline.zrange(redisKey, 0, 0, "WITHSCORES");
    // Set TTL to auto-expire the key
    pipeline.pexpire(redisKey, windowMs);

    const results = await pipeline.exec();
    if (!results) throw new Error("Redis pipeline returned no results");

    const count = results[2][1] as number;
    const oldestEntry = results[3][1] as string[];
    const oldestTs = oldestEntry.length >= 2 ? parseInt(oldestEntry[1]) : now;

    return { count, oldestTs };
  }
}

// ── Store singleton ──────────────────────────────────────────────────────────

let _store: RateLimitStoreBackend | null = null;

function getStore(): RateLimitStoreBackend {
  if (!_store) {
    if (redisConnection) {
      _store = new RedisStore(redisConnection);
      log.info("Rate limiter using Redis store (persists across deploys)");
    } else {
      _store = new MemoryStore();
      log.info("Rate limiter using in-memory store (test mode — no Redis).");
    }
  }
  return _store;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Human-readable message returned on 429 */
  message?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  message?: string;
}

/**
 * Check whether a given key (typically IP + endpoint) is within the rate limit.
 * Returns { allowed: true } if the request should proceed, or { allowed: false } with details.
 */
export async function checkRateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const store = getStore();
  const now = Date.now();

  const { count, oldestTs } = await store.increment(key, opts.windowMs);

  if (count > opts.max) {
    const resetInMs = oldestTs + opts.windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(resetInMs, 0),
      message: opts.message || `Too many requests. Please try again in ${Math.ceil(Math.max(resetInMs, 0) / 1000)} seconds.`,
    };
  }

  return {
    allowed: true,
    remaining: opts.max - count,
    resetInMs: 0,
  };
}

/**
 * Audit fix #16: Harden getClientIp() to prevent IP spoofing via X-Forwarded-For.
 *
 * The original code blindly trusted the FIRST entry in X-Forwarded-For, which an
 * attacker can set to any value (e.g. "1.2.3.4, realIp") to bypass rate limiting.
 *
 * Correct approach:
 *   - If TRUSTED_PROXY_COUNT is set (number of trusted reverse proxies in front of
 *     the app), take the Nth-from-right entry in X-Forwarded-For (where N =
 *     TRUSTED_PROXY_COUNT). This is the leftmost IP that was added by a trusted proxy.
 *   - If TRUSTED_PROXY_COUNT is not set, fall back to req.ip (Express's own IP
 *     resolution, which already handles the trust proxy setting).
 *   - Never use the leftmost (first) entry blindly — it is fully attacker-controlled.
 *
 * Set TRUSTED_PROXY_COUNT=1 in .env when running behind a single reverse proxy
 * (e.g. Nginx, Cloudflare, AWS ALB). Set to 2 for two-layer proxies, etc.
 */
export function getClientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const trustedProxyCount = parseInt(process.env.TRUSTED_PROXY_COUNT || "0", 10);

  if (trustedProxyCount > 0) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
      // X-Forwarded-For: client, proxy1, proxy2, ..., proxyN
      // The last `trustedProxyCount` entries were added by trusted proxies.
      // The entry just before those is the real client IP.
      const raw = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
      const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
      // Index of the real client IP: parts.length - trustedProxyCount - 1
      // (but at minimum index 0 if there are fewer entries than expected)
      const idx = Math.max(0, parts.length - trustedProxyCount - 1);
      const candidate = parts[idx];
      if (candidate && isValidIp(candidate)) {
        return candidate;
      }
    }
  }

  // Fall back to Express's resolved IP (respects app.set('trust proxy', N))
  return req.ip || "unknown";
}

/**
 * Validate that a string looks like a plausible IP address (v4 or v6).
 * This is a lightweight sanity check — not a full RFC-compliant validator.
 */
function isValidIp(ip: string): boolean {
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split(".").every(octet => parseInt(octet, 10) <= 255);
  }
  // IPv6 (simplified — accepts any colon-separated hex groups)
  if (/^[0-9a-fA-F:]+$/.test(ip) && ip.includes(":")) return true;
  return false;
}

//  Pre-configured limiters for each auth endpoint 

/** Sign-in: 5 attempts per 15 minutes per IP */
export const SIGNIN_LIMIT: RateLimitOptions = {
  max: 5,
  windowMs: 15 * 60 * 1000,
  message: "Too many sign-in attempts. Please wait 15 minutes before trying again.",
};

/** Sign-up: 3 new accounts per hour per IP */
export const SIGNUP_LIMIT: RateLimitOptions = {
  max: 3,
  windowMs: 60 * 60 * 1000,
  message: "Too many sign-up attempts from this IP. Please try again later.",
};

/** 2FA verify: 10 attempts per 15 minutes per IP (slightly more lenient — user may mistype) */
export const VERIFY_2FA_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 15 * 60 * 1000,
  message: "Too many verification attempts. Please wait 15 minutes.",
};

/** Resend code: 3 resends per 10 minutes per IP */
export const RESEND_CODE_LIMIT: RateLimitOptions = {
  max: 3,
  windowMs: 10 * 60 * 1000,
  message: "Too many resend requests. Please wait 10 minutes.",
};

/** Password reset: 3 requests per 15 minutes per IP */
export const PASSWORD_RESET_LIMIT: RateLimitOptions = {
  max: 3,
  windowMs: 15 * 60 * 1000,
  message: "Too many password reset requests. Please wait 15 minutes.",
};

/** General API: 200 requests per minute per IP (protects against scraping) */
export const GENERAL_API_LIMIT: RateLimitOptions = {
  max: 200,
  windowMs: 60 * 1000,
  message: "Request rate limit exceeded. Please slow down.",
};

/**
 * Unknown-IP bucket: stricter cap for traffic where we couldn't resolve a real
 * client IP (e.g. malformed proxy headers). Audit fix: previously this traffic
 * bypassed the limiter entirely, letting an attacker scrub their IP to dodge
 * throttling. We now bucket all such requests under a single key with a
 * reduced cap, so the worst case is one shared throttle rather than no limit.
 */
export const UNKNOWN_IP_API_LIMIT: RateLimitOptions = {
  max: 30,
  windowMs: 60 * 1000,
  message: "Request rate limit exceeded. Please slow down.",
};

/** Proposal send: 20 sends per hour per user (prevents email spam) */
export const PROPOSAL_SEND_LIMIT: RateLimitOptions = {
  max: 20,
  windowMs: 60 * 60 * 1000,
  message: "Too many proposals sent. Please wait before sending more.",
};

/** Store create: 10 stores per hour per user */
export const STORE_CREATE_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 60 * 60 * 1000,
  message: "Too many stores created. Please wait before creating more.",
};

/** Store send for approval: 10 per hour per user */
export const STORE_APPROVAL_SEND_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 60 * 60 * 1000,
  message: "Too many approval requests sent. Please wait before sending more.",
};

/** Order create: 50 orders per hour per user */
export const ORDER_CREATE_LIMIT: RateLimitOptions = {
  max: 50,
  windowMs: 60 * 60 * 1000,
  message: "Too many orders placed. Please wait before placing more.",
};

/** Public storefront read: 60 requests per minute per IP (product browsing) */
export const PUBLIC_STORE_READ_LIMIT: RateLimitOptions = {
  max: 60,
  windowMs: 60 * 1000,
  message: "Too many requests. Please slow down and try again in a moment.",
};

/** Public store checkout: 10 checkout sessions per 15 minutes per IP */
export const PUBLIC_CHECKOUT_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 15 * 60 * 1000,
  message: "Too many checkout attempts. Please wait before trying again.",
};

/** Refund issue: 10 refunds per hour per user (prevents rapid Stripe refund abuse) */
export const REFUND_ISSUE_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 60 * 60 * 1000,
  message: "Too many refunds issued. Please wait before issuing more.",
};

/** Store AI optimization: 5 runs per hour per user — the generation is LLM-heavy. */
export const AI_STORE_OPTIMIZE_LIMIT: RateLimitOptions = {
  max: 5,
  windowMs: 60 * 60 * 1000,
  message: "Store optimization limit reached. Please wait before trying again.",
};

/** Copilot chat: 20 messages per minute per user (prevents LLM API cost abuse) */
export const COPILOT_CHAT_LIMIT: RateLimitOptions = {
  max: 20,
  windowMs: 60 * 1000,
  message: "You're sending messages too quickly. Please wait a moment.",
};

/**
 * Copilot email sends: 10 per hour per organization.
 * The copilot's sendBrandedEmail tool dispatches emails based on free-form
 * LLM-driven arguments, so without a cap a single chat session could be
 * coerced into fanning out spam. Scope is per-org (not per-user) because
 * the blast radius is org-wide — every member shares the same sender
 * identity and reputation.
 */
export const COPILOT_EMAIL_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 60 * 60 * 1000,
  message:
    "Email rate limit reached. You can send up to 10 emails per hour via the AI assistant.",
};

/** Public proposal mutation: 30 requests per hour per IP (edit, override, request fulfillment) */
export const PUBLIC_PROPOSAL_MUTATION_LIMIT: RateLimitOptions = {
  max: 30,
  windowMs: 60 * 60 * 1000,
  message: "Too many requests. Please wait before trying again.",
};

/** Billing mutations: 10 per minute per IP */
export const BILLING_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 60 * 1000,
  message: "Too many billing requests. Please wait before trying again.",
};

/** Social auth: 20 per minute per IP */
export const SOCIAL_AUTH_LIMIT: RateLimitOptions = {
  max: 20,
  windowMs: 60 * 1000,
  message: "Too many authentication attempts. Please wait before trying again.",
};

/** Account deletion: 5 per minute per IP */
export const ACCOUNT_DELETION_LIMIT: RateLimitOptions = {
  max: 5,
  windowMs: 60 * 1000,
  message: "Too many requests. Please wait before trying again.",
};

/** Proofing single render: 10 per hour per user */
export const PROOFING_RENDER_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 60 * 60 * 1000,
  message: "Too many proof renders. Please wait a bit before trying again.",
};

/** Proofing bulk render: 5 per hour per user */
export const PROOFING_BULK_LIMIT: RateLimitOptions = {
  max: 5,
  windowMs: 60 * 60 * 1000,
  message: "Too many bulk renders. Please wait a bit before trying again.",
};

/** Voice transcribe / speak: 30 per hour per user */
export const VOICE_LIMIT: RateLimitOptions = {
  max: 30,
  windowMs: 60 * 60 * 1000,
  message: "Too many voice requests. Please wait a bit before trying again.",
};

/** AI insights: 20 per hour per user */
export const AI_INSIGHTS_LIMIT: RateLimitOptions = {
  max: 20,
  windowMs: 60 * 60 * 1000,
  message: "Too many AI insight requests. Please wait a bit before trying again.",
};
