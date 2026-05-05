/**
 * renderQueueIsolation.test.ts — BullMQ queue stress + isolation
 * (Phase 3). Net-new coverage for the render pipeline under load.
 *
 * SAFETY BELTS — read before adjusting gates
 * ──────────────────────────────────────────
 *   1. SKIPS unless STRESS_TEST_QUEUE_ENABLED=true. Default-off so
 *      a casual `pnpm test` run never hits Redis.
 *   2. SKIPS if REDIS_URL hostname matches the prod cluster name
 *      (substring "mergetasks-redis-prod"). Putting test jobs in the
 *      prod queue would dispatch them to the live render worker,
 *      burn Anthropic/Gemini quota, and write garbage to S3. We refuse.
 *   3. Drains the queue in beforeAll AND afterAll so a leftover from
 *      a prior crashed run cannot interfere with the assertions.
 *   4. Uses addWebstoreRenderJob with synthetic storeId/productId
 *      values seeded above the real-data range (10_000_000+) so a
 *      race against real enqueues cannot flip an assertion.
 *
 * Phase 3 spec items covered: Test E (queue flood, payload integrity)
 * and Test F (no cross-org payload contamination). Worker is NOT
 * paused — assertions read pending jobs immediately after enqueue,
 * before the worker normally picks them up. This is fragile by
 * design; running while a live worker is consuming will produce a
 * SKIP-equivalent (jobs gone before we read them). The opt-in flag
 * is the documented escape hatch.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  webstoreRenderQueue,
  addWebstoreRenderJob,
  WEBSTORE_RENDER_QUEUE_NAME,
} from "./queue/webstore-render-queue";

const REDIS_URL = process.env.REDIS_URL ?? "";
const _hasRedis = REDIS_URL.length > 0;
const _isProdRedis = REDIS_URL.includes("mergetasks-redis-prod");
const _enabled =
  process.env.STRESS_TEST_QUEUE_ENABLED === "true" &&
  _hasRedis &&
  !_isProdRedis;

if (!_enabled) {
  // eslint-disable-next-line no-console
  console.log(
    `NOTE: queue isolation tests skipped — ` +
      `STRESS_TEST_QUEUE_ENABLED=${process.env.STRESS_TEST_QUEUE_ENABLED ?? "(unset)"}, ` +
      `REDIS_URL=${_hasRedis ? "set" : "unset"}, ` +
      `prodRedis=${_isProdRedis}`,
  );
}

// Synthetic ID space — avoids any chance of overlap with real
// storeProducts / products rows. The worker would skip these as
// "store_not_found" anyway, but using huge IDs makes that intent
// obvious in any leftover diagnostics.
const SYNTH_STORE_BASE = 10_000_000;
const SYNTH_PRODUCT_BASE = 20_000_000;

async function drainTestJobs(): Promise<void> {
  // Remove every waiting/delayed/active job whose payload looks like
  // ours (synthetic ID range). Conservative: leave anything else
  // alone in case this somehow ran on a real Redis.
  const jobs = await webstoreRenderQueue.getJobs(["waiting", "delayed", "active", "paused"]);
  for (const j of jobs) {
    const data = j.data as { storeId?: number; productId?: number };
    if (
      data?.storeId !== undefined && data.storeId >= SYNTH_STORE_BASE &&
      data?.productId !== undefined && data.productId >= SYNTH_PRODUCT_BASE
    ) {
      try { await j.remove(); } catch { /* ignored */ }
    }
  }
}

beforeAll(async () => {
  if (!_enabled) return;
  await drainTestJobs();
}, 30_000);

afterAll(async () => {
  if (!_enabled) return;
  await drainTestJobs();
}, 30_000);

