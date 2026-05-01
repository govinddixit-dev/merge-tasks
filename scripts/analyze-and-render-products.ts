/**
 * scripts/analyze-and-render-products.ts
 *
 * One-shot CLI to analyze + render a list of products inline, using the
 * LOCAL working tree's nano-banana adapter. Bypasses the production
 * worker queue entirely so we can ship new prompt + model output to
 * specific products before the worker is bounced onto new code.
 *
 * Per product:
 *   1. Load product row.
 *   2. If webstoreImprintPlacementAnalyzedAt IS NULL → runAnalysisAndPersist
 *      (Sonnet vision; ~$0.01). Skip the rest on failure or skip status.
 *   3. SELECT all storeProducts rows binding the product to a store.
 *   4. For each sp row → renderProductWithLogo (Gemini; ~$0.039) →
 *      UPDATE storeProducts on success/failure.
 *
 * No queue interaction: renders happen in-process so the LOCAL working
 * tree code runs, not whatever the production worker was started with.
 *
 * Usage:
 *   npx tsx scripts/analyze-and-render-products.ts --product-ids A,B,C [options]
 *
 * Options:
 *   --product-ids A,B,C  Comma-separated product IDs (required)
 *   --org N              Restrict to a specific organizationId
 *   --dry-run            Print products + sp rows + payloads, no API calls
 *
 * Cost: ~$0.01 per analysis + ~$0.039 per sp-row render.
 */
import "dotenv/config";
import pLimit from "p-limit";
import { eq, sql, and } from "drizzle-orm";
import { getDb, getPool } from "../server/db";
import { products, stores, storeProducts, clientLogos } from "../drizzle/schema";
import { runAnalysisAndPersist } from "../server/services/webstore-imprint-placement";
import { renderProductWithLogo, type DecorationMethod } from "../server/services/nano-banana";
import { resolveDecorationMethod } from "../server/services/webstore-render-orchestrator";

function extractFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

type ProductRow = {
  id: number;
  name: string | null;
  category: string | null;
  imageUrl: string | null;
  decorationMethods: string[] | null;
  organizationId: number;
  webstoreImprintPlacementSource: "ai" | "distributor_override" | null;
  analyzedAt: Date | null;
  x: string | null;
  y: string | null;
  w: string | null;
  h: string | null;
  zone: string | null;
  supplierCode: string | null;
};

type SpRow = {
  id: number;
  storeId: number;
  productId: number;
};

type RenderStats = { ok: number; failed: number };

async function loadProduct(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, id: number): Promise<ProductRow | undefined> {
  const [row] = await db
    .select({
      id: products.id,
      name: products.name,
      category: products.category,
      imageUrl: products.imageUrl,
      decorationMethods: products.decorationMethods,
      organizationId: products.organizationId,
      webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
      analyzedAt: products.webstoreImprintPlacementAnalyzedAt,
      x: products.webstoreImprintPlacementX,
      y: products.webstoreImprintPlacementY,
      w: products.webstoreImprintPlacementWidth,
      h: products.webstoreImprintPlacementHeight,
      zone: products.webstoreImprintPlacementZone,
      supplierCode: products.supplierCode,
    })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return row;
}

async function resolveLogoUrl(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  storeId: number,
): Promise<{ logoUrl: string | null; storeRow: { id: number; clientId: number; logoUrl: string | null } | undefined }> {
  const [storeRow] = await db
    .select({ id: stores.id, clientId: stores.clientId, logoUrl: stores.logoUrl })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!storeRow) return { logoUrl: null, storeRow: undefined };
  const [logo] = await db
    .select({ processedLogoUrl: clientLogos.processedLogoUrl, logoUrl: clientLogos.logoUrl })
    .from(clientLogos)
    .where(eq(clientLogos.clientId, storeRow.clientId))
    .orderBy(sql`${clientLogos.processedAt} DESC`)
    .limit(1);
  return { logoUrl: logo?.processedLogoUrl ?? logo?.logoUrl ?? storeRow.logoUrl, storeRow };
}

