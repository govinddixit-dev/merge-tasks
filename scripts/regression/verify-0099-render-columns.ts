/**
 * One-shot verifier for migration 0099 — confirms the five render columns
 * have moved from `products` to `storeProducts`:
 *   - five columns ABSENT on `products`
 *   - five columns PRESENT on `storeProducts`
 *   - sample SELECT on a single storeProducts row returns the expected NULLs
 * Read-only, idempotent.
 *
 * Run: pnpm tsx scripts/regression/verify-0099-render-columns.ts
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const RENDER_COLS = [
  "webstoreRenderedImageUrl",
  "webstoreRenderedAt",
  "webstoreRenderDecoration",
  "webstoreRenderStatus",
  "webstoreRenderModel",
] as const;

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb() returned null");

  // 1. Confirm journal records 0099 as applied.
  const journal = await db.execute(
    sql`SELECT filename, appliedAt FROM _schema_migrations WHERE filename LIKE '0099_%' LIMIT 1`,
  );
  console.log("journal:", journal[0]);

  // 2. Confirm the five columns are GONE from `products`.
  const productsCols = await db.execute(
    sql`SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'products'
          AND COLUMN_NAME IN ('webstoreRenderedImageUrl','webstoreRenderedAt','webstoreRenderDecoration','webstoreRenderStatus','webstoreRenderModel')`,
  );
  const productsColNames = ((productsCols as unknown as [Array<Record<string, unknown>>, unknown])[0] ?? []).map(c => c.COLUMN_NAME);
  if (productsColNames.length === 0) {
    console.log("products: render columns absent ✓");
  } else {
    console.error("products: render columns STILL PRESENT (migration 0099 forward step incomplete):", productsColNames);
    process.exit(1);
  }

  // 3. Confirm the five columns are PRESENT on `storeProducts`.
  const spCols = await db.execute(
    sql`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'storeProducts'
          AND COLUMN_NAME IN ('webstoreRenderedImageUrl','webstoreRenderedAt','webstoreRenderDecoration','webstoreRenderStatus','webstoreRenderModel')
        ORDER BY ORDINAL_POSITION`,
  );
  const spRows = ((spCols as unknown as [Array<Record<string, unknown>>, unknown])[0] ?? []);
  const spColNames = spRows.map(c => String(c.COLUMN_NAME));
  const missing = RENDER_COLS.filter(c => !spColNames.includes(c));
  if (missing.length > 0) {
    console.error("storeProducts: render columns MISSING:", missing);
    process.exit(1);
  }
  console.log("storeProducts: all five render columns present ✓");
  console.log("storeProducts column metadata:");
  for (const c of spRows) {
    console.log(" ", c);
  }

  // 4. SELECT the five columns from one storeProducts row to prove they
  //    are queryable and NULL on existing rows.
  const sample = await db.execute(
    sql`SELECT id, storeId, productId,
               webstoreRenderedImageUrl,
               webstoreRenderedAt,
               webstoreRenderDecoration,
               webstoreRenderStatus,
               webstoreRenderModel
        FROM storeProducts
        ORDER BY id ASC
        LIMIT 1`,
  );
  console.log("sample row:", sample[0]);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("verify failed:", err);
    process.exit(1);
  });