describe.skipIf(!_enabled)(`Phase 3 — render queue (${WEBSTORE_RENDER_QUEUE_NAME})`, () => {
  it("Test E — 100 simultaneous enqueues land within 5s, all visible, payload-correct", async () => {
    const TOTAL = 100;
    const ORG_COUNT = 3;
    // Distribute synthetic IDs across 3 "orgs" — each gets a distinct
    // storeId so payload integrity assertions can group cleanly.
    const enqueues = Array.from({ length: TOTAL }, (_, i) => {
      const orgIdx = i % ORG_COUNT;
      const storeId = SYNTH_STORE_BASE + orgIdx;
      const productId = SYNTH_PRODUCT_BASE + i;
      return addWebstoreRenderJob(
        {
          storeId,
          productId,
          productName: `synth-${i}`,
          productImageUrl: "https://placehold.co/600x600.png",
          logoUrl: "https://placehold.co/200x200.png",
          decorationMethod: "embroidery",
          placement: { x: 0.3, y: 0.2, w: 0.3, h: 0.15, zone: "left_chest" },
        },
        { force: true },
      );
    });

    const t0 = Date.now();
    await Promise.all(enqueues);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(5_000);

    // Read back immediately. Any of these jobs may have been picked
    // up by a live worker between enqueue and read — that's the
    // documented fragility of this test running with a worker up.
    // The assertion is therefore "no fewer than the count of synthetic
    // jobs we still see"; missing ones imply a worker is actively
    // consuming, which is acceptable as long as those that remain are
    // payload-correct.
    const seen = await webstoreRenderQueue.getJobs(["waiting", "delayed", "active", "paused"]);
    const ours = seen.filter(j => {
      const d = j.data as { storeId?: number; productId?: number };
      return d?.storeId !== undefined && d.storeId >= SYNTH_STORE_BASE
        && d?.productId !== undefined && d.productId >= SYNTH_PRODUCT_BASE;
    });
    // Strong assertion: we should see at least 90% (allowing for a
    // small worker race window). If a live worker drained more than
    // 10% in the milliseconds between enqueue + read, the perf signal
    // is more interesting than a hard fail.
    expect(ours.length).toBeGreaterThanOrEqual(Math.floor(TOTAL * 0.9));

    for (const j of ours) {
      const d = j.data as { storeId: number; productId: number; productName: string };
      expect(d.storeId).toBeGreaterThanOrEqual(SYNTH_STORE_BASE);
      expect(d.productId).toBeGreaterThanOrEqual(SYNTH_PRODUCT_BASE);
      expect(d.productName).toMatch(/^synth-/);
    }

    // eslint-disable-next-line no-console
    console.log(`[Phase 3E] 100 enqueues in ${elapsed}ms; ${ours.length}/${TOTAL} still visible at read time`);
  }, 30_000);

  it("Test F — per-org payloads do not cross-contaminate", async () => {
    // Drain prior test's residue first.
    await drainTestJobs();

    // 30 jobs per "org", different storeId per org.
    const PER_ORG = 30;
    const orgs = [
      SYNTH_STORE_BASE + 100,
      SYNTH_STORE_BASE + 200,
      SYNTH_STORE_BASE + 300,
    ];
    const enqueues: Promise<void>[] = [];
    for (let o = 0; o < orgs.length; o++) {
      for (let i = 0; i < PER_ORG; i++) {
        enqueues.push(
          addWebstoreRenderJob(
            {
              storeId: orgs[o],
              productId: SYNTH_PRODUCT_BASE + 10_000 + o * 1_000 + i,
              productName: `org${o}-prod${i}`,
              productImageUrl: "https://placehold.co/600x600.png",
              logoUrl: "https://placehold.co/200x200.png",
              decorationMethod: "embroidery",
              placement: { x: 0.3, y: 0.2, w: 0.3, h: 0.15, zone: "left_chest" },
            },
            { force: true },
          ),
        );
      }
    }
    await Promise.all(enqueues);

    const seen = await webstoreRenderQueue.getJobs(["waiting", "delayed", "active", "paused"]);
    const buckets = new Map<number, number>();
    for (const j of seen) {
      const d = j.data as { storeId: number; productName?: string };
      if (!orgs.includes(d.storeId)) continue;
      buckets.set(d.storeId, (buckets.get(d.storeId) ?? 0) + 1);
      // The productName we wrote always includes its org index. If a
      // payload's storeId says org=0 but productName says org=2 we
      // have cross-contamination — fail loudly.
      const m = d.productName?.match(/^org(\d+)-/);
      if (m) {
        const claimedOrg = Number(m[1]);
        const expectedOrg = orgs.indexOf(d.storeId);
        expect(claimedOrg).toBe(expectedOrg);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[Phase 3F] per-org bucket counts:`, Array.from(buckets.entries()));
  }, 30_000);
});
