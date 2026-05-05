# Phase 0 Task 6 — Regression Protocol Design

**Status:** Draft for Yan review
**Author:** Phase 0 Task 6
**Date:** 2026-04-22
**Scope:** Design only — specifies the regression protocol Phases 1–8 execute at every phase boundary. No code changes; infrastructure investments below are implemented by Phase 1.
**Paired audit:** `task-6-regression-audit.md` (inventory of current tests + the 10 critical user journeys this protocol gates).
**Implemented by:** Phase 1 (infrastructure + baseline capture), then enforced at every subsequent phase gate.

---

## Section 1 — Overview & principles

### 1.1 What this protocol governs

Every phase gate requires a regression run per `architectural-principles.md` #10 ("Regression protocol run at every phase boundary") and `phase-gate-template.md` ("Regression protocol executed: baseline tests, typecheck, build, audit of touched files"). Task 6 defines **what that run actually does** — which checks execute, against which journeys, with what pass/fail semantics, and what report lands in the build log.

### 1.2 Principles

- **One baseline, eight gates.** Baseline captured once at Phase 0 close; every phase gate (1 through 8) runs the same regression net against the same baseline. A journey that regresses mid-phase is a gate blocker.
- **Fix-not-match for known-broken journeys.** Journey J7 (PDP-checkout tier divergence) is broken today. The regression requires the **Phase 1 fix** to pass, not the current behavior to reproduce. The audit doc identifies this explicitly per journey; new such cases go to the audit doc, not silently into the protocol.
- **Greenfield journeys (J9, J10) use "must begin passing by Phase N"**, not "must match current behavior." The gate for each greenfield journey specifies the phase at which it first enters the pass-required set.
- **Automation when affordable; manual checklist when not.** Stripe payment confirmation and email-delivery confirmation are expensive to automate reliably; these can stay manual with a documented checklist for Phase 1, deferred to automation only if a later phase makes it cheap (see §9 Open Question 3).
- **No new `@ts-ignore` / `as any` / `.skip`.** Per `regression_protocol` auto-memory — this rebuild does not introduce escapes. Pre-existing escapes in untouched files are out of scope.

---

## Section 2 — Baseline capture (executed once, at Phase 0 close)

Baseline is what "current behavior" means for every journey that asserts "no regression." Phase 0 close produces a baseline artifact per journey.

### 2.1 Per-journey capture strategy

| Journey | Strategy | Artifact |
|---|---|---|
| J1 Create webstore | Automated Playwright spec | `e2e/regression-baseline-j1-createWebstore.spec.ts` (Phase 1 writes; captures pass under current behavior before any rebuild change). |
| J2 Add product | Automated Playwright + integration | `e2e/regression-baseline-j2-addProduct.spec.ts` + `server/storesCrud.test.ts` (new). |
| J3 Create/send proposal | Extend existing tests | `e2e/proposals.spec.ts` extended; no new baseline file needed — existing suite already asserts the shape. |
| J4 Proposal → estimate → invoice → pay | Integration test + manual Stripe checklist | Integration in `server/estimatesInvoices.test.ts` (exists; extend to assert tier-price path post-Phase-1). Stripe payment confirmation: manual checklist at `docs/build-log/regression-manual-checklist.md` (Phase 1 creates). |
| J5 Distributor pricing view | Component test + integration | Phase 1 adds `@testing-library/react` dep; new `client/src/.../distributorPricingView.test.tsx`; integration asserts `distributorCostView` scrubbing. |
| J6 Customer purchase | Automated Playwright + integration | `e2e/webstores.spec.ts` extended; `server/storeCheckout.test.ts` (new). Email confirmation: manual checklist. |
| J7 PDP tier matches checkout | Integration test asserting the **fix** | `server/pricing.test.ts` (new in Phase 1; asserts PDP-computed price equals checkout-written price for matching quantity). Baseline is "this will pass after Phase 1 cutover," not "captured current behavior." |
| J8 SSO/division scope | Integration test with fixtures | `server/storeSso.test.ts` (new); division-membership fixtures in `scripts/seed.ts`. |
| J9 Multi-department approval | Phase 1 scaffolds; Phase 5 asserts | No Phase 0 baseline — greenfield. Phase 1 adds `server/approvalChains.test.ts` shape; Phase 5 extends to E2E. |
| J10 Multi-division pricing | Phase 1 scaffolds; Phase 5 asserts | No Phase 0 baseline — greenfield. Phase 1 adds integration assertion of `calculatePrice({ divisionId })` returning different unit prices; Phase 5 adds E2E. |

### 2.2 Capture process

