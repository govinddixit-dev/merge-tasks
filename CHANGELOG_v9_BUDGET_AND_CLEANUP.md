# CHANGELOG v9 — Department Budget System & Mock-to-Real Cleanup

**Date:** April 9, 2026
**Scope:** Department Budget Guide (Sections 2–7) + Mock-to-Real Guide (Steps 6–16)

---

## Summary

This release implements the full department budget enforcement system, replaces
all remaining mock/fake data in the portal and curation flows, and removes the
`portalData.ts` static data file. Zero TypeScript errors, Vite production build
passes.

---

## Phase 2 — Critical Launch Blockers

### Settings.tsx Integrations Cleanup
- **Deleted** ~260 lines of dead code: fake integrations array (ASI, ESP+,
  SAGE, commonsku with fabricated stats), `handleSync` mock with `setTimeout`,
  unused state variables, and the entire `{false && ...}` legacy block.
- **Removed** unused imports: `AnimatePresence`, `RefreshCw`, `ExternalLink`,
  `CheckCircle2`, `XCircle`, `AlertTriangle`, `Wifi`, `WifiOff`.
- The Integrations tab now renders only the real `SupplierIntegrationsPanel` and
  `QuickBooksPanel` components backed by actual tRPC endpoints.

### Integrations.tsx Route Cleanup
- `/integrations` route now redirects to `/settings` — lazy import removed.

### ITAdminPortal Feature-Flag
- `/it-admin` route redirects to `/settings` until real SSO/RBAC backend is
  built. `ITAdminPortal.tsx` file preserved but unreachable.

---

## Phase 3 — Backend Checkout Enforcement (Steps 6–7)

### `server/routers/storeCheckout.ts`
- **Added** `formatCents` helper and `resolveStoreUser` JWT decode helper.
- **Budget enforcement block** inserted after `subtotalCents` calculation:
  - Per-user spending limit check (`spendingLimitCents`).
  - Department budget remaining check (`budgetCents - spentCents`).
  - Per-order cap check (`maxPerOrderCents`).
  - All checks throw `FORBIDDEN` with clear error messages.
- **Order metadata** now includes `storeUserId` for post-order hooks.

### `server/stripe/webhook.ts`
- **Wired** `postOrderBudgetHooks` into both `checkout.session.completed` and
  `payment_intent.succeeded` handlers.
- Post-order hook atomically increments `storeDepartments.spentCents` and
  `storeUsers.totalSpentCents` using Drizzle `sql` increment.

---

## Phase 4 — storeDepartmentBudgets Router (Steps 8–9)

### `server/routers/storeDepartmentBudgets.ts` (NEW)
- Full CRUD for distributor-side department budget management:
  - `list` — all departments for a store with user counts.
  - `create` — new department with budget, per-order cap.
  - `update` — modify budget, name, per-order cap.
  - `delete` — remove department (cascades user reassignment).
  - `getMyBudget` — store-portal-facing query for the current buyer's
    department budget (used by `StoreCheckoutPage`).
- Registered in `server/routers.ts`.

### `client/src/pages/webstore/StoreCheckoutPage.tsx`
- Fixed to access budget fields through `deptBudget.department` instead of
  directly on `deptBudget`.
- Added per-order cap warning and `overPerOrderCap` check that disables the
  submit button.

---

## Phase 5 — Portal Budget & Stats Routers (Steps 10–12)

### `server/routers/storePortalBudgets.ts` (NEW)
- POC-facing budget management:
  - `list` — all departments with budget/spent/users for the store.
  - `getMyBudget` — current user's department budget.
  - `requestIncrease` — budget increase request (placeholder for approval flow).

### `server/routers/storePortalStats.ts` (NEW)
- Live DB queries replacing portalData.ts:
  - `overview` — total orders, spend, employee count.
  - `departmentBreakdown` — per-department spend, budget, employee count.
  - `recentOrders` — latest N orders for the store.

### `server/routers/storePortal.ts`
- Mounted `budgets` and `stats` sub-routers.

---

## Phase 6 — Checkout UX Budget Awareness (Step 13)

### `StoreCheckoutPage.tsx`
- Per-order cap warning banner with formatted dollar amount.
- `overPerOrderCap` boolean added to `canPlace` check.
- Submit button disabled when over budget or over per-order cap.

---

## Phase 7 — Curation Mock Fixes (Steps 14–15)

