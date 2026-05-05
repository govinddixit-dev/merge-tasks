/**
 * copilotExecPurchaseOrders.ts — PO executors for the AI copilot.
 *
 * Handles: search_purchase_orders, generate_purchase_orders,
 *          get_po_details, get_margin_analysis
 *
 * SECURITY: Every query is scoped via buildToolScope() to prevent
 * cross-tenant data leakage.
 */
import { getDb } from "../db";
import {
  purchaseOrders, purchaseOrderEvents, orders, orderItems, products,
  proposals, proposalProducts, proposalOrderItems, poPreviewDrafts,
  type POLineItem,
} from "../../drizzle/schema";
import { eq, and, desc, or, like, inArray } from "drizzle-orm";
import { buildToolScope } from "./copilotExecScope";
import { groupBySupplier, type OrderItemWithProduct } from "../utils/supplierGrouping";
import { nextDocumentNumber } from "../utils/documentNumbers";
import { normalizeSupplierName } from "../utils/supplierNormalizer";
import { nanoid } from "nanoid";

// ── Helpers ─────────────────────────────────────────────────────────────────

function toFloat(val: unknown): number {
  return parseFloat(String(val ?? "0")) || 0;
}

// ── Executors ───────────────────────────────────────────────────────────────

export async function executeSearchPurchaseOrders(
  userId: number,
  organizationId: number | null,
  args: { query: string; status?: string },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const conditions = [scope.purchaseOrders];
  if (args.status) {
    conditions.push(eq(purchaseOrders.status, args.status as any));
  }

  // Search by PO number or supplier name
  conditions.push(
    or(
      like(purchaseOrders.poNumber, `%${args.query}%`),
      like(purchaseOrders.supplierName, `%${args.query}%`),
    )!,
  );

  const rows = await db.select().from(purchaseOrders)
    .where(and(...conditions))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(10);

  return {
    count: rows.length,
    purchaseOrders: rows.map(po => ({
      id: po.id,
      poNumber: po.poNumber,
      supplierName: po.supplierName,
      status: po.status,
      total: po.total,
      itemCount: (po.lineItems as POLineItem[]).length,
      orderId: po.orderId,
      createdAt: po.createdAt,
    })),
  };
}

export async function executeGeneratePurchaseOrders(
  userId: number,
  organizationId: number | null,
  args: { orderId: number },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  // Load order
  const [order] = await db.select().from(orders)
    .where(and(scope.orders, eq(orders.id, args.orderId)))
    .limit(1);
  if (!order) return { error: `Order ${args.orderId} not found` };

  // Check existing POs
  const existing = await db.select({ id: purchaseOrders.id }).from(purchaseOrders)
    .where(and(scope.purchaseOrders, eq(purchaseOrders.orderId, args.orderId)));
  if (existing.length > 0) {
    return { error: `POs already exist for order ${args.orderId}. Found ${existing.length} existing POs.` };
  }

  // Load items + products
  const oiRows = await db.select().from(orderItems).where(eq(orderItems.orderId, args.orderId));
  if (oiRows.length === 0) return { error: "Order has no items" };

  const productIds = oiRows.map(oi => oi.productId);
  const productRows = await db.select().from(products).where(inArray(products.id, productIds));
  const productMap = new Map(productRows.map(p => [p.id, p]));

  const itemsForGrouping: OrderItemWithProduct[] = oiRows.map(oi => {
    const p = productMap.get(oi.productId);
    return {
      orderItemId: oi.id,
      productId: oi.productId,
      productName: p?.name || `Product #${oi.productId}`,
      sku: p?.sku || null,
      category: p?.category || null,
      imageUrl: p?.imageUrl || null,
      basePrice: p?.basePrice || null,
      unitPrice: oi.unitPrice,
      quantity: oi.quantity,
      color: oi.color || null,
      size: oi.size || null,
      decorationType: oi.decorationType || null,
      decorationLocation: null,
      logoUrl: null,
      supplier: p?.supplier || null,
      supplierSku: p?.supplierSku || null,
      supplierCode: p?.supplierCode || null,
      externalSource: p?.externalSource || null,
      source: p?.source || null,
    };
  });

  const buckets = await groupBySupplier(itemsForGrouping);
  const createdPOs: Array<{ poNumber: string; supplierName: string; items: number; total: string }> = [];

  for (const bucket of buckets) {
    const lineItems: POLineItem[] = bucket.items.map(item => {
      const costPrice = toFloat(item.basePrice);
      return {
        orderItemId: item.orderItemId,
        productId: item.productId,
        productName: item.productName,
        supplierSku: item.supplierSku,
        productNumber: item.sku,
        quantity: item.quantity,
        costPrice,
        totalCost: costPrice * item.quantity,
        quantityReceived: 0,
        color: item.color,
        size: item.size,
        decorationType: item.decorationType,
        decorationLocation: item.decorationLocation,
        logoUrl: item.logoUrl,
        imageUrl: item.imageUrl,
        notes: null,
      };
    });

    const subtotal = lineItems.reduce((sum, li) => sum + li.totalCost, 0);
    const poNumber = await nextDocumentNumber(organizationId, userId, "po");

    await db.insert(purchaseOrders).values({
      userId,
      organizationId,
      orderId: args.orderId,
      supplierName: bucket.supplierName,
      supplierCode: bucket.supplierCode,
      supplierSource: bucket.supplierSource,
      poNumber,
      status: "draft",
      lineItems,
      subtotal: subtotal.toFixed(2),
      shipping: "0.00",
      tax: "0.00",
      total: subtotal.toFixed(2),
      aiGroupingConfidence: bucket.confidence.toFixed(2),
      aiGroupingReason: bucket.reason,
    });

    createdPOs.push({
      poNumber,
      supplierName: bucket.supplierName,
      items: bucket.items.length,
      total: `$${subtotal.toFixed(2)}`,
    });
  }

  return {
    success: true,
    message: `Generated ${createdPOs.length} purchase orders for order #${order.orderNumber || args.orderId}`,
    purchaseOrders: createdPOs,
    totalCost: `$${createdPOs.reduce((sum, po) => sum + parseFloat(po.total.replace("$", "")), 0).toFixed(2)}`,
  };
}

