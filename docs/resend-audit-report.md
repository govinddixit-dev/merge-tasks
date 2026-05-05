# Resend.com Email Integration Audit Report

_Date: 2026-04-14_

## 1. Integration Setup

### Initialization & Configuration
- **File:** `server/email/mailer.ts:1,13-21` — Resend client initialized via lazy singleton `getResend()`.
- **Import:** `import { Resend } from "resend";` (line 1)
- **Singleton pattern:** Module-level `_resend` and `_cachedKey` maintain state; `getResend()` (lines 13–21) returns cached instance if the API key hasn't changed. `resetTransporter()` (lines 28–32) clears cache.
- **Fallback:** `getResend()` returns `null` if `RESEND_API_KEY` is unset. `sendEmail()` (lines 57–59) returns `{ sent: false, error: "RESEND_API_KEY not configured" }`. Logs a warning; does NOT crash. There is **no SMTP fallback** for Resend-only paths — only proposal sends have a multi-tier fallback (`server/routers/proposalsSend.ts:235-257`).

### Environment Variable
- **Variable:** `RESEND_API_KEY`
- **`.env.example:72-76`** — Documented as "[REQUIRED FOR LOGIN]".
- **`server/utils/validateEnv.ts`** — **NOT enforced** in the `ENV_VARS` array. Server starts without the key; login silently fails.
- **`.env:41`** — Present in live config. (Note: `.env` is committed to the repo; all secrets including Stripe, AWS, MySQL, OAuth, and Resend are exposed.)

---

## 2. Email Sending Coverage

All production emails route through Resend via `sendEmail()` in `server/email/mailer.ts`. Only proposal delivery uses a multi-provider routing chain (user SMTP → Gmail OAuth → Outlook OAuth → Resend fallback).

### Email Type Inventory

| # | Email Type | File / Line | Recipient | Provider | Branding Lane |
|---|---|---|---|---|---|
| 1 | Welcome / signup verification (2FA) | `server/routers/onboarding.ts:135` | New distributor | Resend | Lane 1 (MT) |
| 2 | Login verification (2FA) | `server/routers/onboarding.ts:257` | Existing distributor | Resend | Lane 1 |
| 3 | Store login code | `server/routers/storeAuth.ts:183` (template lines 58–79) | Store user | Resend | Lane 3 |
| 4 | Proposal sent to client | `server/routers/proposalsSend.ts:138-151, 238-257` | Client contact | User SMTP → Gmail OAuth → Outlook OAuth → Resend fallback | Lane 2 |
| 5 | Department approval request | `server/routers/departmentApprovals.ts:146-179` | Department contact | Resend | Lane 2 |
| 6 | Proposal accepted / order notification | `server/stripe/webhook.ts`, `server/routers/storePortalProposals.ts` (template `server/email/proposalAcceptedEmail.ts:29+`) | Distributor | Resend | Lane 1 |
| 7 | Order shipped | `server/stripe/webhook.ts:~337` (template `server/email/emailTemplates/emailTemplatesDistributor.ts:94-150`) | Distributor | Resend | Lane 1 |
| 8 | Fulfillment approved | `server/routes/publicProposal/publicProposalFulfillment.ts:239+` (template `emailTemplatesDistributor.ts:26-85`) | Distributor | Resend | Lane 1 |
| 9 | Store approval request | `server/routes/storeApproval.ts:74+` (template `emailTemplatesClient.ts:165-208`) | Store admin/POC | Resend | Lane 2 |
| 10 | SSO setup guide | `server/email/sendSsoOnboardingEmail.ts:44-77` | Distributor admin | Resend (PDF attachment) | Lane 1 |
| 11 | IT onboarding packet | `server/email/sendItOnboardingEmail.ts:43-67` | Org admin | Resend (PDF/MD attachment) | Lane 1 |
| 12 | Organization invite | `server/routers/organizations.ts:322` | Invited user | Resend | Lane 1 |
| 13 | Store user invite | `server/routers/storeUserProvisioning/storeUserProvisioningHelpers.ts` (template `emailTemplatesStore.ts:24-63`) | New store user | Resend | Lane 3 |
| 14 | Custom request rejected | `server/routers/storePortalCustomRequests.ts:186-189` (template `emailTemplatesStore.ts:128-154`) | Employee | Resend | Lane 3 |
| 15 | Refund requested | `server/routers/storePortalRefunds.ts:131+` | Distributor | Resend | Lane 2 |
| 16 | Proposal edited by client | `server/routers/storePortalProposals.ts:545` | Distributor | Resend | Lane 2 |
| 17 | Proposal declined by client | `server/routers/storePortalProposals.ts:610` | Distributor | Resend | Lane 2 |
| 18 | Copilot arbitrary send | `server/routers/copilotExecBranding.ts:162` | User-specified | Resend | Variable |

