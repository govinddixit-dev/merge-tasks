import { getDb } from "./db";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { storeProducts, clientLogos, products } from "../drizzle/schema";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

// Track all IDs created during tests for cleanup
const createdClientIds: number[] = [];
const createdStoreIds: number[] = [];
const createdProductIds: number[] = [];

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 99999,
    openId: "test-user-99999",
    email: "test99999@mergetasks.com",
    name: "Test User",
    loginMethod: "email",
    role: "admin",
    subscriptionTier: "pro",
    subscriptionStatus: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    organizationId: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAuthContextForUser(userId: number, openId: string): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId,
    email: `${openId}@mergetasks.com`,
    name: `Test User ${userId}`,
    loginMethod: "email",
    role: "admin",
    subscriptionTier: "pro",
    subscriptionStatus: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    organizationId: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    organizationId: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

//  Idempotent test-user seed (FK target for clients.userId)
beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT IGNORE INTO users (id, openId, email, role, subscriptionTier, subscriptionStatus)
    VALUES (99999, 'test-user-99999', 'test99999@mergetasks.com', 'user', 'pro', 'active')
  `);
});

//  Cleanup after all tests
afterAll(async () => {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  // Delete stores first (depends on clients/products)
  for (const id of createdStoreIds) {
    try { await caller.stores.delete({ id }); } catch {}
  }
  // Delete products
  for (const id of createdProductIds) {
    try { await caller.products.delete({ id }); } catch {}
  }
  // Delete test logos seeded for activation gate (must precede client deletion — FK)
  const _db = await getDb();
  if (_db) {
    try { await _db.delete(clientLogos).where(eq(clientLogos.userId, 99999)); } catch {}
  }
  // Delete clients
  for (const id of createdClientIds) {
    try { await caller.clients.delete({ id }); } catch {}
  }
});

//  Clients CRUD Tests 

// Evaluated at module-load time so describe.skipIf reads it correctly.
// beforeAll fires after collection, which is too late for skipIf.
const _dbAvailable = !!process.env.DATABASE_URL;
if (!_dbAvailable) console.log("NOTE: DATABASE_URL unset — DB-dependent tests will be skipped");

describe.skipIf(!_dbAvailable)("clients CRUD", () => {
  let createdClientId: number;

  it("list returns an array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.list();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("create requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.clients.create({
        companyName: "Unauth Corp",
        contactName: "Nobody",
        contactEmail: "nobody@test.com",
      })
    ).rejects.toThrow();
  });

  it("create inserts a client with all fields", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.create({
      companyName: "E2E Test Corp",
      contactName: "Alice Tester",
      contactEmail: "alice@e2etest.com",
      contactPhone: "(555) 123-4567",
      industry: "Technology",
      address: "123 Test St, San Francisco, CA 94105",
      notes: "Created by vitest",
    });
    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    expect(result.companyName).toBe("E2E Test Corp");
    createdClientId = result.id;
    createdClientIds.push(result.id);
  });

  it("getById returns the created client with enriched data", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.getById({ id: createdClientId });
    expect(result).toBeDefined();
    expect(result.companyName).toBe("E2E Test Corp");
    expect(result.contactName).toBe("Alice Tester");
    // Should include enrichment arrays
    expect(Array.isArray(result.proposals)).toBe(true);
    expect(Array.isArray(result.orders)).toBe(true);
    expect(Array.isArray(result.stores)).toBe(true);
    expect(Array.isArray(result.logos)).toBe(true);
    expect(Array.isArray(result.assets)).toBe(true);
  });

  it("update modifies client fields", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.update({
      id: createdClientId,
      companyName: "E2E Test Corp Updated",
      industry: "SaaS",
      notes: "Updated by vitest",
    });
    expect(result).toBeDefined();
    expect(result.companyName).toBe("E2E Test Corp Updated");
    expect(result.industry).toBe("SaaS");
  });

  it("list with search filter works", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.list({ search: "E2E Test" });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some((c: any) => c.companyName.includes("E2E Test"))).toBe(true);
  });

  it("delete a client with no related data succeeds", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Create a fresh client with no proposals/orders/stores
    const freshClient = await caller.clients.create({
      companyName: "Deletable Corp",
      contactName: "Del Tester",
      contactEmail: "del@test.com",
    });
    const result = await caller.clients.delete({ id: freshClient.id });
    expect(result.success).toBe(true);
    // No need to track — already deleted
  });

  it("getById throws NOT_FOUND for deleted client", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Use a non-existent ID
    await expect(
      caller.clients.getById({ id: 999999 })
    ).rejects.toThrow();
  });
});

//  Stores CRUD Tests 

describe.skipIf(!_dbAvailable)("stores CRUD", () => {
  let testClientId: number;
  let testStoreId: number;
  let testProductId: number;

  beforeAll(async () => {
    // Create a client and product for store tests
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const client = await caller.clients.create({
      companyName: "Store Test Client",
      contactName: "Bob Store",
      contactEmail: "bob@storetest.com",
    });
    testClientId = client.id;
    createdClientIds.push(client.id);

    const product = await caller.products.create({
      name: "Store Test Product",
      category: "tech",
      type: "promotional",
      basePrice: "29.99",
    });
    testProductId = product.id;
    createdProductIds.push(product.id);

    // Activation gate — stores.create with status="active" requires the client
    // to have at least one logo. Seed a placeholder so the suite can exercise
    // the active-store path.
    const db = await getDb();
    if (db) {
      await db.insert(clientLogos).values({
        userId: 99999,
        clientId: testClientId,
        logoUrl: "https://example.com/test-logo.png",
        logoName: "test-logo.png",
      });
    }
  });

  it("list returns an array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.list();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("create requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.stores.create({
        clientId: testClientId,
        name: "Unauth Store",
        slug: "unauth-store",
      })
    ).rejects.toThrow();
  });

  it("create inserts a store with all settings", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.create({
      clientId: testClientId,
      name: "E2E Test Store",
      slug: `e2e-test-store-${Date.now()}`,
      storeType: "permanent",
      primaryColor: "#654BF9",
      stripeEnabled: true,
      rbacEnabled: true,
      ssoEnabled: false,
      status: "active",
    });
    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    expect(result.name).toBe("E2E Test Store");
    expect(result.status).toBe("active");
    testStoreId = result.id;
    createdStoreIds.push(result.id);
  });

  it("getById returns the store with products and client", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.getById({ id: testStoreId });
    expect(result).toBeDefined();
    expect(result.name).toBe("E2E Test Store");
    expect(result.client).toBeDefined();
    expect(result.client?.companyName).toBe("Store Test Client");
    expect(Array.isArray(result.products)).toBe(true);
    expect(Array.isArray(result.storeProducts)).toBe(true);
  });

  it("assignProducts links products to the store", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.assignProducts({
      storeId: testStoreId,
      products: [
        { productId: testProductId, customPrice: "24.99", featured: true },
      ],
    });
    expect(result.count).toBe(1);
  });

  it("assignProducts succeeds when binding a product that lacks placement analysis", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Pre-seed a product with NULL imageUrl so the lazy hook's fire-and-forget
    // runAnalysisAndPersist short-circuits with status="skipped" reason="no_image"
    // — exercises the wiring without a real Anthropic call.
    const product = await caller.products.create({
      name: "Unanalyzed Test Product",
      sku: `SKU-NOIMG-${Date.now()}`,
      category: "other",
      basePrice: "10.00",
    });
    createdProductIds.push(product.id);

    // assignProducts is destructive replace — bundle testProductId so the
    // downstream retryRender tests retain their canonical binding.
    const result = await caller.stores.assignProducts({
      storeId: testStoreId,
      products: [
        { productId: testProductId, customPrice: "24.99", featured: true },
        { productId: product.id },
      ],
    });

    expect(result.count).toBe(2);
    const reread = await caller.stores.getById({ id: testStoreId });
    expect(reread.storeProducts.some((sp) => sp.productId === product.id)).toBe(true);
  });

  it("assignProducts skips analysis hook for products that already have placement", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const _db = await getDb();

    const product = await caller.products.create({
      name: "Already-Analyzed Test Product",
      sku: `SKU-ANALYZED-${Date.now()}`,
      category: "apparel",
      basePrice: "20.00",
    });
    createdProductIds.push(product.id);

    // Stamp the placement columns directly so the new hook's
    // isNull(analyzedAt) filter excludes this product. No analyzer call.
    await _db!.execute(sql`
      UPDATE products
      SET webstoreImprintPlacementAnalyzedAt = NOW(),
          webstoreImprintPlacementZone = 'left_chest',
          webstoreImprintPlacementX = 0.3,
          webstoreImprintPlacementY = 0.2,
          webstoreImprintPlacementWidth = 0.15,
          webstoreImprintPlacementHeight = 0.12
      WHERE id = ${product.id}
    `);

    const result = await caller.stores.assignProducts({
      storeId: testStoreId,
      products: [
        { productId: testProductId, customPrice: "24.99", featured: true },
        { productId: product.id },
      ],
    });

    expect(result.count).toBe(2);
  });

  it("assignProducts handles empty products array without invoking the analysis hook", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.stores.assignProducts({
      storeId: testStoreId,
      products: [],
    });

    expect(result.count).toBe(0);

    // Restore testProductId binding so downstream retryRender tests pass.
    await caller.stores.assignProducts({
      storeId: testStoreId,
      products: [{ productId: testProductId, customPrice: "24.99", featured: true }],
    });
  });

  it("getById now includes the assigned product", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.getById({ id: testStoreId });
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.storeProducts.length).toBeGreaterThan(0);
  });

  it("retryRender enqueues a render for an owned store-product binding", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Stamp testProductId with a full set of render prereqs so the
    // queued path is exercised. Without these, retryRender now correctly
    // refuses to flip status (covered by the negative-path tests below).
    const db = await getDb();
    if (!db) throw new Error("db unavailable");
    await db
      .update(products)
      .set({
        imageUrl: "https://example.com/test-product.jpg",
        webstoreImprintPlacementX: "0.3000",
        webstoreImprintPlacementY: "0.2000",
        webstoreImprintPlacementWidth: "0.1500",
        webstoreImprintPlacementHeight: "0.1200",
        webstoreImprintPlacementZone: "left_chest",
        webstoreImprintPlacementAnalyzedAt: new Date(),
      })
      .where(eq(products.id, testProductId));

    const result = await caller.stores.retryRender({
      storeId: testStoreId,
      productId: testProductId,
    });
    expect(result.success).toBe(true);
    expect(result.action).toBe("queued");

    const after = await caller.stores.getById({ id: testStoreId });
    const binding = after.storeProducts.find(
      (sp) => sp.productId === testProductId,
    );
    expect(binding?.webstoreRenderStatus).toBe("pending");
  });

  it("retryRender throws NOT_FOUND when caller's scope does not own the store (cross-tenant isolation)", async () => {
    // Different user.id → getOrgScope falls back to userId scope, producing
    // a stores WHERE clause that excludes the test-suite owner's store.
    const otherCtx = createAuthContextForUser(99998, "test-user-other-org");
    const otherCaller = appRouter.createCaller(otherCtx);

    await expect(
      otherCaller.stores.retryRender({
        storeId: testStoreId,
        productId: testProductId,
      }),
    ).rejects.toThrow(/Store not found/i);
  });

  it("retryRender flips webstoreRenderStatus from failed to pending", async () => {
    const db = await getDb();
    if (!db) throw new Error("db unavailable");

    await db
      .update(storeProducts)
      .set({ webstoreRenderStatus: "failed" })
      .where(and(
        eq(storeProducts.storeId, testStoreId),
        eq(storeProducts.productId, testProductId),
      ));

    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const before = await caller.stores.getById({ id: testStoreId });
    const beforeBinding = before.storeProducts.find(
      (sp) => sp.productId === testProductId,
    );
    expect(beforeBinding?.webstoreRenderStatus).toBe("failed");

    await caller.stores.retryRender({
      storeId: testStoreId,
      productId: testProductId,
    });

    const after = await caller.stores.getById({ id: testStoreId });
    const afterBinding = after.storeProducts.find(
      (sp) => sp.productId === testProductId,
    );
    expect(afterBinding?.webstoreRenderStatus).toBe("pending");
  });

  // ── retryRender precondition handling (PR followup #18) ────────────────
  // The pre-fix retryRender flipped status to 'pending' and fire-and-forget
  // enqueued, so the toast claimed success even when the predicate silently
  // skipped. New behavior: synchronous result kind, status flip ONLY on
  // queued, PRECONDITION_FAILED on hard blockers, lazy-analyze on no_analysis.

  it("retryRender returns action:'queued' when product is render-ready", async () => {
    // testProductId was stamped in the earlier "enqueues a render" test
    // and the failed→pending test left status='pending'. Either state is a
    // valid input to retry — the queued path is what we're asserting here.
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.stores.retryRender({
      storeId: testStoreId,
      productId: testProductId,
    });
    expect(result.success).toBe(true);
    expect(result.action).toBe("queued");
  });

  it("retryRender returns action:'analyzing' and leaves status untouched when product needs analysis", async () => {
    const db = await getDb();
    if (!db) throw new Error("db unavailable");
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Fresh product with imageUrl but no placement analysis — exercises
    // the no_analysis branch.
    const product = await caller.products.create({
      name: "Needs-Analysis Test Product",
      sku: `SKU-NEEDS-ANALYSIS-${Date.now()}`,
      category: "apparel",
      basePrice: "15.00",
    });
    createdProductIds.push(product.id);
    await db
      .update(products)
      .set({ imageUrl: "https://example.com/needs-analysis.jpg" })
      .where(eq(products.id, product.id));

    // Direct binding insert avoids assignProducts' destructive replace
    // (which would wipe testProductId binding) and skips the lazy-analyze
    // hook that would otherwise call the real Anthropic API.
    await db.insert(storeProducts).values({
      storeId: testStoreId,
      productId: product.id,
      webstoreRenderStatus: "complete", // sentinel to detect unwanted flip
    });

    const result = await caller.stores.retryRender({
      storeId: testStoreId,
      productId: product.id,
    });
    expect(result.success).toBe(true);
    expect(result.action).toBe("analyzing");

    // Status MUST NOT be flipped to 'pending' — the row is not yet ready
    // and the speculative flip is exactly the bug we're fixing.
    const after = await db
      .select({ status: storeProducts.webstoreRenderStatus })
      .from(storeProducts)
      .where(and(
        eq(storeProducts.storeId, testStoreId),
        eq(storeProducts.productId, product.id),
      ));
    expect(after[0]?.status).toBe("complete");
  });

  it("retryRender throws PRECONDITION_FAILED when no client logo is configured", async () => {
    const db = await getDb();
    if (!db) throw new Error("db unavailable");
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Fresh client with NO clientLogos row → orchestrator can't resolve a logo.
    const noLogoClient = await caller.clients.create({
      companyName: "No-Logo Test Client",
      contactName: "No Logo",
      contactEmail: "nologo@test.com",
    });
    createdClientIds.push(noLogoClient.id);

    // status='active' requires a logo, so use 'inactive' for this client.
    const noLogoStore = await caller.stores.create({
      clientId: noLogoClient.id,
      name: "No-Logo Test Store",
      slug: `no-logo-store-${Date.now()}`,
      status: "inactive",
    });
    createdStoreIds.push(noLogoStore.id);

    // Render-ready product (image + analysis stamped) so logo is the only blocker.
    const product = await caller.products.create({
      name: "Ready Product NoLogo",
      sku: `SKU-NOLOGO-${Date.now()}`,
      category: "apparel",
      basePrice: "10.00",
    });
    createdProductIds.push(product.id);
    await db
      .update(products)
      .set({
        imageUrl: "https://example.com/p.jpg",
        webstoreImprintPlacementX: "0.3",
        webstoreImprintPlacementY: "0.2",
        webstoreImprintPlacementWidth: "0.15",
        webstoreImprintPlacementHeight: "0.12",
        webstoreImprintPlacementZone: "left_chest",
        webstoreImprintPlacementAnalyzedAt: new Date(),
      })
      .where(eq(products.id, product.id));
    await db.insert(storeProducts).values({
      storeId: noLogoStore.id,
      productId: product.id,
      webstoreRenderStatus: "failed",
    });

    await expect(
      caller.stores.retryRender({ storeId: noLogoStore.id, productId: product.id }),
    ).rejects.toThrow(/logo/i);

    // Status untouched.
    const after = await db
      .select({ status: storeProducts.webstoreRenderStatus })
      .from(storeProducts)
      .where(and(
        eq(storeProducts.storeId, noLogoStore.id),
        eq(storeProducts.productId, product.id),
      ));
    expect(after[0]?.status).toBe("failed");
  });

  it("retryRender throws PRECONDITION_FAILED when product has no source image", async () => {
    const db = await getDb();
    if (!db) throw new Error("db unavailable");
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Product with no imageUrl. Stamp analysis fields so the orchestrator
    // reaches the no_image check first (no_image is checked before
    // no_analysis in the predicate cascade).
    const product = await caller.products.create({
      name: "No-Image Test Product",
      sku: `SKU-NOIMAGE-${Date.now()}`,
      category: "apparel",
      basePrice: "10.00",
    });
    createdProductIds.push(product.id);
    await db.insert(storeProducts).values({
      storeId: testStoreId,
      productId: product.id,
      webstoreRenderStatus: "failed",
    });

    await expect(
      caller.stores.retryRender({ storeId: testStoreId, productId: product.id }),
    ).rejects.toThrow(/source image/i);

    const after = await db
      .select({ status: storeProducts.webstoreRenderStatus })
      .from(storeProducts)
      .where(and(
        eq(storeProducts.storeId, testStoreId),
        eq(storeProducts.productId, product.id),
      ));
    expect(after[0]?.status).toBe("failed");
  });

  it("getById derives effectiveRenderStatus='awaiting_analysis' for unanalyzed pending row", async () => {
    const db = await getDb();
    if (!db) throw new Error("db unavailable");
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const product = await caller.products.create({
      name: "Awaiting-Analysis Display Product",
      sku: `SKU-AWAIT-${Date.now()}`,
      category: "apparel",
      basePrice: "10.00",
    });
    createdProductIds.push(product.id);
    // Has imageUrl, but no analyzedAt → should display as awaiting_analysis
    // when binding is in 'pending' state.
    await db
      .update(products)
      .set({ imageUrl: "https://example.com/awaiting.jpg" })
      .where(eq(products.id, product.id));
    await db.insert(storeProducts).values({
      storeId: testStoreId,
      productId: product.id,
      webstoreRenderStatus: "pending",
    });

    const result = await caller.stores.getById({ id: testStoreId });
    const row = result.products.find((p: { id: number }) => p.id === product.id);
    expect(row).toBeDefined();
    expect((row as { effectiveRenderStatus?: string }).effectiveRenderStatus)
      .toBe("awaiting_analysis");
    // Raw status still shows the underlying DB value.
    expect((row as { webstoreRenderStatus?: string }).webstoreRenderStatus)
      .toBe("pending");
  });

  it("update modifies store fields", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.update({
      id: testStoreId,
      name: "E2E Test Store Updated",
      status: "inactive",
    });
    expect(result).toBeDefined();
    expect(result.name).toBe("E2E Test Store Updated");
    expect(result.status).toBe("inactive");
  });

  it("create with unique slug succeeds", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.create({
      clientId: testClientId,
      name: "Second Test Store",
      slug: `second-test-store-${Date.now()}`,
    });
    expect(result).toBeDefined();
    createdStoreIds.push(result.id);
  });

  it("list with filter returns filtered results", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.list({ clientId: testClientId });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((s: any) => s.clientId === testClientId)).toBe(true);
  });

  it("delete removes the store", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.stores.delete({ id: testStoreId });
    expect(result.success).toBe(true);
    // Remove from cleanup list since already deleted
    const idx = createdStoreIds.indexOf(testStoreId);
    if (idx >= 0) createdStoreIds.splice(idx, 1);
  });
});

//  Client Assets Tests

describe.skipIf(!_dbAvailable)("client assets", () => {
  let assetClientId: number;

  beforeAll(async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const client = await caller.clients.create({
      companyName: "Asset Test Client",
      contactName: "Carol Assets",
      contactEmail: "carol@assets.com",
    });
    assetClientId = client.id;
    createdClientIds.push(client.id);
  });

  it("listAssets returns empty array for new client", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.listAssets({ clientId: assetClientId });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("uploadAsset requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.clients.uploadAsset({
        clientId: assetClientId,
        fileName: "test.png",
        fileType: "image/png",
        fileSize: 1024,
        category: "logo",
        base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      })
    ).rejects.toThrow();
  });
});
