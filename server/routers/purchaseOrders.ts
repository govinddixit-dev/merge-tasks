/**
 * purchaseOrders.ts — Purchase Order router.
 *
 * Handles the full PO lifecycle: generate from order (AI grouping), list,
 * detail, update, line item editing, reassign between POs, send
 * (email/API/download), status updates, receiving, delete, and margin analysis.
 *
 * POs use COST prices (products.basePrice), NEVER sell prices (orderItems.unitPrice).
 */
import { z } from "zod";
import { eq, and, desc, sql, inArray, like } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  purchaseOrders, purchaseOrderEvents, orders, orderItems, products,
  virtualProofs, clients, suppliers,
  type POLineItem, type InsertPurchaseOrder, type InsertPurchaseOrderEvent,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { getOrgScope } from "../utils/orgScope";
import { nextDocumentNumber } from "../utils/documentNumbers";
import { getLogger } from "../utils/logger";
import { groupBySupplier, type OrderItemWithProduct } from "../utils/supplierGrouping";
import { submitPOToSupplier } from "../utils/supplierSubmission";
import { notifyOwner } from "../_core/notification";
import { normalizeSupplierName } from "../utils/supplierNormalizer";
import { syncPOToQuickBooks } from "../utils/quickbooksPOSync";
import { generatePOsForOrder, createPOsFromBuckets } from "../utils/generatePOsForOrder";
import { sendEmail } from "../email/mailer";
import { proposals, proposalProducts, proposalOrderItems, poPreviewDrafts, estimates, invoices, copilotPendingActions } from "../../drizzle/schema";
import type { SupplierBucket } from "../utils/supplierGrouping";

const log = getLogger("purchaseOrders");

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a fallback PO number using nanoid (used only if the per-org
 * sequential counter is unavailable; new code paths use
 * `nextDocumentNumber()` instead).
 */
function generatePONumber(): string {
  const year = new Date().getFullYear();
  return `PO-${year}-${nanoid(12).toUpperCase()}`;
}

function toFloat(val: string | number | null | undefined): number {
  if (val == null) return 0;
  return parseFloat(String(val)) || 0;
}

/** Convert a decimal string to integer cents to avoid floating-point rounding errors. */
function toCents(val: string | number | null | undefined): number {
  if (val == null) return 0;
  return Math.round(parseFloat(String(val)) * 100);
}

