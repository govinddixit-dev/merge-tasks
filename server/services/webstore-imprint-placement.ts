/**
 * webstore-imprint-placement.ts — Tier 1 webstore logo-placement analyzer.
 *
 * Pipeline:
 *   product image URL  →  Claude vision Stage 1 (observation, prose)
 *                      →  Claude vision Stage 2 (coordinate extraction, JSON)
 *                      →  normalized {x, y, w, h, zone, blend, confidence}
 *                      →  cached on products.webstoreImprintPlacement* columns
 *                      →  WebstoreLogoOverlay (client) composites the logo
 *                         on the customer-facing storefront
 *
 * ──────────────────────────────────────────────────────────────────────
 * SCOPE BOUNDARY — read this before adding callers
 * ──────────────────────────────────────────────────────────────────────
 *
 * This service is webstore-only. The distributor virtual proofing studio
 * (server/routers/proofing.ts → OpenAI Images) is a SEPARATE pipeline
 * with a different audience, cost profile, and output shape. Do NOT
 * unify the two. See docs/virtual-proofing-recon.md.
 *
 * Hook strategy (decided 2026-04-25, "Phase 5"):
 *
 *   ✅ REAL-TIME, single-product (in-line fire-and-forget,
 *      runAnalysisAndPersistInBackground)
 *      • products.create
 *      • products.duplicate
 *      • products.uploadImage    (re-fires on every upload, but the
 *                                 manual_override skip in the helper
 *                                 preserves distributor placements)
 *      Failure logged, never propagated. The Phase 8 backfill retries
 *      on its next pass (analyzedAt stays NULL on failure).
 *
 *   ✅ BACKGROUND BATCH, multi-product (in-line fire-and-forget,
 *      runBulkAnalysisInBackground with p-limit(10))
 *      • products.bulkCreate (CSV import, ≤100 rows per call)
 *      • products.seedCatalog (~30 demo products at first-run)
 *      • copilotExecProducts.executeImportExternalProduct
 *      In-process queue. If the process restarts mid-batch, in-flight
 *      analyses are lost — Phase 8 backfill picks them up on its next
 *      pass. Acceptable at current volume; revisit if rate climbs above
 *      ~1/minute (then a real BullMQ-backed queue makes sense).
 *
 *   ❌ NOT hooked here — handled by the backfill script ONLY
 *      • server/routers/supplierSync.ts (PSRESTful import)
 *      • server/jobs/sanMarBulkSync.ts (SanMar nightly)
 *      These pipelines move tens of thousands of products per run.
 *      Triggering Claude vision per row would blow up cost and latency.
 *      The Phase 8 backfill script (scripts/backfill-webstore-imprint-
 *      placements.ts) processes these on its own throttled schedule.
 *      If you find yourself adding a vision call to a supplier sync,
 *      stop and re-read this comment block first.
 */

import { eq, and, inArray, ne, isNull, type SQL } from "drizzle-orm";
import pLimit from "p-limit";
import sharp from "sharp";
import { invokeAnthropic } from "../_core/anthropicAdapter";
import { products } from "../../drizzle/schema";
import type { getDb } from "../db";
import { getLogger } from "../utils/logger";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const log = getLogger("webstore-imprint-placement");

/** Hard cap on each LLM stage so a slow vision response never blocks ingestion. */
const ANALYSIS_TIMEOUT_MS = 15_000;

/**
 * Image pre-fetch + resize budget. SanMar product images can be 3-5 MB
 * 3000px-wide PNGs; sending them by URL pushed Stage 1 past the 15s cap
 * because Anthropic re-encodes large inputs internally. Pre-fetching here
 * lets us downscale to vision-model-effective resolution (~1024px wide is
 * past the diminishing-returns point for placement analysis) and inline
 * the smaller payload as base64. Cuts wall time roughly in half on the
 * problem images and shrinks per-call cost.
 */
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
const IMAGE_MAX_WIDTH_PX = 1024;

