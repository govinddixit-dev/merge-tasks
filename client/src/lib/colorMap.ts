/**
 * colorMap.ts — hand-curated mapping of common SanMar color names to hex.
 *
 * Used by the variant-grouping ProductCard to render swatch circles when
 * the DB row's colorHex is null (the populator did not auto-fill hex —
 * Phase 8 Decision 5 chose to defer the LLM backfill).
 *
 * Match is case-insensitive and tolerant of spelling variants ("Dark Navy"
 * == "dark navy" == "darknavy"). Unmatched colors return null so the
 * caller can fall back to swatchUrl photo or a neutral placeholder.
 */
const RAW: Record<string, string> = {
  // Neutrals
  black: "#0A0A0A",
  white: "#FFFFFF",
  ivory: "#F1ECE2",
  cream: "#F4ECDB",
  natural: "#E5DDC8",
  bone: "#E0D5BD",
  sand: "#D9C9A6",
  tan: "#C9A87C",
  khaki: "#9C865A",
  beige: "#C8B998",

  // Greys
  "athletic grey": "#9E9E9E",
  "athletic heather": "#A0A4A8",
  heather: "#A8A8A8",
  "heather grey": "#A8A8A8",
  "heather gray": "#A8A8A8",
  grey: "#7F7F7F",
  gray: "#7F7F7F",
  "dark grey": "#3F3F3F",
  "dark gray": "#3F3F3F",
  charcoal: "#3A3A3A",
  graphite: "#383838",
  smoke: "#7B7C7D",
  silver: "#C0C0C0",

  // Blues
  navy: "#0F1F4D",
  "dark navy": "#0A1834",
  "true navy": "#1B2C5A",
  "midnight navy": "#0E1A36",
  royal: "#1F47B0",
  "royal blue": "#1F47B0",
  blue: "#2A5BB8",
  "carolina blue": "#52A8DC",
  "light blue": "#A5C8E2",
  "sky blue": "#90C5E5",
  teal: "#118C8B",
  turquoise: "#1FB6B6",
  aqua: "#5AC4C2",

  // Reds / oranges / yellows
  red: "#C8202B",
  "true red": "#CB1F2B",
  "athletic red": "#B81F2B",
  cardinal: "#9B1B27",
  maroon: "#5E1F26",
  burgundy: "#5A1A24",
  wine: "#5C1F2A",
  rust: "#A04A1F",
  orange: "#E0521C",
  "burnt orange": "#B84A1A",
  "safety orange": "#FF6B19",
  "safety yellow": "#F0E11D",
  yellow: "#F1C81E",
  gold: "#D4A92E",
  caramel: "#9C6E2D",

  // Greens
  green: "#1F7C3A",
  "kelly green": "#1F8B36",
  "forest green": "#1F4A2A",
  "athletic green": "#2A8C45",
  "hunter green": "#1B3D24",
  olive: "#5E5C2A",
  army: "#4F4D2C",
  lime: "#9CCB39",

  // Purples / pinks / browns
  purple: "#5A2EA0",
  violet: "#6E3DAE",
  pink: "#E8709C",
  "light pink": "#F2B8CC",
  "hot pink": "#E22F7C",
  fuchsia: "#D32A8C",
  brown: "#5C3B20",
  chocolate: "#3E2516",
  coffee: "#4A3422",
};

function normalizeColorKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

const NORMALIZED: Record<string, string> = {};
for (const [k, v] of Object.entries(RAW)) {
  NORMALIZED[normalizeColorKey(k)] = v;
  // Also accept without spaces (e.g. "darknavy" → "dark navy")
  NORMALIZED[k.replace(/\s+/g, "").toLowerCase()] = v;
}

/** Return a #RRGGBB for a SanMar color name, or null if unmapped. */
export function colorNameToHex(name: string | null | undefined): string | null {
  if (!name) return null;
  return NORMALIZED[normalizeColorKey(name)] ?? null;
}
