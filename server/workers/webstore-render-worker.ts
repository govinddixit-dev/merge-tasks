/**
 * webstore-render-worker.ts — BullMQ processor for nano-banana renders.
 *
 * Pipeline:
 *   addWebstoreRenderJob (server/queue/webstore-render-queue.ts)
 *     → BullMQ "webstore-product-render" queue
 *     → this processor:
 *         - flips storeProducts.webstoreRenderStatus 'pending'/null → 'rendering'
 *           on the row matching (storeId, productId) from the job payload
 *         - calls renderProductWithLogo (server/services/nano-banana.ts)
 *         - on success: writes URL + metadata + status='complete', returns
 *         - on failure: throws, BullMQ retries per the tiered backoff
 *           (60s → 300s → 900s, see queue file)
 *     → after final attempt fails, the `failed` event handler writes
 *       webstoreRenderStatus='failed' to the storeProducts row.
 *
 * ──────────────────────────────────────────────────────────────────────
 * SCOPE BOUNDARY
 * ──────────────────────────────────────────────────────────────────────
 * Webstore-only. Do NOT process distributor proofing jobs here — that
 * pipeline is in-process p-limit, OpenAI Images. See
 * docs/virtual-proofing-recon.md.
 *
 * Runs as a SEPARATE pm2 process (see ecosystem.config.cjs entry
 * "mergetasks-render-worker"), not inside the main mergetasks server.
 */

import { eq, and, or, isNull, inArray } from "drizzle-orm";
import type { Worker, Job } from "bullmq";
import { createWorker } from "../queue/bullmq";
import { getDb } from "../db";
import { storeProducts } from "../../drizzle/schema";
import { renderProductWithLogo } from "../services/nano-banana";
import {
  WEBSTORE_RENDER_QUEUE_NAME,
  WEBSTORE_RENDER_CONCURRENCY,
  webstoreRenderBackoffStrategy,
  type WebstoreRenderJob,
} from "../queue/webstore-render-queue";
import { getLogger } from "../utils/logger";

const log = getLogger("webstore-render-worker");

/**
 * Job processor. Returns the render result object on success; throws on
 * failure to trigger BullMQ's retry path. The post-retry `failed` event
 * handler (registered below) writes status='failed' to the DB.
 */
async function processRenderJob(
  job: Job<WebstoreRenderJob>,
): Promise<{ ok: true; url: string; modelUsed: string; durationMs: number }> {
  const { productId, storeId } = job.data;
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  // Pre-write: flip to 'rendering' for progress visibility on this binding,
  // but only if the row is in a re-render-eligible state. The conditional
  // WHERE prevents clobbering a 'complete' row if a stale retry runs after
  // a newer enqueue already finished.
  await db
    .update(storeProducts)
    .set({ webstoreRenderStatus: "rendering" })
    .where(
      and(
        eq(storeProducts.storeId, storeId),
        eq(storeProducts.productId, productId),
        or(
          isNull(storeProducts.webstoreRenderStatus),
          inArray(storeProducts.webstoreRenderStatus, ["pending", "failed"]),
        ),
      ),
    );

  const result = await renderProductWithLogo(job.data, productId);

  if (!result.ok) {
    // Throw so BullMQ retries per the tiered backoff. Do NOT write
    // status='failed' here — the worker's `failed` event handler does
    // that only after all attempts are exhausted.
    throw new Error(`render failed (${result.reason}): ${result.error ?? "no detail"}`);
  }

  await db
    .update(storeProducts)
    .set({
      webstoreRenderedImageUrl: result.url,
      webstoreRenderedAt: new Date(),
      webstoreRenderDecoration: job.data.decorationMethod,
      webstoreRenderStatus: "complete",
      webstoreRenderModel: result.modelUsed,
    })
    .where(
      and(
        eq(storeProducts.storeId, storeId),
        eq(storeProducts.productId, productId),
      ),
    );

  return {
    ok: true,
    url: result.url,
    modelUsed: result.modelUsed,
    durationMs: result.durationMs,
  };
}

/**
 * Construct the worker. Called once from the entry script.
 *
 * Concurrency, queue name, and backoff strategy come from the queue
 * file so they stay in lockstep. The backoff function is registered
 * here on the WORKER (not the queue) per BullMQ v5 — see queue file
 * docblock for the migration note.
 */
export function createWebstoreRenderWorker(): Worker<
  WebstoreRenderJob,
  { ok: true; url: string; modelUsed: string; durationMs: number }
> {
  const worker = createWorker<
    WebstoreRenderJob,
    { ok: true; url: string; modelUsed: string; durationMs: number }
  >(WEBSTORE_RENDER_QUEUE_NAME, processRenderJob, {
    concurrency: WEBSTORE_RENDER_CONCURRENCY,
    settings: { backoffStrategy: webstoreRenderBackoffStrategy },
  });

  worker.on("active", (job) => {
    log.info(`job ${job.id} active (storeId=${job.data.storeId}, productId=${job.data.productId}, attempt=${job.attemptsMade + 1})`);
  });

  worker.on("completed", (job, result) => {
    log.info(
      `job ${job.id} complete (storeId=${job.data.storeId}, productId=${job.data.productId}, model=${result.modelUsed}, ${result.durationMs}ms)`,
    );
  });

  // BullMQ fires `failed` for every attempt, not just the final one.
  // Only flip the DB to 'failed' once all attempts are exhausted —
  // earlier failures will be retried per the tiered backoff and we
  // don't want the overlay to switch to fallback prematurely.
  worker.on("failed", async (job, err) => {
    if (!job) {
      log.error(`worker failed event without job: ${err.message}`);
      return;
    }
    const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    const bindingTag = `storeId=${job.data.storeId} productId=${job.data.productId}`;
    log.warn(
      `job ${job.id} failed attempt ${job.attemptsMade}/${job.opts.attempts ?? 1} (${bindingTag}): ${err.message}`,
    );
    if (!finalAttempt) return;

    try {
      const db = await getDb();
      if (!db) {
        log.error(`cannot mark ${bindingTag} failed: database unavailable`);
        return;
      }
      // Guard: only flip to 'failed' if the row is currently 'rendering'
      // (i.e., we're the active attempt). If a parallel non-force enqueue
      // succeeded and moved the row to 'complete', don't clobber it.
      // Data preservation by default; explicit clearing belongs in the
      // Phase 7 override UI.
      const updateResult = await db
        .update(storeProducts)
        .set({ webstoreRenderStatus: "failed" })
        .where(
          and(
            eq(storeProducts.storeId, job.data.storeId),
            eq(storeProducts.productId, job.data.productId),
            eq(storeProducts.webstoreRenderStatus, "rendering"),
          ),
        );
      // Drizzle's mysql2 driver returns the underlying ResultSetHeader on
      // UPDATE — read affectedRows to know whether the WHERE matched.
      const affectedRows =
        (updateResult as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
      if (affectedRows > 0) {
        log.warn(
          `${bindingTag} marked failed after ${job.attemptsMade} attempts`,
        );
      } else {
        log.info(
          `${bindingTag} already in non-rendering state, skipping failed flip`,
        );
      }
    } catch (dbErr) {
      log.error(
        `failed to mark ${bindingTag} as failed: ${(dbErr as Error).message}`,
      );
    }
  });

  worker.on("error", (err) => {
    log.error(`worker error: ${err.message}`);
  });

  return worker;
}
