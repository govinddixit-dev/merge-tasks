/**
 * Shared Redis connection for BullMQ (Decision 27 — AWS ElastiCache + BullMQ).
 *
 * Phase 1 Task 1 wires the connection only. No queues or workers are registered
 * here; agent async tooling registers queues in Phase 8 (Task 4 §3.4).
 *
 * Connection URL comes from REDIS_URL. Use `rediss://` (two s's) to enable TLS
 * — AWS ElastiCache in-transit encryption requires it.
 */

import IORedis, { type Redis, type RedisOptions } from "ioredis";
import { getLogger } from "../utils/logger";

const log = getLogger("redisClient");

const REDIS_URL = process.env.REDIS_URL;
const IS_TEST_ENV = process.env.NODE_ENV === "test" || !!process.env.VITEST;

if (!REDIS_URL && !IS_TEST_ENV) {
  // Fail fast: every Phase 1+ deployment must point at the managed ElastiCache
  // instance. The module-load throw surfaces misconfiguration at startup rather
  // than when the first queue/worker is constructed. Tests run without Redis —
  // consumers must handle a null connection.
  throw new Error(
    "REDIS_URL is not set. Phase 1+ requires an ElastiCache Redis endpoint per Decision 27.",
  );
}

const options: RedisOptions = {
  // BullMQ requires commands to block indefinitely until Redis responds
  // (the worker's BRPOPLPUSH polls must not time out after N retries).
  maxRetriesPerRequest: null,

  // BullMQ manages its own readiness via lua scripts; ioredis's READY check
  // fights with that and can wedge the client. Disable per BullMQ docs.
  enableReadyCheck: false,

  // Let ioredis auto-reconnect on transient failures. Exponential-ish backoff
  // capped at 10s; returning a number schedules a retry, null would stop.
  retryStrategy: (times) => Math.min(50 * 2 ** times, 10_000),

  // Reconnect once Redis tells us it's read-only (ElastiCache failover to a
  // replica briefly exposes a read-only primary mid-switch).
  reconnectOnError: (err) => /READONLY/i.test(err.message),
};

export const redisConnection: Redis | null = REDIS_URL
  ? new IORedis(REDIS_URL, options)
  : null;

if (redisConnection) {
  redisConnection.on("error", (err: Error) => {
    // Never log REDIS_URL — it may carry credentials in future configurations.
    log.error("Redis connection error", err);
  });

  redisConnection.on("reconnecting", (delay: number) => {
    log.warn(`Redis reconnecting in ${delay}ms`);
  });
}

/** PING round-trip check. Returns true iff Redis replies with "PONG". */
export async function isRedisHealthy(): Promise<boolean> {
  if (!redisConnection) return false;
  try {
    const reply = await redisConnection.ping();
    return reply === "PONG";
  } catch {
    return false;
  }
}
