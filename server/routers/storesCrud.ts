/**
 * storesCrud — Core CRUD operations and public storefront read.
 *
 * Procedures: list, getById, getBySlug, create, update, delete
 */
import { z } from "zod";
import { eq, and, or, desc, inArray, count, sql, isNull } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  stores, storeProducts, storeUsers, clients, products, clientLogos,
  clientProductConfig, clientProductPricingTiers,
  distributorProfiles, aiTrainingData, aiEditFeedback,
  storeDepartments, storeIdentityProviders, promoCodes,
  storeLocations, locationBrandingAssets,
  organizations,
  proposals, proposalProducts, proposalProductVariants, proposalPriceTiers,
  proposalOrderItems, proposalProductImages, proposalSizeCharts, proposalVersions,
  orders, orderItems, estimates, invoices, purchaseOrders,
  virtualProofs, departmentApprovals, refundRequests, customOrderRequests,
  storeVerificationCodes, storeAllowedDomains, printRequests, storePasswordTokens,
  promoCodeUsages, emailUnsubscribes,
  type InsertStore,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { provisionStoreUser } from "./storeUserProvisioning";
import { tryResolveStoreSession } from "./storePortalAuth";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";
import { checkStoreLimit } from "../utils/planLimits";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { STORE_CREATE_LIMIT, PUBLIC_STORE_READ_LIMIT } from "../utils/rateLimiter";
import { ensureProcessedLogoInBackground } from "../services/logo-background-removal";
import { flagPendingForStoreLogoChange, gateRenderUrlForWebstore } from "../services/webstore-render-orchestrator";

/**
 * Phase 8 — group flat product+storeProducts join into per-styleGroup
 * buckets. Pulled out as a free function so the closure type-inference
 * doesn't choke on the inline IIFE form.
 */
type ProductRow = typeof products.$inferSelect;
type StoreProductRow = typeof storeProducts.$inferSelect;

function groupProductDetailsByStyleGroup(
  productDetails: ProductRow[],
  spRows: StoreProductRow[],
) {
  const buckets = new Map<string, ProductRow[]>();
  for (const p of productDetails) {
    const key = p.styleGroup ?? `__solo_${p.id}`;
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries()).map(([styleGroup, variants]) => {
    const primary = variants.find(v => v.isVariantPrimary) ?? variants[0];
    const primarySp = spRows.find(sp => sp.productId === primary.id) ?? null;
    return {
      styleGroup,
      primary,
      primaryStoreProductId: primarySp?.id ?? null,
      variants: variants
        .map((v: ProductRow) => {
          const sp = spRows.find(sp => sp.productId === v.id);
          return {
            productId: v.id,
            storeProductId: sp?.id ?? null,
            colorName: v.colorName,
            colorHex: v.colorHex,
            swatchUrl: v.swatchUrl,
            imageUrl: v.imageUrl,
            webstoreRenderedImageUrl: sp
              ? gateRenderUrlForWebstore({
                  renderApproved: sp.renderApproved,
                  renderOverrideUrl: sp.renderOverrideUrl,
                  webstoreRenderedImageUrl: sp.webstoreRenderedImageUrl,
                })
              : null,
          };
        })
        .sort((a, b) => (a.colorName ?? "").localeCompare(b.colorName ?? "")),
      variantCount: variants.length,
    };
  });
}

const log = getLogger("stores:crud");

const DEFAULT_MANAGER_BUDGET = "5000.00";

/**
 * Activation gate — a store cannot go live until its client has at least one
 * logo in the clientLogos library. Without a logo, the webstore renders
 * product cards unbranded (the LogoOverlay silently falls back to the raw
 * image), which defeats the purpose of a branded storefront and looks
 * broken to buyers.
 *
 * This is intentionally distinct from stores.logoUrl (the store banner
 * identity mark) — that field is not sufficient to brand product cards.
 */
async function assertClientHasLogo(
  db: Awaited<ReturnType<typeof getDb>> & {},
  clientId: number,
): Promise<void> {
  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(clientLogos)
    .where(eq(clientLogos.clientId, clientId));
  if (Number(cnt) === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Add a client logo before activating this store. Upload a logo in the client's assets first.",
    });
  }
}

