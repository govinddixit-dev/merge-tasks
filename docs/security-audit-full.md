# Full Security Audit

**Scope:** XSS, CSRF, SQL injection, secrets hygiene, rate limiting,
dependency vulnerabilities, input validation.
**Date:** 2026-04-14 (re-audit).
**Auditor:** automated review + targeted code inspection.

## 2026-04-14 delta review

`npm audit --production` surfaces two advisories:

1. **drizzle-orm < 0.45.2** — GHSA-gpj5-g38j-94v9, high severity,
   SQL injection via improperly escaped SQL *identifiers* (not
   values). Our codebase uses drizzle's parameter bindings (`eq`,
   `and`, `sql\`\``) for values and never builds identifiers from user
   input — the only identifier sources are compile-time constants in
   schema.ts. Exploitability in this codebase is effectively zero.
   The fix is a major-version bump; scheduled as a standalone PR.
2. **follow-redirects <= 1.15.11** — moderate severity, leaks custom
   auth headers on cross-domain redirects. We do not set cross-domain
   custom auth headers on outbound HTTP calls. Fix available via
   `npm audit fix` but currently blocked by a peer-dep conflict on
   `@builder.io/vite-plugin-jsx-loc`. Safe to defer.

XSS spot-check confirmed every `dangerouslySetInnerHTML` site passes
content through `DOMPurify.sanitize(...)` (DashboardAIChat,
ProposalEmailPreviewModal, chart). No unsanitized HTML paths.

No new critical/high findings required code changes in this pass.

Multi-tenant / IDOR audit is covered separately in
`docs/security-audit-multitenant.md`.

## Summary

| Area              | Status         | Critical | High | Medium | Low |
| ----------------- | -------------- | -------- | ---- | ------ | --- |
| SQL injection     | ✓ Passing      | 0        | 1*   | 0      | 0   |
| XSS               | ✓ Passing      | 0        | 0    | 0      | 1   |
| CSRF              | ✓ Passing      | 0        | 0    | 0      | 0   |
| Secrets in code   | ✓ Clean        | 0        | 0    | 0      | 0   |
| Rate limiting     | ✓ In place     | 0        | 0    | 0      | 1   |
| Input validation  | ✓ Zod-gated    | 0        | 0    | 0      | 1   |
| Deps (npm audit)  | ⚠ 1 high       | 0        | 1    | 0      | 0   |

\* The drizzle-orm advisory is dependency-level, not application-level —
the codebase does not use the vulnerable code path (no user-controlled
identifiers passed to `sql.identifier()` anywhere in the source).

## SQL Injection

**Finding:** No application-level SQL injection vectors.

Drizzle parameterizes all `eq`/`and`/`or`/`gt`/`lt` predicates. Raw
`sql\`\`` templates are used in three places (`server/jobs/dataRetentionCleanup.ts`
and two session/token cleanup scripts); all of them are static queries
with no user-controlled input:

```ts
await db.execute(sql`DELETE FROM verificationCodes WHERE expiresAt < NOW() ...`);
```

No user input flows into these templates.

**Dep-level advisory (HIGH):** `drizzle-orm < 0.45.2` has GHSA-gpj5-g38j-94v9
(SQL injection via improperly escaped SQL identifiers). The advisory
affects `sql.identifier(userInput)` which the codebase does not use.
**Remediation:** schedule a drizzle-orm major upgrade on its own PR
(breaking change — requires regression pass). Tracked as the single
outstanding high.

## XSS

React auto-escapes JSX interpolation. `dangerouslySetInnerHTML` is used
in three places:

1. `client/src/components/dashboard/DashboardAIChat.tsx` — every
   insertion goes through `DOMPurify.sanitize()` with an explicit
   allowlist (`span`, `strong`, `em`, `class`).
2. `client/src/components/proposal/ProposalEmailPreviewModal.tsx` —
   input is sanitized via `DOMPurify.sanitize(html, PURIFY_CONFIG)`.
3. `client/src/components/ui/chart.tsx` — inlined CSS generated from
   chart config (shadcn pattern). The input is developer-controlled
   color strings, not user input.

**Low:** the chart.tsx inline style block uses a hardcoded template
with typed chart configs — safe today, but a future contributor could
add user-sourced CSS without noticing. Defensive fix: constrain the
regex that validates color strings before interpolation.

