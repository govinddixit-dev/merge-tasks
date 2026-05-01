/**
 * Pre-flight column-existence probe for the test-data-wipe script.
 * Queries information_schema for every (table, column) pair referenced in
 * SET, WHERE, and SELECT clauses of wipe-test-data-2026-04-27.ts.
 *
 * Closes the gap that bit us twice today: dry-run mode validates row
 * counts and WHERE clauses but NOT UPDATE SET column names. This script
 * does what dry-run can't.
 *
 * Read-only.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

// Every (table, column) pair the cleanup script references in any
// non-FROM-only context (WHERE, SET, SELECT-projection).
const COLUMN_REFS: Array<{ table: string; column: string; usedIn: string }> = [
  // UPDATE SET
  { table: "products",          column: "userId",    usedIn: "Step 7 UPDATE SET + WHERE" },
  { table: "documentSequences", column: "userId",    usedIn: "Step 11.3/11.4 WHERE" },
  { table: "documentSequences", column: "nextNumber", usedIn: "Step 11.4 SET" },
  // DELETE WHERE
  { table: "distributorProfiles", column: "userId", usedIn: "Step 11.1 WHERE" },
  { table: "users",             column: "id",       usedIn: "Step 11.5 WHERE / verification" },
  // Verification SELECTs
  { table: "organizations",     column: "id",       usedIn: "verification SELECT" },
  { table: "organizations",     column: "ownerId",  usedIn: "verification SELECT" },
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb null");

  console.log("=== COLUMN-EXISTENCE PROBE ===\n");

  let failed = 0;
  for (const { table, column, usedIn } of COLUMN_REFS) {
    const r = await db.execute(sql`
      SELECT COUNT(*) AS n
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ${table}
        AND COLUMN_NAME = ${column}
    `);
    const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
    const exists = Number(rows[0].n) === 1;
    const mark = exists ? "✓" : "✗";
    console.log(`  ${mark} ${table}.${column.padEnd(15)} (${usedIn})`);
    if (!exists) failed++;
  }

  console.log("");
  if (failed > 0) {
    console.log(`✗ ${failed} column(s) not found — script will fail at execute time. Fix before retry.`);
    process.exit(1);
  } else {
    console.log("✓ All column references validated against schema.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
