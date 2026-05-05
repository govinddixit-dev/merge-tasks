/**
 * health-monitor.ts — In-process metrics collector. Runs in both the
 * main mergetasks process and the render worker, logging a JSON line
 * every 15 minutes to logs/health-metrics.jsonl. Designed to detect
 * slow leaks (memory, disk, connections) over 24-48h windows.
 *
 * Why setInterval and not pm2 cron_restart: cron_restart kills the
 * process on a schedule, which destroys exactly the long-window leak
 * signal we're trying to capture.
 *
 * Why not pm2 describe shell-out: process.memoryUsage() is in-process
 * and zero-cost; pm2 describe adds latency and a CLI dependency.
 *
 * The collector NEVER throws — every external call is wrapped in
 * try/catch and partial metrics are written rather than nothing.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getLogger } from "../utils/logger";

const log = getLogger("health-monitor");

const TICK_MS = 15 * 60 * 1000;
const METRICS_DIR = path.resolve(process.cwd(), "logs");
const METRICS_PATH = path.join(METRICS_DIR, "health-metrics.jsonl");

export type HealthProcess = "main" | "worker";

interface MemorySnapshot { rss: number; heapUsed: number; heapTotal: number; external: number }
interface DiskSnapshot { usedPct: number; availBytes: number; totalBytes: number }
interface RedisSnapshot { usedMemoryHuman: string | null; usedMemoryBytes: number | null }
interface MySQLSnapshot { threadsConnected: number | null }
interface QueueSnapshot { waiting: number | null; active: number | null; delayed: number | null; completed: number | null; failed: number | null }

interface HealthLine {
  ts: string;
  process: HealthProcess;
  uptimeSec: number;
  mem: MemorySnapshot;
  disk: DiskSnapshot | null;
  redis: RedisSnapshot | null;
  mysql: MySQLSnapshot | null;
  queue: QueueSnapshot | null;
}

async function collectDisk(): Promise<DiskSnapshot | null> {
  try {
    // statfs is available since Node 18.15 / 20+ — both prod and dev are on 20.
    const stats = await fsp.statfs("/home/ubuntu");
    const totalBytes = stats.blocks * stats.bsize;
    const availBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - availBytes;
    return {
      usedPct: Math.round((usedBytes / totalBytes) * 100),
      availBytes,
      totalBytes,
    };
  } catch (err) {
    log.warn(`disk collect failed: ${(err as Error).message}`);
    return null;
  }
}

async function collectRedis(): Promise<RedisSnapshot | null> {
  try {
    const { redisConnection } = await import("../queue/redisClient");
    if (!redisConnection) return null;
    const info = await redisConnection.info("memory");
    const humanMatch = /used_memory_human:(\S+)/.exec(info);
    const bytesMatch = /used_memory:(\d+)/.exec(info);
    return {
      usedMemoryHuman: humanMatch?.[1] ?? null,
      usedMemoryBytes: bytesMatch ? Number(bytesMatch[1]) : null,
    };
  } catch (err) {
    log.warn(`redis collect failed: ${(err as Error).message}`);
    return null;
  }
}

async function collectMySQL(): Promise<MySQLSnapshot | null> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return null;
    const { sql } = await import("drizzle-orm");
    const result = (await db.execute(sql`SHOW STATUS LIKE 'Threads_connected'`)) as unknown;
    // mysql2/drizzle returns [[{ Variable_name, Value }], FieldPacket[]]
    const rows = Array.isArray(result) ? (result[0] as Array<{ Value?: string }>) : [];
    const threads = rows[0]?.Value;
    return { threadsConnected: threads ? Number(threads) : null };
  } catch (err) {
    log.warn(`mysql collect failed: ${(err as Error).message}`);
    return null;
  }
}

async function collectQueue(): Promise<QueueSnapshot | null> {
  try {
    const { webstoreRenderQueue } = await import("../queue/webstore-render-queue");
    const counts = await webstoreRenderQueue.getJobCounts();
    if (!counts) return null;
    return {
      waiting: counts.waiting ?? null,
      active: counts.active ?? null,
      delayed: counts.delayed ?? null,
      completed: counts.completed ?? null,
      failed: counts.failed ?? null,
    };
  } catch (err) {
    log.warn(`queue collect failed: ${(err as Error).message}`);
    return null;
  }
}

async function collect(processName: HealthProcess): Promise<HealthLine> {
  const memUsage = process.memoryUsage();
  const mem: MemorySnapshot = {
    rss: memUsage.rss,
    heapUsed: memUsage.heapUsed,
    heapTotal: memUsage.heapTotal,
    external: memUsage.external,
  };

  // Both processes log their own memory + disk. Only the main process
  // queries MySQL + queue depth — they're shared resources and double-
  // sampling them every 15min from two processes adds noise without
  // information. Both query Redis (worker uses it heavily; main hits
  // it via the rate limiter). Skipping all three saves ~40ms of work
  // per worker tick.
  const isMain = processName === "main";
  const [disk, redis, mysql, queue] = await Promise.all([
    collectDisk(),
    collectRedis(),
    isMain ? collectMySQL() : Promise.resolve(null),
    isMain ? collectQueue() : Promise.resolve(null),
  ]);

  return {
    ts: new Date().toISOString(),
    process: processName,
    uptimeSec: Math.round(process.uptime()),
    mem,
    disk,
    redis,
    mysql,
    queue,
  };
}

async function writeLine(line: HealthLine): Promise<void> {
  try {
    if (!fs.existsSync(METRICS_DIR)) {
      fs.mkdirSync(METRICS_DIR, { recursive: true });
    }
    await fsp.appendFile(METRICS_PATH, JSON.stringify(line) + "\n", "utf-8");
  } catch (err) {
    log.warn(`failed to append metrics line: ${(err as Error).message}`);
  }
}

let _lastSnapshot: HealthLine | null = null;

/**
 * Most recent collected snapshot, or null if no tick has fired yet.
 * Exposed for /api/health/details — avoids a synchronous re-collect
 * on every HTTP hit (which would defeat the 15-min sampling cadence).
 */
export function getLastHealthSnapshot(): HealthLine | null {
  return _lastSnapshot;
}

/**
 * Boot the metrics collector. Fires once shortly after start (so we
 * have a baseline to plot against), then every 15 minutes. Idempotent —
 * calling twice is a no-op.
 */
let _started = false;
export function startHealthMonitor(processName: HealthProcess): void {
  if (_started) return;
  _started = true;

  const tick = async () => {
    try {
      const line = await collect(processName);
      _lastSnapshot = line;
      await writeLine(line);
    } catch (err) {
      // Defense in depth — collect() and writeLine() are already
      // try/catch-wrapped, but a future refactor could add a path that
      // throws synchronously. Don't take the process down for metrics.
      log.warn(`health tick failed: ${(err as Error).message}`);
    }
  };

  // First tick after 30s — gives the process time to fully boot
  // (DB pool ready, Redis connected) so the baseline isn't noise.
  setTimeout(tick, 30_000).unref();
  setInterval(tick, TICK_MS).unref();
  log.info(`health-monitor started for process=${processName} (15-min cadence, file=${METRICS_PATH})`);
}
