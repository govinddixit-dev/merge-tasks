# Webstore / Pricing / Imprint / Supplier Rebuild — 2026 Q2

## Overview

- **Goal:** Rebuild the webstore, pricing, imprint zone, supplier sync, and distributor curation subsystems of MergeTasks with zero technical debt at end of build, AI-native architecture, and Apple-for-enterprise UX.
- **Start date:** 2026-04-20
- **Projected end date:** Projected completion no later than 2026-09-07 (ceiling revised per Decision 40 on 2026-04-22 to absorb Decisions 37 and 38 scope additions). Phases close on gate criteria, not calendar. If tracking materially faster or slower, update here. (Ceiling history: 2026-07-06 at rebuild start; extended to 2026-07-27 when Phase 8 was added per Decision 3 on 2026-04-20; extended to 2026-09-07 per Decision 40 on 2026-04-22.)
- **Track:** Sequential only. One phase at a time. The next phase does not start until the current phase's gate criteria are met and Yan has signed off in writing.
- **Owner:** Yan (product + final sign-off)
- **Scope doc:** This file is the living build log. Every phase update lands here.

## Phase Status

**Duration / target-end-date estimates below revised 2026-04-22 per Decision 40** to absorb Decisions 37 and 38 scope additions. End Date column stays empty until a phase actually closes; target-end-date estimates live in Notes.

