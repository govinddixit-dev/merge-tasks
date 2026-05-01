/**
 * Store SSO Router — tRPC procedures for managing IdP configurations.
 *
 * Provides CRUD for store identity providers (SAML / OIDC) and a domain
 * check endpoint used by the login page to determine if SSO should be offered.
 *
 * SECURITY: All management procedures verify that the target store belongs
 * to the caller's organization (or userId when no org exists). Without this
 * check, any authenticated user could CRUD any store's SSO configuration.
 *
 * Gap Report fix PO-6: Added verifyStoreOwnership() guard to list, create,
 * update, and delete procedures.
 */
import { z } from "zod";
import { eq, and, type SQL } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { stores, storeIdentityProviders } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { encryptCredential, decryptCredential } from "../utils/encryption";
import { auditLog } from "../utils/auditLog";
import { getLogger } from "../utils/logger";
import { sendSsoOnboardingEmail } from "../email/sendSsoOnboardingEmail";

const log = getLogger("storeSso");

// ── Helpers ──────────────────────────────────────────────

/**
 * Verify that the given storeId belongs to the calling user's tenant.
 * Throws FORBIDDEN if the store does not exist or does not belong to them.
 */
async function verifyStoreOwnership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  storeId: number,
  userId: number,
  organizationId: number | null,
) {
  const ownershipConditions: SQL[] = [eq(stores.id, storeId)];

  if (organizationId != null) {
    ownershipConditions.push(eq(stores.organizationId, organizationId));
  } else {
    ownershipConditions.push(eq(stores.userId, userId));
  }

  const storeRows = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(and(...ownershipConditions))
    .limit(1);

  if (storeRows.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Store not found or not authorized",
    });
  }

  return storeRows[0];
}

/**
 * Given an IdP id, look it up and verify the linked store belongs to the caller.
 * Returns both the IdP row and the store row.
 */
async function verifyIdpOwnership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  idpId: number,
  userId: number,
  organizationId: number | null,
) {
  const idpRows = await db
    .select()
    .from(storeIdentityProviders)
    .where(eq(storeIdentityProviders.id, idpId))
    .limit(1);

  if (idpRows.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "IdP configuration not found",
    });
  }

  const idp = idpRows[0];
  const store = await verifyStoreOwnership(db, idp.storeId, userId, organizationId);
  return { idp, store };
}

// ── Router ───────────────────────────────────────────────

