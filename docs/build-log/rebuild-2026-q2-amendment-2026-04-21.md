# Rebuild Plan Amendment — 2026-04-21

**Amends:** MergeTasks-Rebuild-Plan-Q2-2026.docx (locked 2026-04-20)
**Source:** Yan–Claude planning session, 2026-04-21
**Grounded in:**
- /docs/audits/2026-04-21-full-system-map.md (full system audit)
- /docs/audits/2026-04-21-focused-followups.md (focused follow-up audit)

This memo layers on top of the original rebuild plan. The original
document is not rewritten — it remains the Phases 2–8 base reference.
Future amendments get their own dated memos in the same directory.

## Summary of changes

1. Phase 1 scope amended (six items — see §1 below)
2. Phase 1.5 inserted between Phases 1 and 2 (see §2 below)
3. Revised ceiling: mid-to-late August 2026 (from 2026-07-27)
4. Task 2a v1 and v2 both superseded

## 1. Phase 1 amendments

Phase 1 in the original plan targeted "unify three parallel pricing
systems." The audit confirmed the three systems and surfaced additional
scope that must be in-scope for Phase 1 to deliver what it claims. The
amendments below are corrections, not expansions.

### 1a. Two pricing tracks, cleanly separated

The pricing engine must separate:

- **Supplier cost track** — what the distributor pays the supplier.
  Sourced from supplier APIs (PromoStandards, PRESTful, ASI, Sage).
  Auto-updates on sync. Distributor never edits manually. Stored at
  the master catalog level with quantity tiers.
- **Client sell price track** — what the client pays the distributor.
  Set manually by the distributor per client-product. Never
  auto-updates when supplier cost changes. Stored at the client-product
  level with quantity tiers + setup fee + other-cost line items.

The two tracks relate only by reference. No automatic markup formula.
No live recalculation. The distributor sees supplier cost as a reference
while setting client price, but they are otherwise independent.

### 1b. Money representation standardized to integer cents

All pricing columns become integer cents (BIGINT). Decimal-as-string
with parseFloat is removed from pricing paths. Tax rates stay as
decimals (they are ratios, not amounts). Migration back-fills existing
decimal values to cents.

Per audit §6.2 — current codebase mixes decimal(10,2), parseFloat of
strings, and integer cents across different pricing paths. This
inconsistency would make "unified" pricing engine only partially
unified if left unaddressed.

### 1c. Three pricing divergence points fixed

Per audit §4.3:

- **Divergence 1:** PDP (StoreProductDetailPage.tsx:78-84) evaluates
  products.pricingTiers JSON by quantity; checkout (storeCheckout.ts:432)
  ignores tiers and uses flat customPrice only. Fix: both read from the
  same resolver.
- **Divergence 2:** Fallback scope drift — `customPrice ?? basePrice`
  coalesced in 6 separate sites (see audit §4.4). Fix: centralized in
  the resolver, zero duplication.
- **Divergence 3 (billing integrity):** Proposal acceptance at Stripe
  webhook time (stripe/webhook.ts:146-148) charges from
  proposalOrderItems.unitPrice with no re-validation against
  proposalPriceTiers. Fix: webhook re-validates via resolver before
  creating Stripe charge. Active money-leaking bug.

### 1d. Basic price matrix popup UI

Ships functional in Phase 1, polished in Phase 4. Contents:

- Supplier cost reference panel (read-only, from API)
- Client unit pricing tier table (editable)
- Setup fee (editable, separate line item, one-time or per-order toggle)
- Other costs (zero or more editable rows with label + amount)
- Display mode toggle per product-per-client: itemize vs roll-up
- Margin indicator (basic in Phase 1, polished in Phase 4)
- Workflow: per-product primary, batch option for copy-from-client
  and markup-rule-apply-to-all (Phase 4 polish)

### 1e. Estimate migration deferred to Phase 6

Per audit §2.1 and §2.3, the estimate-builder migration (0078) is
half-done. `routers/estimatesInvoices.ts:256` has active
`TODO(estimate-builder)`. Migrating estimates to a new pricing engine
on top of a half-migrated data model creates untraceable bugs. Phase 6
completes the estimate-builder migration as a dedicated task, then
migrates estimates to the unified pricing engine.