export async function executeGetPODetails(
  userId: number,
  organizationId: number | null,
  args: { poId: number },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const [po] = await db.select().from(purchaseOrders)
    .where(and(scope.purchaseOrders, eq(purchaseOrders.id, args.poId)))
    .limit(1);
  if (!po) return { error: `Purchase order ${args.poId} not found` };

  const events = await db.select().from(purchaseOrderEvents)
    .where(eq(purchaseOrderEvents.purchaseOrderId, args.poId))
    .orderBy(desc(purchaseOrderEvents.createdAt))
    .limit(10);

  const items = po.lineItems as POLineItem[];

  return {
    poNumber: po.poNumber,
    supplier: po.supplierName,
    supplierCode: po.supplierCode,
    status: po.status,
    items: items.map(li => ({
      product: li.productName,
      qty: li.quantity,
      costPrice: `$${li.costPrice.toFixed(2)}`,
      total: `$${li.totalCost.toFixed(2)}`,
      decoration: li.decorationType || "None",
    })),
    subtotal: po.subtotal,
    total: po.total,
    shipTo: po.shipToName || "Not set",
    createdAt: po.createdAt,
    events: events.map(e => ({
      type: e.eventType,
      description: e.description,
      date: e.createdAt,
    })),
  };
}

/**
 * executeGenerateBulkPOs — AI Copilot tool: aggregate items across all
 * accepted proposals and persist a `poPreviewDrafts` row. Returns a
 * structured `attachment` the chat UI can render as an inline preview
 * card.
 */