| Phase | Name | Status | Start Date | End Date | Gate Criteria Met (Y/N) | Notes |
|-------|------|--------|------------|----------|-------------------------|-------|
| 0 | Foundation & Design | **Complete** | 2026-04-20 | **2026-04-22** | **Y** | **All 6 tasks complete 2026-04-22; formal Yan sign-off 2026-04-22** — see "Phase Sign-offs" section below. Tasks 1, 1.5, 2, 3, 4, 5, 6 closed (logging scaffolding; Architectural Decisions backfill; pricing-engine design + 9 resolved decisions; imprint-zone design + 10 resolved decisions; agent tool-layer pattern + 10 resolved decisions; conditional-subsystems promoted to in-scope + 4 decisions; regression audit/protocol + 7 resolved decisions — Decisions 1–47 total). |
| 1 | Unified Pricing Engine | **Ready to Start** | — | — | — | Anticipated start: 2026-04-23 (or on Yan's Phase 1 opening prompt). 2.5–3 weeks (up from 2 weeks per Decision 40 to absorb `departmentId` / `divisionId` first-class schema work). Target end: ~2026-05-18. Replaces flat `customPrice`/`basePrice` checkout path; adds `departments`, `departmentBudgets`, `approvalChains`, `approvalRequests` (per Decision 37) and per-division pricing storage (per Decision 38 — implementation choice deferred to Phase 1 opening). **Phase 1 infrastructure work items (per Task 6 Decisions 41–47):** (a) wire Playwright into `.github/workflows/ci.yml` as a new `e2e` job (Decision 41); (b) install `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` and extend `vitest.config.ts` for component tests; (c) create `.env.test` with test-only values + update `.gitignore` + document in `README.md` (Decision 45); (d) extend `scripts/seed.ts` with multi-division / multi-department / PO-payment-method fixtures; (e) Stripe webhook assertion harness (Decision 43); (f) Drizzle migration integrity harness at `drizzle/migrations.test.ts`; (g) `scripts/regression-report.ts` + `docs/build-log/regression-manual-checklist.md`; (h) create `/docs/build-log/design-partner-sessions.md` with the Decision 46 template (also per the Decision 39 engagement protocol); (i) create `server/pricing.test.ts` as first dedicated pricing-calculation baseline; (j) write baseline specs for J1–J6, J8 green against Phase 0 close commit, and J7 "fix-assertion" spec red pre-cutover / green post-cutover. **Also:** Phase 1 provisions AWS ElastiCache Redis (`cache.t4g.small`) and adds `bullmq` per Decision 27. |
| 2 | Imprint Zone Infrastructure | Pending | — | — | — | ~2 weeks. Target end: ~2026-06-01. Zone metadata, constraints, per-product selection (design locked in Task 3). |
| 3 | Supplier Sync + Generic Adapter | Pending | — | — | — | ~2 weeks. Target end: ~2026-06-15. Change-detection + generic `apiConnections` adapter. |
| 4 | Distributor Curation UX | Pending | — | — | — | 3 weeks (up from 2 weeks per Decision 40). Target end: ~2026-07-06. Per-product zone / decoration / tier pickers + approval-chain configuration UI + department-budget configuration UI (Decision 37) + per-division pricing configuration + division membership management (Decision 38). |
| 5 | Customer-Facing Webstore Home | Pending | — | — | — | 1.5 weeks (up from 1 week per Decision 40). Target end: ~2026-07-16. Tier breakdown, branded previews, setup fees + approval queue UI + customer approver workflows + division-scoped catalog & pricing visibility (Decisions 37, 38). |
| 6 | Side-Quest Bug Fixes | Pending | — | — | — | ~1 week. Target end: ~2026-07-23. Addresses bugs discovered mid-phase. |
| 7 | Cleanup, Regression, Launch Readiness | Pending | — | — | — | 1.5 weeks (up from 1 week per Decision 40 for expanded regression coverage of multi-department + multi-division workflows end-to-end). Target end: ~2026-08-03. |
| 8 | AI Features & Agentic Workflows | Pending | — | — | — | 3.5–4 weeks (up from 3–4 weeks per Decision 40). Ends no later than **2026-09-07** (per Decision 40). Added per Decision 3 (2026-04-20). Scope: upgrade existing copilot + 4 new agents (Catalog-Change, Curation Assistant, Pricing-Draft, Customer-Service) + tool registry + memory/context + eval harness + cost/latency observability. Additional Phase 8 agent tools per Decisions 37 & 38: approval workflow tools (`approvals.list` / `.approve` / `.reject` — approval_required by default), department-scoped and division-scoped queries. |

Status values: `Pending` / `Ready to Start` / `In Progress` / `Gate Review` / `Complete` / `Blocked`.

## Phase Sign-offs

_Per `phase-gate-template.md` dual-convention: each phase closes with (a) a dated build-log entry in this section and (b) a matching PR approval comment. Both are required; neither substitutes for the other._

### Phase 0 — 2026-04-22

> Phase 0 sign-off: Yan, 2026-04-22 — gate criteria verified: all 6 Phase 0 tasks complete (Tasks 1, 1.5, 2, 3, 4, 5, 6); 47 Architectural Decisions logged (Decisions 1–47 spanning 2026-04-20 through 2026-04-22); `protected-subsystems.md` updated with no remaining Conditional items (both promoted to IN SCOPE per Decisions 37 and 38); Design-Partner Engagement methodology locked (Decision 39) with in-repo session log convention (Decision 46); 11 critical user journeys identified and mapped to per-phase gates (J11 added per Decision 44); regression protocol complete with Phase 1 infrastructure work items enumerated; rebuild ceiling locked at 2026-09-07 (Decision 40); all Phase 0 design documents reviewed by Yan. Approved to proceed to Phase 1.

**Commits closing Phase 0** (per `git log` on `main` as of sign-off):

| Task | Commit(s) | Summary |
|---|---|---|
| Task 1 (logging scaffolding) | `cd2115d`, `cbf99ee` | Initial scaffolding of rebuild build-log + Yan review applied |
| Task 1.5 (architectural backfill) | `e269d7d` | Foundational Decisions 1–3 (Options A, X, 3) backfilled |
| Task 2 (pricing engine) | `030d9ec`, `be9e5d7` | Design doc restored; 9 resolved decisions (4–12); Architectural Decisions log updated |
| Task 3 (imprint zones) | `e8599d7`, `79fedd4` | Design doc + 10 resolved decisions (13–22) |
| Task 4 (agent tool layer) | `b4102b3`, `3a92ebd` | Design doc + 10 resolved decisions (23–36) |
| Task 5 (conditional subsystems) | `7dbc918`, `8a992c8` | Conditional items promoted to IN SCOPE (Decisions 37–40); amendment reframed Decision 39 as Design-Partner Engagement methodology |
| Task 6 (regression baseline) | `9b49c18`, `56effd3` | Audit + protocol design; 7 resolved decisions (41–47); J11 added |

**Gate criteria evidence:**
- **All 6 Phase 0 tasks complete** — enumerated above with commit citations.
- **47 Architectural Decisions logged in `rebuild-2026-q2.md`** — Decisions 1–3 foundational (2026-04-20); 4–12 pricing (Task 2); 13–22 imprint zones (Task 3); 23–36 agent tool layer (Task 4); 37–40 conditional subsystems (Task 5); 41–47 regression protocol (Task 6).
- **`protected-subsystems.md` has no remaining Conditional items** — the Conditional section was replaced with "Resolved conditional items (historical)" at line 16; both items moved to IN SCOPE as first-class features per Decisions 37 and 38.
- **Design-Partner Engagement section present** — `rebuild-2026-q2.md` line 802 under Decision 39's engagement protocol; session log convention (in-repo canonical) locked per Decision 46.
- **Rebuild ceiling 2026-09-07** — Decision 40; Overview section records the ceiling history (2026-07-06 → 2026-07-27 → 2026-09-07).
- **11 critical user journeys defined** — `task-6-regression-audit.md` §9 and the per-phase pass-required matrix in `task-6-regression-protocol.md` §3.2.
- **Regression protocol complete** — `task-6-regression-protocol.md` with Phase 1 infrastructure work items enumerated in the Phase 1 row of the Phase Status table.

**PR-equivalent approval comment (per `phase-gate-template.md` item (b)):** _Phase 0 gate criteria met. Approved for merge. See `rebuild-2026-q2.md` entry dated 2026-04-22._ (This commit itself serves as the PR-equivalent approval per the sign-off prompt.)

**Next phase unblock:** Phase 1 (Unified Pricing Engine) is `Ready to Start`. Yan opens Phase 1 with a dedicated Phase 1 prompt that accounts for the scope additions surfaced during Phase 0 (multi-department / multi-division first-class per Decisions 37–38, J11 PO workflow gaps per Decision 44, the full Phase 1 infrastructure work-item list from Task 6, and AWS ElastiCache Redis + BullMQ provisioning per Decision 27).

## Architectural Decisions

Each entry: date, decision, context, options considered, option selected, rationale, implications.

**Conditional-subsystem decisions cross-link:** For items listed in `protected-subsystems.md` under "Conditional", record the reasoning here (why the decision was made, tradeoffs considered) and record the final outcome in `protected-subsystems.md`. Both entries carry the same date and reference each other by that date, e.g. "See protected-subsystems.md entry dated YYYY-MM-DD" and "See rebuild-2026-q2.md Architectural Decisions entry dated YYYY-MM-DD".

### 2026-04-20 — Decision 1: Pricing system consolidation approach

**Context:** Audit revealed three parallel pricing systems exist today (webstore flat `customPrice`, `proposalPriceTiers` for proposals, `printProductPricing` for print). Continuing with parallel systems embeds permanent tech debt.

**Options considered:**
- **Option A — Unify now:** build ONE pricing engine that handles webstore, proposals, and estimates. Retire the parallel systems. Zero debt at end, but 2–3 weeks of additional work touching proposal and estimate paths currently working fine.
- **Option B — Build webstore pricing cleanly, unify later:** build a new canonical engine for webstore only; leave proposals and estimates alone. Ship faster, accept three parallel pricing systems coexist through launch.
- **Option C — Build webstore pricing as future canonical, migrate others one at a time:** separate phases for each migration. Slowest but safest progression.

**Selected:** **Option A** (unify now).

**Rationale:** The founder's stated goal is zero tech debt at end of build. Option B permanently embeds the highest-leverage piece of tech debt in the codebase. Option C is the pragmatic version of Option A but adds calendar time without architectural benefit given we have >6 weeks. Option A delivers the stated goal at the cost of ~2 additional weeks inside Phase 1.

**Implications:** Phase 1 scope expands to cover migration of proposals and estimates to the new engine, not just webstore. One pricing engine exists at end of Phase 1. Three old systems are deleted in the same PR that replaces them, per Principle #2 (no dead code at merge time).

### 2026-04-20 — Decision 2: Build track structure

**Context:** The rebuild scope could be executed sequentially (one phase at a time) or with some phases running in parallel.

**Options considered:**
- **Option X — Single sequential track:** one phase at a time, founder reviews each phase gate before next starts. Slower calendar time, tightest quality control, zero merge conflict risk.
- **Option Y — Parallel tracks (up to 2–3 isolated subsystems simultaneously):** faster but requires disciplined merge strategy and review of multiple concurrent streams.

**Selected:** **Option X** (sequential).

**Rationale:** Founder explicitly stated that parallel work was part of how MergeTasks accumulated the current pricing debt in the first place. Preserving architectural coherence and review bandwidth outweighs calendar compression. Sequential also aligns with Principle #8 in `architectural-principles.md` (sequential track only).

**Implications:** Calendar time extends vs. parallel execution. Each phase has a single hard gate before the next begins. Mid-phase bugs follow Principle #11 (deferred unless blocking). Ceiling date set at 2026-07-27 reflects sequential execution of all phases including the new Phase 8.

### 2026-04-20 — Decision 3: AI feature sequencing

**Context:** MergeTasks is AI-centric / agentic by strategic mandate. The rebuild builds AI-ready infrastructure but the question is WHEN to build actual AI features on top.

**Options considered:**
- **Option 1 — Infrastructure-only:** the 7 original phases make MergeTasks AI-ready. AI features deferred indefinitely or to a future project. Clean separation but AI value not delivered in this rebuild.
- **Option 2 — AI woven through each phase:** every phase ships at least one real agent capability using that phase's new infrastructure. Adds ~30% to each phase. Ships AI alongside infrastructure.
- **Option 3 — Dedicated AI phase at end:** finish the 7 infrastructure phases. Add Phase 8 specifically for shipping agentic workflows on top of the completed foundation. Total project extends 3–4 weeks. AI shipped, just sequenced last.

**Selected:** **Option 3** (dedicated Phase 8 for AI features).

**Rationale:** Option 2 creates moving-target AI — every evolution of the pricing engine mid-build would require re-plumbing the pricing agent. Results in half-working agents and infrastructure compromised to accommodate them. Option 3 delivers a stable AI-ready platform at end of Phase 7, then a dedicated phase builds agentic workflows on solid ground. Clean commits, logical place for copilot upgrades, measurable AI evaluation from day one.

**Implications:** Rebuild now includes Phase 8 (previously 7 infrastructure phases only). Existing AI copilot remains on the protected-subsystems list through Phase 7 (existing functionality protected; Phase 8 will upgrade it). Phase 8 scope: upgrade existing AI copilot + build 4 new agents (Catalog-Change, Curation Assistant, Pricing-Draft, Customer-Service) + agent tool registry as runtime system + memory/context system + AI evaluation harness + cost/latency observability. Ceiling date extended from 2026-07-06 (7-phase) to 2026-07-27 (8-phase).

### 2026-04-21 — Decision 4 (A): Treatment of `products.pricingTiers` in Phase 1 migration

**Context:** Phase 0 Task 2 audit found `products.pricingTiers` is actively consumed by the webstore PDP (`StoreProductDetailPage.tsx:78-84`), PrintStore (`:104,175`), distributor `ProductDetail.tsx:158-163`, catalog APIs (`storesCrud.ts:309`, `copilotExec/clientsProducts.ts:171`), and the write path with Zod validation (`products.ts:105-110,150,312`). This contradicts the Task 2 prompt's claim that it was "dead code today per audit." The migration design depends on whether the column is treated as live or dead.

**Options considered:**
- **Option (a) — Treat as live:** §5.1 migration runs a full backfill into the new `productPriceTiers` table before the column is dropped. Safe whether or not production has rows.
- **Option (b) — Treat as dead per the prompt:** `ALTER TABLE products DROP COLUMN pricingTiers` with no backfill. Faster; risks silent data loss if audit was right.

**Selected:** **Option (a)** (treat as live).

**Rationale:** Audit evidence is unambiguous — live readers and a Zod-validated write path rule out dead-code status. Backfill costs nothing if the column is empty and preserves everything if it isn't. Principle #1 (zero tech debt at end of build) extends to "zero silently lost customer data."

**Implications:** No change to the design beyond confirmation. §5.1 migration script runs as specified. Design doc §1.4 and §6.1 carry RESOLVED banners pointing here.

### 2026-04-21 — Decision 5 (B): Size-based upcharges preserved via `productPriceTiers.sizeLabel`

**Context:** `proposalPriceTiers.tierType = "size"` today lets distributors price 2XL/3XL shirts higher than XS-XL. The original unified `productPriceTiers` model was quantity-only, dropping this capability.

**Options considered:**
- **Option (a) — Drop:** simplest schema; loses the upcharge capability. Feature regression for apparel distributors.
- **Option (b) — Keep via nullable `sizeLabel` column on `productPriceTiers`:** calculator matches size-tier when `ctx.sizeLabel` is set, falls back to size-agnostic (`sizeLabel = NULL`) tier otherwise.
- **Option (c) — Separate `productSizeUpcharges` table:** fully normalized; higher complexity.

**Selected:** **Option (b)** (add nullable `sizeLabel` column).

**Rationale:** Otentik Brand (Yan's distribution business) sells apparel; 2XL/3XL upcharge is industry-standard and non-negotiable. Dropping it would be a feature regression the rebuild cannot afford. Option (c) is over-engineering for Phase 1 — `sizeLabel` carries the semantics with a unique index on `(productId, variantId, sizeLabel, minQty)` keeping correctness. Phase 2+ can migrate to (c) if size-upcharge logic grows (e.g. per-color upcharges).

**Implications:** `productPriceTiers.sizeLabel` nullable `varchar(16)`. `PricingContext.sizeLabel` optional field. Migration (§5.4) inserts size-scoped rows into either `productPriceTiers` (global sizing) or `proposalPriceOverrides` (per-proposal sizing). Design doc §6.2 RESOLVED.

### 2026-04-21 — Decision 6 (C): Per-proposal custom pricing preserved via new `proposalPriceOverrides` table

**Context:** Today `proposalPriceTiers` ties tiers to `proposalProductId`, letting a distributor price a product differently in Proposal #42 than Proposal #43 (used for negotiated deals — e.g. Unity Hospital Q3 order at a special rate). The restored design doc's recommendation was Option (c): drop the capability and rely on `storeProducts.customPrice`.

**Options considered:**
- **(a)** `storeProducts.customPrice` only: store-level flat override. Loses per-proposal tier granularity.
- **(b)** New `proposalPriceOverrides` table: preserves full fidelity (quantity + size + per-proposal scoping).
- **(c)** Drop the capability entirely: clean-slate bet; feature regression on an active distributor workflow.

**Selected:** **Option (b)** (new table), overriding the restored doc's Option (c) recommendation.

**Rationale:** Distributors actively rely on per-proposal custom pricing. Dropping it would break existing workflows. The new `proposalPriceOverrides` table is a minimal addition (9 columns, 2 indexes) and fits cleanly into the calculator precedence chain: check overrides first when `ctx.proposalProductId` is set; fall back to `productPriceTiers` otherwise. Zero tech debt AND zero feature regressions both bind.

**Implications:** New `proposalPriceOverrides` table (design doc §3.8). `PricingContext.proposalProductId` optional field. `unitPriceCents` bypasses markup (override is a post-markup sell price, analogous to `customPrice`). Migration (§5.4) inserts from `proposalPriceTiers` when the row is not a denormalized copy of the global schedule. Design doc §6.4 RESOLVED.

### 2026-04-21 — Decision 7 (D): Print variant model preserved; `productPriceTiers.variantId` FK added

**Context:** Today `printProducts → printProductVariants → printProductPricing` is a three-table structure where each size/stock variant has its own tier schedule. The restored design doc's recommendation was Option (b): promote each variant to a top-level `products` row (3–5× row-count multiplier but clean tier story).

**Options considered:**
- **(a) Collapse to product:** take one variant's pricing as the whole-product schedule. Loss of fidelity.
- **(b) Promote variants to products:** each variant becomes a `products` row. Row-count multiplier; flattens the catalog; awkward UX.
- **(c) Preserve variant model + `variantId` FK on `productPriceTiers`:** keeps the three-table structure, adds a discriminator to the unified tier table.

**Selected:** **Option (c)** (variant model preserved), overriding the restored doc's Option (b) recommendation.

**Rationale:** Yan has zero print products in production today — which paradoxically makes (c) free, because there is no migration pain to trade off against the row-count multiplier of (b). The variant model matches real-world print catalog mental models (one "business card" product page with size/stock/finish dropdowns) better than a flattened product-per-variant list. `variantId` as a nullable FK on `productPriceTiers` is a discriminator, not a parallel path — `productPriceTiers` remains the single tier table; `PrintCalculator` resolves variant before tier match.

**Implications:** `productPriceTiers.variantId` nullable `int` FK → `printProductVariants.id`. `printProducts` and `printProductVariants` stay live. `printProductPricing` retired in Phase 1 with no data to migrate (empty table). `PrintCalculator` gains variant resolution step. Design doc §5.3 rewritten; §6.7 RESOLVED.

### 2026-04-21 — Decision 8 (E): `products.type` column name retained (not renamed to `productType`)

**Context:** The Task 2 prompt used `productType` throughout; the existing column is `type` (enum `["promotional", "print"]`). The restored design doc flagged this as cosmetic and recommended keeping the column name.

**Options considered:**
- **(a) Keep column as `type`, alias in TypeScript:** zero migration risk; minor doc/code naming asymmetry.
- **(b) Rename to `productType`:** one migration, ~20 file touchpoints from audit; clearer prose/code alignment.

**Selected:** **Option (a)** (keep `type`).

**Rationale:** The rename is pure cosmetic consistency; the migration adds surface area (every reader/writer touchpoint must change in the same PR per Principle #3) without functional benefit. TypeScript alias `ProductType = "promotional" | "print"` covers the prose/code gap.

**Implications:** No schema change. TypeScript alias added in `shared/pricing/types.ts`. Comments in design doc make the mismatch explicit. Design doc §6.3 RESOLVED.

### 2026-04-21 — Decision 9 (F): Single `stores.markupPct` column; no `storeMarkupRules` table in Phase 1

**Context:** Markup can be modeled as a single decimal per store, or as a rules table keyed on category/quantity/etc. The restored design doc recommended the simpler approach.

**Options considered:**
- **(a) Single column `stores.markupPct`:** one global rate per store. A future phase can add `storeMarkupRules` if needed, deprecating the column with a clean migration path.
- **(b) Rules table from day one:** `storeMarkupRules(storeId, category, qtyMin, qtyMax, markupPct)`. Over-engineered if no distributor needs category- or quantity-tiered markup.

**Selected:** **Option (a)** (single column).

**Rationale:** YAGNI — no distributor today has asked for category- or quantity-tiered markup. The single column is a trivial migration path to a rules table if the need surfaces. Building the rules table now with no consumer violates "don't design for hypothetical future requirements."

**Implications:** `stores.markupPct` nullable `decimal(5,4)`. Calculator applies the single rate (treats NULL as 0). Design doc §6.5 RESOLVED.

### 2026-04-21 — Decision 10 (G): Finishing options priced in Phase 1 via new `printFinishingRates` table

**Context:** Print finishing options (matte lamination, spot UV, die-cut) are paid upgrades (~$0.10/pc matte, $0.25/pc spot UV). The restored design doc recommended Option (a): ship selection-only in Phase 1 and log the missed pricing as a Phase 2 intentional compromise.

**Options considered:**
- **(a) Selection-only, Phase 2 pricing:** customer sees "spot UV" selection but cart price doesn't change. Known compromise.
- **(b) Price finishing in Phase 1:** new `printFinishingRates` table; adds ~1 week to Phase 1.

**Selected:** **Option (b)** (price finishing in Phase 1), overriding the restored doc's Option (a) recommendation.

**Rationale:** Principle #1 makes intentional compromises expensive to carry — each has a resolution date and a target phase, and Phase 2 would need to unwind Option (a). The incremental Phase 1 cost is less than the cumulative Phase 1+2 cost of shipping broken then fixing. Ship it right the first time.

**Implications:** New `printFinishingRates` table (design doc §3.9). `PricingContext.selectedFinishingOptions` optional `string[]`. `PrintCalculator` iterates, looks up each option's rate, adds to `decorationUnitCostCents` and `setupFeesTotalCents`. Throws `PricingError("finishingRateNotSet")` when a selected option has no rate row (fail-loud, not silent zero). Design doc §6.6 RESOLVED.

### 2026-04-21 — Decision 11 (H): Legacy-placeholder flag for decoration migration (non-breaking)

**Context:** The restored design doc's §5.2 migration created `productDecorationRates` rows from `products.decorationMethods` with `unitRateCents = 0` and relied on a runtime check (`unitRateCents = 0 AND source = "manual"`) to throw `decorationRateNotSet`. Problem: every existing product's decoration attempt would throw the moment Phase 1 shipped — every migrated row satisfies that condition. Breaking migration by construction.

**Options considered:**
- **(a) Original approach:** zero-rate rows, throw on zero. Breaking migration.
- **(b) Legacy-placeholder boolean flag:** add `legacyPlaceholder` column, migration sets `true`, calculator treats placeholder rows as zero-charge without throwing. Phase 2 sync clears the flag; Phase 6 surfaces remainders.

**Selected:** **Option (b)** (engineering override to the original §5.2 approach).

**Rationale:** A migration that throws on every live product's first decoration attempt is a Phase 1 launch bug by construction. The `legacyPlaceholder` flag is a one-boolean-column addition that cleanly expresses "this row is a historical marker, not a real rate." Phase 2 supplier sync has a precise condition to clear (flag → false, rate → real value); Phase 6 cleanup sweep has a precise condition to surface to distributors.

**Implications:** `productDecorationRates.legacyPlaceholder` `boolean NOT NULL DEFAULT false`. Calculator: placeholder rows contribute 0 to both sums without throwing. Migration (§5.2 rewrite) sets flag to true on insert. Phase 2 and Phase 6 enumerate and resolve. Design doc §3.2 column doc, §5.2 rewrite, §4.3 calculator step 2 note.

### 2026-04-21 — Decision 12 (I): Estimate-from-proposal tier bug logged for Phase 6

**Context:** Phase 0 Task 2 audit discovered `server/routers/estimatesInvoices.ts:316` creates estimates using `pp.unitPrice ?? prod?.basePrice`, with no call to `proposalPriceTiers`. Customers see tier pricing on the proposal view; when the proposal is accepted and converted to an estimate, the estimate uses flat `unitPrice`. This is a production billing bug — invoices may have shipped at the wrong price.

**Options considered:**
- Fix inline in Phase 1 (Phase 1 cutover to `calculatePrice` fixes this by construction; zero extra work).
- Log as a Phase 6 follow-up bug and separately consider customer-communication/invoice-correction depending on real-world impact.

**Selected:** **Log as a Phase 6 bug** in the "Bugs Discovered Mid-Phase" table; Phase 1 cutover fixes the code path; Phase 6 reviews customer-facing impact.

**Rationale:** The code fix is automatic once Phase 1 ships. The open question is whether historical invoices are incorrect — that's a financial/customer issue, not a code issue, and must be handled separately by Yan on a schedule that doesn't block Phase 1. Phase 6 is the right home for the customer-facing resolution plan.

**Implications:** Entry added to "Bugs Discovered Mid-Phase" below (severity "potential billing error," file `server/routers/estimatesInvoices.ts:316`, target Phase 6). Design doc §6.10 LOGGED banner.

### 2026-04-21 — Decision 13 (Task 3 §6.5): Ratify Task 2 §7.1 schema drift — decimal columns for position and dimensions

**Context:** Task 2 §7.1 specified `positionPct` and `maxDimensionsInches` as `json` columns on `productImprintZones`. Task 3 §1.4 proposed four top-level `decimal(5,2)` columns (`positionXPct`, `positionYPct`, `maxWidthInches`, `maxHeightInches`) instead. The drift was flagged as §6.5 for ratification because it changes the Task 2 loader's query shape and the agent-tool JSON Schema.

**Options considered:**
- **(a) Ratify the decimal-column design.** Queryable in SQL, type-safe in Drizzle, expressible as strict JSON Schema on the agent tool. Requires Task 2 §4.4 / Section 5 loader and tool schema to use decimal types during Phase 1 implementation.
- **(b) Hold the Task 2 §7.1 JSON shape.** Saves column count; costs indexability (MySQL JSON filters don't index well), loses fail-loud DB-level validation, and forces looser agent-tool schema.

**Selected:** **Option (a)** (ratify decimal columns).

**Rationale:** Phase 4 curation UX needs indexed queries like "zones wider than 3 inches." PromoStandards returns `ImprintSize.Width` / `Height` as separate numeric fields — the decimal shape is a 1:1 map. Agent-tool schemas benefit from strict per-field `{type: "number", minimum: 0, maximum: 100}` vs a single loose JSON blob. The drift was a design improvement, not a miss.

**Implications:** `productImprintZones` carries four top-level decimals (position nullable; dimensions NOT NULL). Task 3 §1.4 and §6.5 carry RESOLVED banners pointing here. Phase 1 implementation of `server/pricing/loader.ts` and the `pricing.calculate` agent-tool JSON Schema must use decimal types — logged as Task 3 §7.5 item 14 so it isn't lost between Phase 0 close and Phase 1 kickoff.

### 2026-04-21 — Decision 14 (Task 3 §6.1): Category-to-virtual-zone fallback lives in code constants

**Context:** Task 3 §3's fallback chain needs a category → virtual-zone map for products that lack any `productImprintZones` row. Choice is between a code-driven constants file and a DB table.

**Options considered:**
- **(a) Code constants** at `server/pricing/categoryDefaultZones.ts`. Ships via PR review; deterministic across environments; compile-time safe; no orgScope concern.
- **(b) DB table.** Distributor-editable via Phase 4 UX; adds a migration layer if the fallback schema changes; introduces an orgScope question (shared vs per-org defaults) without a current consumer.

**Selected:** **Option (a)** (code constants).

**Rationale:** No distributor today has asked to customize category defaults. The fallback is an observational safety net, not a tenant-configurable policy — YAGNI rules out the table until a real consumer appears. Phase 4 or Phase 6 can revisit.

**Implications:** Phase 2 ships `server/pricing/categoryDefaultZones.ts` with initial coverage: `apparel_polo`, `apparel_tshirt`, `apparel_hoodie`, `drinkware_mug`, `drinkware_bottle`, `cap`, `bag_tote`, `bag_backpack`, `notebook`, `pen`, `banner`. Map shape: `{ [category]: { zoneKey, zoneLabel, positionXPct, positionYPct, maxWidthInches, maxHeightInches, supportedDecorationMethods[] } }`. Final shape drafted in Phase 2 with Yan review. Task 3 §3 and §6.1 RESOLVED.

### 2026-04-21 — Decision 15 (Task 3 §6.4): Add `minWidthInches` / `minHeightInches` nullable columns to `productImprintZones`

**Context:** Some decoration methods fail below a minimum logo size (embroidery under 1.5" is illegible; small-gauge screen print has registration problems). Task 3 §6.4 asked whether to ship minimum-dimension columns in Phase 2 or defer.

**Options considered:**
- **(a) Ship without min dimensions.** Smaller table; add later if Phase 4 UX proves the need.
- **(b) Add `minWidthInches` / `minHeightInches` nullable `decimal(5,2)` columns now.** Trivial cost; avoids a Phase 4 migration.

**Selected:** **Option (b)** (add min dimensions now).

**Rationale:** Yan is an apparel distributor; embroidery under 1.5" is industry-known bad output. Catching this at curation time (Phase 4 UX warns when a logo renders below the minimum) prevents customer complaints later. Two nullable decimal columns cost essentially nothing — NULL means "no minimum," so apparel zones set 1.5" while full-back prints leave NULL.

**Implications:** `productImprintZones.minWidthInches` and `minHeightInches` added as nullable `decimal(5,2)` (Task 3 §2.1). Phase 4 curation UX surfaces a warning when `logoRenderedWidth < zone.minWidthInches` or `logoRenderedHeight < zone.minHeightInches`. `productImprintZones` column count rises from 17 to 19. Task 3 §6.4 RESOLVED.

### 2026-04-21 — Decision 16 (Task 3 §2.2): Zone-name normalization map lives in code

**Context:** Suppliers use inconsistent vocabulary for the same physical zone ("LC", "Left Chest", "Chest Left"). Task 3 §2.2 proposed an in-code normalizer at `server/pricing/zoneNormalization.ts` with a starter table of 22 canonical zones and ~80 aliases. Yan formalized the recommendation as a locked decision.

**Options considered:**
- **(a) In-code normalizer** (`server/pricing/zoneNormalization.ts`): `Record<alias, { zoneKey, zoneLabel, bodyPart, orientation }>`. Fast, deterministic, versioned with code, compile-time safe.
- **(b) DB table `productImprintZoneAliases`.** Runtime-editable; adds read overhead, cross-environment staleness risk, and no compile-time guarantee.

**Selected:** **Option (a)** (in-code map).

**Rationale:** Cardinality is small (~50–100 canonical zones cover the promo + print universe) and the vocabulary is platform-wide, not per-tenant. The normalizer must be deterministic at both ingest time and agent-tool invocation time; an in-code map is trivially reproducible. Distributor-custom aliases can land as a future additive column (`productImprintZones.customAliases: json`) without compromising the core normalizer.

**Implications:** Phase 2 ships `server/pricing/zoneNormalization.ts` with 22 canonical zones and ~80 aliases as drafted in Task 3 §2.2. Unknown supplier labels fall through (`zoneKey = slugify(label)`) and can be reconciled via Phase 4 UX or by adding the alias in a later PR. Task 3 §2.2 CONFIRMED banner added.

### 2026-04-21 — Decision 17 (Task 3 §6.6): `isPrimary` enforcement — application-level + Phase 6 cleanup sweep

**Context:** `productImprintZones.isPrimary` boolean permits multiple rows per product to be primary simultaneously, which would be semantically broken. Task 3 §6.6 weighed application-level enforcement, DB partial unique index (not directly supported on MySQL), and DB trigger.

**Options considered:**
- **(a) Application-level** in `zones.create` / `zones.update`: when `isPrimary = true` is written, the same transaction flips all other zones for that `productId` to `isPrimary = false`. Phase 6 cleanup sweep detects products with 0 or 2+ primary zones.
- **(b) DB partial unique index.** MySQL lacks direct support; emulation via generated columns is awkward and DB-specific.
- **(c) DB trigger** on INSERT/UPDATE demoting other primaries. Hidden side effect complicates debugging.

**Selected:** **Option (a)** (application-level + Phase 6 sweep).

**Rationale:** Keeps the schema portable across MySQL versions and database engines; avoids DB-specific SQL. The primary write path owns the invariant cleanly; Phase 6 sweep is a low-cost safety net matching the established `legacyPlaceholder` reconciliation pattern (Task 2 §3.2).

**Implications:** `zones.create` / `zones.update` enforce the invariant inside a single transaction. Supplier sync / migration paths that insert multiple zones at once must coordinate primary flags. Phase 6 cleanup sweep gains a new report: products with 0 or ≥2 `isPrimary` zones. Task 3 §6.6 RESOLVED.

### 2026-04-21 — Decision 18 (Task 3 §6.7): Supplier method × zone compatibility — hardcoded table

**Context:** PromoStandards returns `DecorationMethodArray` at the `ProductPart` level, not the `Location` level. On ingest, Phase 3 must choose how to attribute methods to zones. Task 3 §6.7 weighed overclaim-and-prune, hardcoded compatibility filter, and empty-and-report.

**Options considered:**
- **(a) Overclaim and prune.** Copy all product-level methods to every zone; distributor prunes later. Implies nonsensical combos (embroidery on a drinkware wrap) until cleanup.
- **(b) Hardcoded compatibility table** at `server/pricing/methodZoneCompatibility.ts` mapping `bodyPart` → `Set<method>`. Filters the Cartesian join at parse time.
- **(c) Ingest empty and surface a Phase 6 report.** Maximally safe; minimally useful on ingest.

**Selected:** **Option (b)** (hardcoded compatibility).

**Rationale:** The knowledge is industry-stable (you cannot embroider a ceramic mug); the table is short enough to maintain by hand. Overclaim-and-prune creates phantom complexity for a rare edge case; empty-and-report defers value to Phase 6 for no benefit.

**Implications:** Phase 2 ships `server/pricing/methodZoneCompatibility.ts` with initial mappings: `"chest"` → `{embroidery, screen_print, heat_transfer, dtg}`; `"cap_front"` → `{embroidery, laser_engraving}`; `"drinkware_wrap"` → `{laser_engraving, screen_print, sublimation}`; etc. Supplier ingest filters the Cartesian join through this table; `zones.create` / `zones.update` validators also use it. Task 3 §4.1 and §6.7 RESOLVED.

### 2026-04-21 — Decision 19 (Task 3 §6.8): Supplier zone updates — source-gated overwrite

**Context:** Phase 3 re-syncs supplier data periodically. Suppliers occasionally refine zone dimensions or rename locations. Overwriting silently may clobber distributor customizations; full versioning adds complexity. Task 3 §6.8 weighed source-gated overwrite, sibling history table, and never-overwrite.

**Options considered:**
- **(a) Source-gated overwrite.** Rows with `source = "supplier_api"` can be overwritten on re-sync; `source = "manual"` / `"csv_import"` rows are protected; conflicts emit a distributor-dashboard notification.
- **(b) Sibling `productImprintZonesSupplierOriginal` history table.** Stores supplier-provided values verbatim; current row is the distributor's edited view. Heavy; solves a problem no one has reported.
- **(c) Never-overwrite diff report.** Every supplier change routes through distributor review. Perpetual pending-review backlog.

**Selected:** **Option (a)** (source-gated overwrite).

**Rationale:** Matches the `source`-gated pattern already established in Task 2 §3.2 for `productDecorationRates`. Distributor edits are sticky by construction (writing via `zones.update` sets `source = "manual"`). Protects distributor intent without creating per-row versioning surface area.

**Implications:** Phase 2 supplier adapter shims encode the source-gated rule. Conflict notifications surface on the distributor dashboard: _"Supplier reports '<zoneKey>' zone has new dimensions; your manual configuration is unchanged — review and reconcile if needed."_ No new tables. Task 3 §4.4 (new subsection) and §6.8 RESOLVED.

### 2026-04-21 — Decision 20 (Task 3 §6.9): Legacy `virtualProofs.decorationZone` — normalizer translates to FK on migration

**Context:** The retirement plan (Task 3 §7.2) drops `virtualProofs.decorationZone` (free-text `varchar(64)`). Historical proof rows hold strings like "front", "left_sleeve", etc. Task 3 §6.9 weighed translate-and-store-FK, archive-and-drop, and parallel-path-through-Phase-6.

**Options considered:**
- **(a) Normalizer translates to FK on migration.** Phase 2 migration runs `zoneNormalization.ts` against every non-null string; matches become `virtualProofs.imprintZoneId` FK values; non-matches are logged to a migration-report file for manual review; `decorationZone` column dropped after report is reviewed.
- **(b) Archive to one-time audit table, drop column.** Cleaner migration; loses live linkage — historical PO/proof displays no longer resolve zone labels.
- **(c) Keep both columns in parallel, retire in Phase 6.** Violates Principle #3 (no parallel paths).

**Selected:** **Option (a)** (normalize + FK).

**Rationale:** Preserves existing proof data with FK integrity. The normalizer handles common cases (`"front"`, `"left sleeve"`, etc.) automatically; unusual strings fall to the migration-report file for manual reconciliation. Clean cutover in the same Phase 2 PR satisfies Principles #2 and #3.

**Implications:** Phase 2 migration adds `virtualProofs.imprintZoneId int` FK → `productImprintZones.id`, runs the normalizer across `virtualProofs.decorationZone`, writes resolved FKs, emits a migration-report file for unresolved rows, then drops `virtualProofs.decorationZone`. Downstream consumers (`server/utils/generatePOsForOrder.ts:245,255,281`; `client/src/pages/public-proposal/ProductDetail.tsx:155`; `publicProposalTypes.ts:37`) migrate to read `virtualProofs.imprintZoneId` joined to `productImprintZones.zoneLabel`. Task 3 §6.9 RESOLVED.

### 2026-04-21 — Decision 21 (Task 3 §6.3): Legacy `legacyPlaceholder` decoration rates — left unzoned at Phase 2 migration

**Context:** Task 2 §5.2 migration creates `productDecorationRates` rows with `legacyPlaceholder = true` from `products.decorationMethods`. Those rows have `imprintZoneId = NULL`. Task 3 §6.3 asked whether Phase 2 should auto-link them to each product's primary zone.

**Options considered:**
- **(a) Leave unzoned.** `legacyPlaceholder` rows keep `imprintZoneId = NULL` through Phase 2; Phase 6 cleanup sweep surfaces them alongside other placeholder reports.
- **(b) Auto-link to primary zone on Phase 2 zone insertion.** Convenience; risks silent wrong-association when a product has multiple zones at different rates.

**Selected:** **Option (a)** (leave unzoned).

**Rationale:** The `legacyPlaceholder` flag is explicitly a historical marker — "there was a decoration method here, but no real rate yet." Auto-inferring a zone defeats the "surface for distributor to resolve" design of Task 2 Decision 11 (H). Forcing intentional distributor cleanup is safer than silent guessed links that would ship wrong rates at checkout.

**Implications:** Phase 2 does not touch `legacyPlaceholder` rows' zone linkage. Phase 6 cleanup sweep surfaces `productDecorationRates WHERE legacyPlaceholder = true AND imprintZoneId IS NULL` — same report that identifies placeholder rates needing real values. Task 3 §6.3 RESOLVED.

### 2026-04-21 — Decision 22 (Task 3 §6.2): Orphan decoration-rate discovery — Phase 6 cleanup report

**Context:** `productDecorationRates.imprintZoneId` uses `onDelete: "set null"` (Task 2 preference adopted in Task 3 §2.1). When a distributor deletes a zone, any `productDecorationRates` row pointing at it has its FK set to NULL — the rate row survives but becomes disconnected. Task 3 §6.2 asked whether to surface these orphans via a Phase 6 cleanup sweep or a transactional audit log.

**Options considered:**
- **(a) Phase 6 cleanup sweep.** Query `productDecorationRates` rows in an orphan state and surface to the distributor alongside other cleanup reports. Lightweight; reuses the established mechanism.
- **(b) Transactional audit-log table.** Every `set-null` cascade writes a `zoneDeletionOrphan` audit row; Phase 6 reads it. Heavier; same UX outcome.

**Selected:** **Option (a)** (Phase 6 cleanup sweep).

**Rationale:** Matches the established Task 2 §3.2 `legacyPlaceholder` pattern — non-blocking runtime behavior surfaced for distributor reconciliation through an existing mechanism. Audit-log table adds schema surface without business value; the reconciliation path is identical either way.

**Implications:** Phase 6 cleanup sweep extended to surface `productDecorationRates` rows orphaned by zone deletion alongside the existing `legacyPlaceholder` and multi/zero-primary reports. No new table. Task 3 §6.2 and §7.5 reference this behavior. Non-blocking at runtime.

### 2026-04-21 — Decision 27 (Task 4 §9.1): Queue infrastructure — Redis + BullMQ on AWS ElastiCache

**Context:** Task 4 §3.4 identified three candidates for the async-tool queue backbone: DB-backed polling, BullMQ + Redis, or AWS SQS. The original recommendation was DB-backed polling (no new dependency, matches existing `setInterval` pattern). Yan overrides in favor of DD-grade queue infrastructure from Phase 1.

**Options considered:**
- **(a) DB-backed polling.** Worker on `setInterval` claims pending `agentJobs` rows. No new dependency; low ceiling on throughput; reinvents retry-with-backoff and DLQ.
- **(b) Redis + BullMQ.** BullMQ provides retries, backoff, DLQ, delayed jobs, cron primitives, and a dashboard. Requires provisioning managed Redis (AWS ElastiCache) and adding the `bullmq` npm dependency.
- **(c) AWS SQS.** Managed, decoupled from DB, battle-tested. Cross-service latency; IAM overhead; per-message cost model.

**Selected:** **Option (b)** (Redis + BullMQ on AWS ElastiCache).

**Rationale:** Cost is trivial (~$300/year for `cache.t4g.small`) vs the operational benefits of having retry-with-backoff, DLQ, and queue observability from day one. Every subsequent async workload (supplier sync Phase 3, bulk imports Phase 4, Phase 8 agents) shares one queue subsystem — no second migration ever. The DB-backed path would need to grow those primitives later; the BullMQ dashboard is DD-grade operational visibility that DB-polling does not produce. Overrides Task 4 §3.4's original recommendation.

**Implications:**
- New monthly infrastructure cost: **≈ $25/month AWS ElastiCache Redis** (`cache.t4g.small`, same-VPC as EC2 app, ≥2 AZ replication to avoid async-tool halt on primary failure).
- New npm dependencies: **`bullmq`** (queue primitives, retries, DLQ, scheduling). `ioredis` already present at `^5.10.1` as BullMQ's Redis client.
- Phase 1 infra checklist item: provision ElastiCache, wire `REDIS_URL` env var through `validateEnv.ts`, migrate existing Redis consumers (`rateLimiter`, `pkceStore`, `tokenBlocklist`) off REDIS_URL-optional behavior onto the managed instance.
- `agentJobs` table remains the durable catalog-of-record (for audit, retention, approval linkage); BullMQ holds execution-state queue. Split preserves "one source of truth for audit" while delegating orchestration to BullMQ.
- BullMQ dashboard (Arena / Bull Board) becomes a protected internal tool in Phase 8: ops-only access, behind admin auth, orgScope-filtered view.
- Risk: ElastiCache primary failure halts async tool execution (jobs pile up as `pending` in `agentJobs`). Mitigation: multi-AZ replication (required), BullMQ worker reconnection logic, Phase 6 monitoring alert on backlog depth.

### 2026-04-21 — Decision 28 (Task 4 §9.2): Audit log full-input retention — per-tool opt-in via sidecar table

**Context:** Task 4 §5.1 stores only an `inputHash` in `agentAuditLog` by default — enough to answer "did this invocation happen, by whom, when, to what target" without creating a second PII store. But forensic reproduction (replay a pricing calculation for a six-month-old billing dispute) needs the full input. Task 4 §9.2 weighed per-tool opt-in vs org-wide policy knob.

**Options considered:**
- **(a) Hash-only everywhere.** Simplest; loses forensic reproduction.
- **(b) Per-tool `auditRetainFullInput: true` opt-in.** Tool authors explicitly decide; default stays lean.
- **(c) Org-wide policy knob.** Admin toggles full retention for the whole org; no per-tool granularity.

**Selected:** **Option (b)** (per-tool opt-in).

**Rationale:** Tools that benefit from forensic reproduction are a small set (pricing calculations, approval-required writes). Per-tool opt-in keeps the audit path lean for the 95% case, makes the opt-in visible at code review, and forces the tool author to articulate the reason in a code comment. Org-wide policy creates a default-everything-retained incentive that bloats the table and the compliance surface.

**Implications:**
- `AgentTool` interface gains `auditRetainFullInput?: boolean` (default false).
- New sidecar table **`agentAuditLogInputs`** (Task 4 §5.1.1) with `auditLogId` FK → `agentAuditLog.id` onDelete cascade, `inputPayload: json`, 90-day retention via daily sweep.
- Main `agentAuditLog` retains 18 months; the sidecar rolls off earlier so PII-bearing payloads have a tighter window.
- Tool opt-in comment convention: leading code comment on the `AgentTool` declaration explaining the retention rationale (e.g., "pricing.calculate: retained 90 days for billing-dispute reconciliation").
- Revisit at Phase 8 close: if >25% of tools opt in, consider an org-wide policy knob instead.

### 2026-04-21 — Decision 29 (Task 4 §9.3): MCP authentication — scoped tokens (read / write)

**Context:** Task 4 §6.2 identified three candidates for MCP token authentication: bearer (full access within org), read/write scopes, or per-tool fine-grained scopes.

**Options considered:**
- **(a) Bearer token.** Simple; over-privileged for third-party read-only integrations.
- **(b) `scope ∈ {"read", "write"}`.** Read scope restricted to `readOnly: true` AND `riskTier: "autonomous"` tools; write scope permits any tool the org allows (subject to normal tier gates).
- **(c) Per-tool scopes.** Granular; operationally heavier; premature until customer demand surfaces.

**Selected:** **Option (b)** (read/write scopes).

**Rationale:** Third-party integrations most often want read-only access (dashboards, exports, monitoring). Full bearer is over-privileged for that use case. Per-tool scopes are more granular than current demand justifies. A two-value scope enum covers the concrete needs with minimal surface area and is extensible (more scopes can be added without reshaping the concept).

**Implications:**
- `AgentTool` interface gains `readOnly?: boolean` (default false — conservative). Startup validation requires `readOnly: true` tools to have `riskTier: "autonomous"` (`InvalidReadOnlyTier` throws otherwise).
- New table `externalApiTokens` (flagged for Phase 8) with columns: `id, orgId, tokenHash, scope enum("read","write"), label, expiresAt, createdBy, createdAt, lastUsedAt, revokedAt`.
- MCP adapter consults `scope` on every `tools/call` request; read-scope callers invoking a non-readOnly tool receive `AccessDenied`.
- Per-tool fine-grained scopes deferred; revisit if customer demand surfaces.

### 2026-04-21 — Decision 30 (Task 4 §9.4): MCP rate limiting — both per-token and per-org via existing rateLimiter.ts

**Context:** Task 4 §6.2 flagged MCP rate-limit strategy as an open question. Candidates were per-token, per-org, or both.

**Options considered:**
- **(a) Per-token only.** DoS guard against a misbehaving integration; does not cap total-org pressure from multiple legitimate tokens.
- **(b) Per-org only.** Caps total pressure; a single misbehaving token can exhaust the org's budget.
- **(c) Both — per-token AND per-org.** Two independent enforcement tiers.

**Selected:** **Option (c)** (both tiers).

**Rationale:** Per-token catches the single-integration DoS; per-org catches the cumulative load. Neither alone is sufficient. The existing `server/utils/rateLimiter.ts` is Redis-backed and already supports keyed limits — consolidates on the same ElastiCache instance from Decision 27. No new library.

**Implications:**
- Phase 1 defaults: **60 requests/minute per token**, **300 requests/minute per org**.
- Per-org ceiling admin-configurable through Phase 8 UI; per-token default fixed (rare to need per-token tuning).
- Both tiers enforced inside the MCP adapter before the executor runs; a 429 on either tier short-circuits execution.
- Rate-limit metrics surface in the Phase 8 BullMQ / audit dashboard for visibility.

### 2026-04-21 — Decision 31 (Task 4 §9.5): Agent identifier schema — free-form varchar(64) + CI lint against constants file

**Context:** `agentId` appears across `agentJobs`, `agentApprovalRequests`, `agentMemory`, and `agentAuditLog`. Choice: DB-level enum (requires migration per new agent) vs free-form varchar (flexible, relies on lint).

**Options considered:**
- **(a) DB enum.** Type-safe at the DB; every new agent requires a migration.
- **(b) Free-form `varchar(64)` + CI lint.** Schema-flexible; lint at `server/agents/agentIdentifiers.ts` constants file enforces agent-ID set in code review.

**Selected:** **Option (b)** (varchar + lint).

**Rationale:** Phase 8 will iterate on agent identities during evaluation — DB migrations per iteration are friction. Lint-level enforcement is sufficient; typos fail CI, not production. The constants file is the single source of truth for the agent-ID set and is easy to review.

**Implications:**
- `agentId` declared as `varchar("agentId", { length: 64 })` across all agent-related tables.
- Phase 8 ships `server/agents/agentIdentifiers.ts` with `export const AGENT_IDS = { CATALOG_CHANGE: "catalog-change", ... } as const;`.
- CI lint (Phase 8 extends Task 6's regression harness) enforces every `agentId` literal matches an `AGENT_IDS` value.

### 2026-04-21 — Decision 32 (Task 4 §9.6): Conversation transcripts — deferred entirely to Phase 8

**Context:** Task 4 §7 stubbed the conversation framework. Open question asked where transcripts live: `agentConversations` table (JSON blobs), per-turn rows table, or a vector DB.

**Options considered:**
- **(a) Commit to a transcript schema in Task 4.** Premature — requires decisions about multimodal content, token-cost accounting, and UX surfacing that belong with specific agents.
- **(b) Defer entirely to Phase 8.** Task 4 commits only to the ID shape (`(orgId, tenantContextKey, conversationId)`) and that transcripts are separate from memory; Phase 8 ships `agentConversations` / `agentMessages` tables, retention, and UI when the four agents' requirements are known.

**Selected:** **Option (b)** (defer to Phase 8).

**Rationale:** Transcript design is tightly coupled to the specific agents Phase 8 ships. Committing to a schema in Phase 0 risks over-fitting to assumptions the agents may revise. Task 4's infrastructure contract is satisfied by the ID convention alone — tool invocations carry `conversationId`, audit/jobs/approvals reference it, Phase 8 reconstructs per-conversation timelines from Task 4 tables + the new transcript tables.

**Implications:**
- Task 4 §7 marked DEFERRED; no conversation-related tables in Task 4 schema.
- Phase 8 scope explicitly includes the conversation framework design as its own deliverable.
- `conversationId: varchar(128)` fields are present on `agentJobs`, `agentApprovalRequests`, `agentAuditLog`, `agentMemory.sourceConversationId` — enough for Phase 8 to link back.

### 2026-04-21 — Decision 33 (Task 4 §9.7): Approval expiry — per-tool configurable with 7-day hard max

**Context:** `agentApprovalRequests` originally hard-coded a 24h expiry. Task 4 §9.7 asked whether this should be distributor-configurable, per-tool, or both.

**Options considered:**
- **(a) Fixed 24h.** Simple; forces long-running approvals (bulk imports) to re-propose.
- **(b) Per-tool `approvalExpiryMs` default.** Tool author picks based on nature (fast for "send this proposal"; longer for "run this bulk catalog import"). Enforce a hard ceiling to prevent unbounded approvals.
- **(c) Distributor-configurable.** Adds UI surface area; no demonstrated demand.

**Selected:** **Option (b)** (per-tool, 7-day hard max).

**Rationale:** Approval TTL is a tool-shape concern (matches the action's urgency) more than an org-shape concern. A hard ceiling prevents a future tool author from declaring a year-long approval window and letting stale proposals sit indefinitely. Seven days is long enough for legitimate bulk-work approvals while short enough to be a reasonable ceiling.

**Implications:**
- `AgentTool` interface gains `approvalExpiryMs?: number` (default 86_400_000 = 24h; hard max 604_800_000 = 7 days).
- `registry.register()` throws `InvalidApprovalExpiry` at startup if a tool declares `approvalExpiryMs > 7 days`.
- Expired `agentApprovalRequests` rows auto-transition to `status = "expired"` via the daily cleanup sweep; the sweep is part of §4.3 retention infrastructure.
- No distributor-level override in Phase 8 — add later if concrete demand surfaces.

### 2026-04-21 — Decision 34 (Task 4 §9.8): Risk tier is static per tool

**Context:** Task 4 §9.8 asked whether a tool's effective `riskTier` could vary by input shape (e.g., `products.update` = logged for metadata edits, approval_required for price edits).

**Options considered:**
- **(a) Dynamic tiering** via a `evaluateRiskTier(input)` callback on the tool. More expressive.
- **(b) Static tier.** One tier per tool, declared at registration, immutable at runtime. Tools that need different behaviors by input split (e.g., `products.updateMetadata` vs `products.updatePricing`).

**Selected:** **Option (b)** (static).

**Rationale:** Dynamic tiering introduces a "why did this execute without approval?" class of bug that is expensive to diagnose — audit has to replay the input through the `evaluateRiskTier` callback to explain the outcome. Static tiers produce clean audit trails and predictable agent behavior (the agent knows at tool-declaration inspection whether an invocation will execute immediately or require approval). Splitting tools by tier is more verbose but more legible.

**Implications:**
- `AgentTool.riskTier` is declared at registration; executor has no code path to change it.
- When different behaviors are required for different inputs, implementations split (`products.updateMetadata` = logged; `products.updatePricing` = approval_required). Documented convention in Task 4 §3.3.

### 2026-04-21 — Decision 35 (Task 4 §9.9): Approval resumption — human-initiated only; no agent polling

**Context:** When a tool returns `ApprovalRequiredResponse`, should the agent be allowed to poll approval status and auto-resume, or should resumption require human action?

**Options considered:**
- **(a) Agent polls** via a `approvals.status({ requestId })` tool and auto-resumes on approval. More automated; burns agent tokens while waiting.
- **(b) Human-initiated resumption** via a `toolApprovalResolved` event. Agent pauses; user approves; event fires and triggers the next agent turn with the resolution as `tool_result`.

**Selected:** **Option (b)** (human-initiated).

**Rationale:** Agent polling burns tokens with no user-visible benefit — the user's action is always the gating event. Event-driven resumption produces a cleaner mental model ("the agent proposed; I approved; the agent continued") and avoids the "my agent stalled in a polling loop" failure mode. If approval expires without action, no resumption event fires; the agent's next user-initiated turn sees the expired approval (surfaced by the Phase 8 conversation framework) and decides whether to retry or move on per its prompt.

**Implications:**
- System emits a `toolApprovalResolved` event when `approvals.decide` transitions a row to `approved` or `rejected`.
- Agent's next conversation turn is triggered with the approval resolution surfaced as synthetic `tool_result`.
- No agent-side polling tool for approval status.
- Phase 8 conversation framework (deferred per Decision 32) designs the event-delivery mechanism.

### 2026-04-21 — Decision 36 (Task 4 §9.10): Memory value size cap — reject at 16 KB; blob storage deferred

**Context:** Task 4 §4.2 proposed a soft 16 KB cap on `agentMemory.memoryValue`. Open question: reject at the cap or truncate with warning.

**Options considered:**
- **(a) Reject at 16 KB** with `ValueTooLarge` error. Agents that need larger storage use a content-addressed blob store (S3) and remember only the key.
- **(b) Truncate with warning.** Preserves write success; silently corrupts agent mental models.

**Selected:** **Option (a)** (reject; defer blob storage to Phase 8).

**Rationale:** Unbounded memory writes bloat the table and cost real storage over time; silent truncation is worse than a fail-loud rejection because it corrupts the agent's future recalls without warning. Agents needing to store large artifacts (generated proposals, embeddings, structured documents) belong on a separate `agentBlobStorage` subsystem — designed in Phase 8 when a concrete need surfaces.

**Implications:**
- `memory.remember` handler validates serialized size before insert; rejects >16 KB with `ValueTooLarge`.
- New `agentBlobStorage` subsystem flagged for Phase 8 design (S3-backed, content-addressed).
- `agentMemory` table stays narrow and fast — the hot path (recall by key) doesn't pay for occasional large payloads.

### 2026-04-22 — Decision 37 (Task 5): Multi-department approval — promoted to IN SCOPE as first-class feature

**Context:** Multi-department approval architecture was flagged "Conditional" in `protected-subsystems.md` pending Task 5 resolution. Prospect sales conversations have surfaced firm commitments — "we'd sign when this ships" — tied to this feature. No existing MergeTasks distributor uses it in production today, so there is no incumbent implementation to protect. Task 5 resolves the conditional flag.

**Options considered:**
- **(a) Keep Protected.** Do not touch; ship without. Loses revenue-critical prospect commitments.
- **(b) Complete what's partially built.** Finish gaps of the legacy partial implementation; ship minimal v1. Accepts tech debt by construction and underdelivers against enterprise-prospect expectations.
- **(c) Build as first-class feature.** Full UX, pricing integration, approval chains, department budgets, regression coverage. Woven throughout Phases 1–8.

**Selected:** **Option (c)** (first-class feature).

**Rationale:** Revenue-critical prospect commitments justify the scope expansion. "We'd sign when this ships" converts the feature from speculative to load-bearing for the business case. Shipping a minimal version would fail to convert those commitments into revenue and would accumulate rework debt. Principle #1 (zero tech debt at end of build) and Principle #7 (Apple-for-enterprise UX) both require the first-class treatment.

**Implications:**
- `PricingContext` gains `departmentId` as a **first-class** (not reserved) field in Phase 1 — Task 2 §6.8's reserved-placeholder language is superseded by this decision.
- New Phase 1 tables: `departments` (or an extension of existing org-scoped structure), `departmentBudgets`, `approvalChains`, `approvalRequests`. Schema-design details deferred to Phase 1 opening.
- Phase 1 pricing engine integrates `departmentId` as a dimension for pricing calculations.
- Phase 4 curation UX expands: approval-chain configuration UI; department-budget configuration UI.
- Phase 5 customer webstore expands: approval queue UI; department-membership management; customer-approver workflows.
- Phase 7 regression coverage includes full multi-department workflows end-to-end.
- Phase 8 agent tools gain approval-workflow actions (`approvals.list` / `.approve` / `.reject` — `approval_required` risk tier by default per Decision 26).
- Integration with the protected Resend notification pipeline for approval emails (consumed, not modified).
- Integration with the protected Stripe checkout path to hold payment until approval completes (consumed, not modified).
- Timeline impact: **~2–3 weeks added across affected phases**; ceiling revision recorded in Decision 40.
- See also: `protected-subsystems.md` "Resolved conditional items (historical)" entry dated 2026-04-22.

### 2026-04-22 — Decision 38 (Task 5): Multi-division webstores — promoted to IN SCOPE as first-class feature WITH per-division pricing

**Context:** Multi-division webstore feature was flagged "Conditional" in `protected-subsystems.md`. `storeProducts.divisionIds` already exists and division-scoped product visibility works today. Per-division pricing was proposed as "deferred" in Task 2 §6.9. Prospect sales commitments include multi-division with per-division pricing as part of the enterprise expectation.

**Options considered:**
- **(a) Keep Protected.** Do not touch.
- **(b) Limited scope.** Wire division visibility into Phase 4 curation UX only; no per-division pricing. Partial solution fails the enterprise-prospect pricing expectation.
- **(c) First-class with per-division pricing.** Full UX + pricing integration woven throughout Phases 1–8.

**Selected:** **Option (c)** (first-class with per-division pricing).

**Rationale:** Same revenue-critical justification as Decision 37. Enterprise prospects expect multi-division with division-specific pricing as table stakes — e.g., Unity Hospital ICU division at $X/unit vs ER division at $Y/unit on the same product due to negotiated department budgets. Shipping without per-division pricing would leave a known-prospect-blocking gap.

**Implications:**
- `PricingContext` gains `divisionId` as a **first-class** field in Phase 1 — Task 2 §6.9's reserved-placeholder language is superseded.
- New Phase 1 schema for per-division pricing: either a `storeProductOverrides` table OR `divisionId`-scoped variants of `storeProducts.customPrice` / `costOverrideCents` (implementation choice deferred to Phase 1 opening).
- Phase 1 pricing engine integrates `divisionId` as a dimension.
- Phase 4 curation UX: division-membership configuration, per-division pricing configuration, division-scoped catalog management.
- Phase 5 customer webstore: division-scoped catalog + division-scoped pricing visible to end users.
- Phase 7 regression coverage includes multi-division workflows end-to-end, including pricing variations.
- Phase 8 agent tools: `divisionId`-aware pricing calculations; division-scoped catalog queries.
- Timeline impact: **~1–2 weeks added across affected phases**; ceiling revision recorded in Decision 40.
- See also: `protected-subsystems.md` "Resolved conditional items (historical)" entry dated 2026-04-22.

### 2026-04-22 — Decision 39 (Task 5): Requirements basis for Decisions 37 and 38 — founder's current understanding; accepted risk

**Context:** At the time Decisions 37 and 38 were locked, prospect requirements were described by the founder as "rough idea, not pressure-tested." A formal discovery sprint (3–5 days of prospect calls) was discussed and declined. The founder chose to proceed from current understanding.

**Options considered:**
- **(a) Formal discovery sprint before scope lock.** 3–5 days of prospect calls; blocks Phase 1 open until complete.
- **(b) Parallel discovery during Phase 1.** Low-overhead — informal conversations run alongside implementation, informing Phase 4+ UX decisions.
- **(c) No formal discovery; build from current understanding.** Accepts the risk that features as designed may not match eventual prospect needs.

**Selected:** **Option (c)** (no formal discovery; accepted risk).

**Rationale:** Founder's strategic judgment. Committed prospects, willingness to extend the timeline (Decision 40), and confidence in current understanding override the risk of building features that may not fully match eventual prospect requirements. Discovery cost (time + distraction) is judged higher than post-launch rework cost given the commitment profile.

**Implications:**
- Features as designed may not exactly match eventual prospect needs; rework risk is **explicitly accepted**.
- If prospect requirements diverge from what ships, rebuild cost is budgeted to post-launch work — acceptable tradeoff given current commitments and the ceiling strategy.
- Due-diligence framing: the active design-partner relationship is a positive PMF signal for acquirer DD (live client co-developing the feature set during build), not a validation gap. Documented in the "Design-Partner Engagement" section below.
- This decision is reversible — if informal discovery during Phases 1–8 surfaces significant divergence, scope can adjust at phase boundaries.
- Phase 7 regression coverage remains standard (not elevated) since these are greenfield features with no existing production load.
- **Monitoring:** if any mid-rebuild discovery (informal sales conversations, prospect demos, acquirer questions) surfaces significant divergence from current design, it is logged in this file under "Bugs Discovered Mid-Phase" or "Architectural Decisions" (per nature) and triggers a scope review at the next phase boundary.

### 2026-04-22 — Decision 40 (Task 5): Rebuild ceiling revised — 2026-09-07

**Context:** Decisions 37 and 38 add 3–5 weeks of scope to the rebuild. The ceiling of 2026-07-27 (set when Phase 8 was added per Decision 3) is no longer achievable without compromising quality or dropping work.

**Options considered:**
- **(a) Hold the 2026-07-27 ceiling and cut scope.** Drops parts of Decisions 37/38. Fails the scope expansion's premise.
- **(b) Hold the ceiling and compromise quality.** Violates Principle #9 (hard gate criteria).
- **(c) Revise the ceiling to 2026-09-07.** ≈ 6 weeks later than the prior ceiling; provides buffer for the estimated 3–5 weeks of added scope plus absorption of normal estimation error.

**Selected:** **Option (c)** (revise ceiling to 2026-09-07).

**Rationale:** Principle #9 (hard gate criteria) takes precedence over calendar. Adding scope without extending the timeline is the precise way rebuilds accumulate technical debt. The extended ceiling is a ceiling, not a target — gate criteria still govern phase closure; if phases close faster, the rebuild finishes earlier.

**Implications:**
- Phase 1 estimated at 2.5–3 weeks (up from 2) to absorb `departmentId` / `divisionId` first-class schema work.
- Phase 4 estimated at 3 weeks (up from 2) for approval-chain + division configuration UX.
- Phase 5 estimated at 1.5 weeks (up from 1) for approval queue + division-member management.
- Phase 7 estimated at 1.5 weeks (up from 1) for expanded regression coverage.
- Phase 8 estimated at 3.5–4 weeks (up from 3–4) for additional agent tools.
- Phase Status table target-end-date estimates updated in this file (see "Phase Status" above).
- New overall timeline: Phase 0 finishes ~2026-04-27; Phase 8 completes **no later than 2026-09-07**.
- Ceiling history recorded in Overview section: 2026-07-06 → 2026-07-27 (Decision 3) → 2026-09-07 (this decision).

### 2026-04-22 — Decision 41 (Task 6 §9.1): Playwright added to CI starting Phase 1

**Context:** The Task 6 audit found Playwright installed (`@playwright/test ^1.59.1`) but not invoked by `.github/workflows/ci.yml`. End-to-end assertions for Journeys J1 / J6 / J8 / J9 / J10 / J11 only run when a developer manually invokes `npm run e2e` locally. Regression-protocol enforcement per Principle #10 requires automation at PR time, not at phase gate only.

**Options considered:**
- **(a) Add Playwright to CI in Phase 1.** New `e2e` job in `ci.yml`; ~2–4 minutes added per PR; PR merge blocks on e2e failure.
- **(b) Run Playwright only at phase gates.** Preserves per-PR speed; loses early regression signal.
- **(c) Defer Playwright in CI until Phase 8.** Longer delay in signal; more regressions slip between phase boundaries.

**Selected:** **Option (a)** (add in Phase 1).

**Rationale:** Signal recovered (catching e2e regressions at PR time, not at phase gate) is large; the marginal cost is ≤ 4 minutes per PR at current suite size. Enforcing at CI time aligns with Principle #9 (hard gates) by making the gate-evidence artifact produced continuously, not only at phase close.

**Implications:**
- New `e2e` job in `.github/workflows/ci.yml`: depends on `test`, reuses the MySQL 8.0 service container (per Decision 42), Node 20.20.2, Playwright install step, 10-minute timeout, artifact upload on failure.
- PRs cannot merge if Playwright tests fail (same policy as Vitest today).
- Phase 1 infrastructure work item: wire up the job and get initial baselines green before the pricing-engine cutover.

### 2026-04-22 — Decision 42 (Task 6 §9.2): Containerized MySQL 8.0 per CI job (not dedicated RDS)

**Context:** Task 6 §9.2 weighed whether the CI test DB should remain a MySQL 8.0 service container (existing `ci.yml:50-64` pattern) or migrate to a dedicated RDS test database.

**Options considered:**
- **(a) Containerized MySQL 8.0 per CI job.** Ephemeral, per-job isolation; ~15–20s boot per job; zero infrastructure cost.
- **(b) Dedicated shared RDS test DB.** Faster spin-up; persistent state; introduces parallel-run contention; adds cloud cost.

**Selected:** **Option (a)** (containerized).

**Rationale:** Per-job isolation is worth more than 15–20 seconds of startup. The containerized approach already works in CI and avoids shared-state contention between parallel jobs. Migrating to RDS is a Phase-8-plus consideration only if parallel CI-minute count starts mattering.

**Implications:**
- No change to the current `ci.yml:50-64` pattern.
- No new infrastructure cost.
- Decision 41's new `e2e` job reuses the same MySQL container already provisioned for the `test` job.

### 2026-04-22 — Decision 43 (Task 6 §9.3): Stripe payment leg — hybrid automation + manual checklist

**Context:** Task 6 §9.3 weighed whether Stripe sandbox payment automation (card entry, redirect, completion) should be built in Phase 1 or deferred, given that Stripe webhook automation requires sandbox setup, signature mocking, and deterministic event replay (estimated 3–5 additional days of Phase 1 scope).

**Options considered:**
- **(a) Full automation in Phase 1.** Automates end-to-end Stripe sandbox; largest scope addition.
- **(b) Hybrid: automated webhook logic + manual sandbox checklist.** Deterministic portions automated; real sandbox confirmation manual.
- **(c) Manual only.** Lowest cost; weakest regression signal.

**Selected:** **Option (b)** (hybrid).

**Rationale:** Deterministic logic (idempotency, signature verification, event dispatch) is the high-value portion to automate and is achievable in Phase 1. End-to-end Stripe sandbox confirmation (card entry, 3-D Secure redirect, completion) requires UI-automation infrastructure that is expensive relative to the signal it adds, and the existing `paymentStress.test.ts` already covers the checkout-path logic under load. A documented manual checklist is the minimum acceptable evidence for the Stripe leg.

**Implications:**
- **Automated (Phase 1):** Stripe webhook unit / integration tests covering `checkout.session.completed`, `invoice.paid`, `payment_intent.succeeded`, `charge.refunded` — using `stripe` CLI or signature mock to synthesize events. `server/stripe/webhook.ts` gains test coverage it does not have today.
- **Manual (Phase 1):** `docs/build-log/regression-manual-checklist.md` created with Stripe checkout checklist rows for both distributor-facing and customer-facing flows. Yan signs each row at each phase-gate manual walk-through.
- **Deferred:** full sandbox automation (UI flow + webhook replay at sandbox latency) — revisit when a paying-customer workflow justifies the investment.

### 2026-04-22 — Decision 44 (Task 6 §9.4): Critical user journeys expanded to 11 — J11 (PO/Invoice Generation) added

**Context:** Task 6 §9.4 considered whether the 10-journey regression set was complete. PO-based purchasing (distributor generates PO → customer receives PO → customer issues PO reference → invoice marks paid via PO reference, bypassing Stripe) is enterprise-B2B-specific and differs materially from the proposal → estimate → invoice → Stripe flow at J4. The design-partner client and the target market (hospitals, universities, government) rely on PO-based purchasing.

**Options considered:**
- **(a) Keep 10 journeys.** Accept that PO shape is implicitly covered through J4 and protected-subsystem #8 (PDF generation).
- **(b) Add J11 (PO/Invoice Generation) as an explicit 11th journey.** Dedicated regression coverage for the PO workflow; first-class audit of PO generation, PO email delivery, and mark-paid-via-PO path.

**Selected:** **Option (b)** (add J11).

**Rationale:** The Task 6 audit surfaced material gaps in the PO workflow — no dedicated PO email template (`server/routers/purchaseOrders.ts:483` explicitly flags "Email sending is coming soon"), no server-side PO PDF pipeline (`:488` — client-side only), no explicit mark-paid-via-PO procedure (`server/stripe/webhook.ts:490-614` assumes Stripe-paid). These gaps are invisible at J4's level of assertion and would surface as customer-impacting regressions during Phase 4's design-partner review. An explicit 11th journey forces Phase 4 to address these gaps with regression coverage.

**Implications:**
- Journey J11 added to `task-6-regression-audit.md` §9 with concrete `file:line` citations for `server/utils/generatePOsForOrder.ts:209` (entry point), `server/routers/purchaseOrders.ts` (full tRPC surface), `server/routers/copilotExecPurchaseOrders.ts` (agent interface), `drizzle/schema.ts:392` and `:1209` (payment-method columns).
- Per-phase regression matrix (`task-6-regression-protocol.md` §3.2) extended: J11 enters pass-required at **end of Phase 4** (distributor-side PO generation + manual PO email checklist); Phase 5 extends to the customer-side PO-reference close-out; Phase 8 re-verifies after `copilotExecPurchaseOrders` migrates onto the Task 4 registry.
- Phase 4 design-partner review scope explicitly includes the PO workflow.
- Integration test for PO generation + manual checklist for PO email delivery. Full PO email template and server-side PDF pipeline are not Phase 1 deliverables — they are surfaced here so Phase 4 can decide scope at phase open.

### 2026-04-22 — Decision 45 (Task 6 §9.5): `.env.test` committed with test-only values

**Context:** Task 6 §9.5 asked whether `.env.test` should be committed to the repo. Committing real secrets is a security incident; committing test-only values is standard practice and enables `pnpm test` locally to produce the same environment CI produces.

**Options considered:**
- **(a) Commit `.env.test` with test-only values.** Deterministic local/CI parity; explicit convention; no secret leak risk.
- **(b) Keep `.env.test` gitignored; require each developer to construct it from a template.** Preserves some developer autonomy; diverges local and CI environments.

**Selected:** **Option (a)** (commit test-only values).

**Rationale:** Determinism of the local test environment is more valuable than per-developer `.env.test` customization. Test-only keys (Stripe `sk_test_*`, publishable test keys, test DB creds that already exist in `ci.yml` in the clear, test Resend key or mock) are not secrets — they are constants that describe the test contract.

**Implications:**
- `.env.test` committed at repo root with test-only values: Stripe test keys (`sk_test_*`, publishable test keys), test DB credentials matching CI container setup, test Resend API key (or mock sentinel), test values for OAuth / Slack / QuickBooks / any other third-party integration.
- `.env`, `.env.local`, `.env.production` remain gitignored.
- `.gitignore` updated to explicitly NOT ignore `.env.test`.
- `README.md` at Phase 1 close documents the convention.
- Real secrets (prod DB URL, prod Stripe keys, prod Resend keys) remain exclusively in GitHub Actions secrets for CI — never in the repo.

### 2026-04-22 — Decision 46 (Task 6 §9.6): Design-partner session log is in-repo canonical

**Context:** Per Decision 39 engagement protocol, `/docs/build-log/design-partner-sessions.md` records client design-partner review sessions at Phases 4, 5, 8. Task 6 §9.6 asked whether this file lives in-repo (version-controlled with the build log) or externally (shared doc with the partner).

**Options considered:**
- **(a) In-repo canonical.** Session log is version-controlled alongside the build log. Yan exports or summarizes periodically to share with the client.
- **(b) External canonical.** Partner sees and edits directly; repo stores pointers or summaries only.
- **(c) Hybrid (in-repo canonical + continuous external export).** Both; requires sync tooling.

**Selected:** **Option (a)** (in-repo canonical).

**Rationale:** Matches the existing build-log philosophy (Decision 2 — every phase update lands in the build log). Keeps the session log reviewable alongside the code; keeps audit trail immutable; avoids sync tooling. Partner-facing artifacts (wireframes, decision summaries) are exported or summarized by Yan on demand.

**Implications:**
- `/docs/build-log/design-partner-sessions.md` is the authoritative source.
- Each session entry: date, topic, attendees, scope reviewed (journeys / surfaces), feedback gathered, decisions made, follow-ups (with target phase), partner sign-off status (validated / validated-with-follow-ups / not-validated).
- Phase 1 creates the file with an initial template (already flagged as a Phase 1 work item per Decision 39 engagement protocol).
- Yan exports or summarizes periodically to share with the client.

### 2026-04-22 — Decision 47 (Task 6 §9.7): No numeric code coverage threshold

**Context:** Task 6 §9.7 asked whether the regression protocol should add a numeric line-coverage threshold (e.g., 80% of touched lines covered).

**Options considered:**
- **(a) Numeric threshold** (e.g., 80% line coverage via Codecov or `vitest --coverage`).
- **(b) No numeric threshold.** Regression gate is the per-journey pass list.

**Selected:** **Option (b)** (no threshold).

**Rationale:** Line coverage is gameable and doesn't verify behavior — "tested the getter to bump the number" is a common failure mode. Journey-pass is stronger evidence that the rebuild hasn't regressed critical user flows. The touched-file audit (`task-6-regression-protocol.md` §3.1 item 5) surfaces files that changed without corresponding tests; reviewers challenge those in PR.

**Implications:**
- Regression gate is the per-journey pass list: **11 journeys** (J1–J11 per Decision 44).
- No 80% line-coverage requirement; no Codecov integration.
- Touched-file audit in the regression report (per §5 of the protocol doc) flags files changed without test coverage for reviewer attention.

## Intentional Compromises with Resolution Dates

_Every compromise entered here must have a concrete resolution date and a phase by which it will be retired. No open-ended TODOs._

| Date Logged | Compromise | Phase Introduced | Resolution Date | Phase That Resolves | Status |
|-------------|------------|------------------|-----------------|---------------------|--------|

## Bugs Discovered Mid-Phase

_Bugs found while building that are out-of-scope for the current phase. Either fix immediately or log with a ticket and target phase._

| Date | Phase When Found | Bug | Severity | Ticket | Target Phase / Fix Date | Status |
|------|------------------|-----|----------|--------|-------------------------|--------|
| 2026-04-20 | Phase 0 Task 2 audit | Estimate creation in `server/routers/estimatesInvoices.ts:316` reads `pp.unitPrice ?? prod?.basePrice` and never consults `proposalPriceTiers`. Customers see tier pricing on the proposal view; accepted estimates use flat unit price. Potential for invoices to have shipped at incorrect prices. See Decision 12 (I). | Potential billing error | — | Phase 1 cutover to `calculatePrice` fixes the code path by construction; Phase 6 reviews customer-facing impact (customer-communication / invoice-correction plan depending on audit of historical invoices) | Open (deferred to Phase 6) |

## Dead Code Deleted

_Per phase. Every PR that replaces code must delete what it replaces in the same PR. This log records what was removed so future reviewers can verify the "zero parallel paths" rule was honored._

### Phase 0
_None yet._

### Phase 1
_Pending._

### Phase 2
_Pending._

### Phase 3
_Pending._

### Phase 4
_Pending._

### Phase 5
_Pending._

### Phase 6
_Pending._

### Phase 7
_Pending._

### Phase 8
_Pending._

## Design-Partner Engagement

_How feature requirements for greenfield scope additions are developed and validated in partnership with a live MergeTasks client. Per-phase review cadence, session log location, and PMF-signal reasoning live here. This is methodology documentation, not risk documentation — an active design-partner relationship is a positive product-market-fit signal, not a risk mitigation._

| Date Logged | Feature requirements basis | Engagement Protocol | Decision Reference |
|-------------|---------------------------|---------------------|--------------------|
| 2026-04-22 | Multi-department (Decision 37) and multi-division (Decision 38) features are developed in partnership with a current MergeTasks client serving as design partner through Phases 4, 5, and 8. The partner's production usage grounds the requirements; full first-class feature treatment (per Decisions 37 and 38) delivers the outcomes the partner expects. | Design partner reviews wireframes and provides feedback at each phase review session (30–60 minutes per session) across Phases 4, 5, and 8. Review sessions are logged in `/docs/build-log/design-partner-sessions.md` (created as a Phase 1 work item — see Phase Status table). Design-partner relationship is a positive PMF signal (active client validation through build), not a risk mitigation. | **39** |
