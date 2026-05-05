/**
 * agentMemory.ts — Retrieves historical context for agent prompts.
 *
 * Pulls recent outcomes from aiTrainingData so the agent can learn
 * from past approved/rejected proposals.
 *
 * Two scoping paths:
 *   - Store triggers (triggerType contains "store"): scope via stores in the org
 *     (aiTrainingData.entityId is the store ID).
 *   - Non-store triggers (proposals, invoices, clients, orders): scope via
 *     the owner's userId on aiTrainingData.userId, since the entityId is not
 *     a store and has no direct org linkage on this table.
 */

import { getDb } from "../db";
import { aiTrainingData, stores } from "../../drizzle/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getLogger } from "./logger";

const log = getLogger("agentMemory");

const MEMORY_WINDOW_ROWS = 5;

/**
 * Build a memory context string from recent training data for this org and trigger type.
 * Returns a human-readable summary of recent outcomes, or empty string if none found.
 *
 * @param organizationId  Org scope for store-type triggers. Pass 0 when there's no org.
 * @param triggerType     Trigger label (e.g. "store_created", "proposal_viewed").
 * @param ownerId         Owner user ID. Required for non-store triggers; ignored for store triggers.
 */
export async function getAgentMemoryContext(
  organizationId: number,
  triggerType: string,
  ownerId?: number,
): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return "";

    const isStoreTrigger = triggerType.includes("store");

    type MemoryRow = {
      entityId: number;
      aiOutput: unknown;
      wasAccepted: boolean | null;
      wasEdited: boolean | null;
      createdAt: Date;
    };

    let rows: MemoryRow[] = [];

    if (isStoreTrigger) {
      rows = await db
        .select({
          entityId: aiTrainingData.entityId,
          aiOutput: aiTrainingData.aiOutput,
          wasAccepted: aiTrainingData.wasAccepted,
          wasEdited: aiTrainingData.wasEdited,
          createdAt: aiTrainingData.createdAt,
        })
        .from(aiTrainingData)
        .where(
          and(
            eq(aiTrainingData.entityType, `agent_${triggerType}`),
            // aiTrainingData lacks organizationId — scope via entityId (store ID) belonging to the org
            inArray(
              aiTrainingData.entityId,
              db.select({ id: stores.id }).from(stores).where(eq(stores.organizationId, organizationId)),
            ),
          ),
        )
        .orderBy(desc(aiTrainingData.createdAt))
        .limit(MEMORY_WINDOW_ROWS);
    } else {
      // Non-store trigger: scope by owner userId, since entityId isn't a store
      // and can't be joined back to an org through stores.
      if (!ownerId) return "";
      rows = await db
        .select({
          entityId: aiTrainingData.entityId,
          aiOutput: aiTrainingData.aiOutput,
          wasAccepted: aiTrainingData.wasAccepted,
          wasEdited: aiTrainingData.wasEdited,
          createdAt: aiTrainingData.createdAt,
        })
        .from(aiTrainingData)
        .where(
          and(
            eq(aiTrainingData.entityType, `agent_${triggerType}`),
            eq(aiTrainingData.userId, ownerId),
          ),
        )
        .orderBy(desc(aiTrainingData.createdAt))
        .limit(MEMORY_WINDOW_ROWS);
    }

    if (rows.length === 0) return "";

    const entries = rows.map((row) => {
      const output = row.aiOutput as Record<string, unknown> | null;
      const summary = (output?.summary as string) ?? "unknown proposal";
      const accepted = row.wasAccepted ? "accepted" : "not accepted";
      const edited = row.wasEdited ? " (edited)" : "";
      const date = row.createdAt ? new Date(row.createdAt).toISOString().split("T")[0] : "unknown date";
      return `- [${date}] "${summary}" → ${accepted}${edited}`;
    });

    return `Recent ${triggerType} proposals for this organization:\n${entries.join("\n")}`;
  } catch (err: unknown) {
    log.warn("[agentMemory] Failed to retrieve memory context:", err);
    return "";
  }
}
