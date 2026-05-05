/**
 * logo-background-removal.ts — local Sharp pipeline that strips white
 * backgrounds from client logos for the webstore overlay.
 *
 * Why Sharp instead of Cloudinary:
 *   The webstore's WebstoreLogoOverlay composites the distributor's client
 *   logo onto product photos. Logos uploaded by distributors typically ship
 *   on a white square background, which clashes with non-white product
 *   photos. Cloudinary's Pixelz add-on (subject extraction) was the first
 *   attempt; it produced unusable output for white-on-white logos because
 *   it preserves the entire bounding box of the logo (including internal
 *   white space) as foreground. For real-world distributor logos, a simple
 *   colour-key — "near-white pixels become transparent" — gives a much
 *   cleaner result and runs locally with no add-on dependency.
 *
 * Pipeline:
 *   1. Fetch the source image bytes.
 *   2. Convert to RGBA via Sharp; for every pixel where R>240 AND G>240
 *      AND B>240, set alpha=0.
 *   3. Apply a 1-pixel blur to the alpha channel only — softens the
 *      step-edge between fully-opaque logo pixels and fully-transparent
 *      background, removing the "cut-out paper" look.
 *   4. Upload the resulting PNG back to S3 under a deterministic key
 *      derived from the source URL, so two callers with the same input
 *      converge on the same output (natural dedup).
 *
 * Failure policy:
 *   This is decorative — it must NEVER block the logo upload or the
 *   storefront render. On any failure (network, Sharp, S3) we log and
 *   return the original `logoUrl` so the overlay still renders with the
 *   original (white-background) image.
 */

import crypto from "crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { clientLogos } from "../../drizzle/schema";
import { storagePut } from "../storage";
import { getLogger } from "../utils/logger";

const log = getLogger("logo-background-removal");

/** S3 prefix for processed transparent PNGs. */
const PROCESSED_PREFIX = "logos/processed";

/**
 * R/G/B threshold above which a pixel is treated as background. 240 is
 * loose enough to capture lossy-JPEG near-white (typical 246–250) but
 * tight enough that pale colour fills inside a logo aren't accidentally
 * stripped.
 */
const WHITE_THRESHOLD = 240;

/** In-process cache: source URL → processed S3 URL. */
const memCache = new Map<string, string>();

/**
 * Derive a deterministic S3 key for the processed asset. Same source URL
 * always maps to the same key; different sources (S3 path, query, etc.)
 * map to distinct keys. We include a short hash of the source URL so two
 * logos with the same filename in different folders don't collide.
 */
function deterministicKey(sourceUrl: string): string {
  const hash = crypto.createHash("sha1").update(sourceUrl).digest("hex").slice(0, 10);
  // Pull a clean filename stem from the URL path (without query string).
  let stem = "logo";
  try {
    const u = new URL(sourceUrl);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const dot = last.lastIndexOf(".");
    const base = (dot > 0 ? last.slice(0, dot) : last).replace(/[^a-zA-Z0-9_-]+/g, "-");
    if (base) stem = base;
  } catch {
    // bad URL — fall back to "logo"; hash still keeps the key unique.
  }
  return `${PROCESSED_PREFIX}/${stem}-${hash}-transparent.png`;
}

/**
 * Process a logo URL through the Sharp white-threshold pipeline. Returns
 * the processed S3 URL on success, or the original URL on any failure.
 */
export async function processLogoForOverlay(logoUrl: string): Promise<string> {
  if (!logoUrl || !/^https?:\/\//.test(logoUrl)) return logoUrl;

  const cached = memCache.get(logoUrl);
  if (cached) return cached;

  try {
    const res = await fetch(logoUrl);
    if (!res.ok) {
      log.warn(`processLogoForOverlay: source fetch ${logoUrl} → HTTP ${res.status} — falling back to original`);
      return logoUrl;
    }
    const sourceBuf = Buffer.from(await res.arrayBuffer());

    // Sharp's preferred way to mutate raw RGBA: ensureAlpha() forces a 4-channel
    // surface, then raw() yields the byte buffer we walk in JS. For a
    // 1250×1250 logo this is ~6MB and ~1.5M pixels — well under a second.
    const { data, info } = await sharp(sourceBuf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    if (channels !== 4) {
      log.warn(`processLogoForOverlay: unexpected channel count ${channels} — falling back to original`);
      return logoUrl;
    }

    // Walk the byte buffer; every near-white pixel gets alpha=0. Mutate in
    // place — the buffer is owned, no aliasing concerns.
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD) {
        data[i + 3] = 0;
      }
    }

    // Soften the step-edge produced by the threshold pass with a 1-pixel
    // blur of the alpha channel only. We extract alpha as raw, blur it,
    // and rebuild the RGBA byte buffer by hand so colour stays crisp and
    // the encoder can't optimize the alpha plane away (which it does if we
    // round-trip via removeAlpha + joinChannel of an encoded buffer).
    const alphaBlurred = await sharp(data, { raw: { width, height, channels: 4 } })
      .extractChannel("alpha")
      .blur(1)
      .raw()
      .toBuffer();

    const finalRgba = Buffer.alloc(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      finalRgba[p * 4]     = data[p * 4];
      finalRgba[p * 4 + 1] = data[p * 4 + 1];
      finalRgba[p * 4 + 2] = data[p * 4 + 2];
      finalRgba[p * 4 + 3] = alphaBlurred[p];
    }

    const processed = await sharp(finalRgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();

    const key = deterministicKey(logoUrl);
    const { url } = await storagePut(key, processed, "image/png");

    memCache.set(logoUrl, url);
    log.info(`processLogoForOverlay: ${logoUrl} → ${url} (${processed.length} bytes)`);
    return url;
  } catch (err) {
    log.warn(
      `processLogoForOverlay failed for ${logoUrl}: ${err instanceof Error ? err.message : String(err)} — falling back to original URL`,
    );
    return logoUrl;
  }
}

/**
 * Look up a clientLogos row, return its cached processedLogoUrl if present,
 * otherwise process via Sharp, persist the result, and return it.
 *
 * On any failure: returns the original logoUrl, does NOT mark processedAt
 * (so a subsequent render gets a chance to retry).
 */
export async function getCachedProcessedLogoUrl(logoId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(clientLogos).where(eq(clientLogos.id, logoId)).limit(1);
  const row = rows[0];
  if (!row) return null;

  if (row.processedLogoUrl) return row.processedLogoUrl;

  const processed = await processLogoForOverlay(row.logoUrl);
  // If processing failed, processLogoForOverlay returned the original URL
  // unchanged — don't bother writing it back, leave processedLogoUrl NULL
  // so the next render retries.
  if (processed === row.logoUrl) return processed;

  try {
    await db
      .update(clientLogos)
      .set({ processedLogoUrl: processed, processedAt: new Date() })
      .where(eq(clientLogos.id, logoId));
  } catch (err) {
    log.warn(
      `Failed to persist processedLogoUrl for logoId=${logoId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return processed;
}

/**
 * Fire-and-forget variant for the storefront render path. Schedules the
 * processing on the next tick and returns immediately so the storefront
 * response isn't held up. The next render sees the cached URL.
 */
export function ensureProcessedLogoInBackground(logoId: number): void {
  void getCachedProcessedLogoUrl(logoId).catch(err => {
    log.warn(
      `ensureProcessedLogoInBackground threw for logoId=${logoId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}
