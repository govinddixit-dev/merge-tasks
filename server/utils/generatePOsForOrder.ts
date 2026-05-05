/**
 * generatePOsForOrder.ts — Shared PO generation utility.
 *
 * Called from:
 *   1. purchaseOrders.generateFromOrder (manual trigger)
 *   2. storeCheckout.ts (auto-trigger on store order)
 *   3. webhook.ts (auto-trigger on invoice.paid)
 *
 * Extracts the common logic: load items → group by supplier → create POs.
 *
 * The supplier-bucket → PO-rows persistence step is exported as
 * `createPOsFromBuckets()` so the proposal-based preview/confirm flow
 * (server/routers/purchaseOrders.ts: confirmGeneration) can reuse it.
 */

import { getDb } from "../db";
import { eq, and, inArray } from "drizzle-orm";
import {
  purchaseOrders, purchaseOrderEvents, orderItems, products,
  virtualProofs, suppliers,
  type POLineItem, type InsertPurchaseOrder,
} from "../../drizzle/schema";
import { groupBySupplier, type OrderItemWithProduct } from "./supplierGrouping";
import type { SupplierBucket } from "./supplierGrouping";
import { normalizeSupplierName } from "./supplierNormalizer";
import { nextDocumentNumber } from "./documentNumbers";
import { getLogger } from "./logger";

const log = getLogger("generate-pos");

// ── Helpers ─────────────────────────────────────────────────────────────────

