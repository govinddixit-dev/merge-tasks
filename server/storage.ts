/**
 * storage.ts — Unified File Storage Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Routes file operations to S3 (when AWS_S3_BUCKET is set) or local disk.
 *
 * Environment variables (S3 mode):
 *   AWS_S3_BUCKET       — S3 bucket name (required to enable S3 mode)
 *   AWS_REGION          — AWS region (default: us-east-1)
 *   AWS_ACCESS_KEY_ID   — AWS access key (uses instance role if omitted)
 *   AWS_SECRET_ACCESS_KEY — AWS secret key (uses instance role if omitted)
 *   AWS_S3_PUBLIC_URL   — Optional CDN/public URL prefix (e.g. CloudFront domain)
 *                         If set, returned URLs use this prefix instead of s3.amazonaws.com
 *
 * Local disk mode (default when AWS_S3_BUCKET is not set):
 *   Files are saved to {project_root}/uploads/ (outside dist/ so they survive builds).
 *   Express serves them at /uploads/*.
 *   ⚠ Local disk mode does NOT work on multi-server deployments — use S3 for production.
 *
 * Exports:
 *   storagePut(key, data, contentType) → { key, url }
 *   storageGet(key)                    → { key, url }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

// ─── S3 backend ──────────────────────────────────────────────────────────────

let _s3Client: import("@aws-sdk/client-s3").S3Client | null = null;

async function getS3Client(): Promise<import("@aws-sdk/client-s3").S3Client | null> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) return null;

  if (!_s3Client) {
    // Lazy-import to avoid loading the SDK when running in local disk mode
    const { S3Client } = await import("@aws-sdk/client-s3");
    _s3Client = new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      // Credentials are optional — if omitted, the SDK uses the instance IAM role
      ...(process.env.AWS_ACCESS_KEY_ID && {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
        },
      }),
    });
  }
  return _s3Client;
}

async function s3Put(
  key: string,
  data: Buffer,
  contentType: string
): Promise<{ key: string; url: string }> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const bucket = process.env.AWS_S3_BUCKET!;
  const client = (await getS3Client())!;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    })
  );

  // Prefer CDN URL if configured, otherwise use the standard S3 URL
  const publicUrlBase = process.env.AWS_S3_PUBLIC_URL
    ? process.env.AWS_S3_PUBLIC_URL.replace(/\/$/, "")
    : `https://${bucket}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`;

  return { key, url: `${publicUrlBase}/${key}` };
}

async function s3Get(key: string): Promise<{ key: string; url: string }> {
  const bucket = process.env.AWS_S3_BUCKET!;
  const publicUrlBase = process.env.AWS_S3_PUBLIC_URL
    ? process.env.AWS_S3_PUBLIC_URL.replace(/\/$/, "")
    : `https://${bucket}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`;

  return { key, url: `${publicUrlBase}/${key}` };
}

// ─── Local disk backend ───────────────────────────────────────────────────────

function getUploadsDir(): string {
  const base = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return base;
}

async function diskPut(
  relKey: string,
  data: Buffer,
  _contentType: string
): Promise<{ key: string; url: string }> {
  const uploadsDir = getUploadsDir();
  // Flatten the key into a safe filename (replace path separators with underscores)
  const safeFileName = relKey.replace(/\//g, "_").replace(/^_+/, "");
  const filePath = path.join(uploadsDir, safeFileName);
  fs.writeFileSync(filePath, data);
  // Relative URL so it works through any proxy or public domain
  return { key: relKey, url: `/uploads/${safeFileName}` };
}

async function diskGet(relKey: string): Promise<{ key: string; url: string }> {
  const safeFileName = relKey.replace(/\//g, "_").replace(/^_+/, "");
  return { key: relKey, url: `/uploads/${safeFileName}` };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Store a file. Automatically routes to S3 or local disk based on environment.
 *
 * @param relKey      Storage key / S3 object key (e.g. "client-assets/1/logo.png")
 * @param data        File content as Buffer, Uint8Array, or string
 * @param contentType MIME type (default: "application/octet-stream")
 * @returns           { key, url } where url is the public-facing URL
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const buffer =
    typeof data === "string"
      ? Buffer.from(data)
      : Buffer.from(data as Uint8Array);

  if (await getS3Client()) {
    return s3Put(relKey, buffer, contentType);
  }
  return diskPut(relKey, buffer, contentType);
}

/**
 * Get the public URL for a stored file.
 * Does not verify the file exists — use for URL construction only.
 */
export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  if (await getS3Client()) {
    return s3Get(relKey);
  }
  return diskGet(relKey);
}
