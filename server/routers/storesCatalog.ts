/**
 * storesCatalog — Product assignment, banner upload, and product management.
 *
 * Procedures: assignProducts, uploadBanner, removeProduct, updateStoreProduct
 */
import { z } from "zod";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { stores, storeProducts, products, type InsertStoreProduct } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { getOrgScope } from "../utils/orgScope";
import { enqueueRenderForStoreProduct, fanOutRenderForProduct } from "../services/webstore-render-orchestrator";
import { runAnalysisAndPersist } from "../services/webstore-imprint-placement";
import { attachStyleGroupToStore, detachStyleGroupFromStore } from "../services/storeProductAttach";
import { getLogger } from "../utils/logger";

const log = getLogger("storesCatalog");

export const storesCatalogRouter = router({
  assignProducts: protectedProcedure
    .input(
      z.object({
        storeId: z.number(),
        products: z.array(
          z.object({
            productId: z.number(),
            customPrice: z.string().optional(),
            featured: z.boolean().optional(),
            sortOrder: z.number().optional(),
            // Empty array or omitted = visible to all divisions (default).
            divisionIds: z.array(z.number()).optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const storeRows = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      // Destructive replace, not append: input.products becomes the store's
      // full product set. Any prior bindings for this store are wiped first.
      await db.delete(storeProducts).where(eq(storeProducts.storeId, input.storeId));

      if (input.products.length > 0) {
        const values: InsertStoreProduct[] = input.products.map((p, i) => ({
          storeId: input.storeId,
          productId: p.productId,
          customPrice: p.customPrice ?? null,
          featured: p.featured ?? false,
          sortOrder: p.sortOrder ?? i,
          divisionIds: p.divisionIds && p.divisionIds.length > 0 ? p.divisionIds : null,
        }));
        await db.insert(storeProducts).values(values);

        // Lazy placement-analysis hook: products imported via supplier-sync
        // (PSRESTful, SanMar) skip Phase 5's ingestion-time analysis by
        // design — the volume is too high. When such a product gets bound
        // to a store, that's the moment we know the analysis cost is
        // justified. Fire analysis here; on success, fanOutRenderForProduct
        // enqueues renders across every storeProducts row for the product.
        // The enqueue loop below still fires for completeness (idempotent
        // with the fan-out — predicate gates duplicates).
        const newIds = input.products.map(p => p.productId);
        const unanalyzed = await db
          .select({
            id: products.id,
            imageUrl: products.imageUrl,
            webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
            supplierCode: products.supplierCode,
            name: products.name,
          })
          .from(products)
          .where(and(
            inArray(products.id, newIds),
            isNull(products.webstoreImprintPlacementAnalyzedAt),
            scope.products,
          ));
        for (const p of unanalyzed) {
          void runAnalysisAndPersist(db, p, scope.products, false)
            .then(result => {
              if (result.status === "ok") {
                void fanOutRenderForProduct(db, p.id);
              }
            })
            .catch(err => {
              log.warn(`assignProducts lazy analysis failed for product ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        if (unanalyzed.length > 0) {
          log.info(`assignProducts: queued ${unanalyzed.length} product(s) for placement analysis`);
        }

        // Fire-and-forget: enqueue a render per newly-added storeProduct.
        // The orchestrator validates the predicate (placement analyzed,
        // logo available); skips silently if not ready.
        for (const p of input.products) {
          void enqueueRenderForStoreProduct(db, input.storeId, p.productId);
        }
      }

      return { success: true, count: input.products.length };
    }),

  uploadBanner: protectedProcedure
    .input(
      z.object({
        fileName: z.string(),
        mimeType: z.string(),
        base64Data: z.string(),
        storeId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowedTypes.includes(input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported image format. Allowed: JPEG, PNG, WebP, GIF" });
      }
      const buffer = Buffer.from(input.base64Data, "base64");
      const ext = input.fileName.split(".").pop() || "png";
      const fileKey = `store-banners/${ctx.user.id}/${nanoid()}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      if (input.storeId) {
        const db = await getDb();
        const scope = getOrgScope(ctx);
        if (db) {
          await db
            .update(stores)
            .set({ bannerUrl: url })
            .where(and(eq(stores.id, input.storeId), scope.stores));
        }
      }
      return { url };
    }),

  removeProduct: protectedProcedure
    .input(z.object({ storeId: z.number(), productId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const storeRows = await db.select().from(stores).where(and(eq(stores.id, input.storeId), scope.stores)).limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      await db.delete(storeProducts).where(
        and(eq(storeProducts.storeId, input.storeId), eq(storeProducts.productId, input.productId))
      );
      return { success: true };
    }),

  /**
   * Phase 8 — variant-aware add. Attaches every variant in a styleGroup
   * to the store; auto-renders only the primary (lazy fan-out, see
   * services/storeProductAttach.ts). Idempotent.
   */
  addStyleGroup: protectedProcedure
    .input(z.object({ storeId: z.number(), styleGroup: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const storeRows = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.id, input.storeId), scope.stores)).limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      return attachStyleGroupToStore(db, input.storeId, input.styleGroup, scope.products);
    }),

  /**
   * Phase 8 — symmetric to addStyleGroup. Removes every variant of a
   * group from the store. Idempotent — removes whatever is present.
   */
  removeStyleGroup: protectedProcedure
    .input(z.object({ storeId: z.number(), styleGroup: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const storeRows = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.id, input.storeId), scope.stores)).limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      return detachStyleGroupFromStore(db, input.storeId, input.styleGroup, scope.products);
    }),

  /**
   * Append-only counterpart to assignProducts. Adds the given productIds
   * to the store as new storeProducts rows, leaving every existing
   * binding untouched. Already-bound productIds are silently skipped.
   *
   * Used by the per-product detail page so the operator can drop a
   * single not-yet-assigned color variant into the store without
   * wiping the rest of the catalog.
   *
   * Optionally enqueues a render for each newly-added binding when
   * `enqueueRender` is true. Render queueing here mirrors the lazy
   * analysis hook in assignProducts: if placement isn't analyzed yet,
   * analysis fires first and fan-out enqueues renders on success.
   */
  addStoreProductVariants: protectedProcedure
    .input(
      z.object({
        storeId: z.number().int().positive(),
        productIds: z.array(z.number().int().positive()).min(1),
        enqueueRender: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const storeRows = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      // Already-bound productIds — skip these so the call is idempotent.
      const existing = await db
        .select({ productId: storeProducts.productId })
        .from(storeProducts)
        .where(and(
          eq(storeProducts.storeId, input.storeId),
          inArray(storeProducts.productId, input.productIds),
        ));
      const existingIds = new Set(existing.map(r => r.productId));
      const newIds = input.productIds.filter(id => !existingIds.has(id));

      if (newIds.length === 0) {
        return { added: 0, skipped: input.productIds.length };
      }

      // Confirm the new productIds belong to the operator's org before
      // inserting — keeps the FK insert from leaking cross-tenant rows.
      const owned = await db
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.id, newIds), scope.products));
      const ownedIds = new Set(owned.map(r => r.id));
      const insertable = newIds.filter(id => ownedIds.has(id));
      if (insertable.length === 0) {
        return { added: 0, skipped: input.productIds.length };
      }

      // Compute starting sortOrder so new rows append at the end.
      const sortRow = await db
        .select({ max: sql<number>`COALESCE(MAX(${storeProducts.sortOrder}), -1)` })
        .from(storeProducts)
        .where(eq(storeProducts.storeId, input.storeId));
      const startSort = (sortRow[0]?.max ?? -1) + 1;

      const values: InsertStoreProduct[] = insertable.map((productId, i) => ({
        storeId: input.storeId,
        productId,
        sortOrder: startSort + i,
      }));
      await db.insert(storeProducts).values(values);

      // Lazy placement-analysis hook (matches assignProducts).
      const unanalyzed = await db
        .select({
          id: products.id,
          imageUrl: products.imageUrl,
          webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
          supplierCode: products.supplierCode,
          name: products.name,
        })
        .from(products)
        .where(and(
          inArray(products.id, insertable),
          isNull(products.webstoreImprintPlacementAnalyzedAt),
          scope.products,
        ));
      for (const p of unanalyzed) {
        void runAnalysisAndPersist(db, p, scope.products, false)
          .then(result => {
            if (result.status === "ok") {
              void fanOutRenderForProduct(db, p.id);
            }
          })
          .catch(err => {
            log.warn(`addStoreProductVariants lazy analysis failed for product ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
          });
      }

      // Optional explicit render enqueue for already-analyzed products.
      // For unanalyzed ones, fanOutRenderForProduct above already covers it.
      if (input.enqueueRender) {
        const analyzedIds = insertable.filter(id =>
          !unanalyzed.find(u => u.id === id),
        );
        for (const productId of analyzedIds) {
          void enqueueRenderForStoreProduct(db, input.storeId, productId)
            .catch(err => {
              log.warn(`addStoreProductVariants render enqueue failed for product ${productId}: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
      }

      return {
        added: insertable.length,
        skipped: input.productIds.length - insertable.length,
      };
    }),

  updateStoreProduct: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      productId: z.number(),
      // null clears the override and reverts to the catalog basePrice.
      customPrice: z.string().nullable().optional(),
      featured: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      trackInventory: z.boolean().optional(),
      stockQuantity: z.number().int().nullable().optional(),
      // Empty array clears the restriction (visible to all divisions).
      divisionIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const storeRows = await db.select().from(stores).where(and(eq(stores.id, input.storeId), scope.stores)).limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      const setObj: Record<string, unknown> = {};
      if (input.customPrice !== undefined) setObj.customPrice = input.customPrice;
      if (input.featured !== undefined) setObj.featured = input.featured;
      if (input.sortOrder !== undefined) setObj.sortOrder = input.sortOrder;
      if (input.trackInventory !== undefined) setObj.trackInventory = input.trackInventory;
      if (input.stockQuantity !== undefined) setObj.stockQuantity = input.stockQuantity;
      if (input.divisionIds !== undefined) {
        setObj.divisionIds = input.divisionIds.length > 0 ? input.divisionIds : null;
      }
      if (Object.keys(setObj).length > 0) {
        await db.update(storeProducts).set(setObj).where(
          and(eq(storeProducts.storeId, input.storeId), eq(storeProducts.productId, input.productId))
        );
      }
      const updated = await db.select().from(storeProducts).where(
        and(eq(storeProducts.storeId, input.storeId), eq(storeProducts.productId, input.productId))
      ).limit(1);
      return updated[0] || null;
    }),

  retryRender: protectedProcedure
    .input(z.object({
      storeId: z.number().int().positive(),
      productId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const storeRows = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (storeRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }

      const bindingRows = await db
        .select({ id: storeProducts.id })
        .from(storeProducts)
        .where(and(
          eq(storeProducts.storeId, input.storeId),
          eq(storeProducts.productId, input.productId),
        ))
        .limit(1);
      if (bindingRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Product not in store" });
      }

      // Try to enqueue first; the result tells us exactly what's missing.
      // Status flip and any operator-facing message are conditional on the
      // outcome — no more speculative "pending" that strands the row.
      const result = await enqueueRenderForStoreProduct(db, input.storeId, input.productId);

      if (result.kind === "queued") {
        await db
          .update(storeProducts)
          .set({ webstoreRenderStatus: "pending" })
          .where(and(
            eq(storeProducts.storeId, input.storeId),
            eq(storeProducts.productId, input.productId),
          ));
        return { success: true, action: "queued" as const };
      }

      // no_analysis is recoverable in-band: kick off the same lazy
      // analyze + fan-out hook used by assignProducts. Operator gets
      // useful work, not a wall.
      if (result.reason === "no_analysis") {
        const [productRow] = await db
          .select({
            id: products.id,
            imageUrl: products.imageUrl,
            webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
            supplierCode: products.supplierCode,
            name: products.name,
          })
          .from(products)
          .where(and(eq(products.id, input.productId), scope.products))
          .limit(1);
        if (productRow) {
          void runAnalysisAndPersist(db, productRow, scope.products, false)
            .then(r => {
              if (r.status === "ok") {
                void fanOutRenderForProduct(db, productRow.id);
              }
            })
            .catch(err => {
              log.warn(`retryRender lazy analysis failed for product ${productRow.id}: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        return { success: true, action: "analyzing" as const };
      }

      const messageFor: Record<typeof result.reason, string> = {
        no_image: "Product has no source image to render onto.",
        no_logo: "No client logo configured for this store. Upload a logo on the client page first.",
        product_not_found: "Product not found.",
        store_not_found: "Store not found.",
        internal_error: "Could not enqueue render. Try again or contact support.",
      };
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messageFor[result.reason],
      });
    }),
});
