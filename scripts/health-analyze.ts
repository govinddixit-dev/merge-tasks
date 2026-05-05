#!/usr/bin/env npx tsx
/**
 * health-analyze.ts — Reads logs/health-metrics.jsonl and reports
 * trends + a HEALTHY / WARNING / CRITICAL verdict.
 *
 * Usage:
 *   npx tsx scripts/health-analyze.ts            # default file
 *   npx tsx scripts/health-analyze.ts <path>     # explicit path
 *   npx tsx scripts/health-analyze.ts --since=24h
 *
 * Trends are computed via simple linear regression on each metric
 * series. We treat slope as bytes-per-hour (or units-per-hour) and
 * surface verdicts on the most operationally meaningful ones:
 *
 *   memory   — RSS slope per process
 *   disk     — usedPct trend
 *   redis    — used_memory_bytes trend
 *   mysql    — threads_connected trend (leak indicator)
 *   queue    — waiting depth trend (worker keeping up?)
 *
 * Thresholds are intentionally conservative — the script is a
 * directional smoke check, not a paging-grade alerting system.
 */
import fs from "node:fs";
import path from "node:path";

interface HealthLine {
  ts: string;
  process: "main" | "worker";
  uptimeSec: number;
  mem: { rss: number; heapUsed: number; heapTotal: number; external: number };
  disk: { usedPct: number; availBytes: number; totalBytes: number } | null;
  redis: { usedMemoryBytes: number | null } | null;
  mysql: { threadsConnected: number | null } | null;
  queue: { waiting: number | null; active: number | null; delayed: number | null } | null;
}

const args = process.argv.slice(2);
const explicitPath = args.find(a => !a.startsWith("--"));
const sinceArg = args.find(a => a.startsWith("--since="));
const METRICS_PATH = explicitPath ?? path.resolve(process.cwd(), "logs/health-metrics.jsonl");

if (!fs.existsSync(METRICS_PATH)) {
  console.error(`[health-analyze] no metrics file at ${METRICS_PATH}`);
  console.error("Has the health-monitor run? It logs every 15 minutes after server boot.");
  process.exit(1);
}

const sinceMs = (() => {
  if (!sinceArg) return null;
  const m = /^--since=(\d+)([hd])$/.exec(sinceArg);
  if (!m) {
    console.error(`[health-analyze] could not parse ${sinceArg}; use e.g. --since=24h or --since=7d`);
    process.exit(1);
  }
  const n = Number(m[1]);
  const unit = m[2];
  return Date.now() - n * (unit === "h" ? 3_600_000 : 86_400_000);
})();

const raw = fs.readFileSync(METRICS_PATH, "utf-8").trim().split("\n");
const lines: HealthLine[] = [];
for (const r of raw) {
  if (!r) continue;
  try {
    const parsed = JSON.parse(r) as HealthLine;
    if (sinceMs && new Date(parsed.ts).getTime() < sinceMs) continue;
    lines.push(parsed);
  } catch {
    // skip malformed line
  }
}

if (lines.length < 2) {
  console.error(`[health-analyze] need at least 2 samples to compute trends, got ${lines.length}`);
  console.error(`(file=${METRICS_PATH}${sinceArg ? `, since=${sinceArg}` : ""})`);
  process.exit(1);
}

