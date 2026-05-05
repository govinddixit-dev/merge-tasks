/**
 * agentActionDetails.ts — Resolves rich detail context for an Agent Inbox card.
 *
 * Given a `copilotPendingActions` row created by an agent trigger, this module
 * fetches the affected business records (client, proposal, order, etc.) and
 * composes:
 *   • explanation       — why the agent flagged this action
 *   • affectedRecords[] — entities the user should review, with deep-link hrefs
 *                         when a UI route exists
 *   • recommendedActions[] — concrete next steps the user can take from the
 *                            detail view (approve, dismiss, navigate, edit
 *                            email, etc.). The UI maps `kind` to a button
 *                            without re-implementing per-trigger logic.
 *
 * All reads are scoped via getOrgScope() — the caller must already have
 * verified that the pending action belongs to the current tenant.
 *
 * Never throws on missing data. Returns degraded but well-typed results so
 * the UI always has something to render even if a referenced entity has been
 * deleted since the action was queued.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import {
  clients,
  customOrderRequests,
  invoices,
  orderItems,
  orders,
  productImprintZones,
  products,
  proposalProducts,
  proposals,
  storeProducts,
  stores,
  suppliers,
  supplierCostChangeLog,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { getLogger } from "./logger";
import type { OrgScope } from "./orgScope";

const log = getLogger("agentActionDetails");

export type AffectedRecordType =
  | "client"
  | "proposal"
  | "order"
  | "invoice"
  | "store"
  | "supplier"
  | "product"
  | "custom_order_request"
  | "purchase_order";

export interface AffectedRecord {
  type: AffectedRecordType;
  id: number;
  label: string;
  sublabel?: string;
  /** App route to navigate to. Omitted when no detail page exists for this type. */
  href?: string;
}

export type RecommendedActionKind =
  | "approve"
  | "edit_email"
  | "dismiss"
  | "navigate"
  | "review_proposal";

export interface RecommendedAction {
  kind: RecommendedActionKind;
  label: string;
  /** When kind === "navigate" or "review_proposal" the UI uses this. */
  href?: string;
  tone: "primary" | "secondary" | "danger";
  description?: string;
}

export interface ActionDetails {
  pendingActionId: number;
  toolName: string;
  triggerType: string;
  summary: string;
  source: string | null;
  status: "pending" | "approved" | "denied";
  createdAt: Date;
  args: Record<string, unknown>;
  /** One paragraph explaining why the agent created this action. */
  explanation: string;
  affectedRecords: AffectedRecord[];
  recommendedActions: RecommendedAction[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const NUMBER_FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function fmtCurrency(raw: unknown): string {
  if (raw == null) return "—";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  return NUMBER_FMT_USD.format(n);
}

function asNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim() !== "") return raw;
  return null;
}

/* ------------------------------------------------------------------ */
/*  Per-trigger record resolvers                                        */
/* ------------------------------------------------------------------ */

interface ResolverContext {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  scope: OrgScope;
  args: Record<string, unknown>;
  toolName: string;
  triggerType: string;
  summary: string;
}

interface ResolverResult {
  explanation: string;
  affectedRecords: AffectedRecord[];
  recommendedActions: RecommendedAction[];
}

/**
 * Look up a client by id under the caller's org scope. Returns null when the
 * client has been deleted or belongs to another tenant.
 */
async function loadClient(
  ctx: ResolverContext,
  clientId: number,
): Promise<{ id: number; companyName: string; contactEmail: string | null; industry: string | null } | null> {
  const [row] = await ctx.db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      contactEmail: clients.contactEmail,
      industry: clients.industry,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), ctx.scope.clients))
    .limit(1);
  return row ?? null;
}

async function loadProposal(
  ctx: ResolverContext,
  proposalId: number,
): Promise<{
  id: number;
  title: string;
  status: string;
  estimatedValue: string | null;
  clientId: number;
  validDays: number;
  sentAt: Date | null;
  viewedAt: Date | null;
} | null> {
  const [row] = await ctx.db
    .select({
      id: proposals.id,
      title: proposals.title,
      status: proposals.status,
      estimatedValue: proposals.estimatedValue,
      clientId: proposals.clientId,
      validDays: proposals.validDays,
      sentAt: proposals.sentAt,
      viewedAt: proposals.viewedAt,
    })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), ctx.scope.proposals))
    .limit(1);
  return row ?? null;
}

