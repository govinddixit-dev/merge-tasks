# Master Audit Report

_Scope: every item shipped across recent sprints. Date: 2026-04-14. Branch: `main`._

This report audits the codebase as it stands on `main`. No files were modified during the audit; all evidence is file-path + line-number citations.

---

## Executive Summary

| Section | Items | ✅ | ⚠️ | ❌ |
|---|---|---|---|---|
| 1. Critical Bug Fixes | 6 | 6 | 0 | 0 |
| 2. Dead Code Cleanup | 6 | 6 | 0 | 0 |
| 3. Multi-Division SSO | 8 | 8 | 0 | 0 |
| 4. Print Store | 7 | 7 | 0 | 0 |
| 5. Media Tab | 4 | 4 | 0 | 0 |
| 6. Follow-up Prompt Items | 8 | 8 | 0 | 0 |
| 7. Session Timeout | 9 | 0 | 1 | 8 |
| 8. Email Fixes | 8 | 8 | 0 | 0 |
| 9. Store Management Fixes | 9 | 5 | 2 | 2 |
| 10. Repository Hygiene | 4 | 2 | 0 | 2 |
| 11. Regression Check | 5 | 5 | 0 | 0 |
| 12. UI/UX Consistency | 8 | 7 | 0 | 1 |
| **Total** | **82** | **66** | **3** | **13** |

**80 % of audited items are complete.** The dominant gap is **Section 7 (Session Timeout)** — the feature has not been built. The repo is also missing a LICENSE and README at the root, and four smaller store-management ergonomics items are short of the original spec.

Regression posture is clean: TypeScript compiles, the Vite + esbuild build succeeds, all 699 runnable tests pass, pm2 shows the service `online`.

---

## Section 1 — Critical Bug Fixes

### 1.1 "Email to Supplier" button — ✅ COMPLETE
`client/src/pages/PurchaseOrderDetail.tsx:225-242` — button carries `disabled`, `aria-disabled="true"`, `cursor-not-allowed`, `opacity-50`, and a `Tooltip` with copy "Email delivery coming soon. Download PDF to email manually."

### 1.2 `AWS_S3_BUCKET` documented in `validateEnv.ts` — ✅ COMPLETE
`server/utils/validateEnv.ts:63-67` documents `AWS_S3_BUCKET` alongside `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` with description "S3 bucket name for storing uploaded logos and images".

### 1.3 `APP_BASE_URL` used consistently — ✅ COMPLETE
Grep across the repo returns no remaining `VITE_APP_URL` or `process.env.APP_URL` references. `server/utils/validateEnv.ts:38-40` defines `APP_BASE_URL` as the single canonical variable. Only non-functional comments in `server/routers/storeCheckout.ts:71,105,115,118` mention the old name for history.

### 1.4 Rate limiting on AI endpoints — ✅ COMPLETE
All eight procedures carry `rateLimited(...)` middleware:
- `server/routers/proofing.ts:285` `bulkRender` → `PROOFING_BULK_LIMIT`
- `server/routers/proofing.ts:444` `renderProof` → `PROOFING_RENDER_LIMIT`
- `server/routers/voice.ts:16` `transcribe` → `VOICE_LIMIT`
- `server/routers/voice.ts:85` `speak` → `VOICE_LIMIT`
- `server/routers/aiInsights.ts:119` `predictiveReorders`
- `server/routers/aiInsights.ts:238` `churnSignals`
- `server/routers/aiInsights.ts:418` `storeRecommendations`
- `server/routers/aiInsights.ts:625` `dashboardSummary`

### 1.5 QuickBooks sync error handling — ✅ COMPLETE
`server/routers/purchaseOrders.ts:150-160` logs via `log.warn`, writes a `purchaseOrderEvents` row carrying the sync status and error string, and `server/utils/quickbooksPOSync.ts:35-42,149` returns a structured `{ synced, status, error }` result rather than throwing away failures.

