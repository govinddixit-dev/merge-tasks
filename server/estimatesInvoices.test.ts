import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { clients, proposals, proposalProducts, products, orders, orderItems } from "../drizzle/schema";
import { eq } from "drizzle-orm";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-estimates",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "email",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
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

  return { ctx };
}

// Test data IDs
let testClientId: number;
let testProposalId: number;
let testProductId: number;
let testEstimateId: number;
let testInvoiceId: number;

describe("Estimates & Invoices", () => {
  let _dbAvailable = false;
  beforeAll(async () => {
    const db = await getDb();
    if (!db) { console.log("SKIP: DB unavailable"); return; }
    _dbAvailable = true;

    // Create test client
    const [clientResult] = await db.insert(clients).values({
      userId: 1,
      companyName: "Test Estimate Client",
      contactName: "Jane Doe",
      contactEmail: "jane@testclient.com",
      status: "active",
    });
    testClientId = clientResult.insertId;

    // Create test product
    const [productResult] = await db.insert(products).values({
      userId: 1,
      name: "Test T-Shirt",
      category: "apparel",
      basePrice: "25.00",
      description: "A test t-shirt for estimates",
    });
    testProductId = productResult.insertId;

    // Create test proposal (accepted status)
    const [proposalResult] = await db.insert(proposals).values({
      userId: 1,
      clientId: testClientId,
      title: "Test Proposal for Estimates",
      status: "accepted",
      totalAmount: "250.00",
      validDays: 30,
      deliveryMethod: "email",
    });
    testProposalId = proposalResult.insertId;

    // Add a product to the proposal
    await db.insert(proposalProducts).values({
      proposalId: testProposalId,
      productId: testProductId,
      quantity: 10,
      unitPrice: "25.00",
      totalPrice: "250.00",
    });

    // Create an order for this proposal
    const [orderResult] = await db.insert(orders).values({
      userId: 1,
      clientId: testClientId,
      proposalId: testProposalId,
      orderNumber: `ORD-TEST-${Date.now()}`,
      status: "pending",
      subtotal: "250.00",
      total: "250.00",
    });

    await db.insert(orderItems).values({
      orderId: orderResult.insertId,
      productId: testProductId,
      quantity: 10,
      unitPrice: "25.00",
      totalPrice: "250.00",
    });
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;

    // Clean up test data in reverse dependency order
    try {
      if (testInvoiceId) {
        const { invoices } = await import("../drizzle/schema");
        await db.delete(invoices).where(eq(invoices.id, testInvoiceId));
      }
      if (testEstimateId) {
        const { estimates } = await import("../drizzle/schema");
        await db.delete(estimates).where(eq(estimates.id, testEstimateId));
      }
      await db.delete(orderItems).where(eq(orderItems.orderId, testProposalId));
      await db.delete(orders).where(eq(orders.proposalId, testProposalId));
      await db.delete(proposalProducts).where(eq(proposalProducts.proposalId, testProposalId));
      await db.delete(proposals).where(eq(proposals.id, testProposalId));
      await db.delete(products).where(eq(products.id, testProductId));
      await db.delete(clients).where(eq(clients.id, testClientId));
    } catch (e) {
      console.warn("Cleanup warning:", e);
    }
  });

  describe("Estimates", () => {
    it("should create an estimate from an accepted proposal", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.estimates.createFromProposal({
        proposalId: testProposalId,
        notes: "Test estimate notes",
        validDays: 14,
      });

      expect(result).toBeDefined();
      expect(result.estimateNumber).toBeDefined();
      expect(result.estimateNumber).toMatch(/^EST-/);
      testEstimateId = result.id;
    });

    it("should list estimates for the user", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.estimates.list();

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      const found = result.find((e: any) => e.id === testEstimateId);
      expect(found).toBeDefined();
    });

    it("should get estimate by ID", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.estimates.getById({
        id: testEstimateId,
      });

      expect(result).toBeDefined();
      expect(result.id).toBe(testEstimateId);
      expect(result.status).toBe("draft");
      expect(result.notes).toBe("Test estimate notes");
      expect(result.resolvedLineItems).toBeDefined();
      expect(Array.isArray(result.resolvedLineItems)).toBe(true);
    });

    it("should convert estimate to invoice", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.estimates.convertToInvoice({
        estimateId: testEstimateId,
      });

      expect(result).toBeDefined();
      expect(result.invoiceNumber).toBeDefined();
      expect(result.invoiceNumber).toMatch(/^INV-/);
      testInvoiceId = result.id;

      // Verify estimate status changed to "converted"
      const estimate = await caller.estimatesInvoices.estimates.getById({
        id: testEstimateId,
      });
      expect(estimate.status).toBe("converted");
    });
  });

  describe("Invoices", () => {
    it("should list invoices for the user", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.invoices.list();

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      const found = result.find((inv: any) => inv.id === testInvoiceId);
      expect(found).toBeDefined();
    });

    it("should get invoice by ID", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.invoices.getById({
        id: testInvoiceId,
      });

      expect(result).toBeDefined();
      expect(result.id).toBe(testInvoiceId);
      expect(result.status).toBe("draft");
      expect(result.lineItems).toBeDefined();
    });

    it("should update invoice status to sent", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.invoices.updateStatus({
        id: testInvoiceId,
        status: "sent",
      });

      expect(result).toBeDefined();
      expect(result.status).toBe("sent");
    });

    it("should update invoice status to paid with payment info", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.invoices.updateStatus({
        id: testInvoiceId,
        status: "paid",
        paymentMethod: "credit_card",
        paymentReference: "pi_test_123",
      });

      expect(result).toBeDefined();
      expect(result.status).toBe("paid");
      expect(result.paymentMethod).toBe("credit_card");
      expect(result.paymentReference).toBe("pi_test_123");
    });

    it("should create invoice directly from proposal", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.estimatesInvoices.invoices.createFromProposal({
        proposalId: testProposalId,
        notes: "Direct invoice from proposal",
        dueInDays: 30,
      });

      expect(result).toBeDefined();
      expect(result.invoiceNumber).toMatch(/^INV-/);
      expect(result.id).toBeDefined();

      // Clean up this extra invoice
      await caller.estimatesInvoices.invoices.delete({ id: result.id });
    });

    it("should delete an invoice", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // Create a temp invoice to delete
      const tempInvoice = await caller.estimatesInvoices.invoices.createFromProposal({
        proposalId: testProposalId,
        notes: "Temp invoice to delete",
      });

      const result = await caller.estimatesInvoices.invoices.delete({
        id: tempInvoice.id,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Estimates - Delete", () => {
    it("should delete an estimate", async () => {
      if (!_dbAvailable) return; // Skip if DB unavailable
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // Create a temp estimate to delete
      const tempEstimate = await caller.estimatesInvoices.estimates.createFromProposal({
        proposalId: testProposalId,
        notes: "Temp estimate to delete",
      });

      const result = await caller.estimatesInvoices.estimates.delete({
        id: tempEstimate.id,
      });

      expect(result.success).toBe(true);
    });
  });
});

