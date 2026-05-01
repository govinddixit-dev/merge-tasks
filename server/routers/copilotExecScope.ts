/**
 * copilotExecScope.ts — Shared scope helper for copilot executor modules.
 *
 * Every executor needs to restrict queries to the current user/org.
 * This module exports the `buildToolScope` helper so each domain module
 * can import it without duplicating the logic.
 */
import {
  clients, products, proposals, orders, stores,
  virtualProofs, clientAssets, copilotConversations,
  copilotTaskLog, copilotMemory,
  // Audit fix #17: add missing tables to scope
  estimates, invoices, clientLogos,
  // PO system tables
  purchaseOrders, suppliers,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export function buildToolScope(userId: number, organizationId: number | null) {
  // Drizzle column types vary per table; generic column typing not worth the complexity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = <T extends { organizationId: ReturnType<typeof eq>; userId: ReturnType<typeof eq> }>(table: { organizationId: any; userId: any }) =>
    organizationId !== null ? eq(table.organizationId, organizationId) : eq(table.userId, userId);
  return {
    clients:              s(clients),
    products:             s(products),
    proposals:            s(proposals),
    stores:               s(stores),
    orders:               s(orders),
    virtualProofs:        s(virtualProofs),
    clientAssets:         s(clientAssets),
    copilotConversations: s(copilotConversations),
    copilotTaskLog:       s(copilotTaskLog),
    copilotMemory:        s(copilotMemory),
    // Audit fix #17: add estimates, invoices, clientLogos to scope
    estimates:            s(estimates),
    invoices:             s(invoices),
    clientLogos:          s(clientLogos),
    // PO system
    purchaseOrders:       s(purchaseOrders),
    suppliers:            s(suppliers),
    stamp: { userId, organizationId },
  };
}
