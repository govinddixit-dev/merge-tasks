# SSO Verification Checklist

End-to-end verification for MergeTasks store SSO (SAML 2.0 and OIDC).
Each item below should pass before declaring SSO green for an IdP integration.

## Configuration surface

Code under review:
- `server/utils/samlProvider.ts` — SAML client, AuthnRequest, response validation, SP metadata
- `server/utils/oidcProvider.ts` — OIDC discovery, authorization URL, callback / token exchange
- `server/utils/ssoUserResolver.ts` — user provisioning / lookup post-SSO
- `server/utils/pkceStore.ts` — server-side PKCE verifier storage
- `server/routes/storeSsoCallback.ts` — Express routes for SP/IdP-initiated flows
- `server/routers/storeSso.ts` — tRPC admin routes for IdP CRUD

## SAML 2.0

### SP Metadata
- [ ] `GET /api/sso/saml/metadata/:storeId` returns 200 with `application/xml`
- [ ] Metadata contains `AssertionConsumerService` pointing at `/api/sso/saml/callback/:storeSlug`
- [ ] Metadata contains a valid `EntityID` matching `samlIssuer` (or the default `mergetasks-store-<id>`)
- [ ] Metadata imports cleanly into Okta, Azure AD, and Google Workspace

### SP-initiated login
- [ ] `GET /api/sso/saml/init/:idpId` redirects to the IdP `entryPoint`
- [ ] AuthnRequest includes `RelayState={"idpId":<n>}` (convenience; not security-critical)
- [ ] IdP returns the user to `/api/sso/saml/callback/:storeSlug`
- [ ] Successful login sets the store session cookie and redirects to `/s/:storeSlug`

### IdP-initiated login
- [ ] Posting a SAML assertion directly to `/api/sso/saml/callback/:storeSlug` without RelayState works
- [ ] Route falls back to the first enabled SAML IdP for the store (see callback handler)

### Assertion validation
- [ ] `wantAssertionsSigned: true` — signed-assertion requirement is enforced
- [ ] Invalid signature → user is redirected to `/s/:slug/login?sso_error=...`, not logged in
- [ ] Expired assertion (NotOnOrAfter in past) → error redirect, audit log `sso.login.failed`
- [ ] Replay of a previously validated assertion → rejected by the underlying `@node-saml/node-saml` library (in-memory replay cache)
- [ ] Clock skew of up to 5 minutes is tolerated (`acceptedClockSkewMs`)

### Attribute mapping (email extraction)
- [ ] Email pulled from `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` when present
- [ ] Falls back to `email` / `Email` attribute, then to `nameID`
- [ ] First/last name pulled from standard claim URIs or `firstName`/`lastName` attributes
- [ ] Email domain matches `idp.domain` when configured — mismatch is rejected

### Session handling
- [ ] Cookie `mt_store_<slug>` is set `httpOnly`, `sameSite=lax`, `secure` in production
- [ ] JWT expiration matches `STORE_SESSION_DURATION` (24h) and is signed with `cookieSecret + "_store"`
- [ ] Logging out clears the cookie

## OpenID Connect

### Discovery & config
- [ ] Discovery via `.well-known/openid-configuration` works and is cached for 1h
- [ ] Client secret is decrypted from `decryptCredential()` — never stored plaintext
- [ ] Cache key includes `idp.id` and the discovery URL

### SP-initiated login
- [ ] `GET /api/sso/oidc/init/:idpId` redirects to the IdP authorization endpoint
- [ ] `state` parameter is base64url JSON containing `storeId`, `domain`, `idpId`, `pn` (PKCE nonce)
- [ ] `code_challenge_method=S256`, `scope=openid email profile`, `response_type=code`
- [ ] PKCE `code_verifier` is stored server-side and referenced by an opaque nonce — never exposed to the browser

### Callback
- [ ] `GET /api/sso/oidc/callback/:storeSlug` validates the state parameter
- [ ] `expectedState` in `authorizationCodeGrant` prevents CSRF / state-tampering
- [ ] `consumeCodeVerifier` consumes the verifier (one-shot), rejecting replays
- [ ] Missing / expired PKCE verifier → explicit error redirect

### Attribute mapping
- [ ] `sub` → external subject identifier stored with the store user
- [ ] `email` → primary identifier; `email_verified === false` is rejected (see oidcProvider.ts)
- [ ] `given_name` / `family_name` → user profile on provision
- [ ] Email domain matches `idp.domain` when configured — mismatch is rejected

### Error states
- [ ] Invalid signature on ID token → `authorizationCodeGrant` throws, user sees friendly error
- [ ] Expired ID token → rejected by openid-client, error redirect
- [ ] Unverified email (`email_verified=false`) → rejected with explicit error
- [ ] Domain mismatch → rejected, audit log `sso.login.failed` with protocol/storeSlug

## Cross-protocol

### Audit logging
- [ ] Successful SSO login writes `sso.login.success` with protocol, storeId, idpId
- [ ] Failed SSO login writes `sso.login.failed` with protocol, error, storeSlug
- [ ] User provisioning via `resolveSsoUser` is traceable

### User provisioning
- [ ] Existing user (matched by `(storeId, idpId, subject)`) is updated, not duplicated
- [ ] New user is created with default role (see `ssoUserResolver`)
- [ ] Deactivated store users do not get auto-reactivated through SSO

### Configuration UI
- [ ] Admin can toggle `enabled` on a provider without deleting it
- [ ] SAML and OIDC providers can coexist per store (test both enabled simultaneously)
- [ ] Disabled provider returns 404 from init endpoints

## Known gaps closed in this pass
- OIDC now rejects callbacks where `email_verified === false` (server/utils/oidcProvider.ts)
- SSO resolver now enforces IdP domain match at the resolver boundary — an assertion whose email domain does not match `storeIdentityProviders.domain` is rejected and audit-logged as `sso.login.failed`, regardless of protocol (server/utils/ssoUserResolver.ts). This closes the documented-but-unenforced domain check.

## Open considerations (not blockers)
- `wantAuthnResponseSigned` is `false` — assertions are still signed, so response tampering surfaces as assertion-signature failure. Tighten only if all supported IdPs sign the outer Response.
- SAML assertion replay cache is in-memory; for multi-instance deployments, consider a Redis-backed cache.

## Manual test runbook
1. Register a test IdP in Okta / Azure AD pointing at `APP_BASE_URL`
2. Import SP metadata from `GET /api/sso/saml/metadata/:storeId`
3. Initiate SP-flow: `curl -v $APP/api/sso/saml/init/<idpId>` → confirm 302 to IdP
4. Complete login in browser → confirm cookie set, redirect to `/s/<slug>`
5. Repeat for OIDC via `/api/sso/oidc/init/<idpId>`
6. Revoke IdP cert mid-session → next login must fail with error redirect
7. Tamper with `state` parameter → callback must reject
