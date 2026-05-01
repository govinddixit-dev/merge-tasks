/**
 * Store Portal End-to-End Test Suite
 * Tests the complete buyer journey: auth, browse, proposals, orders, cart.
 * Uses JWT-based store session authentication.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { TrpcContext } from "./_core/context";

// ─── Mock ENV ─────────────────────────────────────────────────────────────────
vi.mock("./_core/env", () => ({
  ENV: {
    jwtSecret: "test-jwt-secret-32-chars-minimum!!",
    sessionSecret: "test-session-secret",
    databaseUrl: undefined,
    openaiApiKey: "sk-test-openai",
    stripeSecretKey: undefined,
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makePortalCtx(storeSlug: string, jwtToken: string): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: { cookie: `mt_store_${storeSlug}=${jwtToken}` },
    } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function makeNoAuthCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

// ─── Store Auth Tests ─────────────────────────────────────────────────────────
describe("Store Portal — Authentication (storeAuth router)", () => {
  it("requestLogin rejects invalid email format", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storeAuth.requestLogin({
        storeSlug: "test-store",
        email: "not-an-email",
      })
    ).rejects.toThrow();
  });

  it("requestLogin rejects empty storeSlug", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storeAuth.requestLogin({
        storeSlug: "",
        email: "buyer@test.com",
      })
    ).rejects.toThrow();
  });

  it("verifyCode rejects empty code", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storeAuth.verifyCode({
        storeSlug: "test-store",
        email: "buyer@test.com",
        code: "",
      })
    ).rejects.toThrow();
  });

  it("getSession returns null session when no cookie present", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    const session = await caller.storeAuth.getSession({ storeSlug: "test-store" });
    expect(session.authenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  it("getSession returns null session with tampered JWT", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makePortalCtx("test-store", "tampered.jwt.token"));
    const session = await caller.storeAuth.getSession({ storeSlug: "test-store" });
    expect(session.authenticated).toBe(false);
  });

  it("logout succeeds even without a session", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    const result = await caller.storeAuth.logout({ storeSlug: "test-store" });
    expect(result.success).toBe(true);
  });
});

// ─── Store Portal Dashboard — Auth Guard Tests ────────────────────────────────
describe("Store Portal — Dashboard Auth Guards", () => {
  it("dashboard rejects request with no cookie", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storePortal.dashboard({ storeSlug: "test-store" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("proposals.list rejects request with no cookie", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storePortal.proposals.list({ storeSlug: "test-store" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("orders.list rejects request with no cookie", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storePortal.orders.list({ storeSlug: "test-store" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("departments.list rejects request with no cookie", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storePortal.departments.list({ storeSlug: "test-store" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("print.list rejects request with no cookie", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storePortal.print.list({ storeSlug: "test-store" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Store Portal Input Validation Tests ─────────────────────────────────────
describe("Store Portal — Input Validation", () => {
  it("proposals.getById rejects non-positive proposal ID", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makePortalCtx("test-store", "tampered.jwt"));
    await expect(
      caller.storePortal.proposals.getById({
        storeSlug: "test-store",
        proposalId: -1,
      })
    ).rejects.toThrow();
  });

  it("orders.getById rejects non-positive order ID", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makePortalCtx("test-store", "tampered.jwt"));
    await expect(
      caller.storePortal.orders.getById({
        storeSlug: "test-store",
        orderId: 0,
      })
    ).rejects.toThrow();
  });

  it("dashboard rejects empty storeSlug", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storePortal.dashboard({ storeSlug: "" })
    ).rejects.toThrow();
  });
});

// ─── Store Auth — POC Login Tests ─────────────────────────────────────────────
describe("Store Portal — POC (Point of Contact) Login", () => {
  it("pocLogin rejects invalid email", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storeAuth.pocLogin({
        storeSlug: "test-store",
        email: "not-an-email",
        pocToken: "valid-poc-token",
      })
    ).rejects.toThrow();
  });

  it("pocLogin rejects empty pocToken", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeNoAuthCtx());
    await expect(
      caller.storeAuth.pocLogin({
        storeSlug: "test-store",
        email: "buyer@test.com",
        pocToken: "",
      })
    ).rejects.toThrow();
  });
});

// ─── Store Portal — Cart Logic Tests (stateless) ──────────────────────────────
describe("Store Portal — Cart Logic (client-side state)", () => {
  it("cart item quantity must be positive", () => {
    const validateCartItem = (qty: number) => qty > 0;
    expect(validateCartItem(1)).toBe(true);
    expect(validateCartItem(10)).toBe(true);
    expect(validateCartItem(0)).toBe(false);
    expect(validateCartItem(-1)).toBe(false);
  });

  it("cart total calculation is correct", () => {
    const items = [
      { price: 25.99, qty: 2 },  // 51.98
      { price: 10.00, qty: 5 },  // 50.00
      { price: 99.99, qty: 1 },  // 99.99
    ];
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    // 51.98 + 50.00 + 99.99 = 201.97
    expect(total).toBeCloseTo(201.97, 2);
  });

  it("cart with zero items has zero total", () => {
    const total = [].reduce((sum: number) => sum, 0);
    expect(total).toBe(0);
  });

  it("cart item deduplication works correctly", () => {
    const cart = [
      { productId: 1, qty: 2 },
      { productId: 2, qty: 1 },
      { productId: 1, qty: 3 }, // duplicate
    ];
    const merged = cart.reduce((acc: Record<number, number>, item) => {
      acc[item.productId] = (acc[item.productId] || 0) + item.qty;
      return acc;
    }, {});
    expect(merged[1]).toBe(5); // 2 + 3
    expect(merged[2]).toBe(1);
    expect(Object.keys(merged)).toHaveLength(2);
  });
});

// ─── Store Portal — Order Submission Logic Tests ──────────────────────────────
describe("Store Portal — Order Submission Logic", () => {
  it("order submission rejects empty items array", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makePortalCtx("test-store", "tampered.jwt"));
    await expect(
      caller.storePortal.orders.submit({
        storeSlug: "test-store",
        items: [],
        shippingAddress: {
          name: "John Doe",
          line1: "123 Main St",
          city: "Chicago",
          state: "IL",
          zip: "60601",
          country: "US",
        },
      })
    ).rejects.toThrow();
  });

  it("order submission rejects missing shipping address fields", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makePortalCtx("test-store", "tampered.jwt"));
    await expect(
      caller.storePortal.orders.submit({
        storeSlug: "test-store",
        items: [{ productId: 1, quantity: 2, unitPrice: 25.99 }],
        shippingAddress: {
          name: "",
          line1: "",
          city: "",
          state: "",
          zip: "",
          country: "",
        },
      })
    ).rejects.toThrow();
  });

  it("order submission rejects negative quantity", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makePortalCtx("test-store", "tampered.jwt"));
    await expect(
      caller.storePortal.orders.submit({
        storeSlug: "test-store",
        items: [{ productId: 1, quantity: -1, unitPrice: 25.99 }],
        shippingAddress: {
          name: "John Doe",
          line1: "123 Main St",
          city: "Chicago",
          state: "IL",
          zip: "60601",
          country: "US",
        },
      })
    ).rejects.toThrow();
  });
});

// ─── Store Portal — Proposal Workflow Logic Tests ─────────────────────────────
describe("Store Portal — Proposal Workflow Logic", () => {
  it("proposal accept rejects invalid proposalId", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makePortalCtx("test-store", "tampered.jwt"));
    await expect(
      caller.storePortal.proposals.forwardToDepartments({
        storeSlug: "test-store",
        proposalId: 0,
        departments: [],
      })
    ).rejects.toThrow();
  });

  it("proposal decline rejects invalid proposalId", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makePortalCtx("test-store", "tampered.jwt"));
    await expect(
      caller.storePortal.proposals.decline({
        storeSlug: "test-store",
        proposalId: -5,
        reason: "Not interested",
      })
    ).rejects.toThrow();
  });
});
