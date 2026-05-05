/**
 * copilotExecEstimates.ts — Estimate & invoice executors for the AI copilot.
 *
 * Handles: createEstimate, createInvoice, listEstimates, listInvoices, updateInvoiceStatus
 */
import { getDb } from "../db";
import {
  clients, products, proposals, proposalProducts,
  estimates, estimateLineItems, invoices,
  type EstStatus,
} from "../../drizzle/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { buildToolScope } from "./copilotExecScope";
import { nextDocumentNumber } from "../utils/documentNumbers";

export async function executeCreateEstimate(userId: number, organizationId: number | null, args: {
  proposalId: number; tax?: string; shipping?: string; notes?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const proposalRows = await db.select().from(proposals)
    .where(and(eq(proposals.id, args.proposalId), scope.proposals)).limit(1);
  if (proposalRows.length === 0) return { error: `Proposal ID ${args.proposalId} not found` };

  const proposal = proposalRows[0];

  const ppRows = await db.select().from(proposalProducts)
    .where(eq(proposalProducts.proposalId, args.proposalId));
  const productIds = ppRows.map(pp => pp.productId);
  const productRows = productIds.length > 0
    ? await db.select().from(products).where(scope.products)
    : [];
  const productMap = new Map(productRows.map(p => [p.id, p]));

  const lineItems = ppRows.map(pp => {
    const prod = productMap.get(pp.productId);
    const unitPrice = parseFloat(pp.unitPrice?.toString() || prod?.basePrice?.toString() || "0");
    const qty = pp.quantity || 1;
    return {
      productName: prod?.name || "Product",
      sku: prod?.sku || null,
      color: null, size: null,
      quantity: qty,
      unitPrice,
      totalPrice: unitPrice * qty,
      imageUrl: prod?.imageUrl || null,
    };
  });

  const subtotal = lineItems.reduce((sum, li) => sum + li.totalPrice, 0);
  const tax = parseFloat(args.tax || "0");
  const shipping = parseFloat(args.shipping || "0");
  const total = subtotal + tax + shipping;

  const estimateNumber = await nextDocumentNumber(organizationId, userId, "est");

  const result = await db.insert(estimates).values({
    userId,
    // Audit fix #17: stamp organizationId so team members share estimates
    organizationId: organizationId ?? null,
    proposalId: args.proposalId,
    clientId: proposal.clientId,
    estimateNumber,
    status: "draft" as const,
    lineItems: lineItems as Array<{ productName: string; sku: string | null; color: string | null; size: string | null; quantity: number; unitPrice: number; totalPrice: number; imageUrl: string | null }>,
    subtotal: subtotal.toFixed(2),
    tax: tax.toFixed(2),
    shipping: shipping.toFixed(2),
    total: total.toFixed(2),
    notes: args.notes || null,
  });

  const estimateId = Number(result[0].insertId);
  return {
    success: true, estimateId, estimateNumber,
    proposalTitle: proposal.title, total: total.toFixed(2),
    itemCount: lineItems.length,
  };
}

export async function executeCreateInvoice(userId: number, organizationId: number | null, args: {
  proposalId?: number; estimateId?: number; tax?: string; shipping?: string;
  notes?: string; dueDate?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  let clientId: number;
  let lineItems: Array<{ productName: string; sku: string | null; color: string | null; size: string | null; quantity: number; unitPrice: number; totalPrice: number; imageUrl: string | null }>;
  let subtotal: number;
  let sourceProposalId: number | null = null;
  let sourceEstimateId: number | null = null;

  if (args.estimateId) {
    // Audit fix #17: use scope.estimates so team members can convert org-shared estimates
    const estRows = await db.select().from(estimates)
      .where(and(eq(estimates.id, args.estimateId), scope.estimates)).limit(1);
    if (estRows.length === 0) return { error: `Estimate ID ${args.estimateId} not found` };

    const est = estRows[0];
    clientId = est.clientId;

    // Prefer the relational tables (estimateLineItems) — every estimate
    // created post-0089 lives there. Fall back to the deprecated JSON
    // column only when the relational tables are empty (which only
    // happens on legacy rows that somehow escaped backfill).
    const itemRows = await db.select().from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, est.id))
      .orderBy(asc(estimateLineItems.sortOrder), asc(estimateLineItems.id));
    if (itemRows.length > 0) {
      lineItems = itemRows.map(r => ({
        productName: r.description,
        sku: r.sku,
        color: r.color,
        size: r.size,
        quantity: parseFloat(r.quantity),
        unitPrice: parseFloat(r.unitPrice),
        totalPrice: parseFloat(r.lineTotal),
        imageUrl: r.imageUrl,
      }));
    } else {
      lineItems = (est.lineItems ?? []) as Array<{ productName: string; sku: string | null; color: string | null; size: string | null; quantity: number; unitPrice: number; totalPrice: number; imageUrl: string | null }>;
    }
    subtotal = parseFloat(est.subtotal?.toString() || "0");
    sourceEstimateId = est.id;
    sourceProposalId = est.proposalId;

    await db.update(estimates).set({ status: "converted" }).where(and(eq(estimates.id, args.estimateId), scope.estimates));
  } else if (args.proposalId) {
    const proposalRows = await db.select().from(proposals)
      .where(and(eq(proposals.id, args.proposalId), scope.proposals)).limit(1);
    if (proposalRows.length === 0) return { error: `Proposal ID ${args.proposalId} not found` };

    const proposal = proposalRows[0];
    clientId = proposal.clientId;
    sourceProposalId = proposal.id;

    const ppRows = await db.select().from(proposalProducts)
      .where(eq(proposalProducts.proposalId, args.proposalId));
    const productRows = await db.select().from(products).where(scope.products);
    const productMap = new Map(productRows.map(p => [p.id, p]));

    lineItems = ppRows.map(pp => {
      const prod = productMap.get(pp.productId);
      const unitPrice = parseFloat(pp.unitPrice?.toString() || prod?.basePrice?.toString() || "0");
      const qty = pp.quantity || 1;
      return {
        productName: prod?.name || "Product", sku: prod?.sku || null,
        color: null, size: null, quantity: qty, unitPrice,
        totalPrice: unitPrice * qty, imageUrl: prod?.imageUrl || null,
      };
    });
    subtotal = lineItems.reduce((sum, li) => sum + li.totalPrice, 0);
  } else {
    return { error: "Must provide either proposalId or estimateId" };
  }

  const tax = parseFloat(args.tax || "0");
  const shipping = parseFloat(args.shipping || "0");
  const total = subtotal + tax + shipping;
  const invoiceNumber = await nextDocumentNumber(organizationId, userId, "inv");

  const result = await db.insert(invoices).values({
    userId,
    // Audit fix #17: stamp organizationId so team members share invoices
    organizationId: organizationId ?? null,
    proposalId: sourceProposalId,
    estimateId: sourceEstimateId,
    clientId,
    invoiceNumber,
    status: "draft" as const,
    lineItems: lineItems as Array<{ productName: string; sku: string | null; color: string | null; size: string | null; quantity: number; unitPrice: number; totalPrice: number; imageUrl: string | null }>,
    subtotal: subtotal.toFixed(2),
    tax: tax.toFixed(2),
    shipping: shipping.toFixed(2),
    total: total.toFixed(2),
    notes: args.notes || null,
    dueDate: args.dueDate ? new Date(args.dueDate) : null,
  });

  const invoiceId = Number(result[0].insertId);

  // Get client name
  let clientName = "Unknown";
  const clientRows = await db.select({ companyName: clients.companyName }).from(clients)
    .where(eq(clients.id, clientId)).limit(1);
  if (clientRows.length > 0) clientName = clientRows[0].companyName;

  return {
    success: true, invoiceId, invoiceNumber,
    clientName, total: total.toFixed(2),
    itemCount: lineItems.length,
    convertedFromEstimate: !!args.estimateId,
  };
}

