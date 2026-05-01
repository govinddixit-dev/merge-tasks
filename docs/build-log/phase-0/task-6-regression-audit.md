# Phase 0 Task 6 — Regression Audit & Critical User Journeys

**Status:** Draft for Yan review
**Author:** Phase 0 Task 6
**Date:** 2026-04-22
**Scope:** Read-only audit of the current MergeTasks testing infrastructure + proposal of the 10 critical user journeys that must survive the rebuild. No code changes; no new tests.
**Paired deliverable:** `task-6-regression-protocol.md` (design of the regression gate Phases 1–8 will run against this baseline).

---

## Executive summary

- **Test frameworks installed:** Vitest (`^2.1.4`) and Playwright (`@playwright/test ^1.59.1`). No Jest, Cypress, Mocha, or Testing Library present.
- **Test file count:** **45 total** — 36 server tests under `/server/*.test.ts`, 9 Playwright specs under `/e2e/*.spec.ts`. Zero client component tests.
- **CI exists:** GitHub Actions at `.github/workflows/ci.yml` with three jobs (`typecheck`, `test`, `build`) + `notify-deploy`; MySQL 8.0 service container; 5-minute test timeout; `npm run db:push` applies migrations and `scripts/seed.ts` seeds data before tests.
- **Wall-clock estimate:** full server suite ~30–60 seconds; e2e suite not currently run in CI (see §4 below).
- **Zero coverage for the pricing calculation path** — no dedicated `pricing` / `calculatePrice` / `priceToCents` tests. The rebuild's primary deliverable is a blind spot in the current regression net.
- **Zero client component tests** — every React component, including the webstore PDP and distributor dashboard, has no automated assertion layer.
- **45 skipped/todo markers** across 7 files and **42 `@ts-ignore` / `@ts-expect-error` / `as any`** instances in server test files — these are pre-existing and are NOT introduced or multiplied by this rebuild, but they bound the regression protocol's signal quality.

The rebuild inherits a partially-covered baseline. The regression protocol (`task-6-regression-protocol.md`) is designed to strengthen the net around the 10 critical journeys without requiring a wholesale test rewrite. Phase 1 ships the minimum test-infrastructure investments needed to enforce the protocol.

---

## Section 1 — Test runners and frameworks

### 1.1 Dependencies (from `package.json`)

| Package | Version | Location | Notes |
|---|---|---|---|
| `vitest` | `^2.1.4` | devDependencies, line 137 | Primary unit/integration runner. |
| `@playwright/test` | `^1.59.1` | devDependencies, line 110 | E2E browser testing. |

**Explicitly absent** (checked): Jest, @testing-library/react, @testing-library/jest-dom, Mocha, Chai, supertest, MSW, ts-jest, happy-dom, node-mocks-http, Cypress. The repo is single-framework (Vitest) for unit/integration plus Playwright for e2e.

### 1.2 Scripts (from `package.json`)

| Script | Command | Line |
|---|---|---|
| `test` | `vitest run` | 13 |
| `e2e` | `playwright test` | 17 |
| `e2e:ui` | `playwright test --ui` | 18 |
| `e2e:report` | `playwright show-report` | 19 |

No `coverage`, `test:watch`, `test:unit`, `test:integration`, or `ci` scripts exist. `README.md:92-93` documents `npm run test` and `npm run e2e` as the canonical commands.

### 1.3 Config files

- `vitest.config.ts` — root, 22 lines.
- `playwright.config.ts` — root, 38 lines.
- No `jest.config.*`, `cypress.config.*`, `tsconfig.test.json`, or top-level `setup*.ts` file.

---

## Section 2 — Test file inventory

### 2.1 Counts

| Pattern | `/server` | `/client` | `/e2e` | `/shared` | `/drizzle` | Total |
|---|---|---|---|---|---|---|
| `**/*.test.ts` | 36 | 0 | 0 | 0 | 0 | **36** |
| `**/*.spec.ts` | 0 | 0 | 9 | 0 | 0 | **9** |
| `**/*.test.tsx` | 0 | 0 | 0 | 0 | 0 | **0** |
| `**/*.spec.tsx` | 0 | 0 | 0 | 0 | 0 | **0** |
| `**/*.test.js` | 0 | 0 | 0 | 0 | 0 | **0** |

**Grand total: 45 test files** (excluding `node_modules`).