async function main() {
  const args = process.argv.slice(2);
  const idsRaw = extractFlag(args, "--product-ids");
  const orgFilter = extractFlag(args, "--org");
  const dryRun = args.includes("--dry-run");

  if (!idsRaw) {
    console.error("--product-ids is required");
    process.exit(1);
  }
  const productIds = idsRaw.split(",").map(s => parseInt(s.trim(), 10));
  if (productIds.length === 0 || productIds.some(n => Number.isNaN(n) || n <= 0)) {
    console.error("--product-ids must be a comma-separated list of positive integers");
    process.exit(1);
  }

  let orgId: number | undefined;
  if (orgFilter) {
    orgId = parseInt(orgFilter, 10);
    if (Number.isNaN(orgId)) {
      console.error("--org must be a numeric organizationId");
      process.exit(1);
    }
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable — check DATABASE_URL");

  const startTime = Date.now();
  const concurrency = pLimit(5);
  const adminScope = sql`1=1`;

  const analysisStats = { ok: 0, skipped: 0, failed: 0, alreadyAnalyzed: 0 };
  const renderStats: RenderStats = { ok: 0, failed: 0 };
  const renderUrls: Array<{ productId: number; spId: number; url: string }> = [];
  let totalCostCents = 0;

  console.log(`Targeting ${productIds.length} product(s): ${productIds.join(", ")}${orgFilter ? ` (org=${orgFilter})` : ""}`);
  if (dryRun) console.log("DRY RUN — no analysis or render API calls will be made");

  await Promise.all(
    productIds.map(productId =>
      concurrency(async () => {
        let product = await loadProduct(db, productId);
        if (!product) {
          console.log(`  [${productId}] product not found — skip`);
          return;
        }
        if (orgId !== undefined && product.organizationId !== orgId) {
          console.log(`  [${productId}] org mismatch (have ${product.organizationId}, want ${orgId}) — skip`);
          return;
        }

        // 1) Analysis stage
        if (!product.analyzedAt) {
          if (dryRun) {
            console.log(`  [${productId}] DRY RUN: would analyze (placement is null)`);
          } else {
            const result = await runAnalysisAndPersist(
              db,
              {
                id: product.id,
                imageUrl: product.imageUrl,
                webstoreImprintPlacementSource: product.webstoreImprintPlacementSource,
                supplierCode: product.supplierCode,
                name: product.name,
              },
              adminScope,
              false,
            );
            analysisStats[result.status]++;
            if (result.status !== "ok") {
              console.log(`  [${productId}] analysis ${result.status}${result.reason ? ` (${result.reason})` : ""} — skipping render`);
              return;
            }
            totalCostCents += 1; // ~$0.01 per analysis
            // Re-load to get the freshly-persisted placement coords.
            product = await loadProduct(db, productId);
            if (!product) return;
          }
        } else {
          analysisStats.alreadyAnalyzed++;
          console.log(`  [${productId}] already analyzed at ${product.analyzedAt.toISOString()} — skip analysis`);
        }

        // 2) Find sp bindings for this product
        const spConditions = [eq(storeProducts.productId, productId)];
        const spRows: SpRow[] = await db
          .select({ id: storeProducts.id, storeId: storeProducts.storeId, productId: storeProducts.productId })
          .from(storeProducts)
          .where(and(...spConditions));
        if (spRows.length === 0) {
          console.log(`  [${productId}] no storeProducts bindings — skip render`);
          return;
        }
        console.log(`  [${productId}] ${spRows.length} sp binding(s)`);

        // 3) Render each sp row inline
        for (const sp of spRows) {
          const { logoUrl, storeRow } = await resolveLogoUrl(db, sp.storeId);
          if (!storeRow) {
            console.log(`    sp=${sp.id} store=${sp.storeId} not found — skip`);
            if (!dryRun) renderStats.failed++;
            continue;
          }
          // Re-check placement readiness on the (possibly just-analyzed) product.
          // In dry-run we never analyzed, so unanalyzed products will fail this
          // check — that's expected, print a stub and move on without tallying
          // it as a render failure.
          const placementMissing =
            !product.imageUrl || !product.analyzedAt || !product.zone ||
            product.x == null || product.y == null || product.w == null || product.h == null;
          if (placementMissing) {
            if (dryRun) {
              console.log(`    sp=${sp.id} store=${sp.storeId} DRY RUN: would render after analysis populates placement`);
            } else {
              console.log(`    sp=${sp.id} product missing render inputs — skip`);
              renderStats.failed++;
            }
            continue;
          }
          if (!logoUrl) {
            console.log(`    sp=${sp.id} no logo for store ${sp.storeId} (clientId=${storeRow.clientId}) — skip`);
            if (!dryRun) renderStats.failed++;
            continue;
          }

          const decorationMethod: DecorationMethod = resolveDecorationMethod(
            product.decorationMethods,
            product.name,
            product.category,
          );
          const payload = {
            storeId: sp.storeId,
            productId: sp.productId,
            productName: product.name ?? undefined,
            productImageUrl: product.imageUrl,
            logoUrl,
            decorationMethod,
            placement: {
              x: Number(product.x),
              y: Number(product.y),
              w: Number(product.w),
              h: Number(product.h),
              zone: product.zone,
            },
          };

          if (dryRun) {
            console.log(`    sp=${sp.id} DRY RUN: store=${sp.storeId} method=${decorationMethod} zone=${payload.placement.zone} coords=(${payload.placement.x.toFixed(3)},${payload.placement.y.toFixed(3)},${payload.placement.w.toFixed(3)},${payload.placement.h.toFixed(3)}) logo=${logoUrl.slice(0, 70)}...`);
            continue;
          }

          const result = await renderProductWithLogo(payload, sp.productId);
          if (!result.ok) {
            renderStats.failed++;
            console.log(`    sp=${sp.id} render FAILED: reason=${result.reason}${result.error ? ` error=${result.error}` : ""}`);
            await db
              .update(storeProducts)
              .set({ webstoreRenderStatus: "failed" })
              .where(eq(storeProducts.id, sp.id));
            continue;
          }
          renderStats.ok++;
          totalCostCents += 4; // ~$0.039 per render, rounded
          renderUrls.push({ productId: sp.productId, spId: sp.id, url: result.url });
          await db
            .update(storeProducts)
            .set({
              webstoreRenderedImageUrl: result.url,
              webstoreRenderedAt: new Date(),
              webstoreRenderDecoration: payload.decorationMethod,
              webstoreRenderStatus: "complete",
              webstoreRenderModel: result.modelUsed,
            })
            .where(eq(storeProducts.id, sp.id));
          console.log(`    sp=${sp.id} render OK ${result.durationMs}ms model=${result.modelUsed} → ${result.url}`);
        }
      }),
    ),
  );

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== Summary ===");
  console.log(`  Products targeted:  ${productIds.length}`);
  console.log(`  Analysis: ok=${analysisStats.ok} skipped=${analysisStats.skipped} failed=${analysisStats.failed} alreadyAnalyzed=${analysisStats.alreadyAnalyzed}`);
  console.log(`  Renders:  ok=${renderStats.ok} failed=${renderStats.failed}`);
  console.log(`  Elapsed:  ${elapsedSec}s`);
  console.log(`  Est. cost: $${(totalCostCents / 100).toFixed(2)}`);

  if (renderUrls.length > 0) {
    console.log("\nRendered URLs:");
    for (const r of renderUrls) {
      console.log(`  productId=${r.productId} spId=${r.spId} → ${r.url}`);
    }
  }

  await getPool()?.end();
  process.exit(0);
}

main().catch(err => {
  console.error("analyze-and-render-products error:", err);
  process.exit(1);
});
