/**
 * estimatesBuilder.test.ts — dual-write boundary coverage for the
 * unified-canvas Estimate Builder.
 *
 * Invariant under test: for any estimate row, exactly one of
 *   (a) estimates.estLineItems JSON is populated (legacy createFromProposal)
 *   (b) estimateLineItems + estimatePackages rows exist (builder)
 * is the source of truth. Neither path writes the other side.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import {
  clients, products, proposals, proposalProducts,
  estimates, estimatePackages, estimateLineItems,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-estimates-builder",
    email: "builder-test@example.com",
    name: "Builder Test User",
    loginMethod: "email",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    organizationId: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
  return { ctx };
}

// Fixtures. Populated in beforeAll, cleaned up in afterAll.
let testClientId = 0;
let testProductId = 0;
let testProposalId = 0;
const createdEstimateIds: number[] = [];

describe("Estimate Builder — dual-write boundary", () => {
  let dbAvailable = false;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) { console.log("SKIP: DB unavailable"); return; }
    dbAvailable = true;

    const [clientRes] = await db.insert(clients).values({
      userId: 1,
      companyName: `Builder Test Client ${Date.now()}`,
      contactName: "Builder Tester",
      contactEmail: "builder-tester@example.com",
      status: "active",
    });
    testClientId = clientRes.insertId;

    const [productRes] = await db.insert(products).values({
      userId: 1,
      name: "Builder Test Mug",
      category: "drinkware",
      basePrice: "9.99",
      description: "Used by estimatesBuilder.test.ts",
    });
    testProductId = productRes.insertId;

    const [proposalRes] = await db.insert(proposals).values({
      userId: 1,
      clientId: testClientId,
      title: "Builder Test Proposal",
      status: "accepted",
      totalAmount: "99.90",
      validDays: 30,
      deliveryMethod: "email",
    });
    testProposalId = proposalRes.insertId;

    await db.insert(proposalProducts).values({
      proposalId: testProposalId,
      productId: testProductId,
      quantity: 10,
      unitPrice: "9.99",
      totalPrice: "99.90",
    });
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    try {
      for (const id of createdEstimateIds) {
        // ON DELETE CASCADE on estimateLineItems + estimatePackages means
        // the child rows go with the parent.
        await db.delete(estimates).where(eq(estimates.id, id));
      }
      await db.delete(proposalProducts).where(eq(proposalProducts.proposalId, testProposalId));
      await db.delete(proposals).where(eq(proposals.id, testProposalId));
      await db.delete(products).where(eq(products.id, testProductId));
      await db.delete(clients).where(eq(clients.id, testClientId));
    } catch (e) {
      console.warn("Cleanup warning:", e);
    }
  });

  /**
   * Case 1 — builderSave writes relational rows and NULLs the JSON column.
   */
  it("builderSave creates row-data with lineItems JSON = NULL", async () => {
    if (!dbAvailable) return;
    const db = await getDb()!;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const saved = await caller.estimatesInvoices.estimates.builderSave({
      clientId: testClientId,
      notes: "test notes",
      terms: "Net 30",
      lineItems: [
        { description: "Custom hoodie", quantity: 3, unitPrice: 45, sortOrder: 0 },
        { description: "Rush fee",       quantity: 1, unitPrice: 20, sortOrder: 1 },
      ],
    });
    createdEstimateIds.push(saved.estimate.id);

    expect(saved.estimate.status).toBe("draft");
    expect(saved.estimate.clientId).toBe(testClientId);
    expect(saved.estimate.currency).toBe("CAD");
    expect(saved.estimate.subtotal).toBe("155.00"); // 3*45 + 1*20
    expect(saved.estimate.total).toBe("155.00");    // tax=0, shipping=0
    expect(saved.estimate.estimateNumber).toMatch(/^EST-/);
    expect(saved.estimate.lineItems).toBeNull();
    expect(saved.lineItems).toHaveLength(2);
    expect(saved.packages).toHaveLength(0);

    // Direct DB verification — no ambiguity.
    const [row] = await db!.select().from(estimates).where(eq(estimates.id, saved.estimate.id));
    expect(row.lineItems).toBeNull();

    const rows = await db!.select().from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, saved.estimate.id));
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.description).sort()).toEqual(["Custom hoodie", "Rush fee"]);
  });

  /**
   * Case 2 — post-0089 createFromProposal writes the relational tables
   * (one "Default" package + N line items) and leaves the deprecated
   * JSON column null. Asserts the new single-read invariant.
   */
  it("createFromProposal writes relational rows and NULL JSON", async () => {
    if (!dbAvailable) return;
    const db = await getDb()!;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const est = await caller.estimatesInvoices.estimates.createFromProposal({
      proposalId: testProposalId,
      notes: "relational path",
    });
    createdEstimateIds.push(est.id);

    expect(est.lineItems).toBeNull();

    const pkgRows = await db!.select().from(estimatePackages)
      .where(eq(estimatePackages.estimateId, est.id));
    expect(pkgRows).toHaveLength(1);
    expect(pkgRows[0].name).toBe("Default");

    const itemRows = await db!.select().from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, est.id));
    expect(itemRows.length).toBeGreaterThan(0);
    for (const r of itemRows) {
      expect(r.packageId).toBe(pkgRows[0].id);
    }
  });

  /**
   * Case 3 — builderGet on a builder-created estimate returns the rows.
   */
  it("builderGet on a builder-created estimate returns populated arrays", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const saved = await caller.estimatesInvoices.estimates.builderSave({
      clientId: testClientId,
      lineItems: [{ description: "Solo line", quantity: 2, unitPrice: 7, sortOrder: 0 }],
    });
    createdEstimateIds.push(saved.estimate.id);

    const loaded = await caller.estimatesInvoices.estimates.builderGet({ id: saved.estimate.id });
    expect(loaded.estimate.id).toBe(saved.estimate.id);
    expect(loaded.lineItems).toHaveLength(1);
    expect(loaded.lineItems[0].description).toBe("Solo line");
    expect(loaded.packages).toHaveLength(0);
  });

  /**
   * Case 4 — post-0089 builderGet on a createFromProposal estimate
   * returns the relational rows. There's no longer a "legacy" branch:
   * every estimate writes to the relational tables, so both read paths
   * see the same data.
   */
  it("builderGet on a createFromProposal estimate returns relational rows", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const est = await caller.estimatesInvoices.estimates.createFromProposal({
      proposalId: testProposalId,
    });
    createdEstimateIds.push(est.id);

    const loaded = await caller.estimatesInvoices.estimates.builderGet({ id: est.id });
    expect(loaded.estimate.id).toBe(est.id);
    expect(loaded.packages).toHaveLength(1);
    expect(loaded.packages[0].name).toBe("Default");
    expect(loaded.lineItems.length).toBeGreaterThan(0);
    // JSON column is null on every new row.
    expect(loaded.estimate.lineItems).toBeNull();
  });

  /**
   * Case 5 — every new estimate (builder or proposal-derived) leaves the
   * deprecated JSON column null and surfaces items through
   * resolvedLineItems. The JSON column is retained for rollback only.
   */
  it("getById on a new estimate has lineItems = null and populated resolvedLineItems", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const saved = await caller.estimatesInvoices.estimates.builderSave({
      clientId: testClientId,
      lineItems: [{ description: "Boundary check", quantity: 1, unitPrice: 50, sortOrder: 0 }],
    });
    createdEstimateIds.push(saved.estimate.id);

    const read = await caller.estimatesInvoices.estimates.getById({ id: saved.estimate.id });
    expect(read.id).toBe(saved.estimate.id);
    expect(read.lineItems).toBeNull();
    expect(read.resolvedLineItems).toHaveLength(1);
    expect(read.resolvedLineItems[0].productName).toBe("Boundary check");
  });

  /**
   * Case 6 — a line item can reference a brand-new package via
   * clientPackageKey in the same save, and the server resolves it.
   */
  it("clientPackageKey resolves new package reference in the same save", async () => {
    if (!dbAvailable) return;
    const db = await getDb()!;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const saved = await caller.estimatesInvoices.estimates.builderSave({
      clientId: testClientId,
      packages: [
        { clientPackageKey: "pkg-A", name: "Welcome Kit", sortOrder: 0 },
      ],
      lineItems: [
        { clientPackageKey: "pkg-A", description: "Shirt",  quantity: 5, unitPrice: 25, sortOrder: 0 },
        { clientPackageKey: "pkg-A", description: "Sticker", quantity: 5, unitPrice: 1,  sortOrder: 1 },
        {                            description: "Misc",    quantity: 1, unitPrice: 10, sortOrder: 2 },
      ],
    });
    createdEstimateIds.push(saved.estimate.id);

    expect(saved.packages).toHaveLength(1);
    const pkgId = saved.packages[0].id;
    expect(pkgId).toBeGreaterThan(0);

    expect(saved.lineItems).toHaveLength(3);
    const grouped = saved.lineItems.filter(li => li.packageId === pkgId);
    const ungrouped = saved.lineItems.filter(li => li.packageId === null);
    expect(grouped).toHaveLength(2);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0].description).toBe("Misc");

    // Cross-check against DB.
    const dbRows = await db!.select().from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, saved.estimate.id));
    const dbGrouped = dbRows.filter(r => r.packageId === pkgId);
    expect(dbGrouped).toHaveLength(2);
  });

  /**
   * Case 7 — non-draft estimates are rejected by builderSave.
   */
  it("builderSave rejects non-draft status with BAD_REQUEST", async () => {
    if (!dbAvailable) return;
    const db = await getDb()!;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const saved = await caller.estimatesInvoices.estimates.builderSave({
      clientId: testClientId,
      lineItems: [{ description: "Pre-send", quantity: 1, unitPrice: 10, sortOrder: 0 }],
    });
    createdEstimateIds.push(saved.estimate.id);

    // Flip status outside the normal send flow so we don't need SMTP to be
    // configured. The check is on the status value itself.
    await db!.update(estimates).set({ status: "sent" })
      .where(eq(estimates.id, saved.estimate.id));

    await expect(
      caller.estimatesInvoices.estimates.builderSave({
        id: saved.estimate.id,
        lineItems: [{ description: "Post-send edit attempt", quantity: 1, unitPrice: 1, sortOrder: 0 }],
      }),
    ).rejects.toThrow(/Cannot edit an estimate in status "sent"/);
  });
});
