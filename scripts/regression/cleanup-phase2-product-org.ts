/**
 * Verify products.organizationId distribution — critical for tenant
 * isolation analysis.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb null");

  console.log("=== products grouped by (userId, organizationId) ===");
  const r = await db.execute(sql`
    SELECT userId, organizationId, COUNT(*) AS n
    FROM products
    GROUP BY userId, organizationId
    ORDER BY n DESC
  `);
  const rows = (r as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const row of rows) console.log("  " + JSON.stringify(row));

  console.log("\n=== organizations.ownerId for org 23 ===");
  const o = await db.execute(sql`SELECT id, name, ownerId FROM organizations WHERE id = 23`);
  const oRows = (o as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const row of oRows) console.log("  " + JSON.stringify(row));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