### 1f. PRESTful-compatible adapter contract defined

The rebuild plan has generic adapter work in Phase 3. Phase 1 defines
the adapter contract for "supplier returns cost pricing" so that
PRESTful (and future suppliers) plug into the pricing engine without
retrofit. Only ASI and PromoStandards are implemented in Phase 1; the
contract is what matters here, not full PRESTful implementation.

### Phase 1 gate criteria (revised)

- One pricing resolver function. Three old systems retired or unified
  behind it.
- Supplier cost and client sell price cleanly separated in schema.
- Integer cents throughout pricing paths. No parseFloat on price strings.
- PDP price and checkout price agree. Proposal acceptance re-validates
  against tier rules.
- Basic price matrix popup works end-to-end.
- PRESTful-compatible adapter contract defined.
- Regression shows no billing changes for existing orders.
- All tests pass.

### Phase 1 duration

Revised from 2 weeks to approximately 3 weeks, possibly slightly more.

## 2. Phase 1.5 — Organization Hierarchy Consolidation (new phase)

Inserted between Phases 1 and 2. Did not exist in the original plan.
Added because the audit revealed fragmented org hierarchy in the
codebase that would collide with later phases if left unaddressed.

### 2a. Why this phase exists

From audit §5:

- POC represented in 4 overlapping places: clientContacts.isPrimary,
  storeUsers.role, departmentApprovals free-text strings, stores.divisions
  JSON blob.
- Divisions exist in 2 parallel representations: normalized divisions
  table and stores.divisions JSON. No sync.
- Department approval routing uses free-text strings, not FK references.
- End-user onboarding is manual one-at-a-time for non-SSO clients.
- Custom requests submit but have no routing-to-approval defined.

### 2b. Locked org model

Hierarchy: Client → Webstore → (optional) Location → Department → User

- **Client:** has one webstore, one POC. POC is assigned by the
  distributor.
- **Webstore:** one per client. Has `multi_location_enabled` toggle.
- **Location** (replaces "division"): optional, only when toggle is on.
  Has name, URL slug, optional branding override, catalog scope.
  No permission walls between locations. Each user has a default
  location they land on at login.
- **Department:** sits under location if multi-location is on,
  otherwise under webstore. Used for approval routing and budgets.
  NOT for catalog filtering. Has a department head, assigned by POC.
- **User roles:**
  - Employee: credit card checkout only, submits custom requests
  - Department head: GL-code checkout against their department
    budget + approves proposals routed to their department. Authority
    granted by role itself — no extra approval gate.
  - POC: manages users, assigns department heads, approves custom
    requests, GL-code checkout against any department budget.
    One per client.
  - Distributor: assigns POC.

### 2c. GL code at checkout — Interpretation A

GL code is metadata stamped on the order, not a real-time integration
with an accounting system. Department head or POC enters/selects a GL
code at checkout; it is saved on the order. No card charged; order
drawn from department budget (existing storeDepartments.budgetCents /
spentCents / maxPerOrderCents enforcement). Client's accounting team
reconciles downstream. Employees see credit card only.

### 2d. Pricing is per-client, NOT per-location

Ontario and Quebec users pay the same price for the same polo.
Locations vary branding and catalog scope, not pricing. This
simplifies the pricing engine — no per-location override tables needed.

### 2e. SSO stays per-webstore

Per focused audit: SSO group-to-location mapping is fully implemented
(SAML + OIDC, 4-tier fallback, shared resolveDivisionFromSso()
helper). Phase 1.5 preserves this as-is. Only rename:
`groupToDivisionMap` → `groupToLocationMap`, `storeUsers.divisionId`
→ `storeUsers.locationId`.

The per-webstore SSO model is richer than per-client would be — it
supports targetStoreId for cross-store redirects. Keep it.

### 2f. Per-location branding — build new

Per focused audit: no divisionId column on clientLogos, clientAssets,
storeMediaFiles, or stores. All branding flows from stores.* today.
divisions.settings JSON has a comment about branding overrides as a
future use, but nothing reads or writes through it.

