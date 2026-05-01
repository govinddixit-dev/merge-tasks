/**
 * One-shot verifier for migration 0098 — confirms the five new render
 * columns exist on `products` and that a SELECT on a single row returns
 * the expected NULLs. Read-only, idempotent.
 *
 * Run: pnpm tsx scripts/regression/verify-0098-render-columns.ts
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb() returned null");

  // 1. Confirm journal records 0098 as applied.
  const journal = await db.execute(
    sql`SELECT filename, appliedAt FROM _schema_migrations WHERE filename LIKE '0098_%' LIMIT 1`,
  );
  console.log("journal:", journal[0]);

  // 2. SELECT the five columns from one product row to prove they exist
  //    and are NULL on existing rows.
  const sample = await db.execute(
    sql`SELECT id,
               webstoreRenderedImageUrl,
               webstoreRenderedAt,
               webstoreRenderDecoration,
               webstoreRenderStatus,
               webstoreRenderModel
        FROM products
        ORDER BY id ASC
        LIMIT 1`,
  );
  console.log("sample row:", sample[0]);

  // 3. Also dump the column metadata so we can eyeball types.
  const cols = await db.execute(
    sql`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'products'
          AND COLUMN_NAME IN (
            'webstoreRenderedImageUrl',
            'webstoreRenderedAt',
            'webstoreRenderDecoration',
            'webstoreRenderStatus',
            'webstoreRenderModel'
          )
        ORDER BY ORDINAL_POSITION`,
  );
  console.log("column metadata:");
  for (const c of cols as Array<Record<string, unknown>>) {
    console.log(" ", c);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("verify failed:", err);
    process.exit(1);
  });
