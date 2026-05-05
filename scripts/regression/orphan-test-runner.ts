/**
 * Followup R Phase 6 Part B helper — orphan reconciliation E2E test.
 *
 * Usage:
 *   pnpm tsx scripts/regression/orphan-test-runner.ts <action> <id>
 *
 *   action:
 *     capture          — SELECT row, print all 8 columns
 *     flip-rendering   — UPDATE webstoreRenderStatus='rendering', then SELECT
 *     flip-complete    — UPDATE webstoreRenderStatus='complete', then SELECT
 *
 * Prints exactly one JSON line per row read so the parent narration can
 * pick up the state without parsing dotenv noise.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function main() {
  const action = process.argv[2];
  const id = Number(process.argv[3]);
  if (!action || !Number.isFinite(id)) {
    throw new Error("usage: orphan-test-runner.ts <capture|flip-rendering|flip-complete> <id>");
  }

  const db = await getDb();
  if (!db) throw new Error("getDb() returned null");

  if (action === "flip-rendering") {
    await db.execute(sql`UPDATE storeProducts SET webstoreRenderStatus='rendering' WHERE id=${id}`);
  } else if (action === "flip-complete") {
    await db.execute(sql`UPDATE storeProducts SET webstoreRenderStatus='complete' WHERE id=${id}`);
  } else if (action !== "capture") {
    throw new Error(`unknown action: ${action}`);
  }

  const result = await db.execute(
    sql`SELECT id, storeId, productId, webstoreRenderStatus,
               webstoreRenderedImageUrl, webstoreRenderedAt,
               webstoreRenderDecoration, webstoreRenderModel
        FROM storeProducts
        WHERE id=${id}`,
  );
  // mysql2 driver returns [rows, fields]; the iterable also yields the
  // fields object, so grab data[0] explicitly to avoid leaking metadata.
  const dataRows = (result as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const row of dataRows) {
    console.log("ROW:" + JSON.stringify(row));
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("script failed:", err);
  process.exit(1);
});
