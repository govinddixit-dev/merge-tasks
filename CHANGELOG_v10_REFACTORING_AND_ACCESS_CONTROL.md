# MergeTasks v10 — Refactoring & Store Access Control

**Build:** ✓ TypeScript 0 errors · Vite build ✓ built in 21.96s  
**Date:** April 2026  
**Guides implemented:** MergeTasks Refactoring Guide (Steps 1–10) + Store Access Control Guide (Steps 1–5)

---

## Summary

This release eliminates **97 `as any` casts** (33% reduction from 292 → 195), splits 3 large server files into domain modules, unifies the `formatCurrency` utility, adds S3-ready storage, and implements the Store Access Control UI toggle.

---

## Part 1 — TypeScript `as any` Cleanup

### HIGH PRIORITY — 64 casts eliminated from 3 worst files

| File | Before | After | Method |
|---|---|---|---|
| `server/routers/storesCrud.ts` | 29 | 0 | Typed `StoreWithProducts`, removed redundant casts |
| `client/src/pages/Webstores.tsx` | 20 | 0 | Added `RouterOutput` + `StoreListItem` type, optional chaining |
| `server/stripe/webhook.ts` | 15 | 0 | `MysqlUpdateResult` helper, proper Stripe types, `extractCustomerId()` |

### MEDIUM PRIORITY — 33 casts eliminated from 10 server files

- `server/utils/samlProvider.ts` — Added `SamlProfile` interface
- `server/jobs/dataRetentionCleanup.ts` — Added `MysqlDeleteResult` helper
- `server/routers/storeCheckout.ts` — Typed `resolvedItems`, `storeRow`, `orderValues`
- `server/routers/billing.ts` — Typed Stripe subscription properties
- `server/utils/refundService.ts` — Typed Stripe refund result
- `server/routers/storeDepartmentBudgets.ts` — Used `InsertStoreDepartment` type
- `client/src/lib/trpc.ts` — Exported `RouterOutput` type alias

