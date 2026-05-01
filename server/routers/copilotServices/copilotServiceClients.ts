/**
 * copilotServiceClients.ts
 * ────────────────────────
 * Service-layer executor for the `search_clients` core copilot tool.
 * Extracted from copilotInlineExecutors.ts for maintainability.
 */

import { and, or, like, sql } from "drizzle-orm";
import { clients } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getOrSanitizeContext } from "../../utils/contextSanitizer";
import { buildToolScope } from "./copilotServiceScope";

export async function executeSearchClients(
  userId: number,
  organizationId: number | null,
  args: { query: string }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const searchPattern = `%${args.query}%`;

  const matches = await db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      contactName: clients.contactName,
      contactEmail: clients.contactEmail,
      contactPhone: clients.contactPhone,
      industry: clients.industry,
      status: clients.status,
    })
    .from(clients)
    .where(
      and(
        scope.clients,
        or(
          like(clients.companyName, searchPattern),
          like(clients.contactName, searchPattern),
          like(clients.industry, searchPattern),
          like(clients.contactEmail, searchPattern)
        )
      )
    )
    .limit(10);

  if (matches.length === 0) {
    const sample = await db
      .select({ companyName: clients.companyName })
      .from(clients)
      .where(scope.clients)
      .limit(5);
    const totalCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(scope.clients);
    const total = totalCount[0]?.count ?? 0;

    return {
      found: 0,
      clients: [],
      message: `No clients found matching "${args.query}". Available clients: ${sample
        .map((c) => c.companyName)
        .join(", ")}${total > 5 ? ` and ${total - 5} more` : ""}`,
    };
  }

  const sanitizedMatches = await getOrSanitizeContext(
    `${userId}:clients:${args.query}`,
    "clients",
    matches
  );

  return {
    found: matches.length,
    clients: sanitizedMatches.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
      industry: c.industry,
      status: c.status,
    })),
  };
}
