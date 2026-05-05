/**
 * Visual harness for Phase 6 placement verification — read-only.
 *
 * Pulls the 3 Yan Financial demo products plus their persisted
 * webstoreImprintPlacement* coordinates plus the Yan Financial primary
 * client logo, then writes a single self-contained HTML file that
 * renders each product image with the logo overlaid using the SAME
 * coordinate-space contract as WebstoreLogoOverlay.tsx:
 *
 *   - Outer wrapper centers an inner box that sizes to the image's
 *     natural rendered bounds (matches the flex inset-0 +
 *     max-w/max-h:full pattern in the component).
 *   - Logo div is absolutely positioned inside that inner box using
 *     percentage left/top/width/height pulled directly from the
 *     persisted columns.
 *   - mixBlendMode pulled from the persisted column.
 *
 * If the harness renders the logo on the product correctly, the
 * coordinate math + AI output are both correct. Any rendering bug in
 * WebstoreLogoOverlay's React tree would still need a real-app test,
 * but for a coordinate-quality check this is conclusive.
 */

import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

// Product 63 (Nike Polo) is a stock photo with an unrelated brand logo
// burned in — not a viable placement test. Harness uses 64 + 66 only.
const TARGET_IDS = [64, 66];
const REPO_ROOT = path.resolve(process.cwd());
const OUT_PATH = path.join(REPO_ROOT, "tmp-phase6-harness.html");

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Fetch products + placement
  const productsRes = await db.execute(sql`
    SELECT id, name, imageUrl,
           webstoreImprintPlacementX  AS x,
           webstoreImprintPlacementY  AS y,
           webstoreImprintPlacementWidth  AS w,
           webstoreImprintPlacementHeight AS h,
           webstoreImprintPlacementZone AS zone,
           webstoreImprintPlacementBlendMode AS blendMode,
           webstoreImprintPlacementConfidence AS confidence,
           webstoreImprintPlacementSource AS source,
           webstoreImprintPlacementAnalyzedAt AS analyzedAt
    FROM products
    WHERE id IN (${sql.raw(TARGET_IDS.join(","))})
  `);
  const products = productsRes[0] as any[];

  // Fetch the Yan Financial primary client logo (any of the 3 client rows
  // — they share the company name; we take the first that has a primary
  // logo). If none, fall back to "any logo" for that client.
  const yanClientsRes = await db.execute(sql`
    SELECT id FROM clients WHERE companyName = 'Yan Financial' ORDER BY id
  `);
  const yanClientIds = (yanClientsRes[0] as any[]).map(r => r.id);

  let logoUrl: string | null = null;
  for (const cid of yanClientIds) {
    const primaryRes = await db.execute(sql`
      SELECT logoUrl FROM clientLogos
      WHERE clientId = ${cid} AND isPrimary = TRUE
      ORDER BY id DESC LIMIT 1
    `);
    const primaryRow = (primaryRes[0] as any[])[0];
    if (primaryRow?.logoUrl) { logoUrl = primaryRow.logoUrl; break; }
    const anyRes = await db.execute(sql`
      SELECT logoUrl FROM clientLogos
      WHERE clientId = ${cid}
      ORDER BY createdAt DESC LIMIT 1
    `);
    const anyRow = (anyRes[0] as any[])[0];
    if (anyRow?.logoUrl) { logoUrl = anyRow.logoUrl; break; }
  }

  if (!logoUrl) {
    console.warn("⚠ No Yan Financial logo found — harness will render a placeholder.");
  }

  const cards = products.map(p => {
    const xPct = (parseFloat(p.x) * 100).toFixed(2);
    const yPct = (parseFloat(p.y) * 100).toFixed(2);
    const wPct = (parseFloat(p.w) * 100).toFixed(2);
    const hPct = (parseFloat(p.h) * 100).toFixed(2);
    const blendMode = p.blendMode || "multiply";

    const logoLayer = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="" class="logo-img" />`
      : `<div class="logo-placeholder">LOGO</div>`;

    return `
    <section class="card">
      <h2>id=${p.id} — ${escapeHtml(p.name)}</h2>
      <p class="meta">
        zone=<b>${escapeHtml(p.zone || "—")}</b> ·
        blendMode=<b>${escapeHtml(blendMode)}</b> ·
        confidence=<b>${p.confidence || "—"}</b> ·
        source=<b>${escapeHtml(p.source || "—")}</b>
      </p>
      <p class="meta">
        coords: x=${xPct}% · y=${yPct}% · w=${wPct}% · h=${hPct}%
      </p>

      <div class="frame">
        <div class="image-box">
          <div class="image-inner">
            <img src="${escapeHtml(p.imageUrl)}" alt="" class="product-img" />
            <div class="logo-layer"
                 style="left:${xPct}%; top:${yPct}%; width:${wPct}%; height:${hPct}%; mix-blend-mode:${blendMode};">
              ${logoLayer}
            </div>
          </div>
        </div>
      </div>
    </section>`;
  }).join("\n");

  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Phase 6 placement harness — Yan Financial</title>
<style>
  * { box-sizing: border-box; }
  body {
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #fafafa;
    color: #18181b;
    margin: 0;
    padding: 32px;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .lead { color: #52525b; margin: 0 0 32px; max-width: 720px; }
  .lead code { background: #f1f1f3; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .card {
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
    max-width: 720px;
  }
  .card h2 { font-size: 14px; margin: 0 0 6px; }
  .meta { color: #71717a; font-size: 11px; margin: 0 0 4px; font-family: ui-monospace, Menlo, monospace; }

  /* Mirrors WebstoreLogoOverlay.tsx coordinate-space contract:
     outer wrapper → flex centers inner box → image sizes inner box →
     absolute logo positions inside the image-relative box. */
  .frame {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    background: #f4f4f5;
    border: 1px solid #e4e4e7;
    border-radius: 8px;
    overflow: hidden;
    margin-top: 12px;
  }
  .image-box {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Inner box sizes to the image's natural rendered bounds (because of
     max-width/max-height: 100% + object-contain on the img + flex item
     content-sizing default). The logo's percentage coords are resolved
     against THIS box, not the outer .frame, so contained images don't
     drift the logo into letterbox padding. Mirrors WebstoreLogoOverlay
     inner wrapper (relative + max-w-full + max-h-full). */
  .image-inner {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    display: inline-block;
  }
  .product-img {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    user-select: none;
  }
  .logo-layer {
    position: absolute;
    pointer-events: none;
    user-select: none;
  }
  .logo-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.08));
  }
  .logo-placeholder {
    width: 100%;
    height: 100%;
    background: rgba(108, 43, 217, 0.55);
    color: white;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.04em;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
</style>
</head><body>
<h1>Phase 6 placement harness — Yan Financial</h1>
<p class="lead">
  Renders the 3 demo products' AI-derived placement coordinates from
  <code>products.webstoreImprintPlacement*</code> as absolute-positioned divs
  over each product image, using the same coordinate-space contract as
  <code>WebstoreLogoOverlay.tsx</code>: image sizes the inner box,
  logo is positioned in image-relative percent space.
</p>
${cards}
<p class="lead" style="margin-top:32px; font-size:11px;">
  Generated ${new Date().toISOString()} — logo source:
  <code>${logoUrl ? escapeHtml(logoUrl) : "(no Yan Financial logo found, using placeholder)"}</code>
</p>
</body></html>
`;

  await fs.writeFile(OUT_PATH, html, "utf8");
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  open via: python3 -m http.server 8123 --directory ${path.dirname(OUT_PATH)}`);
  console.log(`  then load: http://localhost:8123/${path.basename(OUT_PATH)}`);
  process.exit(0);
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

main().catch((err) => { console.error(err); process.exit(1); });