function toCents(val: string | number | null | undefined): number {
  if (val == null) return 0;
  return Math.round(parseFloat(String(val)) * 100);
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface GeneratePOsResult {
  purchaseOrders: Array<{
    id: number;
    poNumber: string;
    supplierName: string;
    itemCount: number;
    total: string;
  }>;
  totalPOs: number;
  totalCost: string;
}

/**
 * createPOsFromBuckets — shared persistence step.
 *
 * Persists supplier buckets as PO rows with COST prices, decoration
 * instructions, AI confidence/reason metadata, an event-log entry per PO,
 * and an upsert into the `suppliers` directory. Used by both the
 * order-based generator (below) and the proposal-based confirm flow.
 *
 * `orderId` is optional; proposal-only POs pass `null`.
 */
export async function createPOsFromBuckets(
  userId: number,
  organizationId: number | null,
  buckets: SupplierBucket[],
  options: {
    orderId: number | null;
    proposalIds?: number[];
    contextLabel?: string; // e.g. "Order #123" or "Proposal #456"
  },
): Promise<GeneratePOsResult> {
  const db = await getDb();
  if (!db) {
    log.error("Database unavailable for createPOsFromBuckets");
    return { purchaseOrders: [], totalPOs: 0, totalCost: "0.00" };
  }

  const createdPOs: GeneratePOsResult["purchaseOrders"] = [];
  const ctxLabel = options.contextLabel || (options.orderId ? `Order #${options.orderId}` : "Proposal");

  for (const bucket of buckets) {
    const lineItems: POLineItem[] = bucket.items.map(item => {
      const costCents = toCents(item.basePrice);
      const costPrice = costCents / 100;
      const totalCostCents = costCents * item.quantity;
      return {
        orderItemId: item.orderItemId,
        productId: item.productId,
        productName: item.productName,
        supplierSku: item.supplierSku,
        productNumber: item.sku,
        quantity: item.quantity,
        costPrice,
        totalCost: totalCostCents / 100,
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

    const subtotalCents = lineItems.reduce((sum, li) => sum + toCents(li.totalCost), 0);
    const subtotal = subtotalCents / 100;
    const poNumber = await nextDocumentNumber(organizationId, userId, "po");

    const decoInstructions = lineItems
      .filter(li => li.decorationType)
      .map(li => `${li.productName}: ${li.decorationType}${li.decorationLocation ? ` on ${li.decorationLocation}` : ""}`)
      .join("\n");

    // Notes — embed source proposal IDs for downstream traceability when
    // POs are generated from one or more proposals.
    const internalNotesParts: string[] = [];
    if (options.proposalIds && options.proposalIds.length > 0) {
      internalNotesParts.push(`Source proposal(s): ${options.proposalIds.join(", ")}`);
    }
    const internalNotes = internalNotesParts.length > 0 ? internalNotesParts.join("\n") : null;

    const insertValues = {
      userId,
      organizationId,
      // From migration 0054 orderId is nullable for proposal-only flows.
      orderId: options.orderId ?? null,
      proposalId: options.proposalIds && options.proposalIds.length === 1
        ? options.proposalIds[0]
        : null,
      supplierName: bucket.supplierName,
      supplierCode: bucket.supplierCode,
      supplierSource: bucket.supplierSource,
      poNumber,
      status: "draft" as const,
      lineItems,
      subtotal: subtotal.toFixed(2),
      shipping: "0.00",
      tax: "0.00",
      total: subtotal.toFixed(2),
      decorationInstructions: decoInstructions || null,
      internalNotes,
      aiGroupingConfidence: bucket.confidence.toFixed(2),
      aiGroupingReason: bucket.reason,
    };

    const [result] = await db.insert(purchaseOrders).values(insertValues satisfies Omit<InsertPurchaseOrder, "id" | "createdAt" | "updatedAt">);
    const poId = result.insertId;

    await db.insert(purchaseOrderEvents).values({
      purchaseOrderId: poId,
      eventType: "created",
      description: `PO created from ${ctxLabel} — ${bucket.items.length} items, AI confidence ${bucket.confidence}%`,
      userId,
    });

    // Upsert supplier directory (non-fatal)
    try {
      const normalized = normalizeSupplierName(bucket.supplierName);
      const conditions = organizationId != null
        ? and(eq(suppliers.organizationId, organizationId), eq(suppliers.normalizedName, normalized))
        : and(eq(suppliers.userId, userId), eq(suppliers.normalizedName, normalized));

      const [existing] = await db.select().from(suppliers).where(conditions!).limit(1);
      if (existing) {
        await db.update(suppliers).set({
          poCount: existing.poCount + 1,
          totalSpend: (parseFloat(String(existing.totalSpend || "0")) + subtotal).toFixed(2),
          lastOrderDate: new Date(),
          code: bucket.supplierCode || existing.code,
          source: bucket.supplierSource || existing.source,
        }).where(eq(suppliers.id, existing.id));
      } else {
        await db.insert(suppliers).values({
          userId,
          organizationId,
          name: bucket.supplierName,
          normalizedName: normalized,
          code: bucket.supplierCode,
          source: bucket.supplierSource,
          poCount: 1,
          totalSpend: subtotal.toFixed(2),
          lastOrderDate: new Date(),
        });
      }
    } catch (err) {
      log.warn("Supplier directory upsert failed:", err);
    }

    createdPOs.push({
      id: poId,
      poNumber,
      supplierName: bucket.supplierName,
      itemCount: bucket.items.length,
      total: subtotal.toFixed(2),
    });
  }

  return {
    purchaseOrders: createdPOs,
    totalPOs: createdPOs.length,
    totalCost: createdPOs.reduce((sum, po) => sum + parseFloat(po.total), 0).toFixed(2),
  };
}

/**
 * Generate purchase orders for an order. AI groups items by supplier.
 */
export async function generatePOsForOrder(
  userId: number,
  organizationId: number | null,
  orderId: number,
  proposalId?: number | null,
): Promise<GeneratePOsResult | null> {
  const db = await getDb();
  if (!db) {
    log.warn("Database unavailable for PO generation");
    return null;
  }

  // Idempotency guard
  const existingPOs = await db.select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.orderId, orderId));
  if (existingPOs.length > 0) {
    log.info(`POs already exist for order ${orderId}, skipping`);
    return null;
  }

  // Load order items
  const oiRows = await db.select().from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  if (oiRows.length === 0) {
    log.info(`Order ${orderId} has no items, skipping PO generation`);
    return null;
  }

  // Load products
  const productIds = oiRows.map(oi => oi.productId);
  const productRows = await db.select().from(products)
    .where(inArray(products.id, productIds));
  const productMap = new Map(productRows.map(p => [p.id, p]));

  // Load approved proofs (decoration data) for proposal-linked orders
  let proofMap = new Map<number, { decorationType: string | null; decorationZone: string | null; proofImageUrl: string | null }>();
  if (proposalId) {
    try {
      const proofs = await db.select().from(virtualProofs)
        .where(and(eq(virtualProofs.proposalId, proposalId), eq(virtualProofs.status, "approved")));
      proofMap = new Map(
        proofs
          .filter((p): p is typeof p & { productId: number } => p.productId != null)
          .map(p => [p.productId, {
            decorationType: p.decorationMethod,
            decorationZone: p.decorationZone,
            proofImageUrl: p.proofImageUrl,
          }])
      );
    } catch {
      // Graceful fallback
    }
  }

  // Build items for grouping engine
  const itemsForGrouping: OrderItemWithProduct[] = oiRows.map(oi => {
    const p = productMap.get(oi.productId);
    const proof = proofMap.get(oi.productId);
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
      decorationType: proof?.decorationType || oi.decorationType || null,
      decorationLocation: proof?.decorationZone || null,
      logoUrl: proof?.proofImageUrl || null,
      supplier: p?.supplier || null,
      supplierSku: p?.supplierSku || null,
      supplierCode: p?.supplierCode || null,
      externalSource: p?.externalSource || null,
      source: p?.source || null,
    };
  });

  const buckets = await groupBySupplier(itemsForGrouping);
  const result = await createPOsFromBuckets(userId, organizationId, buckets, {
    orderId,
    proposalIds: proposalId ? [proposalId] : undefined,
    contextLabel: `Order #${orderId}`,
  });

  log.info(`Generated ${result.totalPOs} POs for order ${orderId}`);
  return result;
}
