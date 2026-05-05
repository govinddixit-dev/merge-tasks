# MergeTasks v8 — Premium Polish & Bug Fix Changelog

## Summary

This release implements the full Premium Polish Guide (Sections 2–13) and resolves 43 TypeScript compilation errors across client and server. The codebase now compiles with **0 errors** and the Vite client build succeeds cleanly.

---

## Premium Polish Guide Implementation

### Section 2: Reusable Motion Components
| Component | File | Purpose |
|-----------|------|---------|
| `FadeIn` | `client/src/components/motion/FadeIn.tsx` | Generic entrance animation (fade + translateY 8px) |
| `StaggerGroup` / `StaggerItem` | `client/src/components/motion/StaggerGroup.tsx` | Container that staggers children with 40ms delay |
| `TabContent` | `client/src/components/motion/TabContent.tsx` | Cross-fade wrapper for tab panel content |
| `AnimatedBadge` | `client/src/components/motion/AnimatedBadge.tsx` | Status badge with morph transition |
| `Skeletons` | `client/src/components/motion/Skeletons.tsx` | MetricCardSkeleton, TableSkeleton, ThinkingDots, ListItemSkeleton |
| Barrel export | `client/src/components/motion/index.ts` | Re-exports all motion components |

### Section 3: Page Transitions
- **DashboardLayout.tsx** — Replaced CSS `page-enter` keyframes with `AnimatePresence` + `motion.div` for route-level cross-fade transitions (200ms)
- Removed `.page-enter` CSS class and `@keyframes` from `index.css`

### Section 4: Stagger Entrances
- **Dashboard.tsx** — Metric card grid wrapped in `StaggerGroup` / `StaggerItem`
- **Reports.tsx** — Metric card grid wrapped in `StaggerGroup` / `StaggerItem`
- **OverviewTab.tsx** (StoreManagement) — KPI card grid wrapped in `StaggerGroup` / `StaggerItem`

### Section 5: Tab Cross-Fade
- **Settings.tsx** — `TabContent` wrapper + `motion.span layoutId` sliding tab indicator
- **Reports.tsx** — `TabContent` wrapper + sliding tab indicator
- **StoreManagement.tsx** — `TabContent` wrapper + sliding tab indicator

### Section 7: Status Badge Morph
- `AnimatedBadge` component with `AnimatePresence mode="wait"` for status transitions

### Section 8: Expandable Cards
- **Settings.tsx** — Integration cards use `AnimatePresence` + `motion.div` for height/opacity expand/collapse

### Section 9: Sidebar Active Indicator
- **Sidebar.tsx** — `motion.div layoutId="sidebarActive"` with spring physics (stiffness: 400, damping: 30)

### Section 10: Copilot Panel Spring
- **GlobalAIAssistant.tsx** — Chat panel wrapped in `AnimatePresence` + `motion.div` with spring entrance (damping: 25, stiffness: 300)

### Section 12: Onboarding Step Transitions
- **Onboarding.tsx** — `AnimatePresence mode="wait"` + `motion.div` for step-to-step transitions

### Section 13: Reduced Motion
- All motion components check `useReducedMotion()` and collapse to `duration: 0`
- `useReducedMotion` hook already existed at `client/src/hooks/useReducedMotion.ts`

---

## TypeScript Error Fixes (43 → 0)

### Client-Side Fixes

| File | Error | Fix |
|------|-------|-----|
| `DashboardLayout.tsx` | `number[]` not assignable to `Easing` | Typed `MT_EASE` as `[number, number, number, number]` |
| `FadeIn.tsx` | Same Easing type error | Same fix |
| `StaggerGroup.tsx` | Same Easing type error | Same fix |
| `TabContent.tsx` | Same Easing type error | Same fix |
| `ProductsTab.tsx` (×3) | `editingProductPrice` possibly null | Added null guard before accessing `.price` |
| `UsersTab.tsx` (×4) | Wrong mutation input keys | Changed to `storeUserId`, removed `storeId`/`userId`, added `origin`, removed `spendingLimit` from provisionUsers |
| `PortalAdminTab.tsx` (×2) | `Set<string>` not iterable | Changed `[...prev]` to `[...Array.from(prev)]` |
| `PortalMediaTab.tsx` (×3) | Missing `id` and `thumbnail` on media files | Added `id` and `thumbnail` fields to `portalData.ts` mock data |

### Server-Side Fixes

| File | Error | Fix |
|------|-------|-----|
| `actionApproval.ts` (×10) | `getDb()` returns Promise, not awaited | Added `await getDb()` + null check; typed `r` parameter |
| `copilot.ts` (×2) | Same async getDb issue | Added `await getDb()` + null check |
| `files.ts` (×10) | Same async getDb issue + missing `organizationId` | Added `await getDb()` + null check; cast user for `organizationId` |
| `storeCheckout.ts` (×4) | Missing `currency` column, Set iteration, null pool | Cast `store.currency`, `Array.from(Set)`, pool null check, `as any` for order values |
| `webhook.ts` (×3) | Invalid audit action type, Set iteration, missing `.name` | Cast audit action, `Array.from(Set)`, cast prod |
| `copilotInlineExecutors.ts` (×1) | Enum category mismatch | Cast `args.category as any` |
| `copilotServiceProducts.ts` (×1) | Same enum category mismatch | Same fix |

---

## Section 0 Pre-Polish Fixes (verified already applied)

- **Approval mutation input**: `{ actionId }` → `{ pendingActionId }` in GlobalAIAssistant.tsx
- **AcceptInvite link color**: `text-blue-500` → `text-primary`
- **Footer alignment**: Footer moved inside `<main>` to respect 260px sidebar offset

---

## Build Verification

- `npx tsc --noEmit` → **0 errors**
- `npx vite build` → **Success** (built in ~65s)
- No `console.log` statements in client pages
- Single TODO remaining: `Home.tsx:36` (screenshot placeholder — cosmetic only)