/** Convert integer cents back to a 2-decimal string for storage. */
function centsToStr(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Upsert supplier directory entry. Called after each PO creation.
 * Creates a new supplier record or updates existing one with latest contact info and spend.
 */
async function upsertSupplierDirectory(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number,
  organizationId: number | null,
  poData: { supplierName: string; supplierCode: string | null; supplierSource: string | null; supplierContactEmail: string | null; supplierContactPhone: string | null; total: string },
) {
  try {
    const normalized = normalizeSupplierName(poData.supplierName);
    const conditions = organizationId != null
      ? and(eq(suppliers.organizationId, organizationId), eq(suppliers.normalizedName, normalized))
      : and(eq(suppliers.userId, userId), eq(suppliers.normalizedName, normalized));

    const [existing] = await db.select().from(suppliers).where(conditions!).limit(1);

    if (existing) {
      // Update spend and contact info
      await db.update(suppliers).set({
        poCount: sql`poCount + 1`,
        totalSpend: sql`totalSpend + ${poData.total}`,
        lastOrderDate: new Date(),
        contactEmail: poData.supplierContactEmail || existing.contactEmail,
        contactPhone: poData.supplierContactPhone || existing.contactPhone,
        code: poData.supplierCode || existing.code,
        source: poData.supplierSource || existing.source,
      }).where(eq(suppliers.id, existing.id));
    } else {
      await db.insert(suppliers).values({
        userId,
        organizationId,
        name: poData.supplierName,
        normalizedName: normalized,
        code: poData.supplierCode,
        source: poData.supplierSource,
        contactEmail: poData.supplierContactEmail,
        contactPhone: poData.supplierContactPhone,
        poCount: 1,
        totalSpend: poData.total,
        lastOrderDate: new Date(),
      });
    }
  } catch (err) {
    // Non-fatal — supplier directory is a convenience feature
    log.warn("Failed to upsert supplier directory:", err);
  }
}

// ── Router ──────────────────────────────────────────────────────────────────

export const purchaseOrdersRouter = router({

  /**
   * generateFromOrder — the core "one click" endpoint.
   * Loads order items + products, runs AI supplier grouping,
   * creates separate POs for each supplier bucket with COST prices.
   */
  generateFromOrder: protectedProcedure
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const scope = getOrgScope(ctx);

      // Delegate to shared utility (handles idempotency, grouping, creation, supplier directory)
      const result = await generatePOsForOrder(
        ctx.user.id,
        scope.organizationId,
        input.orderId,
      );

      if (!result) {
        throw new TRPCError({ code: "CONFLICT", message: "Purchase orders already exist for this order, or the order has no items." });
      }

      // QuickBooks sync (non-blocking)
      const db = await getDb();
      if (db) {
        for (const po of result.purchaseOrders) {
          const [createdPo] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).limit(1);
          if (createdPo) {
            syncPOToQuickBooks(createdPo, ctx.user.id, scope.organizationId, "create")
              .then(async (r) => {
                if (r.status === "pending" || r.status === "error") {
                  log.info(`QBO sync ${r.status} for PO ${createdPo.poNumber}: ${r.error}`);
                  const db2 = await getDb();
                  if (db2) {
                    await db2.insert(purchaseOrderEvents).values({
                      purchaseOrderId: createdPo.id,
                      eventType: "note_added",
                      description: `QuickBooks sync ${r.status}: ${r.error || "no details"}`,
                      userId: ctx.user.id,
                      metadata: { qboStatus: r.status, qboError: r.error },
                    });
                  }
                }
              })
              .catch((err) => log.warn(`QBO sync threw for PO ${createdPo.poNumber}:`, err));
          }
        }
      }

      // Notification
      const supplierNames = result.purchaseOrders.map(po => po.supplierName).join(", ");
      await notifyOwner({
        userId: ctx.user.id,
        organizationId: scope.organizationId ?? undefined,
        type: "po_created",
        title: `${result.totalPOs} Purchase Order${result.totalPOs > 1 ? "s" : ""} Generated`,
        content: `POs created for Order #${input.orderId}: ${supplierNames}`,
        actionPath: `/purchase-orders?orderId=${input.orderId}`,
        actionLabel: "View POs",
        entityId: input.orderId,
        entityType: "order",
      });

      return {
        orderId: input.orderId,
        ...result,
      };
    }),
  /**
   * list — all POs for the org, optionally filtered.
   */
  list: protectedProcedure
    .input(z.object({
      orderId: z.number().optional(),
      status: z.string().optional(),
      supplierName: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const conditions = [scope.purchaseOrders];
      if (input.orderId) conditions.push(eq(purchaseOrders.orderId, input.orderId));
      if (input.status) conditions.push(eq(purchaseOrders.status, input.status as any));
      if (input.supplierName) conditions.push(like(purchaseOrders.supplierName, `%${input.supplierName}%`));

      const rows = await db.select().from(purchaseOrders)
        .where(and(...conditions))
        .orderBy(desc(purchaseOrders.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get total count
      const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(purchaseOrders)
        .where(and(...conditions));

      return {
        purchaseOrders: rows,
        total: countResult?.count ?? 0,
      };
    }),

  /**
   * getById — single PO with activity timeline.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [po] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.id)))
        .limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });

      const events = await db.select().from(purchaseOrderEvents)
        .where(eq(purchaseOrderEvents.purchaseOrderId, input.id))
        .orderBy(desc(purchaseOrderEvents.createdAt));

      // Get linked order info (orderId is nullable for proposal-only POs)
      const [order] = po.orderId != null
        ? await db.select({ orderNumber: orders.orderNumber, clientId: orders.clientId })
            .from(orders).where(eq(orders.id, po.orderId)).limit(1)
        : [null];

      let clientName: string | null = null;
      if (order?.clientId) {
        const [client] = await db.select({ companyName: clients.companyName })
          .from(clients).where(eq(clients.id, order.clientId)).limit(1);
        clientName = client?.companyName || null;
      }

      return {
        ...po,
        events,
        orderNumber: order?.orderNumber || null,
        clientName,
      };
    }),

  /**
   * update — edit a draft PO's fields.
   */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      shipToName: z.string().optional(),
      shipToAddress: z.string().optional(),
      shipToType: z.enum(["decorator", "warehouse", "client_direct"]).optional(),
      requestedShipDate: z.string().datetime().optional(),
      supplierNotes: z.string().optional(),
      internalNotes: z.string().optional(),
      supplierContactEmail: z.string().email().optional(),
      supplierContactPhone: z.string().optional(),
      supplierAccountNumber: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [po] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.id)))
        .limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });
      if (po.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft POs can be edited" });

      // Explicit field mapping — no dynamic property copying
      const updateData: Partial<InsertPurchaseOrder> = {};
      if (input.shipToName !== undefined) updateData.shipToName = input.shipToName;
      if (input.shipToAddress !== undefined) updateData.shipToAddress = input.shipToAddress;
      if (input.shipToType !== undefined) updateData.shipToType = input.shipToType;
      if (input.requestedShipDate !== undefined) updateData.requestedShipDate = new Date(input.requestedShipDate);
      if (input.supplierNotes !== undefined) updateData.supplierNotes = input.supplierNotes;
      if (input.internalNotes !== undefined) updateData.internalNotes = input.internalNotes;
      if (input.supplierContactEmail !== undefined) updateData.supplierContactEmail = input.supplierContactEmail;
      if (input.supplierContactPhone !== undefined) updateData.supplierContactPhone = input.supplierContactPhone;
      if (input.supplierAccountNumber !== undefined) updateData.supplierAccountNumber = input.supplierAccountNumber;

      if (Object.keys(updateData).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      await db.update(purchaseOrders).set(updateData).where(eq(purchaseOrders.id, input.id));
      return { success: true };
    }),

  /**
   * updateLineItem — adjust qty, cost, or notes on a single line item.
   */
  updateLineItem: protectedProcedure
    .input(z.object({
      poId: z.number(),
      lineItemIndex: z.number().min(0),
      quantity: z.number().min(1).optional(),
      costPrice: z.number().min(0).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [po] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.poId)))
        .limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });
      if (po.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft POs can be edited" });

      const items = po.lineItems as POLineItem[];
      if (input.lineItemIndex >= items.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid line item index" });
      }

      const item = items[input.lineItemIndex];
      if (input.quantity !== undefined) item.quantity = input.quantity;
      if (input.costPrice !== undefined) item.costPrice = input.costPrice;
      if (input.notes !== undefined) item.notes = input.notes;
      item.totalCost = item.quantity * item.costPrice;

      // Recalculate totals
      const subtotal = items.reduce((sum, li) => sum + li.totalCost, 0);
      const shipping = toFloat(po.shipping);
      const tax = toFloat(po.tax);

      await db.update(purchaseOrders).set({
        lineItems: items,
        subtotal: subtotal.toFixed(2),
        total: (subtotal + shipping + tax).toFixed(2),
      }).where(eq(purchaseOrders.id, input.poId));

      return { success: true, lineItems: items, subtotal: subtotal.toFixed(2) };
    }),

  /**
   * reassignItem — move a line item from one PO to another (or create a new PO).
   */
  reassignItem: protectedProcedure
    .input(z.object({
      fromPoId: z.number(),
      lineItemIndex: z.number().min(0),
      toPoId: z.number().optional(),
      newSupplierName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Load source PO
      const [fromPo] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.fromPoId)))
        .limit(1);
      if (!fromPo) throw new TRPCError({ code: "NOT_FOUND", message: "Source PO not found" });
      if (fromPo.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft POs can be modified" });

      const fromItems = fromPo.lineItems as POLineItem[];
      if (input.lineItemIndex >= fromItems.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid line item index" });
      }

      // Remove item from source
      const [movedItem] = fromItems.splice(input.lineItemIndex, 1);

      if (input.toPoId) {
        // Move to existing PO
        const [toPo] = await db.select().from(purchaseOrders)
          .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.toPoId)))
          .limit(1);
        if (!toPo) throw new TRPCError({ code: "NOT_FOUND", message: "Target PO not found" });
        if (toPo.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Target PO must be in draft status" });

        const toItems = toPo.lineItems as POLineItem[];
        toItems.push(movedItem);
        const toSubtotal = toItems.reduce((sum, li) => sum + li.totalCost, 0);

        await db.update(purchaseOrders).set({
          lineItems: toItems,
          subtotal: toSubtotal.toFixed(2),
          total: (toSubtotal + toFloat(toPo.shipping) + toFloat(toPo.tax)).toFixed(2),
        }).where(eq(purchaseOrders.id, input.toPoId));
      } else if (input.newSupplierName) {
        // Create new PO for this supplier
        const poNumber = await nextDocumentNumber(scope.organizationId, ctx.user.id, "po");
        await db.insert(purchaseOrders).values({
          userId: ctx.user.id,
          organizationId: scope.organizationId,
          orderId: fromPo.orderId,
          supplierName: input.newSupplierName,
          poNumber,
          status: "draft",
          lineItems: [movedItem],
          subtotal: movedItem.totalCost.toFixed(2),
          total: movedItem.totalCost.toFixed(2),
          aiGroupingConfidence: "100.00",
          aiGroupingReason: "Manually assigned by user",
        } satisfies Omit<InsertPurchaseOrder, "id" | "createdAt" | "updatedAt">);
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Must specify toPoId or newSupplierName" });
      }

      // Update source PO
      if (fromItems.length === 0) {
        // Source PO is now empty — delete it
        await db.delete(purchaseOrderEvents).where(eq(purchaseOrderEvents.purchaseOrderId, input.fromPoId));
        await db.delete(purchaseOrders).where(eq(purchaseOrders.id, input.fromPoId));
      } else {
        const fromSubtotal = fromItems.reduce((sum, li) => sum + li.totalCost, 0);
        await db.update(purchaseOrders).set({
          lineItems: fromItems,
          subtotal: fromSubtotal.toFixed(2),
          total: (fromSubtotal + toFloat(fromPo.shipping) + toFloat(fromPo.tax)).toFixed(2),
        }).where(eq(purchaseOrders.id, input.fromPoId));
      }

      return { success: true };
    }),

  /**
   * send — send a PO via email, API, or download.
   */
  send: protectedProcedure
    .input(z.object({
      id: z.number(),
      method: z.enum(["email", "api", "download"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [po] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.id)))
        .limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });

      if (input.method === "api") {
        const result = await submitPOToSupplier(po);
        if (result.success && result.method === "api") {
          await db.update(purchaseOrders).set({ status: "sent", sentAt: new Date() })
            .where(eq(purchaseOrders.id, input.id));
          await db.insert(purchaseOrderEvents).values({
            purchaseOrderId: input.id,
            eventType: "sent",
            description: `PO submitted via ${po.supplierSource} API — confirmation: ${result.confirmationNumber || "pending"}`,
            userId: ctx.user.id,
          });
          return { success: true, method: "api", confirmationNumber: result.confirmationNumber };
        }
        // API not available — fall through to email or manual
        if (result.method === "email" && po.supplierContactEmail) {
          // Will be handled as email below
        } else {
          return { success: false, method: "manual", error: result.error };
        }
      }

      if (input.method === "email" || (input.method === "api" && po.supplierContactEmail)) {
        if (!po.supplierContactEmail) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No supplier contact email on file. Add a supplier email in the PO settings before sending.",
          });
        }

        // Build PO email HTML. POLineItem uses costPrice/totalCost (numbers) — not
        // unitPrice/totalPrice. Format to 2 decimals for display.
        const lineItemsHtml = (po.lineItems ?? [])
          .map(li => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${li.productName}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">${li.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">$${li.costPrice.toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">$${li.totalCost.toFixed(2)}</td>
    </tr>`).join('');

        const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px;">
      <h2 style="color:#111;margin:0 0 4px 0;">Purchase Order</h2>
      <p style="color:#666;margin:0 0 24px 0;font-size:14px;">PO #${po.poNumber}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#f9f9f9;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Product</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Unit Price</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Total</th>
          </tr>
        </thead>
        <tbody>${lineItemsHtml}</tbody>
      </table>
      <div style="text-align:right;margin-bottom:24px;">
        <span style="font-size:16px;font-weight:700;color:#111;">Total: $${po.total}</span>
      </div>
      ${po.supplierNotes ? `<p style="color:#555;font-size:14px;border-top:1px solid #f0f0f0;padding-top:16px;"><strong>Notes:</strong> ${po.supplierNotes}</p>` : ''}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="color:#999;font-size:12px;">Please confirm receipt and expected delivery date by replying to this email.</p>
    </div>
  `;

        const emailResult = await sendEmail(
          po.supplierContactEmail,
          `Purchase Order #${po.poNumber}`,
          html,
        );

        if (!emailResult.sent) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to send PO email: ${emailResult.error ?? "Unknown error"}`,
          });
        }

        await db.update(purchaseOrders).set({ status: "sent", sentAt: new Date() })
          .where(eq(purchaseOrders.id, input.id));
        await db.insert(purchaseOrderEvents).values({
          purchaseOrderId: input.id,
          eventType: "sent",
          description: `PO emailed to ${po.supplierContactEmail}`,
          userId: ctx.user.id,
        });

        return { success: true, method: "email" as const };
      }

      // Download — just mark as sent and return the PO data for client-side PDF generation
      await db.update(purchaseOrders).set({ status: "sent", sentAt: new Date() })
        .where(eq(purchaseOrders.id, input.id));
      await db.insert(purchaseOrderEvents).values({
        purchaseOrderId: input.id,
        eventType: "sent",
        description: "PO downloaded as PDF",
        userId: ctx.user.id,
      });
      return { success: true, method: "download" as const, po };
    }),

  /**
   * updateStatus — change PO status with event logging.
   */
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["acknowledged", "in_production", "shipped", "cancelled", "declined"]),
      trackingNumber: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [po] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.id)))
        .limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });

      const updateData: Record<string, unknown> = { status: input.status };
      let eventDescription = `Status changed to ${input.status}`;

      if (input.status === "acknowledged") {
        updateData.acknowledgedAt = new Date();
        eventDescription = "Supplier acknowledged the PO";
      } else if (input.status === "shipped") {
        updateData.actualShipDate = new Date();
        if (input.trackingNumber) {
          const existing = (po.trackingNumbers || []) as string[];
          existing.push(input.trackingNumber);
          updateData.trackingNumbers = existing;
          eventDescription = `Shipped — tracking: ${input.trackingNumber}`;
        }
      } else if (input.status === "cancelled") {
        eventDescription = `PO cancelled${input.notes ? `: ${input.notes}` : ""}`;
      } else if (input.status === "declined") {
        eventDescription = `Supplier declined the PO${input.notes ? `: ${input.notes}` : ""}`;
      }

      await db.update(purchaseOrders).set(updateData).where(eq(purchaseOrders.id, input.id));

      await db.insert(purchaseOrderEvents).values({
        purchaseOrderId: input.id,
        eventType: input.status === "cancelled" ? "cancelled" : "status_changed",
        description: eventDescription,
        userId: ctx.user.id,
        metadata: input.notes ? { notes: input.notes } : null,
      });

      // Fire notification for key status changes
      const notifTypeMap: Record<string, "po_acknowledged" | "po_shipped"> = {
        acknowledged: "po_acknowledged",
        shipped: "po_shipped",
      };
      const notifType = notifTypeMap[input.status];
      if (notifType) {
        await notifyOwner({
          userId: ctx.user.id,
          organizationId: scope.organizationId ?? undefined,
          type: notifType,
          title: `${po.supplierName} — ${eventDescription}`,
          content: `PO ${po.poNumber}: ${eventDescription}`,
          actionPath: `/purchase-orders/${input.id}`,
          actionLabel: "View PO",
          entityId: input.id,
          entityType: "purchaseOrder",
        });
      }

      return { success: true };
    }),

  /**
   * receive — mark items as received (full or partial).
   */
  receive: protectedProcedure
    .input(z.object({
      id: z.number(),
      receivedItems: z.array(z.object({
        lineItemIndex: z.number().min(0),
        quantityReceived: z.number().min(0),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [po] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.id)))
        .limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });

      const items = po.lineItems as POLineItem[];

      // Accumulate received quantities per line item
      for (const { lineItemIndex, quantityReceived } of input.receivedItems) {
        if (lineItemIndex >= items.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid line item index: ${lineItemIndex}` });
        }
        const item = items[lineItemIndex];
        const currentReceived = item.quantityReceived || 0;
        const newReceived = currentReceived + quantityReceived;
        if (newReceived > item.quantity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot receive ${quantityReceived} of "${item.productName}" — would exceed ordered quantity (${item.quantity} ordered, ${currentReceived} already received)`,
          });
        }
        item.quantityReceived = newReceived;
      }

      // Write updated line items back to DB
      await db.update(purchaseOrders).set({ lineItems: items }).where(eq(purchaseOrders.id, input.id));

      // Determine new status from accumulated totals
      const totalOrdered = items.reduce((sum, li) => sum + li.quantity, 0);
      const totalReceived = items.reduce((sum, li) => sum + (li.quantityReceived || 0), 0);
      const isFullyReceived = totalReceived >= totalOrdered;
      const newStatus = isFullyReceived ? "received" : "partial";

      await db.update(purchaseOrders).set({ status: newStatus }).where(eq(purchaseOrders.id, input.id));

      const description = isFullyReceived
        ? `All ${totalOrdered} items received`
        : `Partial receiving: ${totalReceived} of ${totalOrdered} items`;

      await db.insert(purchaseOrderEvents).values({
        purchaseOrderId: input.id,
        eventType: "received",
        description,
        userId: ctx.user.id,
        metadata: { receivedItems: input.receivedItems },
      });

      // Fire notification
      await notifyOwner({
        userId: ctx.user.id,
        organizationId: scope.organizationId ?? undefined,
        type: "po_received",
        title: `PO ${po.poNumber} — ${isFullyReceived ? "Fully Received" : "Partial Receiving"}`,
        content: description,
        actionPath: `/purchase-orders/${input.id}`,
        actionLabel: "View PO",
        entityId: input.id,
        entityType: "purchaseOrder",
      });

      return { success: true, status: newStatus, totalReceived, totalOrdered };
    }),

  /**
   * delete — only draft POs can be deleted.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [po] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.id)))
        .limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });
      if (po.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft POs can be deleted" });

      await db.delete(purchaseOrderEvents).where(eq(purchaseOrderEvents.purchaseOrderId, input.id));
      await db.delete(purchaseOrders).where(eq(purchaseOrders.id, input.id));

      return { success: true };
    }),

  /**
   * suppliers.list — supplier directory, auto-populated from PO history.
   */
  listSuppliers: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const conditions = [scope.organizationId != null
        ? eq(suppliers.organizationId, scope.organizationId)
        : eq(suppliers.userId, scope.userId)];

      let rows = await db.select().from(suppliers)
        .where(and(...conditions))
        .orderBy(desc(suppliers.lastOrderDate))
        .limit(input.limit);

      if (input.search) {
        const s = input.search.toLowerCase();
        rows = rows.filter(r => r.name.toLowerCase().includes(s) || (r.code && r.code.toLowerCase().includes(s)));
      }

      return { suppliers: rows };
    }),

  /**
   * bulkGenerateFromOrders — generate POs for multiple orders at once.
   */
  bulkGenerateFromOrders: protectedProcedure
    .input(z.object({ orderIds: z.array(z.number()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const results: Array<{ orderId: number; poCount: number; success: boolean; error?: string }> = [];

      for (const orderId of input.orderIds) {
        try {
          // Check if POs already exist
          const existing = await db.select({ id: purchaseOrders.id }).from(purchaseOrders)
            .where(and(scope.purchaseOrders, eq(purchaseOrders.orderId, orderId)));
          if (existing.length > 0) {
            results.push({ orderId, poCount: 0, success: false, error: "POs already exist" });
            continue;
          }

          // Load order + items
          const [order] = await db.select().from(orders)
            .where(and(scope.orders, eq(orders.id, orderId))).limit(1);
          if (!order) { results.push({ orderId, poCount: 0, success: false, error: "Order not found" }); continue; }

          const oiRows = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
          if (oiRows.length === 0) { results.push({ orderId, poCount: 0, success: false, error: "No items" }); continue; }

          const productIds = oiRows.map(oi => oi.productId);
          const productRows = await db.select().from(products).where(inArray(products.id, productIds));
          const productMap = new Map(productRows.map(p => [p.id, p]));

          const itemsForGrouping: OrderItemWithProduct[] = oiRows.map(oi => {
            const p = productMap.get(oi.productId);
            return {
              orderItemId: oi.id, productId: oi.productId,
              productName: p?.name || `Product #${oi.productId}`,
              sku: p?.sku || null, category: p?.category || null,
              imageUrl: p?.imageUrl || null, basePrice: p?.basePrice || null,
              unitPrice: oi.unitPrice, quantity: oi.quantity,
              color: oi.color || null, size: oi.size || null,
              decorationType: oi.decorationType || null, decorationLocation: null,
              logoUrl: null, supplier: p?.supplier || null,
              supplierSku: p?.supplierSku || null, supplierCode: p?.supplierCode || null,
              externalSource: p?.externalSource || null, source: p?.source || null,
            };
          });

          const buckets = await groupBySupplier(itemsForGrouping);
          let poCount = 0;
          for (const bucket of buckets) {
            const lineItems: POLineItem[] = bucket.items.map(item => {
              const costPrice = toFloat(item.basePrice);
              return {
                orderItemId: item.orderItemId, productId: item.productId,
                productName: item.productName, supplierSku: item.supplierSku,
                productNumber: item.sku, quantity: item.quantity,
                costPrice, totalCost: costPrice * item.quantity, quantityReceived: 0,
                color: item.color, size: item.size,
                decorationType: item.decorationType, decorationLocation: item.decorationLocation,
                logoUrl: item.logoUrl, imageUrl: item.imageUrl, notes: null,
              };
            });
            const subtotal = lineItems.reduce((sum, li) => sum + li.totalCost, 0);
            await db.insert(purchaseOrders).values({
              userId: ctx.user.id, organizationId: scope.organizationId,
              orderId, supplierName: bucket.supplierName,
              supplierCode: bucket.supplierCode, supplierSource: bucket.supplierSource,
              poNumber: await nextDocumentNumber(scope.organizationId, ctx.user.id, "po"), status: "draft", lineItems,
              subtotal: subtotal.toFixed(2), shipping: "0.00", tax: "0.00", total: subtotal.toFixed(2),
              aiGroupingConfidence: bucket.confidence.toFixed(2), aiGroupingReason: bucket.reason,
            } satisfies Omit<InsertPurchaseOrder, "id" | "createdAt" | "updatedAt">);
            poCount++;
          }
          results.push({ orderId, poCount, success: true });
        } catch (err) {
          results.push({ orderId, poCount: 0, success: false, error: String(err) });
        }
      }

      const totalGenerated = results.reduce((sum, r) => sum + r.poCount, 0);
      if (totalGenerated > 0) {
        await notifyOwner({
          userId: ctx.user.id,
          organizationId: scope.organizationId ?? undefined,
          type: "po_created",
          title: `${totalGenerated} POs Bulk Generated`,
          content: `Generated POs for ${input.orderIds.length} orders`,
          actionPath: "/purchase-orders",
          actionLabel: "View POs",
        });
      }

      return { results, totalGenerated };
    }),

  /**
   * merge — combine multiple draft POs from the same supplier into one.
   */
  merge: protectedProcedure
    .input(z.object({ poIds: z.array(z.number()).min(2).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Load all POs
      const poRows = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, inArray(purchaseOrders.id, input.poIds)));

      if (poRows.length !== input.poIds.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "One or more POs not found" });
      }

      // Validate: all must be draft, all must be same supplier (normalized)
      for (const po of poRows) {
        if (po.status !== "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `PO ${po.poNumber} is not in draft status` });
        }
      }

      const normalizedNames = new Set(poRows.map(po => normalizeSupplierName(po.supplierName)));
      if (normalizedNames.size > 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "All POs must be from the same supplier to merge" });
      }

      const orderIds = new Set(poRows.map(po => po.orderId));
      if (orderIds.size > 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge POs from different orders" });
      }

      // Merge into the first PO
      const targetPo = poRows[0];
      const sourcePOs = poRows.slice(1);
      const allLineItems: POLineItem[] = [...(targetPo.lineItems as POLineItem[])];

      for (const source of sourcePOs) {
        allLineItems.push(...(source.lineItems as POLineItem[]));
      }

      const subtotal = allLineItems.reduce((sum, li) => sum + li.totalCost, 0);

      // Update target PO with merged items
      await db.update(purchaseOrders).set({
        lineItems: allLineItems,
        subtotal: subtotal.toFixed(2),
        total: (subtotal + toFloat(targetPo.shipping) + toFloat(targetPo.tax)).toFixed(2),
      }).where(eq(purchaseOrders.id, targetPo.id));

      // Log the merge
      const sourceNumbers = sourcePOs.map(po => po.poNumber).join(", ");
      await db.insert(purchaseOrderEvents).values({
        purchaseOrderId: targetPo.id,
        eventType: "note_added",
        description: `Merged from ${sourceNumbers} — ${allLineItems.length} total items`,
        userId: ctx.user.id,
      });

      // Delete source POs
      const sourceIds = sourcePOs.map(po => po.id);
      await db.delete(purchaseOrderEvents).where(inArray(purchaseOrderEvents.purchaseOrderId, sourceIds));
      await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, sourceIds));

      return {
        success: true,
        mergedPoId: targetPo.id,
        mergedPoNumber: targetPo.poNumber,
        totalItems: allLineItems.length,
        total: (subtotal + toFloat(targetPo.shipping) + toFloat(targetPo.tax)).toFixed(2),
        deletedPOs: sourceNumbers,
      };
    }),

  /**
   * previewAggregate — group selected unprocessed POs by supplier so the
   * user can review proposed consolidation before confirming. Pure read.
   * When no poIds are supplied, every unprocessed PO in the org is used.
   */
  previewAggregate: protectedProcedure
    .input(z.object({ poIds: z.array(z.number()).optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const baseWhere = input.poIds && input.poIds.length > 0
        ? and(scope.purchaseOrders, inArray(purchaseOrders.id, input.poIds))
        : and(scope.purchaseOrders, inArray(purchaseOrders.status, ["draft", "sent", "acknowledged"] as const));
      const rows = await db.select().from(purchaseOrders).where(baseWhere);

      // Only POs still eligible for aggregation (not already consolidated/merged).
      const eligible = rows.filter((r) => r.status !== "consolidated" && r.status !== "merged");

      const groups = new Map<string, { supplierName: string; supplierKey: string; pos: Array<{ id: number; poNumber: string; total: string; itemCount: number }> }>();
      for (const po of eligible) {
        const key = normalizeSupplierName(po.supplierName) || po.supplierName.toLowerCase().trim();
        const entry = groups.get(key) ?? { supplierName: po.supplierName, supplierKey: key, pos: [] };
        entry.pos.push({
          id: po.id,
          poNumber: po.poNumber,
          total: po.total,
          itemCount: (po.lineItems as POLineItem[] | null)?.length ?? 0,
        });
        groups.set(key, entry);
      }

      // Only return groups with 2+ POs — a single PO doesn't need merging.
      const allGroups = Array.from(groups.values());
      const consolidatable = allGroups.filter((g) => g.pos.length >= 2);
      const singletonCount = allGroups.filter((g) => g.pos.length === 1).length;

      return {
        eligibleCount: eligible.length,
        consolidatableGroups: consolidatable,
        singletonCount,
      };
    }),

  /**
   * aggregate — create merged POs per supplier group, mark originals as
   * "consolidated". Originals stay in the list with no further actions.
   * Each merged PO records mergedFromPoIds for lineage.
   */
  aggregate: protectedProcedure
    .input(z.object({
      groups: z.array(z.object({
        supplierName: z.string().min(1),
        poIds: z.array(z.number()).min(2),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const allIds = input.groups.flatMap((g) => g.poIds);
      const rows = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, inArray(purchaseOrders.id, allIds)));
      if (rows.length !== allIds.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "One or more POs not found" });
      }
      for (const po of rows) {
        if (po.status === "consolidated" || po.status === "merged") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `PO ${po.poNumber} has already been aggregated` });
        }
      }

      const byId = new Map(rows.map((po) => [po.id, po] as const));
      const created: Array<{ id: number; poNumber: string; supplierName: string; sourceCount: number }> = [];

      for (const group of input.groups) {
        const sources = group.poIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
        const lineItems: POLineItem[] = sources.flatMap((po) => (po.lineItems as POLineItem[] | null) ?? []);
        const subtotal = lineItems.reduce((sum, li) => sum + (li.totalCost || 0), 0);
        const shipping = sources.reduce((s, po) => s + toFloat(po.shipping), 0);
        const tax = sources.reduce((s, po) => s + toFloat(po.tax), 0);
        const total = subtotal + shipping + tax;
        const poNumber = await nextDocumentNumber(scope.organizationId, ctx.user.id, "po");

        // Inherit contact details from the first source that has them.
        const firstWithContact = sources.find((po) => po.supplierContactEmail || po.supplierContactPhone) ?? sources[0];

        const [insertResult] = await db.insert(purchaseOrders).values({
          userId: ctx.user.id,
          organizationId: scope.organizationId ?? null,
          orderId: null,
          proposalId: null,
          supplierName: group.supplierName,
          supplierCode: firstWithContact.supplierCode,
          supplierSource: firstWithContact.supplierSource,
          supplierContactEmail: firstWithContact.supplierContactEmail,
          supplierContactPhone: firstWithContact.supplierContactPhone,
          supplierAccountNumber: firstWithContact.supplierAccountNumber,
          poNumber,
          status: "merged" as const,
          lineItems,
          subtotal: subtotal.toFixed(2),
          shipping: shipping.toFixed(2),
          tax: tax.toFixed(2),
          total: total.toFixed(2),
          mergedFromPoIds: sources.map((po) => po.id),
          internalNotes: `Aggregated from ${sources.length} POs: ${sources.map((p) => p.poNumber).join(", ")}`,
        });
        const mergedPoId = insertResult.insertId;

        await db.insert(purchaseOrderEvents).values({
          purchaseOrderId: mergedPoId,
          eventType: "created",
          description: `Merged from ${sources.length} POs (${sources.map((p) => p.poNumber).join(", ")})`,
          userId: ctx.user.id,
          metadata: { sourcePoIds: sources.map((p) => p.id) },
        });

        // Mark originals consolidated + log the rollup on each.
        await db.update(purchaseOrders)
          .set({ status: "consolidated" })
          .where(inArray(purchaseOrders.id, sources.map((p) => p.id)));
        for (const src of sources) {
          await db.insert(purchaseOrderEvents).values({
            purchaseOrderId: src.id,
            eventType: "status_changed",
            description: `Consolidated into ${poNumber}`,
            userId: ctx.user.id,
            metadata: { mergedIntoPoId: mergedPoId, mergedIntoPoNumber: poNumber },
          });
        }

        created.push({ id: mergedPoId, poNumber, supplierName: group.supplierName, sourceCount: sources.length });
      }

      return { success: true, merged: created };
    }),

  /**
   * getMergedSources — for a "merged" PO, return a summary of the original
   * POs that were consolidated into it, so the detail view can link back.
   */
  getMergedSources: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [po] = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.id, input.id))).limit(1);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });

      const sourceIds = (po.mergedFromPoIds as number[] | null | undefined) ?? [];
      if (sourceIds.length === 0) return { sources: [] };

      const sources = await db.select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        supplierName: purchaseOrders.supplierName,
        status: purchaseOrders.status,
        total: purchaseOrders.total,
        createdAt: purchaseOrders.createdAt,
      }).from(purchaseOrders)
        .where(and(scope.purchaseOrders, inArray(purchaseOrders.id, sourceIds)));

      return { sources };
    }),

  /**
   * getMarginAnalysis — sell price (from order) vs cost price (from POs).
   */
  getMarginAnalysis: protectedProcedure
    .input(z.object({ orderId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Get order items (sell prices)
      const [order] = await db.select().from(orders)
        .where(and(scope.orders, eq(orders.id, input.orderId)))
        .limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });

      const oiRows = await db.select().from(orderItems)
        .where(eq(orderItems.orderId, input.orderId));

      // Get POs (cost prices)
      const poRows = await db.select().from(purchaseOrders)
        .where(and(scope.purchaseOrders, eq(purchaseOrders.orderId, input.orderId)));

      if (poRows.length === 0) {
        return { available: false as const, message: "Generate purchase orders to see margin analysis" };
      }

      // Build cost map: productId → total cost
      const costMap = new Map<number, number>();
      for (const po of poRows) {
        const items = po.lineItems as POLineItem[];
        for (const item of items) {
          costMap.set(item.productId, (costMap.get(item.productId) || 0) + item.totalCost);
        }
      }

      // Get product names
      const productIds = oiRows.map(oi => oi.productId);
      const productRows = productIds.length > 0
        ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds))
        : [];
      const nameMap = new Map(productRows.map(p => [p.id, p.name]));

      let totalSellPrice = 0;
      let totalCostPrice = 0;

      const perItem = oiRows.map(oi => {
        const sellPrice = toFloat(oi.totalPrice);
        const costPrice = costMap.get(oi.productId) || 0;
        const margin = sellPrice - costPrice;
        const marginPercent = sellPrice > 0 ? (margin / sellPrice) * 100 : 0;
        totalSellPrice += sellPrice;
        totalCostPrice += costPrice;

        return {
          productName: nameMap.get(oi.productId) || `Product #${oi.productId}`,
          quantity: oi.quantity,
          sellPrice,
          costPrice,
          margin,
          marginPercent: Math.round(marginPercent * 10) / 10,
        };
      });

      const grossMargin = totalSellPrice - totalCostPrice;
      const grossMarginPercent = totalSellPrice > 0 ? (grossMargin / totalSellPrice) * 100 : 0;

      return {
        available: true as const,
        totalSellPrice,
        totalCostPrice,
        grossMargin,
        grossMarginPercent: Math.round(grossMarginPercent * 10) / 10,
        perItem,
      };
    }),

  /**
   * previewFromProposal — AI-group line items from a single proposal into
   * supplier buckets and persist as a short-lived preview draft. Returns a
   * `previewToken` the client uses to navigate to the preview screen.
   *
   * Does NOT create POs. Confirmation happens via `confirmGeneration`.
   */
  previewFromProposal: protectedProcedure
    .input(z.object({ proposalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const items = await loadProposalItemsForGrouping(input.proposalId, scope);
      const buckets = items.length > 0 ? await groupBySupplier(items) : [];
      const flagged = buckets.filter(b => b.needsManualAssignment);

      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await db.insert(poPreviewDrafts).values({
        token,
        userId: ctx.user.id,
        organizationId: scope.organizationId,
        payload: { groups: buckets, flagged, sourceProposalIds: [input.proposalId] },
        sourceProposalIds: [input.proposalId],
        expiresAt,
      });

      return {
        previewToken: token,
        groups: buckets,
        flagged,
        sourceProposalIds: [input.proposalId],
        expiresAt: expiresAt.toISOString(),
      };
    }),

  /**
   * previewBulkFromApproved — AI-group items across ALL accepted proposals
   * for the org, merging same-supplier items into shared buckets. Returns
   * a preview token.
   */
  previewBulkFromApproved: protectedProcedure
    .input(z.object({}).optional())
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const acceptedProposals = await db.select({ id: proposals.id }).from(proposals)
        .where(and(scope.proposals, eq(proposals.status, "accepted")));

      if (acceptedProposals.length === 0) {
        return {
          previewToken: null,
          groups: [],
          flagged: [],
          sourceProposalIds: [],
          message: "No accepted proposals found.",
        };
      }

      // Aggregate items across proposals
      const allItems = (
        await Promise.all(acceptedProposals.map(p => loadProposalItemsForGrouping(p.id, scope)))
      ).flat();
      if (allItems.length === 0) {
        return {
          previewToken: null,
          groups: [],
          flagged: [],
          sourceProposalIds: acceptedProposals.map(p => p.id),
          message: "Approved proposals have no line items.",
        };
      }

      const buckets = await groupBySupplier(allItems);
      const flagged = buckets.filter(b => b.needsManualAssignment);

      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await db.insert(poPreviewDrafts).values({
        token,
        userId: ctx.user.id,
        organizationId: scope.organizationId,
        payload: { groups: buckets, flagged, sourceProposalIds: acceptedProposals.map(p => p.id) },
        sourceProposalIds: acceptedProposals.map(p => p.id),
        expiresAt,
      });

      return {
        previewToken: token,
        groups: buckets,
        flagged,
        sourceProposalIds: acceptedProposals.map(p => p.id),
        expiresAt: expiresAt.toISOString(),
      };
    }),

  /**
   * getPreview — fetch a preview draft by token (for the preview screen).
   */
  getPreview: protectedProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [draft] = await db.select().from(poPreviewDrafts)
        .where(and(
          eq(poPreviewDrafts.token, input.token),
          scope.organizationId != null
            ? eq(poPreviewDrafts.organizationId, scope.organizationId)
            : eq(poPreviewDrafts.userId, ctx.user.id),
        )).limit(1);
      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Preview not found or expired" });
      if (draft.confirmedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Preview already confirmed" });
      if (draft.expiresAt && draft.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Preview expired" });
      }

      return {
        token: draft.token,
        payload: draft.payload as { groups: SupplierBucket[]; flagged: SupplierBucket[]; sourceProposalIds: number[] },
        sourceProposalIds: draft.sourceProposalIds,
        expiresAt: draft.expiresAt,
      };
    }),

  /**
   * confirmGeneration — commit a preview draft. Optional `editedGroups`
   * lets the client supply a modified bucket list (e.g. items moved
   * between suppliers, supplier names corrected).
   */
  confirmGeneration: protectedProcedure
    .input(z.object({
      previewToken: z.string(),
      editedGroups: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [draft] = await db.select().from(poPreviewDrafts)
        .where(and(
          eq(poPreviewDrafts.token, input.previewToken),
          scope.organizationId != null
            ? eq(poPreviewDrafts.organizationId, scope.organizationId)
            : eq(poPreviewDrafts.userId, ctx.user.id),
        )).limit(1);
      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Preview not found or expired" });
      if (draft.confirmedAt) throw new TRPCError({ code: "CONFLICT", message: "Preview already confirmed" });
      if (draft.expiresAt && draft.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Preview expired" });
      }

      const payload = draft.payload as { groups: SupplierBucket[]; flagged: SupplierBucket[]; sourceProposalIds: number[] };
      const groups = (input.editedGroups as SupplierBucket[] | undefined) ?? payload.groups;

      // Mark confirmed FIRST to enforce single-use idempotency.
      await db.update(poPreviewDrafts)
        .set({ confirmedAt: new Date() })
        .where(eq(poPreviewDrafts.id, draft.id));

      const result = await createPOsFromBuckets(ctx.user.id, scope.organizationId, groups, {
        orderId: null,
        proposalIds: draft.sourceProposalIds as number[],
        contextLabel: `Proposal(s) ${(draft.sourceProposalIds as number[]).join(", ")}`,
      });

      // Notify owner
      try {
        await notifyOwner({
          userId: ctx.user.id,
          organizationId: scope.organizationId ?? undefined,
          type: "po_created",
          title: `${result.totalPOs} Purchase Order${result.totalPOs > 1 ? "s" : ""} Generated`,
          content: `From proposal(s) ${(draft.sourceProposalIds as number[]).join(", ")}: ${result.purchaseOrders.map(p => p.supplierName).join(", ")}`,
          actionPath: "/purchase-orders",
          actionLabel: "View POs",
        });
      } catch {
        // Notification failures are non-fatal
      }

      return result;
    }),

  /**
   * generateSingleFromProposal — create ONE PO covering every line item in
   * the source document (a proposal, or a proposal resolved via estimate /
   * invoice). Cost / wholesale pricing only; client-facing unitPrice is
   * never read. Lines with no cost populated show "TBD" (stored as 0 cost
   * with a note) so the UI can surface the gap without blocking creation.
   *
   * Exactly one of `proposalId`, `estimateId`, `invoiceId` must be supplied.
   */
  generateSingleFromProposal: protectedProcedure
    .input(z.object({
      proposalId: z.number().optional(),
      estimateId: z.number().optional(),
      invoiceId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const proposalId = await resolveProposalIdFromInput(db, scope, input);

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, proposalId), scope.proposals)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const items = await loadProposalItemsForGrouping(proposalId, scope);
      if (items.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No line items to include in the PO." });
      }

      // Build a single-bucket PO — supplier name defaults to the most common
      // named supplier, or "Mixed Suppliers" when there is no clear majority.
      const supplierCounts = new Map<string, number>();
      for (const it of items) {
        const name = (it.supplier && it.supplier.trim()) || "Unassigned";
        supplierCounts.set(name, (supplierCounts.get(name) ?? 0) + 1);
      }
      const topSupplier = Array.from(supplierCounts.entries())
        .sort((a, b) => b[1] - a[1])[0];
      const supplierName = supplierCounts.size === 1
        ? topSupplier[0]
        : "Mixed Suppliers";

      // Resolve per-line cost prices from the new proposalProducts.costPrice /
      // proposalOrderItems.poiCostPrice columns first, falling back to
      // products.basePrice. Null → stored as 0 with a "TBD" note.
      const poProductIds = items.map(it => it.productId);
      const prodRows = poProductIds.length > 0
        ? await db.select().from(products).where(inArray(products.id, poProductIds))
        : [];
      const prodCostMap = new Map(prodRows.map(p => [p.id, p.basePrice ?? null]));

      // Also look up per-proposal-line cost overrides
      const [ppRows, oiRows] = await Promise.all([
        db.select().from(proposalProducts).where(eq(proposalProducts.proposalId, proposalId)),
        db.select().from(proposalOrderItems).where(eq(proposalOrderItems.proposalId, proposalId)),
      ]);
      const ppCostById = new Map(ppRows.map(r => [r.id, r.costPrice ?? null]));
      const oiCostById = new Map(oiRows.map(r => [r.id, r.costPrice ?? null]));

      const lineItems: POLineItem[] = items.map(it => {
        // `orderItemId` was repurposed by loadProposalItemsForGrouping to
        // carry the ID of the proposalOrderItem OR proposalProduct row.
        const oiCost = oiCostById.get(it.orderItemId);
        const ppCost = ppCostById.get(it.orderItemId);
        const baseCost = prodCostMap.get(it.productId);
        const rawCost = oiCost ?? ppCost ?? baseCost ?? null;
        const costPrice = rawCost != null ? parseFloat(String(rawCost)) : 0;
        const missing = rawCost == null;
        return {
          orderItemId: it.orderItemId,
          productId: it.productId,
          productName: it.productName,
          supplierSku: it.supplierSku ?? null,
          productNumber: it.sku ?? null,
          quantity: it.quantity,
          costPrice,
          totalCost: +(costPrice * it.quantity).toFixed(2),
          quantityReceived: 0,
          color: it.color ?? null,
          size: it.size ?? null,
          decorationType: it.decorationType ?? null,
          decorationLocation: it.decorationLocation ?? null,
          logoUrl: it.logoUrl ?? null,
          imageUrl: it.imageUrl ?? null,
          notes: missing ? "TBD — supplier cost not yet populated" : null,
        };
      });

      const subtotal = lineItems.reduce((s, li) => s + (li.totalCost || 0), 0);
      const poNumber = await nextDocumentNumber(scope.organizationId, ctx.user.id, "po");

      const [result] = await db.insert(purchaseOrders).values({
        userId: ctx.user.id,
        organizationId: scope.organizationId,
        orderId: null,
        proposalId,
        supplierName,
        supplierCode: null,
        supplierSource: null,
        poNumber,
        status: "draft" as const,
        lineItems,
        subtotal: subtotal.toFixed(2),
        shipping: "0.00",
        tax: "0.00",
        total: subtotal.toFixed(2),
        internalNotes: `Single PO generated from proposal #${proposalId}`,
      } satisfies Omit<InsertPurchaseOrder, "id" | "createdAt" | "updatedAt">);

      await db.insert(purchaseOrderEvents).values({
        purchaseOrderId: result.insertId,
        eventType: "created",
        description: `Single PO created for proposal #${proposalId} (${lineItems.length} items)`,
        userId: ctx.user.id,
      });

      return {
        id: result.insertId,
        poNumber,
        supplierName,
        itemCount: lineItems.length,
        total: subtotal.toFixed(2),
      };
    }),

  /**
   * queueAutoAggregateReview — AI-group items across one or more source
   * documents by supplier and drop the result into the distributor's AI
   * Inbox (copilotPendingActions) for review. No POs are created until the
   * distributor approves.
   *
   * If multiple source documents are supplied, their items are consolidated
   * into a single preview so the inbox receives ONE task, not N.
   */
  queueAutoAggregateReview: protectedProcedure
    .input(z.object({
      proposalIds: z.array(z.number()).optional(),
      estimateIds: z.array(z.number()).optional(),
      invoiceIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Resolve every input doc down to a deduped set of proposalIds.
      const resolvedIds = new Set<number>();
      for (const pid of input.proposalIds ?? []) resolvedIds.add(pid);
      for (const eid of input.estimateIds ?? []) {
        resolvedIds.add(await resolveProposalIdFromInput(db, scope, { estimateId: eid }));
      }
      for (const iid of input.invoiceIds ?? []) {
        resolvedIds.add(await resolveProposalIdFromInput(db, scope, { invoiceId: iid }));
      }
      const proposalIdList = Array.from(resolvedIds);
      if (proposalIdList.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No source documents supplied" });
      }

      // Load & merge items across proposals
      const allItems = (
        await Promise.all(proposalIdList.map(pid => loadProposalItemsForGrouping(pid, scope)))
      ).flat();
      if (allItems.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Source documents have no line items" });
      }

      const buckets = await groupBySupplier(allItems);
      const flagged = buckets.filter(b => b.needsManualAssignment);

      // Persist preview draft (reused on approval to create the POs).
      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h — inbox review may take longer than an hour
      await db.insert(poPreviewDrafts).values({
        token,
        userId: ctx.user.id,
        organizationId: scope.organizationId,
        payload: { groups: buckets, flagged, sourceProposalIds: proposalIdList },
        sourceProposalIds: proposalIdList,
        expiresAt,
      });

      // Build a summary for the inbox card
      const totalItems = buckets.reduce((s, b) => s + b.items.reduce((n, it) => n + it.quantity, 0), 0);
      const totalCost = buckets.reduce((s, b) =>
        s + b.items.reduce((n, it) => n + (parseFloat(String(it.basePrice ?? "0")) || 0) * it.quantity, 0)
      , 0);
      const sourceLabel = proposalIdList.length === 1
        ? `proposal #${proposalIdList[0]}`
        : `${proposalIdList.length} documents`;
      const summary = `Auto-Aggregate POs for ${sourceLabel}: ${buckets.length} supplier${buckets.length === 1 ? "" : "s"}, ${totalItems} item${totalItems === 1 ? "" : "s"}, ~$${totalCost.toFixed(2)} cost`;

      // Drop into AI Inbox (copilotPendingActions) as an "agent" task. The
      // approve path is wired up in copilotExec/index.ts and calls
      // createPOsFromBuckets using the stored preview token.
      const toolCallId = `po-auto-${token.slice(0, 12)}`;
      const serializedArgs = JSON.stringify({
        previewToken: token,
        sourceProposalIds: proposalIdList,
        groupCount: buckets.length,
        itemCount: totalItems,
        estimatedCost: totalCost.toFixed(2),
        draft: buckets.map(b =>
          `${b.supplierName} — ${b.items.length} line${b.items.length === 1 ? "" : "s"}`,
        ).join("\n"),
        confidence: buckets.length > 0
          ? buckets.reduce((s, b) => s + b.confidence, 0) / buckets.length / 100
          : 0.5,
      });

      await db.insert(copilotPendingActions).values({
        userId: ctx.user.id,
        organizationId: scope.organizationId,
        toolCallId,
        toolName: "po_auto_aggregate_apply",
        summary,
        serializedArgs,
        status: "pending",
        source: "agent",
      });

      return {
        previewToken: token,
        groupCount: buckets.length,
        flagged: flagged.length,
        sourceProposalIds: proposalIdList,
      };
    }),
});

