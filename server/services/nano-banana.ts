/**
 * nano-banana.ts — Tier 1 webstore photorealistic render adapter.
 *
 * Pipeline:
 *   product image URL + customer logo URL + AI placement coords + decoration method
 *     → fetch both images, base64-encode
 *     → POST to generativelanguage.googleapis.com (gemini-3.1-flash-image-preview)
 *     → receive base64 PNG of the decorated product
 *     → transcode to WebP via sharp
 *     → upload to S3 at webstore-renders/{productId}/{timestamp}.webp
 *     → return { ok: true, url, key, durationMs, modelUsed }
 *
 * ──────────────────────────────────────────────────────────────────────
 * SCOPE BOUNDARY — read this before adding callers
 * ──────────────────────────────────────────────────────────────────────
 *
 * This adapter is webstore-only. The distributor virtual proofing studio
 * (server/routers/proofing.ts → OpenAI Images) is a SEPARATE pipeline.
 * Do NOT unify the two. See docs/virtual-proofing-recon.md.
 *
 * This file is also intentionally separate from server/_core/llm.ts
 * (invokeLLM and the OpenAI-shim Gemini adapter). The shim is text-only
 * and cannot reach the native image-generation endpoint. Do NOT route
 * this through invokeLLM.
 *
 * Cost: ~$0.039 per render (one-time, persisted forever in S3).
 *
 * Failure policy: never throws. All failure paths return a tagged
 * { ok: false, reason } so the worker can persist webstoreRenderStatus
 * = 'failed' and move on without crashing the queue.
 */

import { storagePut } from "../storage";
import { ENV } from "../_core/env";
import { getLogger } from "../utils/logger";

const log = getLogger("nano-banana");

/**
 * Render model — Gemini 2.5 Flash Image ("Nano Banana"), the stable
 * production image-edit model. Both constants point to the same model:
 * the 404-retry path in callNanoBanana now functions as a single
 * transient-error retry rather than a model-tier fallback.
 */
const PRIMARY_MODEL = "gemini-2.5-flash-image";
const FALLBACK_MODEL = "gemini-2.5-flash-image";

/** Hard cap so a stuck render never blocks the worker indefinitely. */
const RENDER_TIMEOUT_MS = 60_000;

export type DecorationMethod =
  | "embroidery"
  | "screen_print"
  | "laser_engraving"
  | "heat_transfer"
  | "dtg"
  | "sublimation"
  | "deboss"
  | "patch";

/**
 * Decoration-specific physics fragments. Each describes how the
 * decoration sits on the product so the model renders the right
 * surface treatment, not just a flat logo paste.
 *
 * These started as a copy of server/routers/proofing.ts:DECORATION_PROMPTS
 * but will diverge over time as we tune for nano-banana vs DALL·E. Do
 * not import from proofing.ts — the two pipelines are intentionally
 * decoupled.
 */
