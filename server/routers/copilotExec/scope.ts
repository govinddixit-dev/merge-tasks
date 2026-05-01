/**
 * copilotExec/scope.ts
 * Org-aware WHERE clause helper used by every copilot executor.
 * Ensures strict data isolation between users and organisations.
 */

import { eq } from "drizzle-orm";
import {
  clients,
  products,
  proposals,
  stores,
  distributorProfiles,
  orders,
  estimates,
  invoices,
  virtualProofs,
  clientLogos,
  clientAssets,
  copilotConversations,
  copilotTaskLog,
  copilotMemory,
  purchaseOrders,
  suppliers,
} from "../../../drizzle/schema";

/**
 * Returns Drizzle WHERE expressions scoped to the user's organisation (or
 * personal account when organizationId is null).
 */
export function buildToolScope(userId: number, organizationId: number | null) {
  // Drizzle column types vary per table; generic column typing not worth the complexity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (table: { organizationId: any; userId: any }) =>
    organizationId !== null ? eq(table.organizationId, organizationId) : eq(table.userId, userId);
  return {
    clients:              s(clients),
    products:             s(products),
    proposals:            s(proposals),
    stores:               s(stores),
    distributorProfiles:  s(distributorProfiles),
    orders:               s(orders),
    estimates:            s(estimates),
    invoices:             s(invoices),
    virtualProofs:        s(virtualProofs),
    clientLogos:          s(clientLogos),
    clientAssets:         s(clientAssets),
    copilotConversations: s(copilotConversations),
    copilotTaskLog:       s(copilotTaskLog),
    copilotMemory:        s(copilotMemory),
    purchaseOrders:       s(purchaseOrders),
    suppliers:            s(suppliers),
    stamp: { userId, organizationId },
  };
}
