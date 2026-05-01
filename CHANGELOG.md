# MergeTasks Changelog

## v11.2.0 — 2026-04-09 (Audit Tier 2 Remediation — All 16 Items Resolved)

### Security & Architecture Fixes
- **`env.ts`** — `JWT_SECRET` missing now causes a hard startup crash in all non-local-test environments to prevent auth bypass.
- **`stripeClient.ts`** — New centralized `getStripe()` singleton factory replaces module-level Stripe instantiation, enforcing `STRIPE_SECRET_KEY` validation before runtime.
- **`orgScope.ts` & `refunds.ts`** — Added `refundRequests` and `refundHistory` to scope builder; closed critical cross-tenant access vulnerability.
- **`refunds.ts`** — Fixed TOCTOU double-refund race condition by wrapping Stripe API call inside `db.transaction()` with `SELECT ... FOR UPDATE` row locking.
- **`storeCheckout.ts`** — Closed open redirect vulnerability via new `validateRedirectOrigin()` check against `APP_URL` and `ALLOWED_REDIRECT_ORIGINS`. Added `storeSlug` to `verifySession` to prevent cross-store order access.
- **`rateLimiter.ts`** — Prevented IP spoofing bypass by adding `TRUSTED_PROXY_COUNT` env var to correctly parse the `X-Forwarded-For` header.
- **`webhook.ts`** — Added `checkout.session.expired` handler to cancel abandoned orders and restore reserved inventory.
- **`publicProposalFulfillment.ts`** — Stripe API errors are now wrapped in a generic client message to prevent internal system information leakage.

### Multi-Tenancy (Copilot Fixes)
- **`copilotExec*.ts`** — Stamped `organizationId` on all INSERT operations across 7 router files (products, clients, orders, proposals, proofs, estimates, invoices) to prevent orphaned/cross-tenant records. Added missing scope entries for `estimates`, `invoices`, and `clientLogos`.

### Quality & UX Fixes
- **`Settings.tsx` & `ProposalDeptApprovalPanel.tsx`** — Replaced local `refetch()` calls with tRPC `invalidate()` to ensure global cache consistency across components.
- **`VirtualProofingViewer.tsx`** — Added full keyboard support (arrow keys to rotate, +/- to zoom, R to reset, Escape to close) and `aria-label`s to all icon-only buttons.
- **`DashboardAIChat.tsx`** — Added `aria-label`s to all icon buttons and stabilized message list keys.
- **`PortalProposalCheckout.tsx` & `PortalProposalDetail.tsx`** — Replaced unstable index-based React keys with composite SKU/department keys.
- **`organizations.ts`** — `updateSettings` now throws `BAD_REQUEST` instead of returning a silent no-op when called with an empty payload.

### E2E Testing Stabilization
- **All `*.spec.ts` files** — Replaced all unreliable `waitForLoadState('networkidle')` calls with deterministic element-based waits. Added `storageState` auth caching to the `authedPage` fixture to drastically reduce CI execution time.

### Database
- **Migration 0039** — Added `proposals.paidAt` (`TIMESTAMP NULL`) to track Stripe `payment_intent.succeeded` events for refundability window enforcement.

---

## v11.1.0 — 2026-04-09 (Audit Tier 1 Hotfixes — All 9 Items Resolved)

### Critical Fixes (from independent v11 audit)

- **Reports.tsx** — Removed broken entity filter dropdown (no `entity` column in `refundRequests` schema); filter now works correctly
- **DashboardAIChat.tsx** — All `dangerouslySetInnerHTML` calls now sanitized with DOMPurify; XSS vulnerability closed
- **proposals.spec.ts** — Removed swallowed `catch(() => {})` on API call; replaced no-op assertion with real `toBeVisible` check

### Accessibility & Quality Fixes