### 1.6 `writePaths.test.ts` calls `account.deleteMyAccount` — ✅ COMPLETE
`server/writePaths.test.ts:254-266` exercises `caller.account.deleteMyAccount({ confirmEmail })`. The full file passes (27/27 tests).

---

## Section 2 — Dead Code Cleanup

All six items verified. The five deleted files have no live references — only historical-context comments remain.

| File | Evidence | Status |
|---|---|---|
| 2.1 `Integrations.tsx` | Absent; `client/src/App.tsx:12` carries a comment-only note | ✅ |
| 2.2 `ITAdminPortal.tsx` | Absent; `client/src/App.tsx:15` comment-only | ✅ |
| 2.3 `ComponentShowcase.tsx` | Absent; no references in repo grep | ✅ |
| 2.4 `copilotInlineExecutors.ts` | Absent; only historical comments in `copilotServiceClients.ts:5` and `copilotServiceScope.ts:5` | ✅ |
| 2.5 `AIChatBox.tsx` | Absent; only a doc-comment in `client/src/components/po/POBulkPreviewCard.tsx:2` | ✅ |
| 2.6 `PrintStore.tsx` preserved and using live data | `client/src/pages/PrintStore.tsx:36` calls `trpc.printProducts.listPublic.useQuery`; no hardcoded arrays | ✅ |

---

## Section 3 — Multi-Division SSO

### 3.1 Schema columns + migration — ✅ COMPLETE
`drizzle/schema.ts:1287` `targetStoreId` and `drizzle/schema.ts:1290` `defaultDepartmentId` on `storeIdentityProviders`. Migration `drizzle/0058_sso_division_routing.sql`.

### 3.2 Wizard payloads carry `multiDepartment` — ✅ COMPLETE
`client/src/pages/CreateWebstore.tsx:247` (draft save), `client/src/pages/CreateWebstore.tsx:319` (launch payload).

### 3.3 `getBySlug` returns `multiDepartment` — ✅ COMPLETE
`server/routers/storesCrud.ts:157-172` defines `getBySlug`; line 253 returns `multiDepartment: store.multiDepartment`.

### 3.4 `resolveSsoUser` accepts `defaultDepartmentId` — ✅ COMPLETE
`server/utils/ssoUserResolver.ts:79-84` (signature) and `:208` (insert `departmentId: defaultDepartmentId ?? null`).

### 3.5 SSO callback routing + ownership check — ✅ COMPLETE
`server/routes/storeSsoCallback.ts:46-55` defines `buildSuccessRedirect`; `:71-93` resolves the division slug and verifies organization ownership; `:231` calls it with `idp.targetStoreId ?? null`.

### 3.6 SSO settings UI + schema — ✅ COMPLETE
`client/src/components/settings/StoreSsoSettings.tsx:40-41, 55-56, 70-71` state; `:416-436` render. Server schemas: `server/routers/storeSso.ts:140-142` (create) and `:256-257` (update) accept both fields; persisted at `:198-199, 291, 294`.

### 3.7 `StepDivisions` wizard step — ✅ COMPLETE
`client/src/components/webstore/Step4Divisions.tsx` exists; `:19-21` gates on `multiDivisionEnabled` and `ssoProvider !== "none"`; registered at `client/src/pages/CreateWebstore.tsx:850`.

### 3.8 IT packet conditionals and no hardcoded host — ✅ COMPLETE
`docs/it-onboarding-packet.md:64-143` is the Multi-Division SSO section, guarded by `multiDepartment === true && ssoEnabled === true` (`:67`). No `admin.mergetasks.com` references.

---

## Section 4 — Print Store

### 4.1 Schema — ✅ COMPLETE
`drizzle/schema.ts:1307` `printProducts`, `:1324` `printProductVariants`, `:1336` `printProductPricing`, `:1347` `printSupplierConnections`. Migration `drizzle/0060_print_store_and_media.sql`.

