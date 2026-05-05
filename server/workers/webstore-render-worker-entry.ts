/**
 * webstore-render-worker-entry.ts — pm2 entrypoint for the nano-banana
 * render worker. Runs as a SEPARATE process from the main mergetasks
 * server (see ecosystem.config.cjs entry "mergetasks-render-worker").
 *
 * Responsibilities:
 *   1. Load .env (matches the pattern used by scripts/regression/*.ts).
 *   2. Construct the BullMQ worker via the factory.
 *   3. Register SIGTERM/SIGINT handlers that close the worker gracefully
 *      (in-flight renders finish, no new jobs accepted), with a 30s
 *      hard-exit fallback.
 *
 * Keep this file thin — operational logic belongs in the factory, not
 * here. Anything beyond bootstrapping is a code smell.
 */

import "dotenv/config";
import { createWebstoreRenderWorker } from "./webstore-render-worker";
import { redisConnection } from "../queue/redisClient";
import { assertEvictionPolicy } from "../queue/assertEvictionPolicy";
import { reconcileOrphanRenderingRows } from "../services/webstore-render-orchestrator";
import { getDb } from "../db";
import { getLogger } from "../utils/logger";

const log = getLogger("webstore-render-worker-entry");

const SHUTDOWN_TIMEOUT_MS = 30_000;

let worker: ReturnType<typeof createWebstoreRenderWorker> | null = null;

// Fail-fast on misconfigured Redis. BullMQ silently loses queued jobs under
// memory pressure when maxmemory-policy != noeviction; we'd rather surface
// drift via pm2's restart counter than via a customer-facing missing render.
async function bootstrap() {
  if (!redisConnection) {
    log.error("redisConnection is null — REDIS_URL must be set for the worker process");
    process.exit(1);
  }
  try {
    await assertEvictionPolicy(redisConnection);
  } catch (err) {
    log.error(`Redis eviction-policy assertion failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // Orphan reconciliation: any storeProducts row in 'rendering' at boot is
  // orphaned (single-worker invariant). Warn-only on failure — assertion
  // already passed and the worker can usefully process new jobs even if
  // historical cleanup didn't run.
  try {
    const db = await getDb();
    if (!db) {
      log.warn("orphan-row reconciliation skipped: getDb() returned null");
    } else {
      await reconcileOrphanRenderingRows(db);
    }
  } catch (err) {
    log.warn(`orphan-row reconciliation failed: ${(err as Error).message} — continuing boot`);
  }

  worker = createWebstoreRenderWorker();
  log.info("webstore-render-worker started");

  // Health monitor — process-tagged "worker" so the analyzer can split
  // memory trends per process. Worker tick skips MySQL + queue-depth
  // collection (those are sampled by the main process) to avoid
  // double-counting shared resources.
  const { startHealthMonitor } = await import("../services/health-monitor");
  startHealthMonitor("worker");
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — closing worker (in-flight renders will finish, up to ${SHUTDOWN_TIMEOUT_MS}ms)`);

  const forceExit = setTimeout(() => {
    log.error(`graceful shutdown stalled past ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (worker) await worker.close();
    log.info("worker closed cleanly");
    process.exit(0);
  } catch (err) {
    log.error(`worker close failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  log.error(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
process.on("uncaughtException", (err) => {
  log.error(`uncaughtException: ${err.stack ?? err.message}`);
});

void bootstrap();
