/**
 * VariantProductCard — shared product card for the distributor catalog
 * and customer webstore. Phase 8 collapses N color rows into one card
 * with a swatch strip. Hover a swatch → main image swaps to that
 * variant's image (instant; images are already in the variants array).
 *
 * Visual language: Apple-for-enterprise — minimal frame, the image is
 * the hero, swatches are 16px filled circles below the image. No card
 * shadow, no borders by default; hover lifts only via subtle bg.
 *
 * Click anywhere on the card → onSelect(styleGroup) (caller routes to
 * the appropriate PDP).
 *
 * Variants without an explicit colorHex fall back to colorMap; if the
 * map misses they fall back to the swatchUrl photo cropped into a
 * circle. Truly unmapped variants render as a neutral grey dot.
 */
import React, { useState } from "react";
import { colorNameToHex } from "@/lib/colorMap";

export interface VariantSummary {
  productId: number;
  colorName: string | null;
  colorHex: string | null;
  swatchUrl: string | null;
  imageUrl: string | null;
}

export interface VariantProductCardProps {
  styleGroup: string;
  primary: {
    name: string;
    sku: string | null;
    imageUrl: string | null;
    category?: string | null;
    basePrice?: string | null;
  };
  variants: VariantSummary[];
  variantCount: number;
  /** Optional override image (e.g., per-variant approved render on the webstore). */
  primaryRenderUrl?: string | null;
  /** Per-variant render URL for hover swap on the webstore. Indexed by productId. */
  variantRenderUrls?: Record<number, string | null>;
  onSelect: (styleGroup: string) => void;
  /** Optional CTA in the bottom-right of the card body (e.g., "+ Add"). */
  cta?: React.ReactNode;
  /** Override the visible swatch count. Default 5; remainder shows "+N". */
  swatchLimit?: number;
}

const DEFAULT_SWATCH_LIMIT = 5;

export function VariantProductCard({
  styleGroup,
  primary,
  variants,
  variantCount,
  primaryRenderUrl,
  variantRenderUrls,
  onSelect,
  cta,
  swatchLimit = DEFAULT_SWATCH_LIMIT,
}: VariantProductCardProps) {
  // Track which variant is being previewed via hover. null = primary.
  const [hoveredVariantId, setHoveredVariantId] = useState<number | null>(null);

  const activeVariant = hoveredVariantId
    ? variants.find(v => v.productId === hoveredVariantId)
    : null;

  // Prefer the variant's render (when on webstore + approved); fall back
  // to the original variant photo, then primary's render, then primary's
  // photo. This chain mirrors the webstore approval gate.
  const imageSrc =
    (hoveredVariantId
      ? variantRenderUrls?.[hoveredVariantId] ?? activeVariant?.imageUrl
      : primaryRenderUrl ?? primary.imageUrl) ?? primary.imageUrl;

  const visibleSwatches = variants.slice(0, swatchLimit);
  const overflow = Math.max(0, variantCount - visibleSwatches.length);

  return (
    <div
      onClick={() => onSelect(styleGroup)}
      className="group cursor-pointer rounded-xl bg-white hover:bg-mt-surface-2/60 transition-colors p-3 flex flex-col"
    >
      <div className="aspect-square w-full bg-mt-surface-2 rounded-lg overflow-hidden mb-3 flex items-center justify-center">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={primary.name}
            draggable={false}
            // 150ms opacity crossfade keeps the swap "instant" without flicker.
            className="w-full h-full object-contain transition-opacity duration-150"
          />
        ) : (
          <span className="text-[11px] text-mt-ink-4">No image</span>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-1.5">
        <p className="text-[13px] font-semibold text-mt-ink leading-snug line-clamp-2">
          {primary.name}
        </p>
        {primary.sku && (
          <p className="text-[11px] text-mt-ink-4 truncate">{primary.sku}</p>
        )}

        {variants.length > 1 && (
          <div className="flex items-center gap-1.5 mt-1">
            {visibleSwatches.map(v => {
              const hex = v.colorHex ?? colorNameToHex(v.colorName);
              const selected = hoveredVariantId === v.productId;
              return (
                <button
                  key={v.productId}
                  type="button"
                  onClick={e => { e.stopPropagation(); setHoveredVariantId(v.productId); }}
                  onMouseEnter={() => setHoveredVariantId(v.productId)}
                  onMouseLeave={() => setHoveredVariantId(null)}
                  title={v.colorName ?? "Variant"}
                  aria-label={v.colorName ?? "Variant"}
                  style={
                    hex
                      ? { backgroundColor: hex }
                      : v.swatchUrl
                        ? { backgroundImage: `url(${v.swatchUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                        : { backgroundColor: "#D4D4D4" }
                  }
                  className={`h-4 w-4 rounded-full transition-all ${
                    selected
                      ? "ring-2 ring-offset-1 ring-primary"
                      : "ring-1 ring-mt-border hover:ring-mt-ink-3"
                  }`}
                />
              );
            })}
            {overflow > 0 && (
              <span className="text-[10px] font-semibold text-mt-ink-4 px-1.5 py-0.5 rounded-full bg-mt-surface-2">
                +{overflow}
              </span>
            )}
          </div>
        )}

        <div className="flex items-end justify-between gap-2 mt-2">
          <div className="min-w-0">
            {primary.basePrice && Number(primary.basePrice) > 0 && (
              <p className="text-[12px] font-semibold text-mt-ink">
                ${Number(primary.basePrice).toFixed(2)}
              </p>
            )}
            {primary.category && (
              <p className="text-[10px] uppercase tracking-wider text-mt-ink-4 mt-0.5">
                {primary.category}
              </p>
            )}
          </div>
          {cta && <div onClick={e => e.stopPropagation()}>{cta}</div>}
        </div>
      </div>
    </div>
  );
}