export const storesCrudRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        clientId: z.number().optional(),
        status: z.enum(["active", "inactive", "setup", "draft", "pending_approval", "revision_requested"]).optional(),
        storeType: z.enum(["permanent", "popup"]).optional(),
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

      const conditions = [scope.stores];
      if (input?.clientId) conditions.push(eq(stores.clientId, input.clientId));
      if (input?.status) conditions.push(eq(stores.status, input.status));
      if (input?.storeType) conditions.push(eq(stores.storeType, input.storeType));

      const [countResult] = await db
        .select({ total: count() })
        .from(stores)
        .where(and(...conditions));

      const rows = await db
        .select()
        .from(stores)
        .where(and(...conditions))
        .orderBy(desc(stores.updatedAt))
        .limit(limit + 1)
        .offset(offset);

      const clientIds = Array.from(new Set(rows.map(s => s.clientId).filter(Boolean))) as number[];
      const clientRows = clientIds.length > 0
        ? await db.select().from(clients).where(and(inArray(clients.id, clientIds), scope.clients))
        : [];
      const clientMap = new Map(clientRows.map(c => [c.id, c]));

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: page.map(s => ({
          ...s,
          client: clientMap.get(s.clientId) ?? null,
        })),
        total: Number(countResult.total),
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const rows = await db.select().from(stores).where(and(eq(stores.id, input.id), scope.stores)).limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      const store = rows[0];
      const spRows = await db.select().from(storeProducts).where(eq(storeProducts.storeId, store.id));
      const productIds = spRows.map(sp => sp.productId);
      type ProductRow = typeof products.$inferSelect;
      let productDetails: ProductRow[] = [];
      if (productIds.length > 0) {
        productDetails = await db.select().from(products).where(
          and(inArray(products.id, productIds), scope.products)
        );
      }
      const clientRows = await db.select().from(clients).where(
        and(eq(clients.id, store.clientId), scope.clients)
      ).limit(1);
      // Fetch client logo URL (mirrors getBySlug logic) so StoreEditorPage and
      // StorePreviewPage can display the current logo for branded product previews.
      // Prefer the Cloudinary-processed transparent PNG for overlay rendering;
      // if absent, schedule background processing and fall back to the original.
      let clientLogoUrl: string | null = null;
      if (clientRows[0]) {
        const primaryLogo = await db.select().from(clientLogos)
          .where(and(eq(clientLogos.clientId, store.clientId), eq(clientLogos.isPrimary, true)))
          .limit(1);
        const chosen = primaryLogo[0]
          ?? (await db.select().from(clientLogos)
            .where(eq(clientLogos.clientId, store.clientId))
            .orderBy(desc(clientLogos.createdAt))
            .limit(1))[0];
        if (chosen) {
          clientLogoUrl = chosen.processedLogoUrl ?? chosen.logoUrl;
          if (!chosen.processedLogoUrl) ensureProcessedLogoInBackground(chosen.id);
        }
      }
      return {
        ...store,
        template: store.template || "modern",
        editorHeroHeadline: store.editorHeroHeadline || null,
        editorHeroSubtitle: store.editorHeroSubtitle || null,
        editorTagline: store.editorTagline || null,
        editorWelcomeMessage: store.editorWelcomeMessage || null,
        editorCategoryOrder: store.editorCategoryOrder || null,
        editorCategoryNames: store.editorCategoryNames || null,
        editorSubCategories: store.editorSubCategories || null,
        editorProductNames: store.editorProductNames || null,
        editorProductDescriptions: store.editorProductDescriptions || null,
        storeProducts: spRows,
        products: productDetails.map(p => {
          const sp = spRows.find(sp => sp.productId === p.id);
          const rawStatus = sp?.webstoreRenderStatus ?? null;
          // Derived state: a "pending" row whose underlying product hasn't
          // been analyzed will never render until analysis lands. Surface
          // that to the operator as "awaiting_analysis" so they don't keep
          // hitting Retry expecting a different outcome.
          const effectiveRenderStatus =
            rawStatus === "pending" && p.webstoreImprintPlacementAnalyzedAt == null
              ? "awaiting_analysis"
              : rawStatus;
          return {
            ...p,
            customPrice: sp?.customPrice ?? p.basePrice,
            featured: sp?.featured ?? false,
            sortOrder: sp?.sortOrder ?? 0,
            trackInventory: sp?.trackInventory ?? false,
            stockQuantity: sp?.stockQuantity ?? null,
            webstoreRenderStatus: rawStatus,
            effectiveRenderStatus,
            webstoreRenderedAt: sp?.webstoreRenderedAt ?? null,
            webstoreRenderedImageUrl: sp?.webstoreRenderedImageUrl ?? null,
            renderApproved: sp?.renderApproved ?? false,
            renderOverrideUrl: sp?.renderOverrideUrl ?? null,
          };
        }),
        clientId: store.clientId,
        client: clientRows[0] ? { ...clientRows[0], logoUrl: clientLogoUrl } : null,
      };
    }),

  /**
   * Phase 8 — per-store, per-styleGroup detail feed.
   *
   * Resolves one product family in the context of one store. Returns the
   * primary variant, all sibling variants, AND the storeProducts row for
   * each variant in this store (customPrice, featured, sortOrder, render
   * fields, inventory). Used by the Store Product Detail page to render
   * the focused per-product management view.
   */
  getStoreProductGroup: protectedProcedure
    .input(z.object({
      storeId: z.number().int().positive(),
      styleGroup: z.string().min(1).max(128),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // 1. Confirm the operator owns the store.
      const storeRows = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (storeRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }
      const store = storeRows[0];

      // 2. Fetch every catalog product in this styleGroup, scoped to the
      //    operator's org. The styleGroup is unique per org by construction.
      const variantProducts = await db
        .select()
        .from(products)
        .where(and(eq(products.styleGroup, input.styleGroup), scope.products));
      if (variantProducts.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Product group not found" });
      }
      const primary = variantProducts.find(v => v.isVariantPrimary) ?? variantProducts[0];

      // 3. Fetch the storeProducts rows that bind these variants to this
      //    store. Variants without a row are NOT bound — we still surface
      //    them so the detail page can offer to add them.
      const variantIds = variantProducts.map(v => v.id);
      const spRows = variantIds.length > 0
        ? await db.select().from(storeProducts).where(
            and(
              eq(storeProducts.storeId, input.storeId),
              inArray(storeProducts.productId, variantIds),
            ),
          )
        : [];

      const variants = variantProducts
        .map(v => {
          const sp = spRows.find(s => s.productId === v.id);
          return {
            productId: v.id,
            storeProductId: sp?.id ?? null,
            sku: v.sku,
            colorName: v.colorName,
            colorHex: v.colorHex,
            swatchUrl: v.swatchUrl,
            imageUrl: v.imageUrl,
            basePrice: v.basePrice,
            sizes: v.sizes,
            isPrimary: v.isVariantPrimary === true,
            // Per-binding fields (null when variant isn't yet in this store).
            customPrice: sp?.customPrice ?? null,
            featured: sp?.featured ?? false,
            sortOrder: sp?.sortOrder ?? 0,
            trackInventory: sp?.trackInventory ?? false,
            stockQuantity: sp?.stockQuantity ?? null,
            divisionIds: (sp?.divisionIds as number[] | null | undefined) ?? null,
            // Render fields.
            webstoreRenderedImageUrl: sp?.webstoreRenderedImageUrl ?? null,
            webstoreRenderStatus: sp?.webstoreRenderStatus ?? null,
            webstoreRenderedAt: sp?.webstoreRenderedAt ?? null,
            renderApproved: sp?.renderApproved ?? false,
            renderApprovedAt: sp?.renderApprovedAt ?? null,
            renderOverrideUrl: sp?.renderOverrideUrl ?? null,
            renderPromptAdjustment: sp?.renderPromptAdjustment ?? null,
            renderPlacementX: sp?.renderPlacementX ?? null,
            renderPlacementY: sp?.renderPlacementY ?? null,
            renderPlacementWidth: sp?.renderPlacementWidth ?? null,
            renderPlacementHeight: sp?.renderPlacementHeight ?? null,
            renderPlacementRotation: sp?.renderPlacementRotation ?? null,
            // Derived: same logic the Products tab uses.
            effectiveRenderStatus:
              sp?.webstoreRenderStatus === "pending" &&
              v.webstoreImprintPlacementAnalyzedAt == null
                ? ("awaiting_analysis" as const)
                : sp?.webstoreRenderStatus ?? null,
          };
        })
        .sort((a, b) => (a.colorName ?? "").localeCompare(b.colorName ?? ""));

      return {
        styleGroup: input.styleGroup,
        primary,
        variantCount: variantProducts.length,
        variants,
        storeName: store.name,
        storeLogoUrl: store.logoUrl,
        storeSlug: store.slug,
      };
    }),

  /**
   * checkSlugAvailability — lightweight public check used by the Create Store
   * wizard to give live "Available / Taken" feedback as the user types.
   * Runs the same regex the create mutation enforces so the two can't disagree.
   */
  checkSlugAvailability: publicProcedure
    .use(rateLimited("storeCheckSlug", PUBLIC_STORE_READ_LIMIT))
    .input(z.object({ slug: z.string().max(64) }))
    .query(async ({ input }) => {
      const slug = input.slug.trim().toLowerCase();
      const RESERVED = new Set([
        "www", "app", "api", "admin", "root", "mail", "ftp", "dashboard",
        "auth", "login", "register", "signup", "static", "assets", "cdn",
        "support", "help", "status", "blog", "docs", "marketing",
      ]);
      if (!slug) return { available: false, reason: "empty" as const };
      if (slug.length < 3) return { available: false, reason: "too_short" as const };
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
        return { available: false, reason: "invalid_chars" as const };
      }
      if (RESERVED.has(slug)) return { available: false, reason: "reserved" as const };

      const db = await getDb();
      if (!db) return { available: false, reason: "db_unavailable" as const };
      const rows = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, slug)).limit(1);
      if (rows.length > 0) return { available: false, reason: "taken" as const };
      return { available: true, reason: "ok" as const };
    }),

  getBySlug: publicProcedure
    .use(rateLimited("storeGetBySlug", PUBLIC_STORE_READ_LIMIT))
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = await db
        .select()
        .from(stores)
        .where(and(eq(stores.slug, input.slug)))
        .limit(1);
      if (rows.length > 0 && rows[0].status !== "active") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const store = rows[0];

      const locationRows = store.multiLocationEnabled
        ? await db.select().from(storeLocations).where(and(eq(storeLocations.storeId, store.id), eq(storeLocations.isActive, true))).orderBy(storeLocations.sortOrder)
        : [];

      const locationIds = locationRows.map(l => l.id);
      const brandingRows = locationIds.length > 0
        ? await db.select().from(locationBrandingAssets).where(inArray(locationBrandingAssets.locationId, locationIds))
        : [];
      const brandingByLocation = new Map(brandingRows.map(b => [b.locationId, b]));

      const allSpRows = await db
        .select()
        .from(storeProducts)
        .where(eq(storeProducts.storeId, store.id));

      // Location-scoped catalog filtering: if the viewer is signed in, show
      // products tagged for their location plus shared products. Anonymous
      // viewers see shared products only (pre-auth default). The JSON column
      // is still named `divisionIds` post-migration 0082; semantically it
      // holds location-scope IDs now.
      const viewerSession = await tryResolveStoreSession(ctx, input.slug);
      const { filterProductsByDivision } = await import("./storeDivision");
      const spRows = filterProductsByDivision(
        allSpRows.map(r => ({ ...r, divisionIds: (r.divisionIds as number[] | null | undefined) ?? null })),
        viewerSession?.locationId ?? null,
      );

      const productIds = spRows.map(sp => sp.productId);
      type ProductRow2 = typeof products.$inferSelect;
      let productDetails: ProductRow2[] = [];
      if (productIds.length > 0) {
        productDetails = await db.select().from(products).where(inArray(products.id, productIds));
      }

      const clientRows = await db.select().from(clients).where(eq(clients.id, store.clientId)).limit(1);

      // Prefer Cloudinary-processed transparent PNG for the storefront overlay;
      // schedule background processing on first miss so the next render is fast.
      let clientLogoUrl: string | null = null;
      if (clientRows[0]) {
        const logos = await db.select().from(clientLogos)
          .where(and(eq(clientLogos.clientId, store.clientId), eq(clientLogos.isPrimary, true)))
          .limit(1);
        const chosen = logos[0]
          ?? (await db.select().from(clientLogos)
            .where(eq(clientLogos.clientId, store.clientId))
            .orderBy(desc(clientLogos.createdAt))
            .limit(1))[0];
        if (chosen) {
          clientLogoUrl = chosen.processedLogoUrl ?? chosen.logoUrl;
          if (!chosen.processedLogoUrl) ensureProcessedLogoInBackground(chosen.id);
        }
      }

      // ── Batch pricing lookup ──────────────────────────────────────────────
      // Load all clientProductConfig rows for this client × these products in one query.
      // Then resolve pricing in memory — no per-product DB round trips.
      const clientId = store.clientId;
      const pricingMap = new Map<number, { unitPriceCents: number; fallbackUsed: boolean }>();

      if (productIds.length > 0 && clientId) {
        const configs = await db
          .select()
          .from(clientProductConfig)
          .where(
            and(
              eq(clientProductConfig.clientId, clientId),
              inArray(clientProductConfig.productId, productIds),
              eq(clientProductConfig.isActive, true),
            )
          );

        const configIds = configs.map(c => c.id);
        const allTiers = configIds.length > 0
          ? await db
              .select()
              .from(clientProductPricingTiers)
              .where(inArray(clientProductPricingTiers.clientProductConfigId, configIds))
          : [];

        for (const config of configs) {
          const tiers = allTiers.filter(t => t.clientProductConfigId === config.id);
          const matchedTier = tiers.find(t => 1 >= t.minQty && (t.maxQty === null || 1 <= t.maxQty));
          const tier = matchedTier ?? tiers[0] ?? null;
          if (tier) {
            pricingMap.set(config.productId, {
              unitPriceCents: tier.unitPriceCents,
              fallbackUsed: false,
            });
          }
        }
      }

      return {
        id: store.id,
        name: store.name,
        slug: store.slug,
        logoUrl: store.logoUrl,
        primaryColor: store.primaryColor,
        bannerUrl: store.bannerUrl,
        welcomeMessage: store.welcomeMessage,
        aiDescription: store.aiDescription,
        aiTagline: store.aiTagline,
        aiCategoryDescriptions: store.aiCategoryDescriptions as Record<string, string> | null,
        aiOptimizedAt: store.aiOptimizedAt,
        template: store.template || "modern",
        aiHeroHeadline: store.aiHeroHeadline || null,
        aiHeroSubtitle: store.aiHeroSubtitle || null,
        aiIndustryTheme: store.aiIndustryTheme || null,
        aiColorPalette: store.aiColorPalette || null,
        aiProductPageCTA: store.aiProductPageCTA ?? null,
        aiProductGridHeading: store.aiProductGridHeading ?? null,
        aiProductBadgeStyle: store.aiProductBadgeStyle ?? null,
        aiTemplateSuggestion: store.aiTemplateSuggestion || null,
        status: store.status,
        editorHeroHeadline: store.editorHeroHeadline || null,
        editorHeroSubtitle: store.editorHeroSubtitle || null,
        editorTagline: store.editorTagline || null,
        editorWelcomeMessage: store.editorWelcomeMessage || null,
        editorCategoryOrder: store.editorCategoryOrder || null,
        editorCategoryNames: store.editorCategoryNames || null,
        editorSubCategories: store.editorSubCategories || null,
        editorProductNames: store.editorProductNames || null,
        editorProductDescriptions: store.editorProductDescriptions || null,
        stripeEnabled: store.stripeEnabled,
        ssoEnabled: store.ssoEnabled,
        ssoProvider: store.ssoProvider,
        rbacEnabled: store.rbacEnabled,
        multiDepartment: store.multiDepartment,
        requireAuth: store.requireAuth,
        branchLocations: store.branchLocations as Array<{ id: string; name: string; address: string; isDefault?: boolean }> | null,
        allowedPaymentMethods: store.allowedPaymentMethods as string[] | null,
        multiLocationEnabled: store.multiLocationEnabled ?? false,
        locations: locationRows.map(l => {
          const branding = brandingByLocation.get(l.id);
          return {
            id: l.id,
            name: l.name,
            slug: l.slug,
            sortOrder: l.sortOrder,
            branding: branding ? {
              logoUrl: branding.logoUrl,
              primaryColor: branding.primaryColor,
              bannerUrl: branding.bannerUrl,
              bannerText: branding.bannerText,
              welcomeMessage: branding.welcomeMessage,
              aiTagline: branding.aiTagline,
            } : null,
          };
        }),
        client: clientRows[0] ? {
          companyName: clientRows[0].companyName,
          industry: clientRows[0].industry,
          website: clientRows[0].website,
          logoUrl: clientLogoUrl,
        } : null,
        // Phase 8 — variant-grouped projection added alongside the flat
        // products list. The storefront renders from `productGroups`
        // (one card per styleGroup with a color swatch strip); legacy
        // consumers (proposal-detail, mocks, anything iterating raw rows)
        // continue to read `products`. The two projections are derived
        // from the same join so they stay consistent.
        // Phase 8 — productGroups projection added alongside flat products.
        // The storefront renders one card per styleGroup with a swatch
        // strip; legacy consumers continue to read `products`. Both come
        // from the same productDetails+spRows join so they stay aligned.
        productGroups: groupProductDetailsByStyleGroup(productDetails, spRows),
        products: productDetails.map(p => {
          const sp = spRows.find(sp => sp.productId === p.id);
          return {
            id: p.id,
            storeProductId: sp?.id ?? null, // FK into storeProducts — needed by checkout
            name: p.name,
            sku: p.sku,
            category: p.category,
            basePrice: p.basePrice,
            imageUrl: p.imageUrl,
            description: p.description,
            colors: p.colors,
            sizes: p.sizes,
            // material: not in products schema — omitted
            type: p.type,
            printAreas: p.printAreas,
            printMethods: p.printMethods,
            printColors: p.printColors,
            minOrderQty: p.minOrderQty,
            fileSpecs: p.fileSpecs,
            additionalImages: p.additionalImages,
            decorationMethods: p.decorationMethods,
            customPrice: pricingMap.has(p.id)
              ? (pricingMap.get(p.id)!.unitPriceCents / 100).toFixed(2)
              : (sp?.customPrice ?? p.basePrice),
            pricingTiers: p.pricingTiers,
            fallbackPricing: !pricingMap.has(p.id),
            featured: sp?.featured ?? false,
            // Division visibility — null/[] means shared. Client applies the
            // post-login filter against the authenticated storeUser.divisionId.
            divisionIds: (sp?.divisionIds as number[] | null | undefined) ?? null,
            externalId: p.externalId,
            externalSource: p.externalSource,
            supplierCode: p.supplierCode,
            productNumber: p.productNumber,
            hasLiveInventory: p.hasLiveInventory,
            currency: p.currency,
            // Phase 6 — webstore AI imprint placement coordinates.
            // Read by client/src/pages/webstore/WebstoreLogoOverlay.tsx
            // via extractWebstorePlacement(). Decimal columns ship as
            // strings via mysql2/Drizzle; the client parseFloat's them.
            webstoreImprintPlacementX:         p.webstoreImprintPlacementX,
            webstoreImprintPlacementY:         p.webstoreImprintPlacementY,
            webstoreImprintPlacementWidth:     p.webstoreImprintPlacementWidth,
            webstoreImprintPlacementHeight:    p.webstoreImprintPlacementHeight,
            webstoreImprintPlacementBlendMode: p.webstoreImprintPlacementBlendMode,
            // Phase 7 hybrid approval gate — customers see a photorealistic
            // image only when the distributor has approved this binding.
            // Override beats AI render when both exist (manual upload from
            // a supplier photo supersedes the model output). Unapproved or
            // missing → null, and WebstoreLogoOverlay falls back to the CSS
            // logo composite. The customer never sees status, "pending
            // review", or unapproved AI output — the gate is invisible to
            // shoppers by design.
            //
            // Sourced from storeProducts (post-0099, per-binding) so two
            // stores sharing the same product can each have their own
            // tenant-specific render and approval state.
            webstoreRenderedImageUrl: sp
              ? gateRenderUrlForWebstore({
                  renderApproved: sp.renderApproved,
                  renderOverrideUrl: sp.renderOverrideUrl,
                  webstoreRenderedImageUrl: sp.webstoreRenderedImageUrl,
                })
              : null,
          };
        }),
      };
    }),

  create: protectedProcedure
    .use(rateLimited("stores.create", STORE_CREATE_LIMIT))
    .input(
      z.object({
        clientId: z.number(),
        name: z.string().min(1),
        slug: z.string().min(3).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
          message: "Slug must be 3-63 chars, lowercase letters/numbers/hyphens only, and may not start or end with a hyphen.",
        }),
        storeType: z.enum(["permanent", "popup"]).optional(),
        logoUrl: z.string().optional(),
        primaryColor: z.string().optional(),
        bannerUrl: z.string().optional(),
        welcomeMessage: z.string().optional(),
        stripeEnabled: z.boolean().optional(),
        multiDepartment: z.boolean().optional(),
        rbacEnabled: z.boolean().optional(),
        ssoEnabled: z.boolean().optional(),
        ssoProvider: z.enum(["microsoft_entra", "google_workspace", "okta", "none"]).optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        linkedStoreId: z.number().optional(),
        status: z.enum(["active", "inactive", "setup", "draft"]).optional(),
        initialUsers: z.array(z.object({
          name: z.string().min(1),
          email: z.string().email(),
          role: z.enum(["admin", "manager", "employee", "intern"]),
          department: z.string().optional(),
        })).optional(),
        origin: z.string().optional(),
        template: z.enum(["classic", "modern", "minimal"]).optional(),
        currency: z.enum(["usd", "cad"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const clientRows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, input.clientId), scope.clients))
        .limit(1);
      if (clientRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      // Activation gate — block any create that tries to launch the store
      // straight to "active" when the client has no logo on file. Default
      // path (status omitted → "setup") bypasses the gate, as intended.
      if (input.status === "active") {
        await assertClientHasLogo(db, input.clientId);
      }

      const slugCheck = await db.select().from(stores).where(eq(stores.slug, input.slug)).limit(1);
      if (slugCheck.length > 0) throw new TRPCError({ code: "CONFLICT", message: "Store slug already exists" });

      // Inherit the org-level defaultTaxRate if one is set. Store.taxRate is the
      // authoritative per-store value at checkout; this just seeds new stores.
      let orgDefaultTaxRate: string | null = null;
      if (ctx.organizationId) {
        const [org] = await db
          .select({ defaultTaxRate: organizations.defaultTaxRate })
          .from(organizations)
          .where(eq(organizations.id, ctx.organizationId))
          .limit(1);
        orgDefaultTaxRate = org?.defaultTaxRate ?? null;
      }

      const values: InsertStore = {
        userId: ctx.user.id,
        organizationId: ctx.organizationId,
        clientId: input.clientId,
        name: input.name,
        slug: input.slug,
        storeType: input.storeType ?? "permanent",
        logoUrl: input.logoUrl ?? null,
        primaryColor: input.primaryColor ?? "#6C2BD9",
        bannerUrl: input.bannerUrl ?? null,
        welcomeMessage: input.welcomeMessage ?? null,
        stripeEnabled: input.stripeEnabled ?? false,
        multiDepartment: input.multiDepartment ?? false,
        rbacEnabled: input.rbacEnabled ?? false,
        ssoEnabled: input.ssoEnabled ?? false,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        linkedStoreId: input.linkedStoreId ?? null,
        status: input.status ?? "setup",
        taxRate: orgDefaultTaxRate,
        currency: input.currency ?? "usd",
      };

      if (input.ssoProvider) {
        values.ssoProvider = input.ssoProvider;
      }
      if (input.template) {
        values.template = input.template;
      }

      let insertId: number;
      try {
        insertId = await db.transaction(async (tx) => {
          await checkStoreLimit(tx, scope, ctx.user.subscriptionTier);
          const result = await tx.insert(stores).values(values);
          const newStoreId = result[0].insertId;
          await tx.update(clients).set({ hasWebstore: true }).where(eq(clients.id, input.clientId));
          return newStoreId;
        });
      } catch (err: unknown) {
        // Convert a race on the unique slug index into a friendly CONFLICT —
        // the pre-check at line 299 catches most cases but two parallel
        // creates with the same slug can both pass it.
        if (err instanceof Object && "code" in err && err.code === "ER_DUP_ENTRY") {
          throw new TRPCError({ code: "CONFLICT", message: "Store slug already exists" });
        }
        throw err;
      }

      let provisioningResults: Array<{ email: string; role: string; emailSent: boolean; error?: string }> = [];
      if (input.initialUsers && input.initialUsers.length > 0) {
        const created = await db.select().from(stores).where(eq(stores.id, insertId)).limit(1);
        const store = created[0];
        if (store) {
          const origin = input.origin || ctx.req.headers.origin || "";
          for (const u of input.initialUsers) {
            try {
              const spendingLimit = u.role === "admin" ? null
                : u.role === "manager" ? DEFAULT_MANAGER_BUDGET
                : u.role === "employee" ? "500.00"
                : "100.00";

              const [insertResult] = await db.insert(storeUsers).values({
                storeId: store.id,
                email: u.email.toLowerCase(),
                name: u.name,
                role: u.role,
                department: u.department || null,
                spendingLimit,
                status: "invited",
              });

              const provResult = await provisionStoreUser({
                storeId: store.id,
                storeUserId: insertResult.insertId,
                email: u.email.toLowerCase(),
                name: u.name,
                role: u.role,
                storeName: store.name,
                storeSlug: store.slug,
                distributorUserId: ctx.user.id,
                origin,
              });

              provisioningResults.push({
                email: u.email,
                role: u.role,
                emailSent: provResult.emailSent,
              });
            } catch (err: unknown) {
              provisioningResults.push({
                email: u.email,
                role: u.role,
                emailSent: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }

      // Agent trigger — propose initial setup actions
      try {
        const { onStoreCreated } = await import("../utils/agentTriggers");
        void onStoreCreated(insertId, ctx.organizationId);
      } catch (triggerErr: unknown) {
        log.warn("[trigger] onStoreCreated failed:", triggerErr);
      }

      const created = await db.select().from(stores).where(eq(stores.id, insertId)).limit(1);
      return { ...created[0], provisioningResults };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        logoUrl: z.string().optional(),
        primaryColor: z.string().optional(),
        bannerUrl: z.string().optional(),
        welcomeMessage: z.string().optional(),
        aiTagline: z.string().optional(),
        aiDescription: z.string().optional(),
        aiCategoryDescriptions: z.record(z.string(), z.string()).optional(),
        stripeEnabled: z.boolean().optional(),
        multiDepartment: z.boolean().optional(),
        rbacEnabled: z.boolean().optional(),
        ssoEnabled: z.boolean().optional(),
        status: z.enum(["active", "inactive", "setup", "draft"]).optional(),
        senderName: z.string().optional(),
        senderEmail: z.string().email().optional(),
        editorHeroHeadline: z.string().optional(),
        editorHeroSubtitle: z.string().optional(),
        editorTagline: z.string().optional(),
        editorWelcomeMessage: z.string().optional(),
        editorCategoryOrder: z.array(z.string()).optional(),
        editorCategoryNames: z.record(z.string(), z.string()).optional(),
        editorSubCategories: z.record(z.string(), z.array(z.object({ id: z.string(), name: z.string(), productIds: z.array(z.number()) }))).optional(),
        editorProductNames: z.record(z.string(), z.string()).optional(),
        editorProductDescriptions: z.record(z.string(), z.string()).optional(),
        // Store Access Control — maps to requireAuth boolean in the stores table
        // private -> requireAuth: true | open_browsing -> requireAuth: false | public -> future (guestCheckoutEnabled)
        requireAuth: z.boolean().optional(),
        // Branch locations for ship-to dropdown at checkout
        branchLocations: z.array(z.object({
          id: z.string(),
          name: z.string().min(1),
          address: z.string().min(1),
          isDefault: z.boolean().optional(),
        })).optional(),
        // Allowed payment methods for checkout
        allowedPaymentMethods: z.array(z.enum(["credit_card", "po_number", "gl_code", "company_points"])).optional(),
        // Per-store currency for Stripe checkout. ISO 4217 lowercase.
        currency: z.enum(["usd", "cad"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const { id, ...updateData } = input;

      const existing = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, id), scope.stores))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      const oldStore = existing[0];

      // Activation gate — only fires on the transition to active. Re-saving
      // an already-active store with status: "active" is a no-op for this
      // check, so a later accidental logo-deletion doesn't block unrelated
      // field edits on an already-live store.
      if (input.status === "active" && oldStore.status !== "active") {
        await assertClientHasLogo(db, oldStore.clientId);
      }

      const aiEditableFields = ["aiTagline", "aiDescription", "welcomeMessage"] as const;
      const aiEdits: Array<{ fieldName: string; valueBefore: string | null; valueAfter: string }> = [];

      for (const field of aiEditableFields) {
        if (updateData[field] !== undefined && updateData[field] !== oldStore[field]) {
          aiEdits.push({
            fieldName: field,
            valueBefore: oldStore[field] || null,
            valueAfter: updateData[field] as string,
          });
        }
      }

      if (updateData.aiCategoryDescriptions && oldStore.aiCategoryDescriptions) {
        const oldCats = (typeof oldStore.aiCategoryDescriptions === "string"
          ? JSON.parse(oldStore.aiCategoryDescriptions)
          : oldStore.aiCategoryDescriptions) as Record<string, string>;
        for (const [cat, newDesc] of Object.entries(updateData.aiCategoryDescriptions)) {
          if (oldCats[cat] !== newDesc) {
            aiEdits.push({
              fieldName: `categoryDescription_${cat}`,
              valueBefore: oldCats[cat] || null,
              valueAfter: newDesc as string,
            });
          }
        }
      }

      const setObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (value !== undefined) setObj[key] = value;
      }

      if (Object.keys(setObj).length > 0) {
        await db.update(stores).set(setObj).where(and(eq(stores.id, id), scope.stores));
      }

      // 5c logo-change propagation: when stores.logoUrl changes, bulk-
      // flag every storeProducts row's product to webstoreRenderStatus
      // = 'pending' so the overlay falls back to CSS (with the new
      // logoUrl) immediately. Step 7 backfill drains 'pending' over
      // time. We do NOT enqueue render jobs here — that would flood
      // the queue with potentially thousands of jobs and create a
      // mixed-state window where some products show old renders and
      // some show CSS.
      if ("logoUrl" in setObj && setObj.logoUrl !== oldStore.logoUrl) {
        void flagPendingForStoreLogoChange(db, id);
      }

      if (aiEdits.length > 0 && oldStore.aiOptimizedAt) {
        try {
          const trainingRows = await db
            .select()
            .from(aiTrainingData)
            .where(and(
              eq(aiTrainingData.entityType, "store_optimization"),
              eq(aiTrainingData.entityId, id)
            ))
            .orderBy(desc(aiTrainingData.createdAt))
            .limit(1);

          const trainingDataId = trainingRows[0]?.id || 0;

          if (trainingRows[0]) {
            await db.update(aiTrainingData).set({
              wasEdited: true,
              wasAccepted: false,
            }).where(eq(aiTrainingData.id, trainingRows[0].id));
          }

          for (const edit of aiEdits) {
            await db.insert(aiEditFeedback).values({
              trainingDataId,
              entityType: "store_optimization",
              entityId: id,
              userId: ctx.user.id,
              organizationId: ctx.organizationId ?? null,
              fieldName: edit.fieldName,
              valueBefore: edit.valueBefore,
              valueAfter: edit.valueAfter,
              editType: edit.valueAfter ? "replace" : "delete",
            });
          }
          log.info(`Logged ${aiEdits.length} edit(s) for store ${id}`);
        } catch (feedbackErr) {
          log.warn("Failed to log edit feedback:", feedbackErr);
        }
      }

      const updated = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
      return updated[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, input.id), scope.stores))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const storeId = input.id;

      await db.transaction(async (tx) => {
        // ── Resolve dependent record IDs scoped to this store ────────────
        // We collect IDs up-front so child tables can be cleared by FK,
        // even though some grandchild rows have no direct storeId column.
        const proposalRows = await tx.select({ id: proposals.id }).from(proposals).where(eq(proposals.storeId, storeId));
        const proposalIds = proposalRows.map((r) => r.id);

        const orderRows = await tx.select({ id: orders.id }).from(orders).where(eq(orders.storeId, storeId));
        const orderIds = orderRows.map((r) => r.id);

        const proposalProductRows = proposalIds.length
          ? await tx.select({ id: proposalProducts.id }).from(proposalProducts).where(inArray(proposalProducts.proposalId, proposalIds))
          : [];
        const proposalProductIds = proposalProductRows.map((r) => r.id);

        const estimateRows = proposalIds.length
          ? await tx.select({ id: estimates.id }).from(estimates).where(inArray(estimates.proposalId, proposalIds))
          : [];
        const estimateIds = estimateRows.map((r) => r.id);

        const storeUserRows = await tx.select({ id: storeUsers.id }).from(storeUsers).where(eq(storeUsers.storeId, storeId));
        const storeUserIds = storeUserRows.map((r) => r.id);

        const promoCodeRows = await tx.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.storeId, storeId));
        const promoCodeIds = promoCodeRows.map((r) => r.id);

        // ── Purchase orders linked via this store's proposals or orders ─
        // purchaseOrderEvents cascade automatically via schema FK.
        const poConds = [];
        if (proposalIds.length) poConds.push(inArray(purchaseOrders.proposalId, proposalIds));
        if (orderIds.length) poConds.push(inArray(purchaseOrders.orderId, orderIds));
        if (poConds.length) {
          await tx.delete(purchaseOrders).where(poConds.length === 1 ? poConds[0] : or(...poConds));
        }

        // ── Invoices first (FK to proposals/estimates/orders, all nullable) ─
        const invConds = [];
        if (proposalIds.length) invConds.push(inArray(invoices.proposalId, proposalIds));
        if (estimateIds.length) invConds.push(inArray(invoices.estimateId, estimateIds));
        if (orderIds.length) invConds.push(inArray(invoices.orderId, orderIds));
        if (invConds.length) {
          await tx.delete(invoices).where(invConds.length === 1 ? invConds[0] : or(...invConds));
        }

        // ── Estimates (FK proposalId NOT NULL) ───────────────────────────
        if (proposalIds.length) {
          await tx.delete(estimates).where(inArray(estimates.proposalId, proposalIds));
        }

        // ── proposalProducts grandchildren ───────────────────────────────
        if (proposalProductIds.length) {
          await tx.delete(proposalProductVariants).where(inArray(proposalProductVariants.proposalProductId, proposalProductIds));
          await tx.delete(proposalPriceTiers).where(inArray(proposalPriceTiers.proposalProductId, proposalProductIds));
          await tx.delete(proposalProductImages).where(inArray(proposalProductImages.proposalProductId, proposalProductIds));
          await tx.delete(proposalSizeCharts).where(inArray(proposalSizeCharts.proposalProductId, proposalProductIds));
        }
        if (proposalIds.length) {
          await tx.delete(proposalOrderItems).where(inArray(proposalOrderItems.proposalId, proposalIds));
          await tx.delete(proposalProducts).where(inArray(proposalProducts.proposalId, proposalIds));
          await tx.delete(virtualProofs).where(inArray(virtualProofs.proposalId, proposalIds));
          await tx.delete(departmentApprovals).where(inArray(departmentApprovals.proposalId, proposalIds));
          await tx.delete(proposalVersions).where(inArray(proposalVersions.proposalId, proposalIds));
        }

        // ── refundRequests (FK storeId + proposalId, both NOT NULL) ──────
        await tx.delete(refundRequests).where(eq(refundRequests.storeId, storeId));

        // ── Proposals themselves ─────────────────────────────────────────
        await tx.delete(proposals).where(eq(proposals.storeId, storeId));

        // ── Orders + orderItems ──────────────────────────────────────────
        if (orderIds.length) {
          await tx.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
        }

        // ── promoCodeUsages (FK to promoCodes, storeUsers, orders) ───────
        const usageConds = [];
        if (promoCodeIds.length) usageConds.push(inArray(promoCodeUsages.promoCodeId, promoCodeIds));
        if (storeUserIds.length) usageConds.push(inArray(promoCodeUsages.storeUserId, storeUserIds));
        if (orderIds.length) usageConds.push(inArray(promoCodeUsages.orderId, orderIds));
        if (usageConds.length) {
          await tx.delete(promoCodeUsages).where(usageConds.length === 1 ? usageConds[0] : or(...usageConds));
        }

        await tx.delete(orders).where(eq(orders.storeId, storeId));

        // ── Other store-scoped child tables ──────────────────────────────
        await tx.delete(storeVerificationCodes).where(eq(storeVerificationCodes.storeId, storeId));
        await tx.delete(storeAllowedDomains).where(eq(storeAllowedDomains.storeId, storeId));
        await tx.delete(printRequests).where(eq(printRequests.storeId, storeId));
        await tx.delete(storePasswordTokens).where(eq(storePasswordTokens.storeId, storeId));
        await tx.delete(customOrderRequests).where(eq(customOrderRequests.storeId, storeId));
        await tx.delete(emailUnsubscribes).where(eq(emailUnsubscribes.storeId, storeId));

        // ── Originally-handled child tables ──────────────────────────────
        await tx.delete(storeUsers).where(eq(storeUsers.storeId, storeId));
        await tx.delete(storeDepartments).where(eq(storeDepartments.storeId, storeId));
        await tx.delete(storeIdentityProviders).where(eq(storeIdentityProviders.storeId, storeId));
        await tx.delete(promoCodes).where(eq(promoCodes.storeId, storeId));
        await tx.delete(storeProducts).where(eq(storeProducts.storeId, storeId));

        // ── Finally the store row ────────────────────────────────────────
        await tx.delete(stores).where(and(eq(stores.id, storeId), scope.stores));
      });
      return { success: true };
    }),

  /**
   * Lightweight per-store activity counts (order count + active member count).
   * Used by the Webstores list to annotate each row without having to load
   * full order/member tables.
   */
  getStats: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const [orderCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(orders)
        .where(eq(orders.storeId, input.storeId));
      const [userCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(storeUsers)
        .where(and(eq(storeUsers.storeId, input.storeId), isNull(storeUsers.deletedAt)));

      return {
        orders: Number(orderCount?.count ?? 0),
        users: Number(userCount?.count ?? 0),
      };
    }),

  /**
   * Monthly KPI time series for a single store, used by OverviewTab sparklines.
   * Excludes cancelled / refunded / payment_failed orders so trends reflect net GMV.
   * Returns N months of buckets, padded with zeros so missing months keep the
   * sparkline length stable.
   */
  kpiTimeSeries: protectedProcedure
    .input(z.object({
      storeId: z.number().int().positive(),
      months: z.number().int().min(1).max(24).default(6),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      // Compute window start: first day of (current month − months + 1).
      const now = new Date();
      const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - input.months + 1, 1));

      const rows = await db
        .select({
          ym: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
          gmv: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
          orderCount: sql<number>`COUNT(*)`,
        })
        .from(orders)
        .where(and(
          eq(orders.storeId, input.storeId),
          scope.orders,
          sql`${orders.status} NOT IN ('cancelled','refunded','payment_failed')`,
          sql`${orders.createdAt} >= ${windowStart}`,
        ))
        .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`);

      const byMonth = new Map(rows.map(r => [r.ym, r]));

      const series: Array<{ ym: string; gmvCents: number; orderCount: number }> = [];
      for (let i = 0; i < input.months; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - input.months + 1 + i, 1));
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        const row = byMonth.get(ym);
        series.push({
          ym,
          gmvCents: row ? Math.round(parseFloat(row.gmv) * 100) : 0,
          orderCount: row ? Number(row.orderCount) : 0,
        });
      }

      return { months: series };
    }),
});
