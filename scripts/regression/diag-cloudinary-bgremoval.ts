/**
 * One-off diagnostic for Cloudinary background removal on the Yan Financial
 * primary logo. Captures:
 *   1. The clientLogos row (id, logoUrl, processedLogoUrl, processedAt)
 *   2. Full upload response from cloudinary.uploader.upload
 *   3. Full delivery URL fetch (HTTP status + response headers + first 200
 *      bytes of body)
 *   4. The current persisted processedLogoUrl after a fresh getCachedProcessedLogoUrl call
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { v2 as cloudinary } from "cloudinary";
import { getDb } from "../../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Find Yan Financial primary logo row
  const yanRes = await db.execute(sql`SELECT id FROM clients WHERE companyName = 'Yan Financial' ORDER BY id`);
  const yanIds = (yanRes[0] as any[]).map(r => r.id);
  let row: any = null;
  for (const cid of yanIds) {
    const r = await db.execute(sql`SELECT id, clientId, logoUrl, processedLogoUrl, processedAt, isPrimary FROM clientLogos WHERE clientId = ${cid} ORDER BY isPrimary DESC, id DESC LIMIT 1`);
    const cand = (r[0] as any[])[0];
    if (cand) { row = cand; break; }
  }
  if (!row) throw new Error("No Yan Financial logo row found");

  console.log("\n[1] clientLogos row before:");
  console.log(JSON.stringify(row, null, 2));

  // Configure Cloudinary
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
    api_key: process.env.CLOUDINARY_API_KEY!,
    api_secret: process.env.CLOUDINARY_API_SECRET!,
    secure: true,
  });

  console.log("\n[2] Calling cloudinary.uploader.upload (no add-on at upload time)…");
  let upload: any = null;
  try {
    upload = await cloudinary.uploader.upload(row.logoUrl, {
      folder: "mergetasks/processed-logos-diag",
    });
    console.log("FULL UPLOAD RESPONSE:");
    console.log(JSON.stringify(upload, null, 2));
  } catch (err: any) {
    console.log("UPLOAD THREW:");
    console.log(JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}), 2));
  }

  if (!upload?.public_id) {
    console.log("\n[!] No public_id, aborting URL test.");
    process.exit(1);
  }

  // Build delivery URL with e_background_removal
  const deliveryUrl = cloudinary.url(upload.public_id, {
    secure: true,
    format: "png",
    transformation: [
      { effect: "background_removal" },
      { effect: "trim:10" },
    ],
  });
  console.log("\n[3] Delivery URL:", deliveryUrl);

  // Fetch with details — Pixelz is async; first response may be 423 / 200
  // with a "still processing" payload.
  for (const attempt of [1, 2, 3]) {
    console.log(`\n[4.${attempt}] HEAD ${deliveryUrl}`);
    const headRes = await fetch(deliveryUrl, { method: "HEAD" });
    console.log(`  status: ${headRes.status} ${headRes.statusText}`);
    console.log(`  content-type: ${headRes.headers.get("content-type")}`);
    console.log(`  content-length: ${headRes.headers.get("content-length")}`);
    console.log(`  x-cld-error: ${headRes.headers.get("x-cld-error")}`);
    console.log(`  server-timing(content-info): ${headRes.headers.get("server-timing")?.split(",").find(s => s.includes("content-info")) ?? "—"}`);
    if (headRes.status === 200) break;
    await new Promise(r => setTimeout(r, 4000));
  }

  // GET first bytes for sanity
  console.log(`\n[5] GET first 64 bytes`);
  const getRes = await fetch(deliveryUrl);
  const ab = await getRes.arrayBuffer();
  const buf = Buffer.from(ab);
  console.log(`  body size: ${buf.length} bytes`);
  console.log(`  first 16 bytes hex: ${buf.subarray(0, 16).toString("hex")}`);
  console.log(`  PNG signature?: ${buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"}`);

  console.log(`\n[6] Try alternate transformation order: e_trim:10 then e_background_removal`);
  const altUrl = cloudinary.url(upload.public_id, {
    secure: true,
    format: "png",
    transformation: [
      { effect: "trim:10" },
      { effect: "background_removal" },
    ],
  });
  console.log("  url:", altUrl);
  const altHead = await fetch(altUrl, { method: "HEAD" });
  console.log(`  status: ${altHead.status}  content-type: ${altHead.headers.get("content-type")}  bytes: ${altHead.headers.get("content-length")}`);

  console.log(`\n[7] Also try just e_background_removal alone (no trim)`);
  const bareUrl = cloudinary.url(upload.public_id, {
    secure: true,
    format: "png",
    transformation: [{ effect: "background_removal" }],
  });
  console.log("  url:", bareUrl);
  const bareHead = await fetch(bareUrl, { method: "HEAD" });
  console.log(`  status: ${bareHead.status}  content-type: ${bareHead.headers.get("content-type")}  bytes: ${bareHead.headers.get("content-length")}`);

  console.log(`\n[8] Cloudinary AI (newer free option)`);
  const aiUrl = cloudinary.url(upload.public_id, {
    secure: true,
    format: "png",
    transformation: [{ effect: "background_removal:cloudinary_ai" }],
  });
  console.log("  url:", aiUrl);
  const aiHead = await fetch(aiUrl, { method: "HEAD" });
  console.log(`  status: ${aiHead.status}  content-type: ${aiHead.headers.get("content-type")}  bytes: ${aiHead.headers.get("content-length")}  x-cld-error: ${aiHead.headers.get("x-cld-error") ?? "—"}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
