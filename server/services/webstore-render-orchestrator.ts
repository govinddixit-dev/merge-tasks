/**
 * webstore-render-orchestrator.ts — Phase 5 hook helpers for the
 * nano-banana render pipeline.
 *
 * Three public helpers, all fire-and-forget (never throw, log only).
 * Hook sites:
 *   - storeProducts insert (storesCatalog, copilotExec/webstore) →
 *     enqueueRenderForStoreProduct
 *   - products UPDATE on rendering-relevant columns →
 *     fanOutRenderForProduct
 *   - stores UPDATE on logoUrl →
 *     flagPendingForStoreLogoChange (5c path: bulk-flag, no immediate
 *     enqueue, backfill drains over time)
 *   - placement re-analysis (analyzeWebstoreImprintPlacement +
 *     analyzeWebstoreImprintPlacementBulk) → fanOutRenderForProduct
 *
 * SCOPE BOUNDARY: webstore-only. The decoration heuristic strings
 * below are duplicated from server/routers/proofing.ts deliberately —
 * proofing.ts is on the do-not-touch list (different pipeline, different
 * audience). Same decoupling rationale as DECORATION_PROMPTS in
 * nano-banana.ts.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { products, stores, storeProducts, clientLogos } from "../../drizzle/schema";
import { addWebstoreRenderJob, webstoreRenderQueue } from "../queue/webstore-render-queue";
import type { DecorationMethod } from "./nano-banana";
import type { getDb } from "../db";
import { getLogger } from "../utils/logger";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const log = getLogger("webstore-render-orchestrator");

/** 8-method enum from nano-banana — used to validate decorationMethods[0]. */
const VALID_METHODS: ReadonlySet<DecorationMethod> = new Set<DecorationMethod>([
  "embroidery", "screen_print", "laser_engraving", "heat_transfer",
  "dtg", "sublimation", "deboss", "patch",
]);

/**
 * Category → default decoration map. Copied from proofing.ts:31.
 * Do NOT import — the two pipelines are intentionally decoupled.
 */
const DECORATION_SUGGESTIONS: Record<string, DecorationMethod> = {
  apparel: "embroidery",
  drinkware: "laser_engraving",
  tech: "laser_engraving",
  bags: "screen_print",
  writing: "laser_engraving",
  wellness: "screen_print",
  outdoor: "screen_print",
  office: "deboss",
  other: "screen_print",
};

/**
 * Decoration method resolver. Priority:
 *   1. products.decorationMethods[0] if it's one of the 8 valid methods
 *   2. Name-based heuristic (polo → embroidery, t-shirt → dtg, etc.)
 *   3. Category-based default
 *   4. Fall back to "embroidery"
 *
 * Heuristic body duplicated from proofing.ts:suggestDecoration.
 * Exported so the integration test can validate the cascade.
 */
export function resolveDecorationMethod(
  decorationMethods: string[] | null,
  productName: string | null,
  category: string | null,
): DecorationMethod {
  if (decorationMethods && decorationMethods.length > 0) {
    const first = decorationMethods[0];
    if (VALID_METHODS.has(first as DecorationMethod)) return first as DecorationMethod;
  }
  const name = (productName ?? "").toLowerCase();
  if (name.includes("polo") || name.includes("sweater") || name.includes("jacket") || name.includes("hat") || name.includes("cap")) return "embroidery";
  if (name.includes("t-shirt") || name.includes("tee") || name.includes("hoodie")) return "dtg";
  if (name.includes("tumbler") || name.includes("flask") || name.includes("rambler") || name.includes("bottle")) return "laser_engraving";
  if (name.includes("mug") || name.includes("cup")) return "sublimation";
  if (name.includes("notebook") || name.includes("journal") || name.includes("planner")) return "deboss";
  if (name.includes("pen") || name.includes("stylus")) return "laser_engraving";
  if (name.includes("speaker") || name.includes("charger") || name.includes("power bank")) return "laser_engraving";
  if (name.includes("tote") || name.includes("backpack") || name.includes("duffel")) return "screen_print";
  return DECORATION_SUGGESTIONS[(category ?? "").toLowerCase()] ?? "embroidery";
}