// ── Local helpers (proposal → grouping items adapter) ───────────────────────

/**
 * Given `{proposalId?, estimateId?, invoiceId?}` (exactly one supplied),
 * return the resolved proposal ID with org-scope enforcement. Invoices that
 * reference an estimate instead of a proposal fall through to the estimate's
 * proposalId.
 */
async function resolveProposalIdFromInput(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  scope: ReturnType<typeof getOrgScope>,
  input: { proposalId?: number; estimateId?: number; invoiceId?: number },
): Promise<number> {
  if (input.proposalId != null) return input.proposalId;
  if (input.estimateId != null) {
    const [est] = await db.select().from(estimates)
      .where(and(eq(estimates.id, input.estimateId), scope.estimates)).limit(1);
    if (!est) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });
    // Builder-created estimates (migration 0078) have no parent proposal.
    // The proposal-backed PO path can't source from them; converting a
    // builder-only estimate to a PO is tracked as future work.
    if (est.proposalId == null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Estimate is not linked to a proposal" });
    }
    return est.proposalId;
  }
  if (input.invoiceId != null) {
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), scope.invoices)).limit(1);
    if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    if (inv.proposalId != null) return inv.proposalId;
    if (inv.estimateId != null) {
      const [est] = await db.select().from(estimates)
        .where(and(eq(estimates.id, inv.estimateId), scope.estimates)).limit(1);
      if (est?.proposalId != null) return est.proposalId;
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice is not linked to a proposal" });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "One of proposalId, estimateId, invoiceId is required" });
}