const DECORATION_PROMPTS: Record<DecorationMethod, string> = {
  embroidery:
    "Embroidery: raised thread texture with visible individual stitch lines, dimensional 3D depth from thread buildup, satin and fill stitches catching the light with subtle shadows along stitch edges, slight fuzziness at thread boundaries. The logo appears stitched directly into the fabric, with thread fibers integrated into the weave and the underlying fabric texture visible between stitches. Size to professional decoration norms: chest-zone embroidery (left_chest, right_chest) is typically 3-4 inches wide on the garment (~10-12% of image width); sleeve embroidery is 2-3 inches (~6-8% of image width); full-back embroidery is 8-10 inches (~28-32% of image width). For embroidery on a cap front: render at modest scale matching a typical embroidered patch on a real Yupoong, FlexFit, or New Era fitted cap — proportional and restrained. Aim for approximately credit-card size on the visible cap-front panel, occupying around 25-30% of the panel. Render the logo as restrained corporate branding. If the bounding box exceeds the appropriate decoration size, render at the smaller decoration-norm size, centered on the bounding box's center point.",
  screen_print:
    "Screen print: smooth plastisol ink layer sitting just on top of the fabric surface with a flat matte finish, crisp clean edges, very slight raised texture where the ink layer meets the fabric. Colors are opaque and the ink rests on the fabric weave, with the fabric's surface contour curving the ink with it. Size to professional decoration norms: chest-zone screen print is typically 3-4 inches wide (~10-12% of image width); full-front print is 8-12 inches (~28-40% of image width); full-back print is 10-12 inches (~32-40% of image width); sleeve print is 2-3 inches (~6-8% of image width). If the bounding box exceeds the appropriate decoration size, render at the smaller decoration-norm size, centered on the bounding box's center point.",
  laser_engraving:
    "Laser engraving: debossed into the material surface with visible depth, the engraved area showing the substrate beneath where the surface has been removed, sharp clean edges, darker tonal contrast inside the engraved region with a subtle shadow at the depth transition. The engraving curves with the substrate's surface — wrapping around tumblers, conforming to the contour of mugs and pens. Size to professional decoration norms for hard goods: typical laser engravings are 1-2 inches wide on tumblers, mugs, pens, and other small hard goods (~15-25% of the visible engravable face width); larger flat surfaces like notebook covers may carry 2-3 inch engravings (~30-40% of cover width). If the bounding box exceeds the appropriate decoration size, render at the smaller decoration-norm size, centered on the bounding box's center point.",
  heat_transfer:
    "Heat transfer vinyl: clean application sitting slightly above the fabric, smooth vinyl surface with a subtle sheen, sharp die-cut edges, uniform thickness with a hint of dimensional lift. The vinyl bends with the fabric's folds and contours; the surrounding fabric's weave is visible at the vinyl's edges. Size to professional decoration norms: chest-zone heat transfer is typically 3-4 inches wide (~10-12% of image width); full-front transfer is 8-12 inches (~28-40% of image width); full-back transfer is 10-12 inches (~32-40% of image width). If the bounding box exceeds the appropriate decoration size, render at the smaller decoration-norm size, centered on the bounding box's center point.",
  dtg:
    "DTG (direct-to-garment) print: DTG ink is absorbed into the fabric weave. The fabric's individual fibers and grain remain clearly visible through the ink. Colors are slightly desaturated by the fabric beneath. The decoration is flush with — not on top of — the fabric surface. Size to professional decoration norms: chest-zone DTG is typically 3-4 inches wide (~10-12% of image width); full-front DTG is 8-12 inches (~28-40% of image width); full-back DTG is 10-12 inches (~32-40% of image width). DTG can scale up freely since it's print-based, but professional norms still hold for a clean appearance. If the bounding box exceeds the appropriate decoration size, render at the smaller decoration-norm size, centered on the bounding box's center point.",
  sublimation:
    "Sublimation: dye fully integrated into the material with vibrant photographic color quality. The fabric's weave and surface texture remain visible through the dye, since the dye becomes part of the fabric fibers themselves. Sublimation is typically used for full-coverage all-over prints or large decorated areas — fill the bounding box generously rather than constraining to small chest-zone norms. For full-coverage products (cut-and-sew jerseys, all-over-print apparel) the design covers the entire visible product surface; for spot sublimation on a mug or panel, fill 60-80% of the visible decoratable face.",
  deboss:
    "Deboss: pressed and impressed into the material surface with visible indented depth, soft shadow within the impression following the product's lighting direction, clean compressed edges. The impression takes on the same color as the substrate (the material itself shows through). The debossed area conforms to the substrate's curvature — wrapping around leather wallets, sitting flush on flat notebook covers. Size to professional decoration norms: notebook/journal covers typically carry 2-3 inch debossed marks (~25-35% of cover width); leather goods (wallets, portfolios) typically 1-2 inches (~20-30% of the visible face); office accessories vary. If the bounding box exceeds the appropriate decoration size, render at the smaller decoration-norm size, centered on the bounding box's center point.",
  patch:
    "Sewn-on embroidered patch: visible patch perimeter with merrowed border stitching, slightly raised from the garment surface with a soft shadow underneath, patch backing visible at the edges, stitched-down attachment. The patch bends and conforms to the underlying garment's folds; surrounding fabric texture is visible at the patch's edges. Size to professional decoration norms: chest-zone patches are typically 3-3.5 inches wide (~10-11% of image width); sleeve patches are 2-3 inches (~6-8% of image width); back patches are 4-10 inches depending on application. If the bounding box exceeds the appropriate decoration size, render at the smaller decoration-norm size, centered on the bounding box's center point.",
};

export type NanoBananaRenderInput = {
  /** Public URL of the blank product photo. */
  productImageUrl: string;
  /** Public URL of the customer's processed (alpha-cleaned) logo. */
  logoUrl: string;
  /** Optional product name for prompt grounding ("Polo shirt", "Tumbler"). */
  productName?: string;
  /** 8-method decoration enum, matches the products schema. */
  decorationMethod: DecorationMethod;
  /**
   * Normalized image-relative placement from Phase 3 vision analysis.
   * x/y/w/h are in 0..1 space relative to the product image.
   * zone is a human-readable anchor like "chest_left" or "cap_front".
   */
  placement: {
    x: number;
    y: number;
    w: number;
    h: number;
    zone?: string;
  };
};