1. **Phase 1 kickoff task (runs before any rebuild code change):** write the baseline specs above for J1, J2, J3, J4 (integration portion only), J5, J6, J8. Run them against the `main` branch at commit **`<Phase 0 close commit>`** (filled in at Phase 0 sign-off). Confirm they pass. This is the "green baseline" per Principle #10.
2. **Journey J7** does **not** get a "match current behavior" baseline — the current behavior is the bug. The baseline spec asserts the **fix** and is written Phase 1 to pass only after the Phase 1 cutover.
3. **Journeys J9, J10** do not get Phase 0 baselines — they enter the pass-required set at Phase 5 per §3.
4. **Manual checklist baseline:** at Phase 0 close, Yan walks through `docs/build-log/regression-manual-checklist.md` (Phase 1 creates) for the Stripe payment + email confirmation legs of J4 and J6 and marks the "pre-rebuild expected outcomes" column. These become the "before" state the regression compares against at each phase gate.

### 2.3 Baseline artifact location

- **Automated baselines:** in-repo under `/server/*.test.ts` and `/e2e/*.spec.ts`. Versioned with the code; each baseline file's leading comment cites the journey (J1–J10) and the Phase 0 close commit SHA.
- **Manual checklist baseline:** `docs/build-log/regression-manual-checklist.md` (created Phase 1); one section per manual-gated flow; each row has "pre-rebuild expected" / "Phase N observed" columns.
- **Baseline capture log:** `docs/build-log/phase-0/regression-baseline-capture.md` (created Phase 1 as a one-time artifact) — records the date, commit SHA, and pass/fail result of the initial baseline run.

---

## Section 3 — Per-phase gate criteria

Every phase's gate criteria already include "regression protocol run" per `phase-gate-template.md`. This section defines what the run does **for that specific phase**.

### 3.1 Universal gate items (run at every phase boundary)

These fire at **every** phase gate, Phases 1–8:

1. **`npm run test` (Vitest suite) — 100% pass.** No `.only`, no new `.skip`, no new `@ts-ignore` / `as any`.
2. **`npm run e2e` (Playwright suite) — 100% pass.** Phase 1 adds Playwright to CI (see §4).
3. **`npx tsc --noEmit` — clean typecheck.**
4. **`npm run build` — clean build.**
5. **Touched-file audit.** Every file modified during the phase listed in the gate report with a one-line note on regression check status (unit test exists, e2e test exists, manual-only, or waived with justification).
6. **Manual checklist.** Yan walks the relevant `regression-manual-checklist.md` rows for any journey whose gate-passing evidence is partially manual.

### 3.2 Per-phase journey gates

Which journeys are **pass-required** at which phase's gate:

| Phase | Pass-required journeys | Notes |
|---|---|---|
| **Phase 1** (Unified Pricing Engine) | J3, J4 (integration portion), **J7 (first time passing; fix required)**, J5 (integration — distributorCostView), J10 (integration — `calculatePrice({ divisionId })` returns differentiated prices) | Phase 1 is the pricing cutover — the pricing-dependent journeys become gate-blocking here. J7 flips from "was broken" to "passes." J10 enters pass-required at the `calculatePrice` level. |
| **Phase 2** (Imprint Zones) | All Phase 1 journeys + new integration tests for `productImprintZones` CRUD and fallback chain (Task 3 §3) | No new customer-visible journey; Phase 2 adds infra for later phases. |
| **Phase 3** (Supplier Sync) | All prior + sync-integrity tests (no regressions on product catalog reads) | Supplier sync is write-heavy; regression guards against catalog corruption. |
| **Phase 4** (Distributor Curation UX) | All prior + J2 (add product), J5 (dashboard pricing view — component tests now), **J9 (integration portion — approval chain computation)**, **J11 (PO/Invoice Generation — integration test for PO generation; manual checklist for PO email delivery)** | Curation UX is where distributor-facing flows mature and where the PO workflow becomes pass-required per Decision 44. **Design-partner review gate fires here per Decision 39** — see §7. |
| **Phase 5** (Customer Webstore) | All prior + J1 (create webstore e2e), J6 (customer purchase e2e), J8 (SSO/division e2e), **J9 (E2E — customer approval queue)**, **J10 (E2E — customer sees differentiated price)**, **J11 (maintain: customer-side PO-reference close-out flow pass-required)** | Phase 5 is where the greenfield features (J9, J10) become fully pass-required end-to-end; J11 extends from distributor-side (Phase 4) to customer-side (PO reference submission closes out the order). **Design-partner review gate fires here per Decision 39.** |
| **Phase 6** (Side-Quest Bug Fixes) | All prior (J1–J11) + regression for each fix in scope | Phase 6 may ALSO surface customer-communication / invoice-correction for the J7 historical bug (Decision 12). |
| **Phase 7** (Cleanup / Launch Readiness) | All prior — full **11-journey** suite green | Expanded regression coverage per Decision 40 adds ~1 week; includes department + division multi-user concurrency tests + PO-workflow multi-distributor concurrency (J11). |
| **Phase 8** (AI Features) | All prior (J1–J11) + new tool-registry / agent tests | Agent-tool regression harness (per Task 4 §6.3 adapter parity + tool-registry linter + risk-tier drift detector) runs at Phase 8 gate. Phase 8 agents include the `purchaseOrders` tool surface exposed via `copilotExecPurchaseOrders.ts` — which must migrate onto the Task 4 registry per Decision 3 copilot-upgrade scope. **Design-partner review gate fires here per Decision 39.** |