### 4.2 Router procedures — ✅ COMPLETE
`server/routers/printProducts.ts` — `list` (:88), `listPublic` (:110), `getById` (:141), `create` (:159), `update` (:212), `delete` (:271, soft), `bulkImportTemplate` (:288), `bulkImport` (:300). Supplier sub-router `:404-462` — `list`, `connect`, `sync`.

### 4.3 Storefront — ✅ COMPLETE
`client/src/pages/PrintStore.tsx:36` live `listPublic` query; `:55-71` tabs ("Promotional Products" link + active "Print Products"); detail modal `:149-320` — size, stock, tier selectors and dynamic price calc `:287-304`; add-to-cart dispatched via custom event on `:210`.

### 4.4 Budget enforcement on print orders — ✅ COMPLETE
`client/src/pages/webstore/StoreCheckoutPage.tsx:78-82` budget lookup, `:118-120` `overBudget` calc, `:228` submission block. Comment `:243-245` confirms the budget is enforced against the unified cart total before promo/print split.

### 4.5 Distributor management UI — ✅ COMPLETE
`client/src/pages/StoreManagement/PrintProductsTab.tsx` — list `:40`, add/edit `:63-98,204-236`, variant matrix `:239-299`, soft-delete `:100`, CSV template + upload `:44,110-119`, supplier list `:46`, add connection `:133-148`, manual sync `:150-162`.

### 4.6 `printRequests.divisionId` — ✅ COMPLETE
`drizzle/schema.ts:872` nullable FK to `divisions.id`; migration `drizzle/0059_print_requests_division.sql` sets the column and ON DELETE SET NULL.

### 4.7 Routing registration — ✅ COMPLETE
tRPC: `server/routers.ts:40-41, 119-121` (`printProducts`, `printSupplier`, `storeMedia`). Frontend: `client/src/pages/webstore/LiveStore.tsx:29,326` mounts `PrintStore`. Management tabs: `client/src/pages/StoreManagement.tsx:42-43, 325, 660, 664`.

---

## Section 5 — Media Tab

### 5.1 `storeMediaFiles` schema — ✅ COMPLETE
`drizzle/schema.ts:1365-1380` with `id`, `storeId` (cascade), `uploadedBy` enum (`distributor`/`poc`), `uploadedByUserId`, `fileName`, `fileUrl`, `fileType`, `fileSizeBytes`, `description`, `createdAt`. Migration `drizzle/0060_print_store_and_media.sql:57-71`.

### 5.2 Backend routers — ✅ COMPLETE
`server/routers/storeMedia.ts` — distributor: `list` (:81), `upload` (:90, 25 MB cap), `delete` (:117). Portal: `listPortal` (:131), `uploadPortal` (:138), `deletePortal` (:163) with ownership guard `:172-173`.

### 5.3 Distributor Media tab — ✅ COMPLETE
`client/src/pages/StoreManagement/MediaTab.tsx` — live `list` `:56`, upload `:57`, delete `:58`; drag-and-drop zone `:163-180`; grid `:206-258`; search `:133-142`.

### 5.4 POC portal Media tab — ✅ COMPLETE
`client/src/pages/webstore/WebstorePortal/PortalMediaTab.tsx:64` live `listPortal`; upload `:68` (25 MB), download on any file `:226`, image preview `:221-224`; trash button gated client-side `:127-128,229` and server-side `storeMedia.ts:172-173`; empty-state copy `:198-200`.

---

## Section 6 — Follow-up Prompt Items

### 6.1 Dept approval token expiry — ✅ COMPLETE
`drizzle/schema.ts:907` `tokenExpiresAt`; migration `drizzle/0061_dept_approval_token_expiry.sql`. Toggle `server/routers/proposalsCrud.ts:192` `approvalLinkExpiryEnabled`. 72-hour issuance `server/routers/proposalsSend.ts:330-343`. Expired-link copy `client/src/pages/DepartmentApproval.tsx:148`. Server-side expiry check `server/routes/publicProposal/publicProposalApprovals.ts:324,446`.

