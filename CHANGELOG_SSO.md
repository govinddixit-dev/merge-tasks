# Changelog — Enterprise SSO (SAML 2.0 + OpenID Connect)

**Date:** April 7, 2026
**Scope:** Full SSO implementation following the MergeTasks SSO Developer Guide (23 steps)
**Status:** Zero TypeScript errors. Requires IdP configuration for live testing.

---

## New Files Created

### Database
| File | Purpose |
|------|---------|
| `drizzle/0031_store_identity_providers.sql` | Migration: creates `store_identity_providers` table, adds `ssoProviderId`/`ssoSubject` to `store_users` |

### Server Utilities
| File | Purpose |
|------|---------|
| `server/utils/samlProvider.ts` | SAML 2.0 client builder, AuthnRequest generation, response validation, SP metadata XML |
| `server/utils/oidcProvider.ts` | OIDC Authorization Code flow with PKCE, discovery caching, token exchange |
| `server/utils/ssoUserResolver.ts` | JIT provisioning: find-by-identity → find-by-email → auto-create with role "employee" |

### Server Routes
| File | Purpose |
|------|---------|
| `server/routes/storeSsoCallback.ts` | 5 Express routes: SAML metadata, SAML init, SAML ACS callback, OIDC init, OIDC callback |
| `server/routers/storeSso.ts` | tRPC router: list, create, update, delete IdP configs + public `checkDomain` endpoint |

### Client UI
| File | Purpose |
|------|---------|
| `client/src/components/settings/StoreSsoSettings.tsx` | Distributor admin: IdP list, add/edit modal (SAML + OIDC), toggle, delete, SP metadata link |

---

## Modified Files

| File | Change |
|------|--------|
| `drizzle/schema.ts` | Added `storeIdentityProviders` table definition + `ssoProviderId`/`ssoSubject` columns on `storeUsers` |
| `server/utils/auditLog.ts` | Added 7 SSO audit action types (`sso.idp.created/updated/deleted`, `sso.login.success/failed`, `sso.account.linked`, `sso.user.provisioned`) |
| `server/_core/index.ts` | Mounted `storeSsoRouter` Express routes (no auth/CSRF) |
| `server/routers.ts` | Registered `storeSso` tRPC router |
| `client/src/pages/StoreEditorPage.tsx` | Added "SSO" section tab with Shield icon, renders `StoreSsoSettings` |
| `client/src/pages/webstore/StoreLoginPage.tsx` | Rewrote with email-first SSO domain check, SSO error banner from callback, removed legacy static SSO button |

---

## Architecture

### Login Flow (Email-First SSO Intercept)
```
User enters email → checkDomain(storeSlug, email)
  ├─ hasSso: true  → redirect to /api/sso/{saml|oidc}/init/:idpId → IdP login → callback → session cookie → /s/:slug
  └─ hasSso: false → proceed with OTP code or password login
```

### JIT Provisioning
```
IdP callback → validateSamlResponse / handleOidcCallback
  → resolveSsoUser(storeId, idpId, identity)
    ├─ Match by ssoProviderId + ssoSubject → return existing user
    ├─ Match by email → link SSO identity → return user
    └─ No match → create new storeUser (role: "employee") → return user
```

### Security
- SAML assertions: `wantAssertionsSigned: true`
- OIDC: PKCE (S256) for authorization code exchange
- OIDC client secrets: encrypted at rest via `encryptCredential()`
- All SSO events audit-logged (7 action types)
- Suspended users rejected at resolver level
- IdP deletion: FK `ON DELETE SET NULL` — users revert to OTP/password

---

## Dependencies Added
- `@node-saml/node-saml` v5.1.0 — SAML 2.0 SP implementation
- `openid-client` v6.8.2 — OIDC Relying Party (Authorization Code + PKCE)

---

## Migration Required

```bash
mysql -u root -p mergetasks < drizzle/0031_store_identity_providers.sql
```

## Testing Checklist

- [ ] Run migration 0031
- [ ] Configure a test IdP (Okta dev account or Azure AD)
- [ ] Create an IdP config via Store Editor → SSO tab
- [ ] Download SP metadata from `/api/sso/saml/metadata/:storeId`
- [ ] Upload SP metadata to IdP
- [ ] Test SAML login: enter email with configured domain → redirects to IdP → callback creates session
- [ ] Test OIDC login: same flow with OIDC provider
- [ ] Test JIT provisioning: new email auto-creates storeUser with role "employee"
- [ ] Test suspended user rejection
- [ ] Test IdP deletion: linked users can still log in via OTP/password
- [ ] Verify audit_log entries for all SSO events