/**
 * Load proposal line items (proposalOrderItems with proposalProducts fallback)
 * + joined products and map them into the generic grouping shape.
 *
 * Reuses the existing exact/fuzzy/LLM grouping engine. The
 * `orderItemId` field is repurposed as a stable identifier for proposal
 * line items (id of the proposalOrderItem or proposalProduct row) so the
 * preview/edit UI can reference items by it.
 */
async function loadProposalItemsForGrouping(
  proposalId: number,
  scope: ReturnType<typeof getOrgScope>,
): Promise<import("../utils/supplierGrouping").OrderItemWithProduct[]> {
  const db = await getDb();
  if (!db) return [];

  const productRows = await db.select().from(products).where(scope.products);
  const productMap = new Map(productRows.map(p => [p.id, p]));

  // Prefer client-selected order items; fall back to proposalProducts.
  const oiRows = await db.select().from(proposalOrderItems)
    .where(eq(proposalOrderItems.proposalId, proposalId));

  if (oiRows.length > 0) {
    return oiRows.map(item => {
      const p = productMap.get(item.productId);
      // Prefer per-line cost (proposalOrderItems.poiCostPrice) → product.basePrice.
      const effectiveCost = item.costPrice ?? p?.basePrice ?? null;
      return {
        orderItemId: item.id,
        productId: item.productId,
        productName: p?.name || "Product",
        sku: p?.sku || null,
        category: p?.category || null,
        imageUrl: p?.imageUrl || null,
        basePrice: effectiveCost,
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
      };
    });
  }

  const ppRows = await db.select().from(proposalProducts)
    .where(eq(proposalProducts.proposalId, proposalId));
  return ppRows.map(pp => {
    const p = productMap.get(pp.productId);
    const qty = pp.quantity ?? 1;
    // Prefer proposalProducts.costPrice → product.basePrice.
    const effectiveCost = pp.costPrice ?? p?.basePrice ?? null;
    return {
      orderItemId: pp.id,
      productId: pp.productId,
      productName: p?.name || "Product",
      sku: p?.sku || null,
      category: p?.category || null,
      imageUrl: p?.imageUrl || null,
      basePrice: effectiveCost,
      unitPrice: pp.unitPrice,
      quantity: qty,
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
    };
  });
}
