/**
 * copilotExecStores.ts — Store management executors for the AI copilot.
 *
 * Handles: updateStore, listStores, getStoreDetails, deleteStore
 */
import { getDb } from "../db";
import { clients, products, stores, storeProducts } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { buildToolScope } from "./copilotExecScope";

export async function executeUpdateStore(userId: number, organizationId: number | null, args: {
  storeId: number; name?: string; welcomeMessage?: string; primaryColor?: string; status?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const existing = await db.select().from(stores)
    .where(and(eq(stores.id, args.storeId), scope.stores)).limit(1);
  if (existing.length === 0) return { error: `Store ID ${args.storeId} not found` };

  const updates: Record<string, any> = {};
  if (args.name) updates.name = args.name;
  if (args.welcomeMessage !== undefined) updates.welcomeMessage = args.welcomeMessage;
  if (args.primaryColor) updates.primaryColor = args.primaryColor;
  if (args.status) updates.status = args.status;

  if (Object.keys(updates).length === 0) return { error: "No fields to update" };

  await db.update(stores).set(updates).where(and(eq(stores.id, args.storeId), scope.stores));
  return { success: true, storeId: args.storeId, updated: Object.keys(updates) };
}

export async function executeListStores(userId: number, organizationId: number | null, args: { status?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const conditions = [scope.stores];
  if (args.status) conditions.push(eq(stores.status, args.status as "active" | "inactive" | "setup" | "draft" | "pending_approval" | "revision_requested"));

  const rows = await db.select().from(stores)
    .where(and(...conditions))
    .orderBy(desc(stores.createdAt))
    .limit(args.limit || 20);

  const storeClientIds = Array.from(new Set(rows.map(r => r.clientId))) as number[];
  const clientMap = new Map<number, string>();
  if (storeClientIds.length > 0) {
    const clientRows = await db.select({ id: clients.id, companyName: clients.companyName }).from(clients)
      .where(scope.clients);
    clientRows.forEach(c => clientMap.set(c.id, c.companyName));
  }

  return {
    count: rows.length,
    stores: rows.map(r => ({
      id: r.id, name: r.name, slug: r.slug, status: r.status,
      storeType: r.storeType,
      clientName: clientMap.get(r.clientId) || "Unknown",
      createdAt: r.createdAt,
    })),
  };
}

export async function executeGetStoreDetails(userId: number, organizationId: number | null, args: { storeId: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const storeRows = await db.select().from(stores)
    .where(and(eq(stores.id, args.storeId), scope.stores)).limit(1);
  if (storeRows.length === 0) return { error: `Store ID ${args.storeId} not found` };

  const store = storeRows[0];
  const clientRows = await db.select().from(clients).where(eq(clients.id, store.clientId)).limit(1);
  const spRows = await db.select().from(storeProducts).where(eq(storeProducts.storeId, store.id));

  const productIds = spRows.map(sp => sp.productId);
  const productMap = new Map<number, any>();
  if (productIds.length > 0) {
    const productRows = await db.select().from(products).where(scope.products);
    productRows.forEach(p => productMap.set(p.id, p));
  }

  return {
    store: {
      id: store.id, name: store.name, slug: store.slug, status: store.status,
      storeType: store.storeType, welcomeMessage: store.welcomeMessage,
      primaryColor: store.primaryColor,
      aiDescription: store.aiDescription, aiTagline: store.aiTagline,
      createdAt: store.createdAt,
    },
    client: clientRows[0] ? {
      id: clientRows[0].id, companyName: clientRows[0].companyName,
      contactEmail: clientRows[0].contactEmail,
    } : null,
    products: spRows.map(sp => {
      const prod = productMap.get(sp.productId);
      return {
        id: sp.productId, name: prod?.name || "Unknown",
        customPrice: sp.customPrice, featured: sp.featured,
        category: prod?.category,
      };
    }),
    productCount: spRows.length,
  };
}

export async function executeDeleteStore(userId: number, organizationId: number | null, args: { storeId: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const existing = await db.select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(and(eq(stores.id, args.storeId), scope.stores))
    .limit(1);
  if (existing.length === 0) return { error: `Store ID ${args.storeId} not found` };

  const storeName = existing[0].name;
  await db.delete(storeProducts).where(eq(storeProducts.storeId, args.storeId));
  await db.delete(stores).where(and(eq(stores.id, args.storeId), scope.stores));

  return { success: true, deleted: storeName };
}
