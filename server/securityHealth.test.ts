/**
 * Health-endpoint blast-radius tests (ITEM 4 of 2026-04-25 remediation).
 *
 * Validates the split into /live (shallow, no DB/Redis) and /ready (deep,
 * 5-second TTL cache), plus the legacy /health alias.
 */

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";

import {
  liveHandler,
  readyHandler,
  setReadinessProbes,
  restoreReadinessProbes,
  _resetReadyCacheForTests,
  READY_CACHE_TTL_MS,
} from "./_core/healthHandlers";

async function startApp(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.get("/live", liveHandler);
  app.get("/ready", readyHandler);
  app.get("/health", readyHandler); // legacy alias
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("Health endpoints — /live shallow", () => {
  it("/live responds 200 without touching DB or Redis", async () => {
    const { server, baseUrl } = await startApp();
    let dbHits = 0;
    let redisHits = 0;
    const previous = setReadinessProbes({
      checkDatabase: async () => {
        dbHits++;
        return true;
      },
      checkRedis: async () => {
        redisHits++;
        return { healthy: true, required: false };
      },
    });
    try {
      const res = await fetch(`${baseUrl}/live`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("alive");
      expect(dbHits).toBe(0);
      expect(redisHits).toBe(0);
    } finally {
      restoreReadinessProbes(previous);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe("Health endpoints — /ready deep with 5s TTL cache", () => {
  beforeEach(() => _resetReadyCacheForTests());

  it("burst of probes does NOT amplify backend queries (TTL cache)", async () => {
    const { server, baseUrl } = await startApp();
    let dbHits = 0;
    let redisHits = 0;
    const previous = setReadinessProbes({
      checkDatabase: async () => {
        dbHits++;
        return true;
      },
      checkRedis: async () => {
        redisHits++;
        return { healthy: true, required: false };
      },
    });
    try {
      // Send a burst of 25 probes; cache should collapse them to a single
      // pair of backend probes.
      const N = 25;
      const responses = await Promise.all(
        Array.from({ length: N }, () => fetch(`${baseUrl}/ready`))
      );
      for (const r of responses) expect(r.status).toBe(200);

      // Sequential post-burst probe should also hit cache (within TTL).
      const after = await fetch(`${baseUrl}/ready`);
      expect(after.status).toBe(200);
      const afterBody = await after.json();
      expect(afterBody.cached).toBe(true);

      // Critically: backend was hit at most once for each dependency.
      expect(dbHits).toBeLessThanOrEqual(1);
      expect(redisHits).toBeLessThanOrEqual(1);
    } finally {
      restoreReadinessProbes(previous);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("returns degraded 503 when DB probe fails (outage simulation)", async () => {
    const { server, baseUrl } = await startApp();
    const previous = setReadinessProbes({
      checkDatabase: async () => false,
      checkRedis: async () => ({ healthy: true, required: false }),
    });
    try {
      const res = await fetch(`${baseUrl}/ready`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.checks.database).toBe(false);
    } finally {
      restoreReadinessProbes(previous);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("returns degraded 503 when Redis is required and unhealthy", async () => {
    const { server, baseUrl } = await startApp();
    const previous = setReadinessProbes({
      checkDatabase: async () => true,
      checkRedis: async () => ({ healthy: false, required: true }),
    });
    try {
      const res = await fetch(`${baseUrl}/ready`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.checks.redis).toBe(false);
    } finally {
      restoreReadinessProbes(previous);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("legacy /health route returns same payload as /ready (no LB regression)", async () => {
    const { server, baseUrl } = await startApp();
    const previous = setReadinessProbes({
      checkDatabase: async () => true,
      checkRedis: async () => ({ healthy: true, required: false }),
    });
    try {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("healthy");
      expect(body.checks).toBeTruthy();
      expect(body.checks.database).toBe(true);
    } finally {
      restoreReadinessProbes(previous);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("TTL constant is 5 seconds as specified", () => {
    expect(READY_CACHE_TTL_MS).toBe(5_000);
  });
});