export async function executeGenerateBulkPOs(
  userId: number,
  organizationId: number | null,
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const acceptedProposals = await db.select({ id: proposals.id, title: proposals.title })
    .from(proposals)
    .where(and(scope.proposals, eq(proposals.status, "accepted")));

  if (acceptedProposals.length === 0) {
    return {
      success: false,
      message: "No approved proposals found.",
    };
  }

  // Pull proposal products + their products in one go per proposal.
  const productRows = await db.select().from(products).where(scope.products);
  const productMap = new Map(productRows.map(p => [p.id, p]));

  const proposalIds = acceptedProposals.map(p => p.id);
  const oiRows = await db.select().from(proposalOrderItems)
    .where(inArray(proposalOrderItems.proposalId, proposalIds));
  const ppRows = await db.select().from(proposalProducts)
    .where(inArray(proposalProducts.proposalId, proposalIds));

  const itemsByProposal = new Map<number, OrderItemWithProduct[]>();
  for (const item of oiRows) {
    const p = productMap.get(item.productId);
    const arr = itemsByProposal.get(item.proposalId) ?? [];
    arr.push({
      orderItemId: item.id,
      productId: item.productId,
      productName: p?.name || "Product",
      sku: p?.sku || null,
      category: p?.category || null,
      imageUrl: p?.imageUrl || null,
      basePrice: p?.basePrice || null,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      color: item.color || null,
      size: item.size || null,
      decorationType: null,
      decorationLocation: null,
      logoUrl: null,
      supplier: p?.supplier || null,
      supplierSku: p?.supplierSku || null,
      supplierCode: p?.supplierCode || null,
      externalSource: p?.externalSource || null,
      source: p?.source || null,
    });
    itemsByProposal.set(item.proposalId, arr);
  }
  // Fall back to proposalProducts when a proposal has no order items.
  for (const pp of ppRows) {
    if (itemsByProposal.has(pp.proposalId)) continue;
    const p = productMap.get(pp.productId);
    const arr = itemsByProposal.get(pp.proposalId) ?? [];
    arr.push({
      orderItemId: pp.id,
      productId: pp.productId,
      productName: p?.name || "Product",
      sku: p?.sku || null,
      category: p?.category || null,
      imageUrl: p?.imageUrl || null,
      basePrice: p?.basePrice || null,
      unitPrice: pp.unitPrice,
      quantity: pp.quantity ?? 1,
      color: null,
      size: null,
      decorationType: pp.decorationType || null,
      decorationLocation: null,
      logoUrl: null,
      supplier: p?.supplier || null,
      supplierSku: p?.supplierSku || null,
      supplierCode: p?.supplierCode || null,
      externalSource: p?.externalSource || null,
      source: p?.source || null,
    });
    itemsByProposal.set(pp.proposalId, arr);
  }

  const allItems: OrderItemWithProduct[] = Array.from(itemsByProposal.values()).flat();
  if (allItems.length === 0) {
    return {
      success: false,
      message: `Found ${acceptedProposals.length} accepted proposal(s) but none had line items.`,
    };
  }

  const buckets = await groupBySupplier(allItems);
  const flagged = buckets.filter(b => b.needsManualAssignment);

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(poPreviewDrafts).values({
    token,
    userId,
    organizationId,
    payload: { groups: buckets, flagged, sourceProposalIds: proposalIds },
    sourceProposalIds: proposalIds,
    expiresAt,
  });

  return {
    success: true,
    summary: `Aggregated ${allItems.length} item(s) from ${acceptedProposals.length} accepted proposal(s) into ${buckets.length} supplier group(s). ${flagged.length} item group(s) need review.`,
    proposals: acceptedProposals.length,
    suppliers: buckets.length,
    flagged: flagged.length,
    previewToken: token,
    deepLink: `/purchase-orders/preview/${token}`,
    attachment: {
      type: "po_bulk_preview" as const,
      payload: {
        previewToken: token,
        groups: buckets.map(b => ({
          supplierName: b.supplierName,
          itemCount: b.items.length,
          confidence: b.confidence,
          needsManualAssignment: b.needsManualAssignment,
        })),
        sourceProposalIds: proposalIds,
        flaggedCount: flagged.length,
      },
    },
  };
}

/**
 * executeAggregatePendingPOs — identify consolidation opportunities across
 * the org's unprocessed POs. Read-only preview: no DB mutations. The user
 * confirms via the preview card which calls the purchaseOrders.aggregate
 * mutation.
 */
