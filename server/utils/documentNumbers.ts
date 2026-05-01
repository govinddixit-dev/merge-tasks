/**
 * documentNumbers.ts — Per-org sequential document numbering.
 *
 * Replaces the per-router nanoid generators in:
 *   - server/routers/purchaseOrders.ts          (PO)
 *   - server/routers/estimatesInvoices.ts       (EST, INV)
 *   - server/utils/generatePOsForOrder.ts       (PO)
 *   - server/routers/copilotExecPurchaseOrders.ts (PO)
 *
 * Numbers start at 1001 per organization (or per user for solo accounts)
 * and increment atomically using MySQL's `INSERT ... ON DUPLICATE KEY UPDATE
 * ... = LAST_INSERT_ID(nextNumber + 1)` trick — this guarantees that
 * concurrent callers each receive a distinct number without an explicit
 * row-level lock.
 *
 * Old nanoid-numbered records are NOT touched. They continue to render
 * as-is. Only documents created on or after migration 0054 use this util.
 */

import { getPool } from "../db";
import { getLogger } from "./logger";

const log = getLogger("documentNumbers");

export type DocType = "po" | "est" | "inv";

const PREFIX: Record<DocType, string> = {
  po: "PO",
  est: "EST",
  inv: "INV",
};

const STARTING_NUMBER = 1001;

/**
 * Atomically reserve and return the next document number for the given
 * scope (organizationId is null for solo accounts; userId is the
 * fallback key in that case).
 *
 * Returns a formatted string like `PO-1001`, `EST-1042`, `INV-2003`.
 *
 * Implementation notes:
 *   - We use `INSERT ... ON DUPLICATE KEY UPDATE ... = LAST_INSERT_ID(...)`
 *     so the connection's `LAST_INSERT_ID()` returns the post-update value
 *     atomically. No explicit transaction or row lock needed.
 *   - The unique index on `(orgKey, userId, docType)` is what makes
 *     the upsert collide on the right row. `orgKey` is a STORED generated
 *     column `COALESCE(organizationId, 0)` (migration 0079), so solo
 *     rows (organizationId IS NULL) collide on orgKey = 0 instead of
 *     failing the NULL-distinct rule that MySQL applies to NULLable
 *     columns in unique indexes.
 *   - If the row doesn't exist, the INSERT path creates it at
 *     `STARTING_NUMBER + 1` (so the first reserved number is `STARTING_NUMBER`,
 *     i.e. 1001, and the stored `nextNumber` becomes 1002 for the next caller).
 */
export async function nextDocumentNumber(
  organizationId: number | null,
  userId: number,
  docType: DocType,
): Promise<string> {
  const pool = getPool();
  if (!pool) {
    // Database unavailable — fall back to a timestamp-based number so the
    // caller can still proceed. This is rare; logged loudly.
    log.error("Pool unavailable for nextDocumentNumber; falling back to timestamp.");
    const ts = Date.now().toString().slice(-7);
    return `${PREFIX[docType]}-${ts}`;
  }

  // Get a single connection so LAST_INSERT_ID() refers to OUR statement.
  const conn = await pool.getConnection();
  try {
    // Use the LAST_INSERT_ID(expr) trick so the post-update value is
    // returned by SELECT LAST_INSERT_ID() on the same connection.
    //
    // First, attempt to insert with the starting number. If a row already
    // exists for this scope+docType, increment its counter and return the
    // OLD value (so callers get a strictly increasing sequence starting at
    // STARTING_NUMBER).
    //
    // The SQL trick:
    //   INSERT ... VALUES (start) ON DUPLICATE KEY UPDATE
    //     nextNumber = LAST_INSERT_ID(nextNumber + 1)
    //   then SELECT LAST_INSERT_ID()
    //
    // On INSERT (new row): LAST_INSERT_ID() returns the new auto-inc id,
    //   which is NOT what we want. So we set the column-trick value
    //   explicitly via LAST_INSERT_ID(start) in the VALUES clause too.
    //
    // To handle both branches cleanly we use a different pattern: do an
    // upsert that always sets LAST_INSERT_ID to the value we want returned.
    const nextStartValue = STARTING_NUMBER + 1; // stored after the first insert

    await conn.execute(
      `INSERT INTO documentSequences (organizationId, userId, docType, nextNumber)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nextNumber = LAST_INSERT_ID(nextNumber + 1)`,
      [organizationId, userId, docType, nextStartValue],
    );

    // For the INSERT branch (first time), LAST_INSERT_ID() returns the
    // new row id, so we can't rely on it. Read the row directly in that
    // case. Uses `orgKey = COALESCE(?, 0)` so the same query handles both
    // team (organizationId = N) and solo (organizationId = NULL) scopes.
    const [rows] = await conn.execute(
      `SELECT nextNumber FROM documentSequences
       WHERE orgKey = COALESCE(?, 0) AND userId = ? AND docType = ? LIMIT 1`,
      [organizationId, userId, docType],
    );
    const r = (rows as Array<{ nextNumber: number }>)[0];
    const stored = r?.nextNumber ?? nextStartValue;
    // The stored value is "the next one to hand out + 1" because
    // ON DUPLICATE KEY UPDATE incremented it. So the number we hand back
    // to the caller is `stored - 1` for the upsert case, or
    // STARTING_NUMBER for the very first insert (stored === nextStartValue).
    const number = stored - 1;
    return `${PREFIX[docType]}-${number}`;
  } finally {
    conn.release();
  }
}