export const storeSsoRouter = router({
  /**
   * List all IdP configurations for a store.
   * Returns configs with OIDC client secrets masked.
   */
  list: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // PO-6: Verify caller owns this store
      await verifyStoreOwnership(db, input.storeId, ctx.user.id, ctx.organizationId);

      const idps = await db
        .select()
        .from(storeIdentityProviders)
        .where(eq(storeIdentityProviders.storeId, input.storeId));

      // Mask secrets before returning
      return idps.map((idp) => ({
        ...idp,
        oidcClientSecret: idp.oidcClientSecret ? "••••••••" : null,
        samlCertificate: idp.samlCertificate
          ? `${idp.samlCertificate.slice(0, 40)}...`
          : null,
      }));
    }),

  /**
   * Create a new IdP configuration for a store.
   */
  create: protectedProcedure
    .input(
      z.object({
        storeId: z.number(),
        name: z.string().min(1).max(255),
        protocol: z.enum(["saml", "oidc"]),
        domain: z.string().min(1).max(255),
        // SAML fields
        samlEntryPoint: z.string().optional(),
        samlCertificate: z.string().optional(),
        samlIssuer: z.string().optional(),
        // OIDC fields
        oidcDiscoveryUrl: z.string().optional(),
        oidcClientId: z.string().optional(),
        oidcClientSecret: z.string().optional(),
        // Multi-division routing (optional)
        targetStoreId: z.number().int().positive().nullable().optional(),
        defaultDepartmentId: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // PO-6: Verify caller owns this store
      const store = await verifyStoreOwnership(
        db,
        input.storeId,
        ctx.user.id,
        ctx.organizationId,
      );

      // If a targetStoreId is supplied, verify the caller also owns it so
      // we never create a cross-tenant redirect.
      if (input.targetStoreId) {
        await verifyStoreOwnership(db, input.targetStoreId, ctx.user.id, ctx.organizationId);
      }

      // Check for duplicate domain
      const existing = await db
        .select()
        .from(storeIdentityProviders)
        .where(
          and(
            eq(storeIdentityProviders.storeId, input.storeId),
            eq(storeIdentityProviders.domain, input.domain.toLowerCase()),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Domain "${input.domain}" is already configured for this store`,
        });
      }

      // Encrypt OIDC client secret if provided
      const encryptedSecret = input.oidcClientSecret
        ? encryptCredential(input.oidcClientSecret)
        : null;

      await db.insert(storeIdentityProviders).values({
        storeId: input.storeId,
        name: input.name,
        protocol: input.protocol,
        domain: input.domain.toLowerCase(),
        samlEntryPoint: input.samlEntryPoint || null,
        samlCertificate: input.samlCertificate || null,
        samlIssuer: input.samlIssuer || null,
        oidcDiscoveryUrl: input.oidcDiscoveryUrl || null,
        oidcClientId: input.oidcClientId || null,
        oidcClientSecret: encryptedSecret,
        targetStoreId: input.targetStoreId ?? null,
        defaultDepartmentId: input.defaultDepartmentId ?? null,
        enabled: true,
      });

      auditLog({
        action: "sso.idp.created",
        userId: ctx.user.id,
        actorEmail: ctx.user.email ?? undefined,
        resourceType: "storeIdentityProvider",
        description: `Created ${input.protocol.toUpperCase()} IdP "${input.name}" for store ${input.storeId} (domain: ${input.domain})`,
        metadata: {
          storeId: input.storeId,
          protocol: input.protocol,
          domain: input.domain,
        },
      });

      // Send SSO onboarding email with branded guide attached
      if (ctx.user.email) {
        const baseUrl =
          process.env.APP_BASE_URL ||
          `http://localhost:${process.env.PORT || 3000}`;
        sendSsoOnboardingEmail({
          distributorEmail: ctx.user.email,
          distributorName: ctx.user.name || "there",
          storeName: store.name || "your store",
          providerName: input.name,
          protocol: input.protocol,
          domain: input.domain,
          storeUrl: `${baseUrl}/stores/${input.storeId}/edit`,
        }).catch((err) =>
          log.error("Failed to send SSO onboarding email:", err),
        );
      }

      return { success: true };
    }),

  /**
   * Update an existing IdP configuration.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        domain: z.string().min(1).max(255).optional(),
        enabled: z.boolean().optional(),
        // SAML fields
        samlEntryPoint: z.string().optional(),
        samlCertificate: z.string().optional(),
        samlIssuer: z.string().optional(),
        // OIDC fields
        oidcDiscoveryUrl: z.string().optional(),
        oidcClientId: z.string().optional(),
        oidcClientSecret: z.string().optional(),
        // Multi-division routing (optional, nullable to allow clearing)
        targetStoreId: z.number().int().positive().nullable().optional(),
        defaultDepartmentId: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // PO-6: Verify caller owns the store this IdP belongs to
      const { idp } = await verifyIdpOwnership(
        db,
        input.id,
        ctx.user.id,
        ctx.organizationId,
      );

      const updates: Record<string, any> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.domain !== undefined) updates.domain = input.domain.toLowerCase();
      if (input.enabled !== undefined) updates.enabled = input.enabled;
      if (input.samlEntryPoint !== undefined) updates.samlEntryPoint = input.samlEntryPoint;
      if (input.samlCertificate !== undefined) updates.samlCertificate = input.samlCertificate;
      if (input.samlIssuer !== undefined) updates.samlIssuer = input.samlIssuer;
      if (input.oidcDiscoveryUrl !== undefined) updates.oidcDiscoveryUrl = input.oidcDiscoveryUrl;
      if (input.oidcClientId !== undefined) updates.oidcClientId = input.oidcClientId;
      if (input.oidcClientSecret !== undefined) {
        // Only re-encrypt if a new secret is provided (not the masked placeholder)
        if (input.oidcClientSecret !== "••••••••") {
          updates.oidcClientSecret = encryptCredential(input.oidcClientSecret);
        }
      }
      if (input.targetStoreId !== undefined) {
        if (input.targetStoreId !== null) {
          await verifyStoreOwnership(db, input.targetStoreId, ctx.user.id, ctx.organizationId);
        }
        updates.targetStoreId = input.targetStoreId;
      }
      if (input.defaultDepartmentId !== undefined) {
        updates.defaultDepartmentId = input.defaultDepartmentId;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(storeIdentityProviders)
          .set(updates)
          .where(eq(storeIdentityProviders.id, input.id));
      }

      auditLog({
        action: "sso.idp.updated",
        userId: ctx.user.id,
        actorEmail: ctx.user.email ?? undefined,
        resourceType: "storeIdentityProvider",
        resourceId: input.id,
        description: `Updated IdP ${input.id} (${idp.name})`,
        metadata: { idpId: input.id, updatedFields: Object.keys(updates) },
      });

      return { success: true };
    }),

  /**
   * Delete an IdP configuration.
   * Sets ssoProviderId to NULL on linked storeUsers (FK ON DELETE SET NULL).
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // PO-6: Verify caller owns the store this IdP belongs to
      const { idp } = await verifyIdpOwnership(
        db,
        input.id,
        ctx.user.id,
        ctx.organizationId,
      );

      await db
        .delete(storeIdentityProviders)
        .where(eq(storeIdentityProviders.id, input.id));

      auditLog({
        action: "sso.idp.deleted",
        userId: ctx.user.id,
        actorEmail: ctx.user.email ?? undefined,
        resourceType: "storeIdentityProvider",
        resourceId: input.id,
        description: `Deleted IdP "${idp.name}" (${idp.protocol}) from store ${idp.storeId}`,
        metadata: {
          idpId: input.id,
          storeId: idp.storeId,
          protocol: idp.protocol,
        },
      });

      return { success: true };
    }),

  /**
   * Check if an email domain has an SSO provider configured for a store.
   * Public endpoint — used by the login page to determine SSO routing.
   */
  checkDomain: publicProcedure
    .input(
      z.object({
        storeSlug: z.string(),
        email: z.string().email(),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Find the store
      const storeRows = await db
        .select()
        .from(stores)
        .where(eq(stores.slug, input.storeSlug))
        .limit(1);

      if (storeRows.length === 0) {
        return { hasSso: false };
      }

      const emailDomain = input.email.split("@")[1]?.toLowerCase();
      if (!emailDomain) {
        return { hasSso: false };
      }

      // Check for an enabled IdP matching this domain
      const idps = await db
        .select()
        .from(storeIdentityProviders)
        .where(
          and(
            eq(storeIdentityProviders.storeId, storeRows[0].id),
            eq(storeIdentityProviders.domain, emailDomain),
            eq(storeIdentityProviders.enabled, true),
          ),
        )
        .limit(1);

      if (idps.length === 0) {
        return { hasSso: false };
      }

      const idp = idps[0];
      const baseUrl =
        process.env.APP_BASE_URL ||
        `http://localhost:${process.env.PORT || 3000}`;
      const initUrl =
        idp.protocol === "saml"
          ? `${baseUrl}/api/sso/saml/init/${idp.id}`
          : `${baseUrl}/api/sso/oidc/init/${idp.id}`;

      return {
        hasSso: true,
        providerName: idp.name,
        protocol: idp.protocol,
        initUrl,
      };
    }),
});