**Summary:** 18 email types. All go through Resend. Only proposal send (#4) has a multi-tier provider chain. No emails are left on legacy nodemailer-only paths. No stubbed emails found.

---

## 3. Email Templates

### Architecture
**Three-Lane branding system** (`server/email/brandingResolver.ts`):
- **Lane 1:** Platform → Distributor — MergeTasks branding only (`resolveTier1()`)
- **Lane 2:** Distributor → Client — Distributor branding with MT fallback (`brandingResolver.ts:84`)
- **Lane 3:** Store → End Client — Store branding (`brandingResolver.ts:123`)

### Template Files
- `server/email/emailTemplates/emailTemplateBase.ts` (512 lines) — `buildEmailHtml()`, `buildOtpEmailHtml()`, `formatCurrency()`, `lightenHex()`, `renderProductCard()`, `renderAlertBox()`.
- `server/email/emailTemplates/emailTemplatesDistributor.ts` (232 lines) — Lane 1.
- `server/email/emailTemplates/emailTemplatesClient.ts` (208 lines) — Lane 2.
- `server/email/emailTemplates/emailTemplatesStore.ts` (174 lines) — Lane 3.
- `server/email/proposalEmail.ts` (~18.7 KB) — Rich proposal HTML.
- `server/email/proposalAcceptedEmail.ts` (~9.4 KB) — Order summary.
- `server/email/ssoOnboardingEmail.ts` (~3 KB) and `server/email/itOnboardingEmail.ts` (~2.2 KB).
- Inline template: `server/routers/storeAuth.ts:58-79`.

### Framework
- **Raw HTML**, table-based with MSO conditional comments for Outlook. **Not** using Resend React Email. Inline styles; responsive via `max-width`. No dedicated accessibility pattern.

### Branding Consistency Issues
- **Hardcoded MergeTasks logo URL** — `server/email/proposalEmail.ts:11,76` and `server/email/proposalAcceptedEmail.ts:76` use a hardcoded CDN URL. `proposalEmail.ts:96` has a fallback but does not correctly prefer `distributorProfiles.brandLogoUrl`.
- **Hardcoded primary color** constant `MT.purple = #654BF9` in `emailTemplateBase.ts` (fallback is used consistently when `branding?.primaryColor` is absent — acceptable).
- **Hardcoded support/security addresses:**
  - `server/email/itOnboardingEmail.ts:49` — `support@mergetasks.com`, `security@mergetasks.com`
  - `server/email/ssoOnboardingEmail.ts:61` — `support@mergetasks.com`
- **Hardcoded from address:** `info@mergetasks.com` (`mailer.ts:7`) — acceptable, prevents sender spoofing; display name varies by lane.
- **Non-functional unsubscribe URLs** — `emailTemplateBase.ts:380`, `proposalEmail.ts:314` reference `/mergetasks.com/unsubscribe` which has no handler.

---

## 4. Error Handling

### Resend API Failures (`server/email/mailer.ts:56-106`)
- **Missing API key** (14–15, 57–59): returns `{ sent: false, error }`, logs `warn`. Non-fatal.
- **Validation errors from Resend** (92–95): logged as `error`, returned to caller.
- **Unexpected exceptions** (98–105): caught broadly. If the error mentions `API key`/`unauthorized`/`401`, calls `resetTransporter()` (line 102) to force re-init.

### Fire-and-Forget Patterns (silent failures)
- **`server/routers/organizations.ts:322-325`** — invite email wrapped in try/catch; failures logged but mutation still succeeds (user record orphaned without notification).
- **`server/routers/orders.ts:266-273`** — empty catch block swallows failure with no log.
- **`server/routers/storePortalCustomRequests.ts:186-189`** — rejection email try/catch with minimal handling.

### Proposal Send (`server/routers/proposalsSend.ts:156-257`)
- Multi-tier fallback properly awaits each provider.
- **Critical bug:** proposal status is set to `sent` at `proposalsSend.ts:64` BEFORE email dispatch. If the fallback at 238–257 also fails, DB state says "sent" but no email was delivered.

### 2FA Email (Hard Required)
- `server/routers/onboarding.ts:138-145, 257-265` — if `emailResult.emailDelivered` is false, returns `{ success: false, error: "Unable to send verification email..." }`. Prevents orphaned accounts. ✓

### Retry Logic
- **None.** No exponential backoff, no job queue (Bull/BullMQ), no dead-letter handling. One-shot sends. Only 2FA offers user-triggered resend.

---

## 5. Rate Limiting & Security

### Rate Limits (`server/utils/rateLimiter.ts`)
- Sign-in: 5 / 15 min / IP (lines 263–267)
- Sign-up: 3 / hour / IP (lines 270–274)
- 2FA verify: 10 / 15 min / IP (lines 277–281)
- Resend code: 3 / 10 min / IP (lines 284–288)
- Proposal send: 20 / hour / user (lines 305–309) — **no per-recipient limit**
- Storage: in-memory by default; Redis if `REDIS_URL` set (line 10).

### API Key Exposure
- **Not exposed.** No `NEXT_PUBLIC_RESEND_*` or `VITE_RESEND_*` references. `process.env.RESEND_API_KEY` is read only in `server/email/mailer.ts:14`. All sends go through server-side tRPC.

### Abuse Surfaces
- **`server/routers/copilotExecBranding.ts:162`** — authenticated copilot procedure sends arbitrary `{ to, subject, body }` to any address. Under `protectedProcedure` but not explicitly rate-limited at this endpoint. Single authenticated user could spam external recipients.
- **Proposal send** — 20/hour/user allows bulk spam to 20 different recipients before throttling.

### Secrets in Source Control
- **`.env:41`** is tracked in the repo and contains `RESEND_API_KEY` plus Stripe, AWS, MySQL, and OAuth secrets. Should be `.gitignore`d and the key rotated.

### Email Headers
- **From:** `info@mergetasks.com` always ✓
- **Reply-To:** correctly lane-scoped (`mailer.ts:44-46,88`) ✓
- **List-Unsubscribe / List-Unsubscribe-Post:** **MISSING** — violates RFC 8058; risks Gmail/Outlook spam folder placement.

---

## 6. Gaps & Recommendations

### Critical
1. **Add `RESEND_API_KEY` to `server/utils/validateEnv.ts`** as required. Currently documented in `.env.example` as required but unenforced; misconfiguration produces silent login failures.
2. **Add `List-Unsubscribe` headers** in `server/email/mailer.ts` to the Resend send payload:
   ```
   headers: {
     "List-Unsubscribe": "<mailto:unsubscribe@mergetasks.com>",
     "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
   }
   ```
3. **Fix proposal status race** — `server/routers/proposalsSend.ts:64` marks proposal as `sent` before email dispatch. Move the status update to after confirmed delivery; throw `TRPCError` if all providers fail.
4. **Rotate the leaked `RESEND_API_KEY`** — `.env:41` is committed. Remove `.env` from the repo, add to `.gitignore`, rotate all secrets.
5. **Externalize support emails** — hardcoded `support@mergetasks.com` / `security@mergetasks.com` in `itOnboardingEmail.ts:49`, `ssoOnboardingEmail.ts:61`. Move to env vars or a config constant.
6. **Implement retry / queue** for non-2FA sends (BullMQ or Resend batch API) so transient failures aren't permanently lost.

### Medium
7. **Implement unsubscribe handler** — templates link to `/mergetasks.com/unsubscribe` but no route exists.
8. **Rate-limit copilot email endpoint** (`copilotExecBranding.ts:162`) with a dedicated per-user/per-hour cap independent of the proposal limiter.
9. **Replace fire-and-forget catches** in `organizations.ts:322-325`, `orders.ts:266-273`, `storePortalCustomRequests.ts:186-189` with a retry job or at minimum a surfaced warning on the response.
10. **Validate recipient email format** in `sendEmail()` before calling Resend.
11. **Fix logo branding fallback** in `proposalEmail.ts:11,76,96` to prefer `branding.logoUrl` from the distributor profile.

### Missing Email Flows
12. Proposal expiry warning (e.g., 3 days before `validUntil`).
13. Approval-link expiry reminder (72-hour tokens for dept/store approvals).
14. Payment failure notification — Stripe webhook currently only emits in-app notifications.
15. Partial order fulfillment updates.
16. "Manager review pending" nudge to managers when custom requests are created.

### Enhancements
17. Add preview endpoints for all email builders (only proposals currently have `emailPreview`).
18. Process Resend webhook events (bounce, complaint, delivery) for deliverability tracking.
19. Attach generated proposal PDF to proposal emails (schema supports it; unused).
20. Template versioning header for debugging client rendering differences.

---

## Appendix — Key File Manifest

### Core
- `server/email/mailer.ts` (143 lines)
- `server/email/brandingResolver.ts` (153 lines)
- `server/email/emailTemplates.ts` (52 lines, barrel)
- `server/email/emailTemplates/emailTemplateBase.ts` (512 lines)
- `server/email/emailTemplates/emailTemplatesDistributor.ts` (232 lines)
- `server/email/emailTemplates/emailTemplatesClient.ts` (208 lines)
- `server/email/emailTemplates/emailTemplatesStore.ts` (174 lines)
- `server/email/proposalEmail.ts`, `proposalAcceptedEmail.ts`, `ssoOnboardingEmail.ts`, `itOnboardingEmail.ts`, `sendSsoOnboardingEmail.ts`, `sendItOnboardingEmail.ts`

### Routers using `sendEmail()`
- `server/routers/onboarding.ts`, `storeAuth.ts`, `proposalsSend.ts`, `departmentApprovals.ts`, `organizations.ts`, `storePortalProposals.ts`, `storePortalCustomRequests.ts`, `storePortalRefunds.ts`, `orders.ts`, `refunds.ts`, `copilotExecBranding.ts`, `storeUserProvisioning/storeUserProvisioningHelpers.ts`
- `server/stripe/webhook.ts`
- `server/routes/publicProposal/publicProposalApprovals.ts`, `publicProposalFulfillment.ts`, `publicProposalOrderItems.ts`

### Config
- `server/utils/rateLimiter.ts`, `server/utils/validateEnv.ts`, `.env.example`, `.env`

### Dependencies (package.json)
- `resend@^6.11.0`, `nodemailer@8.0.4` (only used in proposal send fallback chain)

---

## Final Summary

**Status:** Functional. All 18 identified email types route through Resend; no legacy-only SMTP paths remain.

**Top Risks**
- **Deliverability:** missing `List-Unsubscribe` headers; broken unsubscribe URLs.
- **Data integrity:** proposals marked `sent` before email confirmation.
- **Config drift:** `RESEND_API_KEY` unenforced in `validateEnv.ts`.
- **Secrets hygiene:** `.env` (including Resend key) committed to the repo.
- **Abuse surface:** copilot email endpoint lacks dedicated rate limit.

**Strengths**
- Clean lazy-singleton client with API-key rotation handling.
- Three-lane branding resolver cleanly separates platform/distributor/store identity.
- 2FA emails correctly hard-fail signup/login when undelivered.
- No API key exposure on the client.
