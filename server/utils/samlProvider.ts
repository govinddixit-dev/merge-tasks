/**
 * SAML 2.0 Provider Utility
 *
 * Wraps @node-saml/node-saml to build SAML clients, generate AuthnRequests,
 * validate IdP responses, and produce SP metadata XML for store SSO.
 *
 * The ACS callback URL is store-specific (/api/sso/saml/callback/:storeSlug)
 * so routing does not depend on RelayState preservation by the IdP.
 */
import { SAML, type SamlConfig } from "@node-saml/node-saml";
import type { StoreIdentityProvider } from "../../drizzle/schema";
import { getLogger } from "./logger";

const log = getLogger("samlProvider");

/** Base URL for the application — used to build ACS and metadata URLs */
function getBaseUrl(): string {
  return process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * Build a configured SAML client from a stored IdP record.
 * @param idp - The identity provider record
 * @param storeSlug - The store slug, used to build the store-specific ACS callback URL
 */
export function buildSamlClient(idp: StoreIdentityProvider, storeSlug: string): SAML {
  const config: SamlConfig = {
    callbackUrl: `${getBaseUrl()}/api/sso/saml/callback/${storeSlug}`,
    entryPoint: idp.samlEntryPoint || undefined,
    issuer: idp.samlIssuer || `mergetasks-store-${idp.storeId}`,
    idpCert: idp.samlCertificate || "",
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    // Allow 5 minutes of clock skew between SP and IdP
    acceptedClockSkewMs: 5 * 60 * 1000,
  };
  return new SAML(config);
}

/**
 * Generate a SAML AuthnRequest redirect URL.
 * RelayState still carries idpId as a convenience, but the callback route
 * already knows the store from the URL path — so RelayState loss is non-fatal.
 */
export async function generateSamlRequest(
  idp: StoreIdentityProvider,
  storeSlug: string,
): Promise<string> {
  const saml = buildSamlClient(idp, storeSlug);
  // RelayState is a backup — the callback URL path already encodes the store
  const relayState = JSON.stringify({ idpId: idp.id });

  const url = await saml.getAuthorizeUrlAsync(relayState, "", {});
  log.info(`Generated SAML AuthnRequest for store ${idp.storeId} (slug: ${storeSlug}), domain ${idp.domain}`);
  return url;
}

/**
 * Validate a SAML Response from the IdP callback.
 * Returns the extracted user profile or throws on validation failure.
 */
export async function validateSamlResponse(
  idp: StoreIdentityProvider,
  storeSlug: string,
  samlResponseBody: { SAMLResponse: string; RelayState?: string },
): Promise<{ nameID: string; email: string; firstName?: string; lastName?: string; groups?: string[] }> {
  const saml = buildSamlClient(idp, storeSlug);

  const { profile } = await saml.validatePostResponseAsync(samlResponseBody);

  if (!profile) {
    throw new Error("SAML response validation succeeded but no profile was returned");
  }

  // SAML profiles carry attributes under various vendor-specific keys.
  // We use a typed index signature to avoid `as any` while still allowing
  // arbitrary attribute access at runtime.
  type SamlProfileExtended = typeof profile & { [key: string]: string | undefined };
  const p = profile as SamlProfileExtended;

  const nameID = p.nameID || "";
  // Try to extract email from various SAML attribute locations
  const email =
    p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] ||
    p.email ||
    p.Email ||
    nameID;

  const firstName =
    p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"] ||
    p.firstName ||
    p.FirstName;

  const lastName =
    p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"] ||
    p.lastName ||
    p.LastName;

  // Extract groups/roles — SAML IdPs emit these under a handful of standard
  // attribute URIs. Values may be a single string or an array depending on
  // the IdP and the samlify parser's handling.
  const rawGroups =
    p["http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"] ||
    p["http://schemas.xmlsoap.org/claims/Group"] ||
    p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/group"] ||
    p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/role"] ||
    p.groups ||
    p.Groups ||
    p.roles ||
    p.Role;
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === "string")
    : typeof rawGroups === "string" && rawGroups.length > 0
      ? [rawGroups]
      : undefined;

  log.info(`SAML response validated for ${email} (store ${idp.storeId})`);

  return { nameID, email, firstName, lastName, groups };
}

/**
 * Generate SP metadata XML for a store's SAML configuration.
 * This is what the IT admin uploads into their IdP (Okta, Azure AD, etc.).
 */
export function generateSpMetadata(idp: StoreIdentityProvider, storeSlug: string): string {
  const saml = buildSamlClient(idp, storeSlug);
  const decryptionCert = undefined; // We don't require encrypted assertions
  return saml.generateServiceProviderMetadata(decryptionCert ?? null, null);
}
