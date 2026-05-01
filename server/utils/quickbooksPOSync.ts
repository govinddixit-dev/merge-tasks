/**
 * quickbooksPOSync.ts — QuickBooks Online PO/Bill synchronization.
 *
 * When QuickBooks is connected, purchase orders are synced as "Purchase Orders"
 * or "Bills" in QBO. This module provides the sync interface that integrates
 * with the PO lifecycle.
 *
 * ARCHITECTURE:
 * - syncPOToQuickBooks() is called after PO creation and status changes
 * - If QuickBooks is not connected, it returns gracefully (no-op)
 * - If connected, it creates/updates the corresponding QBO entity
 * - The QuickBooks OAuth tokens are stored in apiConnections table
 *
 * The actual QuickBooks API calls require the node-quickbooks or
 * intuit-oauth package and valid OAuth2 credentials. This module provides
 * the integration hooks — the QuickBooks router (when built) handles auth.
 *
 * When the QuickBooks integration is fully wired:
 * 1. Check apiConnections for an active QBO connection
 * 2. Use the stored access token to call QBO API
 * 3. Create a Purchase Order or Bill in QBO
 * 4. Store the QBO entity ID on the PO record for future updates
 */

import { getDb } from "../db";
import { apiConnections, purchaseOrders } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getLogger } from "./logger";
import type { PurchaseOrder, POLineItem } from "../../drizzle/schema";

const log = getLogger("quickbooks-po-sync");

// ── Types ───────────────────────────────────────────────────────────────────

export interface QBOSyncResult {
  synced: boolean;
  /** "connected" + not yet implemented, "not_connected", or "error". */
  status: "synced" | "pending" | "not_connected" | "error";
  qboEntityId?: string;
  qboEntityType?: "PurchaseOrder" | "Bill";
  error?: string;
}

// ── Check if QuickBooks is connected ────────────────────────────────────────

async function getQBOConnection(userId: number, organizationId: number | null): Promise<{
  accessToken: string;
  realmId: string;
  refreshToken: string;
} | null> {
  try {
    const db = await getDb();
    if (!db) return null;

    const conditions = organizationId != null
      ? and(eq(apiConnections.organizationId, organizationId), eq(apiConnections.name, "quickbooks"))
      : and(eq(apiConnections.userId, userId), eq(apiConnections.name, "quickbooks"));

    const [connection] = await db.select().from(apiConnections)
      .where(conditions!)
      .limit(1);

    const creds = connection?.credentials as Record<string, string> | null | undefined;
    if (!connection || !creds?.accessToken || connection.status !== "active") {
      return null;
    }

    return {
      accessToken: creds.accessToken,
      realmId: creds.realmId || "",
      refreshToken: creds.refreshToken || "",
    };
  } catch {
    return null;
  }
}

// ── Map PO to QBO Purchase Order format ─────────────────────────────────────

function mapPOToQBOPurchaseOrder(po: PurchaseOrder) {
  const items = (po.lineItems || []) as POLineItem[];

  return {
    // QBO Purchase Order structure
    APAccountRef: { value: "1" }, // Accounts Payable — distributor configures in QBO
    VendorRef: {
      name: po.supplierName,
      // value: would be the QBO Vendor ID — requires vendor lookup/creation
    },
    Line: items.map((item, i) => ({
      Id: String(i + 1),
      DetailType: "ItemBasedExpenseLineDetail",
      Amount: item.totalCost,
      Description: `${item.productName}${item.supplierSku ? ` (SKU: ${item.supplierSku})` : ""}${item.decorationType ? ` — ${item.decorationType}` : ""}`,
      ItemBasedExpenseLineDetail: {
        Qty: item.quantity,
        UnitPrice: item.costPrice,
        // ItemRef would map to QBO Item — requires item lookup/creation
      },
    })),
    TotalAmt: parseFloat(po.total || "0"),
    DocNumber: po.poNumber,
    TxnDate: po.createdAt ? new Date(po.createdAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
    PrivateNote: po.internalNotes || undefined,
    Memo: po.supplierNotes || undefined,
    ShipAddr: po.shipToAddress ? {
      Line1: po.shipToName || "",
      Line2: po.shipToAddress,
    } : undefined,
  };
}

// ── Sync PO to QuickBooks ───────────────────────────────────────────────────

/**
 * Sync a purchase order to QuickBooks Online.
 *
 * Called automatically from the PO router on create and status changes.
 * If QuickBooks is not connected, this is a graceful no-op.
 *
 * TODO(qbo-integration): implement the full QuickBooks router. When built:
 * - Replace the stub section below with actual QBO API calls
 * - Use the node-quickbooks or intuit-oauth package
 * - Handle token refresh if expired
 */
export async function syncPOToQuickBooks(
  po: PurchaseOrder,
  userId: number,
  organizationId: number | null,
  action: "create" | "update" | "void",
): Promise<QBOSyncResult> {
  // Check if QuickBooks is connected
  const connection = await getQBOConnection(userId, organizationId);

  if (!connection) {
    return { synced: false, status: "not_connected" };
  }

  log.info(`Syncing PO ${po.poNumber} to QuickBooks (${action})`);

  try {
    // Mapped payload is prepared even though submission is pending,
    // so callers can surface a clear "sync pending" status to the UI.
    mapPOToQBOPurchaseOrder(po);
    return {
      synced: false,
      status: "pending",
      error: "QuickBooks sync pending — API integration not yet implemented",
    };
  } catch (err: unknown) {
    log.warn(`QuickBooks sync failed for PO ${po.poNumber}:`, err);
    return { synced: false, status: "error", error: String(err) };
  }
}