interface SeriesPoint { hours: number; value: number }
function linearSlope(points: SeriesPoint[]): number {
  // Returns slope (units per hour). Standard least-squares.
  if (points.length < 2) return 0;
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.hours; sumY += p.value;
    sumXY += p.hours * p.value;
    sumX2 += p.hours * p.hours;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function toSeries(lines: HealthLine[], pick: (l: HealthLine) => number | null): SeriesPoint[] {
  if (lines.length === 0) return [];
  const t0 = new Date(lines[0].ts).getTime();
  const out: SeriesPoint[] = [];
  for (const l of lines) {
    const v = pick(l);
    if (v == null) continue;
    out.push({ hours: (new Date(l.ts).getTime() - t0) / 3_600_000, value: v });
  }
  return out;
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)}MB`;
}

const concerns: string[] = [];

function reportProcess(name: "main" | "worker"): void {
  const own = lines.filter(l => l.process === name);
  if (own.length < 2) {
    console.log(`\n── process=${name} ── insufficient samples (${own.length})`);
    return;
  }
  const rss = toSeries(own, l => l.mem.rss);
  const slopeRssBytesPerHour = linearSlope(rss);
  const slopeRssMBPerHour = slopeRssBytesPerHour / 1_048_576;
  const heap = toSeries(own, l => l.mem.heapUsed);
  const slopeHeapMBPerHour = linearSlope(heap) / 1_048_576;
  const first = own[0], last = own[own.length - 1];
  const spanH = (new Date(last.ts).getTime() - new Date(first.ts).getTime()) / 3_600_000;

  console.log(`\n── process=${name} ── ${own.length} samples over ${spanH.toFixed(1)}h`);
  console.log(`  RSS:        ${fmtMB(first.mem.rss)} → ${fmtMB(last.mem.rss)}    slope=${slopeRssMBPerHour.toFixed(2)} MB/h`);
  console.log(`  heapUsed:   ${fmtMB(first.mem.heapUsed)} → ${fmtMB(last.mem.heapUsed)}    slope=${slopeHeapMBPerHour.toFixed(2)} MB/h`);

  if (slopeRssMBPerHour > 10) concerns.push(`CRITICAL: ${name} RSS growing at ${slopeRssMBPerHour.toFixed(1)} MB/h`);
  else if (slopeRssMBPerHour > 1) concerns.push(`WARNING: ${name} RSS growing at ${slopeRssMBPerHour.toFixed(1)} MB/h`);
}

reportProcess("main");
reportProcess("worker");

// Disk — use main-process samples (worker logs disk too but it's the
// same volume; one source is enough for the verdict).
const mainLines = lines.filter(l => l.process === "main");
const diskSeries = toSeries(mainLines, l => l.disk?.usedPct ?? null);
if (diskSeries.length >= 2) {
  const last = mainLines[mainLines.length - 1].disk;
  const slope = linearSlope(diskSeries);
  console.log(`\n── disk ── usedPct=${last?.usedPct ?? "?"}% slope=${slope.toFixed(3)}%/h`);
  if ((last?.usedPct ?? 0) > 90) concerns.push(`CRITICAL: disk at ${last?.usedPct}%`);
  else if ((last?.usedPct ?? 0) > 80) concerns.push(`WARNING: disk at ${last?.usedPct}%`);
  if (slope > 0.5) concerns.push(`WARNING: disk growing at ${slope.toFixed(2)}%/h`);
}

// Redis memory
const redisSeries = toSeries(mainLines, l => l.redis?.usedMemoryBytes ?? null);
if (redisSeries.length >= 2) {
  const last = mainLines[mainLines.length - 1].redis;
  const slope = linearSlope(redisSeries) / 1_048_576;
  console.log(`\n── redis ── used=${last?.usedMemoryBytes ? fmtMB(last.usedMemoryBytes) : "?"} slope=${slope.toFixed(2)} MB/h`);
  if (slope > 5) concerns.push(`WARNING: redis memory growing at ${slope.toFixed(1)} MB/h`);
}

// MySQL connections
const mysqlSeries = toSeries(mainLines, l => l.mysql?.threadsConnected ?? null);
if (mysqlSeries.length >= 2) {
  const last = mainLines[mainLines.length - 1].mysql;
  const slope = linearSlope(mysqlSeries);
  console.log(`\n── mysql ── threads_connected=${last?.threadsConnected ?? "?"} slope=${slope.toFixed(2)}/h`);
  if (slope > 1) concerns.push(`WARNING: MySQL connections growing at ${slope.toFixed(1)}/h (possible leak)`);
}

// Queue depth
const queueSeries = toSeries(mainLines, l => l.queue?.waiting ?? null);
if (queueSeries.length >= 2) {
  const last = mainLines[mainLines.length - 1].queue;
  const slope = linearSlope(queueSeries);
  console.log(`\n── queue (webstore-product-render) ── waiting=${last?.waiting ?? "?"} active=${last?.active ?? "?"} delayed=${last?.delayed ?? "?"} slope=${slope.toFixed(2)} jobs/h`);
  if ((last?.waiting ?? 0) > 100) concerns.push(`WARNING: queue waiting depth=${last?.waiting} (worker may be lagging)`);
  if (slope > 5) concerns.push(`WARNING: queue waiting depth growing at ${slope.toFixed(1)} jobs/h`);
}

// Verdict
console.log("\n═══════════════════════════════════════════════════");
const critical = concerns.filter(c => c.startsWith("CRITICAL"));
const warning = concerns.filter(c => c.startsWith("WARNING"));
let verdict: "HEALTHY" | "WARNING" | "CRITICAL";
if (critical.length > 0) verdict = "CRITICAL";
else if (warning.length > 0) verdict = "WARNING";
else verdict = "HEALTHY";
console.log(`VERDICT: ${verdict}`);
if (concerns.length > 0) {
  for (const c of concerns) console.log(`  • ${c}`);
} else {
  console.log("  (no leak signals over the analyzed window)");
}
console.log("═══════════════════════════════════════════════════\n");

process.exit(verdict === "CRITICAL" ? 1 : 0);
