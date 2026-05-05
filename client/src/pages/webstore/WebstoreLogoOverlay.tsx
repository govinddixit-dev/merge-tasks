/**
 * WebstoreLogoOverlay — customer-facing logo composite for the Tier 1
 * webstore. Reads per-product placement coordinates analyzed by Claude
 * vision at ingestion (server/services/webstore-imprint-placement.ts)
 * and cached on products.webstoreImprintPlacement* columns.
 *
 * ──────────────────────────────────────────────────────────────────────
 * RELATIONSHIP TO THE ORIGINAL LogoOverlay.tsx
 * ──────────────────────────────────────────────────────────────────────
 * This is a Phase 6 fork. The original LogoOverlay.tsx remains in place
 * and is consumed by the distributor's ImprintZoneEditor preview (which
 * uses static category presets via getDefaultPlacement). DO NOT swap
 * ImprintZoneEditor onto this component — the two coordinate models are
 * intentionally different.
 *
 * What this fork changes vs the original:
 *
 *   1. Per-product AI coordinates instead of category presets.
 *      Original: getDefaultPlacement(product.category) → one placement
 *      per category, ignored per-product geometry.
 *      Fork: reads webstoreImprintPlacementX/Y/Width/Height/BlendMode
 *      from the product row.
 *
 *   2. Coordinate space = the rendered IMAGE, not the wrapper.
 *      Original: positioned the overlay using % of the outer wrapper
 *      div, so when the image was contained with letterbox padding the
 *      logo drifted into the whitespace at the corner of the frame
 *      (the OGIO Crunch bug). The vision call analyzes the source
 *      image; coordinates are image-relative percentages and must be
 *      applied in image-relative space.
 *      Fork: the image lives in an inner relative box that sizes to
 *      the image's natural rendered bounds; the overlay positions
 *      absolutely inside THAT box.
 *
 *   3. mixBlendMode comes from the product's blendMode column.
 *      Original: hardcoded "multiply".
 *      Fork: vision picks per surface — multiply for fabric, normal for
 *      hard surfaces, etc.
 *
 *   4. No fallback when placement is missing. console.warn with the
 *      productId and render no overlay. Post-Phase-5 every newly-
 *      ingested product has placement; missing data is a backfill
 *      gap (supplier sync paths) or a vision failure to investigate,
 *      not a case to silently paper over.
 *
 *   5. No imageFit prop. Always object-contain. Edge-to-edge "cover"
 *      cards would crop the image and could hide an AI-placed logo;
 *      the cosmetic loss is acceptable, the credibility loss of a
 *      logo floating off-product is not.
 */

import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";

/** Allowed blend modes match server/services/webstore-imprint-placement.ts:ALLOWED_BLEND_MODES. */
export type WebstoreBlendMode =
  | "normal" | "multiply" | "screen" | "overlay" | "darken";

/**
 * Normalized AI placement (all values in 0..1 image-relative coordinates).
 * Mirrors PlacementResult from server/services/webstore-imprint-placement.ts
 * with the fields the client actually needs to render.
 */
export interface WebstorePlacement {
  x: number;       // left edge of logo box, 0..1 of image width
  y: number;       // top edge of logo box, 0..1 of image height
  width: number;   // logo box width, 0..1 of image width
  height: number;  // logo box height, 0..1 of image height
  blendMode: WebstoreBlendMode;
}

/**
 * Pull placement out of a product row. Returns null if any required
 * column is null — strict all-or-nothing so a half-populated row can't
 * render a half-positioned logo.
 *
 * The decimal columns come back as strings via mysql2/Drizzle, so we
 * parseFloat each one. blendMode is a varchar that the server validates
 * against ALLOWED_BLEND_MODES at write time, so we trust it on read.
 */
export function extractWebstorePlacement(product: {
  webstoreImprintPlacementX: string | null;
  webstoreImprintPlacementY: string | null;
  webstoreImprintPlacementWidth: string | null;
  webstoreImprintPlacementHeight: string | null;
  webstoreImprintPlacementBlendMode: string | null;
}): WebstorePlacement | null {
  const x  = product.webstoreImprintPlacementX;
  const y  = product.webstoreImprintPlacementY;
  const w  = product.webstoreImprintPlacementWidth;
  const h  = product.webstoreImprintPlacementHeight;
  const bm = product.webstoreImprintPlacementBlendMode;
  if (x === null || y === null || w === null || h === null || bm === null) {
    return null;
  }
  return {
    x: parseFloat(x),
    y: parseFloat(y),
    width: parseFloat(w),
    height: parseFloat(h),
    blendMode: bm as WebstoreBlendMode,
  };
}

interface WebstoreLogoOverlayProps {
  /** Product ID — used only for the missing-placement console.warn. */
  productId: number;
  /** Product image URL — rendered as the base layer. */
  productImageUrl: string | null;
  /** Client logo URL from store.client.logoUrl — may be null. */
  logoUrl: string | null;
  /**
   * Per-product placement from the AI vision analysis. null means the
   * row hasn't been analyzed yet (or the vision call failed); the
   * component renders the bare product image and console.warns.
   */
  placement: WebstorePlacement | null;
  /**
   * Photorealistic image to display (override > AI render). Pre-gated
   * upstream by Phase 7 approval logic in storesCrud.getBySlug — the
   * caller passes null whenever the distributor has not approved the
   * render, and this component renders the CSS logo composite as the
   * customer-facing fallback. The component itself stays approval-
   * agnostic: a non-null URL means "show this".
   *
   * When non-null this image overlays the CSS composite once it loads.
   * On load failure (onError), the CSS composite below remains visible.
   */
  renderedImageUrl?: string | null;
  /** Alt text for the product image. */
  alt?: string;
  /** CSS classes applied to the outermost wrapper. */
  className?: string;
  /** Store primary color — tints the BRANDED badge on cards. */
  primaryColor?: string;
}

