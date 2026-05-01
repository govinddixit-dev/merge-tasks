/**
 * BullMQ queue + worker factories (Decision 27).
 *
 * All queues and workers share the singleton `redisConnection` from
 * ./redisClient — BullMQ requires the bclient/subscriber multiplexing on a
 * single connection per queue/worker, and sharing one ioredis instance across
 * queues keeps the connection count bounded.
 *
 * TODO(Phase 8): first real queues/workers register here (async agent tools
 * per Task 4 §3.4). Phase 1 ships factories only — no queues registered yet.
 */

import { Queue, Worker, type Job, type QueueOptions, type WorkerOptions } from "bullmq";
import { redisConnection } from "./redisClient";

/**
 * Per-job-class concurrency. Pick the one that matches the worker's IO
 * profile at construction time:
 *
 *   createWorker("agent.draftEmail", fn, { concurrency: AI_WORKER_CONCURRENCY })
 *   createWorker("notifications.send", fn, { concurrency: NOTIFICATION_WORKER_CONCURRENCY })
 *
 * Rationale:
 * - AI workers hit OpenAI / Anthropic endpoints that are rate-limited per key.
 *   Five concurrent in-flight requests keeps us well under typical per-minute
 *   RPM caps and avoids cascading 429s.
 * - Notification workers are lightweight fan-out: DB write + one outbound
 *   email/Slack call. The bottleneck is Redis/DB, not the worker — 20 keeps
 *   backlogs from pooling during nightly digest runs.
 * - Default covers everything else (exports, cleanup jobs, backfills) where
 *   5 is a safe mid-range.
 */
export const AI_WORKER_CONCURRENCY = 5;
export const NOTIFICATION_WORKER_CONCURRENCY = 20;
export const DEFAULT_CONCURRENCY = 5;

/** Standard retry policy for async work: 3 attempts with exponential backoff starting at 1s. */
const DEFAULT_JOB_OPTIONS: QueueOptions["defaultJobOptions"] = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000 },
};

// When redisConnection is null (test mode), return a Proxy that no-ops every
// method call. BullMQ's Queue/Worker surface is large; a Proxy lets tests
// construct queues without enumerating every method we might call.
function noopStub<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === "name") return name;
      if (prop === "then") return undefined; // avoid being treated as a thenable
      // Event emitter methods return the proxy itself for chainability
      if (prop === "on" || prop === "off" || prop === "once" || prop === "removeAllListeners") {
        return () => new Proxy({} as T, { get: () => () => undefined });
      }
      // Any other method returns a no-op that resolves to null
      return async () => null;
    },
  });
}

/**
 * Create a BullMQ Queue bound to the shared Redis connection.
 *
 * Phase 8 callers: use `createQueue<AgentJobPayload>("agent.<tool>")`.
 */
export function createQueue<T = unknown>(
  name: string,
  opts: Omit<QueueOptions, "connection"> = {},
): Queue<T> {
  if (!redisConnection) return noopStub<Queue<T>>(name);
  return new Queue<T>(name, {
    connection: redisConnection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, ...(opts.defaultJobOptions ?? {}) },
    ...opts,
  });
}

/**
 * Create a BullMQ Worker bound to the shared Redis connection.
 *
 * Concurrency defaults to DEFAULT_CONCURRENCY (5). Callers SHOULD pass an
 * explicit concurrency from the named constants above (`AI_WORKER_CONCURRENCY`
 * for LLM-bound work, `NOTIFICATION_WORKER_CONCURRENCY` for fan-out) rather
 * than relying on the default — named values make the IO profile visible in
 * diff review and keep the tuning coherent as new queues land.
 */
export function createWorker<T = unknown, R = unknown>(
  name: string,
  processor: (job: Job<T>) => Promise<R>,
  opts: Omit<WorkerOptions, "connection"> = {},
): Worker<T, R> {
  if (!redisConnection) return noopStub<Worker<T, R>>(name);
  return new Worker<T, R>(name, processor, {
    connection: redisConnection,
    concurrency: opts.concurrency ?? DEFAULT_CONCURRENCY,
    ...opts,
  });
}
