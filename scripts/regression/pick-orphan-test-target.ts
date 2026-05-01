/**
 * Followup R Phase 6 Part B helper — pick a storeProduct in 'complete'
 * state with a non-null webstoreRenderedImageUrl as the orphan-test
 * target. Read-only.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb() returned null");

  const candidates = await db.execute(
    sql`SELECT id, storeId, productId, webstoreRenderStatus,
               webstoreRenderedImageUrl, webstoreRenderedAt,
               webstoreRenderDecoration, webstoreRenderModel
        FROM storeProducts
        WHERE webstoreRenderStatus = 'complete'
          AND webstoreRenderedImageUrl IS NOT NULL
        ORDER BY id ASC`,
  );

  console.log("Eligible candidates (complete + has rendered image):");
  for (const row of candidates as Array<Record<string, unknown>>) {
    console.log(JSON.stringify(row));
  }

  const all = await db.execute(
    sql`SELECT COALESCE(webstoreRenderStatus,'NULL') AS status, COUNT(*) AS n
        FROM storeProducts
        GROUP BY webstoreRenderStatus`,
  );
  console.log("\nFull status distribution:");
  for (const row of all as Array<Record<string, unknown>>) {
    console.log(JSON.stringify(row));
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("script failed:", err);
  process.exit(1);
});