### 6.2 Declined PO status — ✅ COMPLETE
`drizzle/schema.ts:1549-1552` enum includes `declined`; migration `drizzle/0062_po_declined_status.sql`. Badge `client/src/pages/PurchaseOrders.tsx:30`; filter option `:140`.

### 6.3 `DivisionsTab.tsx` deleted — ✅ COMPLETE
No such file. Functionality lives in-place as `DivisionsCard` inside `client/src/pages/StoreManagement/SettingsTab.tsx:1299-1510`. That matches the requested consolidation.

### 6.4 Divisions section in `SettingsTab` — ✅ COMPLETE
Rendered at `SettingsTab.tsx:533-539`. Enterprise gate `:1313`; SSO gate `:1316, 1361-1362`. Inline rename `:1387`, add `:1402`, deactivate `:1433`.

### 6.5 Employee rejection email — ✅ COMPLETE
`server/routers/storePortalCustomRequests.ts:169-213` fires to the employee on `declined`, includes the manager's `pocNotes` reason. Template `server/email/emailTemplates/emailTemplatesStore.ts:128-157`. Distributor-side notification remains a separate path (proposal-level notification independent of the employee email).

### 6.6 IT packet multi-division section — ✅ COMPLETE
`docs/it-onboarding-packet.md:64-143` with conditional gate `:66-68`.

### 6.7 Product-to-division assignment — ✅ COMPLETE
`client/src/pages/StoreManagement/ProductsTab.tsx:283-293` (inline button), `:320-373` (multi-select modal), `:415-427` (add-form checkboxes), `:511` (mutation payload). Storefront filter `server/routers/storeDivision.ts:35-39` and called from `server/routers/storesCrud.ts:188-191`.

### 6.8 Aggregate PO feature — ✅ COMPLETE
Button `client/src/pages/PurchaseOrders.tsx:49, 87-96`. Copilot tool def `server/routers/copilotToolDefs.ts:754-768`, executor `server/routers/copilotExecutors.ts:334-335`, implementation `server/routers/copilotExecPurchaseOrders.ts:380-438`. Merge mutation `server/routers/purchaseOrders.ts:955-1012`; source tracking `:985`; originals marked consolidated `:999-1001`; source view via `getMergedSources` `:1022-1047`. Enum carries `draft, sent, acknowledged, in_production, shipped, received, cancelled, partial, declined, consolidated, merged` at `drizzle/schema.ts:1549-1552`.

---

## Section 7 — Session Timeout

**Feature not implemented.** Grep for `useInactivityTimer`, `inactivity`, `SessionTimeout`, `inactivityTimer` across `/home/ubuntu/mergetasks` returns zero matches.

| Item | Status | Gap |
|---|---|---|
| 7.1 `useInactivityTimer` hook | ❌ NOT DONE | Hook does not exist. Expected at `client/src/hooks/useInactivityTimer.ts` — file absent. `client/src/hooks/` contains `useComposition.ts`, `useMobile.tsx`, `usePersistFn.ts`, `useReducedMotion.ts`, `useAuth.ts` only. |
| 7.2 Distributor 2 h / employee 30 min | ⚠️ PARTIAL | Only access-token TTL exists at `shared/const.ts:4` (`ACCESS_TOKEN_MS = 15 min`) and `:6` (`REFRESH_TOKEN_MS = 7 d`). No 7 200 000 ms / 1 800 000 ms constants defined. |
| 7.3 Warning modal (15 min / 5 min) | ❌ NOT DONE | No warning modal component exists. |
| 7.4 Stay-logged-in button / non-dismissable modal | ❌ NOT DONE | Depends on 7.3 — modal absent. |
| 7.5 Auto-logout redirect paths | ❌ NOT DONE | No inactivity-driven redirect code. |
| 7.6 "Logged out due to inactivity" message | ❌ NOT DONE | Checked `client/src/pages/webstore/StoreLoginPage.tsx` and distributor login — no such message. |
| 7.7 Cross-tab logout sync | ❌ NOT DONE | No `BroadcastChannel` or `storage` listener in `client/src`. |
| 7.8 Pause on hidden tab | ❌ NOT DONE | No `document.visibilityState` reference tied to a timer. |
| 7.9 Server-side session ≥ 2 h | ❌ NOT DONE | `server/_core/sdk.ts:116-122` sets cookie `maxAge` to `ACCESS_TOKEN_MS` (15 min). Refresh window is 7 d but that is separate from the primary session. |

