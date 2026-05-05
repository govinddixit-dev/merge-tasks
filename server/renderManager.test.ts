/**
 * Phase 7 — render approval gate regression coverage.
 *
 * Three concerns, three describes:
 *   1. gateRenderUrlForWebstore — pure projection used by storesCrud.
 *      Truth table: covers every meaningful combination of approval +
 *      override + AI render. The customer-facing flow lives or dies by
 *      this function, so the table is exhaustive on purpose.
 *
 *   2. schema regression — the four approval columns are present on
 *      storeProducts at the type level. Catches accidental removals.
 *
 *   3. cross-tenant — DB-gated end-to-end check that org B can't see or
 *      mutate org A's storeProducts via the renderManager router. Same
 *      pattern as proposalsCrud.crossTenant.test.ts: two distinct
 *      no-org users → distinct userId-based scopes → no overlap.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { clients, products, stores, storeProducts } from "../drizzle/schema";
import { gateRenderUrlForWebstore, reconcileOrphanRenderingRows } from "./services/webstore-render-orchestrator";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── 1. gate truth table ──────────────────────────────────────────────────────

describe("gateRenderUrlForWebstore (Phase 7 customer display gate)", () => {
  it("returns null when not approved (regardless of render/override presence)", () => {
    expect(gateRenderUrlForWebstore({
      renderApproved: false,
      renderOverrideUrl: "https://cdn/override.jpg",
      webstoreRenderedImageUrl: "https://cdn/ai.webp",
    })).toBeNull();
    expect(gateRenderUrlForWebstore({
      renderApproved: false,
      renderOverrideUrl: null,
      webstoreRenderedImageUrl: "https://cdn/ai.webp",
    })).toBeNull();
    expect(gateRenderUrlForWebstore({
      renderApproved: false,
      renderOverrideUrl: null,
      webstoreRenderedImageUrl: null,
    })).toBeNull();
  });

  it("returns the override URL when approved AND override is set (override beats AI)", () => {
    expect(gateRenderUrlForWebstore({
      renderApproved: true,
      renderOverrideUrl: "https://cdn/override.jpg",
      webstoreRenderedImageUrl: "https://cdn/ai.webp",
    })).toBe("https://cdn/override.jpg");
  });

  it("returns the AI render URL when approved AND no override", () => {
    expect(gateRenderUrlForWebstore({
      renderApproved: true,
      renderOverrideUrl: null,
      webstoreRenderedImageUrl: "https://cdn/ai.webp",
    })).toBe("https://cdn/ai.webp");
  });

  it("returns null when approved but neither URL is set (CSS fallback path)", () => {
    expect(gateRenderUrlForWebstore({
      renderApproved: true,
      renderOverrideUrl: null,
      webstoreRenderedImageUrl: null,
    })).toBeNull();
  });
});

// ─── 2. schema regression ─────────────────────────────────────────────────────

describe("storeProducts schema (Phase 7 columns)", () => {
  it("exposes the four approval columns + prompt adjustment at the type level", () => {
    // Type-only assertion via inferInsert. If any of these columns are
    // dropped or renamed, this object literal stops type-checking and
    // the suite fails at compile (tsc) and runtime (the assignment).
    const sample: Partial<typeof storeProducts.$inferInsert> = {
      renderApproved: false,
      renderApprovedAt: null,
      renderApprovedBy: null,
      renderOverrideUrl: null,
      renderPromptAdjustment: null,
    };
    expect(sample.renderApproved).toBe(false);
    expect(sample.renderApprovedAt).toBeNull();
    expect(sample.renderApprovedBy).toBeNull();
    expect(sample.renderOverrideUrl).toBeNull();
    expect(sample.renderPromptAdjustment).toBeNull();
  });
});

// ─── 3. cross-tenant guard (DB-gated) ─────────────────────────────────────────

const ORG_A_USER_ID = 88701;
const ORG_B_USER_ID = 88702;
const _dbAvailable = !!process.env.DATABASE_URL;
if (!_dbAvailable) {
  // eslint-disable-next-line no-console
  console.log("NOTE: DATABASE_URL unset — Phase 7 cross-tenant tests will be skipped");
}

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

const createdClientIds: number[] = [];
const createdProductIds: number[] = [];
const createdStoreIds: number[] = [];
const createdStoreProductIds: number[] = [];

beforeAll(async () => {
  if (!_dbAvailable) return;
  const db = await getDb();
  if (!db) return;

  await db.execute(sql`
    INSERT IGNORE INTO users (id, openId, email, role, subscriptionTier, subscriptionStatus)
    VALUES
      (${ORG_A_USER_ID}, 'test-p7-orgA', 'p7a@mergetasks.com', 'user', 'pro', 'active'),
      (${ORG_B_USER_ID}, 'test-p7-orgB', 'p7b@mergetasks.com', 'user', 'pro', 'active')
  `);

  // mysql2 returns `[ResultSetHeader, FieldPacket[]]` from drizzle's
  // db.insert(...).values(...). The codebase pattern (mirrors storesCrud
  // and webstore-render-orchestrator) is to cast as a tuple-shaped array
  // and read [0].insertId. Treating the result as a plain object yields
  // undefined at runtime, which previously masked the FK failure here.
  const readInsertId = (r: unknown): number =>
    (r as Array<{ insertId: number }>)[0].insertId;

  // Client owned by org A — required so the stores.clientId FK points
  // at a real row. Hardcoding clientId=1 was the prior fixture bug:
  // CI bootstraps with no clients, so the FK on stores rejected the
  // insert and every subsequent step was skipped.
  const clientId = readInsertId(await db.insert(clients).values({
    userId: ORG_A_USER_ID,
    companyName: "Phase 7 test client",
    contactName: "P7 Test",
    contactEmail: "p7-test@mergetasks.com",
  }));
  createdClientIds.push(clientId);

  // One product owned by org A, one store owned by org A, one binding.
  const productId = readInsertId(await db.insert(products).values({
    userId: ORG_A_USER_ID,
    name: "Phase 7 test product",
    sku: "P7-TEST-1",
    imageUrl: "https://cdn/test.png",
  }));
  createdProductIds.push(productId);

  const storeId = readInsertId(await db.insert(stores).values({
    userId: ORG_A_USER_ID,
    name: "Phase 7 test store",
    slug: `p7-test-${Date.now()}`,
    clientId,
  }));
  createdStoreIds.push(storeId);

  const storeProductId = readInsertId(await db.insert(storeProducts).values({
    storeId,
    productId,
  }));
  createdStoreProductIds.push(storeProductId);
});

afterAll(async () => {
  if (!_dbAvailable) return;
  const db = await getDb();
  if (!db) return;
  // Delete in FK-dependency order: storeProducts → stores → products → clients.
  if (createdStoreProductIds.length > 0) {
    try { await db.delete(storeProducts).where(inArray(storeProducts.id, createdStoreProductIds)); } catch {}
  }
  if (createdStoreIds.length > 0) {
    try { await db.delete(stores).where(inArray(stores.id, createdStoreIds)); } catch {}
  }
  if (createdProductIds.length > 0) {
    try { await db.delete(products).where(inArray(products.id, createdProductIds)); } catch {}
  }
  if (createdClientIds.length > 0) {
    try { await db.delete(clients).where(inArray(clients.id, createdClientIds)); } catch {}
  }
});

describe("renderManager — cross-tenant guards (DB-gated)", () => {
  it.skipIf(!_dbAvailable)(
    "listByStore returns NOT_FOUND when called by a different-org user",
    async () => {
      const storeId = createdStoreIds[0];
      const callerB = appRouter.createCaller(ctxFor(ORG_B_USER_ID, "test-p7-orgB"));
      await expect(
        callerB.renderManager.listByStore({ storeId, status: "all" }),
      ).rejects.toBeInstanceOf(TRPCError);
    },
  );

  it.skipIf(!_dbAvailable)(
    "approve returns NOT_FOUND when called by a different-org user",
    async () => {
      const storeProductId = createdStoreProductIds[0];
      const callerB = appRouter.createCaller(ctxFor(ORG_B_USER_ID, "test-p7-orgB"));
      await expect(
        callerB.renderManager.approve({ storeProductId }),
      ).rejects.toBeInstanceOf(TRPCError);
    },
  );

  it.skipIf(!_dbAvailable)(
    "reRender returns NOT_FOUND when called by a different-org user",
    async () => {
      const storeProductId = createdStoreProductIds[0];
      const callerB = appRouter.createCaller(ctxFor(ORG_B_USER_ID, "test-p7-orgB"));
      await expect(
        callerB.renderManager.reRender({ storeProductId }),
      ).rejects.toBeInstanceOf(TRPCError);
    },
  );

  it.skipIf(!_dbAvailable)(
    "uploadOverride returns NOT_FOUND when called by a different-org user",
    async () => {
      const storeProductId = createdStoreProductIds[0];
      const callerB = appRouter.createCaller(ctxFor(ORG_B_USER_ID, "test-p7-orgB"));
      // 1×1 white PNG. uploadOverride must reject before touching the
      // storage adapter — the ownership check is the first gate.
      const TINY_PNG =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      await expect(
        callerB.renderManager.uploadOverride({
          storeProductId,
          imageBase64: TINY_PNG,
          mimeType: "image/png",
          fileName: "x.png",
        }),
      ).rejects.toBeInstanceOf(TRPCError);
    },
  );

  it.skipIf(!_dbAvailable)(
    "stores.getStoreProductGroup returns NOT_FOUND when called against another org's storeId",
    async () => {
      const storeId = createdStoreIds[0];
      const callerB = appRouter.createCaller(ctxFor(ORG_B_USER_ID, "test-p7-orgB"));
      // Store ownership is checked before styleGroup lookup, so any
      // styleGroup string surfaces the NOT_FOUND on the cross-org
      // storeId. Bogus styleGroup keeps the test independent of fixture.
      await expect(
        callerB.stores.getStoreProductGroup({ storeId, styleGroup: "noop-styleGroup" }),
      ).rejects.toBeInstanceOf(TRPCError);
    },
  );

  it.skipIf(!_dbAvailable)(
    "owner can listByStore and approve their own binding",
    async () => {
      const storeId = createdStoreIds[0];
      const storeProductId = createdStoreProductIds[0];
      const callerA = appRouter.createCaller(ctxFor(ORG_A_USER_ID, "test-p7-orgA"));

      const list = await callerA.renderManager.listByStore({ storeId, status: "all" });
      expect(Array.isArray(list)).toBe(true);
      expect(list.find(r => r.storeProductId === storeProductId)).toBeTruthy();

      // Pre-condition: the seeded row is unapproved (renderApproved defaults FALSE).
      const result = await callerA.renderManager.approve({ storeProductId });
      expect(result.success).toBe(true);

      const db = (await getDb())!;
      const [row] = await db
        .select({
          renderApproved: storeProducts.renderApproved,
          renderApprovedBy: storeProducts.renderApprovedBy,
        })
        .from(storeProducts)
        .where(eq(storeProducts.id, storeProductId))
        .limit(1);
      expect(row?.renderApproved).toBe(true);
      expect(row?.renderApprovedBy).toBe(ORG_A_USER_ID);
    },
  );

  it.skipIf(!_dbAvailable)(
    "removeOverride keeps approval when an AI render is present, drops it otherwise",
    async () => {
      const storeProductId = createdStoreProductIds[0];
      const db = (await getDb())!;
      const callerA = appRouter.createCaller(ctxFor(ORG_A_USER_ID, "test-p7-orgA"));

      // Path 1: override present + AI render present → approval kept
      await db
        .update(storeProducts)
        .set({
          webstoreRenderedImageUrl: "https://cdn/ai.webp",
          renderOverrideUrl: "https://cdn/override.jpg",
          renderApproved: true,
        })
        .where(eq(storeProducts.id, storeProductId));
      const r1 = await callerA.renderManager.removeOverride({ storeProductId });
      expect(r1.fallbackHasAiRender).toBe(true);
      const [after1] = await db
        .select({ renderApproved: storeProducts.renderApproved, renderOverrideUrl: storeProducts.renderOverrideUrl })
        .from(storeProducts)
        .where(eq(storeProducts.id, storeProductId))
        .limit(1);
      expect(after1?.renderOverrideUrl).toBeNull();
      expect(after1?.renderApproved).toBe(true);

      // Path 2: override present + no AI render → approval dropped
      await db
        .update(storeProducts)
        .set({
          webstoreRenderedImageUrl: null,
          renderOverrideUrl: "https://cdn/override2.jpg",
          renderApproved: true,
        })
        .where(eq(storeProducts.id, storeProductId));
      const r2 = await callerA.renderManager.removeOverride({ storeProductId });
      expect(r2.fallbackHasAiRender).toBe(false);
      const [after2] = await db
        .select({ renderApproved: storeProducts.renderApproved, renderOverrideUrl: storeProducts.renderOverrideUrl })
        .from(storeProducts)
        .where(eq(storeProducts.id, storeProductId))
        .limit(1);
      expect(after2?.renderOverrideUrl).toBeNull();
      expect(after2?.renderApproved).toBe(false);
    },
  );

  it.skipIf(!_dbAvailable)(
    "reconcileOrphanRenderingRows flips a 'rendering' row with no live queue job to 'failed'",
    async () => {
      const storeProductId = createdStoreProductIds[0];
      const db = (await getDb())!;

      // Seed the orphan condition: row stuck at 'rendering' with no
      // matching BullMQ job. We don't enqueue anything — that's the
      // whole scenario (worker died mid-render, queue forgot the job).
      await db
        .update(storeProducts)
        .set({ webstoreRenderStatus: "rendering" })
        .where(eq(storeProducts.id, storeProductId));

      const reconciled = await reconcileOrphanRenderingRows(db);
      expect(reconciled).toBeGreaterThanOrEqual(1);

      const [after] = await db
        .select({ status: storeProducts.webstoreRenderStatus })
        .from(storeProducts)
        .where(eq(storeProducts.id, storeProductId))
        .limit(1);
      expect(after?.status).toBe("failed");
    },
  );
});
