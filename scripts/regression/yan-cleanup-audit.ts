/**
 * Followup K Phase 1 read-only audit — surface every Yan Financial-related
 * row across stores, clientLogos, clients, storeProducts, storeUsers.
 *
 * Read-only. No mutations.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb() returned null");

  const sections: Array<{ title: string; query: ReturnType<typeof sql> }> = [
    {
      title: "1. Yan-related stores (slug match OR clientId in {1,6,10})",
      query: sql`SELECT id, slug, name, clientId, storeStatus, organizationId, createdAt
                 FROM stores
                 WHERE slug LIKE '%yan%' OR clientId IN (1, 6, 10)
                 ORDER BY id`,
    },
    {
      title: "2. clientLogos for clientId in {1,6,10}",
      query: sql`SELECT id, clientId, logoUrl, processedLogoUrl, isPrimary, createdAt, processedAt
                 FROM clientLogos
                 WHERE clientId IN (1, 6, 10)
                 ORDER BY clientId, id`,
    },
    {
      title: "3. clients id in {1,6,10}",
      query: sql`SELECT id, companyName, organizationId
                 FROM clients
                 WHERE id IN (1, 6, 10)
                 ORDER BY id`,
    },
    {
      title: "4. storeProducts bindings for Yan-slug stores",
      query: sql`SELECT sp.id, sp.storeId, sp.productId, sp.webstoreRenderStatus,
                        sp.webstoreRenderedImageUrl, s.slug
                 FROM storeProducts sp
                 JOIN stores s ON s.id = sp.storeId
                 WHERE s.slug LIKE '%yan%'
                 ORDER BY sp.storeId, sp.productId`,
    },
    {
      title: "5. storeUsers for Yan-slug stores",
      query: sql`SELECT su.id, su.storeId, su.email, su.storeUserRole, su.storeUserStatus, s.slug
                 FROM storeUsers su
                 JOIN stores s ON s.id = su.storeId
                 WHERE s.slug LIKE '%yan%'
                 ORDER BY su.storeId`,
    },
  ];

  for (const { title, query } of sections) {
    console.log(`\n=== ${title} ===`);
    const result = await db.execute(query);
    // mysql2 driver returns [rows, fields]; rows[0] is the data array.
    const rows = (result as unknown as [Array<Record<string, unknown>>, unknown])[0];
    if (rows.length === 0) {
      console.log("  (no rows)");
    } else {
      for (const row of rows) console.log("  " + JSON.stringify(row));
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});
