/**
 * Boot-time assertion: BullMQ requires `maxmemory-policy=noeviction` on the
 * Redis instance backing its queues. If the policy is anything else (notably
 * the ElastiCache default `volatile-lru`), Redis can evict job-state keys
 * under memory pressure and silently drop in-flight render jobs.
 *
 * This module exists because:
 *   - ElastiCache disables `CONFIG GET`/`CONFIG SET` (managed-service lockdown).
 *     `INFO memory` is the only path to read the live policy from inside the app.
 *   - The misconfiguration is invisible at runtime until eviction actually
 *     happens — by which point queued jobs are already lost. Failing fast at
 *     boot surfaces parameter-group drift via pm2's restart counter rather
 *     than via a customer-facing render disappearing.
 *
 * NOT yet wired into a boot path. Land in a follow-up commit after the
 * ElastiCache parameter-group change is verified in production.
 */

import type { Redis } from "ioredis";
import { getLogger } from "../utils/logger";

const log = getLogger("redis-eviction-policy");

const REQUIRED_POLICY = "noeviction";

export class RedisEvictionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisEvictionPolicyError";
  }
}

/**
 * Read `maxmemory_policy` from `INFO memory` and throw if it is not
 * `noeviction`. Caller decides whether to treat the throw as fatal — the
 * worker entry should; the main app may prefer warn-and-continue depending
 * on how strictly it depends on BullMQ persistence.
 */
export async function assertEvictionPolicy(connection: Redis): Promise<void> {
  const info = await connection.info("memory");
  const match = info.match(/^maxmemory_policy:(.+)$/m);
  if (!match) {
    throw new RedisEvictionPolicyError(
      "Could not read maxmemory_policy from Redis INFO memory output. " +
        "Cannot verify BullMQ-required eviction policy."
    );
  }
  const policy = match[1].trim();
  if (policy !== REQUIRED_POLICY) {
    throw new RedisEvictionPolicyError(
      `Redis maxmemory-policy is "${policy}", BullMQ requires "${REQUIRED_POLICY}". ` +
        "Update the ElastiCache parameter group attached to this cluster."
    );
  }
  log.info(`Redis maxmemory-policy verified: ${policy}`);
}
