/**
 * Color-swatch dedup + hue sort, shared by the distributor PDP and the
 * customer-facing webstore PDP. Two variants whose resolved swatch image
 * URL is identical collapse to a single chip (handles "same photo,
 * different size" duplicates from supplier feeds). Achromatic colours
 * sort after chromatic, both ordered by hue then lightness.
 */

import { colorNameToHex } from "./colorMap";

export type SwatchVariant = {
  productId: number;
  colorName: string | null;
  colorHex: string | null;
  swatchUrl: string | null;
  imageUrl: string | null;
};

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace(/^#/, "").match(/^[0-9a-fA-F]{6}$/);
  if (!m) return null;
  const n = parseInt(m[0], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

/**
 * Dedup variants by resolved thumbnail URL (defaults to v.imageUrl;
 * pass `getImageKey` to plug in approved-render priority for the
 * customer webstore). Variants with no resolvable image key are kept
 * individually since we can't tell whether they're duplicates.
 *
 * Sort order:
 *   1. The current variant is processed first so it always wins as the
 *      canonical entry for its image bucket (so the user's selection
 *      isn't deduped away).
 *   2. Chromatic colours (s ≥ 0.1) come before achromatic (greys/black/
 *      white), each sorted by hue then lightness.
 */
export function dedupeAndSortVariants<T extends SwatchVariant>(
  variants: T[],
  currentId: number,
  getImageKey?: (v: T) => string | null,
): T[] {
  const keyOf = getImageKey ?? ((v: T) => v.imageUrl);
  const ordered = [...variants].sort((a, b) =>
    (b.productId === currentId ? 1 : 0) - (a.productId === currentId ? 1 : 0),
  );
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const v of ordered) {
    const k = keyOf(v);
    if (k) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    kept.push(v);
  }
  return kept
    .map(v => {
      const hex = v.colorHex ?? colorNameToHex(v.colorName);
      const rgb = hex ? hexToRgb(hex) : null;
      const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
      const achromatic = !hsl || hsl[1] < 0.1;
      return { v, hsl, achromatic };
    })
    .sort((a, b) => {
      if (a.achromatic !== b.achromatic) return a.achromatic ? 1 : -1;
      if (a.hsl && b.hsl) return a.hsl[0] - b.hsl[0] || a.hsl[2] - b.hsl[2];
      return 0;
    })
    .map(k => k.v);
}
