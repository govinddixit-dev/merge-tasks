/**
 * Store SSO Callback Routes — Express Router
 *
 * Handles the IdP-initiated callbacks for SAML and OIDC SSO flows.
 * These are raw Express routes (not tRPC) because IdPs POST/redirect
 * to fixed URLs that can't go through tRPC's JSON-RPC transport.
 *
 * Routes:
 *   GET  /api/sso/saml/metadata/:storeId  — SP metadata XML for IdP setup
 *   GET  /api/sso/saml/init/:idpId        — Initiate SAML AuthnRequest
 *   POST /api/sso/saml/callback/:storeSlug — SAML ACS (store-specific, no RelayState dependency)
 *   GET  /api/sso/oidc/init/:idpId        — Initiate OIDC Authorization Code flow
 *   GET  /api/sso/oidc/callback/:storeSlug — OIDC callback (store-specific, server-side PKCE)
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { stores, storeIdentityProviders } from "../../drizzle/schema";
import { generateSamlRequest, validateSamlResponse, generateSpMetadata } from "../utils/samlProvider";
import { getOidcAuthorizationUrl, handleOidcCallback } from "../utils/oidcProvider";
import { resolveSsoUser } from "../utils/ssoUserResolver";
import { auditLog } from "../utils/auditLog";
import { getLogger } from "../utils/logger";
import { SignJWT } from "jose";
import { ENV } from "../_core/env";

const log = getLogger("storeSsoCallback");

/** Reuse the store session token creation from storeAuth */
const STORE_COOKIE_PREFIX = "mt_store_";
const STORE_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function getStoreSecret() {
  return new TextEncoder().encode(ENV.cookieSecret + "_store");
}

async function createStoreSessionToken(storeId: number, storeUserId: number, email: string, role: string) {
  return new SignJWT({ storeId, storeUserId, email, role })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(getStoreSecret());
}

/** Build the redirect URL after successful SSO login */
function buildSuccessRedirect(storeSlug: string): string {
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${baseUrl}/s/${storeSlug}`;
}

/** Build the redirect URL for SSO errors */
function buildErrorRedirect(storeSlug: string, error: string): string {
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${baseUrl}/s/${storeSlug}/login?sso_error=${encodeURIComponent(error)}`;
}

/** Look up a store by slug and return its id + slug */
async function resolveStoreBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(stores).where(eq(stores.slug, slug)).limit(1);
  return rows[0] || null;
}

/**
 * When an IdP has targetStoreId set, redirect to that child store instead
 * of the parent store. Verifies that the target belongs to the same
 * organization (or the same userId when org is null) so a compromised
 * parent store can't redirect users into an unrelated tenant's store.
 */
async function resolveDivisionRedirectSlug(
  parentStore: { id: number; slug: string; organizationId: number | null; userId: number },
  targetStoreId: number | null,
): Promise<string> {
  if (!targetStoreId || targetStoreId === parentStore.id) return parentStore.slug;
  const db = await getDb();
  if (!db) return parentStore.slug;
  const [target] = await db
    .select({ id: stores.id, slug: stores.slug, organizationId: stores.organizationId, userId: stores.userId })
    .from(stores)
    .where(eq(stores.id, targetStoreId))
    .limit(1);
  if (!target) return parentStore.slug;
  const sameOrg =
    parentStore.organizationId != null
      ? target.organizationId === parentStore.organizationId
      : target.userId === parentStore.userId;
  if (!sameOrg) {
    log.warn(`IdP targetStoreId ${targetStoreId} does not match parent store ownership — ignoring`);
    return parentStore.slug;
  }
  return target.slug;
}

export const storeSsoRouter = Router();

// ── SAML Metadata ──────────────────────────────────────────────────────────
storeSsoRouter.get("/api/sso/saml/metadata/:storeId", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    const storeId = parseInt(req.params.storeId);

    // Look up the store to get its slug (needed for store-specific ACS URL in metadata)
    const storeRows = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (storeRows.length === 0) {
      return res.status(404).json({ error: "Store not found" });
    }
    const storeSlug = storeRows[0].slug;

    const idps = await db
      .select()
      .from(storeIdentityProviders)
      .where(eq(storeIdentityProviders.storeId, storeId))
      .limit(1);

    if (idps.length === 0) {
      return res.status(404).json({ error: "No SSO provider configured for this store" });
    }

    const xml = generateSpMetadata(idps[0], storeSlug);
    res.type("application/xml").send(xml);
  } catch (err) {
    log.error("Failed to generate SAML metadata", err);
    res.status(500).json({ error: "Failed to generate metadata" });
  }
});

