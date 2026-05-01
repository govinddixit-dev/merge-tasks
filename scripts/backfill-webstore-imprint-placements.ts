/**
 * scripts/backfill-webstore-imprint-placements.ts
 *
 * One-shot CLI to backfill placement analysis on products that came in via
 * supplier-sync paths (PSRESTful, SanMar) and therefore skipped Phase 5's
 * ingestion-time analysis hooks. The product schema's
 * webstore_placement_pending_idx supports the IS NULL scan.
 *
 * Usage:
 *   npx tsx scripts/backfill-webstore-imprint-placements.ts [options]
 *
 * Options:
 *   --limit N            Cap rows processed in one run (default: 100)
 *   --dry-run            Print candidates without invoking the analyzer
 *   --org N              Restrict to a specific organizationId
 *   --product-ids A,B,C  Restrict to specific product IDs (comma-separated).
 *                        The isNull(analyzedAt) filter still applies, so
 *                        already-analyzed IDs in the list are skipped (no
 *                        redundant re-analysis). Combines with --limit if
 *                        both are set.
 *
 * Cost: ~$0.01 per "ok" result (Anthropic Sonnet 4.6 vision, two stages).
 * Latency: ~12-15s per product, capped at concurrency 10. A 100-row batch
 * takes ~2-3 minutes wall-clock.
 *
 * Failure mode: products where vision fails (status="failed") leave
 * analyzedAt=NULL → the next run re-attempts. Matches the existing
 * recovery logic in webstore-imprint-placement.ts:431-434.
 */
import "dotenv/config";
import pLimit from "p-limit";
import { isNull, and, eq, inArray, sql } from "drizzle-orm";
import { getDb, getPool } from "../server/db";
import { products } from "../drizzle/schema";
import { runAnalysisAndPersist } from "../server/services/webstore-imprint-placement";
import { fanOutRenderForProduct } from "../server/services/webstore-render-orchestrator";
import { webstoreRenderQueue } from "../server/queue/webstore-render-queue";

function extractFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(extractFlag(args, "--limit") ?? "100", 10);
  const dryRun = args.includes("--dry-run");
  const orgFilter = extractFlag(args, "--org");
  const productIdsFlag = extractFlag(args, "--product-ids");

  if (Number.isNaN(limit) || limit <= 0) {
    console.error("--limit must be a positive integer");
    process.exit(1);
  }

  let productIds: number[] | undefined;
  if (productIdsFlag) {
    productIds = productIdsFlag.split(",").map(s => parseInt(s.trim(), 10));
    if (productIds.length === 0 || productIds.some(n => Number.isNaN(n) || n <= 0)) {
      console.error("--product-ids must be a comma-separated list of positive integers");
      process.exit(1);
    }
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable — check DATABASE_URL");

  const conditions = [isNull(products.webstoreImprintPlacementAnalyzedAt)];
  if (orgFilter) {
    const orgId = parseInt(orgFilter, 10);
    if (Number.isNaN(orgId)) {
      console.error("--org must be a numeric organizationId");
      process.exit(1);
    }
    conditions.push(eq(products.organizationId, orgId));
  }
  if (productIds) {
    conditions.push(inArray(products.id, productIds));
  }

  const candidates = await db
    .select({
      id: products.id,
      imageUrl: products.imageUrl,
      webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
      supplierCode: products.supplierCode,
      name: products.name,
    })
    .from(products)
    .where(and(...conditions))
    .limit(limit);

  console.log(`Found ${candidates.length} product(s) needing analysis (limit=${limit}${orgFilter ? `, org=${orgFilter}` : ""}${productIds ? `, ids=${productIds.join(",")}` : ""})`);

  if (candidates.length === 0) {
    console.log("Nothing to do.");
    await webstoreRenderQueue.close();
    await getPool()?.end();
    process.exit(0);
  }

  if (dryRun) {
    console.log("DRY RUN — no analysis calls will be made");
    candidates.forEach(p => {
      console.log(`  - product ${p.id} (imageUrl: ${p.imageUrl ? "present" : "null"}, source: ${p.webstoreImprintPlacementSource ?? "ai"})`);
    });
    await webstoreRenderQueue.close();
    await getPool()?.end();
    process.exit(0);
  }

  const startTime = Date.now();
  const concurrency = pLimit(10);
  const results = { ok: 0, skipped: 0, failed: 0 };
  // Admin-level: backfill runs server-side with no caller, so we explicitly
  // pass an always-true scope. The helper requires a scopeWhere arg to
  // prevent cross-tenant accidents from tRPC paths — we satisfy that
  // contract here without narrowing.
  const adminScope = sql`1=1`;
  const fanOutPromises: Array<Promise<void>> = [];

  await Promise.all(
    candidates.map(p =>
      concurrency(async () => {
        try {
          const result = await runAnalysisAndPersist(db, p, adminScope, false);
          results[result.status]++;
          if (result.status === "ok") {
            // Track the fan-out so we can drain before closing the queue.
            fanOutPromises.push(
              fanOutRenderForProduct(db, p.id).catch(err => {
                console.error(`fanOut failed for product ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
              }),
            );
          }
          const done = results.ok + results.skipped + results.failed;
          if (done % 50 === 0) {
            console.log(`Progress: ${done}/${candidates.length} (ok=${results.ok} skipped=${results.skipped} failed=${results.failed})`);
          }
        } catch (err) {
          results.failed++;
          console.error(`Product ${p.id} unexpected error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    ),
  );

  // Drain pending fan-outs before closing the queue connection — otherwise
  // late-arriving enqueues fail against a closed Redis client.
  await Promise.allSettled(fanOutPromises);

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const estimatedCost = (results.ok * 0.01).toFixed(2);
  console.log("\n=== Backfill complete ===");
  console.log(`  Processed: ${candidates.length}`);
  console.log(`  Success:   ${results.ok}`);
  console.log(`  Skipped:   ${results.skipped} (no_image, manual_override)`);
  console.log(`  Failed:    ${results.failed} (vision_failed or unexpected)`);
  console.log(`  Elapsed:   ${elapsedSec}s`);
  console.log(`  Est. cost: $${estimatedCost} (Sonnet 4.6 vision)`);

  await webstoreRenderQueue.close();
  await getPool()?.end();
  process.exit(0);
}

main().catch(err => {
  console.error("Backfill error:", err);
  process.exit(1);
});
