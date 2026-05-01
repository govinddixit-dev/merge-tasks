/**
 * CORS / CSRF header contract tests (ITEM 1 of 2026-04-25 remediation).
 *
 * Boots a tiny Express app with the production CORS + CSRF middleware and
 * exercises the header contract over real HTTP via fetch.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";

// Force production-mode CORS gating for these tests so allow-list rules apply.
vi.stubEnv("NODE_ENV", "production");

import { buildCorsOptions } from "./_core/securityMiddleware";
import { csrfProtection } from "./utils/csrf";

let server: Server;
let baseUrl: string;
const ALLOWED_ORIGIN = "https://app.mergetasks.com";

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    cors(
      buildCorsOptions({
        allowedOrigins: [ALLOWED_ORIGIN],
        isProduction: true,
      })
    )
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfProtection);

  // CORS rejection results in next(Error). Catch it and turn into a 403/origin-blocked.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof Error && err.message.startsWith("CORS:")) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "unhandled" });
  });

  app.get("/api/echo", (_req, res) => res.json({ ok: true }));
  app.post("/api/echo", (_req, res) => res.json({ ok: true }));

  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("CORS header contract", () => {
  it("OPTIONS preflight succeeds for allowed origin with content-type + x-csrf-token", async () => {
    const res = await fetch(`${baseUrl}/api/echo`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-token",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    const allowHeaders = (res.headers.get("access-control-allow-headers") || "").toLowerCase();
    expect(allowHeaders).toContain("content-type");
    expect(allowHeaders).toContain("x-csrf-token");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("OPTIONS preflight allows wildcard subdomain *.mergetasks.com", async () => {
    const res = await fetch(`${baseUrl}/api/echo`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://acme.mergetasks.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-token",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://acme.mergetasks.com");
  });

  it("POST from disallowed origin is rejected", async () => {
    const res = await fetch(`${baseUrl}/api/echo`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ a: 1 }),
    });
    // The cors middleware calls next(err); our error handler converts to 403.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/CORS:/);
  });
});

describe("CSRF header contract", () => {
  it("POST without x-csrf-token returns 403", async () => {
    const res = await fetch(`${baseUrl}/api/echo`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/CSRF/);
  });

  it("POST with matching cookie + header succeeds", async () => {
    // Step 1: GET to obtain a fresh csrf_token cookie.
    const getRes = await fetch(`${baseUrl}/api/echo`, {
      method: "GET",
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(getRes.status).toBe(200);
    const setCookie = getRes.headers.get("set-cookie") || "";
    const tokenMatch = /csrf_token=([^;]+)/.exec(setCookie);
    expect(tokenMatch, "csrf_token cookie should be set on GET").toBeTruthy();
    const token = tokenMatch![1];

    // Step 2: POST with both cookie and header.
    const postRes = await fetch(`${baseUrl}/api/echo`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "x-csrf-token": token,
        Cookie: `csrf_token=${token}`,
      },
      body: JSON.stringify({ a: 1 }),
    });
    expect(postRes.status).toBe(200);
  });

  it("POST with mismatched header vs cookie returns 403", async () => {
    const res = await fetch(`${baseUrl}/api/echo`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "x-csrf-token": "header-value-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        Cookie: "csrf_token=cookie-value-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(403);
  });
});