describe("Proposal Variant Configuration", () => {
  let variantProposalId: number;
  let variantProductId: number;
  let variantClientId: number;
  let proposalProductId: number;

  let _dbAvailable = false;
  beforeAll(async () => {
    const db = await getDb();
    if (!db) { console.log("SKIP: DB unavailable"); return; }
    _dbAvailable = true;

    // Create a dedicated client for this describe — the outer
    // describe's afterAll deletes testClientId before this beforeAll
    // runs, so referencing it here would fail the proposals FK.
    const [clientResult] = await db.insert(clients).values({
      userId: 1,
      companyName: "Variant Test Client",
      contactName: "Variant Tester",
      contactEmail: "variant@testclient.com",
      status: "active",
    });
    variantClientId = clientResult.insertId;

    // Create test product
    const [productResult] = await db.insert(products).values({
      userId: 1,
      name: "Variant Test Polo",
      category: "apparel",
      basePrice: "30.00",
    });
    variantProductId = productResult.insertId;

    // Create test proposal
    const [proposalResult] = await db.insert(proposals).values({
      userId: 1,
      clientId: variantClientId,
      title: "Variant Config Test Proposal",
      status: "draft",
      totalAmount: "300.00",
      validDays: 30,
      deliveryMethod: "email",
    });
    variantProposalId = proposalResult.insertId;

    // Add product to proposal
    const [ppResult] = await db.insert(proposalProducts).values({
      proposalId: variantProposalId,
      productId: variantProductId,
      quantity: 10,
      unitPrice: "30.00",
      totalPrice: "300.00",
    });
    proposalProductId = ppResult.insertId;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    try {
      const { proposalProductVariants, proposalPriceTiers } = await import("../drizzle/schema");
      await db.delete(proposalPriceTiers).where(eq(proposalPriceTiers.proposalProductId, proposalProductId));
      await db.delete(proposalProductVariants).where(eq(proposalProductVariants.proposalProductId, proposalProductId));
      await db.delete(proposalProducts).where(eq(proposalProducts.id, proposalProductId));
      await db.delete(proposals).where(eq(proposals.id, variantProposalId));
      await db.delete(products).where(eq(products.id, variantProductId));
      await db.delete(clients).where(eq(clients.id, variantClientId));
    } catch (e) {
      console.warn("Variant cleanup warning:", e);
    }
  });

  it("should save variant configuration for a proposal product", async () => {
    if (!_dbAvailable) return; // Skip if DB unavailable
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.proposals.saveProductCatalogConfig({
      proposalId: variantProposalId,
      proposalProductId: proposalProductId,
      colors: ["Red", "Blue", "Black"],
      sizes: ["S", "M", "L", "XL"],
      priceTiers: [
        { tierType: "quantity", label: "1-9", minQty: 1, maxQty: 9, price: "30.00" },
        { tierType: "quantity", label: "10-49", minQty: 10, maxQty: 49, price: "27.00" },
        { tierType: "quantity", label: "50+", minQty: 50, maxQty: null, price: "24.00" },
        { tierType: "size", label: "S-XL", minQty: null, maxQty: null, price: "30.00" },
        { tierType: "size", label: "2XL-4XL", minQty: null, maxQty: null, price: "33.00" },
      ],
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("should retrieve variant configuration for a proposal product", async () => {
    if (!_dbAvailable) return; // Skip if DB unavailable
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.proposals.getProductCatalogConfig({
      proposalId: variantProposalId,
    });

    expect(result).toBeDefined();
    expect(result.products).toBeDefined();
    expect(Array.isArray(result.products)).toBe(true);
    const productConfig = result.products.find((p: any) => p.proposalProductId === proposalProductId);
    expect(productConfig).toBeDefined();
    expect(productConfig.colors).toHaveLength(3);
    expect(productConfig.sizes).toHaveLength(4);
    expect(productConfig.priceTiers).toHaveLength(5);
    expect(productConfig.colors).toContain("Red");
    expect(productConfig.sizes).toContain("XL");
  });

  it("should update variant configuration (replace)", async () => {
    if (!_dbAvailable) return; // Skip if DB unavailable
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Update with different colors
    await caller.proposals.saveProductCatalogConfig({
      proposalId: variantProposalId,
      proposalProductId: proposalProductId,
      colors: ["Navy", "White"],
      sizes: ["M", "L"],
      priceTiers: [
        { tierType: "quantity", label: "1-24", minQty: 1, maxQty: 24, price: "28.00" },
        { tierType: "quantity", label: "25+", minQty: 25, maxQty: null, price: "22.00" },
      ],
    });

    const result = await caller.proposals.getProductCatalogConfig({
      proposalId: variantProposalId,
    });

    const productConfig = result.products.find((p: any) => p.proposalProductId === proposalProductId);
    expect(productConfig).toBeDefined();
    expect(productConfig.colors).toHaveLength(2);
    expect(productConfig.colors).toContain("Navy");
    expect(productConfig.sizes).toHaveLength(2);
    expect(productConfig.priceTiers).toHaveLength(2);
  });
});
