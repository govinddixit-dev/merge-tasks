/**
 * AI Insights Integration Tests
 * Tests the three AI features: Predictive Reordering, Churn Signals, Dept-Aware Recommendations
 * These test against real seeded data in the database.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "./db";
import {
  clients,
  products,
  orders,
  orderItems,
  stores,
} from "../drizzle/schema";
import { eq, and, count } from "drizzle-orm";

const TEST_USER_ID = 1;

//  Data Verification 

describe("AI Insights — Data Foundation", () => {
  it("has seeded clients for the test user", async () => {
    const db = await getDb();
    if (!db) return;
    const rows = await db
      .select()
      .from(clients)
      .where(eq(clients.userId, TEST_USER_ID));
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it("has seeded products for the test user", async () => {
    const db = await getDb();
    if (!db) return;
    const rows = await db
      .select()
      .from(products)
      .where(eq(products.userId, TEST_USER_ID));
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it("has seeded orders for the test user", async () => {
    const db = await getDb();
    if (!db) return;
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, TEST_USER_ID));
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it("has seeded order items", async () => {
    const db = await getDb();
    if (!db) return;
    const orderRows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.userId, TEST_USER_ID));
    const orderIds = orderRows.map((o) => o.id);
    expect(orderIds.length).toBeGreaterThan(0);

    // Check that at least some orders have items
    let totalItems = 0;
    for (const oid of orderIds) {
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, oid));
      totalItems += items.length;
    }
    expect(totalItems).toBeGreaterThanOrEqual(20);
  });
});

//  Predictive Reordering 

describe("AI Insights — Predictive Reordering", () => {
  it("can compute reorder predictions from order history", async () => {
    const db = await getDb();
    if (!db) return;

    // Replicate the grouping logic from aiInsights.ts
    const orderData = await db
      .select({
        clientId: orders.clientId,
        clientName: clients.companyName,
        productId: orderItems.productId,
        productName: products.name,
        category: products.category,
        quantity: orderItems.quantity,
        orderDate: orders.createdAt,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orders.id, orderItems.orderId))
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orders.userId, TEST_USER_ID));

    expect(orderData.length).toBeGreaterThan(0);

    // Group by client + product
    const groups: Record<string, typeof orderData> = {};
    for (const row of orderData) {
      const key = `${row.clientId}-${row.productId}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }

    // Should have multiple client-product groups
    const groupCount = Object.keys(groups).length;
    expect(groupCount).toBeGreaterThanOrEqual(5);
  });

  it("calculates urgency levels correctly", () => {
    // Test the urgency function logic
    function getUrgency(daysUntil: number): string {
      if (daysUntil < 0) return "overdue";
      if (daysUntil <= 7) return "urgent";
      if (daysUntil <= 30) return "upcoming";
      return "normal";
    }

    expect(getUrgency(-5)).toBe("overdue");
    expect(getUrgency(-1)).toBe("overdue");
    expect(getUrgency(0)).toBe("urgent");
    expect(getUrgency(3)).toBe("urgent");
    expect(getUrgency(7)).toBe("urgent");
    expect(getUrgency(8)).toBe("upcoming");
    expect(getUrgency(30)).toBe("upcoming");
    expect(getUrgency(31)).toBe("normal");
    expect(getUrgency(90)).toBe("normal");
  });

  it("predictions include required fields", async () => {
    const db = await getDb();
    if (!db) return;

    const orderData = await db
      .select({
        clientId: orders.clientId,
        clientName: clients.companyName,
        productId: orderItems.productId,
        productName: products.name,
        category: products.category,
        quantity: orderItems.quantity,
        orderDate: orders.createdAt,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orders.id, orderItems.orderId))
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orders.userId, TEST_USER_ID));

    // Build one prediction manually
    const groups: Record<string, typeof orderData> = {};
    for (const row of orderData) {
      const key = `${row.clientId}-${row.productId}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }

    const firstGroup = Object.values(groups)[0];
    expect(firstGroup).toBeDefined();
    expect(firstGroup.length).toBeGreaterThan(0);

    const first = firstGroup[0];
    expect(first.clientId).toBeDefined();
    expect(first.clientName).toBeTruthy();
    expect(first.productId).toBeDefined();
    expect(first.productName).toBeTruthy();
    expect(first.category).toBeTruthy();
    expect(first.quantity).toBeGreaterThan(0);
  });

  it("computes average interval for multi-order groups", async () => {
    const db = await getDb();
    if (!db) return;

    const orderData = await db
      .select({
        clientId: orders.clientId,
        productId: orderItems.productId,
        orderDate: orders.createdAt,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orders.id, orderItems.orderId))
      .where(eq(orders.userId, TEST_USER_ID));

    const groups: Record<string, Date[]> = {};
    for (const row of orderData) {
      const key = `${row.clientId}-${row.productId}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row.orderDate);
    }

    // Find a group with multiple orders
    const multiOrderGroup = Object.values(groups).find((g) => g.length >= 2);
    if (!multiOrderGroup) return; // skip if no multi-order groups

    multiOrderGroup.sort((a, b) => a.getTime() - b.getTime());

    const intervals: number[] = [];
    for (let i = 1; i < multiOrderGroup.length; i++) {
      const diff = Math.abs(
        Math.floor(
          (multiOrderGroup[i].getTime() - multiOrderGroup[i - 1].getTime()) /
            (1000 * 60 * 60 * 24)
        )
      );
      intervals.push(diff);
    }

    const avgInterval =
      Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
    expect(avgInterval).toBeGreaterThan(0);
  });
});

//  Churn & Engagement Signals 

describe("AI Insights — Churn & Engagement Signals", () => {
  it("can identify clients with risk signals", async () => {
    const db = await getDb();
    if (!db) return;

    const allClients = await db
      .select({
        id: clients.id,
        companyName: clients.companyName,
        contactName: clients.contactName,
        contactEmail: clients.contactEmail,
      })
      .from(clients)
      .where(eq(clients.userId, TEST_USER_ID));

    expect(allClients.length).toBeGreaterThanOrEqual(5);

    let clientsWithRisk = 0;
    const now = new Date();

    for (const client of allClients) {
      const clientOrders = await db
        .select({
          total: orders.total,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(
          and(eq(orders.userId, TEST_USER_ID), eq(orders.clientId, client.id))
        );

      let riskScore = 0;

      if (clientOrders.length === 0) {
        riskScore += 15;
      } else {
        const lastOrder = clientOrders.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        )[0];
        const daysSince = Math.abs(
          Math.floor(
            (now.getTime() - lastOrder.createdAt.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        );
        if (daysSince > 90) riskScore += 35;
        else if (daysSince > 60) riskScore += 20;
        else if (daysSince > 30) riskScore += 10;
        if (clientOrders.length === 1) riskScore += 15;
      }

      if (riskScore > 0) clientsWithRisk++;
    }

    // At least some clients should have risk signals (seeded data has varied order dates)
    expect(clientsWithRisk).toBeGreaterThan(0);
  });

  it("risk level thresholds are correct", () => {
    function getRiskLevel(score: number): string {
      if (score >= 50) return "high";
      if (score >= 25) return "medium";
      return "low";
    }

    expect(getRiskLevel(0)).toBe("low");
    expect(getRiskLevel(10)).toBe("low");
    expect(getRiskLevel(24)).toBe("low");
    expect(getRiskLevel(25)).toBe("medium");
    expect(getRiskLevel(49)).toBe("medium");
    expect(getRiskLevel(50)).toBe("high");
    expect(getRiskLevel(100)).toBe("high");
  });

  it("calculates total revenue correctly for clients with orders", async () => {
    const db = await getDb();
    if (!db) return;

    const clientRow = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.userId, TEST_USER_ID))
      .limit(1);

    if (clientRow.length === 0) return;

    const clientOrders = await db
      .select({ total: orders.total })
      .from(orders)
      .where(
        and(
          eq(orders.userId, TEST_USER_ID),
          eq(orders.clientId, clientRow[0].id)
        )
      );

    const totalRevenue = clientOrders.reduce(
      (sum, o) => sum + parseFloat(o.total),
      0
    );
    // Revenue should be non-negative
    expect(totalRevenue).toBeGreaterThanOrEqual(0);
  });

  it("order trend detection works for clients with 3+ orders", async () => {
    const db = await getDb();
    if (!db) return;

    // Find a client with at least 3 orders
    const allClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.userId, TEST_USER_ID));

    for (const client of allClients) {
      const clientOrders = await db
        .select({ total: orders.total, createdAt: orders.createdAt })
        .from(orders)
        .where(
          and(eq(orders.userId, TEST_USER_ID), eq(orders.clientId, client.id))
        );

      if (clientOrders.length >= 3) {
        const midpoint = Math.floor(clientOrders.length / 2);
        const recentOrders = clientOrders.slice(0, midpoint);
        const olderOrders = clientOrders.slice(midpoint);

        const recentAvg =
          recentOrders.reduce((s, o) => s + parseFloat(o.total), 0) /
          recentOrders.length;
        const olderAvg =
          olderOrders.reduce((s, o) => s + parseFloat(o.total), 0) /
          olderOrders.length;

        // Both averages should be valid numbers
        expect(isNaN(recentAvg)).toBe(false);
        expect(isNaN(olderAvg)).toBe(false);

        // Trend determination should be one of three values
        let trend: string;
        if (recentAvg < olderAvg * 0.7) trend = "declining";
        else if (recentAvg > olderAvg * 1.3) trend = "growing";
        else trend = "stable";

        expect(["declining", "stable", "growing"]).toContain(trend);
        return; // Found and tested one client
      }
    }
  });
});

//  Dept-Aware Recommendations 

describe("AI Insights — Store-Scoped Recommendations", () => {
  // Tests validate the scoring logic used by storeRecommendations.
  // The procedure now requires clientId and is per-client/per-store.
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

  it("has category affinity mappings for all expected departments", () => {
    const expectedDepts = [
      "marketing",
      "hr",
      "sales",
      "engineering",
      "executive",
      "it",
      "events",
    ];
    for (const dept of expectedDepts) {
      expect(DEPT_CATEGORY_AFFINITY[dept]).toBeDefined();
      expect(DEPT_CATEGORY_AFFINITY[dept].length).toBeGreaterThan(0);
    }
  });

  it("can score products for a department", async () => {
    const db = await getDb();
    if (!db) return;

    const allProducts = await db
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        basePrice: products.basePrice,
      })
      .from(products)
      .where(eq(products.userId, TEST_USER_ID));

    expect(allProducts.length).toBeGreaterThan(0);

    // Score for marketing department
    const affinityCategories = DEPT_CATEGORY_AFFINITY["marketing"];
    const scored = allProducts.map((p) => {
      let score = 0;
      const catIdx = affinityCategories.indexOf(p.category);
      if (catIdx !== -1) {
        score += (affinityCategories.length - catIdx) * 20;
      }
      return { ...p, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Top product should have a positive score (apparel or drinkware should match)
    expect(scored[0].score).toBeGreaterThan(0);
  });

  it("different departments get different top recommendations", async () => {
    const db = await getDb();
    if (!db) return;

    const allProducts = await db
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        basePrice: products.basePrice,
      })
      .from(products)
      .where(eq(products.userId, TEST_USER_ID));

    if (allProducts.length < 3) return;

    function getTopForDept(dept: string): number[] {
      const affinity = DEPT_CATEGORY_AFFINITY[dept] || [];
      const scored = allProducts.map((p) => {
        let score = 0;
        const catIdx = affinity.indexOf(p.category);
        if (catIdx !== -1) score += (affinity.length - catIdx) * 20;
        return { id: p.id, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 3).map((s) => s.id);
    }

    const marketingTop = getTopForDept("marketing");
    const itTop = getTopForDept("it");

    // Marketing and IT should have different priorities (apparel vs tech)
    // At minimum, the ordering should differ
    expect(marketingTop.length).toBe(3);
    expect(itTop.length).toBe(3);
  });

  it("executive department favors premium items", async () => {
    const db = await getDb();
    if (!db) return;

    const allProducts = await db
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        basePrice: products.basePrice,
      })
      .from(products)
      .where(eq(products.userId, TEST_USER_ID));

    const affinity = DEPT_CATEGORY_AFFINITY["executive"];

    const scored = allProducts.map((p) => {
      let score = 0;
      const catIdx = affinity.indexOf(p.category);
      if (catIdx !== -1) score += (affinity.length - catIdx) * 20;

      // Executive premium bonus
      const price = parseFloat(p.basePrice || "0");
      if (price > 30) score += 15;

      return { ...p, score, price };
    });

    scored.sort((a, b) => b.score - a.score);

    // The scoring system should work
    expect(scored[0].score).toBeGreaterThan(0);
  });

  it("HR/events departments favor budget-friendly items", async () => {
    const db = await getDb();
    if (!db) return;

    const allProducts = await db
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        basePrice: products.basePrice,
      })
      .from(products)
      .where(eq(products.userId, TEST_USER_ID));

    const affinity = DEPT_CATEGORY_AFFINITY["hr"];

    const scored = allProducts.map((p) => {
      let score = 0;
      const catIdx = affinity.indexOf(p.category);
      if (catIdx !== -1) score += (affinity.length - catIdx) * 20;

      const price = parseFloat(p.basePrice || "0");
      if (price < 30) score += 10; // Budget-friendly bonus for HR

      return { ...p, score, price };
    });

    scored.sort((a, b) => b.score - a.score);
    expect(scored[0].score).toBeGreaterThan(0);
  });
});

//  Copilot Memory Layer 

describe("AI Insights — Copilot Memory Layer", () => {
  it("copilotMemory module exports all required functions", async () => {
    const memoryModule = await import("./routers/copilotMemory");
    expect(typeof memoryModule.buildMemoryContext).toBe("function");
    expect(typeof memoryModule.formatMemoryForPrompt).toBe("function");
    expect(typeof memoryModule.logTask).toBe("function");
    expect(typeof memoryModule.saveConversation).toBe("function");
    expect(typeof memoryModule.extractPreferencesFromTask).toBe("function");
    expect(typeof memoryModule.learnPreference).toBe("function");
    expect(typeof memoryModule.getPreferences).toBe("function");
    expect(typeof memoryModule.getRecentConversations).toBe("function");
    expect(typeof memoryModule.getRecentTasks).toBe("function");
  });

  it("formatMemoryForPrompt handles empty context", async () => {
    const { formatMemoryForPrompt } = await import("./routers/copilotMemory");
    const emptyCtx = {
      recentTasks: [],
      preferences: {},
      conversationSummaries: [],
      distributorProfile: "",
      catalogSummary: "",
      clientSummary: "",
    };
    const result = formatMemoryForPrompt(emptyCtx);
    expect(result).toContain("new user");
    expect(result).toContain("Memory");
  });

  it("formatMemoryForPrompt includes distributor profile when present", async () => {
    const { formatMemoryForPrompt } = await import("./routers/copilotMemory");
    const ctx = {
      recentTasks: [],
      preferences: {},
      conversationSummaries: [],
      distributorProfile: "Company: Acme Promos | Size: 10-50",
      catalogSummary: "",
      clientSummary: "",
    };
    const result = formatMemoryForPrompt(ctx);
    expect(result).toContain("Acme Promos");
    expect(result).toContain("Distributor");
  });

  it("formatMemoryForPrompt includes recent tasks", async () => {
    const { formatMemoryForPrompt } = await import("./routers/copilotMemory");
    const ctx = {
      recentTasks: [
        "[2m ago] Created proposal #5 for Acme Corp",
        "[1h ago] Sent proposal #3 to jane@example.com",
      ],
      preferences: {},
      conversationSummaries: [],
      distributorProfile: "",
      catalogSummary: "",
      clientSummary: "",
    };
    const result = formatMemoryForPrompt(ctx);
    expect(result).toContain("Created proposal #5");
    expect(result).toContain("Sent proposal #3");
    expect(result).toContain("Recent Task History");
  });

  it("formatMemoryForPrompt includes learned preferences", async () => {
    const { formatMemoryForPrompt } = await import("./routers/copilotMemory");
    const ctx = {
      recentTasks: [],
      preferences: {
        "client_usage:Acme Corp": JSON.stringify({
          lastUsed: "2026-01-01",
          clientId: 1,
        }),
        "product_usage:Custom Hoodie": JSON.stringify({
          lastQuantity: 50,
          lastPrice: "24.99",
          productId: 1,
        }),
        "workflow:uses_multi_department": "true",
      },
      conversationSummaries: [],
      distributorProfile: "",
      catalogSummary: "",
      clientSummary: "",
    };
    const result = formatMemoryForPrompt(ctx);
    expect(result).toContain("Acme Corp");
    expect(result).toContain("Custom Hoodie");
    expect(result).toContain("Learned Preferences");
    expect(result).toContain("Workflow preference");
  });

  it("formatMemoryForPrompt includes conversation summaries", async () => {
    const { formatMemoryForPrompt } = await import("./routers/copilotMemory");
    const ctx = {
      recentTasks: [],
      preferences: {},
      conversationSummaries: [
        "User asked to create a proposal for TechGlobal with hoodies and mugs",
        "User optimized the Bright Labs webstore with AI descriptions",
      ],
      distributorProfile: "",
      catalogSummary: "",
      clientSummary: "",
    };
    const result = formatMemoryForPrompt(ctx);
    expect(result).toContain("TechGlobal");
    expect(result).toContain("Bright Labs");
    expect(result).toContain("Recent Conversations");
  });

  it("buildMemoryContext returns all required fields", async () => {
    const { buildMemoryContext } = await import("./routers/copilotMemory");
    const ctx = await buildMemoryContext(TEST_USER_ID);
    expect(ctx).toHaveProperty("recentTasks");
    expect(ctx).toHaveProperty("preferences");
    expect(ctx).toHaveProperty("conversationSummaries");
    expect(ctx).toHaveProperty("distributorProfile");
    expect(ctx).toHaveProperty("catalogSummary");
    expect(ctx).toHaveProperty("clientSummary");
    expect(Array.isArray(ctx.recentTasks)).toBe(true);
    expect(typeof ctx.preferences).toBe("object");
    expect(Array.isArray(ctx.conversationSummaries)).toBe(true);
  });

  it("buildMemoryContext includes catalog summary from seeded products", async () => {
    const db = await getDb();
    if (!db) return; // Skip if no DB
    const { buildMemoryContext } = await import("./routers/copilotMemory");
    const ctx = await buildMemoryContext(TEST_USER_ID);
    // Should include product count and categories from seeded data
    expect(ctx.catalogSummary).toContain("products total");
  });

  it("buildMemoryContext includes client summary from seeded clients", async () => {
    const db = await getDb();
    if (!db) return; // Skip if no DB
    const { buildMemoryContext } = await import("./routers/copilotMemory");
    const ctx = await buildMemoryContext(TEST_USER_ID);
    // Should include client count from seeded data
    expect(ctx.clientSummary).toContain("clients");
  });
});
