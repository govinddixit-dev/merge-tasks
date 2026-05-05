/**
 * orgScope.ts — Multi-tenancy query scope helpers
 *
 * Every protected router procedure MUST use `getOrgScope()` to build its
 * WHERE clause instead of filtering by userId alone. This ensures that:
 *   1. Solo accounts (no team) continue to work via userId fallback.
 *   2. Team accounts filter by organizationId, giving all members access
 *      to shared data while preventing cross-org data leakage.
 *
 * Usage:
 *   const scope = getOrgScope(ctx);
 *   const rows = await db.select().from(clients).where(scope.clients);
 *
 *   // For writes (INSERT), stamp both userId and organizationId:
 *   await db.insert(clients).values({ ...input, ...scope.stamp });
 */

import { eq, SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "../_core/context";
import {
  clients,
  products,
  proposals,
  stores,
  orders,
  virtualProofs,
  clientLogos,
  emailConnections,
  distributorProfiles,
  clientAssets,
  aiEditFeedback,
  copilotConversations,
  copilotMemory,
  copilotTaskLog,
  printRequests,
  estimates,
  invoices,
  apiConnections,
  // Audit fix #12: add refund tables to prevent cross-tenant access
  refundRequests,
  refundHistory,
  purchaseOrders,
  suppliers,
  notifications,
  productCollections,
} from "../../drizzle/schema";

export type OrgScope = {
  /** WHERE clause for clients table */
  clients: SQL;
  /** WHERE clause for products table */
  products: SQL;
  /** WHERE clause for proposals table */
  proposals: SQL;
  /** WHERE clause for stores table */
  stores: SQL;
  /** WHERE clause for orders table */
  orders: SQL;
  /** WHERE clause for virtualProofs table */
  virtualProofs: SQL;
  /** WHERE clause for clientLogos table */
  clientLogos: SQL;
  /** WHERE clause for emailConnections table */
  emailConnections: SQL;
  /** WHERE clause for distributorProfiles table */
  distributorProfiles: SQL;
  /** WHERE clause for clientAssets table */
  clientAssets: SQL;
  /** WHERE clause for aiEditFeedback table */
  aiEditFeedback: SQL;
  /** WHERE clause for copilotConversations table */
  copilotConversations: SQL;
  /** WHERE clause for copilotMemory table */
  copilotMemory: SQL;
  /** WHERE clause for copilotTaskLog table */
  copilotTaskLog: SQL;
  /** WHERE clause for printRequests table */
  printRequests: SQL;
  /** WHERE clause for estimates table */
  estimates: SQL;
  /** WHERE clause for invoices table */
  invoices: SQL;
  /** WHERE clause for apiConnections table */
  apiConnections: SQL;
  /**
   * Audit fix #12: WHERE clauses for refund tables.
   * Without these, a solo user (orgId=null) could read/deny ANY refund request
   * across the entire system because no org filter was applied.
   */
  refundRequests: SQL;
  refundHistory: SQL;
  /** WHERE clause for purchaseOrders table */
  purchaseOrders: SQL;
  /** WHERE clause for suppliers table */
  suppliers: SQL;
  /** WHERE clause for notifications table */
  notifications: SQL;
  /** WHERE clause for productCollections table */
  productCollections: SQL;
  /**
   * Values to stamp on INSERT — always include both userId and organizationId
   * so backfill and solo-account fallback keep working.
   */
  stamp: { userId: number; organizationId: number | null };
  /** The resolved organizationId (may be null for unauthenticated or unresolved) */
  organizationId: number | null;
  /** The authenticated user id */
  userId: number;
};

/**
 * Build the correct WHERE scope for the authenticated user.
 * Throws if the context has no authenticated user.
 */
export function getOrgScope(ctx: { user: NonNullable<TrpcContext["user"]>; organizationId: TrpcContext["organizationId"] }): OrgScope {
  const userId = ctx.user.id;
  const organizationId = ctx.organizationId;

  /**
   * Build the best available filter for a table that has both
   * userId and organizationId columns — fully typed, no `as any`.
   */
  function scopeFor(table: { userId: MySqlColumn; organizationId: MySqlColumn }): SQL {
    if (organizationId !== null) {
      return eq(table.organizationId, organizationId);
    }
    return eq(table.userId, userId);
  }

  return {
    clients:              scopeFor(clients),
    products:             scopeFor(products),
    proposals:            scopeFor(proposals),
    stores:               scopeFor(stores),
    orders:               scopeFor(orders),
    virtualProofs:        scopeFor(virtualProofs),
    clientLogos:          scopeFor(clientLogos),
    emailConnections:     scopeFor(emailConnections),
    distributorProfiles:  scopeFor(distributorProfiles),
    clientAssets:         scopeFor(clientAssets),
    aiEditFeedback:       scopeFor(aiEditFeedback),
    copilotConversations: scopeFor(copilotConversations),
    copilotMemory:        scopeFor(copilotMemory),
    copilotTaskLog:       scopeFor(copilotTaskLog),
    printRequests:        scopeFor(printRequests),
    estimates:            scopeFor(estimates),
    invoices:             scopeFor(invoices),
    apiConnections:       scopeFor(apiConnections),
    // Audit fix #12: refund tables use distributorUserId as solo-user fallback
    // because they don't have a userId column (only distributorUserId + organizationId)
    refundRequests:       organizationId !== null
                            ? eq(refundRequests.organizationId, organizationId)
                            : eq(refundRequests.distributorUserId, userId),
    refundHistory:        organizationId !== null
                            ? eq(refundHistory.organizationId, organizationId)
                            : eq(refundHistory.processedBy, userId),
    purchaseOrders:       scopeFor(purchaseOrders),
    suppliers:             scopeFor(suppliers),
    notifications:         scopeFor(notifications),
    productCollections:    scopeFor(productCollections),
    stamp: { userId, organizationId },
    organizationId,
    userId,
  };
}