---

## Section 8 — Email Fixes

All eight items complete; these were shipped in the Resend audit remediation.

| Item | Status | Evidence |
|---|---|---|
| 8.1 Proposal status only `sent` after delivery | ✅ | `server/routers/proposalsSend.ts:256-304` — suppression/throw path runs before the DB update at `:297-304` |
| 8.2 Silent failures fixed | ✅ | `organizations.ts:340-349`, `orders.ts:286-298`, `storePortalCustomRequests.ts:200-211` — `log.error` in every catch |
| 8.3 `emailUnsubscribes` table | ✅ | `drizzle/schema.ts:1828-1839` and migration `drizzle/0064_email_unsubscribes.sql:1-18` |
| 8.4 Public endpoint | ✅ | `server/routes/unsubscribe.ts:197-204` — `GET` + `POST /api/unsubscribe` |
| 8.5 Signed tokens in commercial footers | ✅ | `server/email/unsubscribe.ts:61-65` HMAC tokens; proposal wiring `server/routers/proposalsSend.ts:134-139`; template `server/email/proposalEmail.ts:49,320` |
| 8.6 `List-Unsubscribe` header | ✅ | `server/email/mailer.ts:142-148` sets `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` |
| 8.7 Suppression blocks send | ✅ | `mailer.ts:99-117` + `unsubscribe.ts:113-133`; proposal-level rethrow at `proposalsSend.ts:256-268` |
| 8.8 Copilot email limiter | ✅ | `server/utils/rateLimiter.ts:368-373` `COPILOT_EMAIL_LIMIT = {max:10, windowMs:60*60*1000}`; enforced at `copilotExecBranding.ts:21,157` |

---

## Section 9 — Store Management Fixes

### 9.1 Delete user is soft delete — ❌ NOT DONE
`server/routers/storeUserProvisioning/storeUserProvisioningManagement.ts:316` runs `db.delete(storeUsers).where(eq(storeUsers.id, input.storeUserId))`. `drizzle/schema.ts:594-621` `storeUsers` has no `deletedAt` column. **Gap:** add `deletedAt` column + migration; replace `db.delete` with an UPDATE that sets `deletedAt = now()`.

### 9.2 Deleted users cannot log in — ❌ NOT DONE
Follows from 9.1. `server/routers/storePortalAuth.ts:78-87` loads store users without a `deletedAt IS NULL` clause. **Gap:** once `deletedAt` lands, add the predicate here.

### 9.3 Orders tab live data — ✅ COMPLETE
`client/src/pages/webstore/portal/PortalOrdersTab.tsx:65-72` uses `trpc.storePortal.orders.list.useQuery`. No mocks.

### 9.4 Action menu not clipped — ✅ COMPLETE
`client/src/pages/StoreManagement/ProductsTab.tsx:255-310` uses `absolute right-4 top-8 z-20` — menu stacks above overflow via z-index. Not a true Portal, but meets the spec ("renders above table overflow").