### 2.2 Server test files (`/server/*.test.ts`)

`agentTriggers`, `aiInsights`, `aiStressTest`, `auth.logout`, `billing`, `clients-stores`, `copilot`, `copilotExecutors`, `copilotTools`, `dataIsolation`, `departmentApprovals`, `documentNumbers`, `emailNotifications`, `estimatesBuilder`, `estimatesInvoices`, `features`, `googleOAuth`, `integration`, `invoiceCanvas`, `invoiceMath`, `multiDivisionMock`, `onboarding`, `paymentStress`, `proposalEditorIntegration`, `proposalWorkflow`, `proposals`, `publicProposal`, `security`, `smtp-credentials`, `smtp`, `socialAuth`, `storeAuth`, `storePortalE2E`, `stress50`, `stressTest`, `writePaths`.

**Load-bearing observations for the rebuild:**

- Two test files already exist for the conditional-subsystem domains Task 5 promoted to in-scope: **`departmentApprovals.test.ts`** and **`multiDivisionMock.test.ts`**. Their shape drives what Phase 1 can reuse vs what must be rewritten for Decisions 37 / 38 first-class treatment.
- **No test file named `pricing*`, `calculatePrice*`, `storeCheckout*` as the subject** — pricing flows through other tests as a side effect, not as a direct assertion.

### 2.3 E2E test files (`/e2e/*.spec.ts`)

| File | Lines |
|---|---|
| `auth.spec.ts` | 99 |
| `clients.spec.ts` | 114 |
| `dashboard.spec.ts` | 100 |
| `products.spec.ts` | 136 |
| `proposals.spec.ts` | 111 |
| `reports.spec.ts` | 81 |
| `settings.spec.ts` | 103 |
| `smoke.spec.ts` | 75 |
| `webstores.spec.ts` | 118 |

Shared helper: `e2e/helpers.ts` exposes a `signIn` fixture and `TEST_USER`, plus a custom `test` export that provides an `authedPage` storage-state cache for fast-authenticated tests.

### 2.4 Test patterns observed

- Server tests import Vitest globals explicitly: `import { describe, it, expect } from "vitest"` (e.g., `server/proposals.test.ts:4`).
- Environment variables mocked via `vi.mock()` and `vi.stubEnv()` where needed (e.g., `server/billing.test.ts:5`).
- E2E tests import helpers: `import { test, expect, signIn, TEST_USER } from "./helpers"` (e.g., `e2e/auth.spec.ts:10-11`).

---

## Section 3 — Coverage by area

### 3.1 tRPC routers (sampled)

| Router | Test coverage |
|---|---|
| `server/routers/storeCheckout.ts` | **Indirect** — `paymentStress.test.ts`, but no dedicated suite asserting the tier-price path |
| `server/routers/estimatesInvoices.ts` | **Has tests** — `estimatesInvoices.test.ts`, `estimatesBuilder.test.ts`, `invoiceCanvas.test.ts` |
| `server/routers/storesCrud.ts` | **No tests found** |
| `server/routers/storesCatalog.ts` | **No tests found** |
| `server/routers/proposalsCrud.ts` | **No dedicated suite** (proposals tested through `proposals.test.ts` / `proposalWorkflow.test.ts` at a higher level) |
| `server/routers/products.ts` | **Has tests** — referenced across 22 suites |
| `server/routers/printProducts.ts` | **No tests found** |
| `server/routers/billing.ts` | **Has tests** — `billing.test.ts` |
| `server/routers/copilot.ts` | **Has tests** — `copilot.test.ts`, `copilotExecutors.test.ts`, `copilotTools.test.ts` |
| `server/routers/clients.ts` | **Has tests** — `clients-stores.test.ts` |

### 3.2 Critical domain paths

