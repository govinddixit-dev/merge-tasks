/**
 * storeProductAttach.ts — variant-aware "add product to store" service.
 *
 * Phase 8 spec: when a distributor adds a product (or a styleGroup) to a
 * store, every variant in the group is materialized as a storeProducts
 * row, but only the **primary** variant is auto-rendered. Other variants
 * render lazily on first PDP view or via an explicit "render all colors"
 * action on the Renders tab.
 *
 * Lazy render is deliberate (Phase 8 Decision 2): a 459-variant family
 * (ATC EVERYDAY COTTON TEE) at $0.039/render = $18 per click if rendered
 * eagerly. Lazy is the responsible default.
 *
 * Idempotent: re-running for a group that's already attached is a no-op
 * (skip-existing) — the caller can fire this freely from the catalog grid
 * without worrying about duplicates.
 */
import { and, eq, inArray } from "drizzle-orm";
import { products, storeProducts } from "../../drizzle/schema";
import { enqueueRenderForStoreProduct } from "./webstore-render-orchestrator";
import { getLogger } from "../utils/logger";
import type { getDb } from "../db";

const log = getLogger("store-product-attach");

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface AttachResult {
  styleGroup: string;
  variantsConsidered: number;
  rowsInserted: number;
  rowsAlreadyAttached: number;
  primaryEnqueued: boolean;
}

/**
 * Attach every variant of a styleGroup to a store. Caller is expected to
 * have already verified store ownership.
 *
 * @param db          Drizzle connection
 * @param storeId     target store
 * @param styleGroup  canonical group key
 * @param scope       org-scope filter from getOrgScope(ctx).products
 */
export async function attachStyleGroupToStore(
  db: Db,
  storeId: number,
  styleGroup: string,
  scope: import("drizzle-orm").SQL,
): Promise<AttachResult> {
  // 1. Find every variant in the group, org-scoped.
  const groupRows = await db
    .select({
      id: products.id,
      isVariantPrimary: products.isVariantPrimary,
      imageUrl: products.imageUrl,
    })
    .from(products)
    .where(and(eq(products.styleGroup, styleGroup), scope));

  if (groupRows.length === 0) {
    return {
      styleGroup,
      variantsConsidered: 0,
      rowsInserted: 0,
      rowsAlreadyAttached: 0,
      primaryEnqueued: false,
    };
  }

  // 2. Find which of these are already bound to this store.
  const variantIds = groupRows.map(r => r.id);
  const existing = await db
    .select({ productId: storeProducts.productId })
    .from(storeProducts)
    .where(and(eq(storeProducts.storeId, storeId), inArray(storeProducts.productId, variantIds)));
  const existingIds = new Set(existing.map(e => e.productId));

  // 3. Insert the missing ones.
  const toInsert = groupRows.filter(r => !existingIds.has(r.id));
  if (toInsert.length > 0) {
    await db.insert(storeProducts).values(
      toInsert.map(r => ({
        storeId,
        productId: r.id,
        sortOrder: 0,
      })),
    );
  }

  // 4. Lazy render fan-out: only the primary variant gets enqueued.
  // Other variants render on demand. If the primary was already attached
  // (re-add scenario), skip — the prior render is still valid.
  const primary = groupRows.find(r => r.isVariantPrimary) ?? groupRows[0];
  const primaryNewlyAttached = !existingIds.has(primary.id);
  let primaryEnqueued = false;
  if (primaryNewlyAttached && primary.imageUrl) {
    void enqueueRenderForStoreProduct(db, storeId, primary.id);
    primaryEnqueued = true;
  }

  log.info(
    `attachStyleGroupToStore storeId=${storeId} group=${styleGroup} ` +
    `inserted=${toInsert.length} skipped=${existingIds.size} primaryEnqueued=${primaryEnqueued}`,
  );

  return {
    styleGroup,
    variantsConsidered: groupRows.length,
    rowsInserted: toInsert.length,
    rowsAlreadyAttached: existingIds.size,
    primaryEnqueued,
  };
}

/**
 * Detach every variant of a styleGroup from a store. Symmetric counterpart
 * to attach. Idempotent.
 */
export async function detachStyleGroupFromStore(
  db: Db,
  storeId: number,
  styleGroup: string,
  scope: import("drizzle-orm").SQL,
): Promise<{ rowsRemoved: number }> {
  const groupRows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.styleGroup, styleGroup), scope));
  if (groupRows.length === 0) return { rowsRemoved: 0 };

  const variantIds = groupRows.map(r => r.id);
  const result = await db
    .delete(storeProducts)
    .where(and(eq(storeProducts.storeId, storeId), inArray(storeProducts.productId, variantIds)));
  const rowsRemoved =
    (result as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;

  log.info(`detachStyleGroupFromStore storeId=${storeId} group=${styleGroup} removed=${rowsRemoved}`);
  return { rowsRemoved };
}
