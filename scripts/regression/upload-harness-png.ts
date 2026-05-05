/**
 * Upload the Phase 6 harness PNG to a randomized S3 key for one-shot
 * temporary review. Prints the public URL. The key is logged so it can
 * be deleted via delete-harness-png.ts after the verdict.
 */

import "dotenv/config";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";

async function main() {
  const localPath = path.join(process.cwd(), "tmp-phase6-harness.png");
  const data = await fs.readFile(localPath);

  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET not set");

  const region = process.env.AWS_REGION || "us-east-1";
  const key = `tmp/debug/phase6-harness-${randomUUID()}.png`;

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({ region });
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: data,
    ContentType: "image/png",
    CacheControl: "no-store, max-age=0",
  }));

  const publicUrlBase = process.env.AWS_S3_PUBLIC_URL
    ? process.env.AWS_S3_PUBLIC_URL.replace(/\/$/, "")
    : `https://${bucket}.s3.${region}.amazonaws.com`;
  const url = `${publicUrlBase}/${key}`;

  // Persist the key so the delete script can find it
  await fs.writeFile(path.join(process.cwd(), ".tmp-harness-key.txt"), key, "utf8");

  console.log(`✓ uploaded`);
  console.log(`  bucket: ${bucket}`);
  console.log(`  key:    ${key}`);
  console.log(`  url:    ${url}`);
  console.log(`  bytes:  ${data.length}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
