import { z } from "zod";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { orders, orderItems, clients, stores, users, distributorProfiles, type InsertOrder, type InsertOrderItem } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { getOrgScope } from "../utils/orgScope";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { ORDER_CREATE_LIMIT } from "../utils/rateLimiter";
import { notifyOwner } from "../_core/notification";
import { buildOrderShippedEmail } from "../email/emailTemplates";
import { onOrderDelivered } from "../utils/agentTriggers";
import { getLogger } from "../utils/logger";

const log = getLogger("orders");

export const ordersRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "processing", "production", "shipped", "delivered", "cancelled"]).optional(),
        clientId: z.number().optional(),
        storeId: z.number().optional(),
        limit: z.number().min(1).max(200).optional().default(50),
        offset: z.number().min(0).optional().default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const rows = await db
        .select()
        .from(orders)
        .where(scope.orders)
        .orderBy(desc(orders.createdAt))
        .limit(limit + 1)
        .offset(offset);

      let filtered = rows;
      if (input?.status) filtered = filtered.filter(o => o.status === input.status);
      if (input?.clientId) filtered = filtered.filter(o => o.clientId === input.clientId);
      if (input?.storeId) filtered = filtered.filter(o => o.storeId === input.storeId);

      const hasMore = filtered.length > limit;
      const page = hasMore ? filtered.slice(0, limit) : filtered;

      // Enrich with client names (fetch only needed clients)
      const clientIds = Array.from(new Set(page.map(o => o.clientId).filter(Boolean))) as number[];
      const clientRows = clientIds.length > 0
        ? await db.select().from(clients).where(and(inArray(clients.id, clientIds), scope.clients))
        : [];
      const clientMap = new Map(clientRows.map(c => [c.id, c]));

      return {
        items: page.map(o => ({ ...o, client: clientMap.get(o.clientId) ?? null })),
        total: page.length,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const rows = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.id), scope.orders))
        .limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });

      const order = rows[0];

      // Get order items
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      // Get client
      const clientRows = await db.select().from(clients).where(eq(clients.id, order.clientId)).limit(1);

      return {
        ...order,
        items,
        client: clientRows[0] ?? null,
      };
    }),

  create: protectedProcedure
    .use(rateLimited("orders.create", ORDER_CREATE_LIMIT))
    .input(
      z.object({
        clientId: z.number(),
        storeId: z.number().optional(),
        proposalId: z.number().optional(),
        subtotal: z.string(),
        tax: z.string().optional(),
        shipping: z.string().optional(),
        total: z.string(),
        shippingName: z.string().optional(),
        shippingAddress: z.string().optional(),
        paymentMethod: z.enum(["credit_card", "po_number", "gl_code", "company_points"]).optional(),
        paymentReference: z.string().optional(),
        notes: z.string().optional(),
        items: z.array(
          z.object({
            productId: z.number(),
            quantity: z.number(),
            unitPrice: z.string(),
            totalPrice: z.string(),
            decorationType: z.string().optional(),
            size: z.string().optional(),
            color: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const orderNumber = `MT-${nanoid(8).toUpperCase()}`;

      const scope = getOrgScope(ctx);
      const values: InsertOrder = {
        ...scope.stamp,
        clientId: input.clientId,
        storeId: input.storeId ?? null,
        proposalId: input.proposalId ?? null,
        orderNumber,
        status: "pending",
        subtotal: input.subtotal,
        tax: input.tax ?? "0.00",
        shipping: input.shipping ?? "0.00",
        total: input.total,
        shippingName: input.shippingName ?? null,
        shippingAddress: input.shippingAddress ?? null,
        paymentMethod: input.paymentMethod ?? "credit_card",
        paymentReference: input.paymentReference ?? null,
        notes: input.notes ?? null,
      };

      const orderId = await db.transaction(async (tx) => {
        const result = await tx.insert(orders).values(values);
        const newOrderId = result[0].insertId;
        // Insert order items atomically — if this fails, the order is rolled back too
        if (input.items.length > 0) {
          const itemValues: InsertOrderItem[] = input.items.map(item => ({
            orderId: newOrderId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            decorationType: item.decorationType ?? null,
            size: item.size ?? null,
            color: item.color ?? null,
          }));
          await tx.insert(orderItems).values(itemValues);
        }
        return newOrderId;
      });

      const created = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      // Notify the distributor of the new order
      try {
        await notifyOwner({
          userId: ctx.user.id,
          organizationId: ctx.organizationId ?? undefined,
          type: input.storeId ? "store_order" : "order_placed",
          title: `New order placed — ${orderNumber}`,
          content: `Order ${orderNumber} was placed for $${input.total}.`,
          actionPath: `/orders/${orderId}`,
          actionLabel: "View Order",
          entityId: orderId,
          entityType: "order",
        });
      } catch (notifyErr) {
        log.error(
          `Failed to queue owner notification for new order ${orderNumber}:`,
          notifyErr,
        );
      }
      return created[0];
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pending", "processing", "production", "shipped", "delivered", "cancelled"]),
        trackingNumber: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.id), scope.orders))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });

      const setObj: Record<string, unknown> = { status: input.status };
      if (input.trackingNumber) setObj.trackingNumber = input.trackingNumber;

      await db.update(orders).set(setObj).where(and(eq(orders.id, input.id), scope.orders));

      const updated = await db.select().from(orders).where(eq(orders.id, input.id)).limit(1);

      // Notify on shipped or delivered status changes
      if (input.status === "shipped" || input.status === "delivered") {
        try {
          // In-app notification
          await notifyOwner({
            userId: ctx.user.id,
            organizationId: ctx.organizationId ?? undefined,
            type: "order_shipped",
            title: input.status === "shipped"
              ? `Order ${existing[0].orderNumber} has shipped`
              : `Order ${existing[0].orderNumber} was delivered`,
            content: input.status === "shipped"
              ? `Order ${existing[0].orderNumber} is on its way.${input.trackingNumber ? ` Tracking: ${input.trackingNumber}` : ""}`
              : `Order ${existing[0].orderNumber} has been delivered.`,
            actionPath: `/orders/${input.id}`,
            actionLabel: "View Order",
            entityId: input.id,
            entityType: "order",
          });

          // Branded email alert to distributor
          try {
            const [distributor] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
            const [distProfile] = await db.select().from(distributorProfiles).where(eq(distributorProfiles.userId, ctx.user.id)).limit(1);
            const branding = distProfile ? {
              companyName: distProfile.brandCompanyName || distProfile.companyName || undefined,
              primaryColor: distProfile.brandPrimaryColor || undefined,
              logoUrl: distProfile.brandLogoUrl || undefined,
            } : undefined;

            if (distributor?.email) {
              const { sendEmail } = await import("../email/mailer");
              const order = updated[0];
              // Fetch store name if available
              let storeName: string | undefined;
              if (order.storeId) {
                const [storeRow] = await db.select().from(stores).where(eq(stores.id, order.storeId)).limit(1);
                storeName = storeRow?.name;
              }
              // Fetch client name if available
              let clientName: string | undefined;
              if (order.clientId) {
                const [clientRow] = await db.select().from(clients).where(eq(clients.id, order.clientId)).limit(1);
                clientName = clientRow?.companyName || clientRow?.contactName;
              }
              const { subject, html } = buildOrderShippedEmail({
                distributorName: branding?.companyName,
                orderNumber: order.orderNumber || `ORD-${order.id}`,
                clientName,
                storeName,
                trackingNumber: input.trackingNumber || order.trackingNumber || undefined,
                status: input.status as "shipped" | "delivered",
                orderTotal: order.total ? parseFloat(order.total) : undefined,
                dashboardUrl: `${process.env.APP_BASE_URL || "https://app.mergetasks.com"}/orders/${input.id}`,
                branding,
              });
              const emailResult = await sendEmail(
                distributor.email,
                subject,
                html,
                branding?.companyName || "MergeTasks",
                distributor.email,
              );
              if (!emailResult.sent) {
                log.error(
                  `Shipping-status email to ${distributor.email} for order ${existing[0].orderNumber} failed: ${emailResult.error}`,
                );
              }
            }
          } catch (emailErr) {
            log.error(
              `Exception sending shipping-status email for order ${existing[0].orderNumber}:`,
              emailErr,
            );
          }
        } catch (notifyErr) {
          log.error(
            `Failed to queue shipping-status notification for order ${existing[0].orderNumber}:`,
            notifyErr,
          );
        }

        // Agent: draft a post-delivery check-in email (fire-and-forget, deduped).
        // Queued here for both shipped and delivered — dedup prevents duplication
        // when an order transitions shipped → delivered.
        (async () => {
          try {
            const order = updated[0];
            if (!order?.clientId) return;
            const [clientRow] = await db
              .select({
                contactEmail: clients.contactEmail,
                contactName: clients.contactName,
              })
              .from(clients)
              .where(eq(clients.id, order.clientId))
              .limit(1);
            if (!clientRow?.contactEmail) return;
            const productSummary = `Order ${order.orderNumber}`;
            await onOrderDelivered(
              order.id,
              order.organizationId ?? null,
              clientRow.contactEmail,
              clientRow.contactName,
              productSummary,
            );
          } catch (err: unknown) {
            log.warn("[trigger] onOrderDelivered failed:", err);
          }
        })();
      }

      return updated[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.id), scope.orders))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });

      // Delete items and order atomically — prevents orphaned items if order delete fails
      await db.transaction(async (tx) => {
        await tx.delete(orderItems).where(eq(orderItems.orderId, input.id));
        await tx.delete(orders).where(and(eq(orders.id, input.id), scope.orders));
      });
      return { success: true };
    }),

  // Dashboard stats
  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [[orderStats], [storeStats], [clientStats], [gmvStats]] = await Promise.all([
      db.select({
        totalOrders: sql<number>`count(*)`,
        pendingOrders: sql<number>`sum(case when ${orders.status} in ('pending','processing') then 1 else 0 end)`,
      }).from(orders).where(scope.orders),
      db.select({
        activeStores: sql<number>`sum(case when ${stores.status} = 'active' then 1 else 0 end)`,
      }).from(stores).where(scope.stores),
      db.select({
        totalClients: sql<number>`count(*)`,
      }).from(clients).where(scope.clients),
      db.select({
        monthlyGmv: sql<number>`coalesce(sum(${orders.total}), 0)`,
      }).from(orders).where(and(scope.orders, sql`${orders.createdAt} >= ${thirtyDaysAgo}`)),
    ]);

    return {
      activeStores: Number(storeStats?.activeStores ?? 0),
      totalClients: Number(clientStats?.totalClients ?? 0),
      pendingOrders: Number(orderStats?.pendingOrders ?? 0),
      monthlyGmv: Number(gmvStats?.monthlyGmv ?? 0),
      totalOrders: Number(orderStats?.totalOrders ?? 0),
    };
  }),
});
