/**
 * clientPricing.ts — Client Product Pricing Router
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD endpoints for the unified pricing engine tables:
 *   - clientProductConfig
 *   - clientProductPricingTiers
 *   - clientProductVariantUpcharges
 *   - clientProductOtherCosts
 *   - clientProductDecorationMethod
 *   - decorationMethods (read-only seed data)
 *
 * Also exposes the resolver for frontend price previews.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  clients,
  products,
  clientProductConfig,
  clientProductPricingTiers,
  clientProductVariantUpcharges,
  clientProductOtherCosts,
  clientProductDecorationMethod,
  decorationMethods,
  masterProductPricing,
} from "../../drizzle/schema";
import { resolvePricing } from "../utils/pricingResolver";
import { getOrgScope } from "../utils/orgScope";

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const pricingTierSchema = z.object({
  minQty: z.number().int().positive(),
  maxQty: z.number().int().positive().nullable(),
  unitPriceCents: z.number().int().nonnegative(),
});

const variantUpchargeSchema = z.object({
  variantKey: z.string().min(1),
  upchargeCents: z.number().int().nonnegative(),
});

const otherCostSchema = z.object({
  label: z.string().min(1).max(255),
  amountCents: z.number().int().nonnegative(),
  side: z.enum(["buying", "selling"]),
  sortOrder: z.number().int().default(0),
});

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export const clientPricingRouter = router({

  /**
   * Get or create the clientProductConfig for a client × product combination.
   * Returns the full pricing config including tiers, upcharges, other costs,
   * decoration method, and supplier cost reference.
   */
  getConfig: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      productId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Load or create config
      let [config] = await db
        .select()
        .from(clientProductConfig)
        .where(and(
          eq(clientProductConfig.clientId, input.clientId),
          eq(clientProductConfig.productId, input.productId),
          eq(clientProductConfig.isActive, true),
        ))
        .limit(1);

      if (!config) {
        // Return null — UI will show "no pricing configured" state
        return { config: null, tiers: [], upcharges: [], otherCosts: [], decoration: null, supplierCosts: [], fallbackUsed: true };
      }

      // Load all child records in parallel
      const [tiers, upcharges, otherCosts, decoration, supplierCosts] = await Promise.all([
        db.select().from(clientProductPricingTiers)
          .where(eq(clientProductPricingTiers.clientProductConfigId, config.id)),
        db.select().from(clientProductVariantUpcharges)
          .where(eq(clientProductVariantUpcharges.clientProductConfigId, config.id)),
        db.select().from(clientProductOtherCosts)
          .where(and(
            eq(clientProductOtherCosts.clientProductConfigId, config.id),
            eq(clientProductOtherCosts.isActive, true),
          )),
        db.select().from(clientProductDecorationMethod)
          .where(and(
            eq(clientProductDecorationMethod.clientProductConfigId, config.id),
            eq(clientProductDecorationMethod.isActive, true),
          ))
          .limit(1)
          .then(rows => rows[0] ?? null),
        db.select().from(masterProductPricing)
          .where(and(
            eq(masterProductPricing.productId, input.productId),
            eq(masterProductPricing.isActive, true),
          )),
      ]);

      return { config, tiers, upcharges, otherCosts, decoration, supplierCosts, fallbackUsed: tiers.length === 0 };
    }),

  /**
   * Save the full pricing config for a client × product in one transaction.
   * Creates config if not exists. Replaces tiers, upcharges, decoration.
   * Other costs are managed separately (addOtherCost / removeOtherCost).
   */
  saveConfig: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      productId: z.number().int().positive(),
      displayMode: z.enum(["itemize", "roll_into_unit"]),
      tiers: z.array(pricingTierSchema).min(1),
      upcharges: z.array(variantUpchargeSchema),
      decorationMethodId: z.number().int().positive().nullable(),
      setupFeeCents: z.number().int().nonnegative(),
      setupFeeMode: z.enum(["one_time", "per_order"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get or create config
      let [config] = await db
        .select()
        .from(clientProductConfig)
        .where(and(
          eq(clientProductConfig.clientId, input.clientId),
          eq(clientProductConfig.productId, input.productId),
        ))
        .limit(1);

      if (!config) {
        const [inserted] = await db
          .insert(clientProductConfig)
          .values({
            clientId: input.clientId,
            productId: input.productId,
            displayMode: input.displayMode,
            isActive: true,
          });
        const newConfigId = Number(inserted.insertId);
        const [newConfig] = await db
          .select()
          .from(clientProductConfig)
          .where(eq(clientProductConfig.id, newConfigId))
          .limit(1);
        config = newConfig;
      } else {
        await db
          .update(clientProductConfig)
          .set({ displayMode: input.displayMode })
          .where(eq(clientProductConfig.id, config.id));
      }

      if (!config) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create config" });

      // Replace tiers — delete all and re-insert
      await db.delete(clientProductPricingTiers)
        .where(eq(clientProductPricingTiers.clientProductConfigId, config.id));
      if (input.tiers.length > 0) {
        await db.insert(clientProductPricingTiers).values(
          input.tiers.map(t => ({
            clientProductConfigId: config.id,
            minQty: t.minQty,
            maxQty: t.maxQty,
            unitPriceCents: t.unitPriceCents,
          }))
        );
      }

      // Replace upcharges — delete all and re-insert
      await db.delete(clientProductVariantUpcharges)
        .where(eq(clientProductVariantUpcharges.clientProductConfigId, config.id));
      if (input.upcharges.length > 0) {
        await db.insert(clientProductVariantUpcharges).values(
          input.upcharges.map(u => ({
            clientProductConfigId: config.id,
            variantKey: u.variantKey,
            upchargeCents: u.upchargeCents,
          }))
        );
      }

      // Replace decoration method
      await db.delete(clientProductDecorationMethod)
        .where(eq(clientProductDecorationMethod.clientProductConfigId, config.id));
      if (input.decorationMethodId) {
        await db.insert(clientProductDecorationMethod).values({
          clientProductConfigId: config.id,
          decorationMethodId: input.decorationMethodId,
          setupFeeCents: input.setupFeeCents,
          setupFeeMode: input.setupFeeMode,
          isActive: true,
        });
      }

      return { success: true, configId: config.id };
    }),

  /**
   * Add a persistent other cost line item.
   */
  addOtherCost: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      productId: z.number().int().positive(),
      cost: otherCostSchema,
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [config] = await db
        .select()
        .from(clientProductConfig)
        .where(and(
          eq(clientProductConfig.clientId, input.clientId),
          eq(clientProductConfig.productId, input.productId),
        ))
        .limit(1);

      if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Pricing config not found. Save pricing first." });

      await db.insert(clientProductOtherCosts).values({
        clientProductConfigId: config.id,
        label: input.cost.label,
        amountCents: input.cost.amountCents,
        side: input.cost.side,
        sortOrder: input.cost.sortOrder,
        isActive: true,
      });

      return { success: true };
    }),

  /**
   * Soft-delete an other cost line item.
   */
  removeOtherCost: protectedProcedure
    .input(z.object({ costId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(clientProductOtherCosts)
        .set({ isActive: false })
        .where(eq(clientProductOtherCosts.id, input.costId));

      return { success: true };
    }),

  /**
   * Set (or clear) the default imprint zone for a client × product. Upserts
   * clientProductConfig; imprintZoneId=null clears the override.
   *
   * Scoped via the client row's org, since clientProductConfig itself has no
   * userId/organizationId columns — ownership flows through clientId.
   */
  setDefaultImprintZone: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      productId: z.number().int().positive(),
      imprintZoneId: z.number().int().positive().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify caller owns the client (org-scope enforcement)
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, input.clientId), scope.clients))
        .limit(1);
      if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      // Ensure clientProductConfig row exists
      const [existing] = await db
        .select()
        .from(clientProductConfig)
        .where(and(
          eq(clientProductConfig.clientId, input.clientId),
          eq(clientProductConfig.productId, input.productId),
        ))
        .limit(1);

      if (existing) {
        await db.update(clientProductConfig)
          .set({ defaultImprintZoneId: input.imprintZoneId })
          .where(eq(clientProductConfig.id, existing.id));
      } else {
        await db.insert(clientProductConfig).values({
          clientId: input.clientId,
          productId: input.productId,
          defaultImprintZoneId: input.imprintZoneId,
        });
      }
      return { success: true };
    }),

  /**
   * Clone the full pricing config (tiers, upcharges, decoration, other costs,
   * displayMode, defaultImprintZoneId) from one client to another for the same
   * product. Both source and target clients must belong to the caller's org.
   */
  copyFromClient: protectedProcedure
    .input(z.object({
      sourceClientId: z.number().int().positive(),
      targetClientId: z.number().int().positive(),
      productId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify caller owns both clients (org-scope enforcement via clients)
      const ownedClients = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(scope.clients));
      const ownedIds = new Set(ownedClients.map(c => c.id));
      if (!ownedIds.has(input.sourceClientId) || !ownedIds.has(input.targetClientId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }

      // Load source config
      const [sourceConfig] = await db.select().from(clientProductConfig)
        .where(and(eq(clientProductConfig.clientId, input.sourceClientId), eq(clientProductConfig.productId, input.productId)))
        .limit(1);
      if (!sourceConfig) throw new TRPCError({ code: "NOT_FOUND", message: "Source client has no pricing configured for this product." });

      const sourceTiers = await db.select().from(clientProductPricingTiers)
        .where(eq(clientProductPricingTiers.clientProductConfigId, sourceConfig.id));
      const sourceUpcharges = await db.select().from(clientProductVariantUpcharges)
        .where(eq(clientProductVariantUpcharges.clientProductConfigId, sourceConfig.id));
      const sourceDecoration = await db.select().from(clientProductDecorationMethod)
        .where(eq(clientProductDecorationMethod.clientProductConfigId, sourceConfig.id)).limit(1);
      const sourceOtherCosts = await db.select().from(clientProductOtherCosts)
        .where(eq(clientProductOtherCosts.clientProductConfigId, sourceConfig.id));

      // Upsert target config
      let targetConfig = await db.select().from(clientProductConfig)
        .where(and(eq(clientProductConfig.clientId, input.targetClientId), eq(clientProductConfig.productId, input.productId)))
        .limit(1).then(r => r[0]);

      if (targetConfig) {
        await db.update(clientProductConfig).set({
          displayMode: sourceConfig.displayMode,
          defaultImprintZoneId: sourceConfig.defaultImprintZoneId,
        }).where(eq(clientProductConfig.id, targetConfig.id));
      } else {
        const res = await db.insert(clientProductConfig).values({
          clientId: input.targetClientId,
          productId: input.productId,
          displayMode: sourceConfig.displayMode,
          defaultImprintZoneId: sourceConfig.defaultImprintZoneId,
        });
        targetConfig = { id: res[0].insertId } as typeof clientProductConfig.$inferSelect;
      }

      // Replace tiers
      await db.delete(clientProductPricingTiers).where(eq(clientProductPricingTiers.clientProductConfigId, targetConfig.id));
      if (sourceTiers.length > 0) {
        await db.insert(clientProductPricingTiers).values(sourceTiers.map(t => ({
          clientProductConfigId: targetConfig.id,
          minQty: t.minQty,
          maxQty: t.maxQty,
          unitPriceCents: t.unitPriceCents,
        })));
      }

      // Replace upcharges
      await db.delete(clientProductVariantUpcharges).where(eq(clientProductVariantUpcharges.clientProductConfigId, targetConfig.id));
      if (sourceUpcharges.length > 0) {
        await db.insert(clientProductVariantUpcharges).values(sourceUpcharges.map(u => ({
          clientProductConfigId: targetConfig.id,
          variantKey: u.variantKey,
          upchargeCents: u.upchargeCents,
        })));
      }

      // Replace decoration
      await db.delete(clientProductDecorationMethod).where(eq(clientProductDecorationMethod.clientProductConfigId, targetConfig.id));
      if (sourceDecoration[0]) {
        await db.insert(clientProductDecorationMethod).values({
          clientProductConfigId: targetConfig.id,
          decorationMethodId: sourceDecoration[0].decorationMethodId,
          setupFeeCents: sourceDecoration[0].setupFeeCents,
          setupFeeMode: sourceDecoration[0].setupFeeMode,
        });
      }

      // Replace other costs
      await db.delete(clientProductOtherCosts).where(eq(clientProductOtherCosts.clientProductConfigId, targetConfig.id));
      if (sourceOtherCosts.length > 0) {
        await db.insert(clientProductOtherCosts).values(sourceOtherCosts.map(c => ({
          clientProductConfigId: targetConfig.id,
          label: c.label,
          amountCents: c.amountCents,
          side: c.side,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
        })));
      }

      return { success: true };
    }),

  /**
   * Generate client pricing tiers from supplier cost tiers by applying a
   * markup rule. Replaces existing tiers on the clientProductConfig.
   *
   * Rule types:
   *   - percentage_markup: sell = cost * (1 + pct/100)
   *   - cost_multiplier:   sell = cost * multiplier
   *   - fixed_margin:      sell = cost / (1 - margin%/100)
   */
  applyMarkupRule: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      productId: z.number().int().positive(),
      supplierId: z.number().int().positive(),
      ruleType: z.enum(["percentage_markup", "cost_multiplier", "fixed_margin"]),
      ruleValue: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify ownership of the client and product
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, input.clientId), scope.clients))
        .limit(1);
      if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.productId), scope.products))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      // Load supplier cost tiers
      const costTiers = await db.select().from(masterProductPricing)
        .where(and(
          eq(masterProductPricing.productId, input.productId),
          eq(masterProductPricing.supplierId, input.supplierId),
          eq(masterProductPricing.isActive, true),
        ))
        .orderBy(masterProductPricing.minQty);

      if (costTiers.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "No supplier cost data found. Run a supplier sync first." });

      // Calculate sell prices per tier
      const sellTiers = costTiers.map(tier => {
        const cost = tier.unitCostCents;
        let sellPrice: number;
        if (input.ruleType === "percentage_markup") {
          sellPrice = Math.round(cost * (1 + input.ruleValue / 100));
        } else if (input.ruleType === "cost_multiplier") {
          sellPrice = Math.round(cost * input.ruleValue);
        } else {
          // fixed_margin: sell = cost / (1 - margin%)
          if (input.ruleValue >= 100) throw new TRPCError({ code: "BAD_REQUEST", message: "Margin cannot be 100% or more." });
          sellPrice = Math.round(cost / (1 - input.ruleValue / 100));
        }
        return {
          minQty: tier.minQty ?? 1,
          maxQty: tier.maxQty,
          unitPriceCents: sellPrice,
        };
      });

      // Upsert clientProductConfig
      let config = await db.select().from(clientProductConfig)
        .where(and(eq(clientProductConfig.clientId, input.clientId), eq(clientProductConfig.productId, input.productId)))
        .limit(1).then(r => r[0]);

      if (!config) {
        const res = await db.insert(clientProductConfig).values({
          clientId: input.clientId,
          productId: input.productId,
        });
        config = { id: res[0].insertId } as typeof clientProductConfig.$inferSelect;
      }

      // Replace tiers
      await db.delete(clientProductPricingTiers).where(eq(clientProductPricingTiers.clientProductConfigId, config.id));
      await db.insert(clientProductPricingTiers).values(sellTiers.map(t => ({
        clientProductConfigId: config.id,
        minQty: t.minQty,
        maxQty: t.maxQty,
        unitPriceCents: t.unitPriceCents,
      })));

      return { success: true, tiersGenerated: sellTiers.length };
    }),

  /**
   * List clients in the caller's org that already have a pricing config for
   * the given product. Used by the "Copy from Client" dropdown.
   */
  listClientsWithPricing: protectedProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const scope = getOrgScope(ctx);

      const rows = await db
        .select({ clientId: clientProductConfig.clientId, companyName: clients.companyName })
        .from(clientProductConfig)
        .innerJoin(clients, eq(clients.id, clientProductConfig.clientId))
        .where(and(eq(clientProductConfig.productId, input.productId), scope.clients))
        .orderBy(clients.companyName);

      return rows;
    }),

  /**
   * List all decoration methods (seed data).
   */
  listDecorationMethods: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      return db.select().from(decorationMethods).where(eq(decorationMethods.isActive, true));
    }),

  /**
   * Resolve price for a client × product × quantity combination.
   * Used by the price matrix popup for live margin calculation preview.
   */
  resolvePrice: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      productId: z.number().int().positive(),
      quantity: z.number().int().positive(),
      variantKey: z.string().nullable().optional(),
      decorationMethodId: z.number().int().positive().nullable().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const result = await resolvePricing({
          clientId: input.clientId,
          productId: input.productId,
          quantity: input.quantity,
          variantKey: input.variantKey ?? null,
          decorationMethodId: input.decorationMethodId ?? null,
          includeOtherCosts: true,
        });
        return { success: true, result };
      } catch {
        return { success: false, result: null };
      }
    }),
});