/**
 * WebstoreLogoOverlayCard — lightweight card variant. No primary color
 * tint. Same coordinate-space contract as the full component.
 */
export function WebstoreLogoOverlayCard(
  props: Omit<WebstoreLogoOverlayProps, "primaryColor">,
) {
  return <WebstoreLogoOverlay {...props} />;
}

export default function WebstoreLogoOverlay({
  productId,
  productImageUrl,
  logoUrl,
  placement,
  renderedImageUrl = null,
  alt = "",
  className = "",
  primaryColor = "#6C2BD9",
}: WebstoreLogoOverlayProps) {
  // Photoreal layer load state. We render the photoreal <img> in the
  // DOM as soon as a URL is available so the browser can start fetching,
  // but keep it visually hidden until onLoad fires — that prevents a
  // flash of half-loaded photoreal over the CSS composite. onError
  // flips loadFailed and we never reveal the photoreal layer; the CSS
  // composite below stays visible. Reset both flags whenever the URL
  // changes so a re-render's new URL gets a fresh load cycle.
  const [photorealLoaded, setPhotorealLoaded] = useState(false);
  const [photorealFailed, setPhotorealFailed] = useState(false);
  // Ref to the photoreal <img> so we can probe its native load state
  // after mount — the browser caches the WebP after the first load
  // (e.g. PDP visit), and on a subsequent listing-card render the cached
  // image fires onLoad SYNCHRONOUSLY before React attaches the listener.
  // Without this manual `complete` check the listener misses the event,
  // photorealLoaded stays false, and the card falls back to the CSS
  // composite even though the photoreal is sitting ready in cache.
  const photorealImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    setPhotorealLoaded(false);
    setPhotorealFailed(false);
    const node = photorealImgRef.current;
    if (node && node.complete && node.naturalWidth > 0) {
      setPhotorealLoaded(true);
    }
  }, [renderedImageUrl]);

  // Warn once per missing-placement product so the dev can investigate
  // the ingestion path. Skipped when there's no logo to overlay anyway
  // (no useful render even with placement) or no product image.
  useEffect(() => {
    if (productImageUrl && logoUrl && !placement) {
      // eslint-disable-next-line no-console
      console.warn(
        `[WebstoreLogoOverlay] No placement data for productId=${productId}. ` +
        `Phase 5 ingestion hooks should have populated it; this row may have ` +
        `been created via a non-hooked path (supplier sync) awaiting Phase 8 ` +
        `backfill, or the analysis call failed.`,
      );
    }
  }, [productId, productImageUrl, logoUrl, placement]);

  const showLogo = !!logoUrl && !!placement;
  // Photoreal shows when a URL exists and the browser successfully loaded
  // it. The Blank toggle was removed — customers always see the branded
  // composite (photoreal if available, CSS overlay otherwise).
  const showPhotoreal =
    !!renderedImageUrl && photorealLoaded && !photorealFailed;
  // The CSS-composite logo layer doubles as the during-load and on-error
  // fallback for the photoreal. Once the photoreal has loaded it MUST
  // disappear — otherwise the CSS logo bleeds through anti-aliased alpha
  // edges of the photoreal and shows around aspect-ratio letterbox bands
  // when the rendered image's aspect differs from the source's.
  const showCssLogo = showLogo && !showPhotoreal;

  return (
    <div className={`relative w-full h-full ${className}`}>
      {productImageUrl ? (
        // Middle layer: centers the image-bounded inner box inside the
        // outer wrapper. The inner box sizes to the image's actual
        // rendered dimensions thanks to flex's content-sizing default,
        // so absolute children inside it use image-relative coordinates.
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative max-w-full max-h-full">
            <img
              src={productImageUrl}
              alt={alt}
              className="block max-w-full max-h-full object-contain transition-opacity duration-200"
              style={{ opacity: showPhotoreal ? 0 : 1 }}
              draggable={false}
            />
            {showCssLogo && (
              <div
                className="absolute pointer-events-none select-none"
                style={{
                  left:   `${placement!.x * 100}%`,
                  top:    `${placement!.y * 100}%`,
                  width:  `${placement!.width * 100}%`,
                  height: `${placement!.height * 100}%`,
                  mixBlendMode: placement!.blendMode,
                }}
                aria-hidden="true"
              >
                <img
                  src={logoUrl!}
                  alt=""
                  className="w-full h-full object-contain drop-shadow-sm"
                  draggable={false}
                />
              </div>
            )}
            {/* Photoreal nano-banana layer. Always mounted when a URL
                is present (so the browser can prefetch), but visually
                hidden until onLoad. Sits absolutely over the same inner
                box so the CSS composite below shows through during load
                and after a load failure. */}
            {renderedImageUrl && !photorealFailed && (
              <img
                ref={photorealImgRef}
                src={renderedImageUrl}
                alt=""
                draggable={false}
                onLoad={() => setPhotorealLoaded(true)}
                onError={() => setPhotorealFailed(true)}
                aria-hidden="true"
                className="absolute inset-0 block w-full h-full object-contain transition-opacity duration-200"
                style={{ opacity: showPhotoreal ? 1 : 0 }}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Package size={40} className="text-[#D4D4D4]" />
        </div>
      )}

      {/* "BRANDED" badge — shows whenever EITHER decoration layer is
          producing output. The Branded/Blank toggle was removed;
          customers always see the branded composite. */}
      {(showCssLogo || showPhotoreal) && (
        <span
          className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider text-white shadow-sm pointer-events-none"
          style={{ backgroundColor: `${primaryColor}CC` }}
          aria-label="Branded preview"
        >
          Branded
        </span>
      )}
    </div>
  );
}
