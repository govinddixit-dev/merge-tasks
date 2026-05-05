/**
 * copilotServiceScope.ts
 * ──────────────────────
 * Shared org-aware WHERE clause builder used by all copilot service modules.
 * Extracted from copilotInlineExecutors.ts.
 */

import { eq } from "drizzle-orm";
import {
  clients,
  products,
  proposals,
  stores,
  distributorProfiles,
} from "../../../drizzle/schema";

/**
 * Returns Drizzle WHERE expressions scoped to the user's organisation (or
 * personal account when organizationId is null). Used by every executor to
 * ensure strict data isolation.
 */
export function buildToolScope(userId: number, organizationId: number | null) {
  return {
    clients:
      organizationId !== null
        ? eq(clients.organizationId, organizationId)
        : eq(clients.userId, userId),
    products:
      organizationId !== null
        ? eq(products.organizationId, organizationId)
        : eq(products.userId, userId),
    proposals:
      organizationId !== null
        ? eq(proposals.organizationId, organizationId)
        : eq(proposals.userId, userId),
    stores:
      organizationId !== null
        ? eq(stores.organizationId, organizationId)
        : eq(stores.userId, userId),
    distributorProfiles:
      organizationId !== null
        ? eq(distributorProfiles.organizationId, organizationId)
        : eq(distributorProfiles.userId, userId),
    stamp: { userId, organizationId },
  };
}
