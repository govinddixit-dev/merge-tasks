/**
 * Capture a full-page PNG of the Phase 6 placement harness via headless
 * Chromium so we can review pixel output without a browser tunnel.
 */

import { chromium } from "playwright";
import path from "path";

const URL = "http://127.0.0.1:8123/tmp-phase6-harness.html";
const OUT = path.join(process.cwd(), "tmp-phase6-harness.png");

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 800, height: 1000 },
    deviceScaleFactor: 1.5,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30_000 });
  // Belt-and-suspenders: wait for every image to settle. networkidle
  // covers loads, this catches still-decoding images.
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    await Promise.all(imgs.map(img => img.complete
      ? Promise.resolve()
      : new Promise(r => { img.onload = img.onerror = () => r(null); })));
  });
  await page.screenshot({ path: OUT, fullPage: true, type: "png" });
  console.log(`✓ wrote ${OUT}`);
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
