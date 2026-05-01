# Task 2a — Preliminary design decisions (pending overnight review)

**Status:** Draft — not yet promoted to design doc. All decisions reviewable and amendable tomorrow morning.
**Date:** 2026-04-21
**Context:** Walked through design decisions in a Yan ↔ Claude conversation. Captured here so they persist overnight.

## 10 preliminary decisions

1. **Divisions are client-side.** A client (e.g., Alta Manufacturing) has divisions (Ontario plant, Quebec plant, Minnesota plant). Distributors (MergeTasks users) do not have divisions.

2. **POC is a user role on the client.** The "Point of Contact" is typically from corporate HR or marketing. They see all divisions, can place orders for any division, and act as the top-tier approver. Modeled as a user role, NOT as a phantom client-wide department entity.

3. **Departments are scoped to a division.** Every department belongs to exactly one division. There are no client-wide departments. Departments do not exist above the division level.

4. **Separate department rows per division.** If Ontario and Quebec both have a "Shop Floor" department, those are two distinct rows in the departments table. "Shop Floor identity" is not shared across divisions. Queries that want cross-division aggregation group by name at report time.

5. **Pure flat departments.** No parent_department_id column. No nesting. If a future client needs hierarchy, that's a future migration.

6. **Approval pattern: Pattern B — threshold-based escalation.** Two amount thresholds create three approver tiers:
   - Tier 1 (under threshold 1): department head approves
   - Tier 2 (between thresholds): division manager approves
   - Tier 3 (over threshold 2): POC approves
   Thresholds are configurable per-department.

7. **Budget cadence is configurable per department.** Each department picks one of: monthly / quarterly / annual. Stored as an enum on the departments table.

8. **Over-budget: auto-escalate to POC.** When a new order would push a department over budget, the order is NOT blocked. Instead, it automatically routes to the POC for override-approval, bypassing the normal threshold chain. Approved over-budget orders are logged with a reason_code so compliance can review them.

9. **Webstore-division relationship: one webstore per client, division determined by user at runtime.** The client (Alta) has ONE store. Division-specific catalogs, budgets, and approval chains are rendered based on the logged-in user's division_id. POC users (division_id = NULL) see everything and can order for any division or corporate.

10. **Document-type attachment rules:**
    - **Estimate:** division_id and department_id OPTIONAL (can exist before those are decided)
    - **Proposal:** division_id and department_id REQUIRED (needed for approval routing)
    - **Invoice:** inherits both from the proposal it was generated from
    - **Purchase Order (PO):** has neither (POs are distributor→supplier, not client-scoped)

## Known open items for Task 2b and beyond

- Agent infrastructure schema (Task 2b)
- Pricing foundation schema — per-division overrides, distributor vs client pricing (Task 2c)
- The approval_requests state machine (part of Task 2a proper, not captured here yet)
- SSO configuration shape (per-client or per-division?) — needs resolution in Task 2a proper
- What fields does a "user" need that's different from today's users table (POC role, division_id, department_id, manager_user_id)?

## Review checklist for tomorrow morning

Before promoting this to the real design doc, re-read each decision and ask:
- [ ] Does this match how Alta actually operates?
- [ ] Does this match how my next 5 likely clients operate?
- [ ] Is there a decision that would be hard to reverse post-migration?
- [ ] Have I missed a document type or relationship?
- [ ] Does the POC user model really handle everything I need vs. having client-wide depts?

Then run the Task 2a agent to produce the formal design doc using these locked decisions as input.
