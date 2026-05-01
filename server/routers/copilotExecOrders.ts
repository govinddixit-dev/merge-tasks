/**
 * copilotExecOrders.ts — Order management executors for the AI copilot.
 *
 * Handles: listOrders, getOrderDetails, createOrder, updateOrderStatus
 */
import { getDb } from "../db";
import { clients, products, orders, orderItems } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { buildToolScope } from "./copilotExecScope";
import { onOrderDelivered } from "../utils/agentTriggers";
import { getLogger } from "../utils/logger";

const log = getLogger("copilotExecOrders");

export async function executeListOrders(userId: number, organizationId: number | null, args: { status?: string; clientId?: number; limit?: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const conditions = [scope.orders];
  if (args.status) conditions.push(eq(orders.status, args.status as "pending" | "processing" | "production" | "shipped" | "delivered" | "cancelled" | "refunded" | "partially_refunded"));
  if (args.clientId) conditions.push(eq(orders.clientId, args.clientId));

  const orderRows = await db.select().from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(args.limit || 20);

  const clientIds = Array.from(new Set(orderRows.map(o => o.clientId))) as number[];
  const clientMap = new Map<number, string>();
  if (clientIds.length > 0) {
    const clientRows = await db.select({ id: clients.id, companyName: clients.companyName }).from(clients)
      .where(scope.clients);
    clientRows.forEach(c => clientMap.set(c.id, c.companyName));
  }

  return {
    count: orderRows.length,
    orders: orderRows.map(o => ({
      id: o.id, orderNumber: o.orderNumber, status: o.status,
      clientName: clientMap.get(o.clientId) || "Unknown",
      total: o.total, createdAt: o.createdAt,
    })),
  };
}

export async function executeGetOrderDetails(userId: number, organizationId: number | null, args: { orderId: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const orderRows = await db.select().from(orders)
    .where(and(eq(orders.id, args.orderId), scope.orders)).limit(1);
  if (orderRows.length === 0) return { error: `Order ID ${args.orderId} not found` };

  const order = orderRows[0];
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  const clientRows = await db.select().from(clients).where(eq(clients.id, order.clientId)).limit(1);
  const client = clientRows[0];

  const productIds = items.map(i => i.productId);
  const productMap = new Map<number, string>();
  if (productIds.length > 0) {
    const productRows = await db.select({ id: products.id, name: products.name }).from(products)
      .where(scope.products);
    productRows.forEach(p => productMap.set(p.id, p.name));
  }

  return {
    order: {
      id: order.id, orderNumber: order.orderNumber, status: order.status,
      subtotal: order.subtotal, tax: order.tax, shipping: order.shipping, total: order.total,
      shippingName: order.shippingName, shippingAddress: order.shippingAddress,
      trackingNumber: order.trackingNumber, paymentMethod: order.paymentMethod,
      notes: order.notes, createdAt: order.createdAt,
    },
    client: client ? { id: client.id, companyName: client.companyName, contactEmail: client.contactEmail } : null,
    items: items.map(i => ({
      id: i.id, productName: productMap.get(i.productId) || `Product #${i.productId}`,
      quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice,
      size: i.size, color: i.color, decorationType: i.decorationType,
    })),
  };
}

export async function executeCreateOrder(userId: number, organizationId: number | null, args: {
  clientId: number;
  items: Array<{ productId: number; quantity: number; unitPrice: string; size?: string; color?: string; decorationType?: string }>;
  shippingName?: string; shippingAddress?: string; notes?: string;
  tax?: string; shipping?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const clientRows = await db.select().from(clients)
    .where(and(eq(clients.id, args.clientId), scope.clients)).limit(1);
  if (clientRows.length === 0) return { error: `Client ID ${args.clientId} not found` };

  const subtotal = args.items.reduce((sum, i) => sum + parseFloat(i.unitPrice) * i.quantity, 0);
  const tax = parseFloat(args.tax || "0");
  const shipping = parseFloat(args.shipping || "0");
  const total = subtotal + tax + shipping;

  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;

  const result = await db.insert(orders).values({
    userId,
    // Audit fix #17: stamp organizationId so team members share orders
    organizationId: organizationId ?? null,
    clientId: args.clientId,
    orderNumber,
    status: "pending",
    subtotal: subtotal.toFixed(2),
    tax: tax.toFixed(2),
    shipping: shipping.toFixed(2),
    total: total.toFixed(2),
    shippingName: args.shippingName || null,
    shippingAddress: args.shippingAddress || null,
    notes: args.notes || null,
  });

  const orderId = Number(result[0].insertId);

  const itemValues = args.items.map((item) => {
    const itemTotal = parseFloat(item.unitPrice) * item.quantity;
    return {
      orderId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: itemTotal.toFixed(2),
      size: item.size || null,
      color: item.color || null,
      decorationType: item.decorationType || null,
    };
  });
  if (itemValues.length > 0) {
    await db.insert(orderItems).values(itemValues);
  }

  return {
    success: true, orderId, orderNumber,
    clientName: clientRows[0].companyName,
    itemCount: args.items.length, total: total.toFixed(2),
  };
}

export async function executeUpdateOrderStatus(userId: number, organizationId: number | null, args: {
  orderId: number; status: string; trackingNumber?: string; notes?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const existing = await db.select().from(orders)
    .where(and(eq(orders.id, args.orderId), scope.orders)).limit(1);
  if (existing.length === 0) return { error: `Order ID ${args.orderId} not found` };

  const updates: Record<string, any> = { status: args.status };
  if (args.trackingNumber) updates.trackingNumber = args.trackingNumber;
  if (args.notes) updates.notes = args.notes;

  await db.update(orders).set(updates).where(and(eq(orders.id, args.orderId), scope.orders));

  // Agent: on shipped/delivered, draft a post-delivery check-in email (fire-and-forget, deduped).
  if (args.status === "shipped" || args.status === "delivered") {
    (async () => {
      try {
        const order = existing[0];
        if (!order.clientId) return;
        const [clientRow] = await db
          .select({
            contactEmail: clients.contactEmail,
            contactName: clients.contactName,
          })
          .from(clients)
          .where(eq(clients.id, order.clientId))
          .limit(1);
        if (!clientRow?.contactEmail) return;
        await onOrderDelivered(
          order.id,
          order.organizationId ?? null,
          clientRow.contactEmail,
          clientRow.contactName,
          `Order ${order.orderNumber}`,
        );
      } catch (err: unknown) {
        log.warn("[trigger] onOrderDelivered (copilot) failed:", err);
      }
    })();
  }

  return { success: true, orderId: args.orderId, orderNumber: existing[0].orderNumber, newStatus: args.status };
}
