import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { webstoreRenderQueue } from "../../server/queue/webstore-render-queue";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");

  const rows: any = await db.execute(sql`
    SELECT sp.id AS spId, sp.storeId, sp.productId,
           p.name AS productName,
           sp.webstoreRenderStatus AS status,
           sp.webstoreRenderedAt,
           sp.webstoreRenderDecoration AS decoration,
           sp.webstoreRenderModel AS model,
           sp.webstoreRenderedImageUrl AS url,
           s.slug AS storeSlug, s.clientId
    FROM storeProducts sp
    LEFT JOIN products p ON p.id = sp.productId
    LEFT JOIN stores s ON s.id = sp.storeId
    ORDER BY sp.id`);
  console.log("All 5 storeProducts bindings:");
  for (const r of rows[0]) console.log(JSON.stringify(r, null, 2));

  console.log("\nQueue counts:");
  console.log(" ", await webstoreRenderQueue.getJobCounts("wait", "active", "completed", "failed", "delayed", "paused"));

  // clientId=10 logo lookup
  const logos: any = await db.execute(sql`
    SELECT id, clientId, isPrimary, processedLogoUrl, logoUrl
    FROM clientLogos WHERE clientId = 10 ORDER BY isPrimary DESC, createdAt DESC LIMIT 3`);
  console.log("\nclientLogos for clientId=10 (Yan Financial):");
  for (const l of logos[0]) console.log(" ", l);

  await webstoreRenderQueue.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
