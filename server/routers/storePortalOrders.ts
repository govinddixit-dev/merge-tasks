/**
 * Store Portal — Orders sub-router.
 *
 * POC-facing order procedures: list, getById.
 */
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { orders, orderItems, products, storeUsers } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";

export const storePortalOrdersRouter = router({
  list: publicProcedure
    .input(storeSlugInput.extend({
      status: z.string().optional(),
      employeeEmail: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      // Only admin/manager can filter by employee
      if (input.employeeEmail && !["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const conditions = [eq(orders.clientId, store.clientId)];
      if (input.status) conditions.push(eq(orders.status, input.status as typeof orders.status.enumValues[number]));

      // Location scoping: non-admin / non-POC viewers only see orders placed
      // by buyers in their location. The leftJoin on storeUsers below means
      // this filter also excludes anonymous / unattributed orders, which is
      // the desired behavior — scoped viewers only see their own cohort.
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        conditions.push(eq(storeUsers.locationId, storeUser.locationId));
      }

      // If filtering by employee email, find the storeUser first
      if (input.employeeEmail) {
        const [targetUser] = await db.select().from(storeUsers)
          .where(and(eq(storeUsers.storeId, store.id), eq(storeUsers.email, input.employeeEmail.toLowerCase())))
          .limit(1);
        if (targetUser) {
          conditions.push(eq(orders.storeUserId, targetUser.id));
        } else {
          return [];
        }
      }

      const orderRows = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          subtotal: orders.subtotal,
          tax: orders.tax,
          shipping: orders.shipping,
          total: orders.total,
          paymentMethod: orders.paymentMethod,
          trackingNumber: orders.trackingNumber,
          notes: orders.notes,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
          storeUserId: orders.storeUserId,
          discountAmount: orders.discountAmount,
          employeeName: storeUsers.name,
          employeeEmail: storeUsers.email,
        })
        .from(orders)
        .leftJoin(storeUsers, eq(storeUsers.id, orders.storeUserId))
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt))
        .limit(100);

      return orderRows.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        subtotal: o.subtotal?.toString() || "0",
        tax: o.tax?.toString() || "0",
        shipping: o.shipping?.toString() || "0",
        total: o.total?.toString() || "0",
        paymentMethod: o.paymentMethod,
        trackingNumber: o.trackingNumber,
        notes: o.notes,
        createdAt: o.createdAt?.toISOString() || null,
        updatedAt: o.updatedAt?.toISOString() || null,
        employeeName: o.employeeName ?? null,
        employeeEmail: o.employeeEmail ?? null,
        discountAmount: o.discountAmount?.toString() || null,
      }));
    }),

  getById: publicProcedure
    .input(storeSlugInput.extend({ orderId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      const [order] = await db
        .select()
        .from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.clientId, store.clientId),
        ))
        .limit(1);

      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }

      // Cross-scope guard: a location-scoped viewer can only see orders
      // placed by buyers in their location. Admin and POC skip the guard.
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        if (order.storeUserId == null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }
        const [buyer] = await db
          .select({ locationId: storeUsers.locationId })
          .from(storeUsers)
          .where(eq(storeUsers.id, order.storeUserId))
          .limit(1);
        if (!buyer || buyer.locationId !== storeUser.locationId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }
      }

      // Get order items with product details
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      const productIds = items.map(i => i.productId);
      const productRows = productIds.length > 0
        ? await db
            .select()
            .from(products)
            .where(inArray(products.id, productIds))
        : [];
      const productMap = new Map(productRows.map(p => [p.id, p]));

      const enrichedItems = items.map(item => {
        const prod = productMap.get(item.productId);
        return {
          id: item.id,
          productId: item.productId,
          name: prod?.name || "Product",
          imageUrl: prod?.imageUrl || null,
          sku: prod?.sku || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice?.toString() || "0",
          totalPrice: item.totalPrice?.toString() || "0",
          decorationType: item.decorationType,
          size: item.size,
          color: item.color,
        };
      });

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        subtotal: order.subtotal?.toString() || "0",
        tax: order.tax?.toString() || "0",
        shipping: order.shipping?.toString() || "0",
        total: order.total?.toString() || "0",
        paymentMethod: order.paymentMethod,
        paymentReference: order.paymentReference,
        trackingNumber: order.trackingNumber,
        shippingName: order.shippingName,
        shippingAddress: order.shippingAddress,
        notes: order.notes,
        createdAt: order.createdAt?.toISOString() || null,
        updatedAt: order.updatedAt?.toISOString() || null,
        items: enrichedItems,
      };
    }),
});
