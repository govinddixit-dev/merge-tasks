#!/usr/bin/env npx tsx
/**
 * phase7-load-test.ts — Stress-test the Render Manager approval pipeline.
 *
 * Five phases (A–E) exercising listByStore, approve, bulkApprove, reRender,
 * and a realistic mixed workload. tRPC procedures are invoked directly via
 * `appRouter.createCaller(...)` — same pattern as the existing cross-tenant
 * tests (proposalsCrud.crossTenant.test.ts, renderManager.test.ts). No HTTP
 * round-trip; we measure router + DB latency, not network.
 *
 * IMPORTANT — preconditions
 * ─────────────────────────
 *   1. DATABASE_URL must be set. The script aborts otherwise.
 *   2. PAUSE THE WORKER FIRST if REDIS_URL is configured and mergetasks-
 *      render-worker is running. Phase D enqueues 50 force-renders that
 *      WILL hit Gemini if a worker is alive. The script does not pause it
 *      for you (that requires pm2 access we don't assume here).
 *
 *      Recommended:
 *        pm2 stop mergetasks-render-worker
 *        DATABASE_URL=… REDIS_URL=… npx tsx scripts/phase7-load-test.ts
 *        pm2 start mergetasks-render-worker
 *
 *      The script DRAINS the queue at the end of teardown, so any test
 *      jobs that did get enqueued are removed before the worker resumes.
 *
 * Setup creates 5 orgs × (1 client + 1 store + 20 products + 20 bindings)
 * = 100 storeProducts under marker `test-p7-load-`. Teardown removes them.
 *
 * Exit code: 0 if every phase clears its threshold, 1 if any miss.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, inArray, like } from "drizzle-orm";
import {
  users, clients, products, stores, storeProducts,
} from "../drizzle/schema";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { webstoreRenderQueue } from "../server/queue/webstore-render-queue";

// ─── Config ─────────────────────────────────────────────────────────────────
const N_ORGS = 5;
const PRODUCTS_PER_ORG = 20;
const TOTAL_BINDINGS = N_ORGS * PRODUCTS_PER_ORG;

const MARKER_OPENID_PREFIX = "test-p7-load-";
const MARKER_SKU_PREFIX = "P7-LOAD-";

// Latency thresholds. p95 in ms unless noted.
//
// Budgets calibrated against five clean runs on the production DB
// (2026-05-02). Headroom sized to the observed run-to-run variance:
//
//   Phase A — 600ms — bimodal cluster (450–520ms) needs the wider band
//                     to ride out cold-buffer-pool runs.
//   Phase B — 200ms — tight 18ms spread; 200ms is plenty of headroom.
//   Phase C —  50ms — tightest phase (4ms spread on bulk UPDATE).
//   Phase D — 250ms — predictable orchestrator skip-path latency.
//   Phase E — 900ms — accommodates the inline S3 PutObject tail. The
//                     architectural fix (pre-signed URL flow) is out
//                     of Phase 7 scope; 900ms reflects the current
//                     uploadOverride design honestly.
//
// Error budgets stay at 0% — every assertion held across all 25 phase
// executions in the 5-run calibration.
interface Threshold { name: string; metric: "p95" | "p99" | "errorRate"; budget: number; unit: "ms" | "%"; }
const THRESHOLDS: Record<string, Threshold[]> = {
  A: [
    { name: "listByStore p95",    metric: "p95",       budget: 600, unit: "ms" },
    { name: "listByStore errors", metric: "errorRate", budget: 0,   unit: "%"  },
  ],
  B: [
    { name: "approve p95",    metric: "p95",       budget: 200, unit: "ms" },
    { name: "approve errors", metric: "errorRate", budget: 0,   unit: "%"  },
  ],
  C: [
    { name: "bulkApprove p95", metric: "p95", budget: 50, unit: "ms" },
  ],
  D: [
    { name: "reRender p95",    metric: "p95",       budget: 250, unit: "ms" },
    { name: "reRender errors", metric: "errorRate", budget: 0,   unit: "%"  },
  ],
  E: [
    { name: "mixed p95",    metric: "p95",       budget: 900, unit: "ms" },
    { name: "mixed errors", metric: "errorRate", budget: 0,   unit: "%"  },
  ],
};

// ─── Types & helpers ────────────────────────────────────────────────────────

type Db = ReturnType<typeof drizzle>;

interface OrgFixture {
  userId: number;
  storeId: number;
  storeProductIds: number[];
  ctx: TrpcContext;
}

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function ctxFor(userId: number, openId: string): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId,
    email: `${openId}@mergetasks.test`,
    name: `Load Test ${userId}`,
    loginMethod: "email",
    role: "admin",
    subscriptionTier: "pro",
    subscriptionStatus: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    organizationId: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function readInsertId(r: unknown): number {
  return (r as Array<{ insertId: number }>)[0].insertId;
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

interface PhaseResult {
  phase: string;
  description: string;
  ops: number;
  errors: number;
  durations: number[];
  totalMs: number;
  extras?: Record<string, string | number>;
}

function summarize(r: PhaseResult) {
  const p50 = Math.round(pct(r.durations, 50));
  const p95 = Math.round(pct(r.durations, 95));
  const p99 = Math.round(pct(r.durations, 99));
  const errorRate = r.ops === 0 ? 0 : (r.errors / r.ops) * 100;
  return { p50, p95, p99, errorRate };
}

// 1×1 white PNG as base64 (smallest valid PNG ~70 bytes).
const WHITE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

// ─── Setup / teardown ───────────────────────────────────────────────────────

async function setup(db: Db): Promise<OrgFixture[]> {
  console.log(`[setup] creating ${N_ORGS} orgs × ${PRODUCTS_PER_ORG} products = ${TOTAL_BINDINGS} bindings`);
  const fixtures: OrgFixture[] = [];

  for (let o = 0; o < N_ORGS; o++) {
    const openId = `${MARKER_OPENID_PREFIX}${o}-${Date.now()}`;
    const userInsert = await db.insert(users).values({
      openId,
      email: `${openId}@mergetasks.test`,
      name: `Load Test Org ${o}`,
      role: "user",
      subscriptionTier: "pro",
      subscriptionStatus: "active",
      loginMethod: "email",
    });
    const userId = readInsertId(userInsert);

    const clientId = readInsertId(await db.insert(clients).values({
      userId,
      companyName: `Load Test Client ${o}`,
      contactName: "Load Test",
      contactEmail: `client-${o}@mergetasks.test`,
    }));

    const storeId = readInsertId(await db.insert(stores).values({
      userId,
      clientId,
      name: `Load Test Store ${o}`,
      slug: `phase-7-load-${o}-${Date.now()}`,
      status: "active",
    }));

    const storeProductIds: number[] = [];
    for (let p = 0; p < PRODUCTS_PER_ORG; p++) {
      const productId = readInsertId(await db.insert(products).values({
        userId,
        name: `Load Test Product ${o}-${p}`,
        sku: `${MARKER_SKU_PREFIX}${o}-${p}`,
        category: "apparel",
        imageUrl: "https://placehold.co/600x600.png",
        basePrice: "19.99",
        decorationMethods: ["embroidery"],
        // Placement fields so reRender's orchestrator passes the
        // no_analysis gate. Logo-resolution may still fail (no
        // clientLogos row), in which case enqueue returns
        // kind:"skipped":"no_logo" — that's still a happy-path
        // mutation from the router's perspective (success result,
        // no DB row corruption).
        webstoreImprintPlacementX:          "0.3500",
        webstoreImprintPlacementY:          "0.2000",
        webstoreImprintPlacementWidth:      "0.3000",
        webstoreImprintPlacementHeight:     "0.1500",
        webstoreImprintPlacementZone:       "chest_left",
        webstoreImprintPlacementBlendMode:  "multiply",
        webstoreImprintPlacementConfidence: "0.85",
        webstoreImprintPlacementAnalyzedAt: new Date(),
      }));

      const spId = readInsertId(await db.insert(storeProducts).values({
        storeId,
        productId,
        // Worst-case: complete + unapproved → entire fleet needs review.
        webstoreRenderStatus: "complete",
        webstoreRenderedImageUrl: "https://placehold.co/600x600/654BF9.png",
        webstoreRenderedAt: new Date(),
        webstoreRenderDecoration: "embroidery",
        webstoreRenderModel: "phase7-load-stub",
        renderApproved: false,
      }));
      storeProductIds.push(spId);
    }

    fixtures.push({ userId, storeId, storeProductIds, ctx: ctxFor(userId, openId) });
  }

  return fixtures;
}

async function teardown(db: Db) {
  console.log("[teardown] removing test fixtures + draining queue");

  // Find all load-test users by openId prefix.
  const us = await db.select({ id: users.id }).from(users).where(like(users.openId, `${MARKER_OPENID_PREFIX}%`));
  const userIds = us.map(r => r.id);
  if (userIds.length > 0) {
    const sps = await db.select({ id: storeProducts.id })
      .from(storeProducts)
      .innerJoin(stores, eq(stores.id, storeProducts.storeId))
      .where(inArray(stores.userId, userIds));
    if (sps.length > 0) await db.delete(storeProducts).where(inArray(storeProducts.id, sps.map(r => r.id)));
    await db.delete(stores).where(inArray(stores.userId, userIds));
    await db.delete(products).where(inArray(products.userId, userIds));
    await db.delete(clients).where(inArray(clients.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }

  // Drain any enqueued render jobs left over from Phase D / E. obliterate
  // is a more aggressive variant; drain leaves processed/failed history
  // intact, which is what we want for the production queue.
  try {
    await webstoreRenderQueue.drain(true);
  } catch (e) {
    console.warn("[teardown] queue drain failed (likely no-op stub):", (e as Error).message);
  }

  console.log(`[teardown] removed ${userIds.length} test orgs`);
}

// ─── Phase runner ───────────────────────────────────────────────────────────

async function runPhase<T>(
  phase: string,
  description: string,
  ops: Array<() => Promise<T>>,
): Promise<PhaseResult> {
  const durations: number[] = [];
  let errors = 0;
  const start = Date.now();

  // Fire all promises in parallel — that's the "concurrent" load model.
  const results = await Promise.allSettled(ops.map(async fn => {
    const t0 = Date.now();
    try {
      await fn();
      durations.push(Date.now() - t0);
    } catch (err) {
      durations.push(Date.now() - t0);
      throw err;
    }
  }));

  for (const r of results) if (r.status === "rejected") errors++;

  const totalMs = Date.now() - start;
  return { phase, description, ops: ops.length, errors, durations, totalMs };
}

// ─── Phases ─────────────────────────────────────────────────────────────────

async function phaseA(fixtures: OrgFixture[]): Promise<PhaseResult> {
  // 50 reads spread evenly across the 5 stores → 10 reads per store.
  const ops: Array<() => Promise<unknown>> = [];
  for (let i = 0; i < 50; i++) {
    const fx = fixtures[i % fixtures.length];
    const caller = appRouter.createCaller(fx.ctx);
    ops.push(() => caller.renderManager.listByStore({ storeId: fx.storeId, status: "all" }));
  }
  return runPhase("A", "50× listByStore concurrent", ops);
}

async function phaseB(fixtures: OrgFixture[]): Promise<PhaseResult> {
  // 100 approvals — one per binding across all 5 orgs.
  const ops: Array<() => Promise<unknown>> = [];
  for (const fx of fixtures) {
    const caller = appRouter.createCaller(fx.ctx);
    for (const spId of fx.storeProductIds) {
      ops.push(() => caller.renderManager.approve({ storeProductId: spId }));
    }
  }
  return runPhase("B", "100× approve concurrent", ops);
}

async function phaseC(db: Db, fixtures: OrgFixture[]): Promise<PhaseResult> {
  // Reset all to unapproved first.
  const allIds = fixtures.flatMap(f => f.storeProductIds);
  await db.update(storeProducts).set({
    renderApproved: false, renderApprovedAt: null, renderApprovedBy: null,
  }).where(inArray(storeProducts.id, allIds));

  const ops: Array<() => Promise<unknown>> = fixtures.map(fx => {
    const caller = appRouter.createCaller(fx.ctx);
    return () => caller.renderManager.bulkApprove({ storeId: fx.storeId });
  });
  return runPhase("C", "5× bulkApprove concurrent (one per store)", ops);
}

async function phaseD(fixtures: OrgFixture[]): Promise<PhaseResult> {
  // 50 re-renders with random prompt adjustments.
  const ADJUSTMENTS = [
    "make logo 30% smaller",
    "shift logo down 10%",
    "reduce decoration prominence",
    "tighter logo placement",
    "smaller embroidery footprint",
  ];
  const ops: Array<() => Promise<unknown>> = [];
  let count = 0;
  outer: for (const fx of fixtures) {
    const caller = appRouter.createCaller(fx.ctx);
    for (const spId of fx.storeProductIds) {
      const adjustment = ADJUSTMENTS[count % ADJUSTMENTS.length];
      ops.push(() => caller.renderManager.reRender({ storeProductId: spId, promptAdjustment: adjustment }));
      count++;
      if (count >= 50) break outer;
    }
  }
  return runPhase("D", "50× reRender concurrent (with prompt adjustment)", ops);
}

async function phaseE(fixtures: OrgFixture[]): Promise<PhaseResult> {
  // Mixed workload: 200 ops total
  //   80× listByStore (40%), 60× approve (30%), 30× reRender (15%),
  //   20× bulkApprove (10%), 10× uploadOverride (5%).
  const ops: Array<() => Promise<unknown>> = [];
  const allBindings = fixtures.flatMap(fx =>
    fx.storeProductIds.map(spId => ({ fx, spId })),
  );

  for (let i = 0; i < 80; i++) {
    const fx = fixtures[i % fixtures.length];
    const caller = appRouter.createCaller(fx.ctx);
    ops.push(() => caller.renderManager.listByStore({ storeId: fx.storeId, status: "all" }));
  }
  for (let i = 0; i < 60; i++) {
    const b = allBindings[i % allBindings.length];
    const caller = appRouter.createCaller(b.fx.ctx);
    ops.push(() => caller.renderManager.approve({ storeProductId: b.spId }));
  }
  for (let i = 0; i < 30; i++) {
    const b = allBindings[(i * 3) % allBindings.length];
    const caller = appRouter.createCaller(b.fx.ctx);
    ops.push(() => caller.renderManager.reRender({ storeProductId: b.spId, promptAdjustment: "tweak" }));
  }
  for (let i = 0; i < 20; i++) {
    const fx = fixtures[i % fixtures.length];
    const caller = appRouter.createCaller(fx.ctx);
    ops.push(() => caller.renderManager.bulkApprove({ storeId: fx.storeId }));
  }
  for (let i = 0; i < 10; i++) {
    const b = allBindings[(i * 7) % allBindings.length];
    const caller = appRouter.createCaller(b.fx.ctx);
    ops.push(() => caller.renderManager.uploadOverride({
      storeProductId: b.spId,
      imageBase64: WHITE_PNG_BASE64,
      mimeType: "image/png",
      fileName: "load-test-override.png",
    }));
  }

  return runPhase("E", "200× mixed (40/30/15/10/5)", ops);
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function checkThresholds(phase: string, r: PhaseResult): { name: string; actual: string; budget: string; pass: boolean }[] {
  const { p95, p99, errorRate } = summarize(r);
  const thresholds = THRESHOLDS[phase] ?? [];
  return thresholds.map(t => {
    const actual = t.metric === "p95" ? p95 : t.metric === "p99" ? p99 : errorRate;
    const pass = actual <= t.budget;
    return {
      name: t.name,
      actual: t.unit === "ms" ? `${actual}ms` : `${actual.toFixed(2)}%`,
      budget: t.unit === "ms" ? `${t.budget}ms` : `${t.budget}%`,
      pass,
    };
  });
}

function printResults(results: PhaseResult[]) {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("Phase 7 Load Test Results");
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("Phase  Ops   Errors  p50    p95    p99    Total    Description");
  console.log("─────  ────  ──────  ─────  ─────  ─────  ───────  ───────────────────────────");
  for (const r of results) {
    const { p50, p95, p99 } = summarize(r);
    console.log(
      `${r.phase.padEnd(5)}  ${String(r.ops).padEnd(4)}  ${String(r.errors).padEnd(6)}  ${String(p50).padEnd(5)}  ${String(p95).padEnd(5)}  ${String(p99).padEnd(5)}  ${String(r.totalMs + "ms").padEnd(7)}  ${r.description}`,
    );
    if (r.extras) {
      for (const [k, v] of Object.entries(r.extras)) {
        console.log(`       └─ ${k}: ${v}`);
      }
    }
  }

  console.log("");
  console.log("Threshold checks:");
  console.log("─────────────────────────────────────────────────────────────────");
  let allPass = true;
  for (const r of results) {
    const checks = checkThresholds(r.phase, r);
    for (const c of checks) {
      const mark = c.pass ? "✓" : "✗";
      console.log(`  ${mark}  ${c.name.padEnd(28)} actual=${c.actual.padEnd(8)} budget=${c.budget}`);
      if (!c.pass) allPass = false;
    }
  }
  console.log("");
  console.log(allPass ? "RESULT: all thresholds met" : "RESULT: one or more thresholds FAILED");
  return allPass;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[load-test] FATAL: DATABASE_URL not set");
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbUrl);
  const db = drizzle(conn);

  // Wipe any leftover load-test fixtures from a prior crashed run.
  await teardown(db);

  let queueDepthBefore = 0;
  try {
    const counts = await webstoreRenderQueue.getJobCounts();
    queueDepthBefore = (counts.waiting ?? 0) + (counts.delayed ?? 0);
  } catch {
    queueDepthBefore = -1; // queue stub mode (no REDIS_URL)
  }

  const fixtures = await setup(db);
  const results: PhaseResult[] = [];

  console.log("[phase A] read load — listByStore");
  results.push(await phaseA(fixtures));

  console.log("[phase B] write load — approve");
  const phaseBResult = await phaseB(fixtures);
  // Verify all 100 are approved.
  const approvedRows = await db.select({ id: storeProducts.id, renderApproved: storeProducts.renderApproved })
    .from(storeProducts)
    .where(inArray(storeProducts.id, fixtures.flatMap(f => f.storeProductIds)));
  const approvedCount = approvedRows.filter(r => r.renderApproved).length;
  phaseBResult.extras = { verified_approved: `${approvedCount}/${TOTAL_BINDINGS}` };
  results.push(phaseBResult);

  console.log("[phase C] bulk approve — 5× bulkApprove");
  const phaseCResult = await phaseC(db, fixtures);
  const approvedRowsC = await db.select({ renderApproved: storeProducts.renderApproved })
    .from(storeProducts)
    .where(inArray(storeProducts.id, fixtures.flatMap(f => f.storeProductIds)));
  phaseCResult.extras = { verified_approved: `${approvedRowsC.filter(r => r.renderApproved).length}/${TOTAL_BINDINGS}` };
  results.push(phaseCResult);

  console.log("[phase D] re-render storm — 50× reRender + queue assertion");
  const phaseDResult = await phaseD(fixtures);
  const targeted = fixtures.flatMap(f => f.storeProductIds).slice(0, 50);
  const dRows = await db.select({
    id: storeProducts.id,
    status: storeProducts.webstoreRenderStatus,
    approved: storeProducts.renderApproved,
  }).from(storeProducts).where(inArray(storeProducts.id, targeted));
  const pendingCount = dRows.filter(r => r.status === "pending" && !r.approved).length;
  let queueDelta: string;
  try {
    const counts = await webstoreRenderQueue.getJobCounts();
    const queueDepthAfter = (counts.waiting ?? 0) + (counts.delayed ?? 0);
    queueDelta = queueDepthBefore < 0
      ? "n/a (no Redis)"
      : `+${queueDepthAfter - queueDepthBefore}`;
  } catch {
    queueDelta = "n/a (no Redis)";
  }
  phaseDResult.extras = {
    verified_pending_unapproved: `${pendingCount}/50`,
    queue_depth_delta: queueDelta,
  };
  results.push(phaseDResult);

  console.log("[phase E] mixed workload — 200 ops");
  results.push(await phaseE(fixtures));

  // Always teardown, even on failure.
  await teardown(db);
  await conn.end();

  const allPass = printResults(results);
  process.exit(allPass ? 0 : 1);
}

main().catch(async err => {
  console.error("[load-test] FATAL:", err);
  // Best-effort cleanup so a crashed run doesn't leave fixtures behind.
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL ?? "");
    await teardown(drizzle(conn));
    await conn.end();
  } catch {}
  process.exit(1);
});
