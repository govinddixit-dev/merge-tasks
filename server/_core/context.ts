/**
 * tRPC request context — resolves the authenticated user and their
 * organization for every incoming request.
 *
 * Called by the tRPC Express adapter before each procedure. Provides
 * `user`, `organizationId`, and `role` to all downstream routers.
 *
 * @module server/_core/context
 */
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getDb } from "../db";
import { organizations, orgMembers } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getLogger } from "../utils/logger";

const log = getLogger("context");

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * The active organization ID for this request.
   * Set from the `x-org-id` header (sent by the client after org selection).
   * Falls back to the user's own organization (the one they own) if not set.
   * Null for unauthenticated requests.
   */
  organizationId: number | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let organizationId: number | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req, opts.res);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  if (user) {
    try {
      const db = await getDb();
      if (db) {
        // Check if client sent a specific org ID header
        const requestedOrgId = opts.req.headers["x-org-id"];
        if (requestedOrgId && !isNaN(Number(requestedOrgId))) {
          const orgId = Number(requestedOrgId);
          // Verify the user is actually a member of the requested org
          const [membership] = await db
            .select({ id: orgMembers.id })
            .from(orgMembers)
            .where(and(
              eq(orgMembers.organizationId, orgId),
              eq(orgMembers.userId, user.id)
            ))
            .limit(1);
          if (membership) {
            organizationId = orgId;
          }
        }

        // Fall back to the user's own organization
        if (!organizationId) {
          const [ownOrg] = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.ownerId, user.id))
            .limit(1);
          if (ownOrg) {
            organizationId = ownOrg.id;
          }
        }
      }
    } catch (err: unknown) {
      log.warn("Failed to resolve organizationId:", err);
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    organizationId,
  };
}
