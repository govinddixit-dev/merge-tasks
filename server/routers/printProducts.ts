/**
 * printProducts router — distributor-managed catalog of printed goods
 * (business cards, flyers, banners, posters) with size/stock variants
 * and tiered quantity-based pricing.
 *
 * Two surfaces consume this:
 *   - Distributor Store Management → Print Products tab (full CRUD)
 *   - Public storefront → Print Products tab (list + getById only)
 *
 * Public storefront routes use a slug lookup and are read-only.
 */
import { z } from "zod";
import { and, eq, asc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  stores,
  printProducts,
  printProductVariants,
  printProductPricing,
  printSupplierConnections,
} from "../../drizzle/schema";
import { encryptCredential } from "../utils/encryption";
import { getLogger } from "../utils/logger";

const log = getLogger("printProducts");

async function verifyStoreOwnership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  storeId: number,
  userId: number,
  organizationId: number | null,
) {
  const conds = organizationId != null
    ? and(eq(stores.id, storeId), eq(stores.organizationId, organizationId))
    : and(eq(stores.id, storeId), eq(stores.userId, userId));
  const [row] = await db.select({ id: stores.id }).from(stores).where(conds).limit(1);
  if (!row) throw new TRPCError({ code: "FORBIDDEN", message: "Store not found or not authorized" });
}

/** Hydrate variants + pricing tiers for a list of print products. */
async function hydrateVariants(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  productIds: number[],
) {
  if (productIds.length === 0) return { variantsByProduct: new Map<number, any[]>(), pricingByVariant: new Map<number, any[]>() };
  const variants = await db
    .select()
    .from(printProductVariants)
    .where(inArray(printProductVariants.printProductId, productIds))
    .orderBy(asc(printProductVariants.sortOrder), asc(printProductVariants.id));
  const variantIds = variants.map((v) => v.id);
  const pricing = variantIds.length > 0
    ? await db
        .select()
        .from(printProductPricing)
        .where(inArray(printProductPricing.printProductVariantId, variantIds))
        .orderBy(asc(printProductPricing.quantity))
    : [];
  const variantsByProduct = new Map<number, typeof variants>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.printProductId) ?? [];
    arr.push(v);
    variantsByProduct.set(v.printProductId, arr);
  }
  const pricingByVariant = new Map<number, typeof pricing>();
  for (const p of pricing) {
    const arr = pricingByVariant.get(p.printProductVariantId) ?? [];
    arr.push(p);
    pricingByVariant.set(p.printProductVariantId, arr);
  }
  return { variantsByProduct, pricingByVariant };
}

const variantInput = z.object({
  size: z.string().min(1).max(64),
  stock: z.string().min(1).max(128),
  sortOrder: z.number().int().nonnegative().default(0),
  pricingTiers: z.array(z.object({
    quantity: z.number().int().positive(),
    priceInCents: z.number().int().nonnegative(),
  })).min(1, "At least one pricing tier is required per variant"),
});

