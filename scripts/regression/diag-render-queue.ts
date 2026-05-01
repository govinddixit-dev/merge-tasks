/**
 * Diagnostic — webstore-product-render BullMQ queue + DB render status.
 * Read-only, idempotent. Mirrors the diag-imprint-zones.ts pattern.
 *
 * Run: pnpm tsx scripts/regression/diag-render-queue.ts
 *
 * Three views in one shot:
 *   1. DB-side: storeProducts grouped by webstoreRenderStatus (post-0099,
 *      per-binding render columns)
 *   2. Redis-side: BullMQ queue counts (waiting/active/completed/failed/delayed)
 *   3. pm2-side: not covered (pm2 list is a separate `pm2 list` invocation —
 *      this script does not shell out)
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { webstoreRenderQueue } from "../../server/queue/webstore-render-queue";

async function main() {
  // 1. DB-side render status distribution.
  const db = await getDb();
  if (!db) throw new Error("getDb() returned null");
  const rows = await db.execute(
    sql`SELECT
          COALESCE(webstoreRenderStatus, 'NULL') AS status,
          COUNT(*) AS n
        FROM storeProducts
        GROUP BY webstoreRenderStatus
        ORDER BY n DESC`,
  );
  console.log("DB render status distribution:");
  for (const r of rows as Array<Record<string, unknown>>) {
    console.log(" ", r);
  }
  const renderingRow = (rows as Array<Record<string, unknown>>).find((r) => r.status === "rendering");
  console.log(`Rendering-state rows: ${renderingRow ? renderingRow.n : 0} (orphan candidates if worker is idle — see Followup R)`);

  // 2. Redis-side BullMQ counts.
  try {
    const counts = await webstoreRenderQueue.getJobCounts(
      "wait",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
    );
    console.log("BullMQ queue counts:", counts);
  } catch (err) {
    console.error("queue counts failed (Redis unreachable?):", (err as Error).message);
  }

  // Always close the queue's Redis connection so the script exits cleanly.
  await webstoreRenderQueue.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("diag failed:", err);
    process.exit(1);
  });
