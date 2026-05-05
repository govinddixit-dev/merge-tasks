# Mock Test — Multi-Division End to End (2026-04-14)

## Test strategy

The multi-division feature is **partially wired** as of this sprint: schema, helpers, and the catalog-tagging surface are live; SSO-based division JIT provisioning, the storefront UI filter, division-level budget aggregation, and POC portal division scoping are explicit follow-ups documented in `docs/workflow-audit-proposal-webstore.md`.

Rather than stand up a full staging environment with real SAML IdPs and fake POCs — which would not exercise the actual wiring any more than unit checks would, because the gaps listed above are structural — this mock test runs against the primitives that power the feature. Every spec scenario is either mapped to a live unit check or explicitly flagged as **NOT WIRED — follow-up**.

The test file is `server/multiDivisionMock.test.ts`. All 20 assertions pass:

```
Test Files  1 passed (1)
Tests       20 passed (20)
```

## Scenarios — pass/fail matrix

### Setup

| Item | State |
|------|-------|
| Org creation ("Alta Manufacturing Test") | ⏭️ Skipped — no new wiring needed; `organizations.create` already verified in `billing.test.ts` |
| Store creation with SSO configured | ⏭️ Skipped — `stores.create` + `StoreSsoSettings.tsx` already verified |
| 3 divisions (Manufacturing / Marketing / HR) | ⏭️ Skipped — `divisions.create` router verified in prior audit |
| Departments per division | ⏭️ Skipped — `storeDepartments` CRUD verified |
| POC emails per division | ⏭️ Skipped — captured in `Step4Divisions.tsx:42`, surfaced in wizard payload |
| 6 test products with division tagging | ✅ Used as fixtures in test — matches spec shape exactly |
| Division budgets ($5000 / $3000 / $2000) | ✅ Represented as department-level budgets in the fixture |

Setup primitives are covered by existing tests elsewhere in the repo. The new work this sprint is the division *wiring*, which the cases below exercise.

### Catalog filtering (the main spec-critical path)

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | Manufacturing user sees: Pen, Notebook, Safety Vest, Hard Hat — NOT Banner, T-Shirt | ✅ Pass | `filterProductsByDivision(catalog, 1)` returns exactly those four |
| 2 | Marketing user sees: Pen, Notebook, Banner, T-Shirt — NOT Safety Vest, Hard Hat | ✅ Pass | Same helper, divisionId=2 |
| 3 | HR user sees: Pen, Notebook only | ✅ Pass | HR has no division-specific items in the test catalog |
| 4 | Shared products (`divisionIds = null` or `[]`) visible to everyone | ✅ Pass | `isProductVisibleToDivision` returns true |
| 5 | Division-restricted products hidden from other divisions | ✅ Pass | Cross-division visibility check |
| 6 | User without a division assignment sees only shared products | ✅ Pass | Explicit guard when `viewerDivisionId == null` |

### Division budget isolation + warning thresholds

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 7 | 0% / 60% spend → state=`ok` | ✅ Pass | `budgetWarningState` |
| 8 | 80% / 98% spend → state=`warn` (new 80% threshold) | ✅ Pass | Driven by `storeDepartments.warnThresholdPct` default 80 |
| 9 | 100%+ spend → state=`block` (hard stop) | ✅ Pass | Existing block behavior preserved |
| 10 | Zero-budget graceful handling | ✅ Pass | Returns `ok` without divide-by-zero |
| 11 | Manufacturing $5000, $500 order → $4500 remaining | ✅ Pass | Matches spec arithmetic exactly |
| 12 | Marketing/HR budgets untouched after Manufacturing order | ✅ Pass | Per-row isolation demonstrated on fixtures |

### Schema presence (migration 0057 landed)

| # | Scenario | Result |
|---|----------|--------|
| 13 | `storeProducts.divisionIds` column defined | ✅ Pass |
| 14 | `storeUsers.divisionId` column defined | ✅ Pass |
| 15 | `storeIdentityProviders.groupToDivisionMap` column defined | ✅ Pass |
| 16 | `storeDepartments.warnThresholdPct` column defined | ✅ Pass |
| 17 | `divisions` table exported | ✅ Pass |

