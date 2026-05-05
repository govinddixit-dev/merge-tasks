# MergeTasks — IT Onboarding Packet

Welcome. This document collects everything your IT / security team needs
to bring MergeTasks online: SSO setup, network requirements, admin
provisioning, bulk user import, and our security posture.

If you're looking for a visual / printable version, ask your MergeTasks
account manager for `MergeTasks_SSO_Setup_Guide.pdf` (also attached to
the automated SSO onboarding email).

---

## 1. SSO Setup

MergeTasks supports **SAML 2.0** and **OpenID Connect (OIDC)**. Each
store can have its own IdP configuration, and Enterprise plans support
multiple IdPs per organization.

### SAML 2.0 (Okta, Azure AD, Google Workspace, OneLogin, Ping, ADFS)

1. **Download SP metadata.** Visit
   `https://app.mergetasks.com/api/sso/saml/metadata/<storeId>` and
   import the XML into your IdP.
2. **Configure attribute mapping.** MergeTasks reads:
   - `NameID` → subject identifier
   - `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`
     → email (falls back to `email`, `Email`, `NameID`)
   - `.../givenname` → first name
   - `.../surname` → last name
3. **Signing:** assertions must be signed (`wantAssertionsSigned=true`).
4. **ACS / Single Sign On URL:**
   `https://app.mergetasks.com/api/sso/saml/callback/<storeSlug>`
5. **SP-initiated start URL:**
   `https://app.mergetasks.com/api/sso/saml/init/<idpId>`
6. **Clock skew:** up to 5 minutes tolerated.
7. **Test.** Assign a pilot user, click the SP init URL, confirm the
   redirect and successful login.

### OpenID Connect (Okta OIDC, Auth0, Azure AD OIDC, Google, Keycloak)

1. **Discovery.** Provide MergeTasks with your IdP's
   `.well-known/openid-configuration` URL.
2. **Client credentials.** Create an OIDC client in your IdP with:
   - `response_type=code`
   - `scope=openid email profile`
   - `code_challenge_method=S256` (PKCE enforced server-side — the
     verifier never travels through the browser)
   - Redirect URI:
     `https://app.mergetasks.com/api/sso/oidc/callback/<storeSlug>`
3. **Supply** the client ID and secret to your MergeTasks admin — the
   secret is encrypted at rest.
4. **Claim requirements.** MergeTasks reads `sub`, `email`,
   `email_verified`, `given_name`, `family_name`. Callbacks where
   `email_verified === false` are rejected.

### Domain binding

Each IdP can be bound to an email domain (`idp.domain`). The callback
rejects SSO logins where the asserted email's domain doesn't match — a
simple but effective defense against cross-tenant email injection.

---

## 2. Network & Firewall Requirements

### Outbound from your IdP to MergeTasks

- `https://app.mergetasks.com` on port 443. No other hosts required for
  SSO flows.

### Outbound from MergeTasks to your IdP

- Our servers fetch your OIDC discovery URL and, during token exchange,
  your `token_endpoint`. Both are standard HTTPS (port 443) and cached
  for 1 hour.

### Inbound — none required

MergeTasks is SaaS; no inbound firewall rules on your side are needed
beyond whatever allows end-user browsers to reach `mergetasks.com`.

### Static IPs

Our egress traffic can be pinned to a dedicated NAT pool on request —
available on Enterprise. Contact `support@mergetasks.com` with your
organization ID.

---

## 3. Admin Provisioning

1. **Owner account.** The person who signed up for MergeTasks is the
   Organization Owner. They can promote any team member to Admin.
2. **Invite team members.** In `Settings → Team`, enter an email →
   MergeTasks sends an invite link (48h expiry). Accepting the link
   associates the user with the org.
3. **Roles:**
   - `owner` — full control, can transfer ownership, billing
   - `admin` — manage stores, clients, integrations, IdPs
   - `member` — standard user access per feature permissions

---

## 4. Bulk User Import (CSV)

For initial rollout, you can import end-users (store employees) via CSV.

1. Go to the store in question → `Users → Import CSV`.
2. CSV headers (required): `email`, `firstName`, `lastName`.
   Optional: `role`, `departmentId`.
3. Each row creates a store user bound to that store's domain rules.
   SSO users are auto-provisioned on first login — CSV is for
   pre-seeding known rosters (e.g. a launch day cohort).

---

## 5. Security Overview

### Tenant isolation

- Every query scopes by `organizationId` at the ORM layer. See
  `docs/security-audit-multitenant.md` for the verification run.
- Store-scoped resources (products, departments, orders) also carry a
  `storeId` with FK cascade delete.

### Encryption

- All traffic is TLS 1.2+ (HSTS in production).
- Database is MySQL 8 with encrypted storage volumes. RDS encryption
  or disk-level encryption depending on deployment.
- OIDC client secrets and third-party API credentials are encrypted at
  rest via `decryptCredential()` (AES-GCM with a KMS-managed key).

### Audit logging

- `sso.login.success`, `sso.login.failed`, account lockout, role
  changes, and billing events all write to the audit log.
- Retained for 12 months on the Pro tier, 7 years on Enterprise.

### Account lockout (PCI DSS 8.1.6)

- 5 failed login attempts → account locked for 30 minutes. Tracked per
  user on the `users` table.

### Session handling

- HTTP-only, `sameSite=lax`, `secure` in production.
- Store SSO sessions are independent of admin sessions (scoped by
  `mt_store_<slug>` cookie).

---

## 6. Support Contacts

- **Product / setup questions:** `support@mergetasks.com`
- **Security disclosures / incident response:** `security@mergetasks.com`
  (PGP key available on request)
- **Billing / contracts:** `billing@mergetasks.com`
- **Emergency (Enterprise SLA):** phone line provided in your MSA

Response targets:
- Free / Pro: 1 business day
- Enterprise: 4 hours (business), 1 hour (P1 outages, 24×7)
