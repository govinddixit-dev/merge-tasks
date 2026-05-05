/**
 * One-off: clear the stale Cloudinary processedLogoUrl from the Yan
 * Financial logo, run processLogoForOverlay against it via the new Sharp
 * pipeline, and print the resulting S3 URL.
 */

import "dotenv/config";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../../server/db";
import { clientLogos } from "../../drizzle/schema";
import { processLogoForOverlay } from "../../server/services/logo-background-removal";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const yanRes = await db.execute(sql`SELECT id FROM clients WHERE companyName = 'Yan Financial' ORDER BY id`);
  const yanIds = (yanRes[0] as any[]).map(r => r.id);
  let row: any = null;
  for (const cid of yanIds) {
    const r = await db.execute(sql`SELECT id, clientId, logoUrl, processedLogoUrl, processedAt, isPrimary FROM clientLogos WHERE clientId = ${cid} ORDER BY isPrimary DESC, id DESC LIMIT 1`);
    const cand = (r[0] as any[])[0];
    if (cand) { row = cand; break; }
  }
  if (!row) throw new Error("No Yan Financial logo row found");

  console.log("[1] before:", JSON.stringify(row, null, 2));

  // Wipe the stale Cloudinary URL so getCachedProcessedLogoUrl will re-derive.
  await db
    .update(clientLogos)
    .set({ processedLogoUrl: null, processedAt: null })
    .where(eq(clientLogos.id, row.id));
  console.log("[2] cleared processedLogoUrl on logoId=", row.id);

  console.log("[3] running processLogoForOverlay…");
  const url = await processLogoForOverlay(row.logoUrl);
  console.log("[4] processed URL:", url);

  // Persist via getCachedProcessedLogoUrl too (mirrors render path)
  await db
    .update(clientLogos)
    .set({ processedLogoUrl: url, processedAt: new Date() })
    .where(eq(clientLogos.id, row.id));
  console.log("[5] persisted to clientLogos.processedLogoUrl");

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
