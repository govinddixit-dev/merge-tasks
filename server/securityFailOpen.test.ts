/**
 * Fail-open / fail-closed policy tests (ITEM 2 of 2026-04-25 remediation).
 *
 * Verifies that on a simulated rate-limiter or token-blocklist outage:
 *   - Tier A endpoints (auth/billing/admin/etc.) fail-closed (deny).
 *   - Tier B endpoints (low-risk reads) fail-open and emit a structured
 *     `fallback_mode` log line.
 */

import { describe, it, expect } from "vitest";
import express, { type Request, type Response } from "express";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";

import { buildGlobalApiRateLimit } from "./_core/securityMiddleware";
import { classifyPath } from "./utils/riskTier";

interface CapturedLog {
  level: "warn" | "error";
  message: string;
}

function makeFakeLogger(captured: CapturedLog[]) {
  return {
    warn: (m: string) => captured.push({ level: "warn", message: String(m) }),
    error: (m: string) => captured.push({ level: "error", message: String(m) }),
  };
}

async function startApp(captured: CapturedLog[], options?: { failing?: boolean }): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.set("trust proxy", 1);
  const failing = options?.failing ?? true;
  const rateLimit = buildGlobalApiRateLimit({
    log: makeFakeLogger(captured),
    check: failing
      ? async () => {
          throw new Error("simulated-redis-down");
        }
      : async () => ({ allowed: true, remaining: 1, resetInMs: 0 }),
  });
  app.use((req, _res, next) => {
    // Force a non-localhost IP so the limiter isn't bypassed.
    Object.defineProperty(req, "ip", { value: "203.0.113.5" });
    next();
  });
  app.use(rateLimit);
  app.use((req: Request, res: Response) => {
    res.json({ ok: true, path: req.path });
  });

  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("Risk-tier classification", () => {
  it("flags auth, billing, admin paths as Tier A", () => {
    expect(classifyPath("/api/auth/login")).toBe("A");
    expect(classifyPath("/api/billing/portal")).toBe("A");
    expect(classifyPath("/api/admin/users")).toBe("A");
    expect(classifyPath("/api/trpc/auth.signIn")).toBe("A");
    expect(classifyPath("/api/trpc/billing.createCheckout")).toBe("A");
    expect(classifyPath("/api/trpc/platformAdmin.listUsers")).toBe("A");
    expect(classifyPath("/api/passwordReset")).toBe("A");
    expect(classifyPath("/api/auth/logout")).toBe("A");
  });

  it("flags low-risk reads as Tier B", () => {
    expect(classifyPath("/api/trpc/products.list")).toBe("B");
    expect(classifyPath("/api/trpc/clients.list")).toBe("B");
    expect(classifyPath("/api/trpc/proposals.list")).toBe("B");
  });
});

describe("Rate-limiter fail-open / fail-closed", () => {
  it("Tier A (auth) endpoint denies with 503 on limiter outage", async () => {
    const captured: CapturedLog[] = [];
    const { server, baseUrl } = await startApp(captured);
    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, { method: "GET" });
      expect(res.status).toBe(503);
      const errorLogs = captured.filter(l => l.level === "error");
      expect(errorLogs.length).toBeGreaterThan(0);
      const parsed = JSON.parse(errorLogs[0].message);
      expect(parsed.event).toBe("rate_limiter_fail_closed");
      expect(parsed.tier).toBe("A");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("Tier B (read) endpoint allows through with structured fallback_mode log", async () => {
    const captured: CapturedLog[] = [];
    const { server, baseUrl } = await startApp(captured);
    try {
      const res = await fetch(`${baseUrl}/api/trpc/products.list`, { method: "GET" });
      expect(res.status).toBe(200);
      const warnLogs = captured.filter(l => l.level === "warn");
      expect(warnLogs.length).toBeGreaterThan(0);
      const parsed = JSON.parse(warnLogs[0].message);
      expect(parsed.event).toBe("rate_limiter_fail_open");
      expect(parsed.fallback_mode).toBe(true);
      expect(parsed.tier).toBe("B");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("normal path (no failure) still allows traffic", async () => {
    const captured: CapturedLog[] = [];
    const { server, baseUrl } = await startApp(captured, { failing: false });
    try {
      const res = await fetch(`${baseUrl}/api/trpc/products.list`, { method: "GET" });
      expect(res.status).toBe(200);
      // No fail-mode logs in healthy operation.
      expect(captured.filter(l => l.message.includes("rate_limiter_fail"))).toHaveLength(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe("Token blocklist fail-closed (isTokenRevokedFailClosed)", () => {
  it("returns true (denied) when blocklist backend throws", async () => {
    const { isTokenRevokedFailClosed } = await import("./utils/tokenBlocklist");
    const errors: string[] = [];
    const result = await isTokenRevokedFailClosed("j-1", "u-1", 1000, {
      checker: async () => {
        throw new Error("simulated-redis-down");
      },
      log: { error: (m: string) => errors.push(m) },
    });
    expect(result).toBe(true);
    expect(errors).toHaveLength(1);
    const parsed = JSON.parse(errors[0]);
    expect(parsed.event).toBe("token_blocklist_fail_closed");
    expect(parsed.tier).toBe("A");
    expect(parsed.openId).toBe("u-1");
  });

  it("returns the actual revocation result when backend is healthy", async () => {
    const { isTokenRevokedFailClosed } = await import("./utils/tokenBlocklist");
    const errors: string[] = [];
    const revoked = await isTokenRevokedFailClosed("j-1", "u-1", 1000, {
      checker: async () => true,
      log: { error: (m: string) => errors.push(m) },
    });
    expect(revoked).toBe(true);
    const allowed = await isTokenRevokedFailClosed("j-2", "u-1", 1000, {
      checker: async () => false,
      log: { error: (m: string) => errors.push(m) },
    });
    expect(allowed).toBe(false);
    expect(errors).toHaveLength(0);
  });
});