### 3.3 Failure handling

If any pass-required journey fails at a phase gate:

1. **Gate does not close.** Per Principle #9 (partial gates are not gates).
2. **Root cause the failure** before any further work on the next phase. No "we'll fix in Phase N+1."
3. **If the failure reveals an out-of-scope bug**, log it in `rebuild-2026-q2.md` "Bugs Discovered Mid-Phase" per the existing convention and assess phase scope impact.
4. **If the failure is in a protected subsystem**, escalate to Yan immediately — this is a "paused and escalate" event per `protected-subsystems.md`.
5. **Never skip a journey to close a gate.** Only explicit Yan sign-off on a documented exception closes a gate with a failing journey, and the exception is logged as an Intentional Compromise with a resolution date per Principle #1.

### 3.4 New-feature and under-built journey transitions (J9, J10, J11)

- **J9 and J10 begin appearing in pass-required sets at Phase 1** (integration / `calculatePrice` level for J10; approval-chain shape for J9). **Both become fully pass-required end-to-end at Phase 5** (customer-facing surfaces). Both are re-verified at Phase 8 after agent-tool integration (Decision 37 implications — `approvals.*` tools).
- **J11 (PO/Invoice Generation, added per Decision 44) begins appearing in pass-required sets at Phase 4** (integration test for PO generation; manual checklist for PO email delivery). Phase 5 extends to the customer-side PO-reference close-out flow. Phase 8 re-verifies after the `copilotExecPurchaseOrders` surface migrates onto the Task 4 registry. Phase 1 optionally scaffolds the PO integration test if Phase 1's pricing-engine work intersects the PO-payment-method path (decision deferred to Phase 1 opening).
- **Phase 0 close does NOT require J9 / J10 / J11 to have any tests** — J9 and J10 are greenfield, and J11 is under-built. Phase 1 (or Phase 4 for J11) scaffolds the first tests as part of the first-class implementation.

---

## Section 4 — Test infrastructure investments (Phase 1 work items)

The audit found gaps that block full protocol enforcement. Phase 1 ships the following infrastructure **before or alongside** the pricing cutover so the regression protocol can run from Phase 1 gate onward:

### 4.1 Playwright in CI (per Decision 41)

- **Extend `.github/workflows/ci.yml`** to run `npm run e2e` after Vitest passes. New job `e2e`, depends on `test`, reuses the MySQL 8.0 service container (per Decision 42 — no change to the DB approach), Node 20.20.2, Playwright install step, 10-minute timeout.
- **Artifact upload on failure:** screenshots + traces retained for 7 days per Playwright default.
- **Blocks PR merge** on e2e failure (same as unit tests today). Estimated +2–4 minutes per PR.
- **Phase 1 deliverable:** wire up the `e2e` job and get initial baselines green before the pricing-engine cutover.

### 4.2 Component testing (gap 3.2 of audit — zero client tests)

- **Add `@testing-library/react`** + `@testing-library/jest-dom` + `jsdom` devDependencies.
- **Extend `vitest.config.ts`** to support component tests with a `jsdom` environment on `.test.tsx` files.
- **Phase 1 writes the first component tests** for the distributor pricing view (J5) as the canonical example; subsequent phases add component tests for their touched surfaces.

### 4.3 Test database seeding, `.env.test`, design-partner session log (per Decisions 42, 45, 46)

- **Test DB (Decision 42).** Containerized MySQL 8.0 per CI job — the existing `ci.yml:50-64` pattern stays the standing approach. No new infrastructure cost. Per-job isolation preserved.
- **Seed fixtures.** **Extend `scripts/seed.ts`** to create a canonical "multi-division / multi-department / PO-workflow" test tenant with:
  - 1 org, 3 divisions (A, B, C), 4 departments, overlapping membership, deterministic budgets.
  - 2 products: one priced at flat rate; one priced per-division (A=$10, B=$12, C=$8) to exercise Decision 38.
  - 2 approval chains exercising Decision 37 (one serial, one parallel-approvers).
  - 1 PO-payment-method order exercising Decision 44 / J11 (`orders.paymentMethod = "po_number"`; invoice without Stripe settlement; distinct supplier bucket for `generatePOsForOrder`).
  - Expose fixtures by name (e.g., `seed.testOrg`, `seed.divisionA`, `seed.approvalChainSerial`, `seed.poOrder`) so tests can reference fixture identities without hardcoding IDs.
