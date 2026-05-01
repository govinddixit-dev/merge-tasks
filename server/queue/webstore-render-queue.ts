/**
 * webstore-render-queue.ts — BullMQ queue for nano-banana product renders.
 *
 * Pipeline:
 *   Phase 5 hook (or Step 7 backfill) calls addWebstoreRenderJob(...)
 *     → job lands on the "webstore-product-render" queue
 *     → server/workers/webstore-render-worker.ts picks it up
 *     → calls renderProductWithLogo (server/services/nano-banana.ts)
 *     → persists results to storeProducts.webstoreRendered* columns,
 *       keyed on (storeId, productId) — per-binding, multi-tenant-correct.
 *
 * ──────────────────────────────────────────────────────────────────────
 * SCOPE BOUNDARY — read this before adding callers
 * ──────────────────────────────────────────────────────────────────────
 *
 * This queue is webstore-only. The distributor virtual proofing studio
 * (server/routers/proofing.ts → OpenAI Images) renders synchronously on
 * an in-process p-limit and is a SEPARATE pipeline. Do NOT enqueue
 * proofing jobs here. See docs/virtual-proofing-recon.md.
 *
 * Failed-job handling: there is no dead-letter queue. After all
 * `attempts` retries exhaust, the worker (Step 4) writes
 * webstoreRenderStatus='failed' to the storeProducts row. BullMQ retains the
 * last `removeOnFail` failed jobs in Redis for diagnostics. The Phase 8
 * backfill can re-enqueue failures by passing { force: true }.
 *
 * Connection: shares the singleton ioredis instance from
 * ../queue/redisClient via createQueue in ../queue/bullmq. Do NOT
 * instantiate a new Redis client here — connection-count discipline
 * matters for ElastiCache.
 */

import { createQueue } from "./bullmq";
import type { NanoBananaRenderInput } from "../services/nano-banana";

/** BullMQ queue name. The worker (Step 4) opens a Worker against this name. */
export const WEBSTORE_RENDER_QUEUE_NAME = "webstore-product-render";

/**
 * Worker concurrency. Re-exported so the worker imports the same value.
 * Five is conservative — nano-banana renders take 3-8s each, so five
 * concurrent renders cap us around ~40s of in-flight work, which keeps
 * memory bounded and stays well under per-key Gemini RPM limits.
 */
export const WEBSTORE_RENDER_CONCURRENCY = 5;

/**
 * Job payload. Mirrors NanoBananaRenderInput plus (storeId, productId) so the
 * worker can persist results back to the right storeProducts row without an
 * extra lookup. The pair (storeId, productId) — not productId alone — is the
 * write key after migration 0099 moved render columns to storeProducts.
 */
export type WebstoreRenderJob = NanoBananaRenderInput & {
  productId: number;
  storeId: number;
};

/**
 * Custom backoff schedule for failed renders: 60s → 300s → 900s.
 * Spacing is intentional — transient nano-banana failures (rate limits,
 * upstream 5xx, timeout) usually clear within a few minutes; the wider
 * 5m and 15m steps avoid hammering the model when it's already
 * struggling and give space for an outage to recover.
 *
 * BullMQ's built-in `exponential` would give 60s/120s/240s — too tight
 * for a 15-minute outage window. The named-strategy form lets us hard-
 * code the schedule.
 *
 * In BullMQ v5 the actual `backoffStrategy` function is registered on
 * the Worker's `settings`, NOT the Queue's. The queue's
 * `defaultJobOptions.backoff` references the strategy by its `type`
 * name (WEBSTORE_RENDER_BACKOFF_NAME below); the worker
 * (server/workers/webstore-render-worker.ts in Step 4) imports the
 * schedule and name and registers the function:
 *
 *   import { WEBSTORE_RENDER_BACKOFF_NAME, webstoreRenderBackoffStrategy }
 *     from "../queue/webstore-render-queue";
 *   createWorker(..., {
 *     settings: { backoffStrategy: webstoreRenderBackoffStrategy }
 *   });
 */
export const WEBSTORE_RENDER_BACKOFF_MS = [60_000, 300_000, 900_000] as const;
export const WEBSTORE_RENDER_BACKOFF_NAME = "webstoreRenderTiered";

export function webstoreRenderBackoffStrategy(attemptsMade: number): number {
  // attemptsMade is 1-based on the first retry; clamp to schedule length.
  const idx = Math.min(attemptsMade - 1, WEBSTORE_RENDER_BACKOFF_MS.length - 1);
  return WEBSTORE_RENDER_BACKOFF_MS[Math.max(0, idx)];
}

export const webstoreRenderQueue = createQueue<WebstoreRenderJob>(
  WEBSTORE_RENDER_QUEUE_NAME,
  {
    defaultJobOptions: {
      // 4 attempts (1 initial + 3 retries) consumes the full
      // 60s/300s/900s backoff schedule = 21min total retry window.
      // Covers extended Gemini outages without giving up too soon.
      // The cost is that ultimately-failed renders take 21min instead
      // of 6min to flip to 'failed', but nothing user-facing waits on
      // that timing — WebstoreLogoOverlay shows the CSS fallback during
      // the wait regardless.
      attempts: 4,
      backoff: { type: WEBSTORE_RENDER_BACKOFF_NAME },
      // Diagnostics retention — keep the last 100 successes and 500
      // failures in Redis so we can introspect the queue without a
      // separate logging pipeline.
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  },
);

/**
 * Enqueue a render job.
 *
 * Idempotency: by default the jobId is `storeproduct-{storeId}-{productId}`.
 * BullMQ silently rejects duplicate jobIds while a prior job is still in the
 * retention window (removeOnComplete: 100 / removeOnFail: 500), so Phase 5
 * hooks that fire on every product.uploadImage will not pile up redundant
 * renders for unchanged inputs on the same binding. The same product on a
 * different store gets its own dedup slot — multi-tenant-correct.
 *
 * Pass { force: true } to bypass the dedup — jobId becomes
 * `storeproduct-{storeId}-{productId}-{timestamp}`. Use this from:
 *   - Step 7 backfill (re-enqueueing rows where webstoreRenderStatus
 *     is NULL or 'failed')
 *   - Future Phase 7 distributor "force re-render" UI
 *
 * Hyphen, not colon: BullMQ v5.4+ rejects custom jobIds containing `:`
 * (it reserves colon for internal Redis key construction). Earlier
 * drafts used `product:${id}` and tripped "Custom Id cannot contain :"
 * the moment a hook tried to enqueue.
 *
 * No-ops cleanly when REDIS_URL is unset (test mode) — createQueue
 * returns a Proxy stub. Phase 5 hooks call this fire-and-forget; a
 * thrown error here would block product ingestion.
 */
export async function addWebstoreRenderJob(
  job: WebstoreRenderJob,
  options?: { force?: boolean },
): Promise<void> {
  const base = `storeproduct-${job.storeId}-${job.productId}`;
  const jobId = options?.force ? `${base}-${Date.now()}` : base;
  await webstoreRenderQueue.add("render", job, { jobId });
}
