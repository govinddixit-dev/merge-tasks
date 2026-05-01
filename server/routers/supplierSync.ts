import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { suppliers, supplierSyncJobs, supplierCostChangeLog, masterProductPricing, products } from "../../drizzle/schema";
import { getOrgScope } from "../utils/orgScope";
import { runSupplierSync } from "../integrations/supplierSyncEngine";
import { psRestfulService } from "../integrations/PSRestfulService";
import { SanMarInventoryService, sanMarInventoryService } from "../integrations/SanMarInventoryService";
import { resolveSanMarCredentials } from "../integrations/sanMarCredentialResolver";
import { runSanMarBulkSyncForSupplier } from "../jobs/sanMarBulkSync";

export const supplierSyncRouter = router({

  /**
   * Trigger a manual sync for a supplier.
   */
  triggerSync: protectedProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
      productIds: z.array(z.number().int().positive()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.supplierId), scope.suppliers))
        .limit(1);

      if (!supplier) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" });
      if (!supplier.psRestfulCode) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Supplier has no PSRESTful code configured. Add the supplier code in supplier settings first." });

      const result = await runSupplierSync({
        supplierId: input.supplierId,
        organizationId: scope.organizationId!,
        userId: ctx.user.id,
        trigger: "manual",
        productIds: input.productIds,
      });

      return result;
    }),

  /**
   * List sync job history for a supplier.
   */
  listJobs: protectedProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      return db
        .select()
        .from(supplierSyncJobs)
        .where(and(
          eq(supplierSyncJobs.supplierId, input.supplierId),
          eq(supplierSyncJobs.organizationId, scope.organizationId!),
        ))
        .orderBy(desc(supplierSyncJobs.createdAt))
        .limit(input.limit);
    }),

  /**
   * List recent cost changes for a supplier.
   */
  listCostChanges: protectedProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      return db
        .select({
          id: supplierCostChangeLog.id,
          productId: supplierCostChangeLog.productId,
          variantKey: supplierCostChangeLog.variantKey,
          previousCostCents: supplierCostChangeLog.previousCostCents,
          newCostCents: supplierCostChangeLog.newCostCents,
          currency: supplierCostChangeLog.currency,
          createdAt: supplierCostChangeLog.createdAt,
        })
        .from(supplierCostChangeLog)
        .where(eq(supplierCostChangeLog.supplierId, input.supplierId))
        .orderBy(desc(supplierCostChangeLog.createdAt))
        .limit(input.limit);
    }),

  /**
   * Update a supplier's PSRESTful code — empty/null clears it and disables sync.
   */
  updatePsRestfulCode: protectedProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
      psRestfulCode: z.string().max(64).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      await db.update(suppliers)
        .set({ psRestfulCode: input.psRestfulCode })
        .where(and(eq(suppliers.id, input.supplierId), scope.suppliers));
      return { success: true };
    }),

  /**
   * Get current supplier costs for a product (from masterProductPricing).
   */
  getProductCosts: protectedProcedure
    .input(z.object({
      productId: z.number().int().positive(),
      supplierId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      return db
        .select()
        .from(masterProductPricing)
        .where(and(
          eq(masterProductPricing.productId, input.productId),
          eq(masterProductPricing.supplierId, input.supplierId),
          eq(masterProductPricing.isActive, true),
        ))
        .orderBy(masterProductPricing.minQty);
    }),

  /**
   * One-shot catalog import from PSRESTful. For each product in the
   * supplier's catalog: match by externalId, update name/imageUrl if it
   * already exists in the distributor's catalog, or insert a new product
   * row otherwise. Does not fetch pricing — that's what triggerSync is for.
   */
  importCatalog: protectedProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.supplierId), scope.suppliers))
        .limit(1);

      if (!supplier) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" });
      if (!supplier.psRestfulCode) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Supplier has no PSRESTful code configured." });

      const psContext = { organizationId: scope.organizationId ?? undefined };
      const psProducts = await psRestfulService.getProducts(supplier.psRestfulCode, psContext);

      if (psProducts.length === 0) {
        return { imported: 0, updated: 0, message: "No products found for this supplier in PSRESTful." };
      }

      let imported = 0;
      let updated = 0;

      // ── DO NOT add webstore-imprint-placement vision calls here. ──
      // PSRESTful catalog imports can move thousands of products per
      // sync (full-supplier ingest mode). Triggering Claude vision
      // per row would burn Anthropic quota and add minutes of latency
      // to every sync. The Phase 8 backfill script
      // (scripts/backfill-webstore-imprint-placements.ts) handles
      // these on its own throttled schedule. See the SCOPE BOUNDARY
      // block at the top of server/services/webstore-imprint-placement.ts.
      for (const p of psProducts) {
        const [existing] = await db
          .select({ id: products.id })
          .from(products)
          .where(and(
            eq(products.externalId, p.productId),
            scope.products,
          ))
          .limit(1);

        if (existing) {
          await db.update(products)
            .set({
              name: p.productName,
              imageUrl: p.imageUrl ?? null,
              supplierCode: supplier.normalizedName,
            })
            .where(eq(products.id, existing.id));
          updated++;
        } else {
          await db.insert(products).values({
            userId: ctx.user.id,
            organizationId: scope.organizationId ?? null,
            name: p.productName,
            description: p.description ?? null,
            sku: p.productId,
            externalId: p.productId,
            supplierCode: supplier.normalizedName,
            imageUrl: p.imageUrl ?? null,
            // p.categoryName is a free-text string from PSRESTful and
            // doesn't map cleanly to our fixed category enum. Leave it
            // unset rather than forcing every import into "other".
            basePrice: "0.00",
            // Products.source enum does not include "psrestful"; PSRestful
            // is a PromoStandards REST wrapper so we tag it accordingly.
            source: "promostandards",
          });
          imported++;
        }
      }

      return { imported, updated, message: `${imported} products imported, ${updated} updated from PSRESTful.` };
    }),

  /**
   * Manual trigger for SanMar Canada Bulk Data sync.
   *
   * For testing / on-demand use — the production path is the nightly cron
   * in agentCron.ts (SanMar's bulk endpoint is rate-limited to one call
   * per day per credential, so don't hammer this).
   */
  triggerSanMarBulkSync: protectedProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.supplierId), scope.suppliers))
        .limit(1);

      if (!supplier) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" });
      if (supplier.normalizedName !== "sanmar") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "SanMar bulk sync only runs against the SanMar supplier (normalizedName='sanmar').",
        });
      }
      if (!process.env.SANMAR_ACCOUNT_ID || !process.env.SANMAR_PASSWORD) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "SANMAR_ACCOUNT_ID and SANMAR_PASSWORD must be set in the server environment.",
        });
      }

      const result = await runSanMarBulkSyncForSupplier({
        id: supplier.id,
        userId: supplier.userId,
        organizationId: supplier.organizationId,
        normalizedName: supplier.normalizedName,
      });

      return {
        ...result,
        message: `${result.imported} products imported, ${result.updated} updated, ${result.skipped} skipped from SanMar Canada bulk feed.`,
      };
    }),

  /**
   * Live inventory lookup for a SanMar style. Hits the PromoStandards
   * Inventory 2.0.0 SOAP endpoint each call — there is no caching here, so
   * callers should debounce / not poll.
   */
  getSanMarInventory: protectedProcedure
    .input(z.object({
      productSku: z.string().min(1).max(64),
    }))
    .query(async ({ ctx, input }) => {
      // Resolve credentials in priority order: per-org row in
      // supplierCredentials, then platform env vars. Singleton is retained
      // for backwards compatibility but isn't used on this path.
      void sanMarInventoryService;
      const creds = await resolveSanMarCredentials(ctx.organizationId);
      if (!creds) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No SanMar credentials configured. Save them in Settings → Integrations, or ask the platform operator to set SANMAR_ACCOUNT_ID / SANMAR_PASSWORD.",
        });
      }

      try {
        const service = new SanMarInventoryService({
          accountId: creds.accountId,
          password: creds.password,
        });
        const inventory = await service.getInventoryLevels(input.productSku);
        return inventory;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `SanMar inventory lookup failed: ${msg}`,
        });
      }
    }),
});