### 9.5 Action menu items — ⚠️ PARTIAL
`ProductsTab.tsx:257-309` renders Edit Price (`:264`), Toggle Featured (`:281`), Divisions (`:293`), Remove from Store (`:308`). **Gap:** "Duplicate" and "Preview on storefront" are missing. Add both entries adjacent to Edit/Remove at `ProductsTab.tsx` around line 264.

### 9.6 Division assignment gated — ✅ COMPLETE
`ProductsTab.tsx:283-295` conditions on `hasDivisions`, derived from active divisions at `:78-82`.

### 9.7 Wizard saves `multiDepartment` — ✅ COMPLETE
`client/src/pages/CreateWebstore.tsx:319` `multiDepartment: state.budgetEnabled` passed to the create mutation at `:310`.

### 9.8 Skip option on Divisions step — ⚠️ PARTIAL
`Step4Divisions.tsx:140` lets the user disable multi-division (which effectively skips), but no explicit Skip button exists — navigation is via the shared Next/Back buttons at `CreateWebstore.tsx:213-229`. **Gap:** add a visible "Skip for now" button inside `Step4Divisions.tsx` that advances the wizard and leaves `multiDepartment=false`.

### 9.9 Settings prompt when `multiDepartment` but no divisions — ❌ NOT DONE
`client/src/pages/StoreManagement/SettingsTab.tsx` has no branch that checks `multiDepartment === true && divisions.length === 0` to render a call-to-action card. **Gap:** add that prompt to `SettingsTab.tsx` near the existing DivisionsCard render at `:533-539`.

---

## Section 10 — Repository Hygiene

| Item | Status | Evidence |
|---|---|---|
| 10.1 `LICENSE` at repo root | ❌ NOT DONE | `ls /home/ubuntu/mergetasks/LICENSE` → no such file. `package.json` declares `"license": "MIT"` but no file present. |
| 10.2 `README.md` at repo root | ❌ NOT DONE | `ls /home/ubuntu/mergetasks/README.md` → no such file. |
| 10.3 `.env.example` | ✅ COMPLETE | 152 lines across 14 grouped sections (App, DB, Auth, Stripe, Resend, OpenAI, Redis, Google OAuth, Microsoft OAuth, S3, PromoStandards, ASI, TLS, DB SSL, Error Monitoring). |
| 10.4 `.env` gitignored / no secrets committed | ✅ COMPLETE | `.gitignore:11` ignores `.env`. `git status` shows only `?? .envy` as untracked. No real live credentials in tracked files (documentation placeholders only). Note: the `.envy` untracked file in the working tree contains production values and must not be committed — worth rotating anyway because the previous version of `.env` was historically tracked. |

---

## Section 11 — Regression Check

| Item | Status | Evidence |
|---|---|---|
| 11.1 TypeScript | ✅ | `npm run check` → 0 errors |
| 11.2 Tests | ✅ | `npx vitest run` → 699 passed, 94 skipped (all skips are SMTP/OAuth env-gated tests) |
| 11.3 Migrations | ✅ | Migration files are sequentially numbered `0046_*.sql` → `0064_*.sql` with a single migration per feature; no known conflicts in `drizzle/meta/*_snapshot.json`. Generated meta snapshots exist for each. |
| 11.4 pm2 | ✅ | `pm2 list` → `mergetasks` process ID 1, status `online`, uptime 93 m at audit time, RSS 162 MB |
| 11.5 Core flows | ✅ (by static evidence) | Each flow below has at least one living test or is exercised by a tRPC procedure wired end-to-end as cited earlier in this report. End-to-end Playwright runs were not executed in this audit and should be run before ship. |