| Domain | Coverage |
|---|---|
| **Pricing calculation** (`priceToCents`, `calculatePrice`, tier matching) | **NO dedicated tests found.** Path exercised indirectly via `paymentStress.test.ts` and `estimatesInvoices.test.ts`, but no suite asserts a tier-price calculation result directly. **This is the single largest coverage gap for the rebuild.** |
| **Imprint zones / placement** | **No tests** — no grep match for `placementZone` / `imprintZone` in the test tree. |
| **Agent / copilot** | **Has tests** — `agentTriggers.test.ts`, `copilot.test.ts`, `copilotExecutors.test.ts`, `copilotTools.test.ts`. |
| **`orgScope` utility** | **Has tests** — imported by `dataIsolation.test.ts:10` and `security.test.ts:7`. Protected subsystem #2 has a regression net. |
| **Stripe integration** | **Partial** — `billing.test.ts` + `paymentStress.test.ts` cover products and payment-stress paths. `server/stripe/webhook.ts` has **no tests**. |
| **Resend / email pipeline** | **Partial** — `emailNotifications.test.ts` covers templates. No integration test against the Resend wrapper itself. |
| **Client components** | **Zero tests.** Every React component (webstore PDP, distributor dashboard, product pickers, wizards) has no component-level assertion layer. |
| **Drizzle migrations** | **No migration-integrity tests.** Migrations run in CI via `npm run db:push` but nothing asserts pre/post schema shape. |

### 3.3 Protected-subsystem coverage snapshot

Per `protected-subsystems.md`, these subsystems must remain stable through the rebuild. Current test coverage:

| Protected subsystem | Coverage today | Regression gate risk |
|---|---|---|
| Auth / SSO (Google, Microsoft OAuth) | `auth.logout.test.ts`, `googleOAuth.test.ts`, `socialAuth.test.ts`, `storeAuth.test.ts` + e2e `auth.spec.ts` | **Low** — multiple angles of coverage. |
| `orgScope` multi-tenancy | `dataIsolation.test.ts`, `security.test.ts`, `writePaths.test.ts` | **Low** — explicitly tested. |
| Stripe Connect billing | `billing.test.ts`, `paymentStress.test.ts` | **Medium** — payment-stress covers checkout; Stripe webhook is untested. |
| Stripe payment processing | `paymentStress.test.ts`, `stress50.test.ts`, `stressTest.test.ts` | **Medium** — stress-tested, not unit-asserted per webhook event type. |
| Resend email pipeline | `emailNotifications.test.ts`, `smtp.test.ts`, `smtp-credentials.test.ts` | **Medium** — templates covered; pipeline integration assumed from scaffolding. |
| tRPC / Drizzle / React / pm2 stack | Implicit in every passing suite | **Low** — CI breaks on stack breakage. |
| AI copilot (existing functionality) | `agentTriggers.test.ts`, `copilot.test.ts`, `copilotExecutors.test.ts`, `copilotTools.test.ts` | **Low** — four suites, comprehensive shape. |
| PDF generation | **No tests found** | **High** — proposals/invoices/POs render path has no regression net. |

---

## Section 4 — CI configuration

### 4.1 GitHub Actions (`.github/workflows/ci.yml`)

The only CI system present. 177 lines. Four jobs:

1. **`typecheck`** (lines 22–42) — Node 20.20.2; runs `npx tsc --noEmit`.
2. **`test`** (lines 45–125):
   - MySQL 8.0 service container (lines 50–64).
   - Env vars set inline for `DATABASE_URL`, Redis stubs, JWT secrets, etc. (lines 66–84).
   - `npm run db:push` (line 110) applies Drizzle migrations against the MySQL container.
   - `npx tsx scripts/seed.ts` (line 122) seeds test data.
   - Runs `npx vitest run --reporter=dot` (line 125).
   - Timeout: **5 minutes** (line 48).
3. **`build`** (lines 127–160) — depends on `test`; runs `npm run build`.
4. **`notify-deploy`** (lines 162–176) — fires on push to `main` after `build` passes.

### 4.2 E2E not in CI

**Playwright is NOT run by CI.** `ci.yml` runs Vitest only. The `e2e/*.spec.ts` suites must be run manually (`npm run e2e`). This is a material gap — the only automated browser-level assertion happens on a developer's machine on demand, not at PR time.

### 4.3 What CI blocks

Per `ci.yml`:
- **PR blocking:** typecheck + test both must pass for `build` to run. Build must pass for main-push to notify deploy.
- **No coverage gate** — `vitest run --reporter=dot` does not enforce a coverage threshold.
- **No e2e gate** — Playwright never runs in CI.

### 4.4 Other CI systems