Phase 1.5 builds a `location_branding_assets` table with FK to
locations. Fields mirror stores.* branding fields (logo, colors,
banner, AI hero content). Renderer checks location branding first,
falls back to store-level branding if null.

### 2g. Non-SSO onboarding — CSV bulk upload

Distributor uploads CSV with name, email, location, department per row.
System creates accounts, emails password-setup links. Replaces today's
manual one-at-a-time entry.

### 2h. Custom request routing

End user submits custom request from webstore. Routes to POC for
approval. POC approves/declines in portal. Wired into existing
customOrderRequests table.

### 2i. Phase 1.5 deliverables

- Drizzle schema: rename divisions → locations, add clients.poc_user_id,
  storeDepartments.department_head_id, departmentApprovals.department_id
  FK (new approvals; legacy free-text preserved), orders.gl_code,
  storeUsers.default_location_id, storeUsers.role_in_department enum,
  new location_branding_assets table.
- Migration plan with data back-fill: JSON blobs from stores.divisions
  into locations rows, four POC representations reconciled to
  clients.poc_user_id, legacy clients.organizationId = NULL rows handled.
- POC portal additions: department-head assignment UI, custom request
  approval queue, CSV bulk upload UI, per-location branding upload UI,
  mapping health indicator for unmapped SSO groups.
- Distributor-side additions: POC assignment UI, CSV format docs.
- SSO preservation: rename map + FK column, no logic changes. All 4-tier
  fallback logic and shared resolver preserved.
- Non-SSO onboarding: CSV parse, user creation, password-setup email.
- Custom request routing: POC approval workflow.
- Multi-location toggle in Create-Store Wizard.
- GL-code checkout flow.

### 2j. Phase 1.5 gate criteria

- One POC model. Four prior representations consolidated.
- One location model. stores.divisions JSON deprecated.
- Department heads are FKs, not strings.
- Custom requests route to a defined POC.
- CSV bulk upload works end-to-end.
- SSO group-to-location sync works (preserved with rename).
- GL-code checkout works for heads and POC; employees see credit card
  only.
- Per-location branding override renders correctly.
- All migration paths tested. No regression in billing, checkout,
  proposal acceptance.

### 2k. Phase 1.5 duration

Estimate: 3–4 weeks. Refined after Phase 1.5 Task 1 (design) completes.

## 3. Revised phase sequence

| Phase | Name | Duration |
|---|---|---|
| 0 | Foundation & Design | 1 week (in progress) |
| 1 | Unified Pricing Engine (amended) | ~3 weeks |
| 1.5 | Organization Hierarchy Consolidation (new) | ~3–4 weeks |
| 2 | Imprint Zone Infrastructure | 1.5 weeks |
| 3 | Supplier Sync + Generic Adapter | 1.5 weeks |
| 4 | Distributor Curation UX (inc. polished price matrix) | 2 weeks |
| 5 | Customer-Facing Webstore | 1 week |
| 6 | Side-Quest Bug Fixes (inc. deferred estimate migration) | 1 week |
| 7 | Cleanup, Regression, Launch Readiness | 1 week |
| 8 | AI Features & Agentic Workflows | 3–4 weeks |

Revised ceiling: mid-to-late August 2026. Pinned after Phase 1.5 Task 1
(design) completes.

## 4. Task 2a superseded

Phase 1 Task 2a v1 (commit 7e40ede) and v2 (unpushed draft) are both
superseded by this amendment. See:
/docs/build-log/phase-1/scratch/task-2a-superseded.md

## 5. Not changed by this amendment

The following from the original rebuild plan remains in force:

- Governance (dual sign-off per phase)
- Sequential track (not parallel)
- Option 3 rationale (AI phased last)
- Option A rationale (unify pricing now, not later)
- Protected subsystems list (updated references to SSO and multi-division
  are captured in Phase 1.5, not in the protected list)
- Bug handling rule (mid-phase bugs deferred unless blocking)
- Architectural principles (11 governing principles)
- Phase-gate template with dual sign-off convention
- Phases 2–8 base scope (durations shift; scope unchanged except where
  noted in §3 above — Phase 4 gets polished price matrix UX, Phase 6
  gets deferred estimate migration)

---

End of amendment.
