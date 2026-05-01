/**
 * OpenID Connect Provider Utility
 *
 * Wraps the openid-client library (v6) to handle OIDC Authorization Code flow
 * for store SSO. Supports auto-discovery via .well-known/openid-configuration.
 *
 * PKCE code_verifier is stored server-side (Redis or in-memory) and referenced
 * by an opaque nonce in the state parameter — the verifier never travels
 * through the browser.
 */
import * as client from "openid-client";
import type { StoreIdentityProvider } from "../../drizzle/schema";
import { decryptCredential } from "./encryption";
import { storeCodeVerifier, consumeCodeVerifier } from "./pkceStore";
import { getLogger } from "./logger";

const log = getLogger("oidcProvider");

/** Base URL for the application */
function getBaseUrl(): string {
  return process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

/** Cache discovered OIDC configurations to avoid repeated network calls */
const configCache = new Map<string, { config: client.Configuration; expiresAt: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Discover and cache the OIDC configuration for an IdP.
 */
async function getOidcConfig(idp: StoreIdentityProvider): Promise<client.Configuration> {
  const cacheKey = `${idp.id}:${idp.oidcDiscoveryUrl}`;
  const cached = configCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  if (!idp.oidcDiscoveryUrl) {
    throw new Error(`OIDC discovery URL not configured for IdP ${idp.id}`);
  }
  if (!idp.oidcClientId) {
    throw new Error(`OIDC client ID not configured for IdP ${idp.id}`);
  }

  const clientSecret = decryptCredential(idp.oidcClientSecret);

  const config = await client.discovery(
    new URL(idp.oidcDiscoveryUrl),
    idp.oidcClientId,
    clientSecret || undefined,
  );

  configCache.set(cacheKey, { config, expiresAt: Date.now() + CACHE_TTL });
  log.info(`OIDC configuration discovered for IdP ${idp.id} (${idp.oidcDiscoveryUrl})`);
  return config;
}

/**
 * Build the OIDC authorization URL that redirects the user to their IdP.
 *
 * The state parameter carries storeId + domain + idpId + a PKCE nonce.
 * The actual code_verifier is stored server-side and never exposed to the browser.
 */
export async function getOidcAuthorizationUrl(
  idp: StoreIdentityProvider,
  storeSlug: string,
): Promise<string> {
  const config = await getOidcConfig(idp);
  const redirectUri = `${getBaseUrl()}/api/sso/oidc/callback/${storeSlug}`;

  // Generate code verifier and challenge for PKCE
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  // Store the verifier server-side, get an opaque nonce for the state
  const pkceNonce = await storeCodeVerifier(codeVerifier);

  const state = Buffer.from(JSON.stringify({
    storeId: idp.storeId,
    domain: idp.domain,
    idpId: idp.id,
    pn: pkceNonce, // Opaque nonce — not the verifier itself
  })).toString("base64url");

  const parameters: Record<string, string> = {
    redirect_uri: redirectUri,
    scope: "openid email profile",
    response_type: "code",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  };

  const authUrl = client.buildAuthorizationUrl(config, parameters);
  log.info(`Generated OIDC authorization URL for store ${idp.storeId} (slug: ${storeSlug}), domain ${idp.domain}`);
  return authUrl.href;
}

/**
 * Handle the OIDC callback — exchange the authorization code for tokens
 * and extract the user profile from the ID token.
 *
 * The code_verifier is retrieved from server-side storage using the nonce
 * embedded in the state parameter.
 */
export async function handleOidcCallback(
  idp: StoreIdentityProvider,
  storeSlug: string,
  callbackUrl: URL,
  statePayload: { storeId: number; domain: string; idpId: number; pn: string },
): Promise<{ sub: string; email: string; firstName?: string; lastName?: string; groups?: string[] }> {
  const config = await getOidcConfig(idp);
  const redirectUri = `${getBaseUrl()}/api/sso/oidc/callback/${storeSlug}`;

  // Retrieve the code_verifier from server-side storage
  const codeVerifier = await consumeCodeVerifier(statePayload.pn);
  if (!codeVerifier) {
    throw new Error("PKCE code verifier not found or expired. Please try logging in again.");
  }

  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState: Buffer.from(JSON.stringify(statePayload)).toString("base64url"),
  });

  const claims = tokens.claims();
  if (!claims) {
    throw new Error("OIDC token exchange succeeded but no ID token claims were returned");
  }

  const sub = claims.sub || "";
  const email = (claims.email as string) || "";
  const firstName = (claims.given_name as string) || undefined;
  const lastName = (claims.family_name as string) || undefined;

  // Groups/roles — most IdPs emit the "groups" claim (Okta, Entra, Google
  // Workspace); some use "roles" (Auth0). Normalise to string[].
  const rawGroups = (claims.groups ?? claims.roles) as unknown;
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === "string")
    : typeof rawGroups === "string" && rawGroups.length > 0
      ? [rawGroups]
      : undefined;

  // Reject unverified emails — otherwise an IdP that allows user-self-asserted
  // emails could be used to impersonate other tenants' users. If the IdP does
  // not issue the claim at all, fall through (most enterprise IdPs issue it).
  if ("email_verified" in claims && claims.email_verified === false) {
    throw new Error("OIDC provider did not verify the user's email address");
  }

  log.info(`OIDC callback validated for ${email} (store ${idp.storeId})`);

  return { sub, email, firstName, lastName, groups };
}
