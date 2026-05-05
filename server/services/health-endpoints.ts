/**
 * health-endpoints.ts — Splits liveness from detailed metrics so the
 * unauthenticated endpoint is a recon-safe one-liner.
 *
 *   GET /api/health           — { ok: true, timestamp } only. No auth.
 *   GET /api/health/details   — full metrics snapshot. Requires
 *                               X-Health-Token: <HEALTH_TOKEN env var>.
 *
 * If HEALTH_TOKEN is unset, /details returns 503 with a clear message
 * (configuration gap, not a server error). Token comparison uses
 * timingSafeEqual to avoid leaking timing information on token guess.
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { getLastHealthSnapshot } from "./health-monitor";

function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get("/api/health/details", (req: Request, res: Response) => {
    const expected = process.env.HEALTH_TOKEN;
    if (!expected) {
      res.status(503).json({
        ok: false,
        reason: "HEALTH_TOKEN env var not configured — /api/health/details is disabled until set",
      });
      return;
    }
    const provided = req.header("x-health-token");
    if (!provided || !tokenMatches(provided, expected)) {
      // Match the canonical 401 shape — not 403, since the token is
      // an authentication credential, not an authorization claim.
      res.status(401).json({ ok: false, reason: "missing or invalid X-Health-Token" });
      return;
    }
    const snapshot = getLastHealthSnapshot();
    if (!snapshot) {
      res.json({
        ok: true,
        snapshot: null,
        note: "health-monitor has not yet completed its first tick (boot delay ~30s)",
      });
      return;
    }
    res.json({ ok: true, snapshot });
  });
}
