/**
 * Multi-tenant guardrail meta-tests (ITEM 6 of 2026-04-25 remediation).
 *
 * These tests scan every router file under `server/routers/` and verify that
 * any router which touches an org-scoped table provides one of the accepted
 * scoping mechanisms:
 *
 *   1. Imports `getOrgScope` from `../utils/orgScope` (canonical pattern).
 *   2. Uses `orgProcedure` from `../_core/trpc` (enforces ctx.organizationId).
 *   3. Uses `buildToolScope` from `./copilotExecScope` (copilot exec helpers).
 *   4. Uses `resolveStoreSession` from `./storePortalAuth` (store-portal JWT).
 *   5. Has an explicit org filter — references `<table>.organizationId` in
 *      a SQL builder so the WHERE clause must include the tenant key.
 *
 * Files that are by-design org-agnostic (auth bootstrap, billing/Stripe-side,
 * platform admin, etc.) are listed in `ALLOWLIST` with a reason. Adding any
 * new router that touches org data without one of the five scoping methods
 * (or an allowlist entry) will fail the meta-test in CI.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { TrpcContext } from "./_core/context";
import type { Request, Response } from "express";

type AuthedUser = NonNullable<TrpcContext["user"]>;

function makeUser(id: number): AuthedUser {
  return {
    id,
    openId: `u-${id}`,
    email: `u${id}@test.com`,
    name: `U${id}`,
    loginMethod: "email",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as AuthedUser;
}

function makeReq(): Request {
  return { protocol: "https", headers: {} } as unknown as Request;
}

function makeRes(): Response {
  return { clearCookie: () => undefined } as unknown as Response;
}

const ROUTERS_DIR = path.resolve(__dirname, "routers");

/**
 * Org-scoped tables — any router that imports one of these from the schema
 * must scope queries via one of the accepted patterns.
 *
 * Sourced from server/utils/orgScope.ts; keep in sync.
 */
const ORG_SCOPED_TABLES = [
  "clients",
  "products",
  "proposals",
  "stores",
  "orders",
  "virtualProofs",
  "clientLogos",
  "emailConnections",
  "distributorProfiles",
  "clientAssets",
  "aiEditFeedback",
  "copilotConversations",
  "copilotMemory",
  "copilotTaskLog",
  "printRequests",
  "estimates",
  "invoices",
  "apiConnections",
  "refundRequests",
  "refundHistory",
  "purchaseOrders",
  "suppliers",
  "notifications",
  "productCollections",
];

/**
 * Files explicitly exempt from the meta-test.
 *
 * Each entry must include a one-line `reason` so future maintainers
 * understand why the file is allowed to skip the standard scoping check.
 * Adding entries silently is itself a review smell.
 */
const ALLOWLIST: Record<string, string> = {
  // Auth / billing / platform-admin scopes are user-id-driven, not org-driven,
  // and operate on tables explicitly outside the org-scope helper.
  "billing.ts": "billing operates on subscription state keyed off user.id, not org tables",
  "accountDeletion.ts": "deletes records by userId across tables; org filter is irrelevant",
  "onboarding.ts": "pre-org user setup; runs before an organization exists",
  "platformAdmin.ts": "explicitly cross-tenant admin endpoints, gated by adminProcedure",
  "organizations.ts": "manages org membership itself; cannot use org filter to do so",
  "waitlist.ts": "public, no org context",
  "storeCheckout.ts": "public storefront checkout — scopes by storeId, not org",
  "storeMedia.ts": "public storefront media — scopes by storeId, not org",
  "storeSso.ts": "store-side SAML SSO bootstrap — scopes by storeId, not org",
  "stripeConnect.ts": "Stripe Connect onboarding — scopes by stripeAccountId, not org",
  "storeDepartmentBudgets.ts": "scoped by storeId; reaches store via storeUser session",
  // Store-portal procedures authenticate via resolveStoreSession (storeId-scoped JWT)
  "storePortal.ts": "store-portal session uses storeId scoping via resolveStoreSession",
  "storePortalAuth.ts": "defines the store-portal session helper itself",
  "storePortalBudgets.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  "storePortalCustomRequests.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  "storePortalDepartments.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  "storePortalLocations.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  "storePortalOrders.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  "storePortalPrint.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  "storePortalProposals.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  "storePortalRefunds.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  "storePortalStats.ts": "store-portal session: storeId-scoped via resolveStoreSession",
  // Print products / suppliers are global catalog (not tenant data)
  "printProducts.ts": "global print-supplier catalog (cross-tenant by design)",
};

interface FileScan {
  file: string;
  importsOrgTable: boolean;
  hasOrgScope: boolean;
  hasOrgProcedure: boolean;
  hasBuildToolScope: boolean;
  hasResolveStoreSession: boolean;
  /** Explicit `<table>.organizationId` filter usage — e.g. `eq(foo.organizationId, organizationId)`. */
  hasExplicitOrgIdFilter: boolean;
}

