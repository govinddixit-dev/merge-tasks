/**
 * AI-powered background removal utility — two-pass hybrid approach.
 *
 * Pass 1 (AI Generative):
 *   Use the AI image generation service in editing mode to remove the background.
 *   This handles complex backgrounds (gradients, photos, patterns).
 *
 * Pass 2 (AI Vision + Sharp Cleanup):
 *   Use LLM vision to detect any remaining background color on the AI result,
 *   then use sharp to replace residual background pixels with full transparency
 *   and trim edges. This catches halos, white edges, or artifacts the AI missed.
 *
 * The combination is more reliable than either approach alone.
 */
import sharp from "sharp";
import { safeLLM } from "../_core/safeLLM";
import { generateImage } from "../_core/imageGeneration";
import { storagePut } from "../storage";
import { getLogger } from "../utils/logger";

const log = getLogger("removeBackground");

interface RemoveBackgroundOptions {
  imageBuffer: Buffer;
  imageUrl?: string; // S3 URL of the original upload
  mimeType?: string;
}

interface RemoveBackgroundResult {
  buffer: Buffer;
  url: string; // Final S3 URL of the processed logo
  mimeType: string;
}

//  Pass 1: AI Generative Background Removal 

async function aiRemoveBackground(
  imageUrl: string,
  mimeType: string
): Promise<{ url: string; buffer: Buffer } | null> {
  try {
    log.info("Pass 1: AI generative background removal...");
    const result = await generateImage({
      prompt:
        "Remove the background from this logo image completely. Make the background fully transparent. Keep only the logo graphic, text, and icon with crisp, clean edges. Do not modify, resize, or alter the logo itself in any way. Output a clean logo on a perfectly transparent background.",
      originalImages: [
        {
          url: imageUrl,
          mimeType,
        },
      ],
    });

    if (result.url) {
      // Download the AI result to get the buffer for pass 2
      const response = await fetch(result.url);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        log.info("Pass 1 complete — AI returned processed image");
        return { url: result.url, buffer };
      }
    }
    return null;
  } catch (err) {
    log.warn("Pass 1 (AI generative) failed", err);
    return null;
  }
}

//  Pass 2: AI Vision Detection + Sharp Pixel Cleanup 

/**
 * Use LLM vision to detect the dominant background color remaining in the image.
 */
async function detectBackgroundColor(
  imageUrl: string
): Promise<{ r: number; g: number; b: number } | null> {
  try {
    log.info("Pass 2a: AI vision detecting residual background color...");
    const result = await safeLLM({
      messages: [
        {
          role: "system",
          content:
            'You analyze images and identify their background color. Respond ONLY with a JSON object of the RGB values. The background is the dominant color surrounding the main graphic. If the background is already transparent or has no solid background, respond with {"r":-1,"g":-1,"b":-1}.',
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'What is the exact RGB background color of this image? Look at the corners and edges — what color fills the area behind the logo? If the background is already transparent/removed, respond {"r":-1,"g":-1,"b":-1}. Otherwise respond with the RGB values like {"r":255,"g":255,"b":255}.',
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "low",
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "background_color",
          strict: true,
          schema: {
            type: "object",
            properties: {
              r: { type: "integer", description: "Red channel 0-255, or -1 if transparent" },
              g: { type: "integer", description: "Green channel 0-255, or -1 if transparent" },
              b: { type: "integer", description: "Blue channel 0-255, or -1 if transparent" },
            },
            required: ["r", "g", "b"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = result.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      const parsed = JSON.parse(content);
      if (parsed.r === -1 && parsed.g === -1 && parsed.b === -1) {
        log.info("Pass 2a: AI says background is already transparent — skipping cleanup");
        return null; // Already transparent
      }
      if (
        typeof parsed.r === "number" &&
        typeof parsed.g === "number" &&
        typeof parsed.b === "number"
      ) {
        log.info(`Pass 2a: Detected residual background color rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`);
        return { r: parsed.r, g: parsed.g, b: parsed.b };
      }
    }
    return null;
  } catch (err) {
    log.warn("Pass 2a (AI vision) failed", err);
    return null;
  }
}

/**
 * Use sharp to replace pixels matching the target color with transparency.
 */
async function cleanupWithSharp(
  imageBuffer: Buffer,
  bgColor: { r: number; g: number; b: number },
  threshold: number = 40
): Promise<Buffer> {
  log.info(`Pass 2b: Sharp cleanup — removing rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b}) with threshold ${threshold}...`);

  const image = sharp(imageBuffer).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(data);

  let removedCount = 0;

  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    // Euclidean distance in RGB space
    const distance = Math.sqrt(
      (r - bgColor.r) ** 2 + (g - bgColor.g) ** 2 + (b - bgColor.b) ** 2
    );

    if (distance < threshold) {
      pixels[i + 3] = 0; // Set alpha to 0 (fully transparent)
      removedCount++;
    }
  }

  log.info(`Pass 2b: Removed ${removedCount} background pixels`);

  // Reconstruct image
  const resultBuffer = await sharp(Buffer.from(pixels), {
    raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
  })
    .png()
    .toBuffer();

  // Trim transparent edges
  try {
    const trimmed = await sharp(resultBuffer).trim().png().toBuffer();
    return trimmed;
  } catch {
    // trim() can fail if the entire image becomes transparent
    return resultBuffer;
  }
}

//  Main Export 

/**
 * Remove the background from a logo image using a two-pass AI + sharp approach.
 */
export async function removeBackground(
  options: RemoveBackgroundOptions
): Promise<RemoveBackgroundResult> {
  const { imageBuffer, imageUrl, mimeType = "image/png" } = options;
  const timestamp = Date.now();

  // Determine the URL to use for AI analysis
  let workingUrl = imageUrl;
  let workingBuffer = imageBuffer;

  // If no URL provided, upload the buffer first so AI can analyze it
  if (!workingUrl) {
    const { url } = await storagePut(
      `branding/temp/logo-${timestamp}.png`,
      imageBuffer,
      mimeType
    );
    workingUrl = url;
  }

  //  Pass 1: AI Generative Background Removal 
  const aiResult = await aiRemoveBackground(workingUrl, mimeType);
  if (aiResult) {
    workingBuffer = aiResult.buffer;
    workingUrl = aiResult.url;
  }

  //  Pass 2: AI Vision + Sharp Cleanup 
  const residualBgColor = await detectBackgroundColor(workingUrl);

  if (residualBgColor) {
    // There's still a background — clean it up with sharp
    workingBuffer = await cleanupWithSharp(workingBuffer, residualBgColor);
  } else if (!aiResult) {
    // AI pass 1 failed AND vision says no bg detected — fall back to white removal
    log.info("Both AI passes inconclusive — falling back to white background removal");
    workingBuffer = await cleanupWithSharp(workingBuffer, { r: 255, g: 255, b: 255 });
  }

  // Upload the final processed image to S3
  const { url: finalUrl } = await storagePut(
    `branding/processed/logo-${timestamp}.png`,
    workingBuffer,
    "image/png"
  );

  log.info(`Complete — final logo URL: ${finalUrl}`);

  return {
    buffer: workingBuffer,
    url: finalUrl,
    mimeType: "image/png",
  };
}
