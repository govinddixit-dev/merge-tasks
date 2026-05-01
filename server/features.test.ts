import { getDb } from "./db";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

// Track all IDs created during tests for cleanup
const createdClientIds: number[] = [];
const createdProductIds: number[] = [];
const createdProposalIds: number[] = [];

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@mergetasks.com",
    name: "Test User",
    loginMethod: "email",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

//  Cleanup after all tests 
afterAll(async () => {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  // Delete proposals first (depends on clients)
  for (const id of createdProposalIds) {
    try { await caller.proposals.delete({ id }); } catch {}
  }
  // Delete products
  for (const id of createdProductIds) {
    try { await caller.products.delete({ id }); } catch {}
  }
  // Delete clients
  for (const id of createdClientIds) {
    try { await caller.clients.delete({ id }); } catch {}
  }
});

let _dbAvailable = false;
beforeAll(async () => {
  const db = await getDb();
  _dbAvailable = !!db;
  if (!db) console.log("NOTE: Database unavailable — DB-dependent tests will be skipped");
});

describe.skipIf(!_dbAvailable)("clients router", () => {
  it("list returns an array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("create requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.clients.create({
        companyName: "Test Corp",
        contactName: "John Doe",
        contactEmail: "john@test.com",
      })
    ).rejects.toThrow();
  });

  it("create inserts a client and returns it", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.create({
      companyName: "Vitest Corp",
      contactName: "Jane Test",
      contactEmail: "jane@vitest.com",
      contactPhone: "(555) 000-1234",
      industry: "Technology",
    });
    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    createdClientIds.push(result.id);
  });
});

describe.skipIf(!_dbAvailable)("products router", () => {
  it("list returns an array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.products.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("create inserts a product", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.products.create({
      name: "Test Product",
      category: "tech",
      type: "promotional",
      basePrice: "25.00",
    });
    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    createdProductIds.push(result.id);
  });

  it("bulkCreate inserts multiple products", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.products.bulkCreate({
      products: [
        { name: "Bulk Item A", category: "office", type: "promotional", basePrice: "10.00" },
        { name: "Bulk Item B", category: "bags", type: "promotional", basePrice: "15.00" },
      ],
    });
    expect(result.count).toBe(2);
    // Track the created bulk products for cleanup
    if (result.ids) {
      result.ids.forEach((id: number) => createdProductIds.push(id));
    }
  });
});

describe.skipIf(!_dbAvailable)("proposals router", () => {
  it("list returns an array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.proposals.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("create inserts a proposal", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // First get a client ID
    const clients = await caller.clients.list();
    if (clients.length === 0) return; // skip if no clients
    const result = await caller.proposals.create({
      clientId: clients[0].id,
      title: "Test Proposal",
      proposalType: "promo",
      deliveryMethod: "email",
    });
    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    createdProposalIds.push(result.id);
  });
});

describe.skipIf(!_dbAvailable)("stores router", () => {
  it("list returns an array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe.skipIf(!_dbAvailable)("orders router", () => {
  it("list returns an array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.orders.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("stats returns numeric values", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.orders.stats();
    expect(typeof result.totalOrders).toBe("number");
    expect(typeof result.pendingOrders).toBe("number");
    expect(typeof result.monthlyGmv).toBe("number");
  });
});

describe.skipIf(!_dbAvailable)("copilot router", () => {
  it.skip("chat returns a response string (requires LLM API credits)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.copilot.chat({
      message: "Hello, how can you help me?",
      context: { page: "dashboard" },
    });
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
  });
});
