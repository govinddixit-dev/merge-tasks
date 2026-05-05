/**
 * Two-stage diagnostic re-analyze for products 64 (Nike Shirt) and 66
 * (OGIO Crunch Duffel). Reproduces the Stage 1 (observation) + Stage 2
 * (coordinate JSON) flow inline so the prose is visible in stdout
 * (the service writes Stage 1 to log.debug, which is too noisy to wire
 * up here). Persists the resulting placement via a normal Drizzle
 * update — same shape runAnalysisAndPersist would write.
 */

import "dotenv/config";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../../server/db";
import { products } from "../../drizzle/schema";
import { invokeAnthropic } from "../../server/_core/anthropicAdapter";
import { ALLOWED_ZONES, ALLOWED_BLEND_MODES } from "../../server/services/webstore-imprint-placement";

const TARGET_IDS = [64, 66];
const MODEL = "claude-sonnet-4-6";
const STAGE_1_MAX_TOKENS = 1500;
const STAGE_2_MAX_TOKENS = 400;
const TIMEOUT_MS = 30_000;

function extractText(result: any): string {
  const message = result?.choices?.[0]?.message;
  if (!message) return "";
  const text = typeof message.content === "string"
    ? message.content
    : (message.content ?? [])
        .map((p: any) => (p && typeof p === "object" && "text" in p ? String(p.text ?? "") : ""))
        .join("");
  return text.trim();
}

const stage1Prompt = [
  "You are a senior production decorator inspecting a single product photograph",
  "to plan logo placement. Read the image carefully and answer in plain prose.",
  "Do not output JSON. Do not output coordinates. Do not assume a category.",
  "",
  "Answer these five questions in order, each as its own short paragraph:",
  "",
  "1. PRODUCT — What specific product is shown? Be precise (e.g. 'soft-shell",
  "   zip-front jacket with chest pocket', not just 'jacket').",
  "2. OBSTACLES — List every visible feature that would prevent or degrade",
  "   logo placement: zippers, handles, straps, buckles, buttons, collars,",
  "   existing brand logos or printed text, pockets with hardware, structural",
  "   seams, deep folds, harsh shadows, reflective surfaces.",
  "3. SURFACES — List every flat unobstructed surface available for",
  "   decoration, ordered largest to smallest. Describe each surface's",
  "   approximate location on the product in plain language.",
  "4. CHOICE — Which surface would a professional decorator choose, and",
  "   exactly why? Reference the obstacles and surfaces from steps 2 and 3.",
  "5. ZONE — Describe the boundaries of the optimal decoration zone in",
  "   relative terms (e.g. 'starts about a third of the way down from the",
  "   collar, sits just left of center, occupies roughly the upper-left",
  "   quadrant of the chest panel'). No pixel coordinates, no percentages.",
].join("\n");

function stage2Prompt(stage1Text: string): string {
  return [
    "Below is your own analysis of a product image, followed by the same image.",
    "Convert your analysis into a logo placement bounding box on the image.",
    "",
    "Return ONLY a JSON object with this exact shape (no prose, no code fences):",
    "",
    "{",
    '  "x": 0.00,             // left edge of logo box, 0..1 fraction of image width',
    '  "y": 0.00,             // top edge of logo box, 0..1 fraction of image height',
    '  "width": 0.00,         // logo box width, 0..1 fraction of image width',
    '  "height": 0.00,        // logo box height, 0..1 fraction of image height',
    `  "zone": "",            // one of ${JSON.stringify(ALLOWED_ZONES)}`,
    `  "blendMode": "",       // one of ${JSON.stringify(ALLOWED_BLEND_MODES)}`,
    '  "confidence": 0.00     // 0..1, how sure you are about this placement',
    "}",
    "",
    "Constraints:",
    "- The box must sit entirely on the surface you chose in your analysis.",
    "- Do not place it on backgrounds, shadows, obstacles, or off the product.",
    "- Pick blendMode based on the surface material you described:",
    '  fabric/textile → "multiply"; hard/smooth surfaces → "normal".',
    "- If your analysis indicates the image is unsuitable, return low confidence.",
    "",
    "── YOUR PRIOR ANALYSIS ──",
    stage1Text,
    "── END ANALYSIS ──",
  ].join("\n");
}

function parseJsonObject(raw: string): any | null {
  try { return JSON.parse(raw); } catch {}
  const fenceStripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const first = fenceStripped.indexOf("{");
  const last = fenceStripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try { return JSON.parse(fenceStripped.slice(first, last + 1)); } catch { return null; }
}