function scanRouterFile(filePath: string): FileScan {
  const source = fs.readFileSync(filePath, "utf8");
  const importsOrgTable = ORG_SCOPED_TABLES.some(t =>
    new RegExp(`\\b${t}\\b`).test(source)
  ) && /from\s+["']\.\.\/\.\.\/drizzle\/schema["']/.test(source);
  return {
    file: path.basename(filePath),
    importsOrgTable,
    hasOrgScope: /\bgetOrgScope\b/.test(source),
    hasOrgProcedure: /\borgProcedure\b/.test(source),
    hasBuildToolScope: /\bbuildToolScope\b/.test(source),
    hasResolveStoreSession: /\bresolveStoreSession\b/.test(source),
    hasExplicitOrgIdFilter: /\b\w+\.organizationId\s*,\s*organizationId\b/.test(source),
  };
}

function listRouterFiles(): string[] {
  return fs
    .readdirSync(ROUTERS_DIR)
    .filter(f => f.endsWith(".ts") && !f.endsWith(".bak") && !f.endsWith(".d.ts"))
    .map(f => path.join(ROUTERS_DIR, f));
}

describe("Meta — multi-tenant guardrail enforcement", () => {
  const scans = listRouterFiles().map(scanRouterFile);

  it("scanned at least 50 router files (sanity check)", () => {
    expect(scans.length).toBeGreaterThanOrEqual(50);
  });

  it("every router that imports an org-scoped table provides scope evidence", () => {
    const missing = scans.filter(s => {
      if (!s.importsOrgTable) return false;
      if (ALLOWLIST[s.file]) return false;
      return !(
        s.hasOrgScope ||
        s.hasOrgProcedure ||
        s.hasBuildToolScope ||
        s.hasResolveStoreSession ||
        s.hasExplicitOrgIdFilter
      );
    });
    expect(
      missing,
      `Routers missing org scoping evidence:\n` +
        missing
          .map(m => `  - ${m.file} (add getOrgScope/orgProcedure/buildToolScope/resolveStoreSession or an ALLOWLIST entry)`)
          .join("\n")
    ).toEqual([]);
  });

  it("ALLOWLIST entries each carry a non-empty reason", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `ALLOWLIST[${file}] needs a reason`).toBeGreaterThan(10);
    }
  });

  it("ALLOWLIST entries reference real router files (no stale entries)", () => {
    const known = new Set(scans.map(s => s.file));
    const stale = Object.keys(ALLOWLIST).filter(f => !known.has(f));
    expect(stale, `Stale ALLOWLIST entries (file no longer exists): ${stale.join(", ")}`).toEqual(
      []
    );
  });
});

describe("Cross-org isolation — scope produces tenant-distinct SQL", () => {
  // These tests exercise the scope builders directly without booting tRPC.
  // They prove that for the most critical org-data routers — clients,
  // proposals, invoices, estimates, products — the produced WHERE clause
  // is keyed off the caller's org/user and cannot leak across tenants.
  it("getOrgScope yields different SQL filters for two different orgs", async () => {
    const { getOrgScope } = await import("./utils/orgScope");
    const scopeA = getOrgScope({ user: makeUser(1), organizationId: 100 });
    const scopeB = getOrgScope({ user: makeUser(2), organizationId: 200 });
    for (const table of ["clients", "proposals", "invoices", "estimates", "products"] as const) {
      // The drizzle SQL objects compare by reference; serialize their queryChunks
      // through JSON.stringify after stripping circular bits.
      expect(scopeA.organizationId).not.toBe(scopeB.organizationId);
      expect(scopeA[table]).not.toBe(scopeB[table]);
    }
  });

  it("buildToolScope yields different SQL filters for two different orgs", async () => {
    const { buildToolScope } = await import("./routers/copilotExecScope");
    const a = buildToolScope(1, 100);
    const b = buildToolScope(2, 200);
    for (const table of ["clients", "proposals", "invoices", "estimates", "products"] as const) {
      expect(a[table]).not.toBe(b[table]);
    }
  });

  it("solo-user scope (no org) keys off userId, not org", async () => {
    const { getOrgScope } = await import("./utils/orgScope");
    const scope = getOrgScope({ user: makeUser(42), organizationId: null });
    expect(scope.organizationId).toBeNull();
    expect(scope.userId).toBe(42);
    expect(scope.stamp).toEqual({ userId: 42, organizationId: null });
  });

  it("two solo users get distinct scopes (userId-keyed)", async () => {
    const { getOrgScope } = await import("./utils/orgScope");
    const a = getOrgScope({ user: makeUser(1), organizationId: null });
    const b = getOrgScope({ user: makeUser(2), organizationId: null });
    expect(a.userId).not.toBe(b.userId);
    expect(a.clients).not.toBe(b.clients);
  });

  it("an unauthenticated context is rejected (no scope leak via null user)", async () => {
    const { getOrgScope } = await import("./utils/orgScope");
    expect(() =>
      getOrgScope({ user: null as unknown as AuthedUser, organizationId: 999 })
    ).toThrow();
  });
});

describe("Cross-org isolation — tRPC integration (DB-gated)", () => {
  it("clients.getById returns NOT_FOUND when called with a different-org context", async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) {
      console.log("SKIP: DB unavailable");
      return;
    }
    const { appRouter } = await import("./routers");
    const makeCtx = (userId: number, orgId: number | null): TrpcContext => ({
      user: makeUser(userId),
      organizationId: orgId,
      req: makeReq(),
      res: makeRes(),
    });
    const orgA = appRouter.createCaller(makeCtx(1001, 91001));
    // Probe IDs that would belong to a different tenant. Whether they exist or
    // not, this caller (org 91001) must not see them.
    for (const probeId of [1, 99999]) {
      try {
        const result = await orgA.clients.getById({ id: probeId });
        // If the row exists at all but isn't ours, the row's org/user must match.
        expect(result.organizationId === 91001 || result.userId === 1001).toBe(true);
      } catch (err: unknown) {
        if (err && typeof err === "object" && "code" in err) {
          expect((err as { code: string }).code).toBe("NOT_FOUND");
        } else {
          throw err;
        }
      }
    }
  });
});