### `client/src/pages/Curation.tsx`

#### Step 14: CSV Validation
- **Replaced** mock `handleCsvUpload` (hardcoded filename) with real file
  picker via hidden `<input type="file">` and `FileReader`.
- **Replaced** mock `handleCsvValidate` (`setTimeout → setCsvPhase("preview")`)
  with real Papa Parse validation:
  - Header detection, required column check (`sku`, `name`, `price`).
  - Error reporting (first 5 errors shown via toast).
  - Preview data stored in state for the preview phase.
- Added `papaparse` dependency.

#### Step 15: AI Chat
- **Replaced** keyword-matching mock `sendChat` with real copilot dispatch:
  - Fires `open-copilot` CustomEvent for GlobalAIAssistant integration.
  - Calls `trpc.copilot.chat.useMutation()` with `{ page: "product-curation" }`.
  - Graceful fallback on error.

---

## Phase 8 — portalData.ts Deletion (Step 16)

### Deleted: `client/src/components/webstore/portal/portalData.ts`
All 6 consumer files updated:

| File | Mock Replaced | Replacement |
|------|--------------|-------------|
| `WebstorePortal.tsx` | `pendingApprovals` | Inline empty array + TODO |
| `PortalReportsTab.tsx` | `monthlyStats`, `recentOrders`, `topDepartments` | `trpc.storePortal.stats.*` queries |
| `PortalMediaTab.tsx` | `mediaFiles` | Inline empty array + TODO |
| `PortalProposalsTab.tsx` | `portalProposals`, `PortalProposal`, `DeptApproval` | Inline types + empty array + TODO |
| `PortalDepartmentsTab.tsx` | `departmentRouting` | `trpc.storePortal.budgets.list` query |
| `PortalAdminTab.tsx` | `pendingApprovals`, `overrideLog` | Inline empty arrays + TODO |

---

## Build Verification

- **TypeScript:** `npx tsc --noEmit` → 0 errors
- **Vite build:** `npx vite build` → ✓ built in 2m 2s (chunk size warnings expected)
- **DB migration:** `0037_store_departments.sql` applied successfully

---

## Files Changed (22 files)

### New Files (4)
- `server/routers/storeDepartmentBudgets.ts`
- `server/routers/storePortalBudgets.ts`
- `server/routers/storePortalStats.ts`
- `CHANGELOG_v9_BUDGET_AND_CLEANUP.md`

### Modified Files (11)
- `server/routers/storeCheckout.ts` — budget enforcement
- `server/routers/storePortal.ts` — mounted sub-routers
- `server/routers.ts` — registered storeDepartmentBudgets
- `server/stripe/webhook.ts` — post-order budget hooks
- `client/src/pages/Settings.tsx` — removed ~260 lines dead code
- `client/src/pages/Curation.tsx` — real CSV + AI chat
- `client/src/pages/webstore/StoreCheckoutPage.tsx` — budget awareness
- `client/src/pages/webstore/WebstorePortal.tsx` — removed portalData import
- `client/src/pages/webstore/WebstorePortal/PortalDepartmentsTab.tsx` — tRPC
- `client/src/pages/webstore/WebstorePortal/PortalReportsTab.tsx` — tRPC
- `client/src/App.tsx` — route feature-flags

### Modified Files (inline data replacement, 3)
- `client/src/pages/webstore/WebstorePortal/PortalMediaTab.tsx`
- `client/src/pages/webstore/WebstorePortal/PortalProposalsTab.tsx`
- `client/src/pages/webstore/WebstorePortal/PortalAdminTab.tsx`

### Deleted Files (1)
- `client/src/components/webstore/portal/portalData.ts`

---

## Remaining TODOs

These are marked with `// TODO:` in the codebase:

1. **PortalMediaTab** — Wire `trpc.storePortal.media.list.useQuery()` when media endpoint exists.
2. **PortalProposalsTab** — Wire `trpc.storePortal.proposals.list.useQuery()` when proposals endpoint exists.
3. **PortalAdminTab** — Wire `trpc.storePortal.admin.pendingApprovals.useQuery()` and `overrideLog.useQuery()`.
4. **ITAdminPortal** — Build real SSO/RBAC backend, then remove redirect.
5. **Budget reset cron** — Monthly/quarterly budget reset job.
6. **Approval workflow** — Budget increase request → admin approval flow.