/**
 * Phase 7 — customer-facing render display gate.
 *
 * Projects the storeProducts render columns to a single nullable URL the
 * webstore should show in the photoreal layer. Returns null when the
 * binding is unapproved, in which case WebstoreLogoOverlay falls back to
 * the CSS logo composite. Override beats AI render when both are present.
 *
 * Pure function so it can be unit-tested without touching the DB. Used
 * by storesCrud.getBySlug; do not call from the distributor-facing
 * renderManager router (distributors must see unapproved output).
 */
export function gateRenderUrlForWebstore(sp: {
  renderApproved: boolean;
  renderOverrideUrl: string | null;
  webstoreRenderedImageUrl: string | null;
}): string | null {
  if (!sp.renderApproved) return null;
  return sp.renderOverrideUrl ?? sp.webstoreRenderedImageUrl ?? null;
}

/**
 * Reasons enqueue can decline to queue a render. Discriminated against
 * EnqueueRenderResult so callers (notably retryRender) can map each
 * reason to a specific operator-facing error or follow-up action.
 */
export type EnqueueSkipReason =
  | "product_not_found"
  | "store_not_found"
  | "no_image"
  | "no_analysis"
  | "no_logo"
  | "internal_error";

export type EnqueueRenderResult =
  | { kind: "queued"; decorationMethod: DecorationMethod }
  | { kind: "skipped"; reason: EnqueueSkipReason };

/**
 * Enqueue a render job for a single (storeId, productId) pair.
 *
 * Predicate (all required for enqueue):
 *   - product.imageUrl IS NOT NULL
 *   - product placement coords analyzed (analyzedAt + zone + x/y/w/h)
 *   - logo resolvable (clientLogos.processedLogoUrl OR
 *     clientLogos.logoUrl OR stores.logoUrl, in that priority order)
 *
 * Returns a discriminated result. Skip cases are logged at debug —
 * Step 7 backfill picks rows up later when inputs arrive. Existing
 * fire-and-forget callers (assignProducts, fanOutRenderForProduct,
 * copilotExec) discard the return; retryRender consumes it to surface
 * the actual outcome to the operator.
 *
 * Never throws — internal errors are caught and returned as
 * { kind: "skipped", reason: "internal_error" }.
 */