/**
 * Model used for vision analysis. Sonnet over Haiku because vision JSON
 * discipline matters more than per-call cost — we run this once per
 * product at ingestion, never in a hot loop. Sonnet returns clean
 * structured JSON ~95% of the time; Haiku is more likely to wrap the
 * reply in prose ("Here is the placement...") and burn a retry.
 *
 * Used for both Stage 1 (natural-language observation) and Stage 2
 * (JSON coordinate extraction). Stage 1's job is to read the image and
 * adapt to whatever it sees — no hard-coded category rules, no
 * coordinate guesses. Stage 2 turns that observation into the
 * normalized {x,y,w,h,zone,blend,confidence} envelope.
 */
const ANALYSIS_MODEL = "claude-sonnet-4-6";

/**
 * Stage 1 emits a 5-bullet observation. ≤220 caps the response near the
 * measured 148-token typical output (2026-04-27 diagnostic) with ~50%
 * headroom. Earlier 1500-token cap drove stage1 wall time to ~18s; the
 * shorter cap brings it to ~6-7s, well under ANALYSIS_TIMEOUT_MS.
 */
const STAGE_1_MAX_TOKENS = 220;
const STAGE_2_MAX_TOKENS = 400;

/**
 * Provider pinned to Anthropic at the call site instead of routed via
 * `task:` through TASK_ROUTES. Two reasons:
 *   1. invokeLLM with no `task:` falls back to LLM_PROVIDER (defaults to
 *      "openai"); a Claude model ID then 404s at OpenAI. Routing has to
 *      be set explicitly somewhere.
 *   2. TASK_ROUTES still references claude-sonnet-4-5 (deprecated) and
 *      changing it touches the proposal-generation path, which has its
 *      own validation requirements before bumping the model. Tracked as
 *      followup §e in docs/migration-audit-followups.md.
 * When TASK_ROUTES is fixed and validated, this call can be simplified
 * to `task: "reasoning"`.
 */
const ANALYSIS_PROVIDER = "anthropic" as const;

/**
 * Allowed `zone` slugs the model may return. Validated before persistence
 * so a hallucinated value never reaches the storefront. Free-form
 * "other" exists as a safety valve when the product geometry doesn't
 * map to a named zone (e.g. weird-shaped tech accessory).
 */
export const ALLOWED_ZONES = [
  "left_chest", "right_chest", "full_front", "full_back",
  "left_sleeve", "right_sleeve", "pocket", "side_panel",
  "lid", "front_face", "wrap_around", "other",
] as const;

export const ALLOWED_BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken",
] as const;

export type WebstoreImprintZone = typeof ALLOWED_ZONES[number];
export type WebstoreImprintBlendMode = typeof ALLOWED_BLEND_MODES[number];

export interface PlacementResult {
  x: number;          // 0..1 normalized fraction of image width
  y: number;          // 0..1 normalized fraction of image height
  width: number;      // 0..1 normalized fraction of image width
  height: number;     // 0..1 normalized fraction of image height
  zone: WebstoreImprintZone;
  blendMode: WebstoreImprintBlendMode;
  confidence: number; // 0..1
}

/**
 * Fetch and downscale a product image for vision analysis. Returns
 * base64 + mediaType ready to drop into an Anthropic image content
 * block, or null on any failure (fetch timeout, decode error). Keeps
 * the wider analyzer in line with its "never throw" contract.
 */
