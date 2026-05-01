/**
 * LogoOverlay — composites the client's brand logo over a product image
 * at a defined placement zone, giving buyers a realistic preview of the
 * decorated item before ordering.
 *
 * Design principles:
 *  - Pure CSS overlay (no canvas) — no extra dependencies, SSR-safe.
 *  - All position/size values are percentages so the overlay scales
 *    correctly at any container size (product card or PDP).
 *  - Graceful degradation: if logoUrl is null the component renders the
 *    plain product image unchanged — zero visual regression.
 *  - The Branded/Blank toggle is opt-in via the `showToggle` prop so
 *    product cards can show the branded view silently while the PDP
 *    exposes the toggle for buyer awareness.
 *
 * Feature branch: branded-product-visualization
 * No schema migration required — placement is derived from product category
 * via getDefaultPlacement() in StoreContext.
 */

import { useState } from "react";
import { Package } from "lucide-react";
import type { PlacementZone } from "./StoreContext";

interface LogoOverlayProps {
  /** Product image URL — rendered as the base layer */
  productImageUrl: string | null;
  /** Client logo URL from store.client.logoUrl — may be null */
  logoUrl: string | null;
  /** Placement zone derived from product category */
  placement: PlacementZone;
  /** Alt text for the product image */
  alt?: string;
  /** CSS class applied to the outermost container */
  className?: string;
  /** object-fit style for the product image */
  imageFit?: "cover" | "contain";
  /** Padding applied when imageFit is "contain" */
  imagePadding?: string;
  /** Whether to render the Branded / Blank toggle pill — default false */
  showToggle?: boolean;
  /** Store primary color — used to tint the toggle active state */
  primaryColor?: string;
}

/**
 * LogoOverlayCard — lightweight variant for product cards.
 * No toggle, no padding, just the branded overlay.
 */
export function LogoOverlayCard({
  productImageUrl,
  logoUrl,
  placement,
  alt = "",
  className = "",
  imageFit = "cover",
}: Omit<LogoOverlayProps, "showToggle" | "primaryColor" | "imagePadding">) {
  return (
    <LogoOverlay
      productImageUrl={productImageUrl}
      logoUrl={logoUrl}
      placement={placement}
      alt={alt}
      className={className}
      imageFit={imageFit}
      showToggle={false}
    />
  );
}

/**
 * LogoOverlay — full variant with optional Branded/Blank toggle for PDP.
 */
export default function LogoOverlay({
  productImageUrl,
  logoUrl,
  placement,
  alt = "",
  className = "",
  imageFit = "contain",
  imagePadding = "p-4",
  showToggle = false,
  primaryColor = "#6C2BD9",
}: LogoOverlayProps) {
  const [branded, setBranded] = useState(true);

  // If no logo is available, render the plain product image — zero regression.
  const showLogo = branded && !!logoUrl;

  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* Base product image */}
      {productImageUrl ? (
        <img
          src={productImageUrl}
          alt={alt}
          className={`w-full h-full transition-transform duration-500 ${
            imageFit === "cover" ? "object-cover" : `object-contain ${imagePadding}`
          }`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Package size={40} className="text-[#D4D4D4]" />
        </div>
      )}

      {/* Logo overlay — positioned absolutely using placement percentages */}
      {showLogo && (
        <div
          className="absolute pointer-events-none select-none"
          style={{
            left: `${placement.x}%`,
            top: `${placement.y}%`,
            width: `${placement.w}%`,
            opacity: placement.opacity ?? 0.90,
            // Subtle multiply blend so the logo respects fabric texture
            mixBlendMode: "multiply",
          }}
          aria-hidden="true"
        >
          <img
            src={logoUrl!}
            alt="Brand logo"
            className="w-full h-auto object-contain drop-shadow-sm"
            draggable={false}
          />
        </div>
      )}

      {/* Branded / Blank toggle pill — only rendered when showToggle is true */}
      {showToggle && logoUrl && (
        <div
          className="absolute top-3 left-3 flex rounded-full overflow-hidden shadow-md z-10"
          style={{ border: `1.5px solid ${primaryColor}20` }}
        >
          <button
            onClick={() => setBranded(true)}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: branded ? primaryColor : "rgba(255,255,255,0.92)",
              color: branded ? "#fff" : "#555",
            }}
            aria-pressed={branded}
          >
            Branded
          </button>
          <button
            onClick={() => setBranded(false)}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: !branded ? primaryColor : "rgba(255,255,255,0.92)",
              color: !branded ? "#fff" : "#555",
            }}
            aria-pressed={!branded}
          >
            Blank
          </button>
        </div>
      )}

      {/* "BRANDED" badge on cards when logo is active and no toggle */}
      {!showToggle && showLogo && (
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
