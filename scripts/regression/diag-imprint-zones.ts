/**
 * Diagnostic — productImprintZones / imprintZonePresets population.
 * Re-run after the Phase 6 freeze. Read-only.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  productImprintZones,
  imprintZonePresets,
  products,
  productImprintZoneDecorations,
} from "../../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // 1. productImprintZones — total rows + product coverage
  const [zoneTotal] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(productImprintZones);

  const [productsTotal] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(products);

  const [productsWithZones] = await db
    .select({ n: sql<number>`COUNT(DISTINCT productId)` })
    .from(productImprintZones);

  const [decoLinks] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(productImprintZoneDecorations);

  // 2. imprintZonePresets count
  const [presetTotal] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(imprintZonePresets);

  const [presetActive] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(imprintZonePresets)
    .where(sql`isActive = TRUE`);

  // 3. Sample slugs from each table (for vocabulary comparison)
  const sampleZoneSlugs = await db
    .select({ slug: productImprintZones.slug, label: productImprintZones.label })
    .from(productImprintZones)
    .limit(15);

  const samplePresetSlugs = await db
    .select({ slug: imprintZonePresets.slug, label: imprintZonePresets.label, category: imprintZonePresets.category })
    .from(imprintZonePresets)
    .limit(15);

  // 4. Compare to webstoreImprintPlacement* coverage on products
  const [productsWithAIPlacement] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(products)
    .where(sql`webstoreImprintPlacementAnalyzedAt IS NOT NULL`);

  const [productsWithAIZone] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(products)
    .where(sql`webstoreImprintPlacementZone IS NOT NULL`);

  const sampleAIZones = await db
    .select({ zone: products.webstoreImprintPlacementZone })
    .from(products)
    .where(sql`webstoreImprintPlacementZone IS NOT NULL`)
    .limit(15);

  console.log("=== productImprintZones ===");
  console.log(`zones rows:          ${zoneTotal.n}`);
  console.log(`products total:      ${productsTotal.n}`);
  console.log(`products with zones: ${productsWithZones.n}  (coverage = ${
    productsTotal.n > 0 ? ((Number(productsWithZones.n) / Number(productsTotal.n)) * 100).toFixed(1) : "n/a"
  }%)`);
  console.log(`decoration links:    ${decoLinks.n}`);
  console.log("");
  console.log("=== imprintZonePresets ===");
  console.log(`preset rows total:   ${presetTotal.n}`);
  console.log(`preset rows active:  ${presetActive.n}`);
  console.log("");
  console.log("=== Webstore AI placement (Phase 2-5) ===");
  console.log(`products analyzed:   ${productsWithAIPlacement.n}`);
  console.log(`products with zone:  ${productsWithAIZone.n}`);
  console.log("");
  console.log("=== Sample productImprintZones slugs (vocabulary) ===");
  for (const r of sampleZoneSlugs) console.log(`  ${r.slug}  | ${r.label}`);
  console.log("");
  console.log("=== Sample imprintZonePresets slugs (vocabulary) ===");
  for (const r of samplePresetSlugs) console.log(`  ${r.slug}  | ${r.label}  | ${r.category ?? "—"}`);
  console.log("");
  console.log("=== Sample webstoreImprintPlacementZone values (vocabulary) ===");
  for (const r of sampleAIZones) console.log(`  ${r.zone}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
