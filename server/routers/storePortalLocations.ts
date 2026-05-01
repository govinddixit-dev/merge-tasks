import { z } from "zod";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import {
  storeLocations,
  locationBrandingAssets,
  storeIdentityProviders,
  storeUsers,
} from "../../drizzle/schema";
import { resolveStoreSession } from "./storePortalAuth";

const storeSlugInput = z.object({ storeSlug: z.string() });

export const storePortalLocationsRouter = router({

  list: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      if (!["poc", "admin"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only POC or admin can manage locations" });
      }
      const rows = await db
        .select({ location: storeLocations, branding: locationBrandingAssets })
        .from(storeLocations)
        .leftJoin(locationBrandingAssets, eq(locationBrandingAssets.locationId, storeLocations.id))
        .where(eq(storeLocations.storeId, store.id))
        .orderBy(storeLocations.sortOrder);

      return rows.map((r) => ({ ...r.location, branding: r.branding ?? null }));
    }),

  upsertBranding: publicProcedure
    .input(storeSlugInput.extend({
      locationId: z.number().int().positive(),
      logoUrl: z.string().nullable().optional(),
      primaryColor: z.string().nullable().optional(),
      bannerUrl: z.string().nullable().optional(),
      bannerText: z.string().nullable().optional(),
      welcomeMessage: z.string().nullable().optional(),
      aiTagline: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      if (!["poc", "admin"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only POC or admin can update location branding" });
      }

      const [loc] = await db
        .select()
        .from(storeLocations)
        .where(and(eq(storeLocations.id, input.locationId), eq(storeLocations.storeId, store.id)))
        .limit(1);
      if (!loc) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });

      const [existing] = await db
        .select()
        .from(locationBrandingAssets)
        .where(eq(locationBrandingAssets.locationId, input.locationId))
        .limit(1);

      const brandingData = {
        logoUrl: input.logoUrl ?? null,
        primaryColor: input.primaryColor ?? null,
        bannerUrl: input.bannerUrl ?? null,
        bannerText: input.bannerText ?? null,
        welcomeMessage: input.welcomeMessage ?? null,
        aiTagline: input.aiTagline ?? null,
      };

      if (existing) {
        await db.update(locationBrandingAssets).set(brandingData).where(eq(locationBrandingAssets.id, existing.id));
      } else {
        await db.insert(locationBrandingAssets).values({ locationId: input.locationId, ...brandingData });
      }

      return { success: true };
    }),

  unmappedGroups: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      if (!["poc", "admin"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only POC or admin can view SSO health" });
      }

      const providers = await db
        .select()
        .from(storeIdentityProviders)
        .where(eq(storeIdentityProviders.storeId, store.id));

      if (providers.length === 0) return { unmapped: [], totalMapped: 0 };

      const mappedGroups = new Set<string>();
      for (const p of providers) {
        const map = (p.groupToLocationMap as Record<string, number> | null) ?? {};
        Object.keys(map).forEach((k) => mappedGroups.add(k));
      }

      const userGroups = await db
        .selectDistinct({ ssoGroup: storeUsers.ssoGroup })
        .from(storeUsers)
        .where(and(
          eq(storeUsers.storeId, store.id),
          isNotNull(storeUsers.ssoGroup),
        ));

      const unmapped = userGroups
        .filter((r) => r.ssoGroup && !mappedGroups.has(r.ssoGroup))
        .map((r) => ({ group: r.ssoGroup!, userCount: 0 }));

      const enriched = await Promise.all(unmapped.map(async (u) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(storeUsers)
          .where(and(
            eq(storeUsers.storeId, store.id),
            eq(storeUsers.ssoGroup, u.group),
          ));
        return { group: u.group, userCount: Number(count) };
      }));

      return { unmapped: enriched, totalMapped: mappedGroups.size };
    }),
});