export async function enqueueRenderForStoreProduct(
  db: Db,
  storeId: number,
  productId: number,
  options?: { force?: boolean; autoApprove?: { approvedBy: number } },
): Promise<EnqueueRenderResult> {
  try {
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
      .where(eq(products.id, productId))
      .limit(1);

    // Phase 7 — pull the distributor's per-binding prompt tweak (if any)
    // so it rides through to the worker. Read separately because the
    // adjustment lives on storeProducts, not products. Missing storeProduct
    // row would have already aborted enqueue at the upstream call site;
    // here we treat absence as "no adjustment" rather than fail.
    const [binding] = await db
      .select({
        promptAdjustment: storeProducts.renderPromptAdjustment,
        placementX:        storeProducts.renderPlacementX,
        placementY:        storeProducts.renderPlacementY,
        placementWidth:    storeProducts.renderPlacementWidth,
        placementHeight:   storeProducts.renderPlacementHeight,
        placementRotation: storeProducts.renderPlacementRotation,
      })
      .from(storeProducts)
      .where(
        sql`${storeProducts.storeId} = ${storeId} AND ${storeProducts.productId} = ${productId}`,
      )
      .limit(1);
    if (!product) {
      log.debug(`enqueue skipped: productId=${productId} not found`);
      return { kind: "skipped", reason: "product_not_found" };
    }

    const [store] = await db
      .select({ id: stores.id, clientId: stores.clientId, logoUrl: stores.logoUrl })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) {
      log.debug(`enqueue skipped: storeId=${storeId} not found`);
      return { kind: "skipped", reason: "store_not_found" };
    }

    // Logo resolution: prefer the client's processed (background-removed)
    // PNG over the raw uploaded logo. The processed asset is what the
    // render pipeline expects (transparent background, alpha-cleaned).
    // Final fallback to stores.logoUrl handles stores that have a banner-
    // style logo configured but no clientLogos row.
    const [logo] = await db
      .select({ processedLogoUrl: clientLogos.processedLogoUrl, logoUrl: clientLogos.logoUrl })
      .from(clientLogos)
      .where(eq(clientLogos.clientId, store.clientId))
      .orderBy(sql`${clientLogos.processedAt} DESC`)
      .limit(1);
    const logoUrl = logo?.processedLogoUrl ?? logo?.logoUrl ?? store.logoUrl;

    if (!product.imageUrl) {
      log.debug(`enqueue skipped: storeId=${storeId} productId=${productId} no_image`);
      return { kind: "skipped", reason: "no_image" };
    }
    if (
      !product.analyzedAt ||
      !product.zone ||
      product.x == null || product.y == null ||
      product.w == null || product.h == null
    ) {
      log.debug(`enqueue skipped: storeId=${storeId} productId=${productId} no_analysis`);
      return { kind: "skipped", reason: "no_analysis" };
    }
    if (!logoUrl) {
      log.debug(`enqueue skipped: storeId=${storeId} productId=${productId} no_logo`);
      return { kind: "skipped", reason: "no_logo" };
    }

    const decorationMethod = resolveDecorationMethod(
      product.decorationMethods,
      product.name,
      product.category,
    );

    // Manual text adjustment and manual placement coords ride separate
    // channels into the prompt. The text is free-form ("make it look more
    // embroidered") and goes through the adjustment block; the coords are
    // structured and need top-left-edge framing that a generic adjustment
    // wrapper can't provide, so they're emitted by buildPrompt as a
    // dedicated placement-override block at the very end of the prompt.
    const manualAdjustment = binding?.promptAdjustment ?? undefined;
    const manualPlacement =
      binding?.placementX != null
        ? {
            x:        Number(binding.placementX),
            y:        Number(binding.placementY ?? 0),
            width:    Number(binding.placementWidth ?? 0),
            height:   Number(binding.placementHeight ?? 0),
            rotation: Number(binding.placementRotation ?? 0),
          }
        : undefined;

    await addWebstoreRenderJob(
      {
        storeId,
        productId: product.id,
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
        promptAdjustment: manualAdjustment ?? undefined,
        manualPlacement,
        autoApprove: options?.autoApprove,
      },
      options?.force ? { force: true } : undefined,
    );
    log.info(`enqueued render: storeId=${storeId} productId=${productId} method=${decorationMethod}`);
    return { kind: "queued", decorationMethod };
  } catch (err) {
    log.warn(`enqueueRenderForStoreProduct(storeId=${storeId}, productId=${productId}) failed: ${(err as Error).message}`);
    return { kind: "skipped", reason: "internal_error" };
  }
}

/**
 * Catalog-side fan-out: when a product's render-relevant inputs change
 * (imageUrl, placement coordinates, decorationMethods), every
 * storeProducts row for that product needs a fresh render.
 *
 * Fire-and-forget: never throws. Sequential per-store enqueue keeps
 * DB connection use bounded; parallelism wouldn't help at typical
 * fan-out sizes (1-10 stores per product).
 */
export async function fanOutRenderForProduct(db: Db, productId: number): Promise<void> {
  try {
    const rows = await db
      .select({ storeId: storeProducts.storeId })
      .from(storeProducts)
      .where(eq(storeProducts.productId, productId));
    if (rows.length === 0) return;
    log.info(`fan-out: productId=${productId} → ${rows.length} storeProducts row(s)`);
    for (const row of rows) {
      await enqueueRenderForStoreProduct(db, row.storeId, productId);
    }
  } catch (err) {
    log.warn(`fanOutRenderForProduct(productId=${productId}) failed: ${(err as Error).message}`);
  }
}

// FUTURE-EXTENSION: this hook only watches stores.logoUrl. If a future
// product requirement makes stores.clientId mutable (e.g. distributor
// reassigning a store to a different client), the storesCrud.update
// caller at storesCrud.ts:743 must extend its predicate to also fire on
// clientId changes — a clientId change resolves to a different logo
// through clientLogos and invalidates every render on the store.
// Regression guard: server/storesCrud.clientIdImmutability.test.ts
// asserts clientId is NOT in the stores.update zod schema. When that
// test breaks, the hook coverage extension is required as part of the
// same PR.
/**
 * Logo-change propagation (5c path): when a store's logoUrl changes,
 * bulk-flag all that store's storeProducts rows as
 * webstoreRenderStatus='pending'. Step 6 overlay sees 'pending' and
 * renders the CSS fallback (which uses the fresh logoUrl), so customers
 * immediately see correct branding. Step 7 backfill drains 'pending'
 * rows over time, replacing CSS with photorealistic.
 *
 * Per-binding scope (post-0099): only this store's bindings are flagged.
 * Other stores that share the same product keep their renders intact.
 *
 * No render jobs are enqueued here — the queue would be flooded with
 * potentially thousands of jobs.
 *
 * Fire-and-forget: never throws.
 */