export type NanoBananaRenderResult =
  | {
      ok: true;
      url: string;
      key: string;
      durationMs: number;
      modelUsed: string;
    }
  | {
      ok: false;
      reason:
        | "no_api_key"
        | "fetch_input_failed"
        | "model_call_failed"
        | "no_image_returned"
        | "transcode_failed"
        | "upload_failed"
        | "timeout";
      error?: string;
    };

/**
 * Build the model prompt. The most important rules:
 *   1. Preserve the existing product photo exactly. The output is the
 *      SAME photo with a logo applied — not an AI reinterpretation.
 *   2. Use the normalized placement coords as an anchor. The zone name
 *      ("chest_left") helps the model ground spatially; the numeric
 *      x/y/w/h pin it down.
 *   3. Apply the decoration physics for the specific method. Embroidery
 *      ≠ screen print ≠ laser engraving — each has its own surface
 *      behavior described in DECORATION_PROMPTS.
 *   4. Match lighting to the source. The logo's shading must follow
 *      the product photo's existing light direction.
 */
function buildPrompt(input: NanoBananaRenderInput): string {
  const { x, y, w, h, zone } = input.placement;
  const decorationPhysics = DECORATION_PROMPTS[input.decorationMethod];
  const productLabel = input.productName ? ` (${input.productName})` : "";
  const zonePhrase = zone ? zone.replace(/_/g, " ") : "the indicated region";
  const decorationLabel = input.decorationMethod.replace(/_/g, " ");

  const xPct = (x * 100).toFixed(1);
  const yPct = (y * 100).toFixed(1);
  const wPct = (w * 100).toFixed(1);
  const hPct = (h * 100).toFixed(1);

  return [
    `Composite the logo from Image 2 onto the apparel${productLabel} in Image 1 as a realistic ${decorationLabel} decoration on the ${zonePhrase}.`,
    ``,
    `Logo placement (relative to the visible apparel area):`,
    `  - Center at x=${xPct}%, y=${yPct}%`,
    `  - Width=${wPct}%, Height=${hPct}%`,
    `  - The logo's center must fall on the ${zonePhrase}; if the bounding box and zone disagree, follow the zone.`,
    ``,
    `Integration requirements:`,
    `- The logo must drape onto the fabric, following its existing folds, contours, and surface curvature.`,
    `- The fabric's weave and texture must remain clearly visible through the decoration.`,
    `- The logo's edges should bend and conform to the underlying surface — not appear as a flat sticker pasted on top.`,
    `- Match the lighting direction of Image 1: shadows and highlights on the logo must be consistent with how light falls on the surrounding fabric.`,
    `- The decoration must look like a real photograph of a finished garment, not a digital mockup or AI illustration.`,
    ``,
    decorationPhysics,
    ``,
    `Preserve the apparel's shape, fabric texture, lighting, drape, and background exactly as they appear in Image 1. Only the addition of the decoration changes.`,
    ``,
    `Output: a single photographic image with no text, watermarks, captions, borders, or alterations to the garment beyond the decoration.`,
  ].join("\n");
}

/**
 * Fetch a remote image and return it base64-encoded with its MIME type.
 * Gemini's native generateContent API accepts inline base64 only — it
 * cannot fetch URLs on its own (same constraint OpenAI Images has on
 * the edits endpoint, see imageGeneration.ts:88-91).
 */