### Remaining `as any` (195 total)
- Test mocks: ~28 (intentional — test fixtures don't need strict types)
- Client pages not in scope: ~80 (flagged with TODO comments for v11)
- Server files with complex Drizzle generics: ~87 (require schema changes to fix)

---

## Part 2 — File Splits

### `copilotInlineExecutors.ts` → `copilotExec/` (820 lines → 4 modules)

```
server/routers/copilotExec/
  scope.ts           — buildToolScope() helper
  clientsProducts.ts — search_clients, search_products executors
  proposals.ts       — create_proposal, send_proposal executors
  webstore.ts        — create_webstore, assign_store_products, optimize_store executors
  index.ts           — barrel re-export + executeTool() dispatcher
```

`copilotInlineExecutors.ts` now re-exports from the barrel for backward compatibility.

### `clients.ts` → `clientsCrud.ts` + `clientsAssets.ts` (634 lines → 2 modules)

```
server/routers/clientsCrud.ts    — list, getById, stats, create, update, delete (6 procedures)
server/routers/clientsAssets.ts  — listAssets, uploadAsset, deleteAsset (3 procedures)
server/routers/clients.ts        — barrel that merges both routers (unchanged API)
```

### `copilotToolDefs.ts` — Table of contents added (722 lines, pure data)

Added domain section headers and a TOC comment. Splitting into 5 files would add overhead with no logic benefit.

### `aiInsights.ts` — Section headers added (661 lines, 4 procedures)

Added procedure TOC comment. 4 procedures don't warrant a file split.

---

## Part 3 — Utility Deduplication

### `server/utils/formatCurrency.ts` — New canonical utility

```typescript
// Handles: number | string | null | undefined
// Returns: "$1,234.56" or "—" for null/undefined
export function formatCurrency(value: number | string | null | undefined): string
```

- `server/email/proposalEmail.ts` — now imports from shared utility
- `server/email/emailTemplates/emailTemplateBase.ts` — now re-exports from shared utility (3 consumers automatically updated)
- `client/src/lib/utils.ts` — unchanged (client-side, different contract)
- `client/src/pages/PlatformAdmin.tsx` — unchanged (cents-based, different contract)

---

## Part 4 — Storage Layer (S3 Support)

### `server/storage.ts` — Rewritten with S3 fallback

```typescript
// When AWS_S3_BUCKET is set: routes to S3 (multi-server safe)
// When not set: falls back to local disk (single VPS mode)
export async function storagePut(key: string, buffer: Buffer, mimeType: string): Promise<string>
export async function storageGet(key: string): Promise<Buffer>
export async function storageDelete(key: string): Promise<void>
```

**To enable S3:** add `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` to `.env`.

---

## Part 5 — Store Access Control

### Files changed

| File | Change |
|---|---|
| `server/routers/storesCrud.ts` | Added `requireAuth: z.boolean().optional()` to `update` input |
| `client/src/pages/webstore/LiveStore.tsx` | Added clarifying comment explaining `requireAuth` access modes |
| `client/src/pages/StoreManagement/SettingsTab.tsx` | New Store Access radio card UI |
| `client/src/pages/StoreManagement/StoreManagementTypes.ts` | Added `requireAuth?: boolean` to `StoreData` interface |

### Store Access modes

| Mode | `requireAuth` | Behaviour |
|---|---|---|
| **Private** (default) | `true` | Login required to view the store |
| **Open Browsing** | `false` | Browse freely; login required to order |
| **Public** | `false` | Browse and order without login _(Coming Soon)_ |

### UX details
- Optimistic update: selection changes immediately, reverts on error
- "Coming Soon" badge on Public option (disabled)
- "Most Common" badge on Open Browsing
- Works on both real stores (numeric ID) and demo stores (disabled, no mutation)

---

## Remaining Known Issues (unchanged from v9)

| Issue | Status |
|---|---|
| Cart doesn't persist on page refresh | React state only — localStorage not implemented |
| File storage is local disk | Fixed in this release with S3 fallback (requires env vars) |
| 15+ client pages over 500 lines | Server side split; client side flagged for v11 |
| 195 remaining `as any` casts | Down from 292; test mocks and complex Drizzle generics remain |
| No Playwright/Cypress E2E tests | Integration + security tests exist; E2E not yet implemented |

---

## Files Changed

### New files
- `server/routers/copilotExec/scope.ts`
- `server/routers/copilotExec/clientsProducts.ts`
- `server/routers/copilotExec/proposals.ts`
- `server/routers/copilotExec/webstore.ts`
- `server/routers/copilotExec/index.ts`
- `server/routers/clientsCrud.ts`
- `server/routers/clientsAssets.ts`
- `server/utils/formatCurrency.ts`

### Modified files
- `server/routers/storesCrud.ts`
- `server/routers/storeCheckout.ts`
- `server/routers/billing.ts`
- `server/routers/storeDepartmentBudgets.ts`
- `server/routers/clients.ts` (now barrel)
- `server/routers/copilotInlineExecutors.ts` (now barrel)
- `server/routers/copilot.ts`
- `server/routers/actionApproval.ts`
- `server/routers/aiInsights.ts`
- `server/routers/copilotToolDefs.ts`
- `server/stripe/webhook.ts`
- `server/utils/samlProvider.ts`
- `server/utils/refundService.ts`
- `server/utils/storage.ts`
- `server/jobs/dataRetentionCleanup.ts`
- `server/email/proposalEmail.ts`
- `server/email/emailTemplates/emailTemplateBase.ts`
- `client/src/lib/trpc.ts`
- `client/src/pages/Webstores.tsx`
- `client/src/pages/webstore/LiveStore.tsx`
- `client/src/pages/StoreManagement/SettingsTab.tsx`
- `client/src/pages/StoreManagement/StoreManagementTypes.ts`
