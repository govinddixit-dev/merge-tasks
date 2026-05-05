# Purchase Order / Document Flow — Phase-1 Audit

_Last updated: 2026-04-13. Read-only audit doc; produced before the AI-PO-aggregation, bulk-PO, document-flow, and proposal-redesign work landed on `main`._

This audit captures the as-found state of the PO / Estimate / Invoice / Proposal pipeline so future readers can see what was redesigned and why. Numbers and file paths refer to the codebase **prior** to the migration `0054_document_sequences.sql` and the new preview/bulk procedures.

---

## 1. Database schema (drizzle/schema.ts)

### 1.1 Documents

- **`purchaseOrders`** (`drizzle/schema.ts:1415-1465`) — full lifecycle table:
  `status` enum: `draft | sent | acknowledged | in_production | shipped | received | cancelled | partial`.
  Stores `lineItems` JSON (`POLineItem[]`), AI grouping confidence/reason, supplier identification, ship-to, totals.
  `poNumber varchar(32) NOT NULL UNIQUE`.
- **`purchaseOrderEvents`** (`drizzle/schema.ts:1470-1483`) — append-only event log, FK → `purchaseOrders.id` ON DELETE CASCADE.
- **`estimates`** (`drizzle/schema.ts:1004-1035`) — `status` enum: `draft | sent | accepted | declined | converted`. JSON `lineItems`. `estimateNumber varchar(32) NOT NULL` (no UNIQUE constraint).
- **`invoices`** (`drizzle/schema.ts:1043-1086`) — `status` enum: `draft | sent | paid | overdue | cancelled | void | refunded | partially_refunded | credit_issued`. `invoiceNumber varchar(32) NOT NULL` (no UNIQUE constraint).
- **`suppliers`** (`drizzle/schema.ts:1493+`) — auto-populated supplier directory keyed by normalized name + org/user.

### 1.2 Numbering format (today)

All three document types use **`nanoid`-based** numbers via separate per-router helpers:

| Type | Generator | Format |
|---|---|---|
| PO | `purchaseOrders.ts:39` + `generatePOsForOrder.ts:34` + `copilotExecPurchaseOrders.ts:27` | `PO-YYYY-XXXXXXXXXXXX` (12-char nanoid) |
| Estimate | `estimatesInvoices.ts:19` | `EST-XXXXXXXX` (8-char nanoid) |
| Invoice | `estimatesInvoices.ts:23` | `INV-XXXXXXXX` (8-char nanoid) |

There is **no per-org sequential counter table**. Numbers are random, not sortable, and not user-friendly.

### 1.3 Branding

- `distributorProfiles.brandPrimaryColor` (`schema.ts:526`) — defaults to `#654BF9`.
- `brandLogoUrl`, `brandLogoOriginalUrl`, `brandSecondaryColor`, `brandBannerColor`, `brandCompanyName` all live on the same row.
- `branding.get` tRPC procedure (`server/routers/branding.ts:21`) returns these to the client.

### 1.4 Proposal status

`proposals.status` enum (in `proposals` table): `draft | sent | viewed | accepted | declined | expired`. There is **no separate `approved` state** — "accepted" is the trigger for downstream document generation. Department-level approval is tracked separately in `departmentApprovals`.

---

## 2. Backend — current PO/Estimate/Invoice flows

### 2.1 `server/routers/purchaseOrders.ts` (929 lines)

Key procedures:

- **`generateFromOrder({ orderId })`** — delegates to `generatePOsForOrder()` util. Loads `orderItems` + `products`, runs `groupBySupplier()` AI grouping, **persists POs immediately** (no preview).
- **`bulkGenerateFromOrders({ orderIds })`** — same flow, multiple orders. Still persists immediately.
- **`list / getById / update / updateLineItem / reassignItem / send / updateStatus / receive / delete / merge / getMarginAnalysis / listSuppliers`** — full CRUD + lifecycle.

There is **no `previewFromProposal`, no `previewBulkFromApproved`, no `confirmGeneration`** procedure. Once `generateFromOrder` is called, POs are committed; the only "edit" path is `update`/`updateLineItem`/`reassignItem` post-creation.

### 2.2 `server/routers/estimatesInvoices.ts` (418 lines)

- `estimates.list / getById / createFromProposal / convertToInvoice / delete`
- `invoices.list / getById / createFromProposal / updateStatus / delete`

`createFromProposal` already loads `proposalOrderItems` (with `proposalProducts` fallback) and snapshots line items into the document. **The only thing missing from a complete document story is the number generator** (uses `nanoid`).

### 2.3 `server/utils/generatePOsForOrder.ts` (271 lines)

The shared persistence utility. The **supplier-bucket → PO-rows block** (lines 156-262) is currently **not extracted** into a reusable function — it's a single `for` loop inside `generatePOsForOrder()`. To reuse it from a proposal-based flow we must factor it out (`createPOsFromBuckets()`).

### 2.4 `server/utils/supplierGrouping.ts` (271 lines)

`groupBySupplier(items: OrderItemWithProduct[], { useLLM })` — three-tier exact → fuzzy → LLM matching. Returns `SupplierBucket[]` sorted by confidence descending. LLM call already goes through `safeLLM()`. The input type is hard-coded to `OrderItemWithProduct` (order-item shape with `orderItemId` field) — this prevents direct use from proposal line items without an adapter.