- **`.env.test` (Decision 45).** Commit `.env.test` to the repo with test-only values:
  - Test Stripe keys (`sk_test_*`, publishable test keys).
  - Test DB credentials matching the CI container setup (already in `ci.yml` in the clear).
  - Test Resend API key (or a mock sentinel — Phase 1 chooses based on whether Resend's sandbox allows test-only keys).
  - Test values for any other third-party integration (OAuth, Slack, QuickBooks).
  - Update `.gitignore` to confirm `.env.test` is explicitly NOT ignored; `.env`, `.env.local`, `.env.production` remain ignored.
  - Document the convention in `README.md` at Phase 1 close. Real secrets remain in GitHub Actions secrets for CI — never in the repo.
- **Design-partner session log (Decision 46).** Phase 1 creates `/docs/build-log/design-partner-sessions.md` with an initial template:

  ```markdown
  # Design-Partner Session Log

  Per Decision 46 (in-repo canonical). Each session entry records: date, topic, attendees, scope reviewed (journeys / surfaces), feedback gathered, decisions made, follow-ups (with target phase). Yan exports or summarizes periodically to share with the client.

  ## Phase N — YYYY-MM-DD — <session topic>
  - Attendees: ...
  - Scope reviewed: ...
  - Feedback: ...
  - Decisions: ...
  - Follow-ups: ...
  - Partner sign-off: validated | validated-with-follow-ups | not-validated
  ```

  Fires at Phase 4, Phase 5, Phase 8 gates per Decisions 39 and the regression-report template (§5).

### 4.4 Stripe webhook assertion harness + manual sandbox checklist (per Decision 43)

**Hybrid automation/manual approach locked by Decision 43.**

- **Automated (Phase 1):** deterministic Stripe webhook logic — idempotency, signature verification, event dispatch. Use `stripe` CLI or a webhook-signature mock to synthesize events. Phase 1 writes the first webhook tests covering: `checkout.session.completed`, `invoice.paid`, `payment_intent.succeeded`, `charge.refunded`. Expanded in Phase 6 if real-world webhook events surface.
- **Manual (Phase 1):** actual Stripe sandbox confirmation — card entry, 3-D Secure redirect (if applicable), completion — via a documented checklist at `docs/build-log/regression-manual-checklist.md`. Yan signs each row at each phase-gate manual walk-through. The checklist covers both distributor-facing and customer-facing payment flows.
- **Deferred:** full automation of Stripe sandbox flows (card-entry UI automation, webhook replay at sandbox latencies) is deferred to a future phase when a paying-customer workflow justifies the investment. Not Phase 1 scope.

### 4.5 Migration integrity harness (gap 5.3 of audit)

- **Pattern:** a Vitest test file `drizzle/migrations.test.ts` that:
  1. Applies every migration in order against a fresh MySQL container.
  2. Asserts post-migration schema shape matches `drizzle/schema.ts` via introspection.
  3. Runs a data-migration check for every migration that includes a backfill (per Decision 4 — `products.pricingTiers` full backfill; Decision 11 — `legacyPlaceholder` flag; Decision 20 — `virtualProofs.decorationZone` → FK translation).
- **Phase 1 ships the harness**; every subsequent phase with a migration extends it with that migration's data-integrity assertions.

### 4.6 Agent-tool regression harness (per Task 4 §6.3, 10.2; Phase 8)

- **Adapter parity tests:** every registered tool exercised through both native and MCP adapters, results compared. **Phase 8 ships** (no Phase 1 work — registry doesn't exist yet).
- **Tool-registry linter:** CI-time check that every registered tool declares required fields, passes Zod-to-JSON-Schema conversion, and has either a test fixture or an explicit waiver. **Phase 8 ships.**
- **Risk-tier drift detector:** diff-check against a committed baseline of (tool name → risk tier); accidental downgrades surface as CI warnings. **Phase 8 ships.**

### 4.7 Regression-report tooling

- **Phase 1 adds a small script** `scripts/regression-report.ts` that, given a phase number, emits a Markdown snippet enumerating:
  - Which journeys ran, with pass/fail status.
  - Which manual checklist rows Yan signed.
  - The touched-file audit.
  - The Phase N row to paste into `rebuild-2026-q2.md` under "Phase Status."
- **Output format** standardized per §5 below.

---

## Section 5 — Regression report format

At every phase gate, the regression report is pasted into the build log under the closing phase's section. Template:

```markdown
### Phase N regression report — YYYY-MM-DD

**Baseline commit:** `<SHA>` (Phase 0 close)
**Phase close commit (draft):** `<SHA>`

#### Automated

- Vitest: PASS / FAIL — N tests run, N passed, 0 failed, 0 skipped-new (baseline pre-existing skips: 45).
- Playwright: PASS / FAIL — N specs run, N passed.
- Typecheck: PASS / FAIL.
- Build: PASS / FAIL.

#### Journeys (pass-required for this phase)

| Journey | Status | Evidence |
|---|---|---|
| J1 | PASS | e2e/regression-baseline-j1-createWebstore.spec.ts |
| ... | ... | ... |

#### Manual checklist

| Row | Signed? | Notes |
|---|---|---|
| J4 Stripe payment confirmation | YES — Yan 2026-MM-DD | Payment completed; invoice updated. |
| ... | ... | ... |

#### Touched-file audit

| File | Regression coverage |
|---|---|
| server/pricing/calculator.ts | Unit test: server/pricing.test.ts:42 |
| ... | ... |

#### Design-partner review (Phases 4, 5, 8 only)

- Session date: YYYY-MM-DD
- Session notes: docs/build-log/design-partner-sessions.md#phase-N
- Partner sign-off: YES / NO
- Outstanding feedback: none | list of items

#### Gate decision

- Reviewer: <name>
- Gate criteria met (Y/N): Y
- Yan sign-off: YYYY-MM-DD
```

The gate-criteria dual sign-off (dated build-log entry + PR approval comment per `phase-gate-template.md`) attaches this report as evidence.

---

## Section 6 — Special handling for known bugs

### 6.1 Journey J7 — estimate-from-proposal / PDP-checkout tier divergence

- **Bug:** `server/routers/estimatesInvoices.ts:316` + `server/routers/storeCheckout.ts:432,993` use flat `unitPrice` / `customPrice ?? basePrice` instead of consulting tiers. PDP shows tier price; checkout writes flat price. Logged in `rebuild-2026-q2.md` "Bugs Discovered Mid-Phase" on 2026-04-20 per Decision 12.
- **Regression protocol requires:** Phase 1 cutover to `calculatePrice` FIXES this bug. Journey J7's regression assertion is **"PDP-computed price equals checkout-written price for the matching quantity"** — i.e., the fixed behavior passes, not the current behavior.
- **Phase 6 evaluation:** customer-facing impact (historical invoices at wrong prices) is assessed in Phase 6 per Decision 12. The regression protocol does not gate Phase 6 on this per se; Phase 6 produces a customer-communication plan if audit of historical invoices reveals material impact.

### 6.2 Placeholder behavior for `legacyPlaceholder` decoration rates (Decision 11)

- **Design:** Phase 1 migration creates `productDecorationRates` rows with `legacyPlaceholder = true`. Calculator treats them as zero-charge without throwing. Phase 2 zones intersect (Decision 21 — leave unzoned).
- **Regression requires:** calculator does NOT throw on placeholder rows; Phase 6 cleanup sweep surfaces them.
- **Test:** integration test `server/pricing.test.ts` includes a placeholder case; assertion is "zero charge, no throw."

### 6.3 Placeholder behavior for `virtualProofs.decorationZone` legacy strings (Decision 20)

- **Design:** Phase 2 migration runs the zone normalizer; unresolved strings logged to a migration-report file.
- **Regression requires:** downstream PO generation (`server/utils/generatePOsForOrder.ts:245,255,281`) and public-proposal display resolve zone labels via the new FK. Historical strings that didn't normalize are logged, not displayed as empty.
- **Test:** integration test asserts PO line `decorationLocation` shows zone label for a migrated row.

### 6.4 Generalization

Any new bug discovered mid-phase that would otherwise cause a regression failure is evaluated against this rule:

- **If the bug is the target of a locked Decision (like Decision 12) that fixes it in-phase:** regression asserts the fixed behavior, not the pre-fix behavior.
- **If the bug is new (not a pre-existing known issue):** regression asserts the correct behavior. Landing the rebuild with new bugs is not acceptable.
- **If the bug is pre-existing and out-of-scope for the rebuild:** regression preserves current behavior (is an intentional "match current" assertion), and the bug is logged in "Bugs Discovered Mid-Phase" for future resolution.

The audit doc (§9) identifies which journeys fall in which category today.

---

## Section 7 — Design-partner client validation gates

Per Decision 39, Phases 4, 5, and 8 have design-partner review sessions with a current MergeTasks client. The regression protocol integrates these gates as follows:

### 7.1 When design-partner review fires

- **Phase 4 gate:** design-partner session after the distributor-facing curation UX is implemented (approval-chain config UI, department-budget config UI, per-division pricing config UI). Partner validates the configuration UX against their real workflow.
- **Phase 5 gate:** design-partner session after customer-facing webstore is implemented (approval queue, division-scoped catalog, per-division pricing visibility). Partner validates the customer-facing experience end to end.
- **Phase 8 gate:** design-partner session after AI agent surfaces are implemented. Partner validates agent behaviors (pricing draft, curation assistant, approval proposals).

### 7.2 What a design-partner review produces

- **Session log entry** in `docs/build-log/design-partner-sessions.md` (created as a Phase 1 work item per the Decision 39 engagement protocol) with:
  - Session date, attendees, duration (30–60 minutes per the protocol).
  - Scope reviewed (which journeys / surfaces).
  - Partner feedback (itemized — positive, concerns, change requests).
  - Partner sign-off status: validated / validated-with-follow-ups / not-validated.
- **Follow-up items** — each tagged for current-phase-fix vs deferred. Deferred items logged in `rebuild-2026-q2.md` per existing conventions (Intentional Compromises with resolution dates, or Architectural Decisions if they reshape scope).

### 7.3 How partner sign-off interacts with automated regression

Both gates are required; neither substitutes for the other:

| Automated regression | Partner sign-off | Gate status |
|---|---|---|
| PASS | validated | **Gate closes** |
| PASS | validated-with-follow-ups | Gate closes; follow-ups logged (Intentional Compromises if deferred; in-scope fixes must land before close) |
| PASS | not-validated | **Gate blocked.** Partner feedback must be addressed or explicit Yan override with documented exception |
| FAIL | any | **Gate blocked.** Regression failure is absolute per §3.3 |

### 7.4 What partner review does NOT substitute

- **Partner validation does not replace automated regression.** A partner-approved journey that fails the automated assertion blocks the gate.
- **Partner validation does not replace Yan's final sign-off.** Per `phase-gate-template.md`, Yan's dual-convention sign-off (dated build-log entry + PR approval comment) closes the gate; partner review is evidence, not authority.
- **Partner validation does not replace the manual checklist.** Separate artifact, separate purpose — the checklist covers regression against current behavior; partner review covers feature-fit against partner needs.

---

## Section 8 — New-features integration with protocol

Per Decisions 37 and 38, Journeys J9 and J10 are greenfield. Specific protocol interactions:

### 8.1 Journey J9 — Multi-department approval (Decision 37)

| Phase | J9 regression requirement |
|---|---|
| Phase 1 | Integration test: approval-chain computation (serial, parallel); `departments`, `departmentBudgets`, `approvalChains`, `approvalRequests` orgScope enforcement. |
| Phase 4 | Integration test: distributor configuration UX writes correct `approvalChains` rows; component tests on configuration surfaces. |
| Phase 5 | E2E test: customer initiates order → approval routes → approved orders complete checkout. Design-partner review gate fires. |
| Phase 8 | Agent-tool tests: `approvals.list` / `approvals.approve` / `approvals.reject` follow Decision 26 risk-tier contract; adapter parity. Design-partner review gate fires. |

### 8.2 Journey J10 — Multi-division pricing (Decision 38)

| Phase | J10 regression requirement |
|---|---|
| Phase 1 | Integration test: `calculatePrice({ divisionId: A })` vs `calculatePrice({ divisionId: B })` on the same product return differentiated `unitSellPriceCents`. Schema migration integrity. |
| Phase 4 | Integration test: per-division pricing configuration UX writes correct override rows; component tests. |
| Phase 5 | E2E test: customer in division A sees price X on PDP and at checkout; customer in division B sees price Y. Design-partner review gate fires. |
| Phase 8 | Agent-tool tests: `pricing.calculate({ divisionId })` tool respects division scoping. |

---

## Section 9 — Open questions for Yan

**All 7 questions RESOLVED 2026-04-22.** Each subsection carries a RESOLVED banner pointing to the corresponding Decision (41–47) in `rebuild-2026-q2.md`. Task 6 is closed; Phase 0 awaits formal Yan sign-off per the `phase-gate-template.md` dual-signoff convention.


### 9.1 Playwright in CI — invest in Phase 1?

**RESOLVED 2026-04-22 — Decision 41:** **YES**, Playwright added to CI in Phase 1. New `e2e` job in `.github/workflows/ci.yml` depends on `test`, reuses the MySQL 8.0 service container, 10-minute timeout, artifact upload on failure. Estimated +2–4 minutes per PR. PRs cannot merge if Playwright tests fail. Phase 1 work item: wire up the `e2e` job and get initial baselines green.

### 9.2 Test database — RDS vs containerized MySQL in CI?

**RESOLVED 2026-04-22 — Decision 42:** **containerized MySQL 8.0**, one container per CI job (existing `ci.yml:50-64` pattern stays). Per-job isolation preferred over a persistent shared test DB. No new infrastructure cost. RDS test DB is a Phase-8-plus consideration only if parallel CI minute count starts mattering.

### 9.3 Manual checklist for Stripe payment flow — acceptable for Phase 1?

**RESOLVED 2026-04-22 — Decision 43:** hybrid. **Automated**: deterministic Stripe webhook logic in Phase 1 — idempotency, signature verification, event dispatch for `checkout.session.completed`, `invoice.paid`, `payment_intent.succeeded`, `charge.refunded` (per §4.4). **Manual**: actual Stripe sandbox confirmation (card entry, redirect, completion) via a documented checklist at `docs/build-log/regression-manual-checklist.md`. Full Stripe sandbox automation deferred to a future phase when a paying-customer workflow justifies the investment.

### 9.4 Proposed journey list — any additions, removals, or re-prioritizations?

**RESOLVED 2026-04-22 — Decision 44:** **Journey J11 (PO/Invoice Generation) added.** Total now **11 critical journeys**. Rationale: PO workflow is enterprise-B2B-specific and differs materially from the proposal → estimate → invoice → Stripe-payment flow at J4. The design-partner client and target market (hospitals, universities, government) rely on PO-based purchasing. J11-specific flow: distributor generates PO → customer receives PO → customer issues PO reference to close out order → invoice marks paid via PO reference (bypassing Stripe). Must begin passing by **end of Phase 4**. Coverage: integration test for PO generation + manual checklist for PO email delivery (see `task-6-regression-audit.md` §9 entry for J11 and the per-phase matrix in §3.2 of this doc).

### 9.5 `.env.test` — commit test env with test-only values?

**RESOLVED 2026-04-22 — Decision 45:** **YES**, commit `.env.test` with test-only values: test Stripe keys (`sk_test_*`, publishable test keys), test DB credentials matching the CI container setup, test Resend API key (or mock), test values for any other third-party integration. Real secrets (prod DB URL, prod Stripe keys, prod Resend keys) remain in GitHub Actions secrets for CI and in `.env` / `.env.production` / `.env.local` (all gitignored). Phase 1 work item: create `.env.test`, document safe values inline, update `.gitignore` to confirm `.env.test` is NOT ignored, document the convention in `README.md` at Phase 1 close.

### 9.6 Design-partner review artifact — in-repo markdown vs external doc?

**RESOLVED 2026-04-22 — Decision 46:** **in-repo canonical.** `/docs/build-log/design-partner-sessions.md` is the authoritative source. Each session entry: date, topic, attendees, feedback gathered, decisions made. Yan exports or summarizes periodically to share with the client as needed (meeting notes, decision summaries). Phase 1 creates the file with an initial template.

### 9.7 Regression coverage gate — numeric threshold?

**RESOLVED 2026-04-22 — Decision 47:** **NO numeric threshold.** Regression gate is the per-journey pass list (now 11 journeys per Decision 44). No 80% line-coverage requirement; no Codecov threshold. Rationale: line coverage is gameable and does not verify behavior; journey-pass is stronger evidence that the rebuild has not regressed critical user flows. The touched-file audit (§3.1 item 5) surfaces files that changed without corresponding tests; reviewers challenge those in PR.

---

## Section 10 — Dependencies & interactions

### 10.1 With Phase 0 Task 4 (agent tool layer)

- Task 4 §6.3 specifies adapter parity testing; §10.2 flags a regression harness for Phase 8. Task 6's protocol adopts both as Phase 8 gate criteria (§3.2 Phase 8 row; §4.6).
- Task 4's tool-registry linter is added to CI alongside the e2e job in Phase 8.

### 10.2 With Phase 0 Task 5 (conditional subsystems promoted)

- J9 (Decision 37) and J10 (Decision 38) are gated per §3.4 and §8. Design-partner validation per Decision 39 integrates at Phases 4, 5, 8 (§7).
- Ceiling revision (Decision 40) already accounts for the ~1 week Phase 7 regression coverage expansion — §3.2 Phase 7 row reflects this.

### 10.3 With protected subsystems

- **Auth / SSO (#1), orgScope (#2):** regression protocol inherits existing tests (`dataIsolation.test.ts`, `security.test.ts`, `storeAuth.test.ts`, etc.). Any touched-file in these subsystems is a pause-and-escalate event per `protected-subsystems.md`.
- **Stripe (#3, #4):** webhook assertion harness §4.4 adds coverage without modifying the Stripe integration.
- **Resend (#5):** manual checklist covers "email arrived"; no automation against the Resend API.
- **tRPC / Drizzle / React / pm2 (#6):** inherited from existing suite health.
- **AI copilot (#7):** existing test coverage (`agentTriggers`, `copilot`, `copilotExecutors`, `copilotTools`) stays the regression net through Phase 7. Phase 8 migrates copilot onto the Task 4 registry and adds adapter-parity coverage per §4.6.
- **PDF generation (#8):** no current coverage; regression is "if Phase 4 / Phase 5 surfaces an invoice or proposal PDF, the output file matches the pre-rebuild byte-identical baseline for a golden fixture." Golden-fixture harness added as a Phase 6 or Phase 7 work item only if a regression actually surfaces.

---

## Appendix — Summary for Yan

**Status (2026-04-22):** all 7 open questions from §9 resolved as Decisions 41–47. Journey J11 (PO/Invoice Generation) added per Decision 44 — **11 critical journeys total.** Task 6 closed; Phase 0 awaits formal Yan sign-off.

**Resolved open questions:**

| # | Resolution | Decision |
|---|---|---|
| §9.1 | Playwright added to CI in Phase 1; new `e2e` job in `ci.yml`; PRs cannot merge on e2e failure | **41** |
| §9.2 | Containerized MySQL 8.0 per CI job stays the standing approach | **42** |
| §9.3 | Hybrid: automated Stripe webhook logic (Phase 1) + manual Stripe sandbox checklist | **43** |
| §9.4 | J11 (PO/Invoice Generation) added; **11 journeys total** | **44** |
| §9.5 | `.env.test` committed with test-only values; real secrets remain in GitHub Actions secrets | **45** |
| §9.6 | `/docs/build-log/design-partner-sessions.md` in-repo canonical | **46** |
| §9.7 | No numeric coverage threshold; per-journey pass list is the gate | **47** |

**What Phase 1 must build as infrastructure (prerequisites to enforcing this protocol):**

1. **Playwright added to `.github/workflows/ci.yml`** as a new `e2e` job (§4.1; Decision 41). Depends on `test`; reuses MySQL 8.0 container; 10-minute timeout; artifact upload on failure; PR merge blocks on failure.
2. **`@testing-library/react` + `@testing-library/jest-dom` + `jsdom` installed**; Vitest config extended for component tests (§4.2). First component test: distributor pricing view (J5).
3. **`scripts/seed.ts` extended** to create canonical multi-division + multi-department + PO-payment-method fixtures (§4.3; serves Decisions 37, 38, 44).
4. **`.env.test` committed** with test-only values (Stripe test keys, test DB creds, test Resend key); `.gitignore` updated; `README.md` documents the convention (§4.3; Decision 45).
5. **Stripe webhook assertion harness** for deterministic handler-logic testing (§4.4; Decision 43). Complement: `regression-manual-checklist.md` for Stripe sandbox confirmation.
6. **Drizzle migration integrity harness** at `drizzle/migrations.test.ts` (§4.5).
7. **`scripts/regression-report.ts`** and `docs/build-log/regression-manual-checklist.md` (§4.7).
8. **`docs/build-log/design-partner-sessions.md` created** with the initial template (§4.3; Decision 46; also flagged as a Phase 1 work item in `rebuild-2026-q2.md` Phase Status notes per Decision 39 engagement protocol).
9. **`server/pricing.test.ts` baseline** established against the Phase 0 close commit — first dedicated pricing-calculation test suite (addresses the largest coverage gap in the audit).
10. **Baseline specs written for J1–J6, J8** against the Phase 0 close commit, verified passing before any Phase 1 rebuild code change.
11. **J7 "fix-assertion" baseline spec** written; confirmed to fail against pre-cutover `main` and pass after Phase 1 cutover.
12. **J10 integration scaffolding** — `calculatePrice({ divisionId })` returns differentiated prices once the Phase 1 per-division pricing lands.
13. **J11 integration scaffolding** (Phase 1 optional / Phase 4 required) — PO generation path exercised, supplier bucketing + PO numbering asserted, invoice linkage verified.

**Phase 0 close unblock status:** this protocol is complete and ratified. Phase 0 closes after Yan signs off per `phase-gate-template.md` dual convention (dated build-log entry + PR approval comment) on the full Phase 0 gate criteria.

Phase 1 begins implementation of the pricing engine + the infrastructure investments above, the latter happening alongside (not serially after) the pricing work so the regression gate fires on Phase 1's own close.
