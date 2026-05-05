# Purchase Order Flow — End-to-End

_Companion to `docs/po-audit.md`, which captures the pre-change state. This document describes the system after the AI-PO-aggregation, bulk-PO, document-flow, and proposal-redesign work shipped in commit `feat: AI-powered PO aggregation + bulk PO generation + complete document flow + proposal view redesign`._

---

## High-level diagram

```
                       ┌──────────────────────────────┐
                       │  Proposal (status: accepted) │
                       └──────────────────────────────┘
                                  │
        ┌───────────────────┬─────┴────────────────┬───────────────────────┐
        ▼                   ▼                      ▼                       ▼
 estimates.create     invoices.create     purchaseOrders.previewFromProposal
 FromProposal          FromProposal               (single proposal)
 (EST-1001)            (INV-1001)                       │
                                                        ▼
                                          poPreviewDrafts row + token
                                                        │
                                                        ▼
                                    /purchase-orders/preview/:token
                                    (drag/drop, edit supplier names)
                                                        │
                                                        ▼
                            purchaseOrders.confirmGeneration
                              → createPOsFromBuckets()
                              → N PO rows (PO-1001, PO-1002, …)


 AI Copilot ──► tool: generate_bulk_purchase_orders
              executeGenerateBulkPOs (server)
              ─► all status="accepted" proposals
              ─► same-supplier items merged across proposals
              ─► returns chat attachment { type:"po_bulk_preview", payload:{ token, groups, … } }
              ─► AIChatBox renders POBulkPreviewCard inline
              ─► click "Open full preview" → /purchase-orders/preview/:token
```

---

## Numbering

`server/utils/documentNumbers.ts: nextDocumentNumber(orgId, userId, "po"|"est"|"inv")` mints sequential numbers per org (or per user for solo accounts) starting at **1001**.

Concurrency safety uses `INSERT … ON DUPLICATE KEY UPDATE nextNumber = LAST_INSERT_ID(nextNumber + 1)` against the unique `(organizationId, userId, docType)` index on `documentSequences`. Old nanoid-numbered records continue to render unchanged.

---

## Schema additions (migration 0054)

- `documentSequences (id, organizationId, userId, docType, nextNumber)` — counter table.
- `poPreviewDrafts (id, token, organizationId, userId, payload, sourceProposalIds, expiresAt, confirmedAt)` — short-lived (1 h) AI preview store, single-use enforced by `confirmedAt`.
- `purchaseOrders.orderId` widened to `NULL` so proposal-only POs can exist.
- `purchaseOrders.proposalId` added (nullable FK to `proposals.id`) so single-source POs are queryable; multi-proposal bulk POs leave it `NULL` and carry the source list in `internalNotes`.

---

## Reused building blocks

- `groupBySupplier()` (`server/utils/supplierGrouping.ts`) — three-tier exact/fuzzy/LLM grouping; LLM call goes through `safeLLM()`.
- `createPOsFromBuckets()` (`server/utils/generatePOsForOrder.ts`) — extracted from the old in-line loop; now shared by `generatePOsForOrder` (order-based) and `confirmGeneration` (proposal-based).
- `getOrgScope(ctx)` — every new procedure scopes by org.
- `branding.get` — single source of truth for PDF brand color / logo / company name; used by `poPdfGenerator`, `estimatePdfGenerator`, `invoicePdfGenerator` via `client/src/utils/documentBranding.ts`.

---

## Client surface

- `client/src/pages/PurchaseOrderPreview.tsx` — drag-between-supplier-groups review screen at `/purchase-orders/preview/:token`. HTML5 DnD (no new dependency).
- `client/src/components/po/POBulkPreviewCard.tsx` — collapsed inline card rendered by the AI chat for `po_bulk_preview` attachments.
- `client/src/pages/ProposalDetail.tsx` — Documents section wired to `estimates.list`, `invoices.list`, `purchaseOrders.list` filtered by `proposalId`. "Generate POs" button calls `previewFromProposal` and navigates to the preview screen.

PDF helpers: `client/src/utils/{poPdfGenerator,estimatePdfGenerator,invoicePdfGenerator}.ts` + shared `documentBranding.ts`.

---

## Multi-tenant guarantees

- `previewFromProposal`, `previewBulkFromApproved`, `getPreview`, `confirmGeneration` — all use `getOrgScope(ctx)` and filter `poPreviewDrafts` by `organizationId` (or `userId` for solo accounts).
- `executeGenerateBulkPOs` (copilot tool executor) builds `buildToolScope(userId, organizationId)` and constrains every query the same way.
- Preview tokens are nanoid(32) and single-use (`confirmedAt` set on commit).