- **ProposalOrderSummary.tsx** — Replaced index-based React keys with stable `productId`-based keys on both product lists
- **ProposalDeptApprovalPanel.tsx** — Replaced 7 `(d: any)` casts with `DepartmentApproval` type; added `isError` state with `AlertTriangle` error UI
- **DashboardAIChat.tsx** — Added `role="dialog"`, `aria-modal="true"`, `aria-label`, Escape key handler, and `aria-label` on close button
- **ProofRevisionDialog.tsx** — Added `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, full focus trap (Tab/Shift+Tab), Escape key handler, and `aria-label` on all buttons
- **PortalProposalCheckout.tsx** — Tax rate is now **fully server-driven**. Added `taxRate DECIMAL(6,4) NULL` column to `stores` table (migration `0038_stores_tax_rate.sql`). `storePortal.dashboard` returns `taxRate: number | null`. Prop threaded through `PortalProposalsTab → PortalProposalDetail → PortalProposalCheckout`. `null` = tax-exempt (0%). No hardcoded values remain.
- **products.spec.ts / webstores.spec.ts / settings.spec.ts** — Replaced all silent `if (visible) { ... }` conditionals with hard `expect(...).toBeVisible()` assertions or explicit `test.skip()` with reason strings

---

## v11.0.0 — 2026-04-09

### Summary

v11 is a **code-quality and maintainability release**. No new features are introduced; all changes are internal improvements that make the codebase safer, faster to navigate, and ready for automated CI testing.

---

### TypeScript — Zero Errors

All TypeScript errors have been resolved across the client and server. The codebase now passes `pnpm check` with exit code 0.

Key fixes included:

- `ProposalEditor.tsx` — corrected `proposalType`, `deliveryMethod`, and `approvalRouting` state types to match the exact DB enum values; fixed `DbProduct` compatibility between the router output and `ProposalProductSearchModal`; normalized `decoration` from `string | string[]` to `string` in `buildProductsPayload` and `getPreviewProduct`.
- `CreateProposal.tsx` — removed invalid `.email` / `.phone` fallbacks (DB clients use `contactEmail` / `contactPhone`); fixed `number | undefined` return type in the price helper; aligned `getDisplayImage` and `hasApprovedProof` signatures with the step component `Product` interface.
- `Curation.tsx` — added `dbId` to static promo items so the `allPromo` union type is consistent; fixed `hasLiveInventory` boolean coercion.
- `ProposalProofingPanel.tsx` — widened `decoration` prop to `string | string[]`.
- `ProposalSendConfirmModal.tsx` — widened `deliveryMethod` and `approvalRouting` prop types to accept the full DB enum union.
- `copilotExecProposals.ts` — renamed `variantValue` → `value` (correct Drizzle column name); removed `as any` from status and variant inserts.
- `copilotExecEstimates.ts` — removed `as any` from estimate/invoice inserts and status filters.
- `copilotExecProducts.ts` — fixed `decorationMethods` insert type (`string[]` not `string | null`).
- `stripeVersion.ts` — exported `STRIPE_API_VERSION` as `string` (compatible with the installed Stripe SDK version).
- `index.ts` — fixed CSP nonce function signature to use `IncomingMessage` / `ServerResponse`.
- `imageGeneration.ts` / `voiceTranscription.ts` — cast `FormData` to `BodyInit` to resolve Node vs browser `FormData` type conflict.
- `input.tsx` / `textarea.tsx` / `dialog.tsx` — fixed `nativeEvent.isComposing` access via `unknown` intermediate cast.

---

### `as any` Cleanup

Eliminated all `as any` casts from production code (down from ~180 to **0 genuine casts**; 6 remaining grep hits are 2 false positives in legal text and 4 intentional stubs in `QuickBooksPanel.tsx` pending a future QuickBooks integration).

Files cleaned: `copilotExecProposals.ts`, `copilotExecEstimates.ts`, `copilotExecProducts.ts`, `copilotExecProofs.ts`, `copilotExecBranding.ts`, `copilotExecClients.ts`, `copilotExecOrders.ts`, `copilotExecStores.ts`, `copilotExecAnalytics.ts`, `copilotServiceProducts.ts`, `storesApproval.ts`, `storesAi.ts`, `storeApproval.ts`, `storePortalProposals.ts`, `publicProposalHelpers.ts`, `publicProposalOrderItems.ts`, `publicProposalFulfillment.ts`, `proposalsSend.ts`, `proofing.ts`, `refunds.ts`, `notification.ts`, `files.ts`, `sdk.ts`, `rateLimitMiddleware.ts`, `copilot.ts`, `Reports.tsx`, `StorePreviewPage.tsx`, `StoreEditorPage.tsx`, `SignIn.tsx`, `InvoiceDetail.tsx`, `Clients.tsx`, `Proposals.tsx`, `PlatformAdmin.tsx`, `CreateWebstore.tsx`, `StaggerGroup.tsx`, `RefundDialog.tsx`, `GlobalAIAssistant.tsx`, `PortalTeamTab.tsx`, `PortalPrintTab.tsx`, `StoreProductDetailPage.tsx`, `ClientPortal.tsx`.

---

### Brand Color Fix — ExternalProductSearchModal

All `blue-*` Tailwind classes in `ExternalProductSearchModal.tsx` replaced with `primary` / brand tokens (7 changes):

| Element | Before | After |
|---|---|---|
| Search button | `bg-blue-600` | `bg-primary` |
| Import button | `bg-blue-600` | `bg-primary` |
| Card hover border | `hover:border-blue-500` | `hover:border-primary` |
| Focus ring | `ring-blue-500` | `ring-primary` |
| Expand toggle | `text-blue-600` | `text-primary` |
| Size chips | `bg-blue-50 text-blue-600` | `bg-primary/10 text-primary` |
| Settings link | `text-blue-600` | `text-primary` |

---

### File Splits

Large page files have been decomposed into focused sub-components:

| File | Before | After | Extracted to |
|---|---|---|---|
| `PortalProposalsTab.tsx` | 1,407 lines | 381 lines | `PortalProposalCheckout.tsx`, `PortalProposalDetail.tsx` |
| `Dashboard.tsx` | 812 lines | 204 lines | `DashboardAIChat.tsx` |
| `Curation.tsx` | 989 lines | 620 lines | `CurationChatPanel.tsx`, `CurationMockupModal.tsx`, `CurationProductsTab.tsx`, `CurationPrintTab.tsx`, `CurationCollectionsTab.tsx` (wired in) |
| `ProposalDetail.tsx` | 854 lines | 638 lines | `ProposalDeptApprovalPanel.tsx`, `ProposalOrderSummary.tsx` |
| `VirtualProofing.tsx` | 1,137 lines | 1,065 lines | `VirtualProofingViewer.tsx`, `ProofRevisionDialog.tsx` |

---

### Playwright E2E Tests

A full Playwright test suite has been added under `e2e/`:

| File | Coverage |
|---|---|
| `smoke.spec.ts` | All 9 main routes load without JS errors or blank screens |
| `auth.spec.ts` | Sign-in, invalid credentials, protected route redirect, sign-out |
| `proposals.spec.ts` | Proposals list, search, status filters, create wizard, detail view |
| `clients.spec.ts` | Clients list, search, add client modal, form validation, detail view |
| `products.spec.ts` | Product curation tabs, search, import modal, external search, collections, print upload |
| `webstores.spec.ts` | Webstores list, create wizard, store editor |
| `reports.spec.ts` | Reports page, entity selector, date range, export button, stat cards |
| `settings.spec.ts` | Settings tabs, profile fields, AI approval selector, SMTP section, save button |

**Run with:** `pnpm e2e`
**Interactive UI:** `pnpm e2e:ui`
**View last report:** `pnpm e2e:report`

Configuration: `playwright.config.ts` — Chromium only, auto-starts dev server on port 5000, retries 2× in CI.

---

### Proof Image Priority Fix — Public Proposal Gallery

File: `client/src/pages/public-proposal/ProductDetail.tsx`

When a distributor approves a virtual proof for a product, the branded mockup now appears **first** in the client-facing proposal gallery instead of being buried at the end. The catalog photo still appears second for reference.

**Before:** proof image was appended last — clients had to swipe past all catalog photos to find their branded mockup.

**After:** if `sp.proofStatus === "approved"`, the proof image is pushed first into the `productImages` array. Draft and in-progress proofs (`ready`, `rendering`, etc.) remain hidden until approved.

No backend changes, no new dependencies, no database migration required.

---

### New Files

```
client/src/components/curation/CurationChatPanel.tsx
client/src/components/curation/CurationMockupModal.tsx
client/src/components/curation/CurationProductsTab.tsx
client/src/components/curation/CurationPrintTab.tsx
client/src/components/curation/CurationCollectionsTab.tsx
client/src/components/dashboard/DashboardAIChat.tsx
client/src/components/proposal/ProposalDeptApprovalPanel.tsx
client/src/components/proposal/ProposalOrderSummary.tsx
client/src/components/proofing/VirtualProofingViewer.tsx
client/src/components/proofing/ProofRevisionDialog.tsx
client/src/pages/webstore/WebstorePortal/PortalProposalCheckout.tsx
client/src/pages/webstore/WebstorePortal/PortalProposalDetail.tsx
e2e/helpers.ts
e2e/smoke.spec.ts
e2e/auth.spec.ts
e2e/proposals.spec.ts
e2e/clients.spec.ts
e2e/products.spec.ts
e2e/webstores.spec.ts
e2e/reports.spec.ts
e2e/settings.spec.ts
playwright.config.ts
```
