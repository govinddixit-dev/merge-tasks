/**
 * copilotExecAnalytics.ts — Reports & analytics executors for the AI copilot.
 *
 * Handles: getDashboardStats, getReorderAlerts, getChurnSignals, getRefundReport
 *
 * SECURITY: Every query MUST be scoped via buildToolScope() to prevent
 * cross-tenant data leakage. When organizationId is null, scope falls
 * back to userId — never to an unscoped full-table scan.
 *
 * Gap Report fix PO-4: getRefundReport previously returned ALL tenants'
 * data when organizationId was null. Now uses buildToolScope() consistently.
 */
import { getDb } from "../db";
import {
  clients, products, proposals, orders, stores,
  refundRequests, refundHistory, storeUsers,
} from "../../drizzle/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { buildToolScope } from "./copilotExecScope";

// ── Helpers ──────────────────────────────────────────────

/** Safely parse a numeric DB value to a float, defaulting to 0. */
function toFloat(value: unknown): number {
  return parseFloat(String(value ?? "0")) || 0;
}

/** Days elapsed since a given date. */
function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

// ── Dashboard Stats ──────────────────────────────────────

export async function executeGetDashboardStats(
  userId: number,
  organizationId: number | null,
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const scope = buildToolScope(userId, organizationId);

  const [storeCount] = await db
    .select({ cnt: count() })
    .from(stores)
    .where(and(scope.stores, eq(stores.status, "active")));

  const [pendingOrderCount] = await db
    .select({ cnt: count() })
    .from(orders)
    .where(and(scope.orders, eq(orders.status, "pending")));

  const [totalOrderCount] = await db
    .select({ cnt: count() })
    .from(orders)
    .where(scope.orders);

  const [clientCount] = await db
    .select({ cnt: count() })
    .from(clients)
    .where(scope.clients);

  const [productCount] = await db
    .select({ cnt: count() })
    .from(products)
    .where(scope.products);

  const [proposalCount] = await db
    .select({ cnt: count() })
    .from(proposals)
    .where(scope.proposals);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentOrders = await db
    .select({ total: orders.total })
    .from(orders)
    .where(and(scope.orders, sql`${orders.createdAt} >= ${thirtyDaysAgo}`));

  const monthlyGMV = recentOrders.reduce(
    (sum, o) => sum + toFloat(o.total),
    0,
  );

  return {
    activeStores: storeCount?.cnt ?? 0,
    pendingOrders: pendingOrderCount?.cnt ?? 0,
    totalOrders: totalOrderCount?.cnt ?? 0,
    totalClients: clientCount?.cnt ?? 0,
    totalProducts: productCount?.cnt ?? 0,
    totalProposals: proposalCount?.cnt ?? 0,
    monthlyGMV: monthlyGMV.toFixed(2),
  };
}

// ── Reorder Alerts ───────────────────────────────────────

export async function executeGetReorderAlerts(
  userId: number,
  organizationId: number | null,
  args: { limit?: number },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const scope = buildToolScope(userId, organizationId);

  const allOrders = await db
    .select({
      clientId: orders.clientId,
      createdAt: orders.createdAt,
      total: orders.total,
    })
    .from(orders)
    .where(scope.orders);

  // Aggregate per-client order stats in a single pass
  const clientOrders = new Map<
    number,
    { lastOrder: Date; totalSpent: number; orderCount: number }
  >();

  for (const o of allOrders) {
    const orderDate = new Date(o.createdAt);
    const total = toFloat(o.total);
    const existing = clientOrders.get(o.clientId);

    if (!existing) {
      clientOrders.set(o.clientId, {
        lastOrder: orderDate,
        totalSpent: total,
        orderCount: 1,
      });
    } else {
      if (orderDate > existing.lastOrder) existing.lastOrder = orderDate;
      existing.totalSpent += total;
      existing.orderCount++;
    }
  }

  // Flag clients with no orders in 60+ days, sorted by spend
  const alerts = Array.from(clientOrders.entries())
    .map(([clientId, data]) => ({
      clientId,
      daysSinceLastOrder: daysSince(data.lastOrder),
      totalSpent: data.totalSpent,
      orderCount: data.orderCount,
    }))
    .filter((a) => a.daysSinceLastOrder > 60)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, args.limit ?? 10);

  // Resolve client names (scoped)
  const clientMap = new Map<number, string>();
  if (alerts.length > 0) {
    const clientRows = await db
      .select({ id: clients.id, companyName: clients.companyName })
      .from(clients)
      .where(scope.clients);
    for (const c of clientRows) clientMap.set(c.id, c.companyName);
  }

  return {
    count: alerts.length,
    alerts: alerts.map((a) => ({
      clientName: clientMap.get(a.clientId) ?? "Unknown",
      clientId: a.clientId,
      daysSinceLastOrder: a.daysSinceLastOrder,
      totalSpent: a.totalSpent.toFixed(2),
      orderCount: a.orderCount,
    })),
  };
}

// ── Churn Signals ────────────────────────────────────────