export async function executeListEstimates(userId: number, organizationId: number | null, args: { status?: string; clientId?: number; limit?: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  // Audit fix #17: use scope.estimates so team members see org-shared estimates
  const conditions = [scope.estimates];
  if (args.status) conditions.push(eq(estimates.status, args.status as EstStatus));
  if (args.clientId) conditions.push(eq(estimates.clientId, args.clientId));

  const rows = await db.select().from(estimates)
    .where(and(...conditions))
    .orderBy(desc(estimates.createdAt))
    .limit(args.limit || 20);

  const clientIds = Array.from(new Set(rows.map(r => r.clientId))) as number[];
  const clientMap = new Map<number, string>();
  if (clientIds.length > 0) {
    const clientRows = await db.select({ id: clients.id, companyName: clients.companyName }).from(clients)
      .where(scope.clients);
    clientRows.forEach(c => clientMap.set(c.id, c.companyName));
  }

  return {
    count: rows.length,
    estimates: rows.map(r => ({
      id: r.id, estimateNumber: r.estimateNumber, status: r.status,
      clientName: clientMap.get(r.clientId) || "Unknown",
      total: r.total, createdAt: r.createdAt,
    })),
  };
}

export async function executeListInvoices(userId: number, organizationId: number | null, args: { status?: string; clientId?: number; limit?: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  // Audit fix #17: use scope.invoices so team members see org-shared invoices
  const conditions = [scope.invoices];
  if (args.status) conditions.push(eq(invoices.status, args.status as "draft" | "sent" | "paid" | "overdue" | "cancelled" | "void" | "refunded" | "partially_refunded" | "credit_issued"));
  if (args.clientId) conditions.push(eq(invoices.clientId, args.clientId));

  const rows = await db.select().from(invoices)
    .where(and(...conditions))
    .orderBy(desc(invoices.createdAt))
    .limit(args.limit || 20);

  const clientIds = Array.from(new Set(rows.map(r => r.clientId))) as number[];
  const clientMap = new Map<number, string>();
  if (clientIds.length > 0) {
    const clientRows = await db.select({ id: clients.id, companyName: clients.companyName }).from(clients)
      .where(scope.clients);
    clientRows.forEach(c => clientMap.set(c.id, c.companyName));
  }

  return {
    count: rows.length,
    invoices: rows.map(r => ({
      id: r.id, invoiceNumber: r.invoiceNumber, status: r.status,
      clientName: clientMap.get(r.clientId) || "Unknown",
      total: r.total, dueDate: r.dueDate, paidAt: r.paidAt, createdAt: r.createdAt,
    })),
  };
}

export async function executeUpdateInvoiceStatus(userId: number, organizationId: number | null, args: { invoiceId: number; status: string }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  // Audit fix #17: use scope.invoices so team members can update org-shared invoices
  const existing = await db.select().from(invoices)
    .where(and(eq(invoices.id, args.invoiceId), scope.invoices)).limit(1);
  if (existing.length === 0) return { error: `Invoice ID ${args.invoiceId} not found` };

  const updates: Record<string, any> = { status: args.status };
  if (args.status === "paid") updates.paidAt = new Date();

  await db.update(invoices).set(updates).where(and(eq(invoices.id, args.invoiceId), scope.invoices));
  return { success: true, invoiceId: args.invoiceId, invoiceNumber: existing[0].invoiceNumber, newStatus: args.status };
}