- `.circleci/`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`, `azure-pipelines.yml` — **none present**. GitHub Actions is the sole CI system.

---

## Section 5 — Test data / fixtures

### 5.1 Seed scripts

- `scripts/seed.ts` — invoked in CI by the test job (`ci.yml:122`). Seeds the MySQL container with deterministic test rows.
- `scripts/seedAIInsightsData.mjs` — present; domain-specific seeder.
- **No `/fixtures`, `/test-fixtures`, `/seed`, or `/server/seed*` directories.** Seeding is script-based, not fixture-file-based.

### 5.2 Test env files

**No `.env.test` or `env.test*` files.** Tests rely on the inline env block in `ci.yml:66-84` in CI, or on the developer's local `.env` when running `pnpm test`. This is a reproducibility gap — test behavior is coupled to whichever env the developer has loaded.

### 5.3 Migration tests

**No migration-integrity tests.** Phase 1 introduces several migrations per Decisions 13–22 (imprint zones, legacy placeholder flag, `proposalPriceOverrides`, `printFinishingRates`, etc.) and per Decisions 37–38 (departments, divisions, approval chains). The regression protocol needs a migration-test pattern; flagged in §9 open questions of the protocol doc.

---

## Section 6 — Test health

### 6.1 Execution observations

Ran the Vitest suite (bounded at 30s) and captured the first ~150 lines of output. Sampling:

| Suite | Tests | Wall time |
|---|---|---|
| `server/agentTriggers.test.ts` | 35 | 777 ms |
| `server/aiStressTest.test.ts` | 55 | 135 ms |
| `server/paymentStress.test.ts` | 32 | 2362 ms |
| `server/integration.test.ts` | 54 | 1802 ms |
| `server/proposalWorkflow.test.ts` | 43 | 1910 ms |

Aggregate test count extrapolated from suite counts: **~400+ individual tests** across 36 server files.

### 6.2 Skipped / todo

**45 occurrences of `.skip`, `.todo`, `xit`, `xdescribe`** across 7 files:

- `e2e/clients.spec.ts`
- `e2e/webstores.spec.ts`
- `server/clients-stores.test.ts`
- `server/features.test.ts`
- `server/integration.test.ts`
- `server/paymentStress.test.ts`
- `server/stressTest.test.ts`

These pre-exist the rebuild. Per Principle #10, the rebuild must not introduce **new** `.skip` / `.todo` markers. Existing ones are flagged for Phase 6 cleanup evaluation (Bugs Discovered Mid-Phase, if applicable).

### 6.3 Type-safety escapes

**42 occurrences of `@ts-ignore`, `@ts-expect-error`, or `as any` in server test files.** Zero in e2e tests. Per `regression_protocol` auto-memory, new escapes are **not** permitted in code touched by the rebuild; pre-existing ones in test files are not in scope for Task 6 to clean up.

---

## Section 7 — Test execution time

- **Vitest full suite:** estimated 30–60 seconds wall-clock (sum of per-file timings observed; CI timeout budget of 5 minutes is generous by ~5×).
- **Playwright suite:** not run in CI; estimated 2–4 minutes wall-clock locally for all 9 specs based on file sizes and typical Playwright latency.
- **Full regression (if e2e in CI):** ~4–6 minutes. Well within acceptable PR-gating time; the argument for adding e2e to CI is affordability, not cost.

---

## Section 8 — Coverage gaps (zero-test modules)

Specific modules with **no test coverage found** (all flagged for the rebuild's regression scope):

| Module | Notes |
|---|---|
| `server/routers/storesCrud.ts` | Store create/update/delete — critical for Journey 1. |
| `server/routers/storesCatalog.ts` | Store-catalog listing — consumed by customer webstore. |
| `server/routers/proposalsCrud.ts` | Proposal CRUD — exercised indirectly but no direct assertion. |
| `server/routers/printProducts.ts` | Print variant model — rebuild target per Task 2 Decision 7. |
| `server/stripe/webhook.ts` | Stripe webhook dispatch — money movement, no direct tests. |
| `client/src/**` | **Zero client component tests.** |
| Pricing calculation path | No `pricing.test.*`, no `calculatePrice.test.*`, no `priceToCents.test.*`. |
| Imprint zone / placement zone | No tests for the hardcoded `PLACEMENT_ZONES` behavior the rebuild replaces. |
| Drizzle migration integrity | No pre/post-migration assertion harness. |
| `server/email/` Resend integration | Templates covered; pipeline integration not asserted. |
| PDF generation pipeline | Protected subsystem; zero regression net. |

---

## Section 9 — Critical user journeys (10 proposals)

The following ten journeys must survive the rebuild. Each is validated against the current codebase (cited), tagged with current coverage status, flagged for known bugs, and recommended a test strategy. Phase 1's infrastructure work (see `task-6-regression-protocol.md` §4) enables the recommended strategies.

### J1 — Distributor creates webstore end-to-end (10-step wizard → live URL)

- **Codebase anchor:** wizard lives across `client/src/pages/` + `server/routers/storesCrud.ts`; public webstore access routed via `server/routes/` handlers (`storeApproval.ts`, `storeSsoCallback.ts`, etc.) and mounted from `server/_core/index.ts:25-30`.
- **Current coverage:** partial — `e2e/webstores.spec.ts` (118 lines) covers some distributor-side flows; `storesCrud.ts` itself has no direct unit tests.
- **Known bugs:** none flagged in the design docs.
- **Recommended strategy:** **E2E (Playwright)** — end-to-end spans multiple client routes and server procedures; unit assertions would miss wizard integration.

### J2 — Distributor adds product to webstore

- **Codebase anchor:** product picker + `server/routers/storesCrud.ts` → `storeProducts` writes; catalog read via `storesCatalog.ts:145,310`.
- **Current coverage:** partial — `e2e/products.spec.ts` (136 lines) covers product-level flows; the store-picker integration is not specifically asserted.
- **Known bugs:** `storesCrud.ts` has no dedicated unit tests (§8 gap).
- **Recommended strategy:** **E2E + integration test pair** — E2E confirms customer-facing visibility; integration test against `storesCrud` assert-writes under orgScope.

### J3 — Distributor creates and sends proposal to customer

- **Codebase anchor:** `server/routers/proposalsCrud.ts` + `server/routes/publicProposal/` (public URL router) + `e2e/proposals.spec.ts`.
- **Current coverage:** good — `proposals.test.ts`, `proposalWorkflow.test.ts`, `publicProposal.test.ts`, `proposalEditorIntegration.test.ts` + `e2e/proposals.spec.ts` (111 lines).
- **Known bugs:** none.
- **Recommended strategy:** **Integration tests already exist; add E2E assertion** for the public-URL rendering step (the customer perspective).

### J4 — Convert accepted proposal → estimate → invoice → Stripe payment

- **Codebase anchor:** `server/routers/estimatesInvoices.ts:316-333` (estimate creation) + `server/stripe/` + `server/routes/publicInvoice.ts`.
- **Current coverage:** good on the estimate side (`estimatesInvoices.test.ts`, `estimatesBuilder.test.ts`, `invoiceCanvas.test.ts`, `invoiceMath.test.ts`); **Stripe webhook has no test** (§8 gap).
- **Known bugs:** **Estimate-from-proposal tier bug — `server/routers/estimatesInvoices.ts:316` reads `pp.unitPrice ?? prod?.basePrice` and never consults `proposalPriceTiers` (logged in `rebuild-2026-q2.md` Bugs Discovered Mid-Phase, 2026-04-20; target Phase 6 per Decision 12).**
- **Recommended strategy:** **Integration test** for the estimate-creation path after Phase 1 cutover to `calculatePrice`; **manual checklist** for the Stripe payment leg in Phase 1 (automation deferred — see open question 3 of the protocol doc).

### J5 — Distributor dashboard pricing view (margin / cost visibility)

- **Codebase anchor:** distributor dashboard under `client/src/pages/` + pricing tRPC (Phase 1 target: `pricing.calculate` tRPC procedure + `PriceBreakdown.distributorCostView`).
- **Current coverage:** **no client tests** (§8 gap); server-side pricing uncovered (§3.2 gap).
- **Known bugs:** design target — Phase 1 introduces `distributorCostView` as a first-class response field (Task 2 §2).
- **Recommended strategy:** **Component test + integration test** — component test on the dashboard panel (Phase 4 adds Testing Library), integration test asserting `distributorCostView` scrubbing for storefront sessions (Task 2 §4.4).

### J6 — Customer browses and purchases product (webstore → Stripe → confirmation email)

- **Codebase anchor:** `client/src/pages/webstore/StoreProductDetailPage.tsx` → `server/routers/storeCheckout.ts:432,993` → Stripe → Resend confirmation.
- **Current coverage:** partial — `paymentStress.test.ts` covers the Stripe leg under load; `storeCheckout.ts` tier-price path is exercised but not specifically asserted; confirmation email not e2e-asserted.
- **Known bugs:** the flat-price fallback path at `storeCheckout.ts:432` bypasses tier pricing — this is the bug Phase 1 cutover fixes (Journey J7 below).
- **Recommended strategy:** **E2E + integration test** — E2E exercises the happy path; integration test asserts the `calculatePrice` result matches what checkout writes.

### J7 — Quantity-tier pricing on PDP matches checkout price

- **Codebase anchor:** tier match at `client/src/pages/webstore/StoreProductDetailPage.tsx:78-84` vs checkout at `server/routers/storeCheckout.ts:432,993`. PDP shows tiered price; checkout uses `customPrice ?? basePrice` and **ignores tiers**.
- **Current coverage:** **no regression** — the divergence is a known bug, not covered by any test today.
- **Known bugs:** **YES — `rebuild-2026-q2.md` Bugs Discovered Mid-Phase entry (2026-04-20) — customers see tier pricing on the PDP; accepted estimates/invoices use flat unit price. Potential billing error. Phase 1 cutover to `calculatePrice` fixes this by construction; Phase 6 reviews customer-facing impact.**
- **Recommended strategy:** **Integration test** — post-Phase-1, assert that the tier price shown on the PDP equals the price written to the cart/order. **The regression protocol must assert `tier price matches checkout`, not `current behavior reproduced` — current behavior is wrong.**

### J8 — SSO-scoped webstore access (customer sees only their division's products)

- **Codebase anchor:** SSO handler at `server/routes/storeSsoCallback.ts` + `storeAuth.ts` + storefront filtering in `storesCatalog.ts`. Division scoping today uses `storeProducts.divisionIds`.
- **Current coverage:** partial — `storeAuth.test.ts`, `storePortalE2E.test.ts`, and `multiDivisionMock.test.ts` provide shape. No test specifically asserts "user in division A does NOT see product visible only to division B."
- **Known bugs:** none flagged; the division-scoping work expands significantly under Decision 38.
- **Recommended strategy:** **Integration test with explicit division-membership fixtures** — Phase 1 adds these as part of Decision 38 first-class implementation; the regression assertion falls out.

### J9 — Multi-department approval path (NEW per Decision 37)

- **Codebase anchor:** **does not fully exist today.** Partial scaffolding in `departmentApprovals.test.ts` but no production-path usage. Phase 1 creates `departments`, `departmentBudgets`, `approvalChains`, `approvalRequests`; Phase 4 adds the distributor configuration UX; Phase 5 adds the customer-side approval queue.
- **Current coverage:** `departmentApprovals.test.ts` as scaffolding — shape only.
- **Known bugs:** N/A — greenfield.
- **Recommended strategy:** **Integration tests in Phase 1 (approval chain computation + orgScope), E2E tests in Phase 5 (customer-side approval queue), design-partner validation in Phase 4 and Phase 5 per Decision 39.** Must begin passing by **end of Phase 5**; fully validated by **end of Phase 8** (agent tools `approvals.approve`/`reject` per Decision 37 implications).

### J10 — Multi-division pricing (NEW per Decision 38)

- **Codebase anchor:** **does not exist today.** `storeProducts.divisionIds` exists for visibility but no per-division pricing. Phase 1 creates either `storeProductOverrides` or `divisionId`-scoped override variants (implementation choice deferred to Phase 1 opening per Decision 38).
- **Current coverage:** `multiDivisionMock.test.ts` as scaffolding.
- **Known bugs:** N/A — greenfield.
- **Recommended strategy:** **Integration test asserting `calculatePrice` returns different `unitSellPriceCents` for division A vs division B on the same product**; **E2E test exercising a division-A customer seeing a different price than division B on the customer-facing PDP.** Must begin passing by **end of Phase 5**.

### J11 — PO/Invoice Generation (NEW per Decision 44)

- **Flow:** distributor generates a PO for an accepted proposal / order → customer receives the PO (email / PDF) → customer issues a PO reference back → invoice marks paid via PO reference, bypassing Stripe checkout on that line. Enterprise-B2B-specific (hospitals, universities, government). Design-partner and target-market dependency.
- **Codebase anchors:**
  - Entry point: `server/utils/generatePOsForOrder.ts:209` (`generatePOsForOrder()` async function).
  - PO persistence helper: `server/utils/generatePOsForOrder.ts:62` (`createPOsFromBuckets()`); supplier bucketing; PO numbering via `nextDocumentNumber()` at `:108`.
  - Callers of the entry point:
    - Explicit tRPC trigger: `server/routers/purchaseOrders.ts:128` (`generateFromOrder`).
    - Auto-invoked on store order completion: `server/routers/storeCheckout.ts:771-773` via `setImmediate()`.
    - Auto-invoked on Stripe `invoice.paid`: `server/stripe/webhook.ts` (for subscription-linked orders).
  - Full PO tRPC surface at `server/routers/purchaseOrders.ts`: `generateFromOrder` (`:122`), `confirmGeneration` (`:1266`), `getPurchaseOrders` (`:192`), `getPurchaseOrderDetail` (`:226`), `updateStatus` (`:276`), `send` (`:440`), plus `editLineItems`, `reassign`, `mergePOs`, `deleteLineItem`, `deletePurchaseOrder`, `receivePurchaseOrder`.
  - Agent interface: `server/routers/copilotExecPurchaseOrders.ts:73` (`executeGeneratePurchaseOrders`), `:31` (`executeSearchPurchaseOrders`).
  - Payment-method linkage: `drizzle/schema.ts:392` — `orders.paymentMethod` enum includes `"po_number"`, `"gl_code"`, `"company_points"`, `"credit_card"`. `drizzle/schema.ts:1209` — `invoices.invPaymentMethod: varchar(64)` shadow of the orders enum.
  - Invoice write-path: `server/routers/estimatesInvoices.ts:1324,1340` — `updateInvoice` accepts and persists `paymentMethod` but has **no conditional logic for "mark paid if `paymentMethod === "po_number"`."**
- **Current coverage:** **zero tests.** Grep of `server/*.test.ts` and `e2e/*.spec.ts` returned no references to `generatePO`, `purchaseOrder`, `createPO`, or the J11 flow. The audit doc's §8 "zero-coverage modules" table is extended with `server/routers/purchaseOrders.ts`, `server/utils/generatePOsForOrder.ts`, and `server/routers/copilotExecPurchaseOrders.ts`.
- **Known bugs / gaps flagged during audit:**
  1. **No dedicated PO email template.** `server/routers/purchaseOrders.ts:483` states: _"Email sending is coming soon. Please download the PO as PDF and email it to the supplier manually."_ `send()` (`:440-495`) currently returns a placeholder; actual delivery via `submitPOToSupplier()` (`:25`) is API-only (QuickBooks, supplier portals). No `server/email/` PO template exists.
  2. **No server-side PO PDF pipeline.** `server/routers/purchaseOrders.ts:488` — "Download — just mark as sent and return the PO data for client-side PDF generation." PDF rendering is **client-side only**. Protected-subsystem #8 (PDF generation) applies to proposals/invoices; POs do not use it.
  3. **No explicit mark-paid-via-PO procedure.** Stripe webhook at `server/stripe/webhook.ts:490-614` assumes payment came via Stripe — does not distinguish PO-paid from Stripe-paid. PO-paid invoices rely on `orders.paymentMethod` being set pre-checkout with no automated paid-status transition. Regression target: Phase 1 or Phase 4 must surface a PO-reference close-out procedure (either an `invoices.markPaidByPoReference` tRPC procedure, or a convention documented for the design-partner workflow).
  4. **Zone string consumption.** `server/utils/generatePOsForOrder.ts:245,255,281` currently reads `virtualProofs.decorationZone` (the free-text column retired per Decision 20). Phase 2 migration (Decision 20) replaces with `virtualProofs.imprintZoneId` FK join; the PO generation path must migrate readers in the same PR. **This is in-scope for Phase 2, not a J11-specific bug — flagged here because J11's regression gate intersects Phase 2's retirement work.**
- **Recommended test strategy:** **Integration test** for the PO generation path (`generatePOsForOrder` → supplier bucketing → PO number assignment → `purchaseOrders` rows written with correct `orders`/`invoices` linkage); **manual checklist** for PO email delivery (since no template exists today, the manual checklist covers "distributor downloads PO PDF and sends manually" until automated delivery ships in a later phase). Must begin passing by **end of Phase 4** — pricing engine (Phase 1) must support PO-payment-method pricing; curation UX (Phase 4) must surface the PO workflow for the design partner's review.

---

## Section 10 — Summary table

| Journey | Side | Current coverage | Known bug? | Recommended test type | Must pass by |
|---|---|---|---|---|---|
| J1 Create webstore | Distributor | Partial e2e | No | E2E | End of Phase 5 |
| J2 Add product | Distributor | Partial | No | E2E + integration | End of Phase 4 |
| J3 Create & send proposal | Distributor | Good | No | Existing integration + new E2E | Already passes; maintain |
| J4 Proposal → estimate → invoice → pay | Cross | Partial (Stripe webhook untested) | **Yes (§6.10)** | Integration + manual Stripe checklist | Post-Phase-1 integration; Phase 6 customer-impact review |
| J5 Distributor pricing view | Distributor | None (client) | No | Component + integration | End of Phase 4 |
| J6 Customer purchase flow | Customer | Partial | No | E2E + integration | End of Phase 5 |
| J7 PDP tier pricing matches checkout | Customer | None (is the bug) | **Yes (§6.10 fix target)** | Integration (assert fix, not current) | End of Phase 1 |
| J8 SSO / division-scoped catalog | Customer | Partial | No | Integration w/ fixtures | End of Phase 5 |
| J9 Multi-department approval | Both | Scaffolding only | Greenfield | Integration + E2E + design-partner | End of Phase 5 (core) / Phase 8 (agents) |
| J10 Multi-division pricing | Customer | Scaffolding only | Greenfield | Integration + E2E | End of Phase 5 |
| J11 PO/Invoice generation _(added per Decision 44)_ | Both | See §9 / J11 entry below | See J11 entry | Integration for PO generation + manual checklist for PO email | End of Phase 4 |

---

## Appendix — Summary for Yan

**Status (2026-04-22):** all 7 open questions from `task-6-regression-protocol.md` §9 resolved as Decisions 41–47. Journey J11 (PO/Invoice Generation) added per Decision 44 — total now **11 critical journeys**. Task 6 closed; Phase 0 awaits formal Yan sign-off.

**Inherited baseline:**
- 45 test files (36 Vitest server + 9 Playwright e2e); ~400+ tests; CI runs Vitest on every PR with MySQL 8.0 container; CI does NOT run Playwright today — **Decision 41 adds Playwright to CI starting Phase 1**.
- Pricing calculation, imprint zones, Stripe webhook, client components, PDF generation — all have **zero or near-zero** dedicated test coverage.
- **PO/Invoice workflow also has zero test coverage** and missing infrastructure (no PO email template; no server-side PO PDF; no explicit mark-paid-via-PO procedure) — flagged as part of J11 per Decision 44.
- Scaffolding for `departmentApprovals` and `multiDivisionMock` already exists — useful starting point for the Phase 1 first-class implementation of Decisions 37 / 38.

**Eleven critical journeys** identified and validated against the codebase with specific file:line citations. Recommendations mix E2E, integration, component, and manual checklist per Decision 43 (Stripe manual checklist acceptable in Phase 1). Three journeys (J9, J10, J11) are greenfield or materially under-built and carry "must begin passing by end of Phase N" gates rather than "match current behavior." One journey (J7) is known-broken today and the regression protocol requires the **fix** to pass, not the current behavior to reproduce.

**Resolved open questions** (full detail in `task-6-regression-protocol.md` §9; decision records in `rebuild-2026-q2.md`):

| # | Topic | Resolution | Decision |
|---|---|---|---|
| §9.1 | Playwright in CI | YES — add in Phase 1 | **41** |
| §9.2 | Test DB | Containerized MySQL per CI job | **42** |
| §9.3 | Stripe payment leg | Automated webhook logic + manual sandbox checklist | **43** |
| §9.4 | Journey list | 11 journeys (J11 added — PO/Invoice Generation) | **44** |
| §9.5 | `.env.test` | Commit with test-only values | **45** |
| §9.6 | Design-partner session log | In-repo canonical | **46** |
| §9.7 | Numeric coverage threshold | No threshold; per-journey pass is the gate | **47** |

**Next step:** Phase 0 gate review + Yan sign-off per the `phase-gate-template.md` dual convention. Phase 1 opens with the infrastructure work items enumerated in `task-6-regression-protocol.md` §4 + Phase Status-table notes in `rebuild-2026-q2.md`.
