# Workflow Audit — Proposal + Webstore (2026-04-14)

## Verdict

Both Create Proposal and Create Webstore flows are **production-ready** with the remaining follow-ups listed at the bottom. Multi-department approval routing is functionally complete end-to-end (tokenized links, no-login approval page, live POC dashboard with progress bar, individual + bulk reminders, rejection notes, re-approval). The three-tier email branding system now correctly routes every email through `brandingResolver.ts` — dept approval emails ship as Tier 3 (client-branded), not Tier 2.

---

## Create Proposal — findings

| Area | State | Notes |
|------|-------|-------|
| Zero items | ✅ validated | Step 2 blocks Continue if no products. |
| Client selection | ✅ inline create | Step 1 supports inline client creation. |
| Multi-department toggle | ✅ saves | `proposals.multiDepartment` (schema.ts:182) populated from `multiDeptEnabled` (CreateProposal.tsx:127). Available on every proposal regardless of SSO. |
| Auto-save | ✅ reliable | `beforeunload` listener + explicit save button (CreateProposal.tsx:470–508). |
| Proposal preview | ✅ | Step 6 Review shows full summary before send. |
| Tax | ⚠️ configurable | `organizations.defaultTaxRate` (added 0055) now per-org; 13% HST remains default. |
| Send email branding | ✅ Tier 2 | `buildProposalSentEmail` uses distributor logo/color + distributor replyTo. |
| Back from proofing | ✅ | CreateProposal.tsx:394–425 persists draft. |
| Error states | ✅ | tRPC errors surface via `toast.error`. |

---

## Create Webstore — findings

| Step | State | Notes |
|------|-------|-------|
| 1 Company Info | ✅ | POC name/email validated when `pocEnabled`. SSO provider selection drives the rest of the wizard. |
| 2 Domain | ✅ | Subdomain required; collision checked on create-mutation side. Follow-up: real-time availability indicator during typing. |
| 3 Store Type | ✅ | Toggle actions eliminate stale-closure risk. |
| 4 Divisions | ✅ SSO-gated | Step only appears when SSO is configured (CreateWebstore.tsx:743); step-skip logic at :211/:219 jumps past Divisions in both directions. Auto-clears `multiDivisionEnabled` + `divisions` if SSO is later removed. POC email required per division. |
| 5 Duration | ✅ | Permanent + popup both work; popup end > start enforced. |
| 6 Template | ✅ | Three templates load + preview. |
| 7 Catalog | ✅ | Auto-selects first 5 active products. Division-tagging column (`storeProducts.divisionIds`) added in migration 0057 — management-page UI for flipping shared/division-restricted is a follow-up. |
| 8 Branding | ✅ | Validator reads real state fields. |
| 9 Checkout | ✅ | Graceful when Stripe Connect missing — falls back to PO/GL. |
| 10 Review & Launch | ✅ | Pre-flight panel lists blocking errors with jump-to-step links. |

---

## Client portal — multi-department approval flow

Stage-by-stage verification:

1. POC sees proposal with multi-dept flag — **works** (`PortalProposalsTab.tsx`).
2. POC selects departments to route to — **works** (`DepartmentApprovals.tsx`).
3. Unique tokenized approval links — **works** (`proposalsSend.ts` generates nanoid(32) per row).
4. Per-department branded email — **Tier 3 (client-branded)**. New helper `loadClientBrandingForProposal` in `publicProposalHelpers.ts` resolves the client's workstore branding (or client company fallback) and returns `fromName` formatted as `"<Client> via MergeTasks"`. End users no longer see distributor branding on these emails.
5. No-login approval page — **works** (`GET /api/approve/:token`, token-gated).
6. Approve / Request Revision / Reject with comments — **works**.
7. Live POC dashboard — **works**. Progress bar and `X of N approved` counter in `DepartmentApprovals.tsx:107–114`.
8. Send Reminder — **works**. Individual reminder button per row (:133–143), "Remind All Pending" (:170–179). Backend: `POST /api/proposals/public/:token/departments/remind` accepts optional `departmentId` for single-target.
9. All approve → distributor notified — **works** (Tier 2 email to distributor).
10. Any reject → distributor notified with reason — **works**.
11. Revision requested → consolidated notes — **works**.

---

