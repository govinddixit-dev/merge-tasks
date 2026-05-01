/**
 * One-off — locate the Yan Financial demo products (OGIO Crunch Duffel,
 * Nike Polo, Nike Shirt) so Phase 6 visual verification can target their
 * specific product IDs.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const yanClients = await db.execute(sql`
    SELECT id, companyName FROM clients WHERE companyName LIKE '%Yan%'
  `);
  console.log("=== Yan-* clients ===");
  console.log(yanClients[0]);

  const yanStores = await db.execute(sql`
    SELECT id, name, slug, clientId FROM stores WHERE name LIKE '%Yan%' OR slug LIKE '%yan%'
  `);
  console.log("\n=== Yan-* stores ===");
  console.log(yanStores[0]);

  const ogioMatches = await db.execute(sql`
    SELECT id, name, category, imageUrl FROM products
    WHERE name LIKE '%OGIO%' OR name LIKE '%Crunch%'
    LIMIT 20
  `);
  console.log("\n=== OGIO / Crunch products ===");
  for (const r of ogioMatches[0] as any[]) {
    console.log(`  id=${r.id}  ${r.name}  cat=${r.category}  img=${r.imageUrl ? "yes" : "no"}`);
  }

  const nikeMatches = await db.execute(sql`
    SELECT id, name, category, imageUrl FROM products
    WHERE name LIKE '%Nike%' AND (name LIKE '%Polo%' OR name LIKE '%Shirt%')
    LIMIT 20
  `);
  console.log("\n=== Nike Polo / Shirt products ===");
  for (const r of nikeMatches[0] as any[]) {
    console.log(`  id=${r.id}  ${r.name}  cat=${r.category}  img=${r.imageUrl ? "yes" : "no"}`);
  }

  // If we found Yan stores, list each store's products
  for (const s of (yanStores[0] as any[])) {
    const sp = await db.execute(sql`
      SELECT p.id, p.name, p.imageUrl
      FROM storeProducts sp
      INNER JOIN products p ON p.id = sp.productId
      WHERE sp.storeId = ${s.id}
    `);
    console.log(`\n=== Products in store id=${s.id} slug='${s.slug}' name='${s.name}' ===`);
    for (const r of sp[0] as any[]) {
      console.log(`  id=${r.id}  ${r.name}  img=${r.imageUrl ? "yes" : "no"}`);
    }
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
