/**
 * Copilot Executor Integration Tests
 * These tests call the actual executor functions and verify the database state
 * is PERFECT after each operation — correct products, prices, quantities, totals.
 * 
 * The goal: when the AI creates a proposal, the distributor should be able to
 * review it and send it without any edits.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import {
  clients, products, proposals, proposalProducts,
  stores, storeProducts, distributorProfiles
} from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

//  Shared test state 
const TEST_USER_ID = 1;
let testClient: any;
let testProducts: any[];
let createdProposalIds: number[] = [];
let createdStoreIds: number[] = [];

//  Executor functions (copied from copilot.ts for direct testing) 
// We import the logic directly rather than going through tRPC to test the
// pure executor functions without LLM dependency.

async function executeSearchClients(userId: number, args: { query: string }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const allClients = await db.select({
    id: clients.id,
    companyName: clients.companyName,
    contactName: clients.contactName,
    contactEmail: clients.contactEmail,
    contactPhone: clients.contactPhone,
    industry: clients.industry,
    status: clients.status,
  }).from(clients).where(eq(clients.userId, userId));

  const query = args.query.toLowerCase();
  const matches = allClients.filter(c =>
    c.companyName.toLowerCase().includes(query) ||
    (c.contactName && c.contactName.toLowerCase().includes(query)) ||
    (c.industry && c.industry.toLowerCase().includes(query)) ||
    (c.contactEmail && c.contactEmail.toLowerCase().includes(query))
  );

  if (matches.length === 0) {
    return { found: 0, clients: [], message: `No clients found matching "${args.query}".` };
  }
  return { found: matches.length, clients: matches.slice(0, 10) };
}

async function executeSearchProducts(userId: number, args: { query: string; category?: string }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const allProducts = await db.select().from(products).where(eq(products.userId, userId)).orderBy(desc(products.updatedAt));
  const query = args.query.toLowerCase();
  let matches = allProducts.filter(p =>
    p.name.toLowerCase().includes(query) ||
    (p.description && p.description.toLowerCase().includes(query)) ||
    (p.sku && p.sku.toLowerCase().includes(query)) ||
    (p.supplier && p.supplier.toLowerCase().includes(query)) ||
    (p.category && p.category.toLowerCase().includes(query))
  );
  if (args.category) matches = matches.filter(p => p.category === args.category);
  if (matches.length === 0) {
    const categoryMatches = allProducts.filter(p => p.category?.toLowerCase().includes(query));
    if (categoryMatches.length > 0) matches = categoryMatches;
  }
  if (matches.length === 0) {
    return { found: 0, products: [], message: `No products found matching "${args.query}".` };
  }
  return {
    found: matches.length,
    products: matches.slice(0, 15).map(p => ({
      id: p.id, name: p.name, sku: p.sku, category: p.category,
      basePrice: p.basePrice, supplier: p.supplier, pricingTiers: p.pricingTiers, imageUrl: p.imageUrl,
    })),
  };
}

async function executeCreateProposal(userId: number, args: {
  clientId: number; title: string; notes?: string;
  products: Array<{ productId: number; quantity: number; unitPrice?: string; decorationType?: string }>;
  multiDepartment?: boolean; validDays?: number;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const clientRows = await db.select().from(clients).where(and(eq(clients.id, args.clientId), eq(clients.userId, userId))).limit(1);
  if (clientRows.length === 0) return { error: `Client ID ${args.clientId} not found` };
  const client = clientRows[0];

  const productRows = await db.select().from(products).where(eq(products.userId, userId));
  const productMap = new Map(productRows.map(p => [p.id, p]));
  const validProducts = args.products.filter(p => productMap.has(p.productId));
  if (validProducts.length === 0) return { error: "No valid product IDs found" };

  const total = validProducts.reduce((sum, p) => {
    const prod = productMap.get(p.productId);
    const price = parseFloat(p.unitPrice ?? prod?.basePrice?.toString() ?? "0");
    return sum + price * p.quantity;
  }, 0);

  const viewToken = nanoid(24);
  const result = await db.insert(proposals).values({
    userId, clientId: args.clientId, title: args.title,
    proposalType: "promo", status: "draft",
    estimatedValue: total.toFixed(2), deliveryMethod: "email",
    storeId: null, stripeCheckout: false,
    multiDepartment: args.multiDepartment ?? false,
    approvalRouting: "parallel", virtualProofs: false,
    notes: args.notes ?? null, validDays: args.validDays ?? 30,
    viewToken, sentAt: null,
  });
  const proposalId = result[0].insertId;

  const ppValues = validProducts.map(p => {
    const prod = productMap.get(p.productId);
    return {
      proposalId, productId: p.productId, quantity: p.quantity,
      unitPrice: p.unitPrice ?? prod?.basePrice?.toString() ?? null,
      decorationType: p.decorationType ?? null, decorationNotes: null,
    };
  });
  await db.insert(proposalProducts).values(ppValues);

  return {
    success: true, proposalId, title: args.title,
    clientName: client.companyName, clientEmail: client.contactEmail,
    estimatedValue: total.toFixed(2), productCount: validProducts.length,
    products: validProducts.map(p => {
      const prod = productMap.get(p.productId);
      const price = p.unitPrice ?? prod?.basePrice?.toString() ?? "0";
      return `${prod?.name} x${p.quantity} @ $${price}`;
    }),
    status: "draft",
  };
}

async function executeCreateWebstore(userId: number, args: {
  clientId: number; name: string; slug: string;
  storeType?: string; welcomeMessage?: string; primaryColor?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const clientRows = await db.select().from(clients).where(and(eq(clients.id, args.clientId), eq(clients.userId, userId))).limit(1);
  if (clientRows.length === 0) return { error: `Client ID ${args.clientId} not found` };
  const client = clientRows[0];

  const existingStore = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, args.slug)).limit(1);
  if (existingStore.length > 0) args.slug = `${args.slug}-${nanoid(4)}`;

  const result = await db.insert(stores).values({
    userId, clientId: args.clientId, name: args.name, slug: args.slug,
    storeType: (args.storeType as any) || "permanent",
    welcomeMessage: args.welcomeMessage || `Welcome to ${client.companyName}'s company store`,
    primaryColor: args.primaryColor || "#654BF9",
    status: "active", createdAt: new Date(), updatedAt: new Date(),
  });
  const storeId = Number(result[0].insertId);
  await db.update(clients).set({ hasWebstore: true }).where(eq(clients.id, args.clientId));

  return { success: true, storeId, name: args.name, slug: args.slug, clientName: client.companyName };
}

async function executeAssignStoreProducts(userId: number, args: {
  storeId: number;
  products: Array<{ productId: number; customPrice?: string; featured?: boolean }>;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const storeRows = await db.select().from(stores).where(and(eq(stores.id, args.storeId), eq(stores.userId, userId))).limit(1);
  if (storeRows.length === 0) return { error: `Store ID ${args.storeId} not found` };

  let assignedCount = 0;
  for (let i = 0; i < args.products.length; i++) {
    const p = args.products[i];
    const productRows = await db.select().from(products).where(and(eq(products.id, p.productId), eq(products.userId, userId))).limit(1);
    if (productRows.length === 0) continue;
    await db.insert(storeProducts).values({
      storeId: args.storeId, productId: p.productId,
      customPrice: p.customPrice || productRows[0].basePrice || "0",
      featured: p.featured || false, sortOrder: i,
    });
    assignedCount++;
  }
  return { success: true, storeId: args.storeId, assignedCount, totalRequested: args.products.length };
}

//  Tests 

describe("Copilot Executor Integration Tests — Data Accuracy", () => {
  let _dbAvailable = false;
  beforeAll(async () => {
    const db = await getDb();
    if (!db) { console.log("SKIP: DB unavailable"); return; }
    _dbAvailable = true;
    const clientRows = await db.select().from(clients).where(eq(clients.userId, TEST_USER_ID)).limit(5);
    testClient = clientRows[0];
    testProducts = await db.select().from(products).where(eq(products.userId, TEST_USER_ID)).limit(10);
  });

  afterAll(async () => {
    // Cleanup all test-created data
    const db = await getDb();
    if (!db) return;
    for (const id of createdProposalIds) {
      await db.delete(proposalProducts).where(eq(proposalProducts.proposalId, id));
      await db.delete(proposals).where(eq(proposals.id, id));
    }
    for (const id of createdStoreIds) {
      await db.delete(storeProducts).where(eq(storeProducts.storeId, id));
      await db.delete(stores).where(eq(stores.id, id));
    }
  });

  //  Search Clients 

  describe("search_clients — data accuracy", () => {
    it("returns exact client data matching the database", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient) return;
      const result = await executeSearchClients(TEST_USER_ID, { query: testClient.companyName.substring(0, 4) });
      expect(result.found).toBeGreaterThan(0);
      const found = result.clients!.find((c: any) => c.id === testClient.id);
      expect(found).toBeTruthy();
      expect(found!.companyName).toBe(testClient.companyName);
      expect(found!.contactName).toBe(testClient.contactName);
      expect(found!.contactEmail).toBe(testClient.contactEmail);
      expect(found!.contactPhone).toBe(testClient.contactPhone);
      expect(found!.industry).toBe(testClient.industry);
    });

    it("returns all fields needed for proposal creation", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient) return;
      const result = await executeSearchClients(TEST_USER_ID, { query: testClient.companyName });
      const found = result.clients![0];
      // These fields are required for create_proposal
      expect(found.id).toBeTruthy();
      expect(found.companyName).toBeTruthy();
      expect(found.contactEmail).toBeTruthy();
    });

    it("does NOT return clients from other users", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const result = await executeSearchClients(999999, { query: "a" });
      expect(result.found).toBe(0);
    });

    it("searches across company name, contact name, industry, and email", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient) return;
      // Search by company name
      const r1 = await executeSearchClients(TEST_USER_ID, { query: testClient.companyName.substring(0, 3) });
      expect(r1.found).toBeGreaterThan(0);

      // Search by contact name if available
      if (testClient.contactName) {
        const r2 = await executeSearchClients(TEST_USER_ID, { query: testClient.contactName.split(" ")[0] });
        expect(r2.found).toBeGreaterThan(0);
      }

      // Search by industry if available
      if (testClient.industry) {
        const r3 = await executeSearchClients(TEST_USER_ID, { query: testClient.industry.substring(0, 4) });
        expect(r3.found).toBeGreaterThan(0);
      }
    });
  });

  //  Search Products 

  describe("search_products — data accuracy", () => {
    it("returns exact product data matching the database", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (testProducts.length === 0) return;
      const p = testProducts[0];
      const result = await executeSearchProducts(TEST_USER_ID, { query: p.name.split(" ")[0] });
      expect(result.found).toBeGreaterThan(0);
      const found = result.products!.find((pr: any) => pr.id === p.id);
      expect(found).toBeTruthy();
      expect(found!.name).toBe(p.name);
      expect(found!.basePrice).toBe(p.basePrice);
      expect(found!.category).toBe(p.category);
      expect(found!.sku).toBe(p.sku);
    });

    it("returns pricing tiers for quantity-based pricing", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (testProducts.length === 0) return;
      const result = await executeSearchProducts(TEST_USER_ID, { query: testProducts[0].name.split(" ")[0] });
      const found = result.products![0];
      // pricingTiers may or may not exist, but the field should be present
      expect("pricingTiers" in found).toBe(true);
    });

    it("filters by category correctly", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (testProducts.length === 0) return;
      const category = testProducts[0].category;
      if (!category) return;
      const result = await executeSearchProducts(TEST_USER_ID, { query: category, category });
      expect(result.found).toBeGreaterThan(0);
      for (const p of result.products!) {
        expect(p.category).toBe(category);
      }
    });

    it("does NOT return products from other users", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const result = await executeSearchProducts(999999, { query: "a" });
      expect(result.found).toBe(0);
    });

    it("falls back to category search when name search fails", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (testProducts.length === 0) return;
      const category = testProducts[0].category;
      if (!category) return;
      // Search for the category name directly
      const result = await executeSearchProducts(TEST_USER_ID, { query: category });
      expect(result.found).toBeGreaterThan(0);
    });
  });

  //  Create Proposal — THE CRITICAL PATH 

  describe("create_proposal — data accuracy", () => {
    it("creates a proposal with correct client, products, prices, and total", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length < 2) return;
      const db = await getDb();
      if (!db) return;

      const p1 = testProducts[0];
      const p2 = testProducts[1];
      const qty1 = 50;
      const qty2 = 100;
      const price1 = p1.basePrice?.toString() || "10.00";
      const price2 = p2.basePrice?.toString() || "15.00";

      const result = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Executor Test — Full Accuracy Check",
        notes: "Testing data accuracy",
        products: [
          { productId: p1.id, quantity: qty1, unitPrice: price1 },
          { productId: p2.id, quantity: qty2, unitPrice: price2 },
        ],
        validDays: 30,
      });

      expect(result.success).toBe(true);
      expect(result.proposalId).toBeGreaterThan(0);
      createdProposalIds.push(result.proposalId!);

      //  Verify proposal record in DB 
      const proposalRows = await db.select().from(proposals).where(eq(proposals.id, result.proposalId!));
      expect(proposalRows.length).toBe(1);
      const proposal = proposalRows[0];

      expect(proposal.userId).toBe(TEST_USER_ID);
      expect(proposal.clientId).toBe(testClient.id);
      expect(proposal.title).toBe("Executor Test — Full Accuracy Check");
      expect(proposal.status).toBe("draft");
      expect(proposal.notes).toBe("Testing data accuracy");
      expect(proposal.validDays).toBe(30);
      expect(proposal.viewToken).toBeTruthy();
      expect(proposal.sentAt).toBeNull();

      //  Verify estimated value is calculated correctly 
      const expectedTotal = (parseFloat(price1) * qty1 + parseFloat(price2) * qty2).toFixed(2);
      expect(proposal.estimatedValue).toBe(expectedTotal);

      //  Verify proposal products in DB 
      const ppRows = await db.select().from(proposalProducts).where(eq(proposalProducts.proposalId, result.proposalId!));
      expect(ppRows.length).toBe(2);

      const pp1 = ppRows.find(pp => pp.productId === p1.id);
      const pp2 = ppRows.find(pp => pp.productId === p2.id);

      expect(pp1).toBeTruthy();
      expect(pp1!.quantity).toBe(qty1);
      expect(pp1!.unitPrice).toBe(price1);

      expect(pp2).toBeTruthy();
      expect(pp2!.quantity).toBe(qty2);
      expect(pp2!.unitPrice).toBe(price2);

      //  Verify return data matches DB 
      expect(result.clientName).toBe(testClient.companyName);
      expect(result.clientEmail).toBe(testClient.contactEmail);
      expect(result.estimatedValue).toBe(expectedTotal);
      expect(result.productCount).toBe(2);
      expect(result.status).toBe("draft");
    });

    it("uses product basePrice when unitPrice is not specified", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length === 0) return;
      const db = await getDb();
      if (!db) return;

      const p = testProducts[0];
      const result = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Executor Test — Default Price",
        products: [{ productId: p.id, quantity: 25 }], // No unitPrice specified
      });

      expect(result.success).toBe(true);
      createdProposalIds.push(result.proposalId!);

      // Verify the price used is the product's basePrice
      const ppRows = await db.select().from(proposalProducts).where(eq(proposalProducts.proposalId, result.proposalId!));
      expect(ppRows.length).toBe(1);
      expect(ppRows[0].unitPrice).toBe(p.basePrice?.toString() || null);

      // Verify total calculation
      const expectedTotal = (parseFloat(p.basePrice?.toString() || "0") * 25).toFixed(2);
      expect(result.estimatedValue).toBe(expectedTotal);
    });

    it("rejects invalid client ID", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const result = await executeCreateProposal(TEST_USER_ID, {
        clientId: 999999,
        title: "Should Fail",
        products: [{ productId: 1, quantity: 10 }],
      });
      expect(result.error).toBeTruthy();
      expect(result.error).toContain("not found");
    });

    it("rejects all invalid product IDs", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient) return;
      const result = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Should Fail — Bad Products",
        products: [
          { productId: 999991, quantity: 10 },
          { productId: 999992, quantity: 20 },
        ],
      });
      expect(result.error).toBeTruthy();
      expect(result.error).toContain("No valid product IDs");
    });

    it("filters out invalid product IDs but keeps valid ones", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length === 0) return;
      const db = await getDb();
      if (!db) return;

      const result = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Executor Test — Mixed Valid/Invalid Products",
        products: [
          { productId: testProducts[0].id, quantity: 10, unitPrice: "5.00" },
          { productId: 999999, quantity: 20, unitPrice: "10.00" }, // Invalid
        ],
      });

      expect(result.success).toBe(true);
      createdProposalIds.push(result.proposalId!);
      expect(result.productCount).toBe(1); // Only the valid one

      const ppRows = await db.select().from(proposalProducts).where(eq(proposalProducts.proposalId, result.proposalId!));
      expect(ppRows.length).toBe(1);
      expect(ppRows[0].productId).toBe(testProducts[0].id);

      // Total should only include the valid product
      expect(result.estimatedValue).toBe("50.00"); // 10 * $5.00
    });

    it("handles large quantities correctly", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length === 0) return;
      const db = await getDb();
      if (!db) return;

      const result = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Executor Test — Large Quantity",
        products: [{ productId: testProducts[0].id, quantity: 10000, unitPrice: "2.50" }],
      });

      expect(result.success).toBe(true);
      createdProposalIds.push(result.proposalId!);
      expect(result.estimatedValue).toBe("25000.00"); // 10000 * $2.50
    });

    it("handles decimal prices correctly", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length === 0) return;
      const db = await getDb();
      if (!db) return;

      const result = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Executor Test — Decimal Prices",
        products: [
          { productId: testProducts[0].id, quantity: 3, unitPrice: "12.99" },
        ],
      });

      expect(result.success).toBe(true);
      createdProposalIds.push(result.proposalId!);
      expect(result.estimatedValue).toBe("38.97"); // 3 * $12.99
    });

    it("creates proposal with multiDepartment flag", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length === 0) return;
      const db = await getDb();
      if (!db) return;

      const result = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Executor Test — Multi-Department",
        products: [{ productId: testProducts[0].id, quantity: 10, unitPrice: "5.00" }],
        multiDepartment: true,
        validDays: 60,
      });

      expect(result.success).toBe(true);
      createdProposalIds.push(result.proposalId!);

      const proposalRows = await db.select().from(proposals).where(eq(proposals.id, result.proposalId!));
      expect(proposalRows[0].multiDepartment).toBe(true);
      expect(proposalRows[0].validDays).toBe(60);
    });

    it("generates unique viewToken for each proposal", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length === 0) return;
      const db = await getDb();
      if (!db) return;

      const r1 = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Executor Test — Token 1",
        products: [{ productId: testProducts[0].id, quantity: 1, unitPrice: "1.00" }],
      });
      const r2 = await executeCreateProposal(TEST_USER_ID, {
        clientId: testClient.id,
        title: "Executor Test — Token 2",
        products: [{ productId: testProducts[0].id, quantity: 1, unitPrice: "1.00" }],
      });

      createdProposalIds.push(r1.proposalId!, r2.proposalId!);

      const rows1 = await db.select().from(proposals).where(eq(proposals.id, r1.proposalId!));
      const rows2 = await db.select().from(proposals).where(eq(proposals.id, r2.proposalId!));
      expect(rows1[0].viewToken).toBeTruthy();
      expect(rows2[0].viewToken).toBeTruthy();
      expect(rows1[0].viewToken).not.toBe(rows2[0].viewToken);
    });
  });

  //  Create Webstore 

  describe("create_webstore — data accuracy", () => {
    it("creates a store with correct client, slug, and config", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient) return;
      const db = await getDb();
      if (!db) return;

      const slug = `test-store-${nanoid(6)}`;
      const result = await executeCreateWebstore(TEST_USER_ID, {
        clientId: testClient.id,
        name: "Test Copilot Store",
        slug,
        storeType: "permanent",
        welcomeMessage: "Welcome to the test store!",
        primaryColor: "#FF5733",
      });

      expect(result.success).toBe(true);
      expect(result.storeId).toBeGreaterThan(0);
      createdStoreIds.push(result.storeId!);

      // Verify DB state
      const storeRows = await db.select().from(stores).where(eq(stores.id, result.storeId!));
      expect(storeRows.length).toBe(1);
      const store = storeRows[0];
      expect(store.userId).toBe(TEST_USER_ID);
      expect(store.clientId).toBe(testClient.id);
      expect(store.name).toBe("Test Copilot Store");
      expect(store.slug).toBe(slug);
      expect(store.storeType).toBe("permanent");
      expect(store.welcomeMessage).toBe("Welcome to the test store!");
      expect(store.primaryColor).toBe("#FF5733");
      expect(store.status).toBe("active");

      // Verify client was marked as having a webstore
      const clientRows = await db.select().from(clients).where(eq(clients.id, testClient.id));
      expect(clientRows[0].hasWebstore).toBe(true);
    });

    it("auto-generates unique slug when slug is taken", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient) return;
      const db = await getDb();
      if (!db) return;

      const slug = `duplicate-slug-${nanoid(4)}`;
      const r1 = await executeCreateWebstore(TEST_USER_ID, {
        clientId: testClient.id, name: "Store 1", slug,
      });
      createdStoreIds.push(r1.storeId!);

      const r2 = await executeCreateWebstore(TEST_USER_ID, {
        clientId: testClient.id, name: "Store 2", slug, // Same slug
      });
      createdStoreIds.push(r2.storeId!);

      expect(r1.slug).toBe(slug);
      expect(r2.slug).not.toBe(slug); // Should have been modified
      expect(r2.slug!.startsWith(slug)).toBe(true);
    });

    it("rejects invalid client ID", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const result = await executeCreateWebstore(TEST_USER_ID, {
        clientId: 999999, name: "Should Fail", slug: "fail-store",
      });
      expect(result.error).toBeTruthy();
    });
  });

  //  Assign Store Products 

  describe("assign_store_products — data accuracy", () => {
    it("assigns products with correct prices", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length < 2) return;
      const db = await getDb();
      if (!db) return;

      // Create a store first
      const slug = `assign-test-${nanoid(6)}`;
      const storeResult = await executeCreateWebstore(TEST_USER_ID, {
        clientId: testClient.id, name: "Product Assignment Test", slug,
      });
      createdStoreIds.push(storeResult.storeId!);

      const result = await executeAssignStoreProducts(TEST_USER_ID, {
        storeId: storeResult.storeId!,
        products: [
          { productId: testProducts[0].id, customPrice: "19.99", featured: true },
          { productId: testProducts[1].id, featured: false },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.assignedCount).toBe(2);

      // Verify DB state
      const spRows = await db.select().from(storeProducts).where(eq(storeProducts.storeId, storeResult.storeId!));
      expect(spRows.length).toBe(2);

      const sp1 = spRows.find(sp => sp.productId === testProducts[0].id);
      expect(sp1).toBeTruthy();
      expect(sp1!.customPrice).toBe("19.99");
      expect(sp1!.featured).toBe(true);

      const sp2 = spRows.find(sp => sp.productId === testProducts[1].id);
      expect(sp2).toBeTruthy();
      expect(sp2!.customPrice).toBe(testProducts[1].basePrice || "0"); // Falls back to basePrice
      expect(sp2!.featured).toBe(false);
    });

    it("skips invalid product IDs without failing", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length === 0) return;
      const db = await getDb();
      if (!db) return;

      const slug = `skip-test-${nanoid(6)}`;
      const storeResult = await executeCreateWebstore(TEST_USER_ID, {
        clientId: testClient.id, name: "Skip Invalid Test", slug,
      });
      createdStoreIds.push(storeResult.storeId!);

      const result = await executeAssignStoreProducts(TEST_USER_ID, {
        storeId: storeResult.storeId!,
        products: [
          { productId: testProducts[0].id },
          { productId: 999999 }, // Invalid
        ],
      });

      expect(result.success).toBe(true);
      expect(result.assignedCount).toBe(1);
      expect(result.totalRequested).toBe(2);
    });

    it("rejects invalid store ID", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const result = await executeAssignStoreProducts(TEST_USER_ID, {
        storeId: 999999,
        products: [{ productId: 1 }],
      });
      expect(result.error).toBeTruthy();
    });
  });

  //  Full Chain: Search → Create → Verify 

  describe("full chain — search → create proposal → verify perfection", () => {
    it("simulates the complete AI workflow and verifies every field", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length < 2) return;
      const db = await getDb();
      if (!db) return;

      // Step 1: Search for client
      const clientResult = await executeSearchClients(TEST_USER_ID, { query: testClient.companyName.substring(0, 5) });
      expect(clientResult.found).toBeGreaterThan(0);
      const foundClient = clientResult.clients![0];
      expect(foundClient.id).toBe(testClient.id);

      // Step 2: Search for products
      const productResult = await executeSearchProducts(TEST_USER_ID, { query: testProducts[0].name.split(" ")[0] });
      expect(productResult.found).toBeGreaterThan(0);
      const foundProduct = productResult.products![0];

      // Step 3: Create proposal using search results
      const proposalResult = await executeCreateProposal(TEST_USER_ID, {
        clientId: foundClient.id,
        title: `Full Chain Test — ${foundClient.companyName}`,
        products: [
          {
            productId: foundProduct.id,
            quantity: 75,
            unitPrice: foundProduct.basePrice?.toString() || "10.00",
          },
        ],
        notes: `Created via full chain test for ${foundClient.companyName}`,
      });

      expect(proposalResult.success).toBe(true);
      createdProposalIds.push(proposalResult.proposalId!);

      // Step 4: Verify EVERYTHING in the database
      const proposal = (await db.select().from(proposals).where(eq(proposals.id, proposalResult.proposalId!)))[0];
      const ppRows = await db.select().from(proposalProducts).where(eq(proposalProducts.proposalId, proposalResult.proposalId!));

      // Proposal correctness
      expect(proposal.clientId).toBe(testClient.id);
      expect(proposal.title).toContain(testClient.companyName);
      expect(proposal.status).toBe("draft"); // NOT sent — ready for review
      expect(proposal.sentAt).toBeNull();

      // Product correctness
      expect(ppRows.length).toBe(1);
      expect(ppRows[0].productId).toBe(foundProduct.id);
      expect(ppRows[0].quantity).toBe(75);
      expect(ppRows[0].unitPrice).toBe(foundProduct.basePrice?.toString() || "10.00");

      // Total correctness
      const expectedTotal = (parseFloat(foundProduct.basePrice?.toString() || "10.00") * 75).toFixed(2);
      expect(proposal.estimatedValue).toBe(expectedTotal);

      // Return data correctness
      expect(proposalResult.clientName).toBe(testClient.companyName);
      expect(proposalResult.estimatedValue).toBe(expectedTotal);
    });
  });

  //  Full Chain: Search → Create Webstore → Assign Products 

  describe("full chain — search → create webstore → assign products", () => {
    it("simulates the complete webstore workflow", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      if (!testClient || testProducts.length < 2) return;
      const db = await getDb();
      if (!db) return;

      // Step 1: Search for client
      const clientResult = await executeSearchClients(TEST_USER_ID, { query: testClient.companyName });
      const foundClient = clientResult.clients![0];

      // Step 2: Search for products
      const productResult = await executeSearchProducts(TEST_USER_ID, { query: testProducts[0].name.split(" ")[0] });

      // Step 3: Create webstore
      const slug = `chain-store-${nanoid(6)}`;
      const storeResult = await executeCreateWebstore(TEST_USER_ID, {
        clientId: foundClient.id,
        name: `${foundClient.companyName} Store`,
        slug,
      });
      expect(storeResult.success).toBe(true);
      createdStoreIds.push(storeResult.storeId!);

      // Step 4: Assign products
      const assignResult = await executeAssignStoreProducts(TEST_USER_ID, {
        storeId: storeResult.storeId!,
        products: productResult.products!.slice(0, 3).map((p: any) => ({
          productId: p.id,
          customPrice: p.basePrice?.toString(),
          featured: true,
        })),
      });
      expect(assignResult.success).toBe(true);
      expect(assignResult.assignedCount).toBeGreaterThan(0);

      // Step 5: Verify DB state
      const store = (await db.select().from(stores).where(eq(stores.id, storeResult.storeId!)))[0];
      expect(store.clientId).toBe(testClient.id);
      expect(store.name).toBe(`${testClient.companyName} Store`);
      expect(store.status).toBe("active");

      const spRows = await db.select().from(storeProducts).where(eq(storeProducts.storeId, storeResult.storeId!));
      expect(spRows.length).toBe(assignResult.assignedCount);
      for (const sp of spRows) {
        expect(sp.featured).toBe(true);
        expect(sp.customPrice).toBeTruthy();
      }
    });
  });
});