async function fetchAsBase64(
  url: string,
): Promise<{ data: string; mimeType: string }> {
  const appBase =
    process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const fetchUrl = url.startsWith("/") ? `${appBase}${url}` : url;

  const resp = await fetch(fetchUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${fetchUrl} (HTTP ${resp.status})`);
  }
  const mimeType = resp.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { data: buffer.toString("base64"), mimeType };
}

type GeminiInlinePart = { inline_data: { mime_type: string; data: string } };
type GeminiTextPart = { text: string };
type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inline_data?: { mime_type: string; data: string };
        inlineData?: { mimeType: string; data: string };
      }>;
    };
  }>;
  error?: { code?: number; message?: string; status?: string };
};

/**
 * Call the Gemini native image-generation endpoint. Tries the primary
 * model first; on 404 (model not available), falls back to
 * gemini-2.5-flash-image with explicit logging.
 *
 * Returns { buffer, modelUsed } or throws on unrecoverable failure.
 */
async function callNanoBanana(
  prompt: string,
  productImg: { data: string; mimeType: string },
  logoImg: { data: string; mimeType: string },
  signal: AbortSignal,
): Promise<{ buffer: Buffer; modelUsed: string }> {
  const parts: Array<GeminiTextPart | GeminiInlinePart> = [
    { text: prompt },
    { inline_data: { mime_type: productImg.mimeType, data: productImg.data } },
    { inline_data: { mime_type: logoImg.mimeType, data: logoImg.data } },
  ];
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseModalities: ["IMAGE"] },
  });

  async function tryModel(model: string): Promise<Response> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      ENV.geminiApiKey,
    )}`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
  }

  let resp = await tryModel(PRIMARY_MODEL);
  let modelUsed = PRIMARY_MODEL;

  if (resp.status === 404) {
    log.warn(`Model ${PRIMARY_MODEL} returned 404 — retrying once`);
    resp = await tryModel(FALLBACK_MODEL);
    modelUsed = FALLBACK_MODEL;
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Gemini ${modelUsed} call failed (HTTP ${resp.status}): ${detail}`);
  }

  const json = (await resp.json()) as GeminiResponse;
  if (json.error) {
    throw new Error(`Gemini ${modelUsed} error: ${json.error.message || json.error.status}`);
  }

  const partsOut = json.candidates?.[0]?.content?.parts ?? [];
  for (const p of partsOut) {
    const inline = p.inline_data || p.inlineData;
    if (inline?.data) {
      return { buffer: Buffer.from(inline.data, "base64"), modelUsed };
    }
  }
  throw new Error(`Gemini ${modelUsed} returned no image part`);
}

/**
 * Render a product photo with a customer logo applied via nano-banana.
 * Never throws — all failures return { ok: false, reason }.
 */
export async function renderProductWithLogo(
  input: NanoBananaRenderInput,
  productId: number,
): Promise<NanoBananaRenderResult> {
  const startedAt = Date.now();

  if (!ENV.geminiApiKey) {
    log.warn("GEMINI_API_KEY is not configured — skipping render");
    return { ok: false, reason: "no_api_key" };
  }

  let productImg: { data: string; mimeType: string };
  let logoImg: { data: string; mimeType: string };
  try {
    [productImg, logoImg] = await Promise.all([
      fetchAsBase64(input.productImageUrl),
      fetchAsBase64(input.logoUrl),
    ]);
  } catch (err) {
    log.error(`Input fetch failed for product ${productId}: ${(err as Error).message}`);
    return { ok: false, reason: "fetch_input_failed", error: (err as Error).message };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

  let pngBuffer: Buffer;
  let modelUsed: string;
  try {
    const prompt = buildPrompt(input);
    const result = await callNanoBanana(prompt, productImg, logoImg, controller.signal);
    pngBuffer = result.buffer;
    modelUsed = result.modelUsed;
  } catch (err) {
    clearTimeout(timeoutHandle);
    const msg = (err as Error).message || String(err);
    if (controller.signal.aborted) {
      log.error(`Render timed out after ${RENDER_TIMEOUT_MS}ms for product ${productId}`);
      return { ok: false, reason: "timeout" };
    }
    if (msg.includes("returned no image part")) {
      log.error(`No image returned for product ${productId}: ${msg}`);
      return { ok: false, reason: "no_image_returned", error: msg };
    }
    log.error(`Model call failed for product ${productId}: ${msg}`);
    return { ok: false, reason: "model_call_failed", error: msg };
  } finally {
    clearTimeout(timeoutHandle);
  }

  let webpBuffer: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    webpBuffer = await sharp(pngBuffer).webp({ quality: 88 }).toBuffer();
  } catch (err) {
    log.error(`WebP transcode failed for product ${productId}: ${(err as Error).message}`);
    return { ok: false, reason: "transcode_failed", error: (err as Error).message };
  }

  let stored: { key: string; url: string };
  try {
    const key = `webstore-renders/${productId}/${Date.now()}.webp`;
    stored = await storagePut(key, webpBuffer, "image/webp");
  } catch (err) {
    log.error(`Storage upload failed for product ${productId}: ${(err as Error).message}`);
    return { ok: false, reason: "upload_failed", error: (err as Error).message };
  }

  const durationMs = Date.now() - startedAt;
  log.info(
    `Rendered product ${productId} via ${modelUsed} in ${durationMs}ms → ${stored.url}`,
  );
  return { ok: true, url: stored.url, key: stored.key, durationMs, modelUsed };
}
