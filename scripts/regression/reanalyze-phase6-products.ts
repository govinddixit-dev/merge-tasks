/**
 * Re-analyze Phase 6 demo products with the tightened category-specific
 * placement prompt. Captures old coordinates, runs analyzeProductImage
 * directly (bypasses runAnalysisAndPersist's manual_override skip), writes
 * new coordinates, and prints an old-vs-new diff table.
 */

import "dotenv/config";
import { sql, eq, and } from "drizzle-orm";
import { getDb } from "../../server/db";
import { products } from "../../drizzle/schema";
import { analyzeProductImage } from "../../server/services/webstore-imprint-placement";

const TARGET_IDS = [63, 64, 66];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const beforeRes = await db.execute(sql`
    SELECT id, name, imageUrl,
           webstoreImprintPlacementX  AS x,
           webstoreImprintPlacementY  AS y,
           webstoreImprintPlacementWidth  AS w,
           webstoreImprintPlacementHeight AS h,
           webstoreImprintPlacementZone AS zone,
           webstoreImprintPlacementBlendMode AS blendMode,
           webstoreImprintPlacementConfidence AS confidence,
           webstoreImprintPlacementSource AS source
    FROM products
    WHERE id IN (${sql.raw(TARGET_IDS.join(","))})
    ORDER BY id
  `);
  const before = beforeRes[0] as any[];

  const summary: any[] = [];

  for (const row of before) {
    console.log(`\n→ Re-analyzing id=${row.id} (${row.name})`);
    const placement = await analyzeProductImage(row.imageUrl, row.id);
    if (!placement) {
      console.warn(`  ✗ analyze failed — keeping old placement`);
      summary.push({ id: row.id, name: row.name, status: "failed", before: row, after: null });
      continue;
    }
    await db
      .update(products)
      .set({
        webstoreImprintPlacementX: placement.x.toFixed(4),
        webstoreImprintPlacementY: placement.y.toFixed(4),
        webstoreImprintPlacementWidth: placement.width.toFixed(4),
        webstoreImprintPlacementHeight: placement.height.toFixed(4),
        webstoreImprintPlacementZone: placement.zone,
        webstoreImprintPlacementBlendMode: placement.blendMode,
        webstoreImprintPlacementConfidence: placement.confidence.toFixed(2),
        webstoreImprintPlacementAnalyzedAt: new Date(),
        webstoreImprintPlacementSource: "ai",
      })
      .where(eq(products.id, row.id));
    summary.push({ id: row.id, name: row.name, status: "ok", before: row, after: placement });
  }

  console.log(`\n\n═══════════ OLD vs NEW ═══════════\n`);
  for (const s of summary) {
    console.log(`▸ id=${s.id}  ${s.name}`);
    if (!s.after) {
      console.log(`  status: FAILED (no new coords)`);
      console.log(`  old: x=${fmt(s.before.x)} y=${fmt(s.before.y)} w=${fmt(s.before.w)} h=${fmt(s.before.h)} zone=${s.before.zone} blend=${s.before.blendMode} conf=${s.before.confidence}`);
      continue;
    }
    console.log(`  old: x=${fmt(s.before.x)} y=${fmt(s.before.y)} w=${fmt(s.before.w)} h=${fmt(s.before.h)} zone=${s.before.zone} blend=${s.before.blendMode} conf=${s.before.confidence}`);
    console.log(`  new: x=${s.after.x.toFixed(4)} y=${s.after.y.toFixed(4)} w=${s.after.width.toFixed(4)} h=${s.after.height.toFixed(4)} zone=${s.after.zone} blend=${s.after.blendMode} conf=${s.after.confidence.toFixed(2)}`);
  }
  process.exit(0);
}

function fmt(v: any) {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n.toFixed(4) : String(v);
}

main().catch(err => { console.error(err); process.exit(1); });