## Email branding — tier conformance

Three-tier system is now consistently applied:

| File | Tier | Examples |
|------|------|----------|
| `server/email/emailTemplates/emailTemplatesDistributor.ts` | Tier 1 — MergeTasks → Distributor | `buildFulfillmentApprovedEmail`, `buildOrderShippedEmail`, `buildStoreApprovedEmail`, `buildStoreChangesRequestedEmail` |
| `server/email/emailTemplates/emailTemplatesClient.ts` | Tier 2 — Distributor → Client | `buildProposalSentEmail`, `buildStoreApprovalRequestEmail` |
| `server/email/emailTemplates/emailTemplatesStore.ts` | Tier 3 — Store → End user | `buildStoreInviteEmail`, `buildDeptApprovalRequestEmail`, `buildVerificationCodeEmail` |

`brandingResolver.ts` exposes `resolveTier1/2/3` and is now the single source of truth for `fromName` and `replyTo`. Five mismatches found in the audit are fixed:

- stripe/webhook.ts proposal-accepted — was Tier 1, now Tier 2
- publicProposalOrderItems order-submitted — was Tier 1, now Tier 2
- publicProposalFulfillment (edit / override / fulfillment) — added missing `replyTo`, routed through `resolveTier2`
- storeUserProvisioning invite — was distributor-branded, now Tier 3 (`"<Store> via MergeTasks"` + `store.senderEmail` replyTo)
- storePortalRefunds — was Tier 1, now Tier 2

Dept approval emails, reminders, and re-approvals switched from `loadBrandingForProposal` (distributor) to `loadClientBrandingForProposal` (store → client fallback). `from` address stays `info@mergetasks.com` across all tiers; only display name and replyTo vary.

---

## Distributor Settings — divisions check

The old `DivisionsTab` was imported + rendered in `client/src/pages/Settings.tsx` — removed this cycle. Schema and `server/routers/divisions.ts` intact. Divisions now live exclusively in the SSO-gated Create Webstore step and the individual webstore management page.

---

## Multi-division workstore — build state

| Capability | State | Location |
|------------|-------|----------|
| Divisions CRUD + schema | ✅ | `drizzle/schema.ts:1170` (`divisions`), `server/routers/divisions.ts` |
| Create-wizard Divisions step (SSO-gated) | ✅ | `Step4Divisions.tsx`; skip logic in `CreateWebstore.tsx` |
| Product tagging column | ✅ schema | `storeProducts.divisionIds` JSON added in 0057; surfaced on `stores.getBySlug` response |
| Product filtering helpers | ✅ | `server/routers/storeDivision.ts` (`isProductVisibleToDivision`, `filterProductsByDivision`) |
| `storeUsers.divisionId` column | ✅ | Added 0057; nullable for legacy stores |
| SSO group → division map column | ✅ | `storeIdentityProviders.groupToDivisionMap` added 0057 |
| Budget warn threshold column | ✅ | `storeDepartments.warnThresholdPct` int default 80 (0057) |
| POC per division (email capture) | ✅ | `Step4Divisions.tsx:42` per-division POC email field |

Follow-ups required to complete the spec end-to-end:

- **SSO JIT provisioning**: `ssoUserResolver.ts` must read `groupToDivisionMap` and write `storeUsers.divisionId` on first login.
- **Storefront division filter**: `LiveStore.tsx` / product grid applies `filterProductsByDivision` using the authenticated user's divisionId (now in session).
- **"Your team has $X remaining"**: division-aggregate budget display on storefront (aggregate over all departments belonging to that division).
- **Catalog tagging UI**: per-store management page needs a "Shared / Division-restricted" selector on each product.
- **POC portal scoping**: `storePortal*` routers filter by caller POC's division when the store is multi-division.
- **Webstore management per-division budgets**: distributor view of division-level budgets and spend (department budgets are already in place; roll-up is additive).
- **80% warning banner**: client-side banner on the storefront when `budgetWarningState` returns `"warn"`.

---

## Open items (not blocking)

- Subdomain availability indicator during typing (UX polish, Step 2).
- Multi-division SSO JIT provisioning + storefront filter UI (tracked above).
- Storefront division budget display (tracked above).
- Distributor welcome email template review — confirmed Tier 1; no mismatches.