// ── SAML Init ──────────────────────────────────────────────────────────────
storeSsoRouter.get("/api/sso/saml/init/:idpId", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    const idpId = parseInt(req.params.idpId);
    const idps = await db
      .select()
      .from(storeIdentityProviders)
      .where(eq(storeIdentityProviders.id, idpId))
      .limit(1);

    if (idps.length === 0 || !idps[0].enabled) {
      return res.status(404).json({ error: "SSO provider not found or disabled" });
    }

    // Get store slug for the store-specific callback URL
    const storeRows = await db.select().from(stores).where(eq(stores.id, idps[0].storeId)).limit(1);
    if (storeRows.length === 0) {
      return res.status(404).json({ error: "Store not found" });
    }

    const redirectUrl = await generateSamlRequest(idps[0], storeRows[0].slug);
    res.redirect(redirectUrl);
  } catch (err) {
    log.error("Failed to initiate SAML login", err);
    res.status(500).json({ error: "Failed to initiate SSO login" });
  }
});

// ── SAML Callback (ACS) — Store-specific route ──────────────────────────────
// The storeSlug is in the URL path, so we don't depend on RelayState for routing.
storeSsoRouter.post("/api/sso/saml/callback/:storeSlug", async (req, res) => {
  const storeSlug = req.params.storeSlug;
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    // Resolve the store from the URL path — no RelayState dependency
    const store = await resolveStoreBySlug(storeSlug);
    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    // Try to get idpId from RelayState (convenience), but fall back to store lookup
    let idpId: number | null = null;
    try {
      const relayState = req.body?.RelayState;
      if (relayState) {
        const parsed = JSON.parse(relayState);
        idpId = parsed.idpId || null;
      }
    } catch {
      // RelayState missing or corrupted — that's fine, we'll find the IdP by store
    }

    let idp;
    if (idpId) {
      // Fast path: we know the exact IdP
      const idps = await db
        .select()
        .from(storeIdentityProviders)
        .where(and(
          eq(storeIdentityProviders.id, idpId),
          eq(storeIdentityProviders.storeId, store.id),
          eq(storeIdentityProviders.enabled, true),
        ))
        .limit(1);
      idp = idps[0];
    }

    if (!idp) {
      // Fallback: find any enabled SAML IdP for this store
      const idps = await db
        .select()
        .from(storeIdentityProviders)
        .where(and(
          eq(storeIdentityProviders.storeId, store.id),
          eq(storeIdentityProviders.protocol, "saml"),
          eq(storeIdentityProviders.enabled, true),
        ))
        .limit(1);
      idp = idps[0];
    }

    if (!idp) {
      return res.redirect(buildErrorRedirect(storeSlug, "No active SSO provider found for this store."));
    }

    // Validate the SAML response
    const profile = await validateSamlResponse(idp, storeSlug, req.body);

    // Validate email domain matches configured SSO domain
    const emailDomain = profile.email?.split('@')[1]?.toLowerCase();
    const configuredDomain = (idp as any).domain?.toLowerCase();
    if (configuredDomain && emailDomain !== configuredDomain) {
      return res.redirect(buildErrorRedirect(storeSlug, 'Email domain does not match configured SSO domain'));
    }

    // Resolve multi-division target slug (defaults to parent slug when unset)
    const redirectSlug = await resolveDivisionRedirectSlug(store, idp.targetStoreId ?? null);
    const sessionStoreId = redirectSlug === store.slug ? idp.storeId : (await resolveStoreBySlug(redirectSlug))?.id ?? idp.storeId;

    // Resolve or create the store user in the target store so their session
    // is scoped to the division they'll land on.
    const user = await resolveSsoUser(sessionStoreId, idp.id, {
      subject: profile.nameID,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      groups: profile.groups,
    }, idp.defaultDepartmentId ?? null);

    // Create session token and set cookie scoped to the target store slug
    const token = await createStoreSessionToken(sessionStoreId, user.id, user.email, user.role);
    const cookieName = STORE_COOKIE_PREFIX + redirectSlug;
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: STORE_SESSION_DURATION,
      path: "/",
    });

    auditLog({
      action: "sso.login.success",
      userId: user.id,
      description: `SAML SSO login for ${user.email} (store ${sessionStoreId})`,
      metadata: { protocol: "saml", storeId: sessionStoreId, parentStoreId: idp.storeId, idpId: idp.id },
    });

    res.redirect(buildSuccessRedirect(redirectSlug));
  } catch (err: unknown) {
    log.error("SAML callback failed", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    auditLog({
      action: "sso.login.failed",
      userId: null,
      description: `SAML SSO callback failed: ${errMsg}`,
      metadata: { protocol: "saml", error: errMsg, storeSlug },
    });
    res.redirect(buildErrorRedirect(storeSlug, "SSO authentication failed. Please try again or contact your administrator."));
  }
});