### 2.5 AI Copilot wiring

- **Tool defs** live in `server/routers/copilotToolDefs.ts` (737 lines, `EXTENDED_TOOLS` array).
- **PO-related tools** today: `search_purchase_orders`, `generate_purchase_orders` (single order), `get_po_details`, `get_margin_analysis` — registered in `copilotToolDefs.ts` and dispatched via `copilotExecutors.ts:305-322` to `copilotExecPurchaseOrders.ts`.
- **No `generate_bulk_purchase_orders` tool** — the AI cannot trigger cross-proposal aggregation.
- The `copilot.chat` procedure response shape is `{ reply, actions, executionLog, awaitingApproval?, pendingApprovals? }` — there is **no `attachment` field**, so the chat cannot return interactive cards.

---

## 3. Frontend

### 3.1 Pages

- `client/src/pages/PurchaseOrders.tsx` — list view.
- `client/src/pages/PurchaseOrderDetail.tsx` — single PO with edit/send/receive.
- `client/src/pages/EstimateDetail.tsx` / `InvoiceDetail.tsx` — detail views.
- `client/src/pages/PublicProposalView.tsx` — client-facing proposal portal.
- `client/src/pages/ProposalDetail.tsx` (638 lines) — distributor-facing proposal view. **Single column** (header → refund banner → proofing panel → product detail → product carousel → CTA). No Documents section, no two-column layout, no breadcrumb, no context-aware CTA per status.
- **No `PurchaseOrderPreview.tsx`** page exists.

### 3.2 PDF generators

- Only `client/src/utils/poPdfGenerator.ts` (293 lines) exists. **Brand color is hard-coded**: `const brandPurple = [101, 75, 249] as const;` at line 57. Company name passed in as `po.companyName`, but no logo, no `branding.get` integration.
- **No `estimatePdfGenerator.ts` or `invoicePdfGenerator.ts`** — Estimate / Invoice download paths are stubs.

### 3.3 AI Chat

- `client/src/components/AIChatBox.tsx` (335 lines) — pure text chat. `Message` type is `{ role, content }` — no attachment field.
- `client/src/components/GlobalAIAssistant.tsx` — wraps the floating dashboard chat. Same text-only contract.
- All assistant content is rendered via `Streamdown` (markdown). No structured-card render path.

---

## 4. End-to-end flow today

```
Proposal (status: accepted)
   │
   ├──► Estimate.createFromProposal       (immediate persist, EST-XXXXXXXX)
   ├──► Invoice.createFromProposal        (immediate persist, INV-XXXXXXXX)
   │
   └──► [no direct PO path]
          │
          ▼
       Order (created via webstore checkout / manual)
          │
          ▼
       PO.generateFromOrder
          │
          ├── load orderItems + products
          ├── groupBySupplier()  (3-tier AI)
          └── persist N POs immediately (PO-YYYY-XXXXXXXXXXXX)
```

**Gaps:**
- No "Generate POs" button on a proposal.
- No preview/edit screen — POs commit immediately.
- No bulk-across-proposals AI flow.
- No drag-between-supplier-groups UI.
- No inline supplier-create from the PO-generation step.
- Document numbers are random nanoids, not sequential.
- Estimate/Invoice PDFs missing.
- PO PDF brand color hard-coded.
- Distributor `ProposalDetail` has no Documents section.

---

## 5. Reusable building blocks (do NOT rebuild)

| Util / Component | Path | Why reuse |
|---|---|---|
| `groupBySupplier()` | `server/utils/supplierGrouping.ts` | Already 3-tier exact/fuzzy/LLM; needs only generic input type. |
| `safeLLM()` | `server/_core/safeLLM.ts` | Layer 1+2 sanitization + Layer 5 audit log; mandatory for any new LLM call. |
| `getOrgScope()` | `server/utils/orgScope.ts` | Multi-tenant WHERE-clause builder; mandatory for every new tRPC procedure. |
| `branding.get` | `server/routers/branding.ts:21` | Single source of truth for brand color / logo / company name. |
| `estimates.createFromProposal` / `invoices.createFromProposal` | `server/routers/estimatesInvoices.ts` | Already builds line items from proposalOrderItems with proposalProducts fallback. |
| Supplier-bucket persistence loop | `server/utils/generatePOsForOrder.ts:156-262` | Extract into `createPOsFromBuckets()` and call from both order- and proposal-based flows. |
| `Streamdown` | rendered inside `AIChatBox.tsx` | Keep for plain text; structured attachments render alongside. |

---

## 6. Multi-tenant / security checklist for new code

- Every new `protectedProcedure` MUST call `getOrgScope(ctx)` and filter by `scope.<table>` / `scope.organizationId`.
- Every new LLM call MUST go through `safeLLM()` (not `invokeLLM()` directly).
- Preview tokens (for PO preview drafts) MUST be scoped to the org of their creator and single-use on confirm.
- New tables (`documentSequences`, `poPreviewDrafts`) MUST include `organizationId` (nullable for solo accounts) and a `userId` fallback the same way existing tables do.

---

## 7. What this audit precedes

The follow-up commit (`feat: AI-powered PO aggregation + bulk PO generation + complete document flow + proposal view redesign`) addresses every gap listed above. See `docs/purchase-order-flow.md` for the post-change architecture.
