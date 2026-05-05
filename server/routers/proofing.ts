import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { virtualProofs, clientLogos, products, proposalProducts, productImprintZones, clients, type InsertVirtualProof, type InsertClientLogo } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { generateImage } from "../_core/imageGeneration";
import { storagePut } from "../storage";
import crypto from "crypto";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";
import { checkProofMonthlyLimit } from "../utils/planLimits";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { PROOFING_RENDER_LIMIT, PROOFING_BULK_LIMIT } from "../utils/rateLimiter";

const log = getLogger("proofing");

// Decoration method descriptions for AI prompts
const DECORATION_PROMPTS: Record<string, string> = {
  embroidery: "embroidered with visible thread texture, raised stitching patterns, dimensional thread work showing individual stitch lines, slight 3D depth and shadow from thread buildup, satin stitch and fill stitch details visible",
  screen_print: "screen printed with smooth ink laydown on the fabric surface, slight texture of ink sitting on top of the material, crisp clean edges, flat matte finish typical of plastisol ink",
  laser_engraving: "laser engraved with a precise etched appearance, showing the material underneath where the surface has been burned away, clean sharp edges, slight depth and contrast between engraved and unengraved areas",
  heat_transfer: "heat transfer vinyl applied with a slight glossy sheen, smooth vinyl texture, clean cut edges, sitting slightly above the fabric surface with a subtle dimensional quality",
  dtg: "direct-to-garment printed with ink absorbed into the fabric fibers, soft hand feel appearance, colors slightly muted by fabric texture showing through, no raised texture",
  sublimation: "sublimation dye printed with vibrant colors fully integrated into the material, no texture difference between printed and unprinted areas, photographic quality, colors appear to be part of the material itself",
  deboss: "debossed with an impressed/indented design pressed into the material surface, showing depth and shadow within the impression, clean edges where material has been compressed",
  patch: "as a sewn-on embroidered patch with visible patch edges, merrowed border stitching around the perimeter, slightly raised from the garment surface, patch backing visible at edges",
};

