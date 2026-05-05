/**
 * tRPC Rate-Limit Middleware Factory
 *
 * Usage:
 *   import { rateLimited } from "../utils/rateLimitMiddleware";
 *   import { SIGNIN_LIMIT } from "../utils/rateLimiter";
 *
 *   signIn: publicProcedure
 *     .use(rateLimited("signIn", SIGNIN_LIMIT))
 *     .input(...)
 *     .mutation(...)
 */

import { TRPCError } from "@trpc/server";
import { t } from "../_core/trpc";
import { checkRateLimit, getClientIp, type RateLimitOptions } from "./rateLimiter";

/**
 * Returns a tRPC middleware that enforces the given rate limit.
 * The key is scoped per IP + endpoint name to avoid cross-endpoint interference.
 */
export function rateLimited(endpointName: string, opts: RateLimitOptions) {
  return t.middleware(async ({ ctx, next }) => {
    const ip = getClientIp(ctx.req as { ip?: string; headers: Record<string, string | string[] | undefined> });
    // Bypass rate limiting for localhost (dev/CI/stress-test traffic)
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return next();
    }
    const key = `${endpointName}:${ip}`;
    const result = await checkRateLimit(key, opts);

    if (!result.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: result.message || "Rate limit exceeded.",
      });
    }

    return next();
  });
}
