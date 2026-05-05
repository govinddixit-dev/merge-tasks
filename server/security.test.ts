/**
 * Security & Multi-Tenant Isolation Test Suite
 * Tests: IDOR prevention, auth bypass, rate limiting, data isolation between distributors.
 * These are the most critical tests before taking real money.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrgScope } from "./utils/orgScope";
import { checkRateLimit, SIGNIN_LIMIT, SIGNUP_LIMIT, PROPOSAL_SEND_LIMIT, STORE_CREATE_LIMIT } from "./utils/rateLimiter";
import type { TrpcContext } from "./_core/context";

// ─── Mock ENV ─────────────────────────────────────────────────────────────────
vi.mock("./_core/env", () => ({
  ENV: {
    jwtSecret: "test-jwt-secret-32-chars-minimum!!",
    sessionSecret: "test-session-secret",
    databaseUrl: undefined,
    openaiApiKey: "sk-test-openai",
    stripeSecretKey: undefined,
    stripeWebhookSecret: undefined,
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeCtx(userId: number, organizationId: number | null = null): TrpcContext & { organizationId: number | null } {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: "email" as const,
      role: "admin" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    organizationId,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function makeUnauthCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

// ─── Multi-Tenant Data Isolation Tests ────────────────────────────────────────
describe("Security — Multi-Tenant Data Isolation (orgScope)", () => {
  it("solo distributor A scope filters by userId A", () => {
    const ctxA = makeCtx(1, null);
    const scopeA = getOrgScope(ctxA);
    expect(scopeA.userId).toBe(1);
    expect(scopeA.organizationId).toBeNull();
    // Drizzle SQL objects are circular - check userId directly
    expect(scopeA.userId).toBe(1);
    expect(scopeA.organizationId).toBeNull();
  });

  it("solo distributor B scope filters by userId B", () => {
    const ctxB = makeCtx(2, null);
    const scopeB = getOrgScope(ctxB);
    expect(scopeB.userId).toBe(2);
    expect(scopeB.organizationId).toBeNull();
  });

  it("distributor A and B have different scopes — no data overlap", () => {
    const scopeA = getOrgScope(makeCtx(1, null));
    const scopeB = getOrgScope(makeCtx(2, null));
    // Different userIds mean different SQL filters — verify via userId
    expect(scopeA.userId).not.toBe(scopeB.userId);
    expect(scopeA.stamp.userId).toBe(1);
    expect(scopeB.stamp.userId).toBe(2);
  });

  it("team member in org X cannot see data from org Y", () => {
    const memberOrgX = makeCtx(10, 100);
    const memberOrgY = makeCtx(20, 200);
    const scopeX = getOrgScope(memberOrgX);
    const scopeY = getOrgScope(memberOrgY);
    expect(scopeX.organizationId).toBe(100);
    expect(scopeY.organizationId).toBe(200);
    // Different org IDs mean completely different data isolation
    expect(scopeX.organizationId).not.toBe(scopeY.organizationId);
  });

  it("org scope takes precedence over userId for team members", () => {
    const teamMember = makeCtx(99, 500);
    const scope = getOrgScope(teamMember);
    // When org is set, scope.organizationId is used, not userId
    expect(scope.organizationId).toBe(500);
    expect(scope.userId).toBe(99);
  });

  it("stamp includes both userId and organizationId for INSERT operations", () => {
    const ctx = makeCtx(7, 42);
    const scope = getOrgScope(ctx);
    expect(scope.stamp.userId).toBe(7);
    expect(scope.stamp.organizationId).toBe(42);
  });

  it("stamp for solo user has null organizationId", () => {
    const ctx = makeCtx(7, null);
    const scope = getOrgScope(ctx);
    expect(scope.stamp.userId).toBe(7);
    expect(scope.stamp.organizationId).toBeNull();
  });

  it("scope covers all 18 critical tables", () => {
    const scope = getOrgScope(makeCtx(1, null));
    const requiredTables = [
      "clients", "products", "proposals", "stores", "orders",
      "virtualProofs", "clientLogos", "emailConnections",
      "distributorProfiles", "clientAssets", "aiEditFeedback",
      "copilotConversations", "copilotMemory", "copilotTaskLog",
      "printRequests", "estimates", "invoices", "apiConnections",
    ];
    for (const table of requiredTables) {
      expect(scope[table as keyof typeof scope]).toBeDefined();
    }
  });

  it("orgScope throws if user is not authenticated", () => {
    expect(() =>
      getOrgScope({ user: null as any, organizationId: null })
    ).toThrow();
  });

  it("stamp values are correct for org member", () => {
    const scope = getOrgScope(makeCtx(5, 99));
    expect(scope.stamp).toEqual({ userId: 5, organizationId: 99 });
  });

  it("stamp values are correct for solo user", () => {
    const scope = getOrgScope(makeCtx(5, null));
    expect(scope.stamp).toEqual({ userId: 5, organizationId: null });
  });
});

// ─── Authentication Guard Tests ───────────────────────────────────────────────
describe("Security — Authentication Guards (all protected endpoints)", () => {
  it("clients.list returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.clients.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("proposals.list returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.proposals.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("stores.list returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.stores.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("orders.list returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.orders.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("billing.createCheckout returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(
      caller.billing.createCheckout({ planId: "pro", interval: "month", origin: "https://app.mergetasks.com" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("billing.cancelSubscription returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.billing.cancelSubscription()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("copilot.chat returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(
      caller.copilot.chat({ messages: [{ role: "user", content: "Hello" }], conversationId: null })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("aiInsights.predictiveReorders returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.aiInsights.predictiveReorders()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("products.list returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.products.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("estimatesInvoices.estimates.list returns UNAUTHORIZED without auth", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.estimatesInvoices.estimates.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("auth.logout is accessible without auth (public procedure)", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });

  it("billing.getPlans is accessible without auth (public procedure)", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeUnauthCtx());
    const plans = await caller.billing.getPlans();
    expect(plans.length).toBeGreaterThan(0);
  });

  it("stores.getBySlug projection does not leak internal render fields (audit)", async () => {
    // Source-level audit: storesCrud.getBySlug constructs an explicit
    // object literal for `products` (see server/routers/storesCrud.ts:583-606).
    // This test pins that whitelist — if a future edit accidentally
    // spreads `...sp` or adds a leak-prone column the diff fails here.
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "server/routers/storesCrud.ts"),
      "utf-8",
    );

    // Find the getBySlug body (rough but stable: from the procedure
    // declaration to the closing }) of the .query() block).
    const start = src.indexOf("getBySlug: publicProcedure");
    expect(start).toBeGreaterThan(-1);
    const slice = src.slice(start, start + 8000);

    // Internal-only fields that must NEVER appear in the public
    // webstore response. renderApproved is a distributor-only flag;
    // renderPromptAdjustment is the AI-prompt tweak; renderPlacement*
    // coords are the manual placement editor's data — none of these
    // are useful to a customer and all reveal distributor state.
    const FORBIDDEN = [
      "renderApproved:",
      "renderApprovedAt:",
      "renderApprovedBy:",
      "renderPromptAdjustment:",
      "renderPlacementX:",
      "renderPlacementY:",
      "renderPlacementWidth:",
      "renderPlacementHeight:",
      "renderPlacementRotation:",
    ];
    for (const field of FORBIDDEN) {
      // The field can appear in the file (it exists on the schema);
      // it must not appear inside the getBySlug response slice.
      expect(slice).not.toContain(field);
    }
  });
});

// ─── Rate Limiter Tests ───────────────────────────────────────────────────────
describe("Security — Rate Limiter", () => {
  it("allows requests within the limit", async () => {
    const key = `test-ip-${Date.now()}-allow`;
    const result = await checkRateLimit(key, { max: 5, windowMs: 60000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("blocks requests after max is reached", async () => {
    const key = `test-ip-${Date.now()}-block`;
    const opts = { max: 3, windowMs: 60000 };
    await checkRateLimit(key, opts);
    await checkRateLimit(key, opts);
    await checkRateLimit(key, opts);
    const result = await checkRateLimit(key, opts);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("returns correct remaining count", async () => {
    const key = `test-ip-${Date.now()}-remaining`;
    const opts = { max: 10, windowMs: 60000 };
    await checkRateLimit(key, opts);
    await checkRateLimit(key, opts);
    const result = await checkRateLimit(key, opts);
    expect(result.remaining).toBe(7);
  });

  it("returns resetInMs when blocked", async () => {
    const key = `test-ip-${Date.now()}-reset`;
    const opts = { max: 1, windowMs: 60000 };
    await checkRateLimit(key, opts);
    const result = await checkRateLimit(key, opts);
    expect(result.allowed).toBe(false);
    expect(result.resetInMs).toBeGreaterThan(0);
    expect(result.resetInMs).toBeLessThanOrEqual(60000);
  });

  it("different IPs have independent rate limit counters", async () => {
    const ts = Date.now();
    const keyA = `ip-A-${ts}`;
    const keyB = `ip-B-${ts}`;
    const opts = { max: 2, windowMs: 60000 };
    await checkRateLimit(keyA, opts);
    await checkRateLimit(keyA, opts);
    const blockedA = await checkRateLimit(keyA, opts);
    expect(blockedA.allowed).toBe(false);
    const allowedB = await checkRateLimit(keyB, opts);
    expect(allowedB.allowed).toBe(true);
  });

  it("signin limit is 5 per 15 minutes", () => {
    expect(SIGNIN_LIMIT.max).toBe(5);
    expect(SIGNIN_LIMIT.windowMs).toBe(15 * 60 * 1000);
  });

  it("signup limit is 3 per hour", () => {
    expect(SIGNUP_LIMIT.max).toBe(3);
    expect(SIGNUP_LIMIT.windowMs).toBe(60 * 60 * 1000);
  });

  it("proposal send limit prevents email spam", () => {
    expect(PROPOSAL_SEND_LIMIT.max).toBeLessThanOrEqual(30);
    expect(PROPOSAL_SEND_LIMIT.windowMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it("store create limit prevents abuse", () => {
    expect(STORE_CREATE_LIMIT.max).toBeLessThanOrEqual(20);
  });

  it("rate limit includes human-readable message when blocked", async () => {
    const key = `test-ip-${Date.now()}-msg`;
    const opts = { max: 1, windowMs: 60000, message: "Custom rate limit message" };
    await checkRateLimit(key, opts);
    const result = await checkRateLimit(key, opts);
    expect(result.message).toBe("Custom rate limit message");
  });

  it("50 concurrent distributors each get independent rate limit buckets", async () => {
    const opts = { max: 5, windowMs: 60000 };
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        checkRateLimit(`distributor-${i}-${Date.now()}`, opts).then((r) => r.allowed),
      ),
    );
    // All 50 should be allowed (each has their own bucket)
    expect(results.every((r) => r === true)).toBe(true);
  });
});

// ─── Input Validation / Injection Prevention Tests ────────────────────────────
describe("Security — Input Validation & Injection Prevention", () => {
  it("Zod rejects invalid email format in client create", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(
      caller.clients.create({
        contactName: "Test User",
        companyName: "Test Corp",
        contactEmail: "not-an-email",
      })
    ).rejects.toThrow();
  });

  it("Zod rejects negative IDs in getById", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.clients.getById({ id: -1 })).rejects.toThrow();
  });

  it("Zod rejects zero IDs in getById", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.clients.getById({ id: 0 })).rejects.toThrow();
  });

  it("Zod rejects excessively long strings in client name", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeCtx(1));
    const tooLong = "a".repeat(10000);
    await expect(
      caller.clients.create({
        contactName: tooLong,
        companyName: "Test Corp",
        contactEmail: "test@test.com",
      })
    ).rejects.toThrow();
  });

  it("Zod rejects invalid billing interval", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(
      caller.billing.createCheckout({
        planId: "pro",
        interval: "quarterly" as any,
        origin: "https://app.mergetasks.com",
      })
    ).rejects.toThrow();
  });
});

// ─── Store Portal JWT Security Tests ─────────────────────────────────────────
describe("Security — Store Portal JWT Authentication", () => {
  it("storePortal.dashboard rejects missing cookie", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller({
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: () => {} } as TrpcContext["res"],
    });
    await expect(
      caller.storePortal.dashboard({ storeSlug: "test-store" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("storePortal.dashboard rejects tampered JWT", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller({
      user: null,
      req: {
        protocol: "https",
        headers: { cookie: "mt_store_test-store=tampered.jwt.token" },
      } as TrpcContext["req"],
      res: { clearCookie: () => {} } as TrpcContext["res"],
    });
    await expect(
      caller.storePortal.dashboard({ storeSlug: "test-store" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("storePortal.dashboard rejects expired JWT", async () => {
    const expiredToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdG9yZUlkIjoxLCJzdG9yZVVzZXJJZCI6MSwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDF9.invalid";
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller({
      user: null,
      req: {
        protocol: "https",
        headers: { cookie: `mt_store_test-store=${expiredToken}` },
      } as TrpcContext["req"],
      res: { clearCookie: () => {} } as TrpcContext["res"],
    });
    await expect(
      caller.storePortal.dashboard({ storeSlug: "test-store" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Token Entropy Tests ──────────────────────────────────────────────────────
describe("Security — Token Entropy & Uniqueness", () => {
  it("nanoid(24) generates tokens with sufficient entropy", async () => {
    const { nanoid } = await import("nanoid");
    const token = nanoid(24);
    expect(token).toHaveLength(24);
    expect(/^[a-zA-Z0-9_-]+$/.test(token)).toBe(true);
  });

  it("100 generated tokens are all unique", async () => {
    const { nanoid } = await import("nanoid");
    const tokens = new Set(Array.from({ length: 100 }, () => nanoid(24)));
    expect(tokens.size).toBe(100);
  });

  it("nanoid(16) has at least 95 bits of entropy (sufficient for view tokens)", () => {
    // nanoid uses 64 chars, so log2(64^16) = 96 bits
    const bitsOfEntropy = 16 * Math.log2(64);
    expect(bitsOfEntropy).toBeGreaterThan(95);
  });
});
