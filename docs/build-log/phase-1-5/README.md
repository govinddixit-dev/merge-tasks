# Phase 1.5 — Organization Hierarchy Consolidation

**Status:** placeholder. Scope locked, design work not started.
**Starts:** after Phase 1 (Unified Pricing Engine) completes.
**Duration estimate:** 3–4 weeks. Pinned after Task 1 (design) completes.
**Authoritative scope source:** /docs/build-log/rebuild-2026-q2-amendment-2026-04-21.md §2

This document is a skeleton. It captures what Phase 1.5 will cover and
lists the open questions that Task 1 (design) must answer. The actual
design work happens when the phase starts. Do not treat anything in this
document as a final design decision.

## Purpose

Consolidate the fragmented org hierarchy surfaced by the 2026-04-21
full system audit, and build out the POC portal features that emerged
during the 2026-04-21 planning session.

From the audit:
- POC exists in 4 overlapping places (clientContacts.isPrimary,
  storeUsers.role, departmentApprovals free-text, stores.divisions JSON)
- Divisions exist in 2 parallel representations (normalized +  JSON)
- Department approval routing uses free-text strings, not FKs
- End-user onboarding is manual for non-SSO clients
- Custom requests submit without routing-to-approval defined
- Per-location branding is not implemented (focused audit confirmed)
- SSO group-to-location mapping is fully implemented and will be
  preserved with rename

## The locked org model

Reference only. Full detail in the amendment memo.

    Client (1 POC, distributor-assigned)
      └── Webstore (1 per client, multi_location_enabled toggle)
            └── Location (optional — only when toggle is on)
                  └── Department (for approval routing + budgets)
                        └── User (role: employee | head; default_location_id set)

- POC is one per client, assigned by the distributor.
- Multi-location is optional.
- Locations navigable without permission walls.
- Pricing is per-client, NOT per-location.
- Catalog scope is per-location only.
- Department heads are POC-assigned.
- GL-code checkout = Interpretation A (metadata on order, drawn from
  department budget).
- SSO stays per-webstore.

## Task list (provisional)

### Task 1 — Design
Produce the full Drizzle schema, migration plan, and open-question
resolution doc. Deliverable: `/docs/build-log/phase-1-5/design.md`.

### Task 2 — Migration
Back-fill legacy data:
- `stores.divisions` JSON → `locations` table rows
- Four POC representations → `clients.poc_user_id`
- `clients.organizationId = NULL` legacy rows
- `departmentApprovals` free-text preserved for historical records;
  new approvals use FK
- `storeUsers.divisionId` → `storeUsers.location_id` (rename)
- `groupToDivisionMap` → `groupToLocationMap` (rename)

### Task 3 — POC portal additions
- Department-head assignment UI
- Custom request approval queue
- CSV bulk upload UI with email preview
- Per-location branding upload UI
- Mapping health indicator for unmapped SSO groups

### Task 4 — Distributor-side additions
- POC assignment UI
- CSV format documentation

### Task 5 — SSO preservation with rename
- Rename `groupToDivisionMap` → `groupToLocationMap`
- Rename `storeUsers.divisionId` → `storeUsers.location_id`
- No logic changes. 4-tier fallback preserved.
- Shared `resolveDivisionFromSso()` helper renamed to
  `resolveLocationFromSso()`.

### Task 6 — Non-SSO onboarding (CSV flow)
- CSV parse
- User account creation
- Password-setup email template
- Error handling (duplicate emails, invalid locations, malformed rows)

### Task 7 — Custom request routing
- Wire existing `customOrderRequests` to POC approval workflow

### Task 8 — Multi-location toggle in Create-Store Wizard
- Replace current Step 4 JSON capture with proper location management
- Migration for wizard data

### Task 9 — GL-code checkout flow
- Payment method eligibility based on user role
- GL-code entry UI at checkout
- Order metadata stamping
- Department budget enforcement (existing fields, wire up to new flow)

### Task 10 — Per-location branding (build new)
- New `location_branding_assets` table with FK to locations
- Fields mirror `stores.*` branding fields (logo, colors, banner,
  AI hero content)