async function prepareImageForAnalysis(
  imageUrl: string,
  productId?: number,
): Promise<{ data: string; mediaType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(imageUrl, { signal: controller.signal });
    if (!resp.ok) {
      log.warn(`prepareImageForAnalysis fetch ${resp.status} (productId=${productId}): ${imageUrl}`);
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const resized = await sharp(buf)
      .rotate()
      .resize({ width: IMAGE_MAX_WIDTH_PX, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data: resized.toString("base64"), mediaType: "image/jpeg" };
  } catch (err) {
    log.warn(
      `prepareImageForAnalysis failed (productId=${productId}): ${err instanceof Error ? err.message : String(err)} — url=${imageUrl}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Analyze a single product image. Returns null on any failure (timeout,
 * rate limit, malformed JSON, schema validation reject).
 *
 * Caller is expected to handle null gracefully — never throws. The
 * `productId` argument is logging context only; it does not influence
 * the analysis.
 */
export async function analyzeProductImage(
  imageUrl: string,
  productId?: number,
): Promise<PlacementResult | null> {
  const startedAt = Date.now();
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
    log.warn(`analyzeProductImage skipped — invalid URL (productId=${productId}): ${imageUrl}`);
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.warn(`analyzeProductImage skipped — ANTHROPIC_API_KEY not set (productId=${productId})`);
    return null;
  }

  const prepared = await prepareImageForAnalysis(imageUrl, productId);
  if (!prepared) return null;
  const imageBlock = {
    type: "image_base64" as const,
    image_base64: { media_type: prepared.mediaType, data: prepared.data },
  };
  const baseCfg = {
    provider: ANALYSIS_PROVIDER,
    apiUrl: "https://api.anthropic.com/v1/messages",
    apiKey,
    model: ANALYSIS_MODEL,
    temperature: 0,
    providerOptions: {},
  };

  // ── Stage 1 — observation. Compact 5-bullet description of the
  //    product, obstacles, surface choice, and zone. No JSON, no
  //    coordinates, no category rules. Bullet form (≤25 words each)
  //    keeps output near 150 tokens — diagnostic 2026-04-27 showed
  //    the prior 5-paragraph form drove output to ~625 tokens and
  //    blew the 15s timeout. Stage 2 still gets the full image plus
  //    this prose to commit to coordinates.
  const stage1Prompt = [
    "Senior production decorator inspecting a product image for logo placement.",
    "Answer in 5 short bullets, ≤25 words each:",
    "- PRODUCT (what it is)",
    "- OBSTACLES (any features blocking placement: zippers, seams, existing logos, hardware, shadows)",
    "- BEST SURFACE (largest unobstructed flat area)",
    "- CHOICE (where a decorator would put a logo and why)",
    "- ZONE (location in relative terms — e.g. \"upper-left chest, just below collar\")",
  ].join("\n");

  let stage1Text: string;
  try {
    const result = await Promise.race([
      invokeAnthropic(
        {
          model: ANALYSIS_MODEL,
          maxTokens: STAGE_1_MAX_TOKENS,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: stage1Prompt },
                imageBlock,
              ],
            },
          ],
        } as any,
        { ...baseCfg, maxTokens: STAGE_1_MAX_TOKENS } as any,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("vision-analysis-stage1-timeout")), ANALYSIS_TIMEOUT_MS),
      ),
    ]);
    stage1Text = extractTextFromResult(result);
    if (!stage1Text) {
      log.warn(`analyzeProductImage stage1: empty response (productId=${productId})`);
      return null;
    }
    log.debug(`stage1 observation (productId=${productId}):\n${stage1Text}`);
  } catch (err) {
    log.warn(
      `analyzeProductImage stage1 failed (productId=${productId}): ${err instanceof Error ? err.message : String(err)} — url=${imageUrl}`,
    );
    return null;
  }

  // ── Stage 2 — coordinate extraction. Feed Stage 1's prose back to the
  //    model with the image. Ask for ONLY the JSON envelope. No category
  //    rules, no hard-coded numbers — derive coordinates from the
  //    observation.
  const stage2Prompt = [
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

  let raw: string;
  try {
    const result = await Promise.race([
      invokeAnthropic(
        {
          model: ANALYSIS_MODEL,
          maxTokens: STAGE_2_MAX_TOKENS,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: stage2Prompt },
                imageBlock,
              ],
            },
          ],
        } as any,
        { ...baseCfg, maxTokens: STAGE_2_MAX_TOKENS } as any,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("vision-analysis-stage2-timeout")), ANALYSIS_TIMEOUT_MS),
      ),
    ]);
    raw = extractTextFromResult(result);
    if (!raw) {
      log.warn(`analyzeProductImage stage2: empty response (productId=${productId})`);
      return null;
    }
    log.debug(`stage2 coordinates (productId=${productId}):\n${raw}`);
  } catch (err) {
    log.warn(
      `analyzeProductImage stage2 failed (productId=${productId}): ${err instanceof Error ? err.message : String(err)} — url=${imageUrl}`,
    );
    return null;
  }

  const result = parseAndValidate(raw, productId, imageUrl);
  log.info(`[placement-analysis] completed in ${Date.now() - startedAt}ms for product ${productId}`);
  return result;
}

/** Pull the first text chunk from an Anthropic-shaped envelope. */
function extractTextFromResult(result: any): string {
  const message = result?.choices?.[0]?.message;
  if (!message) return "";
  const text = typeof message.content === "string"
    ? message.content
    : (message.content ?? [])
        .map((part: any) =>
          part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "",
        )
        .join("");
  return text.trim();
}

/**
 * Two-pass JSON parse:
 *   1. Try the raw response as-is — well-behaved Sonnet replies parse
 *      directly here.
 *   2. On failure, strip ``` code fences and any leading/trailing prose
 *      and retry.
 *   3. On second failure, log the full malformed payload (with productId
 *      + image URL for forensics) and return null. The caller treats
 *      null as "leave placement empty, the backfill will retry".
 */
function parseAndValidate(
  raw: string,
  productId: number | undefined,
  imageUrl: string,
): PlacementResult | null {
  // Pass 1 — straight parse.
  const direct = tryParse(raw);
  if (direct !== undefined) return validatePlacement(direct, productId, imageUrl);

  // Pass 2 — strip code fences and surrounding prose.
  const cleaned = extractJsonObject(raw);
  if (cleaned !== null) {
    const second = tryParse(cleaned);
    if (second !== undefined) return validatePlacement(second, productId, imageUrl);
  }

  log.warn(
    `analyzeProductImage: malformed JSON after two-pass parse (productId=${productId}, url=${imageUrl}). Full response:\n${raw}`,
  );
  return null;
}

/** JSON.parse that returns undefined instead of throwing. */
function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Strip ```json``` fences and any text before the first `{` / after the
 * last `}`. Returns the candidate JSON substring or null if nothing
 * resembling an object is present.
 */
function extractJsonObject(raw: string): string | null {
  const fenceStripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const first = fenceStripped.indexOf("{");
  const last = fenceStripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return fenceStripped.slice(first, last + 1);
}

/** Defensive validator. Anything off-spec returns null and logs. */
function validatePlacement(
  input: unknown,
  productId: number | undefined,
  imageUrl: string,
): PlacementResult | null {
  if (!input || typeof input !== "object") {
    log.warn(`analyzeProductImage: parsed value not an object (productId=${productId}, url=${imageUrl})`);
    return null;
  }
  const o = input as Record<string, unknown>;

  const numIn01 = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v < 0 || v > 1) return null;
    return v;
  };
  const x = numIn01(o.x);
  const y = numIn01(o.y);
  const width = numIn01(o.width);
  const height = numIn01(o.height);
  const confidence = numIn01(o.confidence);
  if (x === null || y === null || width === null || height === null || confidence === null) {
    log.warn(`analyzeProductImage: numeric field out of range (productId=${productId}) — ${JSON.stringify(o)}`);
    return null;
  }
  // Allow a tiny slop (1‰) for floating-point rounding from the model.
  if (x + width > 1.001 || y + height > 1.001) {
    log.warn(`analyzeProductImage: bounding box escapes image (productId=${productId}) — ${JSON.stringify(o)}`);
    return null;
  }

  const zone = typeof o.zone === "string" && (ALLOWED_ZONES as readonly string[]).includes(o.zone)
    ? (o.zone as WebstoreImprintZone)
    : null;
  const blendMode = typeof o.blendMode === "string" && (ALLOWED_BLEND_MODES as readonly string[]).includes(o.blendMode)
    ? (o.blendMode as WebstoreImprintBlendMode)
    : null;
  if (!zone || !blendMode) {
    log.warn(`analyzeProductImage: zone or blendMode invalid (productId=${productId}) — zone=${o.zone} blendMode=${o.blendMode}`);
    return null;
  }

  return { x, y, width, height, zone, blendMode, confidence };
}

/**
 * Webstore imprint placement — shared writer used by:
 *   - the productsRouter analyze procedures (single + bulk)
 *   - the Phase 5 ingestion hooks (create / duplicate / seedCatalog /
 *     bulkCreate / uploadImage / copilot import)
 *
 * Returns the per-product status without throwing so bulk callers can
 * aggregate failures cleanly.
 *
 * Skip rules:
 *   - No imageUrl → "no_image" (vision call has nothing to analyze).
 *   - Existing source='distributor_override' → "manual_override",
 *     UNLESS `force=true`. Manual placements are sacred — only the
 *     analyzeWebstoreImprintPlacement procedure with force=true (or
 *     overrideWebstoreImprintPlacement itself) is allowed to mutate
 *     them. The bulk procedure and ALL Phase 5 hooks hardcode
 *     force=false to protect overrides from accidental erasure.
 *
 * Phase 7 UI implication: when the distributor clicks "Re-run AI" on
 * a product whose source is 'distributor_override', the UI MUST show
 * a confirmation dialog before sending force=true. This function does
 * not enforce that prompt — it is the UI's responsibility.
 *
 * On vision failure (analyzeProductImage returns null) we do NOT
 * stamp analyzedAt — leaves the row visible to the
 * `webstore_placement_pending_idx` so the Phase 8 backfill picks it
 * up.
 */
export async function runAnalysisAndPersist(
  db: Db,
  product: {
    id: number;
    imageUrl: string | null;
    webstoreImprintPlacementSource: "ai" | "distributor_override" | null;
    supplierCode: string | null;
    name: string | null;
  },
  scopeWhere: SQL,
  force: boolean,
): Promise<{
  productId: number;
  status: "ok" | "skipped" | "failed";
  reason?: "no_image" | "manual_override" | "vision_failed";
  placement?: PlacementResult;
}> {
  if (product.webstoreImprintPlacementSource === "distributor_override" && !force) {
    return { productId: product.id, status: "skipped", reason: "manual_override" };
  }
  if (!product.imageUrl) {
    return { productId: product.id, status: "skipped", reason: "no_image" };
  }

  const placement = await analyzeProductImage(product.imageUrl, product.id);
  if (!placement) {
    return { productId: product.id, status: "failed", reason: "vision_failed" };
  }

  await db
    .update(products)
    .set({
      webstoreImprintPlacementX: placement.x.toFixed(4),
      webstoreImprintPlacementY: placement.y.toFixed(4),
      webstoreImprintPlacementWidth: placement.width.toFixed(4),
      webstoreImprintPlacementHeight: placement.height.toFixed(4),
      webstoreImprintPlacementZone: placement.zone,
      webstoreImprintPlacementBlendMode: placement.blendMode,
      webstoreImprintPlacementConfidence: placement.confidence.toFixed(2),
      webstoreImprintPlacementAnalyzedAt: new Date(),
      webstoreImprintPlacementSource: "ai",
    })
    .where(and(eq(products.id, product.id), scopeWhere));

  // Cohort propagation: SanMar/PromoStandards bulk imports create one
  // products row per color/size variant under the same product name.
  // Run vision once per family, then mirror the placement to siblings
  // that haven't been analyzed yet. Cohort key is (supplierCode, name)
  // — supplierSku is NULL on ~all rows and per-row sku bases diverge
  // across siblings, so neither is usable. Skip if either field is
  // null (no reliable cohort key — refuse to wildcard-match).
  // The IS NULL guard on analyzedAt + the source!='distributor_override'
  // filter make this idempotent under concurrent backfill workers and
  // protect manual overrides.
  if (product.supplierCode && product.name) {
    const cohortUpdate = await db
      .update(products)
      .set({
        webstoreImprintPlacementX: placement.x.toFixed(4),
        webstoreImprintPlacementY: placement.y.toFixed(4),
        webstoreImprintPlacementWidth: placement.width.toFixed(4),
        webstoreImprintPlacementHeight: placement.height.toFixed(4),
        webstoreImprintPlacementZone: placement.zone,
        webstoreImprintPlacementBlendMode: placement.blendMode,
        webstoreImprintPlacementConfidence: placement.confidence.toFixed(2),
        webstoreImprintPlacementAnalyzedAt: new Date(),
        webstoreImprintPlacementSource: "ai",
      })
      .where(and(
        eq(products.supplierCode, product.supplierCode),
        eq(products.name, product.name),
        ne(products.id, product.id),
        isNull(products.webstoreImprintPlacementAnalyzedAt),
        ne(products.webstoreImprintPlacementSource, "distributor_override"),
      ));
    const siblings = cohortUpdate[0]?.affectedRows ?? 0;
    if (siblings > 0) {
      log.info(
        `cohort propagation: product ${product.id} (supplierCode=${product.supplierCode}, name="${product.name.slice(0, 40)}") → ${siblings} sibling(s)`,
      );
    }
  }

  return { productId: product.id, status: "ok", placement };
}

/**
 * Fire-and-forget single-product analyzer for Phase 5 ingestion hooks.
 * The caller does NOT await this — it returns void. Errors are logged
 * here, never propagated. Skip-status results (no_image / manual_override)
 * are silent because they are expected and noise-prone.
 *
 * Idempotency: each call site is at the insert boundary so productId is
 * fresh. The helper itself respects manual_override (the uploadImage
 * hook can re-fire on a product that already has placement; if a
 * distributor has overridden it, the re-upload does NOT erase the
 * override).
 */
export function runAnalysisAndPersistInBackground(
  db: Db,
  product: {
    id: number;
    imageUrl: string | null;
    webstoreImprintPlacementSource: "ai" | "distributor_override" | null;
    supplierCode: string | null;
    name: string | null;
  },
  scopeWhere: SQL,
): void {
  void runAnalysisAndPersist(db, product, scopeWhere, false)
    .then(result => {
      if (result.status === "failed") {
        log.warn(`background vision failed productId=${product.id} reason=${result.reason}`);
      }
    })
    .catch(err => {
      log.warn(
        `background vision threw productId=${product.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

/**
 * Fire-and-forget bulk analyzer for Phase 5 ingestion hooks that insert
 * many products in one statement (products.bulkCreate, products.seedCatalog,
 * copilotExecProducts.executeImportExternalProduct when it grows multi-product
 * support). Internal concurrency is capped at 10 — same value the
 * analyzeWebstoreImprintPlacementBulk tRPC procedure uses — so a 50-row
 * import never floods Anthropic's rate limit.
 *
 * Failure mode worth knowing: if the process restarts mid-batch, in-flight
 * analyses are lost. Recovery: the Phase 8 backfill picks up products
 * whose webstoreImprintPlacementAnalyzedAt is still NULL on its next
 * pass. At current ingestion volume (a few bulk imports per day) this
 * is acceptable; revisit if bulk analyses fire multiple times per minute
 * — at that point a real BullMQ-backed queue makes sense because the
 * in-process loss rate becomes material.
 */
export function runBulkAnalysisInBackground(
  db: Db,
  productIds: number[],
  scopeWhere: SQL,
): void {
  if (productIds.length === 0) return;

  void (async () => {
    const rows = await db
      .select({
        id: products.id,
        imageUrl: products.imageUrl,
        webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
        supplierCode: products.supplierCode,
        name: products.name,
      })
      .from(products)
      .where(and(inArray(products.id, productIds), scopeWhere));

    const limit = pLimit(10);
    const results = await Promise.all(
      rows.map(row => limit(() => runAnalysisAndPersist(db, row, scopeWhere, false))),
    );

    const ok = results.filter(r => r.status === "ok").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const failed = results.filter(r => r.status === "failed").length;
    log.info(
      `runBulkAnalysisInBackground: ${productIds.length} requested → ok=${ok} skipped=${skipped} failed=${failed}`,
    );
  })().catch(err => {
    log.warn(
      `runBulkAnalysisInBackground threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}