const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export async function executeGetChurnSignals(
  userId: number,
  organizationId: number | null,
  args: { limit?: number },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const scope = buildToolScope(userId, organizationId);

  const allClients = await db.select().from(clients).where(scope.clients);
  const allOrders = await db
    .select({
      clientId: orders.clientId,
      createdAt: orders.createdAt,
      total: orders.total,
    })
    .from(orders)
    .where(scope.orders);

  // Index orders by clientId for O(1) lookup
  const ordersByClient = new Map<number, typeof allOrders>();
  for (const o of allOrders) {
    const list = ordersByClient.get(o.clientId) ?? [];
    list.push(o);
    ordersByClient.set(o.clientId, list);
  }

  const signals: Array<{
    clientId: number;
    companyName: string;
    riskLevel: string;
    reason: string;
    daysSinceActivity: number;
  }> = [];

  for (const client of allClients) {
    const clientOrderList = ordersByClient.get(client.id);

    if (!clientOrderList || clientOrderList.length === 0) {
      const days = daysSince(new Date(client.createdAt!));
      if (days > 30) {
        signals.push({
          clientId: client.id,
          companyName: client.companyName,
          riskLevel: "medium",
          reason: "No orders placed since onboarding",
          daysSinceActivity: days,
        });
      }
      continue;
    }

    const lastOrder = clientOrderList.reduce((latest, o) =>
      new Date(o.createdAt) > new Date(latest.createdAt) ? o : latest,
    );
    const days = daysSince(new Date(lastOrder.createdAt));

    if (days > 90) {
      signals.push({
        clientId: client.id,
        companyName: client.companyName,
        riskLevel: "high",
        reason: `No orders in ${days} days`,
        daysSinceActivity: days,
      });
    } else if (days > 60) {
      signals.push({
        clientId: client.id,
        companyName: client.companyName,
        riskLevel: "medium",
        reason: `Last order was ${days} days ago`,
        daysSinceActivity: days,
      });
    }
  }

  signals.sort(
    (a, b) => (RISK_ORDER[a.riskLevel] ?? 2) - (RISK_ORDER[b.riskLevel] ?? 2),
  );

  return {
    count: signals.length,
    signals: signals.slice(0, args.limit ?? 10),
  };
}

// ── Refund Report ────────────────────────────────────────
// Gap Report PO-4 FIX: Previously, when organizationId was null this
// function had NO scope filter, returning every tenant's refund data.
// Now uses buildToolScope() for refundRequests and falls back to
// userId-based scoping for refundHistory (via distributorUserId).

export async function executeGetRefundReport(
  userId: number,
  organizationId: number | null,
  args: { status?: string; limit?: number },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  // Build scoped conditions — NEVER allow an unscoped query
  const requestConditions = [
    organizationId != null
      ? eq(refundRequests.organizationId, organizationId)
      : eq(refundRequests.distributorUserId, userId),
  ];
  if (args.status) {
    requestConditions.push(
      eq(refundRequests.status, args.status as "pending" | "approved" | "denied"),
    );
  }

  const requests = await db
    .select({
      id: refundRequests.id,
      proposalId: refundRequests.proposalId,
      storeId: refundRequests.storeId,
      reason: refundRequests.reason,
      status: refundRequests.status,
      responseNote: refundRequests.responseNote,
      respondedAt: refundRequests.respondedAt,
      createdAt: refundRequests.createdAt,
      pocName: storeUsers.name,
      pocEmail: storeUsers.email,
      proposalTitle: proposals.title,
      proposalValue: proposals.estimatedValue,
      storeName: stores.name,
    })
    .from(refundRequests)
    .leftJoin(storeUsers, eq(storeUsers.id, refundRequests.storeUserId))
    .leftJoin(proposals, eq(proposals.id, refundRequests.proposalId))
    .leftJoin(stores, eq(stores.id, refundRequests.storeId))
    .where(and(...requestConditions))
    .orderBy(desc(refundRequests.createdAt))
    .limit(args.limit ?? 20);

  // Scoped refund history totals
  const historyScope = organizationId != null
    ? eq(refundHistory.organizationId, organizationId)
    : eq(refundHistory.processedBy, userId);

  const historyRows = await db
    .select({
      totalRefunds: count(),
      totalAmount: sql<number>`COALESCE(SUM(${refundHistory.amount}), 0)`,
    })
    .from(refundHistory)
    .where(historyScope);

  const summary = {
    totalRequests: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    denied: requests.filter((r) => r.status === "denied").length,
    totalRefundsProcessed: historyRows[0]?.totalRefunds ?? 0,
    totalAmountRefunded: (toFloat(historyRows[0]?.totalAmount) / 100).toFixed(2),
  };

  return {
    summary,
    requests: requests.map((r) => ({
      id: r.id,
      proposal: r.proposalTitle || `Proposal #${r.proposalId}`,
      proposalValue: r.proposalValue
        ? `$${parseFloat(r.proposalValue).toLocaleString()}`
        : "—",
      store: r.storeName || "—",
      requester: r.pocName || r.pocEmail || "Unknown",
      reason: r.reason,
      status: r.status,
      responseNote: r.responseNote ?? null,
      date: r.createdAt
        ? new Date(r.createdAt).toLocaleDateString()
        : "—",
      respondedAt: r.respondedAt
        ? new Date(r.respondedAt).toLocaleDateString()
        : null,
    })),
  };
}