async function runProduct(db: any, id: number, name: string, imageUrl: string) {
  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(`▸ product id=${id}  ${name}`);
  console.log(`  image: ${imageUrl}`);
  console.log(`══════════════════════════════════════════════════════════════════`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const baseCfg = {
    provider: "anthropic" as const,
    apiUrl: "https://api.anthropic.com/v1/messages",
    apiKey,
    model: MODEL,
    temperature: 0,
    providerOptions: {},
  };

  // Stage 1
  const s1 = await Promise.race([
    invokeAnthropic(
      {
        model: MODEL,
        maxTokens: STAGE_1_MAX_TOKENS,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: stage1Prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        }],
      } as any,
      { ...baseCfg, maxTokens: STAGE_1_MAX_TOKENS } as any,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("stage1-timeout")), TIMEOUT_MS),
    ),
  ]);
  const stage1Text = extractText(s1);
  console.log(`\n──── STAGE 1 OBSERVATION (id=${id}) ────\n`);
  console.log(stage1Text);
  console.log(`\n──── END STAGE 1 (id=${id}) ────\n`);

  // Stage 2
  const s2 = await Promise.race([
    invokeAnthropic(
      {
        model: MODEL,
        maxTokens: STAGE_2_MAX_TOKENS,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: stage2Prompt(stage1Text) },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        }],
      } as any,
      { ...baseCfg, maxTokens: STAGE_2_MAX_TOKENS } as any,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("stage2-timeout")), TIMEOUT_MS),
    ),
  ]);
  const stage2Raw = extractText(s2);
  console.log(`──── STAGE 2 RAW JSON (id=${id}) ────\n${stage2Raw}\n──── END STAGE 2 ────\n`);

  const parsed = parseJsonObject(stage2Raw);
  if (!parsed) { console.error(`  ✗ Stage 2 unparseable for id=${id}`); return null; }

  const x = Number(parsed.x), y = Number(parsed.y);
  const w = Number(parsed.width), h = Number(parsed.height);
  const conf = Number(parsed.confidence);
  if (![x, y, w, h, conf].every(n => Number.isFinite(n) && n >= 0 && n <= 1.001)) {
    console.error(`  ✗ Stage 2 numeric out-of-range for id=${id}: ${JSON.stringify(parsed)}`);
    return null;
  }
  if (!(ALLOWED_ZONES as readonly string[]).includes(parsed.zone)) {
    console.error(`  ✗ Stage 2 zone invalid for id=${id}: ${parsed.zone}`);
    return null;
  }
  if (!(ALLOWED_BLEND_MODES as readonly string[]).includes(parsed.blendMode)) {
    console.error(`  ✗ Stage 2 blendMode invalid for id=${id}: ${parsed.blendMode}`);
    return null;
  }

  await db.update(products).set({
    webstoreImprintPlacementX: x.toFixed(4),
    webstoreImprintPlacementY: y.toFixed(4),
    webstoreImprintPlacementWidth: w.toFixed(4),
    webstoreImprintPlacementHeight: h.toFixed(4),
    webstoreImprintPlacementZone: parsed.zone,
    webstoreImprintPlacementBlendMode: parsed.blendMode,
    webstoreImprintPlacementConfidence: conf.toFixed(2),
    webstoreImprintPlacementAnalyzedAt: new Date(),
    webstoreImprintPlacementSource: "ai",
  }).where(eq(products.id, id));

  return { id, x, y, w, h, zone: parsed.zone, blendMode: parsed.blendMode, conf };
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const beforeRes = await db.execute(sql`
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
  const rows = beforeRes[0] as any[];

  console.log(`Pre-existing coords:`);
  for (const r of rows) {
    console.log(`  id=${r.id} ${r.name}: x=${r.x} y=${r.y} w=${r.w} h=${r.h} zone=${r.zone} blend=${r.blendMode} conf=${r.confidence}`);
  }

  const results: any[] = [];
  for (const r of rows) {
    const out = await runProduct(db, r.id, r.name, r.imageUrl);
    results.push({ before: r, after: out });
  }

  console.log(`\n\n═══════════ OLD vs NEW ═══════════\n`);
  for (const { before, after } of results) {
    console.log(`▸ id=${before.id}  ${before.name}`);
    console.log(`  old: x=${before.x} y=${before.y} w=${before.w} h=${before.h} zone=${before.zone} blend=${before.blendMode} conf=${before.confidence}`);
    if (!after) { console.log(`  new: FAILED`); continue; }
    console.log(`  new: x=${after.x.toFixed(4)} y=${after.y.toFixed(4)} w=${after.w.toFixed(4)} h=${after.h.toFixed(4)} zone=${after.zone} blend=${after.blendMode} conf=${after.conf.toFixed(2)}`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
