/**
 * Render the 3 Yan Financial demo products into a single contact-sheet
 * PNG with the AI placement coordinates drawn over each product image.
 * Avoids the headless-browser route (Chromium missing system libs on
 * this box) and exercises the same coordinate math directly via sharp.
 *
 * Each tile:
 *   - Fits the product image into a 600×600 box with letterbox padding
 *     (object-contain semantics) → records the actual rendered image
 *     bounds inside that 600×600 box.
 *   - Overlays a translucent rectangle at (x*W, y*H, w*W, h*H) where
 *     W/H are the rendered image bounds — image-relative coords, NOT
 *     tile-relative. This is the WebstoreLogoOverlay coordinate-space
 *     contract. Letterboxed images keep the logo on the product.
 *   - Adds the Yan Financial logo composited inside that rectangle.
 *   - Header text shows zone, coords, blendMode.
 */

import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { getCachedProcessedLogoUrl, processLogoForOverlay } from "../../server/services/logo-background-removal";

// Product 63 (Nike Polo) is a stock photo with an unrelated brand logo
// burned into the fabric — not a viable placement test. Harness uses 64
// + 66 only.
const TARGET_IDS = [64, 66];
const TILE = 600;
const HEADER_H = 80;
const PADDING = 16;
const OUT_PATH = path.join(process.cwd(), "tmp-phase6-harness.png");

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function svgHeader(p: any, xPct: string, yPct: string, wPct: string, hPct: string): string {
  return `<svg width="${TILE}" height="${HEADER_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${TILE}" height="${HEADER_H}" fill="white"/>
    <text x="${PADDING}" y="26" font-family="Helvetica,Arial,sans-serif" font-size="16" font-weight="700" fill="#18181b">id=${p.id} — ${escapeXml(p.name)}</text>
    <text x="${PADDING}" y="46" font-family="Menlo,monospace" font-size="11" fill="#52525b">zone=${escapeXml(p.zone || "—")} · blendMode=${escapeXml(p.blendMode || "—")} · confidence=${p.confidence || "—"}</text>
    <text x="${PADDING}" y="62" font-family="Menlo,monospace" font-size="11" fill="#52525b">coords: x=${xPct}%  y=${yPct}%  w=${wPct}%  h=${hPct}%</text>
    <line x1="0" y1="${HEADER_H - 1}" x2="${TILE}" y2="${HEADER_H - 1}" stroke="#e4e4e7" stroke-width="1"/>
  </svg>`;
}

