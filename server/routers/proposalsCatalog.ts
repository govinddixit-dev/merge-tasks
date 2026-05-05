/**
 * proposalsCatalog — Catalog-style variant/tier/image configuration.
 *
 * Procedures: getProductCatalogConfig, saveProductCatalogConfig
 */
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  proposals, proposalProducts, products,
  proposalProductVariants, proposalPriceTiers,
  proposalProductImages, proposalSizeCharts,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";

export const proposalsCatalogRouter = router({
  getProductCatalogConfig: protectedProcedure
    .input(z.object({ proposalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const ppRows = await db.select().from(proposalProducts)
        .where(eq(proposalProducts.proposalId, input.proposalId));
      const ppIds = ppRows.map(pp => pp.id);

      if (ppIds.length === 0) return { products: [] };

      const allVariants = await db.select().from(proposalProductVariants).where(inArray(proposalProductVariants.proposalProductId, ppIds));
      const allTiers = await db.select().from(proposalPriceTiers).where(inArray(proposalPriceTiers.proposalProductId, ppIds));
      const allImages = await db.select().from(proposalProductImages).where(inArray(proposalProductImages.proposalProductId, ppIds));
      const allSizeCharts = await db.select().from(proposalSizeCharts).where(inArray(proposalSizeCharts.proposalProductId, ppIds));

      const variantsByPP = new Map<number, typeof allVariants>();
      const tiersByPP = new Map<number, typeof allTiers>();
      const imagesByPP = new Map<number, typeof allImages>();
      const sizeChartByPP = new Map<number, (typeof allSizeCharts)[0]>();

      for (const v of allVariants) {
        if (ppIds.includes(v.proposalProductId)) {
          const arr = variantsByPP.get(v.proposalProductId) || [];
          arr.push(v);
          variantsByPP.set(v.proposalProductId, arr);
        }
      }
      for (const t of allTiers) {
        if (ppIds.includes(t.proposalProductId)) {
          const arr = tiersByPP.get(t.proposalProductId) || [];
          arr.push(t);
          tiersByPP.set(t.proposalProductId, arr);
        }
      }
      for (const img of allImages) {
        if (ppIds.includes(img.proposalProductId)) {
          const arr = imagesByPP.get(img.proposalProductId) || [];
          arr.push(img);
          imagesByPP.set(img.proposalProductId, arr);
        }
      }
      for (const sc of allSizeCharts) {
        if (ppIds.includes(sc.proposalProductId)) {
          sizeChartByPP.set(sc.proposalProductId, sc);
        }
      }

      const referencedProductIds = ppRows.map(pp => pp.productId).filter(Boolean);
      const productRows = referencedProductIds.length > 0
        ? await db.select().from(products).where(and(scope.products, inArray(products.id, referencedProductIds)))
        : [];
      const productMap = new Map(productRows.map(p => [p.id, p]));

      const result = ppRows.map(pp => {
        const prod = productMap.get(pp.productId);
        const variants = variantsByPP.get(pp.id) || [];
        const tiers = tiersByPP.get(pp.id) || [];
        const images = imagesByPP.get(pp.id) || [];
        const sizeChart = sizeChartByPP.get(pp.id) || null;

        return {
          proposalProductId: pp.id,
          productId: pp.productId,
          productName: prod?.name || "Product",
          colors: variants.filter(v => v.variantType === "color").sort((a, b) => a.sortOrder - b.sortOrder).map(v => v.value),
          sizes: variants.filter(v => v.variantType === "size").sort((a, b) => a.sortOrder - b.sortOrder).map(v => v.value),
          logoPositions: variants.filter(v => v.variantType === "logo_position").sort((a, b) => a.sortOrder - b.sortOrder).map(v => v.value),
          priceTiers: tiers.sort((a, b) => a.sortOrder - b.sortOrder).map(t => ({
            id: t.id,
            tierType: t.tierType,
            label: t.label,
            minQty: t.minQty,
            maxQty: t.maxQty,
            price: t.price?.toString() || "0",
          })),
          images: images.sort((a, b) => a.sortOrder - b.sortOrder).map(img => img.imageUrl),
          sizeChart: sizeChart ? {
            chartData: sizeChart.chartData || [],
            imageUrl: sizeChart.imageUrl || null,
          } : null,
        };
      });

      return { products: result };
    }),

  saveProductCatalogConfig: protectedProcedure
    .input(z.object({
      proposalId: z.number(),
      proposalProductId: z.number(),
      colors: z.array(z.string()).optional(),
      sizes: z.array(z.string()).optional(),
      logoPositions: z.array(z.string()).optional(),
      priceTiers: z.array(z.object({
        tierType: z.enum(["quantity", "size"]),
        label: z.string(),
        minQty: z.number().nullable().optional(),
        maxQty: z.number().nullable().optional(),
        price: z.string(),
      })).optional(),
      images: z.array(z.string()).optional(),
      sizeChart: z.object({
        chartData: z.array(z.record(z.string(), z.string())).optional(),
        imageUrl: z.string().nullable().optional(),
      }).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      // CR7 fix: verify proposalProduct belongs to this proposal
      const [ppCheck] = await db.select({ id: proposalProducts.id }).from(proposalProducts)
        .where(and(eq(proposalProducts.id, input.proposalProductId), eq(proposalProducts.proposalId, input.proposalId)))
        .limit(1);
      if (!ppCheck) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found in this proposal" });

      const ppId = input.proposalProductId;

      if (input.colors !== undefined || input.sizes !== undefined || input.logoPositions !== undefined) {
        await db.delete(proposalProductVariants).where(eq(proposalProductVariants.proposalProductId, ppId));

        const variantRows: Array<{ proposalProductId: number; variantType: "color" | "size" | "logo_position"; value: string; sortOrder: number }> = [];
        if (input.colors) {
          input.colors.forEach((c, i) => variantRows.push({ proposalProductId: ppId, variantType: "color", value: c, sortOrder: i }));
        }
        if (input.sizes) {
          input.sizes.forEach((s, i) => variantRows.push({ proposalProductId: ppId, variantType: "size", value: s, sortOrder: i }));
        }
        if (input.logoPositions) {
          input.logoPositions.forEach((lp, i) => variantRows.push({ proposalProductId: ppId, variantType: "logo_position", value: lp, sortOrder: i }));
        }
        if (variantRows.length > 0) {
          await db.insert(proposalProductVariants).values(variantRows);
        }
      }

      if (input.priceTiers !== undefined) {
        await db.delete(proposalPriceTiers).where(eq(proposalPriceTiers.proposalProductId, ppId));
        if (input.priceTiers.length > 0) {
          await db.insert(proposalPriceTiers).values(
            input.priceTiers.map((t, i) => ({
              proposalProductId: ppId,
              tierType: t.tierType,
              label: t.label,
              minQty: t.minQty ?? null,
              maxQty: t.maxQty ?? null,
              price: t.price,
              sortOrder: i,
            }))
          );
        }
      }

      if (input.images !== undefined) {
        await db.delete(proposalProductImages).where(eq(proposalProductImages.proposalProductId, ppId));
        if (input.images.length > 0) {
          await db.insert(proposalProductImages).values(
            input.images.map((url, i) => ({
              proposalProductId: ppId,
              imageUrl: url,
              sortOrder: i,
            }))
          );
        }
      }

      if (input.sizeChart !== undefined) {
        await db.delete(proposalSizeCharts).where(eq(proposalSizeCharts.proposalProductId, ppId));
        if (input.sizeChart) {
          await db.insert(proposalSizeCharts).values({
            proposalProductId: ppId,
            chartData: (input.sizeChart.chartData || []) as Record<string, string>[],
            imageUrl: input.sizeChart.imageUrl || null,
          });
        }
      }

      return { success: true };
    }),
});