export async function flagPendingForStoreLogoChange(db: Db, storeId: number): Promise<void> {
  try {
    const result = await db
      .update(storeProducts)
      .set({ webstoreRenderStatus: "pending" })
      .where(eq(storeProducts.storeId, storeId));
    const affected = (result as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
    log.info(`logo change: storeId=${storeId} flagged ${affected} storeProducts row(s) as pending`);
  } catch (err) {
    log.warn(`flagPendingForStoreLogoChange(storeId=${storeId}) failed: ${(err as Error).message}`);
  }
}

/**
 * Worker-boot orphan reconciliation: storeProducts rows found in
 * `webstoreRenderStatus='rendering'` at worker startup that have NO
 * corresponding live BullMQ job (active / waiting / delayed / paused)
 * are orphans — the worker died mid-render and nothing will ever
 * complete them. Flip those to `'failed'` so the distributor's Render
 * Manager can re-render. Rows that DO have a live queue job are left
 * alone — a healthy worker is just slow, not stuck.
 *
 * Single-column update — webstoreRenderedImageUrl / webstoreRenderedAt
 * / webstoreRenderDecoration / webstoreRenderModel are intentionally
 * preserved so a prior render remains a valid customer-facing fallback
 * while the next render is queued.
 *
 * Returns the count of rows reconciled. Caller wraps in try/catch and
 * decides whether to fail the boot or warn-and-continue (worker boot
 * uses warn-and-continue: cleanup of historical orphans must not block
 * processing of new jobs).
 *
 * Failure modes:
 *   - DB error on SELECT/UPDATE: propagates to caller (worker entry
 *     warn-and-continues). Same idiom as before this upgrade.
 *   - Queue.getJobs() throws (Redis hiccup): propagates. Better to
 *     skip reconciliation than to incorrectly clobber active jobs by
 *     falling back to the old "reset all rendering rows" behavior.
 *     A subsequent worker boot will retry once Redis is healthy.
 */
export async function reconcileOrphanRenderingRows(db: Db): Promise<number> {
  const renderingRows = await db
    .select({
      id: storeProducts.id,
      storeId: storeProducts.storeId,
      productId: storeProducts.productId,
    })
    .from(storeProducts)
    .where(eq(storeProducts.webstoreRenderStatus, "rendering"));

  if (renderingRows.length === 0) {
    log.info("reconcileOrphanRenderingRows: no orphan 'rendering' rows found");
    return 0;
  }

  // Pull every job that could legitimately still complete. 'active' is
  // a job currently being processed by a worker; 'waiting'/'delayed'/
  // 'paused' are queued but not yet started. Anything in 'completed'
  // or 'failed' is by definition not in flight.
  const liveJobs = await webstoreRenderQueue.getJobs([
    "active", "waiting", "delayed", "paused",
  ]);
  const liveKeys = new Set<string>();
  for (const job of liveJobs) {
    const data = job?.data as { storeId?: number; productId?: number } | undefined;
    if (data && typeof data.storeId === "number" && typeof data.productId === "number") {
      liveKeys.add(`${data.storeId}-${data.productId}`);
    }
  }

  const trueOrphanIds = renderingRows
    .filter(r => !liveKeys.has(`${r.storeId}-${r.productId}`))
    .map(r => r.id);

  if (trueOrphanIds.length === 0) {
    log.info(
      `reconcileOrphanRenderingRows: ${renderingRows.length} 'rendering' row(s) all have live queue jobs — none reconciled`,
    );
    return 0;
  }

  await db
    .update(storeProducts)
    .set({ webstoreRenderStatus: "failed" })
    .where(inArray(storeProducts.id, trueOrphanIds));

  log.warn(
    `reconcileOrphanRenderingRows: flipped ${trueOrphanIds.length}/${renderingRows.length} orphan row(s) → failed (no live queue job; likely worker death during prior render)`,
  );
  return trueOrphanIds.length;
}