// ── OIDC Init ──────────────────────────────────────────────────────────────
storeSsoRouter.get("/api/sso/oidc/init/:idpId", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    const idpId = parseInt(req.params.idpId);
    const idps = await db
      .select()
      .from(storeIdentityProviders)
      .where(eq(storeIdentityProviders.id, idpId))
      .limit(1);

    if (idps.length === 0 || !idps[0].enabled) {
      return res.status(404).json({ error: "SSO provider not found or disabled" });
    }

    // Get store slug for the store-specific callback URL
    const storeRows = await db.select().from(stores).where(eq(stores.id, idps[0].storeId)).limit(1);
    if (storeRows.length === 0) {
      return res.status(404).json({ error: "Store not found" });
    }

    const authUrl = await getOidcAuthorizationUrl(idps[0], storeRows[0].slug);
    res.redirect(authUrl);
  } catch (err) {
    log.error("Failed to initiate OIDC login", err);
    res.status(500).json({ error: "Failed to initiate SSO login" });
  }
});

// ── OIDC Callback — Store-specific route ──────────────────────────────────
storeSsoRouter.get("/api/sso/oidc/callback/:storeSlug", async (req, res) => {
  const storeSlug = req.params.storeSlug;
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    // Resolve the store from the URL path
    const store = await resolveStoreBySlug(storeSlug);
    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    // Decode state parameter
    const stateParam = req.query.state as string;
    if (!stateParam) {
      return res.redirect(buildErrorRedirect(storeSlug, "Missing state parameter in SSO callback."));
    }

    let statePayload: { storeId: number; domain: string; idpId: number; pn: string };
    try {
      statePayload = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    } catch {
      return res.redirect(buildErrorRedirect(storeSlug, "Invalid state parameter in SSO callback."));
    }

    // Look up the IdP
    const idps = await db
      .select()
      .from(storeIdentityProviders)
      .where(and(
        eq(storeIdentityProviders.id, statePayload.idpId),
        eq(storeIdentityProviders.storeId, store.id),
        eq(storeIdentityProviders.enabled, true),
      ))
      .limit(1);

    if (idps.length === 0) {
      return res.redirect(buildErrorRedirect(storeSlug, "SSO provider not found or disabled."));
    }

    const idp = idps[0];

    // Build the full callback URL for the OIDC library
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const callbackUrl = new URL(`${baseUrl}${req.originalUrl}`);

    // Exchange code for tokens — code_verifier is retrieved server-side by pkceStore
    const profile = await handleOidcCallback(idp, storeSlug, callbackUrl, statePayload);

    // Validate email domain matches configured SSO domain
    const emailDomain = profile.email?.split('@')[1]?.toLowerCase();
    const configuredDomain = (idp as any).domain?.toLowerCase();
    if (configuredDomain && emailDomain !== configuredDomain) {
      return res.redirect(buildErrorRedirect(storeSlug, 'Email domain does not match configured SSO domain'));
    }

    // Resolve multi-division target slug
    const redirectSlug = await resolveDivisionRedirectSlug(store, idp.targetStoreId ?? null);
    const sessionStoreId = redirectSlug === store.slug ? idp.storeId : (await resolveStoreBySlug(redirectSlug))?.id ?? idp.storeId;

    // Resolve or create the store user
    const user = await resolveSsoUser(sessionStoreId, idp.id, {
      subject: profile.sub,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      groups: profile.groups,
    }, idp.defaultDepartmentId ?? null);

    // Create session token and set cookie scoped to the target store slug
    const token = await createStoreSessionToken(sessionStoreId, user.id, user.email, user.role);
    const cookieName = STORE_COOKIE_PREFIX + redirectSlug;
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: STORE_SESSION_DURATION,
      path: "/",
    });

    auditLog({
      action: "sso.login.success",
      userId: user.id,
      description: `OIDC SSO login for ${user.email} (store ${sessionStoreId})`,
      metadata: { protocol: "oidc", storeId: sessionStoreId, parentStoreId: idp.storeId, idpId: idp.id },
    });

    res.redirect(buildSuccessRedirect(redirectSlug));
  } catch (err: unknown) {
    log.error("OIDC callback failed", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    auditLog({
      action: "sso.login.failed",
      userId: null,
      description: `OIDC SSO callback failed: ${errMsg}`,
      metadata: { protocol: "oidc", error: errMsg, storeSlug },
    });
    res.redirect(buildErrorRedirect(storeSlug, "SSO authentication failed. Please try again or contact your administrator."));
  }
});
