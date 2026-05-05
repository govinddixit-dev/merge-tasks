/**
 * Comprehensive FK-children audit for the test-data-wipe script.
 * Lists every FK that references each table we're about to delete from,
 * so we can identify missing child-table cleanups.
 *
 * Read-only.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const PARENT_TABLES = [
  "proposals", "invoices", "estimates", "purchaseOrders", "orders",
  "audit_log", "distributorProfiles", "clientLogos", "clientContacts",
  "clientAssets", "clientProductConfig", "virtualProofs",
  "proposalProducts", "storeProducts", "storeUsers",
  // round 2: tables added to script after first FK gap discovery
  "proposalVersions", "departmentApprovals", "proposalOrderItems",
  "orderItems", "promoCodeUsages", "refund_requests",
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb null");

  for (const parent of PARENT_TABLES) {
    console.log(`\n=== Children of ${parent} ===`);
    const r = await db.execute(sql`
      SELECT k.TABLE_NAME, k.COLUMN_NAME, r.DELETE_RULE
      FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
        AND k.TABLE_SCHEMA = r.CONSTRAINT_SCHEMA
      WHERE k.TABLE_SCHEMA = DATABASE()
        AND k.REFERENCED_TABLE_NAME = ${parent}
      ORDER BY k.TABLE_NAME
    `);
    const rows = (r as unknown as [Array<Record<string, unknown>>, unknown])[0];
    if (rows.length === 0) {
      console.log("  (no FK children)");
    } else {
      for (const row of rows) {
        const ruleMark = row.DELETE_RULE === "CASCADE" ? "✓ cascade" : row.DELETE_RULE === "SET NULL" ? "○ set-null" : "⚠ NO ACTION";
        console.log(`  ${ruleMark}  ${row.TABLE_NAME}.${row.COLUMN_NAME}`);
      }
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