export const printProductsRouter = router({
  /** Distributor-facing list — includes inactive products */
  list: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await verifyStoreOwnership(db, input.storeId, ctx.user.id, ctx.organizationId);
      const products = await db
        .select()
        .from(printProducts)
        .where(eq(printProducts.storeId, input.storeId))
        .orderBy(asc(printProducts.productType), asc(printProducts.name));
      const { variantsByProduct, pricingByVariant } = await hydrateVariants(db, products.map((p) => p.id));
      return products.map((p) => ({
        ...p,
        variants: (variantsByProduct.get(p.id) ?? []).map((v) => ({
          ...v,
          pricingTiers: pricingByVariant.get(v.id) ?? [],
        })),
      }));
    }),

  /** Storefront list — only active, scoped by slug */
  listPublic: publicProcedure
    .input(z.object({ storeSlug: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, input.storeSlug)).limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      const products = await db
        .select()
        .from(printProducts)
        .where(and(eq(printProducts.storeId, store.id), eq(printProducts.isActive, true)))
        .orderBy(asc(printProducts.productType), asc(printProducts.name));
      const { variantsByProduct, pricingByVariant } = await hydrateVariants(db, products.map((p) => p.id));
      return products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        productType: p.productType,
        imageUrls: p.imageUrls,
        variants: (variantsByProduct.get(p.id) ?? []).map((v) => ({
          id: v.id,
          size: v.size,
          stock: v.stock,
          pricingTiers: (pricingByVariant.get(v.id) ?? []).map((t) => ({
            quantity: t.quantity,
            priceInCents: t.priceInCents,
          })),
        })),
      }));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [product] = await db.select().from(printProducts).where(eq(printProducts.id, input.id)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Print product not found" });
      await verifyStoreOwnership(db, product.storeId, ctx.user.id, ctx.organizationId);
      const { variantsByProduct, pricingByVariant } = await hydrateVariants(db, [product.id]);
      return {
        ...product,
        variants: (variantsByProduct.get(product.id) ?? []).map((v) => ({
          ...v,
          pricingTiers: pricingByVariant.get(v.id) ?? [],
        })),
      };
    }),

  create: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      productType: z.enum(["business_cards", "flyers", "banners", "posters"]),
      imageUrls: z.array(z.string()).default([]),
      divisionIds: z.array(z.number()).default([]),
      variants: z.array(variantInput).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await verifyStoreOwnership(db, input.storeId, ctx.user.id, ctx.organizationId);

      await db.insert(printProducts).values({
        storeId: input.storeId,
        name: input.name,
        description: input.description || null,
        productType: input.productType,
        imageUrls: input.imageUrls,
        divisionIds: input.divisionIds,
        isActive: true,
      });
      const [created] = await db.select().from(printProducts)
        .where(and(eq(printProducts.storeId, input.storeId), eq(printProducts.name, input.name)))
        .orderBy(asc(printProducts.id))
        .limit(1);
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create print product" });

      for (const v of input.variants) {
        await db.insert(printProductVariants).values({
          printProductId: created.id,
          size: v.size,
          stock: v.stock,
          sortOrder: v.sortOrder,
        });
        const [variantRow] = await db.select().from(printProductVariants)
          .where(and(eq(printProductVariants.printProductId, created.id), eq(printProductVariants.size, v.size), eq(printProductVariants.stock, v.stock)))
          .orderBy(asc(printProductVariants.id))
          .limit(1);
        if (!variantRow) continue;
        for (const t of v.pricingTiers) {
          await db.insert(printProductPricing).values({
            printProductVariantId: variantRow.id,
            quantity: t.quantity,
            priceInCents: t.priceInCents,
          });
        }
      }
      return { id: created.id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      productType: z.enum(["business_cards", "flyers", "banners", "posters"]).optional(),
      imageUrls: z.array(z.string()).optional(),
      divisionIds: z.array(z.number()).optional(),
      isActive: z.boolean().optional(),
      // When supplied, replaces the variant set entirely. Partial variant
      // edits happen through a full replace because pricing tiers cascade.
      variants: z.array(variantInput).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [existing] = await db.select().from(printProducts).where(eq(printProducts.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Print product not found" });
      await verifyStoreOwnership(db, existing.storeId, ctx.user.id, ctx.organizationId);

      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.productType !== undefined) updates.productType = input.productType;
      if (input.imageUrls !== undefined) updates.imageUrls = input.imageUrls;
      if (input.divisionIds !== undefined) updates.divisionIds = input.divisionIds;
      if (input.isActive !== undefined) updates.isActive = input.isActive;
      if (Object.keys(updates).length > 0) {
        await db.update(printProducts).set(updates).where(eq(printProducts.id, input.id));
      }

      if (input.variants) {
        // Replace variant set — cascading delete drops pricing rows.
        await db.delete(printProductVariants).where(eq(printProductVariants.printProductId, input.id));
        for (const v of input.variants) {
          await db.insert(printProductVariants).values({
            printProductId: input.id,
            size: v.size,
            stock: v.stock,
            sortOrder: v.sortOrder,
          });
          const [variantRow] = await db.select().from(printProductVariants)
            .where(and(eq(printProductVariants.printProductId, input.id), eq(printProductVariants.size, v.size), eq(printProductVariants.stock, v.stock)))
            .orderBy(asc(printProductVariants.id))
            .limit(1);
          if (!variantRow) continue;
          for (const t of v.pricingTiers) {
            await db.insert(printProductPricing).values({
              printProductVariantId: variantRow.id,
              quantity: t.quantity,
              priceInCents: t.priceInCents,
            });
          }
        }
      }
      return { success: true };
    }),

  /** Soft delete — sets isActive=false. */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [existing] = await db.select().from(printProducts).where(eq(printProducts.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Print product not found" });
      await verifyStoreOwnership(db, existing.storeId, ctx.user.id, ctx.organizationId);
      await db.update(printProducts).set({ isActive: false }).where(eq(printProducts.id, input.id));
      return { success: true };
    }),

  // ── Bulk import ───────────────────────────────────────────────────────────
  /**
   * CSV template download — returns the header row + one example row
   * so distributors can fill it out and upload.
   */
  bulkImportTemplate: protectedProcedure.query(() => {
    const header = "name,productType,description,size,stock,quantity,priceCents";
    const example = 'Standard Business Card,business_cards,"Clean matte card",3.5x2in,"14pt Matte",250,4500';
    return { csv: `${header}\n${example}\n` };
  }),

  /**
   * Bulk import parses CSV rows and inserts print products with variants
   * and pricing tiers. Rows sharing a (name, productType) tuple are grouped
   * into one product; rows sharing (name, productType, size, stock) are
   * grouped into one variant with multiple pricing tiers.
   */
  bulkImport: protectedProcedure
    .input(z.object({ storeId: z.number(), csv: z.string().min(1).max(1_000_000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await verifyStoreOwnership(db, input.storeId, ctx.user.id, ctx.organizationId);

      const rows = parseCsv(input.csv);
      if (rows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CSV has no data rows" });
      }
      const required = ["name", "producttype", "size", "stock", "quantity", "pricecents"];
      for (const r of required) {
        if (!(r in rows[0])) throw new TRPCError({ code: "BAD_REQUEST", message: `CSV is missing required column: ${r}` });
      }

      type RowShape = { name: string; productType: "business_cards" | "flyers" | "banners" | "posters"; description: string; size: string; stock: string; quantity: number; priceCents: number };
      const clean: RowShape[] = [];
      for (const row of rows) {
        const productTypeRaw = String(row.producttype || "").trim();
        if (!["business_cards", "flyers", "banners", "posters"].includes(productTypeRaw)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid productType "${productTypeRaw}"` });
        }
        clean.push({
          name: String(row.name).trim(),
          productType: productTypeRaw as RowShape["productType"],
          description: String(row.description || "").trim(),
          size: String(row.size).trim(),
          stock: String(row.stock).trim(),
          quantity: parseInt(String(row.quantity), 10),
          priceCents: parseInt(String(row.pricecents), 10),
        });
      }

      const byProduct = new Map<string, RowShape[]>();
      for (const r of clean) {
        const key = `${r.name}||${r.productType}`;
        const arr = byProduct.get(key) ?? [];
        arr.push(r);
        byProduct.set(key, arr);
      }

      let created = 0;
      for (const [, productRows] of Array.from(byProduct.entries())) {
        const head = productRows[0];
        await db.insert(printProducts).values({
          storeId: input.storeId,
          name: head.name,
          description: head.description || null,
          productType: head.productType,
          imageUrls: [],
          divisionIds: [],
          isActive: true,
        });
        const [product] = await db.select().from(printProducts)
          .where(and(eq(printProducts.storeId, input.storeId), eq(printProducts.name, head.name), eq(printProducts.productType, head.productType)))
          .orderBy(asc(printProducts.id))
          .limit(1);
        if (!product) continue;

        const byVariant = new Map<string, RowShape[]>();
        for (const r of productRows) {
          const key = `${r.size}||${r.stock}`;
          const arr = byVariant.get(key) ?? [];
          arr.push(r);
          byVariant.set(key, arr);
        }
        for (const [, variantRows] of Array.from(byVariant.entries())) {
          const vHead = variantRows[0];
          await db.insert(printProductVariants).values({
            printProductId: product.id,
            size: vHead.size,
            stock: vHead.stock,
            sortOrder: 0,
          });
          const [variant] = await db.select().from(printProductVariants)
            .where(and(
              eq(printProductVariants.printProductId, product.id),
              eq(printProductVariants.size, vHead.size),
              eq(printProductVariants.stock, vHead.stock),
            ))
            .orderBy(asc(printProductVariants.id))
            .limit(1);
          if (!variant) continue;
          for (const tier of variantRows) {
            await db.insert(printProductPricing).values({
              printProductVariantId: variant.id,
              quantity: tier.quantity,
              priceInCents: tier.priceCents,
            });
          }
        }
        created += 1;
      }
      return { created };
    }),
});

/**
 * Supplier connection router — save/manage a store's connection to an
 * external print supplier and trigger a manual sync. The sync endpoint
 * currently returns "pending" because no supplier contract is wired
 * yet; it does not silently no-op.
 */
export const printSupplierRouter = router({
  list: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await verifyStoreOwnership(db, input.storeId, ctx.user.id, ctx.organizationId);
      const rows = await db
        .select({
          id: printSupplierConnections.id,
          storeId: printSupplierConnections.storeId,
          supplierName: printSupplierConnections.supplierName,
          apiEndpoint: printSupplierConnections.apiEndpoint,
          isActive: printSupplierConnections.isActive,
          lastSyncedAt: printSupplierConnections.lastSyncedAt,
        })
        .from(printSupplierConnections)
        .where(eq(printSupplierConnections.storeId, input.storeId));
      return rows.map((r) => ({ ...r, apiKey: null as string | null })); // never return the key
    }),

  connect: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      supplierName: z.string().min(1).max(255),
      apiEndpoint: z.string().url().optional(),
      apiKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await verifyStoreOwnership(db, input.storeId, ctx.user.id, ctx.organizationId);
      await db.insert(printSupplierConnections).values({
        storeId: input.storeId,
        supplierName: input.supplierName,
        apiEndpoint: input.apiEndpoint || null,
        apiKey: input.apiKey ? encryptCredential(input.apiKey) : null,
        isActive: true,
      });
      return { success: true };
    }),

  sync: protectedProcedure
    .input(z.object({ connectionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [conn] = await db.select().from(printSupplierConnections).where(eq(printSupplierConnections.id, input.connectionId)).limit(1);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier connection not found" });
      await verifyStoreOwnership(db, conn.storeId, ctx.user.id, ctx.organizationId);
      // Do not fake a successful sync; return a clear pending status. The
      // actual integration lives behind the supplier contract.
      log.info(`Supplier sync requested for connection ${conn.id} (${conn.supplierName})`);
      return {
        status: "pending" as const,
        message: `Supplier sync for ${conn.supplierName} is not yet wired. Contact support to enable this supplier.`,
      };
    }),
});

// ── Minimal CSV parser ──────────────────────────────────────────────────────
// Handles quoted fields and commas within quotes. Not a general-purpose CSV
// library — keep it small and predictable; bulk import validates column
// names explicitly afterward.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => { obj[h] = cells[idx] ?? ""; });
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      cur += ch;
    } else {
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === ",") { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
