/**
 * agent.ts — Proactive-agent control surface.
 *
 * Procedures
 *   triggerScan  — on-demand scan. Fires the same runAgentCronScan() code
 *                  path as the 24-hour cron so distributors and the team
 *                  can exercise the agent without waiting. Rate-limited
 *                  at the tRPC middleware so no single user can pound
 *                  the scan into a loop.
 */

import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { runAgentCronScan } from "../jobs/agentCron";
import { getLogger } from "../utils/logger";
import type { RateLimitOptions } from "../utils/rateLimiter";

const log = getLogger("agent");

/**
 * Manual scan rate limit — 3 invocations per 10-minute window per IP.
 * The scan itself is global (every tenant is evaluated) and can queue
 * dozens of LLM calls, so even a friendly retry loop should be throttled.
 */
const MANUAL_SCAN_LIMIT: RateLimitOptions = {
  max: 3,
  windowMs: 10 * 60 * 1000,
  message:
    "You've started several agent scans recently. Please wait a few minutes before running another.",
};

export const agentRouter = router({
  /**
   * Run the full proactive-agent scan on demand. Returns once all
   * LLM calls have settled and the consolidated briefing notification
   * has been dispatched.
   */
  triggerScan: protectedProcedure
    .use(rateLimited("agent.triggerScan", MANUAL_SCAN_LIMIT))
    .mutation(async ({ ctx }) => {
      log.info(
        `[agent.triggerScan] Manual scan requested by user=${ctx.user.id}, org=${ctx.organizationId ?? "solo"}`,
      );
      try {
        await runAgentCronScan();
      } catch (err: unknown) {
        // runAgentCronScan already handles its own errors, but surface
        // anything unexpected to the caller so they can retry.
        const msg = err instanceof Error ? err.message : String(err);
        log.error("[agent.triggerScan] Unhandled scan failure:", msg);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Agent scan failed: ${msg}`,
        });
      }
      return { success: true, startedAt: new Date().toISOString() };
    }),
});