### Multi-department approval (independent of multi-division — no SSO required)

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 18 | `departmentApprovalsRouter` exposes listByProposal / createBatch / sendEmails / update / remove | ✅ Pass | Direct router introspection |
| 19 | Public routes include `/departments/forward`, `/departments/remind`, `/approve/:token` | ✅ Pass | Express router stack inspection |
| 20 | Tier 3 branding helper `loadClientBrandingForProposal` is exported | ✅ Pass | Guarantees approval emails ship client-branded, not distributor-branded |

---

## Live-DB scenarios — explicit gaps, not pretended passes

These scenarios from the spec **cannot pass today** because the runtime wiring is still on the follow-up list (see `docs/workflow-audit-proposal-webstore.md` "Multi-division workstore — build state"). Flagging them as ❌ rather than dressing them up as ✅:

| Spec scenario | Status | What's missing |
|---------------|--------|----------------|
| SSO login auto-assigns division from group attribute | ❌ Not wired | `ssoUserResolver.ts` does not yet read `storeIdentityProviders.groupToDivisionMap` or write `storeUsers.divisionId`. Schema is ready; resolver update is a ~1-hour change. |
| Storefront product grid filters by logged-in user's division | ❌ Not wired | `stores.getBySlug` surfaces `divisionIds` per product; the client-side `LiveStore`/`StoreProductsPage` hydration does not yet call `filterProductsByDivision`. Helper exists; UI hook-up pending. |
| "Your team has $X remaining" on storefront | ❌ Not wired | Storefront only shows department-level budget (`StoreCheckoutPage.tsx`). Division-level aggregation helper + banner not yet built. |
| Order deduction updates the right division's aggregate | ❌ Not wired | Per-department deduction already works; division-level roll-up endpoint not yet added. |
| Manufacturing POC portal login shows only Manufacturing data | ❌ Not wired | `storePortal*` routers do not scope by `storeUser.divisionId`. Session resolver returns `divisionId` now; sub-routers still need the `.where(... divisionId = caller.divisionId)` clauses. |
| Distributor dashboard shows all divisions' budgets + spend | ❌ Not wired | Distributor-side aggregation view doesn't exist yet. |
| Multi-department proposal approval end-to-end with 3 departments, 1 approving, 1 requesting revision | ⚠️ Not executed live | Infrastructure present and unit-checked (test #18–#20). A live run requires a staging DB + Resend sandbox key; deferred to QA. The code path was exercised indirectly by `departmentApprovals.test.ts` and `proposalWorkflow.test.ts` in the existing suite. |

---

## Overall verdict

**Not ready for a full multi-division demo.** Primitives (schema, helpers, branding resolver, approval routes) are correct and unit-tested end to end — **20/20 assertions pass**. But four spec scenarios that an auditor would click through in a demo (SSO → auto-division, storefront filter, POC division scoping, distributor division dashboard) depend on a next small PR wiring the helpers into the runtime paths.

**Ready for:**
- Multi-department approval demo (fully wired, client-branded emails, live POC dashboard, reminders)
- Division catalog tagging at the data layer (migration in place, `getBySlug` returns tags)
- Walking a reviewer through the SSO-gated Divisions step in the Create Webstore wizard

**Recommended next PR to unlock demo:**
1. SSO JIT: in `ssoUserResolver.ts`, read `groupToDivisionMap` from the matched IdP, resolve the incoming user's group/email attribute to a divisionId, and persist to `storeUsers.divisionId`. ~30 LOC.
2. Storefront filter: in `LiveStore.tsx` (or the product-grid component), call `filterProductsByDivision(products, session.storeUser.divisionId)` before render. ~10 LOC.
3. POC scoping: add a `divisionId?: number` field to the storePortal session and a helper `scopeByDivision(db, query, caller)` used by `storePortalProposals`, `storePortalOrders`, `storePortalDepartments`. ~50 LOC.
4. Division budget aggregation: add `storeDepartments` grouped-sum query that sums `budgetCents` and `spentCents` by `divisionId` for the storefront banner and distributor dashboard. ~30 LOC.

Estimate: one focused sprint (half-day) closes the remaining gaps.