async function loadInvoice(
  ctx: ResolverContext,
  invoiceId: number,
): Promise<{
  id: number;
  invoiceNumber: string;
  status: string;
  total: string;
  dueDate: Date | null;
  clientId: number;
} | null> {
  const [row] = await ctx.db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      total: invoices.total,
      dueDate: invoices.dueDate,
      clientId: invoices.clientId,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), ctx.scope.invoices))
    .limit(1);
  return row ?? null;
}

async function loadStore(
  ctx: ResolverContext,
  storeId: number,
): Promise<{ id: number; name: string; status: string; clientId: number | null; slug: string } | null> {
  const [row] = await ctx.db
    .select({
      id: stores.id,
      name: stores.name,
      status: stores.status,
      clientId: stores.clientId,
      slug: stores.slug,
    })
    .from(stores)
    .where(and(eq(stores.id, storeId), ctx.scope.stores))
    .limit(1);
  return row ?? null;
}

async function loadOrder(
  ctx: ResolverContext,
  orderId: number,
): Promise<{
  id: number;
  orderNumber: string;
  status: string;
  total: string;
  clientId: number;
  storeId: number | null;
  createdAt: Date;
} | null> {
  const [row] = await ctx.db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      total: orders.total,
      clientId: orders.clientId,
      storeId: orders.storeId,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(and(eq(orders.id, orderId), ctx.scope.orders))
    .limit(1);
  return row ?? null;
}

function clientRecord(row: { id: number; companyName: string; industry: string | null }): AffectedRecord {
  return {
    type: "client",
    id: row.id,
    label: row.companyName,
    sublabel: row.industry ?? undefined,
    href: `/clients?clientId=${row.id}`,
  };
}

function proposalRecord(row: { id: number; title: string; status: string; estimatedValue: string | null }): AffectedRecord {
  return {
    type: "proposal",
    id: row.id,
    label: row.title,
    sublabel: `${row.status} · ${fmtCurrency(row.estimatedValue)}`,
    href: `/proposals/${row.id}`,
  };
}

function invoiceRecord(row: { id: number; invoiceNumber: string; status: string; total: string; dueDate: Date | null }): AffectedRecord {
  const due = row.dueDate ? `due ${row.dueDate.toISOString().slice(0, 10)}` : null;
  return {
    type: "invoice",
    id: row.id,
    label: row.invoiceNumber,
    sublabel: [row.status, fmtCurrency(row.total), due].filter(Boolean).join(" · "),
    href: `/invoices/${row.id}`,
  };
}

function storeRecord(row: { id: number; name: string; status: string }): AffectedRecord {
  return {
    type: "store",
    id: row.id,
    label: row.name,
    sublabel: row.status,
    href: `/store-management/${row.id}`,
  };
}

function orderRecord(row: { id: number; orderNumber: string; status: string; total: string }): AffectedRecord {
  // No dedicated /orders/:id route in the app today — surface the entity but
  // omit href so the UI renders as a labelled chip instead of a dead link.
  return {
    type: "order",
    id: row.id,
    label: row.orderNumber,
    sublabel: `${row.status} · ${fmtCurrency(row.total)}`,
  };
}

function approveAction(label: string, description?: string): RecommendedAction {
  return { kind: "approve", label, tone: "primary", description };
}

function dismissAction(): RecommendedAction {
  return { kind: "dismiss", label: "Dismiss", tone: "danger" };
}

function editEmailAction(): RecommendedAction {
  return {
    kind: "edit_email",
    label: "Edit & Approve",
    tone: "secondary",
    description: "Open the email draft to polish the subject or body before sending.",
  };
}

function navigateAction(label: string, href: string, description?: string): RecommendedAction {
  return { kind: "navigate", label, href, tone: "secondary", description };
}

/* ------------------------------------------------------------------ */
/*  Trigger-specific resolvers                                          */
/* ------------------------------------------------------------------ */

