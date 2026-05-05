/**
 * Unknown-IP rate-limit bucket tests (ITEM 3 of 2026-04-25 remediation).
 *
 * Verifies the audit fix for the previous `ip === "unknown"` bypass:
 *   - Unresolved client IPs no longer skip the limiter.
 *   - All such traffic is bucketed under `global:unknown`.
 *   - The bucket is eventually blocked once the cap is exceeded.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";

import { buildGlobalApiRateLimit } from "./_core/securityMiddleware";
import { UNKNOWN_IP_API_LIMIT } from "./utils/rateLimiter";

interface CallRecord {
  key: string;
}

async function startApp(records: CallRecord[]): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  // Force getClientIp to return "unknown": no req.ip, no x-forwarded-for, no
  // TRUSTED_PROXY_COUNT env. We accomplish this by stripping req.ip on each request.
  app.use((req, _res, next) => {
    Object.defineProperty(req, "ip", { value: undefined });
    next();
  });

  // Track every call into the limiter so we can assert the bucket key.
  let blockedAfter = Number.POSITIVE_INFINITY;
  let calls = 0;
  const middleware = buildGlobalApiRateLimit({
    log: { warn: () => {}, error: () => {} },
    check: async (key: string) => {
      records.push({ key });
      calls++;
      if (calls > blockedAfter) {
        return {
          allowed: false,
          remaining: 0,
          resetInMs: 60_000,
          message: "Request rate limit exceeded.",
        };
      }
      return { allowed: true, remaining: 1, resetInMs: 0 };
    },
  });
  // Allow tests to opt into "block after N calls".
  app.use((req, _res, next) => {
    const after = req.headers["x-block-after"];
    if (after) blockedAfter = Number(Array.isArray(after) ? after[0] : after);
    next();
  });
  app.use(middleware);
  app.use((_req, res) => res.json({ ok: true }));

  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("Unknown-IP rate-limit bucket", () => {
  it("buckets unresolved-IP traffic under global:unknown (not bypassed)", async () => {
    const records: CallRecord[] = [];
    const { server, baseUrl } = await startApp(records);
    try {
      // Hit the API a few times; with no resolvable IP, every request must
      // still go through the limiter under the shared "unknown" bucket.
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${baseUrl}/api/trpc/products.list`);
        expect(res.status).toBe(200);
      }
      expect(records).toHaveLength(3);
      for (const r of records) {
        expect(r.key).toBe("global:unknown");
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("eventually blocks unknown-IP traffic with 429 once cap is exceeded", async () => {
    const records: CallRecord[] = [];
    const { server, baseUrl } = await startApp(records);
    try {
      // Allow 2 requests then block.
      const res1 = await fetch(`${baseUrl}/api/trpc/products.list`, {
        headers: { "x-block-after": "2" },
      });
      expect(res1.status).toBe(200);
      const res2 = await fetch(`${baseUrl}/api/trpc/products.list`, {
        headers: { "x-block-after": "2" },
      });
      expect(res2.status).toBe(200);
      const res3 = await fetch(`${baseUrl}/api/trpc/products.list`, {
        headers: { "x-block-after": "2" },
      });
      expect(res3.status).toBe(429);
      expect(res3.headers.get("retry-after")).toBeTruthy();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("UNKNOWN_IP_API_LIMIT is stricter than the per-IP general limit", async () => {
    const { GENERAL_API_LIMIT } = await import("./utils/rateLimiter");
    expect(UNKNOWN_IP_API_LIMIT.max).toBeLessThan(GENERAL_API_LIMIT.max);
  });
});