Backend email HTML is built via typed template builders (`buildEmailHtml`)
that interpolate caller-provided values into style-heavy HTML. Values
come from authenticated internal APIs, not end-user input. Names and
email addresses do transit these templates — if an attacker could set
their profile name to `</style><script>...`, the script would run on the
*next* email render. **Remediation:** sanitize profile names in the
template builder (defensive), or at ingest.

## CSRF

- tRPC uses POST with custom JSON content-type (`application/json`),
  which browsers treat as a non-simple cross-origin request. Preflight
  CORS blocks external origins.
- Session cookies are set `sameSite=lax` — forms CSRF'd from another
  origin do not forward the session cookie.
- The store SSO cookies are also `sameSite=lax, httpOnly, secure` in
  prod.

No CSRF findings.

## Secrets in Code

Scanned for: `sk_live_…`, `sk_test_[A-Za-z0-9]{20+}`, `AKIA…`,
`AIza…[35 chars]`, hardcoded JWT secrets, hardcoded DB passwords.

All hits are either:
- String literals in `validateEnv.ts` describing the expected *format*
  of a Stripe key at runtime (not actual keys).
- Example placeholder strings in a `.bak` file
  (`client/src/components/curation/CurationImportModal.tsx.fix-products.bak`).

**Recommendation:** delete stale `.bak` files from the tree so they
don't drift or confuse future audits.

## Rate Limiting

Auth endpoints are rate-limited in `server/routers/onboarding.ts`:

- `signUp` → SIGNUP_LIMIT
- `signIn` → SIGNIN_LIMIT
- `verify2FA` → VERIFY_2FA_LIMIT
- `resendCode` → RESEND_CODE_LIMIT

Applied via `.use(rateLimited("<key>", LIMIT))`.
PCI DSS 8.1.6 account lockout (5 fails → 30min) is also enforced in
the sign-in handler.

**Low:** store-facing auth (`storeAuth.ts`, SSO callbacks) relies on
the global rate limiter + short-lived OTP hashes, but does not use the
named rate-limit buckets. Acceptable today given OTP rotation, but a
dedicated bucket for store OTP verify would be safer.

## Input Validation

Every tRPC procedure has a `z.object({...})` input schema. The tRPC
initializer also applies a global `sanitizeInputs` middleware
(`server/_core/trpc.ts` via `createSanitizeMiddleware`) that:

- Strips null bytes
- Caps string lengths
- Removes control characters / HTML-escape-on-read

Express routes (`server/routes/*.ts`) use explicit `express.json({ limit })`
and validate body fields before use (spot-checked SSO callback, file
upload).

**Low:** a few public procedures accept string arrays (e.g. `saveOnboarding`
with `specialties: z.array(z.string())`) without a per-item length cap.
The global sanitizer covers overall length, but a tightened
`z.string().max(120)` per item would be stricter.

## Dependency Vulnerabilities

`npm audit --production --audit-level=high` result:

```
drizzle-orm  <0.45.2
Severity: high
Drizzle ORM SQL injection via improperly escaped SQL identifiers
(GHSA-gpj5-g38j-94v9)
```

**Application exposure:** NONE. The advisory affects
`sql.identifier(<dynamic value>)`. A repo-wide grep for
`sql.identifier` returns zero hits — the codebase does not use the
vulnerable API.

**Remediation:** upgrade to `drizzle-orm@^0.45.2` on a dedicated PR
with regression tests (breaking change on minor APIs elsewhere). This
is defense-in-depth; not blocking today.

No other high/critical advisories at audit time.

## Fixes Applied in This Pass

1. **OIDC `email_verified` enforcement** — `server/utils/oidcProvider.ts`
   (shipped in the SSO-verification commit earlier in the same sprint).
2. **`orgProcedure` middleware** — `server/_core/trpc.ts` — enforces
   `ctx.organizationId != null` and narrows its type, reducing the
   chance of accidental cross-tenant reads in new routers.

No further critical/high findings required code changes beyond what is
already in the codebase.

## Follow-up Backlog

- Schedule drizzle-orm major upgrade (own PR + regression pass).
- Delete stale `.bak` files from the repository.
- Add a dedicated rate-limit bucket for store OTP verify endpoints.
- Defensive sanitization of user-provided display names in email
  template builders.
- Tighten per-item length caps on free-form string arrays.
