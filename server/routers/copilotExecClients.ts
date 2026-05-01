/**
 * copilotExecClients.ts — Client management executors for the AI copilot.
 *
 * Handles: create, update, delete, getDetails, list
 */
import { getDb } from "../db";
import {
  clients, proposals, proposalProducts, orders, orderItems,
  stores, virtualProofs, clientLogos,
  type InsertClient,
} from "../../drizzle/schema";
import { eq, and, desc, like, count, sql } from "drizzle-orm";
import { buildToolScope } from "./copilotExecScope";

export async function executeCreateClient(userId: number, organizationId: number | null, args: {
  companyName: string; contactName?: string; contactEmail?: string;
  contactPhone?: string; industry?: string; address?: string;
  city?: string; state?: string; zip?: string; notes?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const values: InsertClient = {
    userId,
    // Audit fix #17: stamp organizationId so team members share clients and
    // other tenants cannot access them via organization-scoped queries.
    organizationId: organizationId ?? null,
    companyName: args.companyName,
    contactName: args.contactName || "Unknown",
    contactEmail: args.contactEmail || "unknown@example.com",
    contactPhone: args.contactPhone || null,
    industry: args.industry || null,
    address: [args.address, args.city, args.state, args.zip].filter(Boolean).join(", ") || null,
    notes: args.notes || null,
    status: "active",
  };

  const result = await db.insert(clients).values(values);
  const clientId = Number(result[0].insertId);

  return {
    success: true,
    clientId,
    companyName: args.companyName,
    contactName: args.contactName || "Unknown",
    contactEmail: args.contactEmail || "unknown@example.com",
  };
}

export async function executeUpdateClient(userId: number, organizationId: number | null, args: {
  clientId: number; companyName?: string; contactName?: string;
  contactEmail?: string; contactPhone?: string; industry?: string;
  address?: string; city?: string; state?: string; zip?: string;
  notes?: string; status?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const existing = await db.select().from(clients)
    .where(and(eq(clients.id, args.clientId), scope.clients)).limit(1);
  if (existing.length === 0) return { error: `Client ID ${args.clientId} not found` };

  const updates: Record<string, any> = {};
  if (args.companyName) updates.companyName = args.companyName;
  if (args.contactName !== undefined) updates.contactName = args.contactName;
  if (args.contactEmail !== undefined) updates.contactEmail = args.contactEmail;
  if (args.contactPhone !== undefined) updates.contactPhone = args.contactPhone;
  if (args.industry !== undefined) updates.industry = args.industry;
  if (args.address !== undefined || args.city !== undefined || args.state !== undefined || args.zip !== undefined) {
    const currentAddr = existing[0].address || "";
    const parts = [args.address || currentAddr, args.city, args.state, args.zip].filter(Boolean);
    updates.address = parts.join(", ") || null;
  }
  if (args.notes !== undefined) updates.notes = args.notes;
  if (args.status) updates.status = args.status;

  if (Object.keys(updates).length === 0) return { error: "No fields to update" };

  await db.update(clients).set(updates).where(and(eq(clients.id, args.clientId), scope.clients));
  return { success: true, clientId: args.clientId, updated: Object.keys(updates) };
}

export async function executeDeleteClient(userId: number, organizationId: number | null, args: { clientId: number; confirm: boolean }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);
  if (!args.confirm) return { error: "Deletion not confirmed. Set confirm: true to proceed." };

  const existing = await db.select().from(clients)
    .where(and(eq(clients.id, args.clientId), scope.clients)).limit(1);
  if (existing.length === 0) return { error: `Client ID ${args.clientId} not found` };

  const clientName = existing[0].companyName;

  // Cascade delete related records
  const proposalRows = await db.select({ id: proposals.id }).from(proposals)
    .where(and(eq(proposals.clientId, args.clientId), scope.proposals));
  const proposalIds = proposalRows.map(p => p.id);
  if (proposalIds.length > 0) {
    await db.delete(proposalProducts).where(sql`${proposalProducts.proposalId} IN (${sql.join(proposalIds.map(id => sql`${id}`), sql`, `)})`);
  }
  await db.delete(proposals).where(and(eq(proposals.clientId, args.clientId), scope.proposals));

  const orderRows = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.clientId, args.clientId), scope.orders));
  const orderIds = orderRows.map(o => o.id);
  if (orderIds.length > 0) {
    await db.delete(orderItems).where(sql`${orderItems.orderId} IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})`);
  }
  await db.delete(orders).where(and(eq(orders.clientId, args.clientId), scope.orders));

  await db.delete(stores).where(and(eq(stores.clientId, args.clientId), scope.stores));
  await db.delete(virtualProofs).where(and(eq(virtualProofs.clientId, args.clientId), scope.virtualProofs));
  await db.delete(clientLogos).where(and(eq(clientLogos.clientId, args.clientId), eq(clientLogos.userId, userId)));
  await db.delete(clients).where(and(eq(clients.id, args.clientId), scope.clients));

  return { success: true, deleted: clientName, cascadeDeleted: { proposals: proposalRows.length, orders: orderRows.length } };
}

export async function executeGetClientDetails(userId: number, organizationId: number | null, args: { clientId: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const clientRows = await db.select().from(clients)
    .where(and(eq(clients.id, args.clientId), scope.clients)).limit(1);
  if (clientRows.length === 0) return { error: `Client ID ${args.clientId} not found` };

  const client = clientRows[0];

  const proposalCount = await db.select({ cnt: count() }).from(proposals)
    .where(and(eq(proposals.clientId, args.clientId), scope.proposals));
  const orderRows = await db.select().from(orders)
    .where(and(eq(orders.clientId, args.clientId), scope.orders))
    .orderBy(desc(orders.createdAt)).limit(5);
  const storeRows = await db.select({ id: stores.id, name: stores.name, status: stores.status }).from(stores)
    .where(and(eq(stores.clientId, args.clientId), scope.stores));

  const totalRevenue = orderRows.reduce((sum, o) => sum + parseFloat(o.total?.toString() || "0"), 0);

  return {
    client: {
      id: client.id,
      companyName: client.companyName,
      contactName: client.contactName,
      contactEmail: client.contactEmail,
      contactPhone: client.contactPhone,
      industry: client.industry,
      address: client.address,
      status: client.status,
      notes: client.notes,
    },
    proposalCount: proposalCount[0]?.cnt || 0,
    recentOrders: orderRows.map(o => ({
      id: o.id, orderNumber: o.orderNumber, status: o.status,
      total: o.total, createdAt: o.createdAt,
    })),
    stores: storeRows,
    totalRevenue: totalRevenue.toFixed(2),
  };
}

export async function executeListClients(userId: number, organizationId: number | null, args: { status?: string; industry?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const conditions = [scope.clients];
  if (args.status) conditions.push(eq(clients.status, args.status as "active" | "inactive" | "prospect"));
  if (args.industry) conditions.push(like(clients.industry, `%${args.industry}%`));

  const rows = await db.select({
    id: clients.id,
    companyName: clients.companyName,
    contactName: clients.contactName,
    contactEmail: clients.contactEmail,
    industry: clients.industry,
    status: clients.status,
  }).from(clients)
    .where(and(...conditions))
    .orderBy(clients.companyName)
    .limit(args.limit || 20);

  return { clients: rows, total: rows.length };
}