// AI decoration suggestion based on product category
const DECORATION_SUGGESTIONS: Record<string, string> = {
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

function suggestDecoration(category: string, productName: string): string {
  const name = productName.toLowerCase();
  if (name.includes("polo") || name.includes("sweater") || name.includes("jacket") || name.includes("hat") || name.includes("cap")) return "embroidery";
  if (name.includes("t-shirt") || name.includes("tee") || name.includes("hoodie")) return "dtg";
  if (name.includes("tumbler") || name.includes("flask") || name.includes("rambler") || name.includes("bottle")) return "laser_engraving";
  if (name.includes("mug") || name.includes("cup")) return "sublimation";
  if (name.includes("notebook") || name.includes("journal") || name.includes("planner")) return "deboss";
  if (name.includes("pen") || name.includes("stylus")) return "laser_engraving";
  if (name.includes("speaker") || name.includes("charger") || name.includes("power bank")) return "laser_engraving";
  if (name.includes("tote") || name.includes("backpack") || name.includes("duffel")) return "screen_print";
  return DECORATION_SUGGESTIONS[category.toLowerCase()] || "screen_print";
}

export const proofingRouter = router({
  //  Client Logo Library 

  listClientLogos: protectedProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      return db
        .select()
        .from(clientLogos)
        .where(and(eq(clientLogos.clientId, input.clientId), scope.clientLogos))
        .orderBy(desc(clientLogos.createdAt));
    }),

  uploadClientLogo: protectedProcedure
    .input(z.object({
      clientId: z.number(),
      fileName: z.string(),
      fileData: z.string(),
      mimeType: z.string().optional(),
      fileSize: z.number().optional(),
      isPrimary: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const buffer = Buffer.from(input.fileData, "base64");
      const ext = input.fileName.split(".").pop()?.toLowerCase() || "png";
      const key = `client-logos/${ctx.user.id}/${input.clientId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType || "image/png");
      if (input.isPrimary) {
        await db.update(clientLogos).set({ isPrimary: false })
          .where(and(eq(clientLogos.clientId, input.clientId), scope.clientLogos));
      }
      const values: InsertClientLogo = {
        ...scope.stamp, clientId: input.clientId, logoUrl: url,
        logoName: input.fileName, fileSize: input.fileSize ?? buffer.length,
        mimeType: input.mimeType || "image/png", isPrimary: input.isPrimary ?? false,
      };
      const result = await db.insert(clientLogos).values(values);
      const id = result[0].insertId;
      const created = await db.select().from(clientLogos).where(eq(clientLogos.id, id)).limit(1);
      return created[0];
    }),

  uploadLogo: protectedProcedure
    .input(z.object({ fileName: z.string(), fileData: z.string(), mimeType: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileData, "base64");
      const ext = input.fileName.split(".").pop()?.toLowerCase() || "png";
      const key = `logos/${ctx.user.id}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType || "image/png");
      return { url, key };
    }),

  setPrimaryLogo: protectedProcedure
    .input(z.object({ logoId: z.number(), clientId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      // Use transaction to atomically clear old primary and set new one
      await db.transaction(async (tx) => {
        await tx.update(clientLogos).set({ isPrimary: false })
          .where(and(eq(clientLogos.clientId, input.clientId), scope.clientLogos));
        await tx.update(clientLogos).set({ isPrimary: true })
          .where(and(eq(clientLogos.id, input.logoId), scope.clientLogos));
      });
      return { success: true };
    }),

  deleteClientLogo: protectedProcedure
    .input(z.object({ logoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const existing = await db.select().from(clientLogos)
        .where(and(eq(clientLogos.id, input.logoId), scope.clientLogos)).limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Logo not found" });
      await db.delete(clientLogos).where(eq(clientLogos.id, input.logoId));
      return { success: true };
    }),

  //  Virtual Proofs 

  list: protectedProcedure
    .input(z.object({
      proposalId: z.number().optional(),
      clientId: z.number().optional(),
      status: z.enum(["draft", "rendering", "ready", "approved", "revision_requested"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      let rows = await db.select().from(virtualProofs)
        .where(scope.virtualProofs)
        .orderBy(desc(virtualProofs.updatedAt));
      if (input?.proposalId) rows = rows.filter(p => p.proposalId === input.proposalId);
      if (input?.clientId) rows = rows.filter(p => p.clientId === input.clientId);
      if (input?.status) rows = rows.filter(p => p.status === input.status);
      return rows;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const rows = await db.select().from(virtualProofs)
        .where(and(eq(virtualProofs.id, input.id), scope.virtualProofs)).limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proof not found" });
      return rows[0];
    }),

  create: protectedProcedure
    .input(z.object({
      productId: z.number().optional(),
      proposalId: z.number().optional(),
      clientId: z.number().optional(),
      productName: z.string().min(1),
      productImageUrl: z.string().optional(),
      logoUrl: z.string().optional(),
      logoName: z.string().optional(),
      decorationMethod: z.enum([
        "embroidery", "screen_print", "laser_engraving",
        "heat_transfer", "dtg", "sublimation", "deboss", "patch"
      ]),
      decorationZone: z.string().optional(),
      imprintZoneId: z.number().int().positive().nullable().optional(),
      placementData: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      // Enforce monthly proof limit inside transaction
      let insertId!: number;
      await db.transaction(async (tx) => {
        await checkProofMonthlyLimit(tx, scope, ctx.user.subscriptionTier);
        const values: InsertVirtualProof = {
          userId: ctx.user.id,
          organizationId: ctx.organizationId ?? null,
          productId: input.productId ?? null,
          proposalId: input.proposalId ?? null,
          clientId: input.clientId ?? null,
          productName: input.productName,
          productImageUrl: input.productImageUrl ?? null,
          logoUrl: input.logoUrl ?? null,
          logoName: input.logoName ?? null,
          decorationMethod: input.decorationMethod,
          decorationZone: input.decorationZone ?? "front",
          imprintZoneId: input.imprintZoneId ?? null,
          placementData: input.placementData ?? null,
          status: "draft",
        };
        const result = await tx.insert(virtualProofs).values(values);
        insertId = result[0].insertId;
      });
      const created = await db.select().from(virtualProofs).where(eq(virtualProofs.id, insertId)).limit(1);
      return created[0];
    }),

  //  Bulk Create — create proof records for multiple products at once
  bulkCreate: protectedProcedure
    .input(z.object({
      proposalId: z.number().optional(),
      clientId: z.number().optional(),
      logoUrl: z.string().optional(),
      logoName: z.string().optional(),
      productIds: z.array(z.number()).min(1).max(100),
      // Optional explicit zone override — applied to every generated proof.
      // When omitted and proposalId is set, each proof's imprintZoneId is
      // auto-resolved from the matching proposalProducts row.
      imprintZoneId: z.number().int().positive().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Fetch product details (scoped)
      const allProducts = await db.select().from(products)
        .where(scope.products);
      const productMap = new Map(allProducts.map(p => [p.id, p]));

      // Auto-resolve imprintZoneId per product by looking up the matching
      // proposalProducts row. Ambiguity note: proposalProducts has no
      // uniqueness on (proposalId, productId), so if the same product
      // appears twice we take the first row's zone. Explicit input.imprintZoneId
      // always wins over the lookup.
      const zoneByProductId = new Map<number, number>();
      if (input.proposalId && input.imprintZoneId == null) {
        const ppRows = await db
          .select({
            productId: proposalProducts.productId,
            imprintZoneId: proposalProducts.imprintZoneId,
          })
          .from(proposalProducts)
          .where(and(
            eq(proposalProducts.proposalId, input.proposalId),
            inArray(proposalProducts.productId, input.productIds),
          ));
        for (const pp of ppRows) {
          if (pp.imprintZoneId != null && !zoneByProductId.has(pp.productId)) {
            zoneByProductId.set(pp.productId, pp.imprintZoneId);
          }
        }
      }

      // Build all values upfront
      const allValues: InsertVirtualProof[] = [];
      for (const productId of input.productIds) {
        const product = productMap.get(productId);
        if (!product) continue;

        const suggestedMethod = suggestDecoration(product.category || "other", product.name);
        allValues.push({
          userId: ctx.user.id,
          organizationId: ctx.organizationId ?? null,
          productId: product.id,
          proposalId: input.proposalId ?? null,
          clientId: input.clientId ?? null,
          productName: product.name,
          productImageUrl: product.imageUrl ?? null,
          logoUrl: input.logoUrl ?? null,
          logoName: input.logoName ?? null,
          decorationMethod: suggestedMethod as "embroidery" | "screen_print" | "laser_engraving" | "heat_transfer" | "dtg" | "sublimation" | "deboss" | "patch",
          decorationZone: "front",
          imprintZoneId: input.imprintZoneId ?? zoneByProductId.get(product.id) ?? null,
          placementData: JSON.stringify({ position: { x: 50, y: 40 }, size: 30, rotation: 0 }),
          status: "draft",
        });
      }

      if (allValues.length === 0) return [];

      // H8: Check limit + insert inside same transaction to prevent TOCTOU race
      const createdProofs = await db.transaction(async (tx) => {
        await checkProofMonthlyLimit(tx, scope, ctx.user.subscriptionTier);

        // H6: Batch insert instead of N+1
        const result = await tx.insert(virtualProofs).values(allValues);
        const firstId = result[0].insertId;
        const insertedIds = allValues.map((_, i) => firstId + i);

        return tx.select().from(virtualProofs)
          .where(inArray(virtualProofs.id, insertedIds));
      });

      return createdProofs;
    }),

  //  Bulk Render — render all draft proofs for a proposal 
  bulkRender: protectedProcedure
    .use(rateLimited("proofing.bulkRender", PROOFING_BULK_LIMIT))
    .input(z.object({
      proofIds: z.array(z.number()).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const results: Array<{ id: number; status: string; proofImageUrl: string | null; error?: string }> = [];

      // H7: Pre-fetch all proofs and client names in batch to avoid N+1
      const allProofs = await db.select().from(virtualProofs)
        .where(and(inArray(virtualProofs.id, input.proofIds), scope.virtualProofs));
      const proofMap = new Map(allProofs.map(p => [p.id, p]));

      const clientIds = Array.from(new Set(allProofs.map(p => p.clientId).filter((id): id is number => id !== null)));
      const clientNameMap = new Map<number, string>();
      if (clientIds.length > 0) {
        const clientRows = await db.select({ id: clients.id, companyName: clients.companyName })
          .from(clients).where(inArray(clients.id, clientIds));
        for (const c of clientRows) clientNameMap.set(c.id, c.companyName);
      }

      // Batched zone-label lookup for proofs that carry an imprintZoneId.
      // The label replaces the legacy hardcoded enum-to-phrase mapping in the
      // AI prompt. Proofs without an imprintZoneId fall through to the old
      // decorationZone string.
      const zoneIds = Array.from(new Set(
        allProofs.map(p => p.imprintZoneId).filter((id): id is number => id !== null)
      ));
      const zoneLabelById = new Map<number, string>();
      if (zoneIds.length > 0) {
        const zoneRows = await db
          .select({ id: productImprintZones.id, label: productImprintZones.label })
          .from(productImprintZones)
          .where(inArray(productImprintZones.id, zoneIds));
        for (const z of zoneRows) zoneLabelById.set(z.id, z.label);
      }

      for (const proofId of input.proofIds) {
        try {
          const proof = proofMap.get(proofId);
          if (!proof) {
            results.push({ id: proofId, status: "error", proofImageUrl: null, error: "Not found" });
            continue;
          }

          // Update status to rendering
          await db.update(virtualProofs).set({ status: "rendering" }).where(eq(virtualProofs.id, proof.id));

          const clientCompanyName = proof.clientId ? (clientNameMap.get(proof.clientId) || "") : "";

          const decorationDesc = DECORATION_PROMPTS[proof.decorationMethod] || "printed on";
          const zoneLabel = proof.imprintZoneId ? zoneLabelById.get(proof.imprintZoneId) : null;
          const zoneDesc = zoneLabel
            ? `on the ${zoneLabel.toLowerCase()}`
            : proof.decorationZone === "front" ? "on the front center" :
              proof.decorationZone === "back" ? "on the back center" :
              proof.decorationZone === "left_sleeve" ? "on the left sleeve" :
              proof.decorationZone === "right_sleeve" ? "on the right sleeve" :
              proof.decorationZone === "pocket" ? "on the left chest pocket area" : "on the front";

          const brandContext = clientCompanyName ? ` for ${clientCompanyName}` : "";
          const logoContext = proof.logoUrl ? " Use the provided logo image as the exact artwork to apply onto the product." : "";
          const prompt = `Professional product photography of a ${proof.productName}${brandContext} with the company's logo/branding ${decorationDesc} ${zoneDesc}. The decoration should look photorealistic and true to the actual ${proof.decorationMethod.replace("_", " ")} method.${logoContext} Studio lighting, white background, high-resolution product mockup suitable for a client presentation. The decoration should be clearly visible, properly scaled, and look like a real finished product — not a digital overlay or floating graphic.`;

          const originalImages: Array<{ url: string; mimeType: string }> = [];
          const isValidImageUrl = (url: string | null | undefined): url is string => {
            if (!url) return false;
            if (url.includes('flaticon.com') || url.includes('placeholder') || url.includes('via.placeholder')) return false;
            try { new URL(url); return true; } catch { return false; }
          };
          if (isValidImageUrl(proof.logoUrl)) originalImages.push({ url: proof.logoUrl, mimeType: "image/png" });
          if (isValidImageUrl(proof.productImageUrl)) originalImages.push({ url: proof.productImageUrl, mimeType: "image/png" });

          const result = await generateImage({
            prompt,
            originalImages: originalImages.length > 0 ? originalImages : undefined,
          });

          await db.update(virtualProofs).set({ proofImageUrl: result.url || null, status: "ready" })
            .where(eq(virtualProofs.id, proof.id));

          results.push({ id: proof.id, status: "ready", proofImageUrl: result.url || null });
        } catch (error) {
          log.error(`Bulk render failed for proof ${proofId}:`, error);
          await db.update(virtualProofs).set({ status: "draft" }).where(eq(virtualProofs.id, proofId));
          results.push({ id: proofId, status: "error", proofImageUrl: null, error: error instanceof Error ? error.message : "Unknown error" });
        }
      }

      return results;
    }),

  //  Approve All — approve all ready proofs for a proposal 
  approveAll: protectedProcedure
    .input(z.object({
      proposalId: z.number().optional(),
      proofIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      let proofRows: (typeof virtualProofs.$inferSelect)[];
      if (input.proofIds && input.proofIds.length > 0) {
        proofRows = await db.select().from(virtualProofs)
          .where(and(scope.virtualProofs));
        proofRows = proofRows.filter(p => input.proofIds!.includes(p.id) && p.status === "ready");
      } else if (input.proposalId) {
        proofRows = await db.select().from(virtualProofs)
          .where(and(scope.virtualProofs, eq(virtualProofs.proposalId, input.proposalId)));
        proofRows = proofRows.filter(p => p.status === "ready");
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide proposalId or proofIds" });
      }

      const now = new Date();
      for (const proof of proofRows) {
        await db.update(virtualProofs).set({ status: "approved", approvedAt: now }).where(eq(virtualProofs.id, proof.id));
      }

      return { approved: proofRows.length };
    }),

  //  Get proposal products with proof status 
  getProposalProofStatus: protectedProcedure
    .input(z.object({ proposalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Get proposal products
      const ppRows = await db.select().from(proposalProducts)
        .where(eq(proposalProducts.proposalId, input.proposalId));

      // Get all proofs for this proposal
      const proofRows = await db.select().from(virtualProofs)
        .where(and(scope.virtualProofs, eq(virtualProofs.proposalId, input.proposalId)));

      // Get product details
      const productIds = ppRows.map(pp => pp.productId);
      const productRows = productIds.length > 0
        ? await db.select().from(products).where(scope.products)
        : [];
      const productMap = new Map(productRows.map(p => [p.id, p]));

      // Map: for each proposal product, find matching proof
      const proofMap = new Map(proofRows.map(p => [p.productId, p]));

      return ppRows.map(pp => {
        const product = productMap.get(pp.productId);
        const proof = proofMap.get(pp.productId);
        return {
          proposalProductId: pp.id,
          productId: pp.productId,
          productName: product?.name || "Unknown Product",
          productImageUrl: product?.imageUrl || null,
          category: product?.category || "other",
          quantity: pp.quantity,
          unitPrice: pp.unitPrice,
          decorationType: pp.decorationType,
          proof: proof ? {
            id: proof.id,
            status: proof.status,
            proofImageUrl: proof.proofImageUrl,
            decorationMethod: proof.decorationMethod,
            decorationZone: proof.decorationZone,
            approvedAt: proof.approvedAt,
          } : null,
        };
      });
    }),

  renderProof: protectedProcedure
    .use(rateLimited("proofing.renderProof", PROOFING_RENDER_LIMIT))
    .input(z.object({ proofId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const rows = await db.select().from(virtualProofs)
        .where(and(eq(virtualProofs.id, input.proofId), scope.virtualProofs)).limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proof not found" });
      const proof = rows[0];
      await db.update(virtualProofs).set({ status: "rendering" }).where(eq(virtualProofs.id, proof.id));
      try {
        // Look up client company name for branding context
        let clientCompanyName = "";
        if (proof.clientId) {
          const clientRows = await db.select().from(clients).where(eq(clients.id, proof.clientId)).limit(1);
          if (clientRows.length > 0) clientCompanyName = clientRows[0].companyName;
        }

        const decorationDesc = DECORATION_PROMPTS[proof.decorationMethod] || "printed on";
        // Zone label from the FK when present; fall back to legacy decorationZone string.
        let zoneLabel: string | null = null;
        if (proof.imprintZoneId) {
          const [z] = await db
            .select({ label: productImprintZones.label })
            .from(productImprintZones)
            .where(eq(productImprintZones.id, proof.imprintZoneId))
            .limit(1);
          zoneLabel = z?.label ?? null;
        }
        const zoneDesc = zoneLabel
          ? `on the ${zoneLabel.toLowerCase()}`
          : proof.decorationZone === "front" ? "on the front center" :
            proof.decorationZone === "back" ? "on the back center" :
            proof.decorationZone === "left_sleeve" ? "on the left sleeve" :
            proof.decorationZone === "right_sleeve" ? "on the right sleeve" :
            proof.decorationZone === "pocket" ? "on the left chest pocket area" : "on the front";
        const brandContext = clientCompanyName ? ` for ${clientCompanyName}` : "";
        const logoContext = proof.logoUrl ? " Use the provided logo image as the exact artwork to apply onto the product." : "";
        const prompt = `Professional product photography of a ${proof.productName}${brandContext} with the company's logo/branding ${decorationDesc} ${zoneDesc}. The decoration should look photorealistic and true to the actual ${proof.decorationMethod.replace("_", " ")} method.${logoContext} Studio lighting, white background, high-resolution product mockup suitable for a client presentation. The decoration should be clearly visible, properly scaled, and look like a real finished product — not a digital overlay or floating graphic.`;
        const originalImages: Array<{ url: string; mimeType: string }> = [];
        const isValidImageUrl = (url: string | null | undefined): url is string => {
          if (!url) return false;
          if (url.includes('flaticon.com') || url.includes('placeholder') || url.includes('via.placeholder')) return false;
          try { new URL(url); return true; } catch { return false; }
        };
        if (isValidImageUrl(proof.logoUrl)) originalImages.push({ url: proof.logoUrl, mimeType: "image/png" });
        if (isValidImageUrl(proof.productImageUrl)) originalImages.push({ url: proof.productImageUrl, mimeType: "image/png" });
        const result = await generateImage({
          prompt,
          originalImages: originalImages.length > 0 ? originalImages : undefined,
        });
        await db.update(virtualProofs).set({ proofImageUrl: result.url || null, status: "ready" })
          .where(eq(virtualProofs.id, proof.id));
        const updated = await db.select().from(virtualProofs).where(eq(virtualProofs.id, proof.id)).limit(1);
        return updated[0];
      } catch (error) {
        await db.update(virtualProofs).set({ status: "draft" }).where(eq(virtualProofs.id, proof.id));
        log.error("AI rendering failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Proof rendering failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["approved", "revision_requested"]),
      revisionNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const existing = await db.select().from(virtualProofs)
        .where(and(eq(virtualProofs.id, input.id), scope.virtualProofs)).limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proof not found" });
      const setObj: Record<string, unknown> = { status: input.status };
      if (input.status === "approved") setObj.approvedAt = new Date();
      if (input.revisionNotes) setObj.revisionNotes = input.revisionNotes;
      await db.update(virtualProofs).set(setObj).where(eq(virtualProofs.id, input.id));
      const updated = await db.select().from(virtualProofs).where(eq(virtualProofs.id, input.id)).limit(1);
      return updated[0];
    }),

  updatePlacement: protectedProcedure
    .input(z.object({
      id: z.number(),
      placementData: z.string(),
      decorationZone: z.string().optional(),
      decorationMethod: z.enum([
        "embroidery", "screen_print", "laser_engraving",
        "heat_transfer", "dtg", "sublimation", "deboss", "patch"
      ]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const existing = await db.select().from(virtualProofs)
        .where(and(eq(virtualProofs.id, input.id), scope.virtualProofs)).limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proof not found" });
      const setObj: Record<string, unknown> = { placementData: input.placementData };
      if (input.decorationZone) setObj.decorationZone = input.decorationZone;
      if (input.decorationMethod) setObj.decorationMethod = input.decorationMethod;
      await db.update(virtualProofs).set(setObj).where(eq(virtualProofs.id, input.id));
      const updated = await db.select().from(virtualProofs).where(eq(virtualProofs.id, input.id)).limit(1);
      return updated[0];
    }),

  //  Revise Proof — re-render with revision notes incorporated into the AI prompt 
  reviseProof: protectedProcedure
    .input(z.object({
      proofId: z.number(),
      revisionNotes: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const rows = await db.select().from(virtualProofs)
        .where(and(eq(virtualProofs.id, input.proofId), scope.virtualProofs)).limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proof not found" });
      const proof = rows[0];

      // Save revision notes and set status to rendering
      await db.update(virtualProofs).set({
        status: "rendering",
        revisionNotes: input.revisionNotes,
      }).where(eq(virtualProofs.id, proof.id));

      try {
        // Look up client company name
        let clientCompanyName = "";
        if (proof.clientId) {
          const clientRows = await db.select().from(clients).where(eq(clients.id, proof.clientId)).limit(1);
          if (clientRows.length > 0) clientCompanyName = clientRows[0].companyName;
        }

        const decorationDesc = DECORATION_PROMPTS[proof.decorationMethod] || "printed on";
        // Zone label from the FK when present; fall back to legacy decorationZone string.
        let zoneLabel: string | null = null;
        if (proof.imprintZoneId) {
          const [z] = await db
            .select({ label: productImprintZones.label })
            .from(productImprintZones)
            .where(eq(productImprintZones.id, proof.imprintZoneId))
            .limit(1);
          zoneLabel = z?.label ?? null;
        }
        const zoneDesc = zoneLabel
          ? `on the ${zoneLabel.toLowerCase()}`
          : proof.decorationZone === "front" ? "on the front center" :
            proof.decorationZone === "back" ? "on the back center" :
            proof.decorationZone === "left_sleeve" ? "on the left sleeve" :
            proof.decorationZone === "right_sleeve" ? "on the right sleeve" :
            proof.decorationZone === "pocket" ? "on the left chest pocket area" : "on the front";
        const brandContext = clientCompanyName ? ` for ${clientCompanyName}` : "";
        const logoContext = proof.logoUrl ? " Use the provided logo image as the exact artwork to apply onto the product." : "";

        // Include revision notes directly in the prompt so the AI adjusts
        const revisionInstruction = ` IMPORTANT REVISION REQUEST: ${input.revisionNotes}. Please adjust the mockup accordingly.`;

        const prompt = `Professional product photography of a ${proof.productName}${brandContext} with the company's logo/branding ${decorationDesc} ${zoneDesc}. The decoration should look photorealistic and true to the actual ${proof.decorationMethod.replace("_", " ")} method.${logoContext} Studio lighting, white background, high-resolution product mockup suitable for a client presentation. The decoration should be clearly visible, properly scaled, and look like a real finished product \u2014 not a digital overlay or floating graphic.${revisionInstruction}`;

        const originalImages: Array<{ url: string; mimeType: string }> = [];
        const isValidImageUrl = (url: string | null | undefined): url is string => {
          if (!url) return false;
          if (url.includes('flaticon.com') || url.includes('placeholder') || url.includes('via.placeholder')) return false;
          try { new URL(url); return true; } catch { return false; }
        };
        if (isValidImageUrl(proof.logoUrl)) originalImages.push({ url: proof.logoUrl, mimeType: "image/png" });
        if (isValidImageUrl(proof.productImageUrl)) originalImages.push({ url: proof.productImageUrl, mimeType: "image/png" });
        // Also include the previous proof as reference so AI can see what to revise
        if (isValidImageUrl(proof.proofImageUrl)) originalImages.push({ url: proof.proofImageUrl, mimeType: "image/png" });

        const result = await generateImage({
          prompt,
          originalImages: originalImages.length > 0 ? originalImages : undefined,
        });

        await db.update(virtualProofs).set({ proofImageUrl: result.url || null, status: "ready" })
          .where(eq(virtualProofs.id, proof.id));

        const updated = await db.select().from(virtualProofs).where(eq(virtualProofs.id, proof.id)).limit(1);
        return updated[0];
      } catch (error) {
        await db.update(virtualProofs).set({ status: "revision_requested" }).where(eq(virtualProofs.id, proof.id));
        log.error("Revision render failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Revision rendering failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const existing = await db.select().from(virtualProofs)
        .where(and(eq(virtualProofs.id, input.id), scope.virtualProofs)).limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proof not found" });
      await db.delete(virtualProofs).where(eq(virtualProofs.id, input.id));
      return { success: true };
    }),
});