async function resolveProposalLifecycle(
  ctx: ResolverContext,
  variant: "viewed" | "expiring" | "accepted",
): Promise<ResolverResult> {
  const proposalId = asNumber(ctx.args.entityId) ?? asNumber(ctx.args.proposalId);
  const records: AffectedRecord[] = [];
  let proposal: Awaited<ReturnType<typeof loadProposal>> = null;
  let client: Awaited<ReturnType<typeof loadClient>> = null;
  if (proposalId) {
    proposal = await loadProposal(ctx, proposalId);
    if (proposal) {
      records.push(proposalRecord(proposal));
      client = await loadClient(ctx, proposal.clientId);
      if (client) records.push(clientRecord(client));
    }
  }

  const valueLine = proposal?.estimatedValue ? ` Estimated value ${fmtCurrency(proposal.estimatedValue)}.` : "";
  const explanation = (() => {
    switch (variant) {
      case "viewed":
        return `${client?.companyName ?? "The client"} just opened your proposal "${proposal?.title ?? "—"}". This is a high-intent moment; a warm follow-up that anticipates common questions usually moves the deal forward.${valueLine}`;
      case "expiring": {
        const days = asNumber(ctx.args.daysUntilExpiry);
        const tail = days != null ? ` It expires in ${days} day${days === 1 ? "" : "s"}.` : "";
        return `Your proposal "${proposal?.title ?? "—"}" for ${client?.companyName ?? "this client"} hasn't been accepted yet and the validity window is closing.${tail} A gentle nudge often unblocks a stalled decision.${valueLine}`;
      }
      case "accepted":
        return `${client?.companyName ?? "The client"} accepted "${proposal?.title ?? "—"}". A confirmation email outlining proof review, production timeline, and invoicing keeps the kickoff momentum.${valueLine}`;
    }
  })();

  const recommended: RecommendedAction[] = [];
  if (ctx.toolName === "send_custom_email") {
    recommended.push(approveAction("Approve & Send Email"));
    recommended.push(editEmailAction());
  }
  if (proposal) {
    recommended.push(navigateAction("Open Proposal", `/proposals/${proposal.id}`));
  }
  recommended.push(dismissAction());

  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

async function resolveInvoiceOverdue(ctx: ResolverContext): Promise<ResolverResult> {
  const invoiceId = asNumber(ctx.args.entityId) ?? asNumber(ctx.args.invoiceId);
  const records: AffectedRecord[] = [];
  let invoice: Awaited<ReturnType<typeof loadInvoice>> = null;
  let client: Awaited<ReturnType<typeof loadClient>> = null;
  if (invoiceId) {
    invoice = await loadInvoice(ctx, invoiceId);
    if (invoice) {
      records.push(invoiceRecord(invoice));
      client = await loadClient(ctx, invoice.clientId);
      if (client) records.push(clientRecord(client));
    }
  }

  const days = asNumber(ctx.args.daysOverdue);
  const total = invoice?.total ?? null;
  const explanation =
    `Invoice ${invoice?.invoiceNumber ?? ""} for ${client?.companyName ?? "this client"} is ` +
    `${days != null ? `${days} day${days === 1 ? "" : "s"} overdue` : "past due"}` +
    `${total ? ` (${fmtCurrency(total)})` : ""}. ` +
    `The agent drafted a collection email tuned for this severity — friendly under a week, firmer past three.`;

  const recommended: RecommendedAction[] = [];
  if (ctx.toolName === "send_custom_email") {
    recommended.push(approveAction("Approve & Send Email"));
    recommended.push(editEmailAction());
  }
  if (invoice) {
    recommended.push(navigateAction("Open Invoice", `/invoices/${invoice.id}`));
  }
  recommended.push(dismissAction());
  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

async function resolveClientCentric(
  ctx: ResolverContext,
  variant: "new_client" | "client_dormant" | "reorder_window" | "predictive_opportunity",
): Promise<ResolverResult> {
  const clientId = asNumber(ctx.args.entityId) ?? asNumber(ctx.args.clientId);
  const records: AffectedRecord[] = [];
  let client: Awaited<ReturnType<typeof loadClient>> = null;
  if (clientId) {
    client = await loadClient(ctx, clientId);
    if (client) records.push(clientRecord(client));

    // Surface the most recent order so the user has at-a-glance history.
    const recent = await ctx.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        total: orders.total,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(eq(orders.clientId, clientId), ctx.scope.orders))
      .orderBy(desc(orders.createdAt))
      .limit(3);
    for (const o of recent) {
      records.push({
        type: "order",
        id: o.id,
        label: o.orderNumber,
        sublabel: `${o.status} · ${fmtCurrency(o.total)} · ${o.createdAt.toISOString().slice(0, 10)}`,
      });
    }
  }

  const explanation = (() => {
    switch (variant) {
      case "new_client":
        return `${client?.companyName ?? "A new client"} was just added to your book of business${client?.industry ? ` (${client.industry})` : ""}. The agent drafted a welcome introduction that explains your services and proposes a short intro conversation.`;
      case "client_dormant": {
        const days = asNumber(ctx.args.daysSinceLastOrder);
        return `${client?.companyName ?? "This client"} hasn't ordered in ${days != null ? `${days} days` : "a while"}. The agent prepared a low-friction re-engagement note that references their last order rather than pushing a sale.`;
      }
      case "reorder_window":
        return `${client?.companyName ?? "This client"} is approaching the one-year anniversary of their last order. Annual swag, uniform refreshes, and event giveaways are common reorder moments — the draft offers to prepare a refreshed proposal based on what they bought before.`;
      case "predictive_opportunity": {
        const pattern = asString(ctx.args.patternSummary);
        const conf = asNumber(ctx.args.confidence);
        const value = asNumber(ctx.args.predictedValue);
        const segs = [
          pattern ? `Detected pattern: ${pattern}.` : "",
          conf != null ? `Pattern confidence ${Math.round(conf * 100)}%.` : "",
          value != null && value > 0 ? `Average prior order value ${fmtCurrency(value)}.` : "",
        ].filter(Boolean);
        return `${client?.companyName ?? "This client"} has a recurring ordering pattern that's about to come due. ${segs.join(" ")} A pattern-aware outreach lands ahead of the next reorder window.`;
      }
    }
  })();

  const recommended: RecommendedAction[] = [];
  if (ctx.toolName === "send_custom_email") {
    recommended.push(approveAction("Approve & Send Email"));
    recommended.push(editEmailAction());
  }
  if (client) {
    recommended.push(navigateAction("View Client", `/clients?clientId=${client.id}`));
  }
  recommended.push(dismissAction());
  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

async function resolveOrderDelivered(ctx: ResolverContext): Promise<ResolverResult> {
  const orderId = asNumber(ctx.args.entityId) ?? asNumber(ctx.args.orderId);
  const records: AffectedRecord[] = [];
  let order: Awaited<ReturnType<typeof loadOrder>> = null;
  let client: Awaited<ReturnType<typeof loadClient>> = null;
  if (orderId) {
    order = await loadOrder(ctx, orderId);
    if (order) {
      records.push(orderRecord(order));
      client = await loadClient(ctx, order.clientId);
      if (client) records.push(clientRecord(client));
      if (order.storeId) {
        const store = await loadStore(ctx, order.storeId);
        if (store) records.push(storeRecord(store));
      }
    }
  }

  const explanation =
    `${client?.companyName ?? "This client"} just received their order${order ? ` (${order.orderNumber})` : ""}. ` +
    `The agent drafted a 7-day post-delivery check-in that asks how the items landed and softly opens the door to a next order.`;

  const recommended: RecommendedAction[] = [];
  if (ctx.toolName === "send_custom_email") {
    recommended.push(approveAction("Approve & Send Email"));
    recommended.push(editEmailAction());
  }
  if (client) recommended.push(navigateAction("View Client", `/clients?clientId=${client.id}`));
  recommended.push(dismissAction());
  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

async function resolveStoreCentric(
  ctx: ResolverContext,
  variant: "store_created" | "store_low_engagement",
): Promise<ResolverResult> {
  const storeId = asNumber(ctx.args.entityId) ?? asNumber(ctx.args.storeId);
  const records: AffectedRecord[] = [];
  let store: Awaited<ReturnType<typeof loadStore>> = null;
  let client: Awaited<ReturnType<typeof loadClient>> = null;
  if (storeId) {
    store = await loadStore(ctx, storeId);
    if (store) {
      records.push(storeRecord(store));
      if (store.clientId) {
        client = await loadClient(ctx, store.clientId);
        if (client) records.push(clientRecord(client));
      }
    }
  }

  const explanation = (() => {
    switch (variant) {
      case "store_created":
        return `${store?.name ?? "A new store"} was just created${client ? ` for ${client.companyName}` : ""}. The agent assembled a launch checklist — branding, catalog scaffold, and a first-month engagement plan.`;
      case "store_low_engagement": {
        const days = asNumber(ctx.args.daysSinceLaunch);
        return `${store?.name ?? "This store"} has been live for ${days != null ? `${days} days` : "a while"} but engagement is below the launch baseline. The agent's proposal covers promo campaigns, product refreshes, and direct outreach to the buyer contact.`;
      }
    }
  })();

  const recommended: RecommendedAction[] = [];
  if (ctx.toolName === "send_custom_email") {
    recommended.push(approveAction("Approve & Send Email"));
    recommended.push(editEmailAction());
  } else {
    recommended.push(approveAction("Approve Suggestion"));
  }
  if (store) recommended.push(navigateAction("Open Store", `/store-management/${store.id}`));
  recommended.push(dismissAction());
  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

async function resolveCustomOrderRequest(ctx: ResolverContext): Promise<ResolverResult> {
  const requestId = asNumber(ctx.args.entityId) ?? asNumber(ctx.args.requestId);
  const records: AffectedRecord[] = [];
  let request:
    | { id: number; title: string; description: string; quantity: number | null; storeId: number; status: string }
    | null = null;
  let store: Awaited<ReturnType<typeof loadStore>> = null;
  if (requestId) {
    const [row] = await ctx.db
      .select({
        id: customOrderRequests.id,
        title: customOrderRequests.title,
        description: customOrderRequests.description,
        quantity: customOrderRequests.quantity,
        storeId: customOrderRequests.storeId,
        status: customOrderRequests.status,
      })
      .from(customOrderRequests)
      .innerJoin(stores, eq(stores.id, customOrderRequests.storeId))
      .where(and(eq(customOrderRequests.id, requestId), ctx.scope.stores))
      .limit(1);
    request = row ?? null;
    if (request) {
      records.push({
        type: "custom_order_request",
        id: request.id,
        label: request.title,
        sublabel: `${request.status}${request.quantity ? ` · qty ${request.quantity}` : ""}`,
      });
      store = await loadStore(ctx, request.storeId);
      if (store) records.push(storeRecord(store));
    }
  }

  const explanation = request
    ? `A buyer on ${store?.name ?? "the storefront"} submitted a custom request: "${request.title}". The agent's proposal sketches a pricing estimate, fulfillment path (existing catalog vs. sourcing), and timeline so you can reply quickly.`
    : `A buyer submitted a custom order request. The agent's proposal sketches a pricing estimate, fulfillment path, and timeline.`;

  const recommended: RecommendedAction[] = [approveAction("Approve Suggestion")];
  if (store) recommended.push(navigateAction("Open Store", `/store-management/${store.id}`));
  recommended.push(dismissAction());
  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

async function resolvePredictiveProposalDraft(ctx: ResolverContext): Promise<ResolverResult> {
  const proposalId = asNumber(ctx.args.proposalId);
  const records: AffectedRecord[] = [];
  let proposal: Awaited<ReturnType<typeof loadProposal>> = null;
  let client: Awaited<ReturnType<typeof loadClient>> = null;
  let lineCount = 0;
  if (proposalId) {
    proposal = await loadProposal(ctx, proposalId);
    if (proposal) {
      records.push(proposalRecord(proposal));
      client = await loadClient(ctx, proposal.clientId);
      if (client) records.push(clientRecord(client));
      const [{ cnt }] = await ctx.db
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(proposalProducts)
        .where(eq(proposalProducts.proposalId, proposal.id));
      lineCount = Number(cnt ?? 0);
    }
  }

  const value = proposal?.estimatedValue ? fmtCurrency(proposal.estimatedValue) : null;
  const explanation =
    `Based on ${client?.companyName ?? "this client"}'s ordering pattern, the agent pre-built a draft proposal` +
    `${value ? ` worth ${value}` : ""}` +
    `${lineCount ? ` with ${lineCount} line item${lineCount === 1 ? "" : "s"} copied from their last order` : ""}. ` +
    `Review and send when ready — nothing is shared with the client until you do.`;

  const recommended: RecommendedAction[] = [];
  if (proposal) {
    recommended.push({
      kind: "review_proposal",
      label: "Review Draft",
      tone: "primary",
      href: `/edit-proposal/${proposal.id}`,
      description: "Open the proposal editor to refine and send.",
    });
  }
  recommended.push(dismissAction());
  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

async function resolveSupplierCostChange(ctx: ResolverContext): Promise<ResolverResult> {
  const supplierId = asNumber(ctx.args.supplierId);
  const records: AffectedRecord[] = [];
  let supplier: { id: number; name: string } | null = null;
  let recentChanges: Array<{
    productName: string;
    previousCostCents: number | null;
    newCostCents: number;
  }> = [];
  if (supplierId) {
    const [row] = await ctx.db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), ctx.scope.suppliers))
      .limit(1);
    supplier = row ?? null;
    if (supplier) {
      records.push({ type: "supplier", id: supplier.id, label: supplier.name });

      const changes = await ctx.db
        .select({
          productName: products.name,
          previousCostCents: supplierCostChangeLog.previousCostCents,
          newCostCents: supplierCostChangeLog.newCostCents,
        })
        .from(supplierCostChangeLog)
        .innerJoin(products, eq(products.id, supplierCostChangeLog.productId))
        .where(eq(supplierCostChangeLog.supplierId, supplier.id))
        .orderBy(desc(supplierCostChangeLog.createdAt))
        .limit(5);
      recentChanges = changes.map((c) => ({
        productName: c.productName,
        previousCostCents: c.previousCostCents,
        newCostCents: c.newCostCents,
      }));
      for (const c of recentChanges) {
        const prev = c.previousCostCents != null ? `$${(c.previousCostCents / 100).toFixed(2)}` : "—";
        const now = `$${(c.newCostCents / 100).toFixed(2)}`;
        records.push({
          type: "product",
          id: -1, // logical link only — no detail page for catalog product
          label: c.productName,
          sublabel: `${prev} → ${now}`,
        });
      }
    }
  }

  const inc = asNumber(ctx.args.increaseCount) ?? 0;
  const dec = asNumber(ctx.args.decreaseCount) ?? 0;
  const explanation =
    `${supplier?.name ?? "A supplier"} updated pricing — ${inc} increase${inc === 1 ? "" : "s"} and ${dec} decrease${dec === 1 ? "" : "s"} since the last sync. ` +
    `Review the affected lines so client margins and active proposals stay accurate.`;

  return {
    explanation,
    affectedRecords: records,
    recommendedActions: [approveAction("Mark as Reviewed"), dismissAction()],
  };
}

async function resolveStoreZoneHealth(ctx: ResolverContext): Promise<ResolverResult> {
  const storeId = asNumber(ctx.args.storeId);
  const records: AffectedRecord[] = [];
  let store: Awaited<ReturnType<typeof loadStore>> = null;
  let unzonedProducts: Array<{ id: number; name: string }> = [];
  if (storeId) {
    store = await loadStore(ctx, storeId);
    if (store) {
      records.push(storeRecord(store));
      const rows = await ctx.db
        .select({ id: products.id, name: products.name })
        .from(storeProducts)
        .innerJoin(products, eq(products.id, storeProducts.productId))
        .leftJoin(productImprintZones, eq(productImprintZones.productId, storeProducts.productId))
        .where(eq(storeProducts.storeId, store.id))
        .groupBy(products.id, products.name)
        .having(sql`COUNT(${productImprintZones.id}) = 0`)
        .limit(10);
      unzonedProducts = rows;
      for (const p of unzonedProducts) {
        records.push({ type: "product", id: p.id, label: p.name, sublabel: "no imprint zone" });
      }
    }
  }

  const count = asNumber(ctx.args.unzonedCount) ?? unzonedProducts.length;
  const explanation =
    `${store?.name ?? "This store"} has ${count} product${count === 1 ? "" : "s"} with no imprint zones configured. ` +
    `Buyers see the unbranded source image instead of the decorated mockup, which suppresses conversion. Configure the zones to restore branded previews.`;

  const recommended: RecommendedAction[] = [];
  if (store) recommended.push(navigateAction("Open Store", `/store-management/${store.id}`));
  recommended.push(approveAction("Mark as Reviewed"));
  recommended.push(dismissAction());
  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

async function resolveSeasonalStoreOpportunity(ctx: ResolverContext): Promise<ResolverResult> {
  const storeId = asNumber(ctx.args.storeId);
  const records: AffectedRecord[] = [];
  let store: Awaited<ReturnType<typeof loadStore>> = null;
  let client: Awaited<ReturnType<typeof loadClient>> = null;
  if (storeId) {
    store = await loadStore(ctx, storeId);
    if (store) {
      records.push(storeRecord(store));
      if (store.clientId) {
        client = await loadClient(ctx, store.clientId);
        if (client) records.push(clientRecord(client));
      }
    }
  }

  const seasonHint = asString(ctx.args.seasonHint) ?? "the current season";
  const explanation =
    `${store?.name ?? "This store"}${client ? ` (${client.companyName})` : ""} hasn't seen an order in 45+ days, and right now is ${seasonHint}. ` +
    `Refreshing the catalog or sending a seasonal promo typically wakes the store back up.`;

  const recommended: RecommendedAction[] = [];
  if (store) recommended.push(navigateAction("Open Store", `/store-management/${store.id}`));
  recommended.push(approveAction("Mark as Reviewed"));
  recommended.push(dismissAction());
  return { explanation, affectedRecords: records, recommendedActions: recommended };
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Resolve detail context for a pending action. Caller must pass the row's
 * own `serializedArgs` and `toolName` already validated under their org.
 */
export async function resolveActionDetails(args: {
  scope: OrgScope;
  toolName: string;
  summary: string;
  triggerType: string;
  parsedArgs: Record<string, unknown>;
}): Promise<{
  explanation: string;
  affectedRecords: AffectedRecord[];
  recommendedActions: RecommendedAction[];
}> {
  const db = await getDb();
  if (!db) {
    return {
      explanation: args.summary,
      affectedRecords: [],
      recommendedActions: [dismissAction()],
    };
  }

  const ctx: ResolverContext = {
    db,
    scope: args.scope,
    args: args.parsedArgs,
    toolName: args.toolName,
    triggerType: args.triggerType,
    summary: args.summary,
  };

  try {
    switch (args.triggerType) {
      case "proposal_viewed":
        return await resolveProposalLifecycle(ctx, "viewed");
      case "proposal_expiring":
        return await resolveProposalLifecycle(ctx, "expiring");
      case "proposal_accepted":
        return await resolveProposalLifecycle(ctx, "accepted");
      case "invoice_overdue":
        return await resolveInvoiceOverdue(ctx);
      case "new_client":
        return await resolveClientCentric(ctx, "new_client");
      case "client_dormant":
        return await resolveClientCentric(ctx, "client_dormant");
      case "reorder_window":
        return await resolveClientCentric(ctx, "reorder_window");
      case "predictive_opportunity":
        return await resolveClientCentric(ctx, "predictive_opportunity");
      case "order_delivered":
        return await resolveOrderDelivered(ctx);
      case "store_created":
        return await resolveStoreCentric(ctx, "store_created");
      case "store_low_engagement":
        return await resolveStoreCentric(ctx, "store_low_engagement");
      case "custom_order_request":
        return await resolveCustomOrderRequest(ctx);
      case "predictive_proposal_draft":
        return await resolvePredictiveProposalDraft(ctx);
      case "supplier_cost_change":
        return await resolveSupplierCostChange(ctx);
      case "store_zone_health":
        return await resolveStoreZoneHealth(ctx);
      case "seasonal_store_opportunity":
        return await resolveSeasonalStoreOpportunity(ctx);
      default: {
        const recommended: RecommendedAction[] = [];
        if (ctx.toolName === "send_custom_email") {
          recommended.push(approveAction("Approve & Send Email"));
          recommended.push(editEmailAction());
        } else {
          recommended.push(approveAction("Approve Suggestion"));
        }
        recommended.push(dismissAction());
        return {
          explanation: args.summary,
          affectedRecords: [],
          recommendedActions: recommended,
        };
      }
    }
  } catch (err: unknown) {
    log.warn("[agentActionDetails] Resolver failed:", err);
    return {
      explanation: args.summary,
      affectedRecords: [],
      recommendedActions: [dismissAction()],
    };
  }
}
