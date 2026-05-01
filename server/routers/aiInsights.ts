/**
 * aiInsights.ts — AI-Powered Business Intelligence Router
 * ───────────────────────────────────────────────────────────────────────────
 * Procedures:
 *   predictiveReorders    — Analyzes order history to predict reorder dates per client+product
 *   churnSignals          — Identifies clients at risk of churn based on order recency
 *   storeRecommendations  — Suggests products to add to a webstore based on order patterns
 *   dashboardSummary      — Aggregated KPIs for the distributor dashboard
 *
 * All queries are org-scoped via getOrgScope(ctx).
 * Heavy computation (predictiveReorders, churnSignals) uses in-memory aggregation
 * over the order history rather than raw SQL to keep the logic readable.
 * TODO(redis-cache): cache dashboardSummary in Redis with 5min TTL keyed by organizationId ?? userId
 * Implement when Redis client utility is extracted from rateLimiter.ts
 * ───────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { AI_INSIGHTS_LIMIT } from "../utils/rateLimiter";
import {
  orders,
  orderItems,
  clients,
  products,
  stores,
  storeProducts,
  storeUsers,
} from "../../drizzle/schema";
import { eq, and, desc, sql, count, gte, lte } from "drizzle-orm";
import { getOrgScope } from "../utils/orgScope";

//  Types 

interface ReorderPrediction {
  clientId: number;
  clientName: string;
  storeId: number | null;
  storeName: string | null;
  productId: number;
  productName: string;
  category: string;
  lastOrderDate: string;
  avgIntervalDays: number;
  predictedReorderDate: string;
  daysUntilReorder: number;
  urgency: "overdue" | "urgent" | "upcoming" | "normal";
  totalQuantityOrdered: number;
  avgQuantityPerOrder: number;
  orderCount: number;
}

interface ChurnSignal {
  clientId: number;
  clientName: string;
  contactName: string;
  contactEmail: string;
  riskLevel: "high" | "medium" | "low";
  riskScore: number; // 0-100
  signals: string[];
  lastOrderDate: string | null;
  daysSinceLastOrder: number;
  totalOrders: number;
  totalRevenue: number;
  orderTrend: "declining" | "stable" | "growing";
  avgOrderValue: number;
}

interface DeptRecommendation {
  department: string;
  recommendations: Array<{
    productId: number;
    productName: string;
    category: string;
    basePrice: string;
    reason: string;
    relevanceScore: number;
    popularInDept: boolean;
  }>;
}

//  Helper Functions 

function getDaysBetween(date1: Date, date2: Date): number {
  return Math.abs(Math.floor((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24)));
}

function getUrgency(daysUntil: number): "overdue" | "urgent" | "upcoming" | "normal" {
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 7) return "urgent";
  if (daysUntil <= 30) return "upcoming";
  return "normal";
}

// Department-to-category mapping for role-aware recommendations
const DEPT_CATEGORY_AFFINITY: Record<string, string[]> = {
  marketing: ["apparel", "drinkware", "bags", "tech"],
  hr: ["apparel", "office", "bags"],
  operations: ["office", "tech", "bags"],
  sales: ["drinkware", "apparel", "tech"],
  engineering: ["tech", "drinkware", "office"],
  finance: ["office", "drinkware"],
  executive: ["apparel", "drinkware", "tech"],
  it: ["tech", "office"],
  facilities: ["office", "bags"],
  events: ["apparel", "drinkware", "bags", "tech"],
};

//  Router 

export const aiInsightsRouter = router({
  /**
   * Predictive Reordering — Analyzes order history to predict when clients
   * will need to reorder products. Calculates average order intervals and
   * predicts the next reorder date.
   */
  predictiveReorders: protectedProcedure
    .use(rateLimited("aiInsights.predictiveReorders", AI_INSIGHTS_LIMIT))
    .query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { predictions: [], summary: { overdue: 0, urgent: 0, upcoming: 0, total: 0 } };
    const scope = getOrgScope(ctx);

    // Get all orders with items for this distributor, grouped by client + product
    const orderData = await db
      .select({
        clientId: orders.clientId,
        clientName: clients.companyName,
        storeId: orders.storeId,
        productId: orderItems.productId,
        productName: products.name,
        category: products.category,
        quantity: orderItems.quantity,
        orderDate: orders.createdAt,
        orderId: orders.id,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orders.id, orderItems.orderId))
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(scope.orders)
      .orderBy(orders.createdAt);

    // Group by client + product to find patterns
    const groupKey = (clientId: number, productId: number) => `${clientId}-${productId}`;
    const groups: Record<string, typeof orderData> = {};

    for (const row of orderData) {
      const key = groupKey(row.clientId, row.productId);
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }

    const predictions: ReorderPrediction[] = [];
    const now = new Date();

    for (const [, entries] of Object.entries(groups)) {
      if (entries.length < 1) continue; // Need at least 1 order

      // Sort by date
      entries.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());

      const first = entries[0];
      const lastOrder = entries[entries.length - 1];
      const lastOrderDate = new Date(lastOrder.orderDate);

      // Calculate average interval between orders
      let avgIntervalDays: number;
      if (entries.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < entries.length; i++) {
          intervals.push(getDaysBetween(new Date(entries[i - 1].orderDate), new Date(entries[i].orderDate)));
        }
        avgIntervalDays = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
      } else {
        // Single order — assume 90-day reorder cycle (quarterly)
        avgIntervalDays = 90;
      }

      // Predict next reorder date
      const predictedDate = new Date(lastOrderDate.getTime() + avgIntervalDays * 24 * 60 * 60 * 1000);
      const daysUntilReorder = Math.floor((predictedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Calculate totals
      const totalQuantity = entries.reduce((sum, e) => sum + e.quantity, 0);
      const avgQuantity = Math.round(totalQuantity / entries.length);

      // Get store name if available
      let storeName: string | null = null;
      if (first.storeId) {
        const storeRows = await db
          .select({ name: stores.name })
          .from(stores)
          .where(eq(stores.id, first.storeId))
          .limit(1);
        storeName = storeRows[0]?.name || null;
      }

      predictions.push({
        clientId: first.clientId,
        clientName: first.clientName || "Unknown",
        storeId: first.storeId,
        storeName,
        productId: first.productId,
        productName: first.productName,
        category: first.category,
        lastOrderDate: lastOrderDate.toISOString(),
        avgIntervalDays,
        predictedReorderDate: predictedDate.toISOString(),
        daysUntilReorder,
        urgency: getUrgency(daysUntilReorder),
        totalQuantityOrdered: totalQuantity,
        avgQuantityPerOrder: avgQuantity,
        orderCount: entries.length,
      });
    }

    // Sort by urgency (overdue first, then urgent, then upcoming)
    const urgencyOrder = { overdue: 0, urgent: 1, upcoming: 2, normal: 3 };
    predictions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || a.daysUntilReorder - b.daysUntilReorder);

    const summary = {
      overdue: predictions.filter(p => p.urgency === "overdue").length,
      urgent: predictions.filter(p => p.urgency === "urgent").length,
      upcoming: predictions.filter(p => p.urgency === "upcoming").length,
      total: predictions.length,
    };

    return { predictions, summary };
  }),

  /**
   * Churn & Engagement Signals — Flags clients with declining engagement,
   * dropping order volume, and missed reorder patterns.
   */
  churnSignals: protectedProcedure
    .use(rateLimited("aiInsights.churnSignals", AI_INSIGHTS_LIMIT))
    .query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { signals: [], summary: { high: 0, medium: 0, low: 0, total: 0 } };
    const scope = getOrgScope(ctx);

    // Get all clients with their order history
    const allClients = await db
      .select({
        id: clients.id,
        companyName: clients.companyName,
        contactName: clients.contactName,
        contactEmail: clients.contactEmail,
      })
      .from(clients)
      .where(scope.clients);

    // CR2 fix: batch-fetch ALL orders for the org in one query, then group by clientId
    const allOrgOrders = await db
      .select({
        id: orders.id,
        clientId: orders.clientId,
        total: orders.total,
        createdAt: orders.createdAt,
        status: orders.status,
      })
      .from(orders)
      .where(scope.orders)
      .orderBy(desc(orders.createdAt));

    const ordersByClient = new Map<number, typeof allOrgOrders>();
    for (const o of allOrgOrders) {
      const arr = ordersByClient.get(o.clientId) || [];
      arr.push(o);
      ordersByClient.set(o.clientId, arr);
    }

    // CR2 fix: batch-fetch ALL stores for the org in one query
    const allOrgStores = await db
      .select({ id: stores.id, status: stores.status, clientId: stores.clientId })
      .from(stores)
      .where(scope.stores);

    const storesByClient = new Map<number, typeof allOrgStores>();
    for (const s of allOrgStores) {
      const arr = storesByClient.get(s.clientId) || [];
      arr.push(s);
      storesByClient.set(s.clientId, arr);
    }

    const now = new Date();
    const signals: ChurnSignal[] = [];

    for (const client of allClients) {
      const clientOrders = ordersByClient.get(client.id) || [];

      const riskSignals: string[] = [];
      let riskScore = 0;

      const totalOrders = clientOrders.length;
      const totalRevenue = clientOrders.reduce((sum, o) => sum + parseFloat(o.total), 0);
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Signal 1: Days since last order
      let daysSinceLastOrder = 0;
      let lastOrderDate: string | null = null;
      if (clientOrders.length > 0) {
        const lastOrder = clientOrders[0];
        lastOrderDate = lastOrder.createdAt.toISOString();
        daysSinceLastOrder = getDaysBetween(lastOrder.createdAt, now);

        if (daysSinceLastOrder > 90) {
          riskSignals.push(`No orders in ${daysSinceLastOrder} days`);
          riskScore += 35;
        } else if (daysSinceLastOrder > 60) {
          riskSignals.push(`Last order ${daysSinceLastOrder} days ago`);
          riskScore += 20;
        } else if (daysSinceLastOrder > 30) {
          riskSignals.push(`Last order ${daysSinceLastOrder} days ago`);
          riskScore += 10;
        }
      } else {
        // No orders at all
        riskSignals.push("No orders placed yet");
        riskScore += 15;
      }

      // Signal 2: Order frequency trend (compare recent vs earlier)
      let orderTrend: "declining" | "stable" | "growing" = "stable";
      if (clientOrders.length >= 3) {
        const midpoint = Math.floor(clientOrders.length / 2);
        const recentOrders = clientOrders.slice(0, midpoint);
        const olderOrders = clientOrders.slice(midpoint);

        // Compare average time between orders
        const recentAvgValue = recentOrders.reduce((s, o) => s + parseFloat(o.total), 0) / recentOrders.length;
        const olderAvgValue = olderOrders.reduce((s, o) => s + parseFloat(o.total), 0) / olderOrders.length;

        if (recentAvgValue < olderAvgValue * 0.7) {
          orderTrend = "declining";
          riskSignals.push(`Order value declining (avg $${Math.round(recentAvgValue)} vs $${Math.round(olderAvgValue)})`);
          riskScore += 25;
        } else if (recentAvgValue > olderAvgValue * 1.3) {
          orderTrend = "growing";
        }
      }

      // Signal 3: Low order volume
      if (totalOrders === 1) {
        riskSignals.push("Only 1 order placed — needs nurturing");
        riskScore += 15;
      }

      // Signal 4: No store activity (client has no active stores)
      const clientStores = storesByClient.get(client.id) || [];

      const activeStores = clientStores.filter(s => s.status === "active");
      if (clientStores.length > 0 && activeStores.length === 0) {
        riskSignals.push("All stores inactive");
        riskScore += 15;
      }
      if (clientStores.length === 0 && totalOrders > 0) {
        riskSignals.push("No webstore set up — missed engagement opportunity");
        riskScore += 10;
      }

      // Cap risk score at 100
      riskScore = Math.min(riskScore, 100);

      // Determine risk level
      let riskLevel: "high" | "medium" | "low" = "low";
      if (riskScore >= 50) riskLevel = "high";
      else if (riskScore >= 25) riskLevel = "medium";

      // Only include clients with some risk signals
      if (riskSignals.length > 0) {
        signals.push({
          clientId: client.id,
          clientName: client.companyName || "Unknown",
          contactName: client.contactName || "",
          contactEmail: client.contactEmail || "",
          riskLevel,
          riskScore,
          signals: riskSignals,
          lastOrderDate,
          daysSinceLastOrder,
          totalOrders,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          orderTrend,
          avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        });
      }
    }

    // Sort by risk score descending
    signals.sort((a, b) => b.riskScore - a.riskScore);

    const summary = {
      high: signals.filter(s => s.riskLevel === "high").length,
      medium: signals.filter(s => s.riskLevel === "medium").length,
      low: signals.filter(s => s.riskLevel === "low").length,
      total: signals.length,
    };

    return { signals, summary };
  }),

  /**
   * Store-Scoped Dept Recommendations — Per-client, per-store product suggestions
   * based on this specific client's ordering behavior. Learns from actual purchase
   * patterns, not generic department affinities.
   *
   * Requires clientId. Optionally scoped to a specific storeId.
   * Returns recommendations grouped by department, scored by:
   *   1. Client-specific purchase history (what this client actually buys)
   *   2. Department affinity baseline (category preferences by role)
   *   3. Cross-client popularity (what other clients order)
   *   4. Novelty bonus (products this client hasn't tried yet)
   */
  storeRecommendations: protectedProcedure
    .use(rateLimited("aiInsights.storeRecommendations", AI_INSIGHTS_LIMIT))
    .input(
      z.object({
        clientId: z.number(),
        storeId: z.number().optional(),
        department: z.string().optional(),
        limit: z.number().min(1).max(20).default(6),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { recommendations: [], clientName: "", activeDepartments: [] };
      const scope = getOrgScope(ctx);

      // 1. Get client info
      const clientRows = await db
        .select({ companyName: clients.companyName })
        .from(clients)
        .where(and(eq(clients.id, input.clientId), scope.clients))
        .limit(1);
      const clientName = clientRows[0]?.companyName || "Unknown";

      // 2. Get all distributor products
      const allProducts = await db
        .select({
          id: products.id,
          name: products.name,
          category: products.category,
          basePrice: products.basePrice,
        })
        .from(products)
        .where(scope.products);

      // 3. Get THIS client's order history (client-specific learning)
      const clientOrderHistory = await db
        .select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
          orderDate: orders.createdAt,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          scope.orders,
          eq(orders.clientId, input.clientId),
        ));

      // 4. Get cross-client order history (what's popular across all clients)
      const allOrderHistory = await db
        .select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(scope.orders);

      // 5. Build client-specific product purchase map
      const clientProductHistory: Record<number, { totalQty: number; orderCount: number; lastOrdered: Date }> = {};
      const clientOrderedProductIds = new Set<number>();
      for (const item of clientOrderHistory) {
        clientOrderedProductIds.add(item.productId);
        if (!clientProductHistory[item.productId]) {
          clientProductHistory[item.productId] = { totalQty: 0, orderCount: 0, lastOrdered: new Date(0) };
        }
        clientProductHistory[item.productId].totalQty += item.quantity;
        clientProductHistory[item.productId].orderCount++;
        if (item.orderDate > clientProductHistory[item.productId].lastOrdered) {
          clientProductHistory[item.productId].lastOrdered = item.orderDate;
        }
      }

      // 6. Build cross-client popularity map
      const crossClientPopularity: Record<number, number> = {};
      for (const item of allOrderHistory) {
        crossClientPopularity[item.productId] = (crossClientPopularity[item.productId] || 0) + item.quantity;
      }

      // 7. Discover active departments from storeUsers for this client's stores
      const clientStores = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(scope.stores, eq(stores.clientId, input.clientId)));

      const storeIds = input.storeId
        ? [input.storeId]
        : clientStores.map(s => s.id);

      let activeDepartments: string[] = [];
      if (storeIds.length > 0) {
        const deptRows = await db
          .select({ department: storeUsers.department })
          .from(storeUsers)
          .where(eq(storeUsers.storeId, storeIds[0]));

        // Also check other stores if multiple
        for (let i = 1; i < storeIds.length; i++) {
          const moreDepts = await db
            .select({ department: storeUsers.department })
            .from(storeUsers)
            .where(eq(storeUsers.storeId, storeIds[i]));
          deptRows.push(...moreDepts);
        }

        const deptSet = new Set<string>();
        for (const row of deptRows) {
          if (row.department) deptSet.add(row.department.toLowerCase());
        }
        activeDepartments = Array.from(deptSet);
      }

      // If no departments found from storeUsers, fall back to common defaults
      if (activeDepartments.length === 0) {
        activeDepartments = ["marketing", "hr", "sales", "engineering", "executive"];
      }

      // 8. Filter to requested department or use all active
      const departments = input.department
        ? [input.department.toLowerCase()]
        : activeDepartments;

      // 9. Score products per department
      const recommendations: DeptRecommendation[] = [];

      for (const dept of departments) {
        const affinityCategories = DEPT_CATEGORY_AFFINITY[dept] || ["apparel", "drinkware", "office"];

        const scoredProducts = allProducts.map(product => {
          let relevanceScore = 0;
          const reasons: string[] = [];

          // A. Client-specific history (strongest signal — 40pts max)
          const clientHistory = clientProductHistory[product.id];
          if (clientHistory) {
            // This client has ordered this product before
            relevanceScore += Math.min(clientHistory.orderCount * 15, 40);
            const daysAgo = getDaysBetween(clientHistory.lastOrdered, new Date());
            if (daysAgo < 90) {
              reasons.push(`Ordered ${clientHistory.totalQty} units by ${clientName} recently`);
            } else {
              reasons.push(`${clientName} ordered ${clientHistory.totalQty} units previously`);
            }
          }

          // B. Category affinity baseline (20pts max)
          const categoryIndex = affinityCategories.indexOf(product.category);
          if (categoryIndex !== -1) {
            relevanceScore += (affinityCategories.length - categoryIndex) * 5;
            reasons.push(`Fits ${dept} department needs`);
          }

          // C. Cross-client popularity (15pts max)
          const crossPopularity = crossClientPopularity[product.id] || 0;
          if (crossPopularity > 0) {
            relevanceScore += Math.min(Math.floor(crossPopularity / 5), 15);
            if (!clientHistory) {
              reasons.push(`${crossPopularity} units ordered by other clients`);
            }
          }

          // D. Novelty bonus — products this client hasn't tried (10pts)
          if (!clientOrderedProductIds.has(product.id) && (categoryIndex !== -1 || crossPopularity > 10)) {
            relevanceScore += 10;
            reasons.push(`New for ${clientName}`);
          }

          // E. Budget-appropriate scoring
          const price = parseFloat(product.basePrice || "0");
          if (dept === "executive" && price > 30) {
            relevanceScore += 8;
            reasons.push("Premium item");
          } else if ((dept === "hr" || dept === "events") && price < 30) {
            relevanceScore += 5;
            reasons.push("Budget-friendly for bulk");
          }

          return {
            productId: product.id,
            productName: product.name,
            category: product.category,
            basePrice: product.basePrice || "0.00",
            reason: reasons.join(" · ") || "General recommendation",
            relevanceScore,
            popularInDept: categoryIndex !== -1 && categoryIndex < 2,
          };
        });

        scoredProducts.sort((a, b) => b.relevanceScore - a.relevanceScore);
        const topProducts = scoredProducts
          .filter(p => p.relevanceScore > 0)
          .slice(0, input.limit);

        if (topProducts.length > 0) {
          recommendations.push({
            department: dept.charAt(0).toUpperCase() + dept.slice(1),
            recommendations: topProducts,
          });
        }
      }

      return { recommendations, clientName, activeDepartments };
    }),

  /**
   * Dashboard summary — Combined overview for the AI insights dashboard widget
   */
  dashboardSummary: protectedProcedure
    .use(rateLimited("aiInsights.dashboardSummary", AI_INSIGHTS_LIMIT))
    .query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return {
      reorderAlerts: { overdue: 0, urgent: 0, upcoming: 0 },
      churnRisk: { high: 0, medium: 0, low: 0 },
      topRecommendations: [],
    };
    const scope = getOrgScope(ctx);

    // Quick counts for dashboard cards
    // Reorder predictions
    const orderData = await db
      .select({
        clientId: orders.clientId,
        productId: orderItems.productId,
        orderDate: orders.createdAt,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orders.id, orderItems.orderId))
      .where(scope.orders);

    const now = new Date();
    let overdue = 0, urgent = 0, upcoming = 0;

    // Simple grouping for quick counts
    const groups: Record<string, Date[]> = {};
    for (const row of orderData) {
      const key = `${row.clientId}-${row.productId}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row.orderDate);
    }

    for (const dates of Object.values(groups)) {
      dates.sort((a, b) => a.getTime() - b.getTime());
      const lastDate = dates[dates.length - 1];
      const avgInterval = dates.length >= 2
        ? getDaysBetween(dates[0], dates[dates.length - 1]) / (dates.length - 1)
        : 90;
      const predicted = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000);
      const daysUntil = Math.floor((predicted.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntil < 0) overdue++;
      else if (daysUntil <= 7) urgent++;
      else if (daysUntil <= 30) upcoming++;
    }

    // Churn risk counts — CR3 fix: batch-fetch all orders and clients, group in JS
    const dashClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(scope.clients);

    const dashOrders = await db
      .select({ clientId: orders.clientId, createdAt: orders.createdAt, total: orders.total })
      .from(orders)
      .where(scope.orders);

    const dashOrdersByClient = new Map<number, typeof dashOrders>();
    for (const o of dashOrders) {
      const arr = dashOrdersByClient.get(o.clientId) || [];
      arr.push(o);
      dashOrdersByClient.set(o.clientId, arr);
    }

    let highRisk = 0, medRisk = 0, lowRisk = 0;
    for (const client of dashClients) {
      const clientOrders = dashOrdersByClient.get(client.id) || [];

      let score = 0;
      if (clientOrders.length === 0) {
        score = 15;
      } else {
        const lastOrder = clientOrders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        const daysSince = getDaysBetween(lastOrder.createdAt, now);
        if (daysSince > 90) score += 35;
        else if (daysSince > 60) score += 20;
        else if (daysSince > 30) score += 10;
        if (clientOrders.length === 1) score += 15;
      }

      if (score >= 50) highRisk++;
      else if (score >= 25) medRisk++;
      else if (score > 0) lowRisk++;
    }

    // Purchase order metrics
    let poCostOfGoods = 0;
    let poPending = 0;
    let poOverdue = 0;
    try {
      const { purchaseOrders: poTable } = await import("../../drizzle/schema");
      const poRows = await db.select().from(poTable).where(scope.purchaseOrders);
      for (const po of poRows) {
        poCostOfGoods += parseFloat(String(po.total || "0"));
        if (po.status === "draft" || po.status === "sent") poPending++;
        if (po.requestedShipDate && new Date(po.requestedShipDate) < now && po.status !== "received" && po.status !== "cancelled") {
          poOverdue++;
        }
      }
    } catch {
      // PO table may not exist yet — graceful fallback
    }

    // Revenue for margin calculation
    const allOrders = await db.select({ total: orders.total }).from(orders).where(scope.orders);
    const totalRevenue = allOrders.reduce((sum, o) => sum + parseFloat(String(o.total || "0")), 0);
    const grossMargin = totalRevenue - poCostOfGoods;
    const grossMarginPercent = totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0;

    return {
      reorderAlerts: { overdue, urgent, upcoming },
      churnRisk: { high: highRisk, medium: medRisk, low: lowRisk },
      purchaseOrders: {
        costOfGoods: poCostOfGoods,
        grossMargin,
        grossMarginPercent: Math.round(grossMarginPercent * 10) / 10,
        pending: poPending,
        overdue: poOverdue,
        totalRevenue,
      },
    };
  }),
});
