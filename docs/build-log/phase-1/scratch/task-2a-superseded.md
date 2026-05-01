# Task 2a — Superseded

**Status:** killed. Both v1 and v2 are superseded.
**Date:** 2026-04-21
**Superseded by:** /docs/build-log/rebuild-2026-q2-amendment-2026-04-21.md (commit 7229972)

## What Task 2a was trying to do

Task 2a was originally scoped as "Phase 0 Task 5: resolve conditional
subsystems (multi-department approval, multi-division) — protected or
in-scope for Phase 1 pricing engine." In practice, both the v1 and v2
drafts expanded beyond that narrow mandate into an org-hierarchy
redesign: POC succession, per-client SSO, per-division branding,
per-division catalog scope, department-as-FK, approval tiers, budget
cadence, and more.

## Why both drafts are killed

The 2026-04-21 full system audit
(/docs/audits/2026-04-21-full-system-map.md) established ground truth
that invalidated or reframed most of the drafts' design decisions:

- **POC is already represented in four places**
  (clientContacts.isPrimary, storeUsers.role,
  departmentApprovals free-text strings, stores.divisions JSON) — not
  absent as v1/v2 implied. v2's proposed `poc_user_id` pointer would
  be a fifth representation, not a simplification.
- **Divisions already exist in two parallel representations**
  (normalized divisions table + stores.divisions JSON, no sync). v2
  assumed a cleaner starting point than the code actually provides.
- **SSO is already per-store, not absent** — and the per-store model
  (storeIdentityProviders, groupToDivisionMap, targetStoreId) is
  richer than v2's proposed per-client SSO. v2 D9 would be a
  regression.
- **Multi-department approval reads from departmentApprovals**, a
  separate table with free-text department strings — not from the
  normalized department schema v2 assumed it depended on. The
  approval flow is decoupled, for better or worse.
- **Per-division catalog scope already exists** via
  storeProducts.divisionIds (per audit §5.5). Not new work.
- **Per-division branding does NOT exist** (per focused audit
  2026-04-21-focused-followups.md). Genuine gap, confirmed.
- **SSO group-to-location mapping is fully implemented** with 4-tier
  fallback (SSO groups → email local part → full email → NULL). Not
  a gap to fill — something to preserve with a rename.

## What replaces Task 2a

All legitimate design scope from v1 and v2 has been relocated to
Phase 1.5 (Organization Hierarchy Consolidation) in the amendment
memo. See:

- /docs/build-log/rebuild-2026-q2-amendment-2026-04-21.md §2 — Phase
  1.5 full scope

Specifically, the following concerns from the v2 draft are addressed
in Phase 1.5, reframed against audit ground truth:

| v2 concern | Phase 1.5 treatment |
|---|---|
| POC succession via role-as-pointer | `clients.poc_user_id` pointer, consolidating the four existing POC representations |
| Department as FK, not free-text | New `departmentApprovals.department_id` FK on new approvals; legacy free-text preserved for historical records |
| Per-division (now per-location) branding | New `location_branding_assets` table (built new — audit confirmed this is not currently implemented) |
| Per-division (now per-location) catalog scope | Preserved as-is via `storeProducts.locationIds` (rename only) |
| Per-client SSO | Rejected — per-store SSO is richer and already works. Preserved with rename: `groupToDivisionMap` → `groupToLocationMap` |
| Approval tiers / budget cadence / over-budget logic | Rejected entirely — not in any rebuild phase. Budget enforcement via existing storeDepartments fields is sufficient for now |
| Document-type attachment rules (D10) | Pricing engine (Phase 1) handles cost vs sell price explicitly; no schema-level attachment rules needed |
| Single POC succession event handling | Handled by the `clients.poc_user_id` pointer itself — update the pointer, history preserves actual `approver_user_id` on audit rows |

## Files affected

**Kept (historical record):**
- `/docs/build-log/phase-1/scratch/task-2a-preliminary-decisions.md`
  (v1, committed at 7e40ede) — left in place as history
- v2 draft was never pushed; no file to retire

**New authoritative sources (as of 2026-04-21):**
- `/docs/audits/2026-04-21-full-system-map.md` — codebase ground truth
- `/docs/audits/2026-04-21-focused-followups.md` — per-location
  branding and SSO mapping ground truth
- `/docs/build-log/rebuild-2026-q2-amendment-2026-04-21.md` — Phase 1
  amendments + Phase 1.5 scope
- `/docs/build-log/phase-1-5/README.md` — Phase 1.5 placeholder and
  open questions

## Rule of thumb for future reference

If a Claude session references Task 2a v1 or v2 as a source of design
decisions, stop and redirect. Read the amendment memo and the audits
instead. Task 2a is not the current authoritative source for any org
hierarchy decision.

---

End of kill note.