function escapeXml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function renderTile(p: any, logoBuf: Buffer | null): Promise<Buffer> {
  const productBuf = await fetchBuffer(p.imageUrl);
  const meta = await sharp(productBuf).metadata();
  const naturalW = meta.width ?? 1;
  const naturalH = meta.height ?? 1;

  // object-contain into TILE×TILE
  const scale = Math.min(TILE / naturalW, TILE / naturalH);
  const drawnW = Math.round(naturalW * scale);
  const drawnH = Math.round(naturalH * scale);
  const offsetX = Math.round((TILE - drawnW) / 2);
  const offsetY = Math.round((TILE - drawnH) / 2);

  // Logo rect (image-relative coords)
  const xFrac = parseFloat(p.x);
  const yFrac = parseFloat(p.y);
  const wFrac = parseFloat(p.w);
  const hFrac = parseFloat(p.h);
  const logoX = offsetX + Math.round(xFrac * drawnW);
  const logoY = offsetY + Math.round(yFrac * drawnH);
  const logoW = Math.max(1, Math.round(wFrac * drawnW));
  const logoH = Math.max(1, Math.round(hFrac * drawnH));

  // Resize product into a tile-sized buffer with white letterbox
  const productResized = await sharp(productBuf)
    .resize(drawnW, drawnH, { fit: "contain" })
    .toBuffer();
  const tileCanvas = sharp({
    create: { width: TILE, height: TILE, channels: 4, background: { r: 244, g: 244, b: 245, alpha: 1 } },
  });

  // Build composite layers:
  //   1. product image at (offsetX, offsetY)
  //   2. translucent purple rect outlining the AI placement box (so the
  //      coords are visible even before the logo composites on top)
  //   3. the actual Yan Financial logo (or "LOGO" placeholder) inside
  //      the rect
  const rectSvg = `<svg width="${logoW}" height="${logoH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${logoW}" height="${logoH}" fill="rgba(108,43,217,0.20)" stroke="rgba(108,43,217,0.95)" stroke-width="2"/>
  </svg>`;

  let logoLayer: Buffer;
  if (logoBuf) {
    logoLayer = await sharp(logoBuf).resize(logoW, logoH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  } else {
    logoLayer = await sharp(Buffer.from(`<svg width="${logoW}" height="${logoH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${logoW}" height="${logoH}" fill="rgba(108,43,217,0.6)"/>
      <text x="50%" y="50%" font-family="Helvetica,Arial,sans-serif" font-size="14" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="central">LOGO</text>
    </svg>`)).png().toBuffer();
  }

  const tile = await tileCanvas
    .composite([
      { input: productResized, left: offsetX, top: offsetY },
      { input: Buffer.from(rectSvg), left: logoX, top: logoY },
      { input: logoLayer, left: logoX, top: logoY },
    ])
    .png()
    .toBuffer();

  // Stack header + tile vertically
  const xPct = (xFrac * 100).toFixed(2);
  const yPct = (yFrac * 100).toFixed(2);
  const wPct = (wFrac * 100).toFixed(2);
  const hPct = (hFrac * 100).toFixed(2);
  const headerBuf = await sharp(Buffer.from(svgHeader(p, xPct, yPct, wPct, hPct))).png().toBuffer();

  const card = await sharp({
    create: { width: TILE, height: TILE + HEADER_H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([
      { input: headerBuf, left: 0, top: 0 },
      { input: tile, left: 0, top: HEADER_H },
    ])
    .png()
    .toBuffer();

  return card;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const productsRes = await db.execute(sql`
    SELECT id, name, imageUrl,
           webstoreImprintPlacementX  AS x,
           webstoreImprintPlacementY  AS y,
           webstoreImprintPlacementWidth  AS w,
           webstoreImprintPlacementHeight AS h,
           webstoreImprintPlacementZone AS zone,
           webstoreImprintPlacementBlendMode AS blendMode,
           webstoreImprintPlacementConfidence AS confidence
    FROM products
    WHERE id IN (${sql.raw(TARGET_IDS.join(","))})
    ORDER BY id
  `);
  const products = productsRes[0] as any[];
  if (products.length !== TARGET_IDS.length) {
    console.warn(`⚠ expected ${TARGET_IDS.length} products, got ${products.length}`);
  }

  // Yan Financial logo. Prefer the Cloudinary background-removed transparent
  // PNG (cached in clientLogos.processedLogoUrl); if not yet cached, run the
  // one-off processor inline so this harness rebuild gets the transparent
  // version on the first run.
  const yanClientsRes = await db.execute(sql`SELECT id FROM clients WHERE companyName = 'Yan Financial' ORDER BY id`);
  const yanClientIds = (yanClientsRes[0] as any[]).map(r => r.id);
  let logoUrl: string | null = null;
  let logoId: number | null = null;
  let originalLogoUrl: string | null = null;
  for (const cid of yanClientIds) {
    const r = await db.execute(sql`SELECT id, logoUrl, processedLogoUrl FROM clientLogos WHERE clientId = ${cid} ORDER BY isPrimary DESC, id DESC LIMIT 1`);
    const row = (r[0] as any[])[0];
    if (row?.logoUrl) {
      logoId = row.id;
      originalLogoUrl = row.logoUrl;
      logoUrl = row.processedLogoUrl ?? null;
      break;
    }
  }
  if (!logoUrl && logoId !== null) {
    logoUrl = await getCachedProcessedLogoUrl(logoId);
  }
  if (!logoUrl && originalLogoUrl) {
    logoUrl = await processLogoForOverlay(originalLogoUrl);
  }
  const logoBuf = logoUrl ? await fetchBuffer(logoUrl) : null;
  console.log(`logo (original): ${originalLogoUrl ?? "(none)"}`);
  console.log(`logo (rendered): ${logoUrl ?? "(none — placeholder will be drawn)"}`);

  const tiles: Buffer[] = [];
  for (const p of products) {
    console.log(`→ rendering id=${p.id} ${p.name}`);
    const tile = await renderTile(p, logoBuf);
    tiles.push(tile);
  }

  // Vertical contact sheet
  const sheetH = (TILE + HEADER_H) * tiles.length + (tiles.length - 1) * 12;
  const sheetCanvas = sharp({
    create: { width: TILE, height: sheetH, channels: 4, background: { r: 250, g: 250, b: 250, alpha: 1 } },
  });
  const composites = tiles.map((buf, i) => ({
    input: buf,
    left: 0,
    top: i * (TILE + HEADER_H + 12),
  }));
  await sheetCanvas.composite(composites).png().toFile(OUT_PATH);
  console.log(`✓ wrote ${OUT_PATH}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