export async function executeAggregatePendingPOs(
  userId: number,
  organizationId: number | null,
  args: { poIds?: number[] },
) {
  const db = await getDb();
  if (!db) return { success: false, error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const where = args.poIds && args.poIds.length > 0
    ? and(scope.purchaseOrders, inArray(purchaseOrders.id, args.poIds))
    : and(
        scope.purchaseOrders,
        inArray(purchaseOrders.status, ["draft", "sent", "acknowledged"] as const),
      );
  const rows = await db.select().from(purchaseOrders).where(where);
  const eligible = rows.filter((r) => r.status !== "consolidated" && r.status !== "merged");

  const groupMap = new Map<
    string,
    { supplierName: string; pos: Array<{ id: number; poNumber: string; total: string; itemCount: number }> }
  >();
  for (const po of eligible) {
    const key = normalizeSupplierName(po.supplierName) || po.supplierName.toLowerCase().trim();
    const entry = groupMap.get(key) ?? { supplierName: po.supplierName, pos: [] };
    entry.pos.push({
      id: po.id,
      poNumber: po.poNumber,
      total: po.total,
      itemCount: (po.lineItems as POLineItem[] | null)?.length ?? 0,
    });
    groupMap.set(key, entry);
  }
  const allGroups = Array.from(groupMap.values());
  const groups = allGroups.filter((g) => g.pos.length >= 2);
  const singletonCount = allGroups.filter((g) => g.pos.length === 1).length;
  const totalPoToMerge = groups.reduce((n, g) => n + g.pos.length, 0);

  return {
    success: true,
    summary: groups.length === 0
      ? `Scanned ${eligible.length} unprocessed PO(s). No suppliers appear on two or more POs, so nothing to consolidate right now.`
      : `Scanned ${eligible.length} unprocessed PO(s). Found ${groups.length} supplier group${groups.length === 1 ? "" : "s"} that can be consolidated — ${totalPoToMerge} PO${totalPoToMerge === 1 ? "" : "s"} would collapse into ${groups.length} merged PO${groups.length === 1 ? "" : "s"}.`,
    eligibleCount: eligible.length,
    groupCount: groups.length,
    singletonCount,
    attachment: {
      type: "po_aggregate_preview" as const,
      payload: {
        groups: groups.map((g) => ({
          supplierName: g.supplierName,
          pos: g.pos,
        })),
        eligibleCount: eligible.length,
        singletonCount,
      },
    },
  };
}

export async function executeGetMarginAnalysis(
  userId: number,
  organizationId: number | null,
  args: { orderId: number },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const [order] = await db.select().from(orders)
    .where(and(scope.orders, eq(orders.id, args.orderId)))
    .limit(1);
  if (!order) return { error: `Order ${args.orderId} not found` };

  const oiRows = await db.select().from(orderItems)
    .where(eq(orderItems.orderId, args.orderId));

  const poRows = await db.select().from(purchaseOrders)
    .where(and(scope.purchaseOrders, eq(purchaseOrders.orderId, args.orderId)));

  if (poRows.length === 0) {
    return { error: "No purchase orders exist for this order. Generate POs first to see margin analysis." };
  }

  // Build cost map
  const costMap = new Map<number, number>();
  for (const po of poRows) {
    for (const item of po.lineItems as POLineItem[]) {
      costMap.set(item.productId, (costMap.get(item.productId) || 0) + item.totalCost);
    }
  }

  const productIds = oiRows.map(oi => oi.productId);
  const productRows = productIds.length > 0
    ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds))
    : [];
  const nameMap = new Map(productRows.map(p => [p.id, p.name]));

  let totalSell = 0;
  let totalCost = 0;

  const perItem = oiRows.map(oi => {
    const sell = toFloat(oi.totalPrice);
    const cost = costMap.get(oi.productId) || 0;
    totalSell += sell;
    totalCost += cost;
    const margin = sell - cost;
    const marginPct = sell > 0 ? (margin / sell) * 100 : 0;
    return {
      product: nameMap.get(oi.productId) || `Product #${oi.productId}`,
      sellPrice: `$${sell.toFixed(2)}`,
      costPrice: `$${cost.toFixed(2)}`,
      margin: `$${margin.toFixed(2)}`,
      marginPercent: `${marginPct.toFixed(1)}%`,
    };
  });

  const grossMargin = totalSell - totalCost;
  const grossMarginPct = totalSell > 0 ? (grossMargin / totalSell) * 100 : 0;

  return {
    orderNumber: order.orderNumber || `#${args.orderId}`,
    totalRevenue: `$${totalSell.toFixed(2)}`,
    totalCost: `$${totalCost.toFixed(2)}`,
    grossMargin: `$${grossMargin.toFixed(2)}`,
    grossMarginPercent: `${grossMarginPct.toFixed(1)}%`,
    perItem,
  };
}