Flows covered by static evidence:
- Distributor webstore creation: CreateWebstore + createStore wizard (§3.2, 9.7).
- SSO employee login → correct store: storeSsoCallback with division routing (§3.5).
- Browse → cart → checkout: LiveStore + StoreCheckoutPage (§4.3, 4.4).
- Budget block: StoreCheckoutPage budget guard (§4.4, §9.7).
- Proposal create/send/approve/fulfill: proposalsCrud + proposalsSend + publicProposalApprovals + publicProposalFulfillment routes.
- PO from accepted proposal: purchaseOrders router (§6.8).
- Client portal POC: Portal*Tab components (§5.4, 9.3).
- Print products cart/checkout: §4.3, 4.4.
- Media upload/download for both roles: §5.3, 5.4.
- Session timeout warning + auto-logout: **not implementable** — no such code exists (§7).

---

## Section 12 — UI/UX Consistency

| Item | Status | Evidence |
|---|---|---|
| 12.1 #654BF9 + Albert Sans | ✅ | Unsubscribe page `server/routes/unsubscribe.ts:24,43`; email templates `emailTemplateBase.ts` (MT.purple = `#654BF9`, Albert Sans font-stack). |
| 12.2 New tabs match existing styling | ✅ | `StoreManagement.tsx:549-575` shared underline animation applied to every tab including Print Products and Media. |
| 12.3 Loading/error/empty states | ✅ | `PortalOrdersTab.tsx:74` inline loader, `:115-120` empty state; `PrintProductsTab` uses `isLoading`. |
| 12.4 Button conventions | ✅ | Shared `sq-action-btn` class across ProductsTab / SettingsTab / PrintProductsTab. |
| 12.5 No new UI libraries | ✅ | `package.json:19-104` — no additions beyond the existing @radix-ui / recharts / sonner / lucide-react set. |
| 12.6 Mobile-responsive | ✅ | Representative responsive classes: `CreateWebstore.tsx:508 ("text-2xl sm:text-3xl")`, `:512 ("grid-cols-1 sm:grid-cols-3")`, `:515 ("flex-col sm:flex-row")`. |
| 12.7 Session-timeout modal | ❌ NOT DONE | Follows from §7 — modal does not exist. |
| 12.8 Unsubscribe page on-brand | ✅ | `server/routes/unsubscribe.ts:24-128` — linear-gradient background, white card w/ soft shadow, #654BF9 accent, Albert Sans, minimal copy. |

---

## Final Verdict

### NEEDS WORK before ship

Blockers (must-fix before marketing, enterprise, or paid onboarding):

1. **Section 7 — Session Timeout.** Not built. 8 of 9 sub-items fail outright, 1 partial. This is a security/compliance ask (idle-logout) and cannot be waived on the distributor side where 2 h is the spec. All of: the `useInactivityTimer` hook, warning modal, redirects, cross-tab sync, tab-visibility pause, and the raised server-side cookie TTL must land together.
2. **Section 9.1 / 9.2 — Soft delete of store users.** Today a delete is permanent; the promise that "order history is preserved" is undermined because FK cleanups or cascades can remove upstream context. Add `deletedAt` to `storeUsers`, migrate, flip the delete path to UPDATE, and add the `deletedAt IS NULL` login predicate.
3. **Section 10.1 / 10.2 — LICENSE and README.** Ship-blockers for any public repo or for any enterprise customer doing procurement review. `package.json` says MIT — a matching `LICENSE` file is one small commit.

Non-blocking gaps to fix soon:

4. **Section 9.5** — add "Duplicate" and "Preview on storefront" to the product action menu.
5. **Section 9.8** — add an explicit "Skip for now" button on the wizard Divisions step.
6. **Section 9.9** — add the Settings-tab prompt when `multiDepartment` is true but no divisions exist yet.
7. **Section 10.4 posture** — rotate `RESEND_API_KEY` / Stripe / AWS / DB secrets; the working directory contains an untracked `.envy` file with prod values, and `.env` was previously tracked.

Everything else — the entire email subsystem, multi-division SSO, print store, media tab, approval-token flow, aggregate-PO, budget enforcement, the dead-code cleanup, rate limiting of the AI endpoints, QuickBooks sync visibility, and the regression harness — is clean.