- Renderer checks location branding first, falls back to store-level
  branding if null

### Task 11 — Regression testing
- Billing unchanged
- Checkout unchanged
- Proposal acceptance unchanged
- Existing SSO flows unchanged
- Existing multi-division flows migrated correctly

## Open questions for Task 1 (design)

These are NOT locked decisions. They are questions Task 1 must answer.

### Schema

1. Does `locations` inherit all columns from `divisions`, or does Task
   1 propose a cleaner shape? What does `divisions.settings` JSON
   migrate to?
2. What is the exact column set for `location_branding_assets`? Should
   it denormalize stores.* fields, or reference them by override?
3. `storeUsers.role_in_department` enum: exact values? Are `employee`
   and `head` sufficient, or do we need `manager` as a distinct role?
4. `orders.gl_code` — varchar length? Validation rules? Required when
   payment method = company_funds? Null otherwise?
5. `storeDepartments.department_head_id` — single head per department,
   or can multiple be assigned?

### Migration

6. How are `stores.divisions` JSON blobs with non-standard shapes
   handled? Specifically: rows where departments[] is populated (do
   these migrate to new department records? Orphaned?)
7. For clients with `organizationId = NULL`, what is the back-fill
   strategy? Do we synthesize an organization, attach to owner user,
   leave NULL?
8. For existing `departmentApprovals` rows with free-text department
   names that don't match any `storeDepartments` row: preserve as-is
   (historical), or attempt fuzzy match?
9. For the four POC representations, precedence order when they
   conflict? Which wins when migrating to `clients.poc_user_id`?

### SSO and location mapping

10. After rename, should legacy `groupToDivisionMap` JSON values be
    validated against the new `locations` table? What happens to
    mappings pointing to `divisions.id` values that don't migrate
    cleanly?
11. The "no-match = NULL divisionId + user sees shared products only"
    behavior — is this preserved, or should Phase 1.5 add a POC-facing
    alert when this happens? Per amendment §2.5 this is "mapping health
    indicator" but the exact UX is undefined.

### POC portal

12. CSV upload: what columns are required? Optional? Default values
    for missing fields?
13. CSV upload: what is the expected behavior when a user being
    uploaded already exists? Skip, update, error?
14. Custom request approval queue: does POC see all requests across
    the whole client, or filtered by location when multi-location is
    on?
15. Department-head assignment UI: can the POC assign a department
    head who is not yet a user in the system (invite flow), or must
    they select from existing users only?

### GL-code checkout

16. GL codes: free-text entry, dropdown from a configured list, or
    both (distributor configures allowed codes per client)?
17. What happens when department budget is exhausted at checkout time
    for a GL-code order? Block? Escalate to POC? Allow with warning?
18. Can the POC place GL-code orders on behalf of an employee, or only
    for themselves?

### Per-location branding

19. Fallback order when rendering a webstore with multi-location
    enabled: location branding → webstore branding → default? Confirm.
20. When multi-location is toggled off on a webstore that previously
    had per-location branding: preserve the data (dormant) or delete?

## Out of scope (explicit)

These have been considered and explicitly rejected or deferred:

- Per-division/per-location pricing (rejected — pricing is per-client)
- Department-level catalog scope (rejected — catalog is per-location
  only)
- Approval tiers, budget cadence, over-budget escalation logic
  (rejected in the task-2a kill note)
- Per-department SSO (not needed; per-webstore SSO is richer)
- Nested departments / department hierarchy (rejected — flat
  departments only)
- Automatic markup rule tying supplier cost to client sell price
  (rejected — pricing is manual)
- SSO auto-assigning department heads (rejected — SSO does not
  reliably expose this relationship)

## References

- Amendment memo: `/docs/build-log/rebuild-2026-q2-amendment-2026-04-21.md`
- Task 2a kill note: `/docs/build-log/phase-1/scratch/task-2a-superseded.md`
- Full system audit: `/docs/audits/2026-04-21-full-system-map.md`
- Focused follow-up audit: `/docs/audits/2026-04-21-focused-followups.md`

---

End of Phase 1.5 placeholder.
