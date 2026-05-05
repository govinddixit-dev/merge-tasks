/**
 * Phase 8 Followup K-3 — proposalsCrud cross-tenant scope guards.
 *
 * Regression coverage for the leak path discovered during the K-3 audit:
 *   - proposals.create accepted productIds belonging to other tenants
 *   - proposals.update accepted productIds belonging to other tenants
 *   - proposals.list joined products without scope.products, so any
 *     pre-existing cross-tenant proposalProducts row would surface the
 *     foreign product's name/sku in the response
 *
 * Two-org isolation pattern: getOrgScope for a solo distributor (no
 * organizationId) scopes by userId, so two test users with distinct
 * user.id values produce non-overlapping scopes — no need to seed
 * organizations rows. Same pattern as clients-stores.test.ts.
 */

import { getDb } from "./db";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, sql, inArray } from "drizzle-orm";
import { proposals, proposalProducts } from "../drizzle/schema";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function ctxFor(userId: number, openId: string): TrpcContext {
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

const ORG_A_USER_ID = 88001;
const ORG_B_USER_ID = 88002;

const _dbAvailable = !!process.env.DATABASE_URL;
if (!_dbAvailable) console.log("NOTE: DATABASE_URL unset — K-3 cross-tenant tests will be skipped");

const createdProposalIds: number[] = [];
const createdClientIds: { ownerUserId: number; id: number }[] = [];
const createdProductIds: { ownerUserId: number; id: number }[] = [];

beforeAll(async () => {
  if (!_dbAvailable) return;
  const db = await getDb();
  if (!db) return;
  // Seed two distinct test users (FK target for clients.userId / products.userId).
  await db.execute(sql`
    INSERT IGNORE INTO users (id, openId, email, role, subscriptionTier, subscriptionStatus)
    VALUES
      (${ORG_A_USER_ID}, 'test-k3-orgA', 'k3a@mergetasks.com', 'user', 'pro', 'active'),
      (${ORG_B_USER_ID}, 'test-k3-orgB', 'k3b@mergetasks.com', 'user', 'pro', 'active')
  `);
});

afterAll(async () => {
  if (!_dbAvailable) return;
  const db = await getDb();
  if (!db) return;
  // proposalProducts rows cascade via proposals deletion. Manual rows
  // injected for the defense-in-depth test reference proposalIds we own,
  // so deleting our proposals is sufficient.
  if (createdProposalIds.length > 0) {
    try { await db.delete(proposalProducts).where(inArray(proposalProducts.proposalId, createdProposalIds)); } catch {}
    try { await db.delete(proposals).where(inArray(proposals.id, createdProposalIds)); } catch {}
  }
  for (const { ownerUserId, id } of createdProductIds) {
    try {
      const caller = appRouter.createCaller(ctxFor(ownerUserId, ownerUserId === ORG_A_USER_ID ? "test-k3-orgA" : "test-k3-orgB"));
      await caller.products.delete({ id });
    } catch {}
  }
  for (const { ownerUserId, id } of createdClientIds) {
    try {
      const caller = appRouter.createCaller(ctxFor(ownerUserId, ownerUserId === ORG_A_USER_ID ? "test-k3-orgA" : "test-k3-orgB"));
      await caller.clients.delete({ id });
    } catch {}
  }
});

describe.skipIf(!_dbAvailable)("proposalsCrud — cross-tenant scope guards (K-3)", () => {
  let orgAClientId: number;
  let orgAProductId: number;
  let orgBProductId: number;

  beforeAll(async () => {
    const ctxA = ctxFor(ORG_A_USER_ID, "test-k3-orgA");
    const ctxB = ctxFor(ORG_B_USER_ID, "test-k3-orgB");
    const callerA = appRouter.createCaller(ctxA);
    const callerB = appRouter.createCaller(ctxB);

    const clientA = await callerA.clients.create({
      companyName: "K3 Org A Client",
      contactName: "A Contact",
      contactEmail: "a@k3.com",
    });
    orgAClientId = clientA.id;
    createdClientIds.push({ ownerUserId: ORG_A_USER_ID, id: clientA.id });

    const productA = await callerA.products.create({
      name: "K3 Org A Product",
      sku: `K3-A-${Date.now()}`,
      category: "apparel",
      basePrice: "10.00",
    });
    orgAProductId = productA.id;
    createdProductIds.push({ ownerUserId: ORG_A_USER_ID, id: productA.id });

    // Distinct B-side client (not strictly needed since B never creates a
    // proposal, but mirrors the realistic "two real tenants" shape).
    const clientB = await callerB.clients.create({
      companyName: "K3 Org B Client",
      contactName: "B Contact",
      contactEmail: "b@k3.com",
    });
    createdClientIds.push({ ownerUserId: ORG_B_USER_ID, id: clientB.id });

    const productB = await callerB.products.create({
      name: "K3 Org B Secret Product",
      sku: `K3-B-SECRET-${Date.now()}`,
      category: "apparel",
      basePrice: "999.99",
    });
    orgBProductId = productB.id;
    createdProductIds.push({ ownerUserId: ORG_B_USER_ID, id: productB.id });
  });

  it("create rejects a proposal that binds a productId belonging to another tenant", async () => {
    const callerA = appRouter.createCaller(ctxFor(ORG_A_USER_ID, "test-k3-orgA"));

    await expect(
      callerA.proposals.create({
        clientId: orgAClientId,
        title: "Cross-tenant create attempt",
        products: [
          { productId: orgAProductId, quantity: 1, unitPrice: "10.00" },
          { productId: orgBProductId, quantity: 1, unitPrice: "10.00" },
        ],
      }),
    ).rejects.toThrow(new RegExp(`Product not found.*${orgBProductId}`));

    // Side-effect check: nothing should have been written. A proposal row
    // for the cross-tenant attempt should not exist.
    const db = await getDb();
    if (!db) throw new Error("db unavailable");
    const leaked = await db
      .select({ id: proposals.id })
      .from(proposals)
      .where(eq(proposals.title, "Cross-tenant create attempt"));
    expect(leaked.length).toBe(0);
  });

  it("update rejects adding a productId belonging to another tenant", async () => {
    const callerA = appRouter.createCaller(ctxFor(ORG_A_USER_ID, "test-k3-orgA"));

    // Clean proposal first — only orgA-owned products.
    const created = await callerA.proposals.create({
      clientId: orgAClientId,
      title: "K3 update target",
      products: [{ productId: orgAProductId, quantity: 1, unitPrice: "10.00" }],
    });
    createdProposalIds.push(created.id);

    await expect(
      callerA.proposals.update({
        id: created.id,
        products: [
          { productId: orgAProductId, quantity: 2, unitPrice: "10.00" },
          { productId: orgBProductId, quantity: 1, unitPrice: "10.00" },
        ],
      }),
    ).rejects.toThrow(new RegExp(`Product not found.*${orgBProductId}`));

    // Original product binding must still exist (the rejected update must
    // not have run the delete-then-insert transaction).
    const db = await getDb();
    if (!db) throw new Error("db unavailable");
    const stillBound = await db
      .select({ productId: proposalProducts.productId })
      .from(proposalProducts)
      .where(eq(proposalProducts.proposalId, created.id));
    expect(stillBound.map(r => r.productId).sort()).toEqual([orgAProductId]);
  });

  it("list defense-in-depth: pre-existing cross-tenant proposalProducts row does NOT leak foreign name/sku", async () => {
    const db = await getDb();
    if (!db) throw new Error("db unavailable");
    const callerA = appRouter.createCaller(ctxFor(ORG_A_USER_ID, "test-k3-orgA"));

    // Clean orgA proposal with their own product.
    const created = await callerA.proposals.create({
      clientId: orgAClientId,
      title: "K3 defense-in-depth target",
      products: [{ productId: orgAProductId, quantity: 1, unitPrice: "10.00" }],
    });
    createdProposalIds.push(created.id);

    // Simulate the historical bug: a proposalProducts row exists that
    // references orgB's product. With the write-side fix this can't happen
    // via tRPC anymore, but legacy data and direct DB writes can still
    // produce it — the read-side scope filter must keep that row's
    // product details out of the response.
    await db.insert(proposalProducts).values({
      proposalId: created.id,
      productId: orgBProductId,
      quantity: 1,
      unitPrice: "999.99",
      decorationType: null,
      decorationNotes: null,
      imprintZoneId: null,
    });

    const result = await callerA.proposals.list();
    const proposal = result.items.find(p => p.id === created.id);
    expect(proposal).toBeDefined();
    // Both proposalProducts rows surface (the inner join doesn't drop them
    // — productCount reflects raw DB state), but the row whose underlying
    // product is out-of-scope MUST resolve to "Unknown" / empty sku.
    expect(proposal!.productCount).toBe(2);
    const foreignRow = proposal!.products.find(p => p.price === 999.99);
    expect(foreignRow).toBeDefined();
    expect(foreignRow!.name).toBe("Unknown");
    expect(foreignRow!.sku).toBe("");
    // The orgA-owned row should still resolve normally.
    const ownRow = proposal!.products.find(p => p.price === 10.0);
    expect(ownRow).toBeDefined();
    expect(ownRow!.name).toBe("K3 Org A Product");
  });
});

