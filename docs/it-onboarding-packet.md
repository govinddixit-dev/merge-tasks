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

## 2. Multi-Division SSO

> **Applies to you only if your MergeTasks store has Multi-Division
> enabled** (`store.multiDepartment === true && store.ssoEnabled === true`).
> If you run a single-division store, skip to §3.

Multi-division deployments give each division (e.g. *North America*,
*EMEA*, *Manufacturing*, *HR*) its own child store, its own catalog
filter, and its own routing. Each division has a distinct
`storeSlug` — so every division is a separate application registration
on your IdP.

### 2.1 What IT needs to configure

For each division, register a **separate SSO application** in your IdP
(one app per division, not one shared app). This keeps ACS URLs,
audience restrictions, and group assignments isolated per division —
so revoking access to one division doesn't affect the others.

For each app, use:

| Field            | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| ACS URL (SAML)   | `https://app.mergetasks.com/api/sso/saml/callback/<divisionSlug>` |
| Redirect (OIDC)  | `https://app.mergetasks.com/api/sso/oidc/callback/<divisionSlug>` |
| SP-init URL      | `https://app.mergetasks.com/api/sso/saml/init/<idpId>`     |
| Audience / EntityID | `https://app.mergetasks.com/sso/<divisionSlug>`         |

`<divisionSlug>` is shown in the store admin's **Settings → Divisions**
tab (or the Create Webstore wizard). If you haven't been sent the
slugs, ask your MergeTasks admin or reply to this packet's email.

### 2.2 Group → Division attribute / claim

MergeTasks auto-assigns a user to their division on first login from
the IdP assertion. The resolver uses the user's groups first, then
their email local-part, then their full email — the first hit in the
division's `groupToDivisionMap` wins.

- **SAML:** send a multi-valued `groups` attribute
  (`http://schemas.xmlsoap.org/claims/Group` or `memberOf`). Each value
  is a group name string.
- **OIDC:** include a `groups` claim (standard array of strings). If
  your IdP doesn't emit `groups` by default, configure a custom claim
  mapper (Okta: *Groups* claim with filter = *Regex* matching the
  division prefixes; Azure AD: emit `groups` as GroupNames; Keycloak:
  add a *Group Membership* protocol mapper).

If you cannot send groups, we fall back to the email domain (see §2.3)
and then to the email local-part — but groups are strongly recommended
because they let one user belong to one division cleanly.

### 2.3 Email domain → division mapping

If the IdP emits the same email for a user regardless of division, we
route by the *email domain*. Provide this table to your MergeTasks
admin so we can populate `groupToDivisionMap`:

| Division slug      | Routes for                                |
| ------------------ | ----------------------------------------- |
| `na.acme-store`    | `@acme-na.com`, `@acme.com` (default)     |
| `emea.acme-store`  | `@acme-eu.com`                            |
| `mfg.acme-store`   | `mfg-team` SSO group (any domain)         |

The table above is an example — replace with your actual domains,
groups, and division slugs. Rules evaluate in order group → local-part
→ full email; first match wins. Unmatched users land in the store's
default division (or are denied if the default is unset).

### 2.4 Testing that a user lands in the right division

1. Pick one pilot user per division (so you can confirm routing end-to-end).
2. Have them visit the division's SP-init URL (step 2.1) — they should
   be redirected to their IdP, complete login, and return to the
   division's child store, **not** the shared parent store.
3. In your MergeTasks admin, open **Settings → Users** and verify the
   pilot's `divisionId` matches the division they logged in through.
4. Check the `sso.login.success` audit log entry — it records the
   `divisionId` assigned at login and the rule that matched (group,
   domain, or local-part).

If the user lands in the wrong division, it's almost always because
(a) the IdP didn't emit the expected group/claim, or (b) the
`groupToDivisionMap` on our side is missing a rule. Pull the raw SAML
response or OIDC ID token (your IdP's debug view) and send it to
`support@mergetasks.com` — we'll diff it against the map.

### 2.5 Who to contact when a user lands in the wrong division

- **First line:** your own IdP admin — 9 times in 10, the assertion is
  missing the group / is emitting an unexpected value.
- **MergeTasks:** `support@mergetasks.com` with the user's email, the
  expected division, and (if possible) the SAML response XML or OIDC
  ID token. We respond within the SLA on your contract.
- **Production-down (Enterprise SLA):** see §7 — the P1 phone line.

### 2.6 Adding a division later

When your MergeTasks admin adds a new division after this packet was
first sent, they'll see an **"Resend updated IT packet"** option in
the admin UI after adding. Clicking it re-delivers this packet with
the new division's slugs and ACS URLs included — no need to chase
your account manager.

---

## 3. Network & Firewall Requirements

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

## 4. Admin Provisioning

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

## 5. Bulk User Import (CSV)

For initial rollout, you can import end-users (store employees) via CSV.

1. Go to the store in question → `Users → Import CSV`.
2. CSV headers (required): `email`, `firstName`, `lastName`.
   Optional: `role`, `departmentId`.
3. Each row creates a store user bound to that store's domain rules.
   SSO users are auto-provisioned on first login — CSV is for
   pre-seeding known rosters (e.g. a launch day cohort).

---

## 6. Security Overview

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

## 7. Support Contacts

- **Product / setup questions:** `support@mergetasks.com`
- **Security disclosures / incident response:** `security@mergetasks.com`
  (PGP key available on request)
- **Billing / contracts:** `billing@mergetasks.com`
- **Emergency (Enterprise SLA):** phone line provided in your MSA

Response targets:
- Free / Pro: 1 business day
- Enterprise: 4 hours (business), 1 hour (P1 outages, 24×7)
