import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import pLimit from "p-limit";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { products, type InsertProduct } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { getOrgScope } from "../utils/orgScope";
import {
  ALLOWED_ZONES,
  ALLOWED_BLEND_MODES,
  runAnalysisAndPersist,
  runAnalysisAndPersistInBackground,
  runBulkAnalysisInBackground,
  type PlacementResult,
} from "../services/webstore-imprint-placement";
import { fanOutRenderForProduct } from "../services/webstore-render-orchestrator";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { AI_INSIGHTS_LIMIT } from "../utils/rateLimiter";
import { getLogger } from "../utils/logger";

const log = getLogger("products-router");

const pricingTierSchema = z.object({
  minQty: z.number(),
  maxQty: z.number(),
  price: z.number(),
});

export const productsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        category: z.string().optional(),
        type: z.enum(["promotional", "print"]).optional(),
        source: z.enum(["manual", "csv", "api", "asi", "sage"]).optional(),
        status: z.enum(["active", "inactive", "draft"]).optional(),
        limit: z.number().min(1).max(200).optional().default(50),
        offset: z.number().min(0).optional().default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const rows = await db
        .select()
        .from(products)
        .where(scope.products)
        .orderBy(desc(products.updatedAt))
        .limit(limit + 1)
        .offset(offset);

      let filtered = rows;
      if (input?.category) filtered = filtered.filter(p => p.category === input.category);
      if (input?.type) filtered = filtered.filter(p => p.type === input.type);
      if (input?.source) filtered = filtered.filter(p => p.source === input.source);
      if (input?.status) filtered = filtered.filter(p => p.status === input.status);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(
          p =>
            p.name.toLowerCase().includes(s) ||
            (p.sku && p.sku.toLowerCase().includes(s)) ||
            (p.supplier && p.supplier.toLowerCase().includes(s))
        );
      }
      const hasMore = filtered.length > limit;
      const page = hasMore ? filtered.slice(0, limit) : filtered;
      return { items: page, total: page.length, hasMore, nextOffset: hasMore ? offset + limit : null };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const rows = await db
        .select()
        .from(products)
        .where(and(eq(products.id, input.id), scope.products))
        .limit(1);

      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
      return rows[0];
    }),

  /**
   * Phase 8 — variant-grouped catalog feed.
   *
   * Collapses 13,871 variant rows into ~407 product groups by joining each
   * group's primary variant (isVariantPrimary=TRUE) to its sibling variants.
   * The primary's row supplies the card-face data (name, imageUrl, price);
   * the variants array drives the color swatch strip.
   *
   * Filters mirror products.list (category, type, search, status). Search
   * matches on the primary variant's name/sku/supplier — that's what the
   * card shows, so a hit there is what the operator expects to find.
   *
   * The legacy products.list stays unchanged for bulk-edit and admin tools
   * that need flat rows.
   */
  listGrouped: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        category: z.string().optional(),
        type: z.enum(["promotional", "print"]).optional(),
        status: z.enum(["active", "inactive", "draft"]).optional(),
        limit: z.number().min(1).max(200).optional().default(50),
        offset: z.number().min(0).optional().default(0),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      // Pull all org-scoped rows once. Catalog ceiling is bounded
      // (org-scoped, ~tens of thousands at most). Group + filter in JS
      // for code clarity; Drizzle's lack of window-function helpers makes
      // the SQL-side variant noisy. If this becomes a hotspot we can move
      // to a CTE-based query later.
      const rows = await db
        .select()
        .from(products)
        .where(scope.products)
        .orderBy(desc(products.updatedAt));

      // Bucket by styleGroup; rows without a styleGroup form singletons
      // keyed by their id (so manual products still appear).
      const buckets = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = r.styleGroup ?? `__solo_${r.id}`;
        const list = buckets.get(key) ?? [];
        list.push(r);
        buckets.set(key, list);
      }

      type Row = typeof rows[number];
      const groups = Array.from(buckets.entries()).map(([styleGroup, variants]) => {
        const primary: Row = variants.find(v => v.isVariantPrimary) ?? variants[0];
        return {
          styleGroup,
          primary,
          variants: variants
            .map(v => ({
              productId: v.id,
              colorName: v.colorName,
              colorHex: v.colorHex,
              swatchUrl: v.swatchUrl,
              imageUrl: v.imageUrl,
            }))
            .sort((a, b) => (a.colorName ?? "").localeCompare(b.colorName ?? "")),
          variantCount: variants.length,
        };
      });

      // Filter at the group level using the primary's fields.
      let filtered = groups;
      if (input?.category) filtered = filtered.filter(g => g.primary.category === input.category);
      if (input?.type)     filtered = filtered.filter(g => g.primary.type === input.type);
      if (input?.status)   filtered = filtered.filter(g => g.primary.status === input.status);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(g =>
          g.primary.name.toLowerCase().includes(s) ||
          (g.primary.sku && g.primary.sku.toLowerCase().includes(s)) ||
          (g.primary.supplier && g.primary.supplier.toLowerCase().includes(s)),
        );
      }
      filtered.sort((a, b) =>
        (b.primary.updatedAt instanceof Date ? b.primary.updatedAt.getTime() : 0) -
        (a.primary.updatedAt instanceof Date ? a.primary.updatedAt.getTime() : 0),
      );

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);
      return {
        items: page,
        total,
        hasMore: offset + limit < total,
        nextOffset: offset + limit < total ? offset + limit : null,
      };
    }),

  /**
   * PDP feed — given a styleGroup slug, return the primary variant plus
   * all sibling variants (id, colorName, colorHex, swatchUrl, imageUrl,
   * sizes). Org-scoped. Used by both the distributor and customer PDPs
   * to render the color selector and main image swap.
   */
  getByStyleGroup: protectedProcedure
    .input(z.object({ styleGroup: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const rows = await db
        .select()
        .from(products)
        .where(and(eq(products.styleGroup, input.styleGroup), scope.products));

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Product group not found" });
      }
      const primary = rows.find(r => r.isVariantPrimary) ?? rows[0];
      const variants = rows
        .map(r => ({
          productId: r.id,
          colorName: r.colorName,
          colorHex: r.colorHex,
          swatchUrl: r.swatchUrl,
          imageUrl: r.imageUrl,
          sizes: r.sizes,
          basePrice: r.basePrice,
        }))
        .sort((a, b) => (a.colorName ?? "").localeCompare(b.colorName ?? ""));

      return { styleGroup: input.styleGroup, primary, variants, variantCount: rows.length };
    }),

  getByIds: protectedProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      if (input.ids.length === 0) return [];

      const rows = await db
        .select()
        .from(products)
        .where(and(inArray(products.id, input.ids), scope.products));
      return rows;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        sku: z.string().optional(),
        category: z.enum(["apparel", "drinkware", "tech", "bags", "writing", "wellness", "outdoor", "office", "other"]).optional(),
        type: z.enum(["promotional", "print"]).optional(),
        description: z.string().optional(),
        supplier: z.string().optional(),
        supplierSku: z.string().optional(),
        basePrice: z.string().optional(),
        imageUrl: z.string().optional(),
        additionalImages: z.array(z.string()).optional(),
        decorationMethods: z.array(z.string()).optional(),
        pricingTiers: z.array(pricingTierSchema).optional(),
        source: z.enum(["manual", "csv", "api", "asi", "sage", "promostandards"]).optional(),
        sourceApiId: z.string().optional(),
        status: z.enum(["active", "inactive", "draft"]).optional(),
        // External product fields (ASI / PromoStandards)
        externalId: z.string().optional(),
        externalSource: z.string().optional(),
        supplierCode: z.string().optional(),
        productNumber: z.string().optional(),
        hasLiveInventory: z.boolean().optional(),
        currency: z.string().optional(),
        colors: z.array(z.string()).optional(),
        sizes: z.array(z.string()).optional(),
        minQuantity: z.number().optional(),
        // Print-on-demand fields
        printAreas: z.array(z.string()).optional(),
        printMethods: z.array(z.string()).optional(),
        printColors: z.array(z.string()).optional(),
        minOrderQty: z.number().optional(),
        fileSpecs: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const values: InsertProduct = {
        ...scope.stamp,
        name: input.name,
        sku: input.sku ?? null,
        category: input.category ?? "other",
        type: input.type ?? "promotional",
        description: input.description ?? null,
        supplier: input.supplier ?? null,
        supplierSku: input.supplierSku ?? null,
        basePrice: input.basePrice ?? null,
        imageUrl: input.imageUrl ?? null,
        additionalImages: input.additionalImages ?? null,
        decorationMethods: input.decorationMethods ?? null,
        pricingTiers: input.pricingTiers ?? null,
        source: input.source ?? "manual",
        sourceApiId: input.sourceApiId ?? undefined,
        status: input.status ?? "active",
        externalId: input.externalId ?? null,
        externalSource: (input.externalSource as "asi" | "promostandards" | null | undefined) ?? null,
        supplierCode: input.supplierCode ?? null,
        productNumber: input.productNumber ?? null,
        hasLiveInventory: input.hasLiveInventory ?? false,
        currency: input.currency ?? "USD",
        colors: input.colors ?? null,
        sizes: input.sizes ?? null,
        minQuantity: input.minQuantity ?? null,
        printAreas: input.printAreas ?? null,
        printMethods: input.printMethods ?? null,
        printColors: input.printColors ?? null,
        minOrderQty: input.minOrderQty ?? null,
        fileSpecs: input.fileSpecs ?? null,
      };

      const result = await db.insert(products).values(values);
      const insertId = result[0].insertId;

      const created = await db.select().from(products).where(and(eq(products.id, insertId), scope.products)).limit(1);

      // Fire-and-forget: kick off vision analysis without blocking the
      // response. Skipped silently when no imageUrl is set (the dominant
      // case when a distributor creates a product first and uploads the
      // image later — the products.uploadImage hook fires the analysis
      // when the image arrives). Failures are logged by the helper and
      // re-tried on the Phase 8 backfill's next pass.
      if (created[0]?.imageUrl) {
        runAnalysisAndPersistInBackground(db, {
          id: insertId,
          imageUrl: created[0].imageUrl,
          webstoreImprintPlacementSource: created[0].webstoreImprintPlacementSource,
          supplierCode: created[0].supplierCode,
          name: created[0].name,
        }, scope.products);
      }

      return created[0];
    }),

  bulkCreate: protectedProcedure
    .input(
      z.object({
        products: z.array(
          z.object({
            name: z.string().min(1),
            sku: z.string().optional(),
            category: z.enum(["apparel", "drinkware", "tech", "bags", "writing", "wellness", "outdoor", "office", "other"]).optional(),
            type: z.enum(["promotional", "print"]).optional(),
            description: z.string().optional(),
            supplier: z.string().optional(),
            supplierSku: z.string().optional(),
            basePrice: z.string().optional(),
            imageUrl: z.string().optional(),
            source: z.enum(["manual", "csv", "api", "asi", "sage"]).optional(),
          })
        ).min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const scope = getOrgScope(ctx);
      const values: InsertProduct[] = input.products.map(p => ({
        ...scope.stamp,
        name: p.name,
        sku: p.sku ?? null,
        category: p.category ?? "other",
        type: p.type ?? "promotional",
        description: p.description ?? null,
        supplier: p.supplier ?? null,
        supplierSku: p.supplierSku ?? null,
        basePrice: p.basePrice ?? null,
        imageUrl: p.imageUrl ?? null,
        source: p.source ?? "csv",
        status: "active" as const,
      }));

      const result = await db.insert(products).values(values);
      const firstId = Number(result[0].insertId);
      const insertedIds = values.map((_, i) => firstId + i);

      // Fire-and-forget bulk vision analysis. CSV rows with no imageUrl
      // get skipped silently inside the helper (no_image), so passing all
      // inserted IDs unconditionally is fine — saves a pre-filter pass
      // at the cost of a single extra pre-fetch SELECT inside the bulk
      // runner. p-limit(10) keeps Anthropic rate limits happy on the
      // 100-row max-batch case.
      runBulkAnalysisInBackground(db, insertedIds, scope.products);

      return { count: values.length };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        sku: z.string().optional(),
        category: z.enum(["apparel", "drinkware", "tech", "bags", "writing", "wellness", "outdoor", "office", "other"]).optional(),
        type: z.enum(["promotional", "print"]).optional(),
        description: z.string().optional(),
        supplier: z.string().optional(),
        supplierSku: z.string().optional(),
        basePrice: z.string().optional(),
        imageUrl: z.string().optional(),
        additionalImages: z.array(z.string()).optional(),
        decorationMethods: z.array(z.string()).optional(),
        pricingTiers: z.array(pricingTierSchema).optional(),
        status: z.enum(["active", "inactive", "draft"]).optional(),
        // Print-on-demand fields
        printAreas: z.array(z.string()).optional(),
        printMethods: z.array(z.string()).optional(),
        printColors: z.array(z.string()).optional(),
        minOrderQty: z.number().optional(),
        fileSpecs: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const { id, ...updateData } = input;

      const existing = await db
        .select()
        .from(products)
        .where(and(eq(products.id, id), scope.products))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      const setObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (value !== undefined) setObj[key] = value;
      }

      if (Object.keys(setObj).length > 0) {
        await db.update(products).set(setObj).where(and(eq(products.id, id), scope.products));
      }

      // Fan out a render to every storeProducts row for this product
      // when render-relevant inputs change. imageUrl change invalidates
      // any prior render. decorationMethods change re-runs with the new
      // surface treatment. Placement re-analysis has its own hook on
      // analyzeWebstoreImprintPlacement{,Bulk} below.
      const renderRelevantKeys = ["imageUrl", "decorationMethods"] as const;
      const renderTouched = renderRelevantKeys.some((k) => k in setObj);
      if (renderTouched) void fanOutRenderForProduct(db, id);

      const updated = await db.select().from(products).where(and(eq(products.id, id), scope.products)).limit(1);
      return updated[0];
    }),

  /**
   * Duplicate an existing product into a new catalog row. All fields copy
   * over verbatim except:
   *   - `name`: " (Copy)" is appended so the duplicate is visually distinct
   *     in the catalog list before the user renames it
   *   - `sku`: cleared because SKUs are often unique in downstream systems
   *     (QuickBooks, suppliers) and a shared SKU would cause sync conflicts
   *   - `externalId` / `sourceApiId`: cleared for the same reason — the
   *     duplicate is a distinct local artifact, not the same upstream row
   *   - `status`: forced to "draft" so the duplicate isn't accidentally
   *     published before the user edits it
   * Returns the newly created product so the caller can open it in edit mode.
   */
  duplicate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [source] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, input.id), scope.products))
        .limit(1);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      const values: InsertProduct = {
        ...scope.stamp,
        name: `${source.name} (Copy)`,
        sku: null,
        category: source.category,
        type: source.type,
        description: source.description,
        supplier: source.supplier,
        supplierSku: null,
        basePrice: source.basePrice,
        imageUrl: source.imageUrl,
        additionalImages: source.additionalImages ?? null,
        decorationMethods: source.decorationMethods ?? null,
        pricingTiers: source.pricingTiers ?? null,
        source: "manual",
        status: "draft",
        externalId: null,
        externalSource: null,
        supplierCode: source.supplierCode,
        productNumber: null,
        hasLiveInventory: false,
        currency: source.currency,
        colors: source.colors ?? null,
        sizes: source.sizes ?? null,
        minQuantity: source.minQuantity,
        printAreas: source.printAreas ?? null,
        printMethods: source.printMethods ?? null,
        printColors: source.printColors ?? null,
        minOrderQty: source.minOrderQty,
        fileSpecs: source.fileSpecs,
      };

      const result = await db.insert(products).values(values);
      const insertId = result[0].insertId;
      const [created] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, insertId), scope.products))
        .limit(1);

      // Fire-and-forget: same pattern as products.create. The duplicate
      // copies the source's imageUrl but starts with NULL placement
      // columns, so the AI re-analyzes from scratch (an override on the
      // source product does not transfer to the copy). The distributor
      // can override the duplicate's placement separately if needed.
      if (created?.imageUrl) {
        runAnalysisAndPersistInBackground(db, {
          id: insertId,
          imageUrl: created.imageUrl,
          webstoreImprintPlacementSource: created.webstoreImprintPlacementSource,
          supplierCode: created.supplierCode,
          name: created.name,
        }, scope.products);
      }

      return created;
    }),

  /** Upload a product image from base64 data */
  uploadImage: protectedProcedure
    .input(
      z.object({
        fileName: z.string(),
        mimeType: z.string(),
        base64Data: z.string(), // base64 encoded file content
        productId: z.number().optional(), // if updating an existing product
      })
    )
    .mutation(async ({ ctx, input }) => {
      const allowedTypes = ["image/jpeg", "image/png", "image/svg+xml", "image/webp", "image/gif", "image/bmp", "image/tiff"];
      if (!allowedTypes.includes(input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported image format. Allowed: JPEG, PNG, SVG, WebP, GIF, BMP, TIFF" });
      }

      const buffer = Buffer.from(input.base64Data, "base64");
      const ext = input.fileName.split(".").pop() || "png";
      const fileKey = `product-images/${ctx.user.id}/${nanoid()}.${ext}`;

      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      // If productId provided, update the product's imageUrl
      if (input.productId) {
        const db = await getDb();
        const scope = getOrgScope(ctx);
        if (db) {
          await db
            .update(products)
            .set({ imageUrl: url })
            .where(and(eq(products.id, input.productId), scope.products));

          // Fire-and-forget vision analysis on the new image. The helper
          // respects manual_override (force=false), so re-uploading an
          // image on a product whose placement has been distributor-
          // overridden does NOT silently erase the override — the new
          // image is stored, but the cached coordinates stay put. To
          // re-analyze with a manual placement in place, the distributor
          // must use analyzeWebstoreImprintPlacement with force=true.
          const [row] = await db
            .select({
              webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
              supplierCode: products.supplierCode,
              name: products.name,
            })
            .from(products)
            .where(and(eq(products.id, input.productId), scope.products))
            .limit(1);
          if (row) {
            runAnalysisAndPersistInBackground(db, {
              id: input.productId,
              imageUrl: url,
              webstoreImprintPlacementSource: row.webstoreImprintPlacementSource,
              supplierCode: row.supplierCode,
              name: row.name,
            }, scope.products);
          }
        }
      }

      return { url };
    }),

  /**
   * Analyze a single product's image with Claude vision and cache the
   * resulting placement coordinates on the products row. User-initiated
   * (e.g., a "Re-analyze" button on the catalog row). Phase 5 ingestion
   * hooks call the underlying service directly without going through tRPC.
   *
   * `force=true` bypasses the manual-override skip and re-runs analysis,
   * stamping source='ai' on success (un-stickies a distributor override).
   * The UI is expected to confirm with the distributor before sending it.
   */
  analyzeWebstoreImprintPlacement: protectedProcedure
    .input(z.object({
      productId: z.number().int().positive(),
      force: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [product] = await db
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
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      const result = await runAnalysisAndPersist(db, product, scope.products, input.force);
      // Fan out a render to every storeProducts row for this product
      // when placement coords actually changed. Skipped/failed results
      // do not need a re-render.
      if (result.status === "ok") void fanOutRenderForProduct(db, input.productId);
      return result;
    }),

  /**
   * Bulk variant of analyzeWebstoreImprintPlacement. Pre-fetches all
   * products in one query, then fans out the vision calls with a
   * concurrency cap of 10 via p-limit so we never punish the Anthropic
   * rate limit even on a 100-row batch. Each row reports its own status
   * — one failure does not abort the others.
   *
   * Always respects manual overrides — there is no force flag here. If a
   * distributor wants to revert a specific override to AI, they call the
   * single procedure with force=true on that one product. This protects
   * manual overrides from accidental batch erasure.
   */
  analyzeWebstoreImprintPlacementBulk: protectedProcedure
    .use(rateLimited("products.analyzeWebstoreImprintPlacementBulk", AI_INSIGHTS_LIMIT))
    .input(z.object({
      productIds: z.array(z.number().int().positive()).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const uniqueIds = Array.from(new Set(input.productIds));

      const rows = await db
        .select({
          id: products.id,
          imageUrl: products.imageUrl,
          webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
          supplierCode: products.supplierCode,
          name: products.name,
        })
        .from(products)
        .where(and(inArray(products.id, uniqueIds), scope.products));
      const byId = new Map(rows.map(r => [r.id, r]));

      const limit = pLimit(10);
      const results = await Promise.all(
        uniqueIds.map(productId =>
          limit(async (): Promise<{
            productId: number;
            status: "ok" | "skipped" | "failed";
            reason?: "no_image" | "manual_override" | "not_found" | "vision_failed";
            placement?: PlacementResult;
          }> => {
            const product = byId.get(productId);
            if (!product) {
              return { productId, status: "skipped", reason: "not_found" };
            }
            const r = await runAnalysisAndPersist(db, product, scope.products, false);
            // Fan out only when placement actually changed. Skipped
            // (manual_override) and failed results don't invalidate
            // existing renders.
            if (r.status === "ok") void fanOutRenderForProduct(db, productId);
            return r;
          }),
        ),
      );

      const summary = results.reduce(
        (acc, r) => {
          if (r.status === "ok") acc.ok++;
          else if (r.status === "skipped") acc.skipped++;
          else acc.failed++;
          return acc;
        },
        { ok: 0, skipped: 0, failed: 0 },
      );

      log.info(
        `analyzeWebstoreImprintPlacementBulk: ${uniqueIds.length} requested → ok=${summary.ok} skipped=${summary.skipped} failed=${summary.failed}`,
      );

      return { results, summary };
    }),

  /**
   * Manual placement override. Stamps `source='distributor_override'` so
   * subsequent auto-analyze runs (real-time hooks, bulk re-analyze, the
   * Phase 8 backfill) leave the row alone. Confidence is forced to 1.00
   * because a human placement is authoritative.
   */
  overrideWebstoreImprintPlacement: protectedProcedure
    .input(z.object({
      productId: z.number().int().positive(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
      zone: z.enum(ALLOWED_ZONES),
      blendMode: z.enum(ALLOWED_BLEND_MODES),
    }))
    .mutation(async ({ ctx, input }) => {
      // Same 1‰ slop the analyzer service tolerates on its bounding-box
      // check — keeps both validators in lockstep.
      if (input.x + input.width > 1.001 || input.y + input.height > 1.001) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Placement bounding box escapes the image (x+width or y+height > 1).",
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [existing] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.productId), scope.products))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      await db
        .update(products)
        .set({
          webstoreImprintPlacementX: input.x.toFixed(4),
          webstoreImprintPlacementY: input.y.toFixed(4),
          webstoreImprintPlacementWidth: input.width.toFixed(4),
          webstoreImprintPlacementHeight: input.height.toFixed(4),
          webstoreImprintPlacementZone: input.zone,
          webstoreImprintPlacementBlendMode: input.blendMode,
          webstoreImprintPlacementConfidence: "1.00",
          webstoreImprintPlacementAnalyzedAt: new Date(),
          webstoreImprintPlacementSource: "distributor_override",
        })
        .where(and(eq(products.id, input.productId), scope.products));

      const [updated] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, input.productId), scope.products))
        .limit(1);
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(products)
        .where(and(eq(products.id, input.id), scope.products))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      await db.delete(products).where(and(eq(products.id, input.id), scope.products));
      return { success: true };
    }),
});
