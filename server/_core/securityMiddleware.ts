/**
 * Reusable security middleware factories.
 *
 * Extracted from server/_core/index.ts so unit tests can build a minimal
 * Express app with the exact same CORS / CSRF / rate-limit configuration as
 * production, without booting the full server (DB, Redis, Vite, etc.).
 */

import type { CorsOptions } from "cors";
import type { Request, Response, NextFunction } from "express";
import {
  checkRateLimit,
  getClientIp,
  GENERAL_API_LIMIT,
  UNKNOWN_IP_API_LIMIT,
} from "../utils/rateLimiter";
import { classifyPath } from "../utils/riskTier";
import { logger } from "../utils/logger";

/**
 * Build the CORS options used by the production server. Tests can call this
 * with the same env to verify allowed-origin and allow-headers behavior.
 */
export function buildCorsOptions(opts: {
  allowedOrigins: string[];
  isProduction: boolean;
  /** Regex for wildcard subdomains; defaults to *.mergetasks.com over https */
  subdomainAllow?: RegExp;
}): CorsOptions {
  const subdomainAllow = opts.subdomainAllow ?? /^https:\/\/[a-z0-9-]+\.mergetasks\.com$/;
  return {
    origin: (origin, callback) => {
      // Allow requests with no Origin header (server-to-server, curl).
      if (!origin) return callback(null, true);
      if (!opts.isProduction) return callback(null, true);
      if (opts.allowedOrigins.includes(origin) || subdomainAllow.test(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-correlation-id", "x-org-id", "x-csrf-token"],
    exposedHeaders: ["x-correlation-id"],
  };
}

/**
 * Build the global rate-limit middleware. Behavior:
 *   - Localhost is bypassed (stress tests, local dev).
 *   - Unknown client IPs are bucketed under `global:unknown` with a stricter
 *     cap, instead of bypassing the limiter.
 *   - On limiter backend errors, behavior is tier-aware:
 *       Tier A → 503 + structured error log (fail-closed).
 *       Tier B → continue + structured warn log (fail-open with fallback_mode).
 *
 * Accepts a `now`/`log` injection point so tests can introspect log output.
 */
export interface GlobalRateLimitDeps {
  check?: typeof checkRateLimit;
  log?: { warn: (msg: string) => void; error: (msg: string) => void };
}

export function buildGlobalApiRateLimit(deps: GlobalRateLimitDeps = {}) {
  const check = deps.check ?? checkRateLimit;
  const log = deps.log ?? logger;
  return async function globalApiRateLimit(req: Request, res: Response, next: NextFunction) {
    const ip = getClientIp(req as { ip?: string; headers: Record<string, string | string[] | undefined> });
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return next();
    }
    const isUnknown = ip === "unknown";
    const key = isUnknown ? "global:unknown" : `global:${ip}`;
    const limit = isUnknown ? UNKNOWN_IP_API_LIMIT : GENERAL_API_LIMIT;
    try {
      const result = await check(key, limit);
      if (!result.allowed) {
        res.setHeader("Retry-After", Math.ceil(result.resetInMs / 1000).toString());
        res.status(429).json({ error: result.message });
        return;
      }
      next();
    } catch (err) {
      const tier = classifyPath(req.path);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (tier === "A") {
        log.error(
          JSON.stringify({
            event: "rate_limiter_fail_closed",
            tier: "A",
            path: req.path,
            method: req.method,
            err: errMsg,
          })
        );
        res.status(503).json({ error: "Service temporarily unavailable. Please retry shortly." });
        return;
      }
      log.warn(
        JSON.stringify({
          event: "rate_limiter_fail_open",
          fallback_mode: true,
          tier: "B",
          path: req.path,
          method: req.method,
          err: errMsg,
        })
      );
      next();
    }
  };
}
