/**
 * One-off — call analyzeProductImage + persist for the 3 Yan Financial
 * demo products so Phase 6 visual verification has real placement data.
 *
 * Mirrors `runAnalysisAndPersist` from the service but with no orgScope
 * (we own the DB connection from a script). Does not honor
 * manual_override skip — these are demo products and Phase 6 verification
 * is the use-case.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { analyzeProductImage } from "../../server/services/webstore-imprint-placement";

const TARGET_IDS = [63, 64, 66];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  for (const id of TARGET_IDS) {
    const rows = await db.execute(sql`
      SELECT id, name, imageUrl FROM products WHERE id = ${id}
    `);
    const product = (rows[0] as any[])[0];
    if (!product) {
      console.log(`✗ id=${id} not found`);
      continue;
    }
    if (!product.imageUrl) {
      console.log(`✗ id=${id} ${product.name} — no image`);
      continue;
    }

    console.log(`→ id=${id} ${product.name}`);
    console.log(`  image: ${product.imageUrl}`);

    const t0 = Date.now();
    const placement = await analyzeProductImage(product.imageUrl, product.id);
    const ms = Date.now() - t0;

    if (!placement) {
      console.log(`  ✗ vision_failed in ${ms}ms`);
      continue;
    }

    console.log(`  ✓ analyzed in ${ms}ms`);
    console.log(`    zone:       ${placement.zone}`);
    console.log(`    coords:     x=${placement.x.toFixed(4)}, y=${placement.y.toFixed(4)}, w=${placement.width.toFixed(4)}, h=${placement.height.toFixed(4)}`);
    console.log(`    blendMode:  ${placement.blendMode}`);
    console.log(`    confidence: ${placement.confidence.toFixed(2)}`);

    await db.execute(sql`
      UPDATE products
      SET webstoreImprintPlacementX = ${placement.x.toFixed(4)},
          webstoreImprintPlacementY = ${placement.y.toFixed(4)},
          webstoreImprintPlacementWidth = ${placement.width.toFixed(4)},
          webstoreImprintPlacementHeight = ${placement.height.toFixed(4)},
          webstoreImprintPlacementZone = ${placement.zone},
          webstoreImprintPlacementBlendMode = ${placement.blendMode},
          webstoreImprintPlacementConfidence = ${placement.confidence.toFixed(2)},
          webstoreImprintPlacementAnalyzedAt = NOW(),
          webstoreImprintPlacementSource = 'ai'
      WHERE id = ${product.id}
    `);
    console.log(`  ✓ persisted`);
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
