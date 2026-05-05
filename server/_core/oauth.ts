/**
 * Legacy OAuth callback stub.
 * The old /api/oauth/callback route routed through an external OAuth server.
 * Social login (Google/Microsoft) is now handled directly in socialAuthCallbacks.ts.
 * This file is kept to avoid breaking the import in _core/index.ts.
 */
import type { Express, Request, Response } from "express";
import { getLogger } from "../utils/logger";

const log = getLogger("OAuth");

export function registerOAuthRoutes(app: Express) {
  // Legacy callback — redirect to sign-in if anyone hits this old route
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    log.warn("Legacy /api/oauth/callback hit — redirecting to /sign-in");
    res.redirect(302, "/sign-in");
  });
}
