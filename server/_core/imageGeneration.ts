/**
 * Image generation helper.
 *
 * Text-to-image generation uses dall-e-3 (higher quality output).
 * Image edits keep dall-e-2 because dall-e-3 does not expose the
 *   POST /v1/images/edits endpoint — only dall-e-2 and gpt-image-1 do.
 *
 * Reads APP_OPENAI_API_KEY from .env to avoid sandbox system-level key override.
 *
 * dall-e-2 image edit requirements:
 *  - Must be PNG format
 *  - Must have an alpha channel (RGBA)
 *  - Must be square
 *  - Must be less than 4MB
 */
import { storagePut } from "../storage";
import { ENV } from "./env";

const MAX_PROMPT_LENGTH = 1000;

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
};

/**
 * Convert any image buffer to a square RGBA PNG under 4MB using sharp.
 * This is required by the dall-e-2 image edit endpoint.
 */
async function toRgbaPng(inputBuffer: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  // Get metadata to determine dimensions
  const meta = await sharp(inputBuffer).metadata();
  const size = Math.min(meta.width || 1024, meta.height || 1024, 1024);

  // Resize to square, ensure RGBA PNG, keep under 4MB
  let result = await sharp(inputBuffer)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()        // adds alpha channel → RGBA
    .png({ compressionLevel: 9 })
    .toBuffer();

  // If still over 4MB, reduce size
  let currentSize = size;
  while (result.length > 3.9 * 1024 * 1024 && currentSize > 256) {
    currentSize = Math.floor(currentSize * 0.75);
    result = await sharp(inputBuffer)
      .resize(currentSize, currentSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  return result;
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  // Prefer APP_OPENAI_API_KEY (set explicitly in .env) over the system OPENAI_API_KEY
  const apiKey = ENV.appOpenAiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  // If we have original images, use the image editing endpoint (dall-e-2)
  if (options.originalImages && options.originalImages.length > 0) {
    const img = options.originalImages[0];

    let imageBuffer: Buffer;

    if (img.b64Json) {
      imageBuffer = Buffer.from(img.b64Json, "base64");
    } else if (img.url) {
      // Handle relative URLs by prepending the app base URL
      const appBase = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const fetchUrl = img.url.startsWith("/")
        ? `${appBase}${img.url}`
        : img.url;
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error(`Failed to fetch image: ${fetchUrl}`);
      imageBuffer = Buffer.from(await resp.arrayBuffer());
    } else {
      throw new Error("No image data provided");
    }

    // Convert to RGBA PNG (required by dall-e-2 edit endpoint)
    const rgbaPng = await toRgbaPng(imageBuffer);

    const { FormData, Blob } = await import("formdata-node");
    const form = new FormData();
    form.set("model", "dall-e-2");
    // Truncate prompt to MAX_PROMPT_LENGTH chars (dall-e-2 limit)
    form.set("prompt", options.prompt.substring(0, MAX_PROMPT_LENGTH));
    form.set("image", new Blob([rgbaPng], { type: "image/png" }), "image.png");
    form.set("size", "1024x1024");
    form.set("n", "1");
    form.set("response_format", "b64_json");

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form as unknown as BodyInit,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI image edit failed (${response.status}): ${detail}`);
    }

    const result = (await response.json()) as {
      data: Array<{ b64_json?: string; url?: string }>;
    };

    const item = result.data?.[0];
    if (!item) throw new Error("No image returned from OpenAI");

    let outBuffer: Buffer;
    if (item.b64_json) {
      outBuffer = Buffer.from(item.b64_json, "base64");
    } else if (item.url) {
      const r = await fetch(item.url);
      outBuffer = Buffer.from(await r.arrayBuffer());
    } else {
      throw new Error("OpenAI returned no image data");
    }

    const { url } = await storagePut(`generated/${Date.now()}.png`, outBuffer, "image/png");
    return { url };
  }

  // Text-to-image generation using dall-e-3
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: options.prompt.substring(0, MAX_PROMPT_LENGTH),
      size: "1024x1024",
      n: 1,
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI image generation failed (${response.status}): ${detail}`);
  }

  const result = (await response.json()) as {
    data: Array<{ b64_json?: string; url?: string }>;
  };

  const item = result.data?.[0];
  if (!item) throw new Error("No image returned from OpenAI");

  let outBuffer: Buffer;
  if (item.b64_json) {
    outBuffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const r = await fetch(item.url);
    outBuffer = Buffer.from(await r.arrayBuffer());
  } else {
    throw new Error("OpenAI returned no image data");
  }

  const { url } = await storagePut(`generated/${Date.now()}.png`, outBuffer, "image/png");
  return { url };
}
