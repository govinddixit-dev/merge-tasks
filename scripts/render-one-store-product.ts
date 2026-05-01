/**
 * scripts/render-one-store-product.ts
 *
 * One-shot CLI to render a single storeProducts row using the LOCAL
 * working tree's nano-banana adapter. Bypasses the production worker
 * so we can validate prompt + model changes before merging — the worker
 * runs whatever code main is on, not the local branch.
 *
 * Mirrors webstore-render-worker.ts:processRenderJob:
 *   - looks up product, store, logo
 *   - resolves logoUrl with the same priority order
 *     (clientLogos.processedLogoUrl ?? clientLogos.logoUrl ?? store.logoUrl)
 *   - resolves decorationMethod via resolveDecorationMethod
 *   - calls renderProductWithLogo from server/services/nano-banana.ts
 *   - persists URL + status='complete' + modelUsed + decoration + renderedAt
 *
 * Usage:
 *   npx tsx scripts/render-one-store-product.ts --sp-id N [options]
 *
 * Options:
 *   --sp-id N      storeProducts row id (required)
 *   --dry-run      Print payload, skip the model call entirely
 *   --no-persist   Run the model call + S3 upload, skip the DB write.
 *                  Useful for "is the new prompt good?" validation
 *                  without mutating the binding row.
 *
 * Cost: ~$0.039 per render (Gemini 2.5 Flash Image).
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb, getPool } from "../server/db";
import { products, stores, storeProducts, clientLogos } from "../drizzle/schema";
import { renderProductWithLogo, type DecorationMethod } from "../server/services/nano-banana";
import { resolveDecorationMethod } from "../server/services/webstore-render-orchestrator";

function extractFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const spIdRaw = extractFlag(args, "--sp-id");
  const dryRun = args.includes("--dry-run");
  const noPersist = args.includes("--no-persist");

  if (!spIdRaw) {
    console.error("--sp-id is required");
    process.exit(1);
  }
  const spId = parseInt(spIdRaw, 10);
  if (Number.isNaN(spId) || spId <= 0) {
    console.error("--sp-id must be a positive integer");
    process.exit(1);
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable — check DATABASE_URL");

  const [sp] = await db
    .select({
      id: storeProducts.id,
      storeId: storeProducts.storeId,
      productId: storeProducts.productId,
      currentStatus: storeProducts.webstoreRenderStatus,
      currentUrl: storeProducts.webstoreRenderedImageUrl,
    })
    .from(storeProducts)
    .where(eq(storeProducts.id, spId))
    .limit(1);
  if (!sp) {
    console.error(`storeProducts row ${spId} not found`);
    process.exit(1);
  }

  const [product] = await db
    .select({
      id: products.id,
      name: products.name,
      category: products.category,
      imageUrl: products.imageUrl,
      decorationMethods: products.decorationMethods,
      x: products.webstoreImprintPlacementX,
      y: products.webstoreImprintPlacementY,
      w: products.webstoreImprintPlacementWidth,
      h: products.webstoreImprintPlacementHeight,
      zone: products.webstoreImprintPlacementZone,
      analyzedAt: products.webstoreImprintPlacementAnalyzedAt,
    })
    .from(products)
    .where(eq(products.id, sp.productId))
    .limit(1);
  if (!product) {
    console.error(`product ${sp.productId} not found`);
    process.exit(1);
  }

  const [store] = await db
    .select({ id: stores.id, clientId: stores.clientId, logoUrl: stores.logoUrl })
    .from(stores)
    .where(eq(stores.id, sp.storeId))
    .limit(1);
  if (!store) {
    console.error(`store ${sp.storeId} not found`);
    process.exit(1);
  }

  const [logo] = await db
    .select({ processedLogoUrl: clientLogos.processedLogoUrl, logoUrl: clientLogos.logoUrl })
    .from(clientLogos)
    .where(eq(clientLogos.clientId, store.clientId))
    .orderBy(sql`${clientLogos.processedAt} DESC`)
    .limit(1);
  const logoUrl = logo?.processedLogoUrl ?? logo?.logoUrl ?? store.logoUrl;

  // Predicate check — same shape as enqueueRenderForStoreProduct's
  // isRenderReady, but inlined here so the script can print exactly
  // which input is missing rather than a generic "skipped".
  const missing: string[] = [];
  if (!product.imageUrl) missing.push("product.imageUrl");
  if (!product.analyzedAt) missing.push("product.analyzedAt");
  if (!product.zone) missing.push("product.zone");
  if (product.x == null) missing.push("product.x");
  if (product.y == null) missing.push("product.y");
  if (product.w == null) missing.push("product.w");
  if (product.h == null) missing.push("product.h");
  if (!logoUrl) missing.push("logoUrl");
  if (missing.length > 0) {
    console.error(`Cannot render sp=${spId}: missing inputs → ${missing.join(", ")}`);
    process.exit(1);
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
    productImageUrl: product.imageUrl!,
    logoUrl: logoUrl!,
    decorationMethod,
    placement: {
      x: Number(product.x),
      y: Number(product.y),
      w: Number(product.w),
      h: Number(product.h),
      zone: product.zone!,
    },
  };

  console.log("=== render payload ===");
  console.log(`  sp.id            ${sp.id}`);
  console.log(`  sp.storeId       ${sp.storeId}`);
  console.log(`  sp.productId     ${sp.productId}`);
  console.log(`  current status   ${sp.currentStatus ?? "(null)"}`);
  console.log(`  current url      ${sp.currentUrl ?? "(null)"}`);
  console.log(`  product.name     ${product.name}`);
  console.log(`  product.category ${product.category ?? "(null)"}`);
  console.log(`  productImageUrl  ${payload.productImageUrl}`);
  console.log(`  logoUrl          ${payload.logoUrl}`);
  console.log(`  decorationMethod ${payload.decorationMethod}`);
  console.log(`  placement.zone   ${payload.placement.zone}`);
  console.log(
    `  placement coords x=${payload.placement.x.toFixed(3)} y=${payload.placement.y.toFixed(3)} w=${payload.placement.w.toFixed(3)} h=${payload.placement.h.toFixed(3)}`,
  );

  if (dryRun) {
    console.log("\nDRY RUN — no model call will be made");
    await getPool()?.end();
    process.exit(0);
  }

  console.log("\nCalling renderProductWithLogo...");
  const startedAt = Date.now();
  const result = await renderProductWithLogo(payload, sp.productId);
  const elapsedMs = Date.now() - startedAt;

  if (!result.ok) {
    console.error(`\n=== render FAILED (${elapsedMs}ms) ===`);
    console.error(`  reason: ${result.reason}`);
    if (result.error) console.error(`  error:  ${result.error}`);
    await getPool()?.end();
    process.exit(1);
  }

  console.log(`\n=== render OK (${elapsedMs}ms) ===`);
  console.log(`  url        ${result.url}`);
  console.log(`  key        ${result.key}`);
  console.log(`  modelUsed  ${result.modelUsed}`);

  if (noPersist) {
    console.log("\n--no-persist set — skipping DB write. Binding row left untouched.");
    await getPool()?.end();
    process.exit(0);
  }

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
  console.log(`\nstoreProducts row ${sp.id} updated → status='complete', model=${result.modelUsed}`);

  await getPool()?.end();
  process.exit(0);
}

main().catch(err => {
  console.error("render-one-store-product error:", err);
  process.exit(1);
});
