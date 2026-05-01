/**
 * Health-check handlers split into shallow (`/live`) and deep (`/ready`).
 *
 * `/live`  — confirms the Node process is up. No DB or Redis traffic.
 *            Cheap, safe to call at high QPS from orchestrators.
 *
 * `/ready` — confirms downstream dependencies (DB, Redis) are reachable.
 *            Result is cached for `READY_CACHE_TTL_MS` so a burst of probes
 *            from N load balancers does not amplify into N backend queries.
 *
 * The cache is per-process; in a multi-replica deploy each replica still
 * runs its own deep checks, but no replica re-runs them within the TTL.
 */

import type { Request, Response } from "express";

export const READY_CACHE_TTL_MS = 5_000;

export interface ReadyCheckResult {
  status: "healthy" | "degraded";
  timestamp: string;
  checks: Record<string, boolean>;
  /** True when this response was served from the in-process TTL cache. */
  cached?: boolean;
}

interface CacheEntry {
  result: ReadyCheckResult;
  storedAt: number;
}

let cache: CacheEntry | null = null;
/** Single in-flight readiness probe — coalesces concurrent requests onto one DB query. */
let inflight: Promise<ReadyCheckResult> | null = null;

/** Test-only hook to drop the cache between assertions. */
export function _resetReadyCacheForTests(): void {
  cache = null;
  inflight = null;
}

/**
 * Override the dependency probes used by `/ready`. Provided so tests can
 * simulate a DB or Redis outage without standing up real dependencies.
 *
 * Returns the previous probes so a test's `afterEach` can restore them.
 */
export interface ReadinessProbes {
  checkDatabase: () => Promise<boolean>;
  checkRedis: () => Promise<{ healthy: boolean; required: boolean }>;
}

const defaultProbes: ReadinessProbes = {
  checkDatabase: async () => {
    try {
      const { getPool } = await import("../db");
      const pool = getPool();
      if (!pool) return false;
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  },
  checkRedis: async () => {
    const required = !!process.env.REDIS_URL;
    try {
      const { isBlocklistHealthy } = await import("../utils/tokenBlocklist");
      return { healthy: await isBlocklistHealthy(), required };
    } catch {
      return { healthy: false, required };
    }
  },
};

let probes: ReadinessProbes = defaultProbes;

export function setReadinessProbes(next: Partial<ReadinessProbes>): ReadinessProbes {
  const previous = probes;
  probes = { ...probes, ...next };
  return previous;
}

export function restoreReadinessProbes(previous: ReadinessProbes): void {
  probes = previous;
}

/** Run the deep readiness probes once, with no caching applied. */
async function runReadyChecks(): Promise<ReadyCheckResult> {
  const checks: Record<string, boolean> = { server: true, database: false, redis: false };
  let healthy = true;

  checks.database = await probes.checkDatabase();
  if (!checks.database) healthy = false;

  const redisStatus = await probes.checkRedis();
  checks.redis = redisStatus.healthy;
  if (redisStatus.required && !redisStatus.healthy) healthy = false;

  return {
    status: healthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  };
}

/** Get a readiness result, using the TTL cache when fresh. */
export async function getReadyResult(now: number = Date.now()): Promise<ReadyCheckResult> {
  if (cache && now - cache.storedAt < READY_CACHE_TTL_MS) {
    return { ...cache.result, cached: true };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await runReadyChecks();
      cache = { result, storedAt: Date.now() };
      return result;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function liveHandler(_req: Request, res: Response): Promise<void> {
  // Liveness is unconditional — if this process can answer, it is alive.
  res.status(200).json({
    status: "alive",
    timestamp: new Date().toISOString(),
  });
}

export async function readyHandler(_req: Request, res: Response): Promise<void> {
  const result = await getReadyResult();
  res.status(result.status === "healthy" ? 200 : 503).json(result);
}
