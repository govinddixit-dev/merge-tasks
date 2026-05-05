/**
 * dataExport.ts — CSV data export for clients, proposals, and orders.
 *
 * GDPR Art. 20 (right to data portability) and general business need
 * for distributors to export their data for accounting, reporting, and migration.
 */
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import {
  clients,
  proposals,
  proposalProducts,
  orders,
  orderItems,
  products,
} from "../../drizzle/schema";
import { getOrgScope } from "../utils/orgScope";
import { getLogger } from "../utils/logger";

const log = getLogger("dataExport");

/**
 * Escape a value for CSV: wrap in quotes if it contains comma, quote, or newline.
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}

function formatDate(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

export const dataExportRouter = router({
  /**
   * Export all clients as CSV
   */
  clients: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const scope = getOrgScope(ctx);

    const rows = await db
      .select()
      .from(clients)
      .where(scope.clients)
      .orderBy(desc(clients.createdAt));

    const headers = [
      "ID", "Company Name", "Contact Name", "Contact Email", "Contact Phone",
      "Address", "Industry", "Company Size", "Website",
      "Status", "Has Webstore", "Notes", "Created Date",
    ];

    const csvRows = rows.map((c) =>
      toCsvRow([
        c.id,
        c.companyName,
        c.contactName,
        c.contactEmail,
        c.contactPhone,
        c.address,
        c.industry,
        c.companySize,
        c.website,
        c.status,
        c.hasWebstore ? "Yes" : "No",
        c.notes,
        formatDate(c.createdAt),
      ])
    );

    const csv = [toCsvRow(headers), ...csvRows].join("\n");
    log.info(`Client CSV export: ${rows.length} rows for user ${ctx.user.id}`);
    return { csv, filename: `clients_export_${formatDate(new Date())}.csv`, rowCount: rows.length };
  }),

  /**
   * Export all proposals as CSV (with product line items flattened)
   */
  proposals: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const scope = getOrgScope(ctx);

    const allProposals = await db
      .select()
      .from(proposals)
      .where(scope.proposals)
      .orderBy(desc(proposals.createdAt));

    const proposalIds = allProposals.map((p) => p.id);

    // Fetch proposal products joined with product names
    let ppMap = new Map<number, Array<Record<string, unknown>>>();
    if (proposalIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      const proposalProductRows = await db
        .select({
          id: proposalProducts.id,
          proposalId: proposalProducts.proposalId,
          productId: proposalProducts.productId,
          quantity: proposalProducts.quantity,
          unitPrice: proposalProducts.unitPrice,
          decorationType: proposalProducts.decorationType,
          productName: products.name,
        })
        .from(proposalProducts)
        .leftJoin(products, eq(proposalProducts.productId, products.id))
        .where(inArray(proposalProducts.proposalId, proposalIds));

      for (const pp of proposalProductRows) {
        if (!ppMap.has(pp.proposalId)) ppMap.set(pp.proposalId, []);
        const unitPrice = parseFloat(pp.unitPrice || "0");
        const totalPrice = unitPrice * (pp.quantity || 0);
        ppMap.get(pp.proposalId)!.push({ ...pp, totalPrice: totalPrice.toFixed(2) });
      }
    }

    // Fetch client names for lookup
    const clientRows = await db.select({ id: clients.id, companyName: clients.companyName }).from(clients).where(scope.clients);
    const clientMap = new Map(clientRows.map((c) => [c.id, c.companyName]));

    const headers = [
      "Proposal ID", "Title", "Client", "Status", "Estimated Value (USD)",
      "Product Name", "Quantity", "Unit Price (USD)", "Line Total (USD)",
      "Sent Date", "Created Date", "Valid Days",
    ];

    const csvRows: string[] = [];
    for (const p of allProposals) {
      const prods = ppMap.get(p.id) || [];
      const clientName = p.clientId ? (clientMap.get(p.clientId) || "") : "";

      if (prods.length === 0) {
        csvRows.push(
          toCsvRow([
            p.id, p.title, clientName, p.status, p.estimatedValue || "",
            "", "", "", "",
            formatDate(p.sentAt), formatDate(p.createdAt), p.validDays,
          ])
        );
      } else {
        for (const pp of prods) {
          csvRows.push(
            toCsvRow([
              p.id, p.title, clientName, p.status, p.estimatedValue || "",
              pp.productName || "", pp.quantity ?? "", pp.unitPrice || "", pp.totalPrice || "",
              formatDate(p.sentAt), formatDate(p.createdAt), p.validDays,
            ])
          );
        }
      }
    }

    const csv = [toCsvRow(headers), ...csvRows].join("\n");
    log.info(`Proposal CSV export: ${allProposals.length} proposals for user ${ctx.user.id}`);
    return { csv, filename: `proposals_export_${formatDate(new Date())}.csv`, rowCount: allProposals.length };
  }),

  /**
   * Export all orders as CSV (with line items flattened)
   */
  orders: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const scope = getOrgScope(ctx);

    const allOrders = await db
      .select()
      .from(orders)
      .where(scope.orders)
      .orderBy(desc(orders.createdAt));

    const orderIds = allOrders.map((o) => o.id);

    // Fetch order items
    let itemMap = new Map<number, Array<Record<string, unknown>>>();
    if (orderIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      const items = await db
        .select()
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds));

      for (const item of items) {
        if (!itemMap.has(item.orderId)) itemMap.set(item.orderId, []);
        itemMap.get(item.orderId)!.push(item);
      }
    }

    // Client lookup
    const clientRows = await db.select({ id: clients.id, companyName: clients.companyName }).from(clients).where(scope.clients);
    const clientMap = new Map(clientRows.map((c) => [c.id, c.companyName]));

    const headers = [
      "Order Number", "Client", "Status", "Subtotal (USD)", "Tax (USD)", "Shipping (USD)", "Total (USD)",
      "Item Name", "Quantity", "Unit Price (USD)", "Line Total (USD)",
      "Shipping Name", "Shipping Address", "Tracking Number", "Payment Method", "Order Date",
    ];

    const csvRows: string[] = [];
    for (const o of allOrders) {
      const items = itemMap.get(o.id) || [];
      const clientName = o.clientId ? (clientMap.get(o.clientId) || "") : "";

      if (items.length === 0) {
        csvRows.push(
          toCsvRow([
            o.orderNumber, clientName, o.status, o.subtotal, o.tax, o.shipping, o.total,
            "", "", "", "",
            o.shippingName || "", o.shippingAddress || "", o.trackingNumber || "", o.paymentMethod || "", formatDate(o.createdAt),
          ])
        );
      } else {
        for (const item of items) {
          csvRows.push(
            toCsvRow([
              o.orderNumber, clientName, o.status, o.subtotal, o.tax, o.shipping, o.total,
              item.productName || "", item.quantity || "", item.unitPrice || "", item.totalPrice || "",
              o.shippingName || "", o.shippingAddress || "", o.trackingNumber || "", o.paymentMethod || "", formatDate(o.createdAt),
            ])
          );
        }
      }
    }

    const csv = [toCsvRow(headers), ...csvRows].join("\n");
    log.info(`Order CSV export: ${allOrders.length} orders for user ${ctx.user.id}`);
    return { csv, filename: `orders_export_${formatDate(new Date())}.csv`, rowCount: allOrders.length };
  }),

  /**
   * Export all purchase orders as CSV (with line items flattened).
   * Shows COST prices only — never sell prices.
   */
  purchaseOrders: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const scope = getOrgScope(ctx);

    const { purchaseOrders: poTable } = await import("../../drizzle/schema");
    const allPOs = await db.select().from(poTable)
      .where(scope.purchaseOrders)
      .orderBy(desc(poTable.createdAt));

    const headers = [
      "PO Number", "Supplier", "Supplier Code", "Source", "Status",
      "Product", "Supplier SKU", "Quantity", "Unit Cost (USD)", "Line Total (USD)",
      "Subtotal (USD)", "Shipping (USD)", "Tax (USD)", "Total (USD)",
      "Ship To", "Ship Type", "Requested Ship Date", "PO Date",
    ];

    const csvRows: string[] = [];
    for (const po of allPOs) {
      const items = (po.lineItems || []) as Array<{ productName: string; supplierSku: string | null; quantity: number; costPrice: number; totalCost: number }>;

      if (items.length === 0) {
        csvRows.push(
          toCsvRow([
            po.poNumber, po.supplierName, po.supplierCode || "", po.supplierSource || "", po.status,
            "", "", "", "", "",
            po.subtotal, po.shipping, po.tax, po.total,
            po.shipToName || "", po.shipToType || "", po.requestedShipDate ? formatDate(po.requestedShipDate) : "", formatDate(po.createdAt),
          ])
        );
      } else {
        for (const item of items) {
          csvRows.push(
            toCsvRow([
              po.poNumber, po.supplierName, po.supplierCode || "", po.supplierSource || "", po.status,
              item.productName, item.supplierSku || "", String(item.quantity), item.costPrice.toFixed(2), item.totalCost.toFixed(2),
              po.subtotal, po.shipping, po.tax, po.total,
              po.shipToName || "", po.shipToType || "", po.requestedShipDate ? formatDate(po.requestedShipDate) : "", formatDate(po.createdAt),
            ])
          );
        }
      }
    }

    const csv = [toCsvRow(headers), ...csvRows].join("\n");
    log.info(`PO CSV export: ${allPOs.length} purchase orders for user ${ctx.user.id}`);
    return { csv, filename: `purchase_orders_export_${formatDate(new Date())}.csv`, rowCount: allPOs.length };
  }),
});
