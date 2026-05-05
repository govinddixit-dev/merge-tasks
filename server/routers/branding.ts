/**
 * Branding router — distributor logo upload (with AI bg removal), brand colors, and display name.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { distributorProfiles } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { storagePut } from "../storage";
import { removeBackground } from "../utils/removeBackground";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";

const log = getLogger("branding");

export const brandingRouter = router({
  /**
   * Get the current distributor's branding settings.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

    const rows = await db
      .select()
      .from(distributorProfiles)
      .where(scope.distributorProfiles)
      .limit(1);

    if (rows.length === 0) {
      return {
        brandLogoUrl: null,
        brandLogoOriginalUrl: null,
        brandPrimaryColor: "#654BF9",
        brandSecondaryColor: "#1A1A1A",
        brandBannerColor: "#654BF9",
        brandCompanyName: null,
        companyAddress: null,
        companyPhone: null,
        companyEmail: null,
        companyWebsite: null,
      };
    }

    const p = rows[0];
    return {
      brandLogoUrl: p.brandLogoUrl,
      brandLogoOriginalUrl: p.brandLogoOriginalUrl,
      brandPrimaryColor: p.brandPrimaryColor || "#654BF9",
      brandSecondaryColor: p.brandSecondaryColor || "#1A1A1A",
      brandBannerColor: p.brandBannerColor || p.brandPrimaryColor || "#654BF9",
      // brandCompanyName is the explicit display name; fall back to the
      // onboarding companyName so PDFs aren't blank when only onboarding
      // was completed.
      brandCompanyName: p.brandCompanyName || p.companyName || null,
      companyAddress: p.companyAddress ?? null,
      companyPhone: p.companyPhone ?? null,
      companyEmail: p.companyEmail ?? null,
      companyWebsite: p.companyWebsite ?? null,
    };
  }),

  /**
   * Server-side proxy for the brand logo: fetches the stored URL on the
   * server and returns it as a base64 data URL the client can hand directly
   * to jsPDF.addImage. Browser-side fetches of the S3 URL fail under CORS,
   * so this avoids the round-trip entirely.
   */
  getLogoDataUrl: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const scope = getOrgScope(ctx);

    const [row] = await db
      .select({ brandLogoUrl: distributorProfiles.brandLogoUrl })
      .from(distributorProfiles)
      .where(scope.distributorProfiles)
      .limit(1);

    const logoUrl = row?.brandLogoUrl;
    if (!logoUrl) return { dataUrl: null as string | null };

    try {
      const res = await fetch(logoUrl);
      if (!res.ok) return { dataUrl: null };
      const contentType = res.headers.get("content-type") || "image/png";
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = contentType.split(";")[0].trim() || "image/png";
      return { dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    } catch (err) {
      log.warn("Failed to fetch logo for data URL conversion:", err);
      return { dataUrl: null };
    }
  }),

  /**
   * Update brand colors, banner color, and company display name.
   */
  update: protectedProcedure
    .input(
      z.object({
        brandPrimaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        brandSecondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        brandBannerColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        brandCompanyName: z.string().max(255).optional(),
        // Contact details surfaced on branded PDFs (PO/Estimate/Invoice headers)
        companyAddress: z.string().max(2000).optional(),
        companyPhone: z.string().max(40).optional(),
        companyEmail: z.string().max(320).optional(),
        companyWebsite: z.string().max(512).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(distributorProfiles)
        .where(scope.distributorProfiles)
        .limit(1);

      const updateData: Record<string, any> = {};
      if (input.brandPrimaryColor) updateData.brandPrimaryColor = input.brandPrimaryColor;
      if (input.brandSecondaryColor) updateData.brandSecondaryColor = input.brandSecondaryColor;
      if (input.brandBannerColor) updateData.brandBannerColor = input.brandBannerColor;
      if (input.brandCompanyName !== undefined) updateData.brandCompanyName = input.brandCompanyName;
      if (input.companyAddress !== undefined) updateData.companyAddress = input.companyAddress;
      if (input.companyPhone !== undefined) updateData.companyPhone = input.companyPhone;
      if (input.companyEmail !== undefined) updateData.companyEmail = input.companyEmail;
      if (input.companyWebsite !== undefined) updateData.companyWebsite = input.companyWebsite;

      if (existing.length > 0) {
        await db
          .update(distributorProfiles)
          .set(updateData)
          .where(scope.distributorProfiles);
      } else {
        await db.insert(distributorProfiles).values({
          ...scope.stamp,
          ...updateData,
        });
      }

      return { success: true };
    }),

  /**
   * Upload a logo — two-pass AI background removal:
   *   Pass 1: AI image generation strips the background
   *   Pass 2: AI vision detects residual bg color, sharp cleans it up pixel-by-pixel
   */
  uploadLogo: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string(), // base64-encoded image data (no data: prefix)
        mimeType: z.string().default("image/png"),
        fileName: z.string().default("logo.png"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const userId = ctx.user.id;
      const timestamp = Date.now();

      // 1. Upload original logo to S3
      const originalBuffer = Buffer.from(input.imageBase64, "base64");
      const { url: originalUrl } = await storagePut(
        `branding/${userId}/logo-original-${timestamp}.png`,
        originalBuffer,
        input.mimeType
      );

      // 2. Two-pass AI background removal
      let processedUrl = originalUrl; // fallback
      let bgRemoved = false;

      try {
        const result = await removeBackground({
          imageBuffer: originalBuffer,
          imageUrl: originalUrl,
          mimeType: input.mimeType,
        });

        processedUrl = result.url;
        bgRemoved = true;
        log.info(`Background removal complete for user ${userId}`);
      } catch (err) {
        log.warn("Background removal failed, using original:", err);
      }

      // 3. Save both URLs to the distributor profile
      const existing = await db
        .select()
        .from(distributorProfiles)
        .where(scope.distributorProfiles)
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(distributorProfiles)
          .set({
            brandLogoUrl: processedUrl,
            brandLogoOriginalUrl: originalUrl,
          })
          .where(scope.distributorProfiles);
      } else {
        await db.insert(distributorProfiles).values({
          ...scope.stamp,
          brandLogoUrl: processedUrl,
          brandLogoOriginalUrl: originalUrl,
        });
      }

      return {
        originalUrl,
        processedUrl,
        bgRemoved,
      };
    }),
});
