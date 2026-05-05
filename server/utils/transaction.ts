/**
 * Transaction Utility
 *
 * Wraps multi-table operations in a MySQL transaction to prevent
 * orphaned rows when cascade deletes fail midway.
 *
 * Usage:
 *   import { withTransaction } from "../utils/transaction";
 *   await withTransaction(async (db) => {
 *     await db.delete(orderItems).where(...);
 *     await db.delete(orders).where(...);
 *   });
 */
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { getPool } from "../db";
import { getLogger } from "./logger";

const log = getLogger("transaction");

/**
 * Execute a callback inside a MySQL transaction.
 * If the callback throws, the transaction is rolled back.
 * If it succeeds, the transaction is committed.
 *
 * The callback receives a Drizzle DB instance bound to the transaction connection.
 */
export async function withTransaction<T>(
  fn: (db: MySql2Database) => Promise<T>
): Promise<T> {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database pool not available for transaction");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const txDb = drizzle(connection);
    const result = await fn(txDb);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    log.error("Transaction rolled back:", error);
    throw error;
  } finally {
    connection.release();
  }
}
