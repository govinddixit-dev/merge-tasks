/**
 * styleGroup utilities — derive variant grouping fields from a product row.
 *
 * Rules (deterministic, idempotent — same input → same output):
 *   - slug: lowercase, strip ™/®/©, drop punctuation except hyphens/spaces,
 *     collapse whitespace → "-", collapse repeated hyphens, trim, max 128.
 *   - colorName: SanMar imageUrl path segment between "_form-front_" and
 *     the next "_<year>_". Returns null when the URL doesn't match.
 *
 * Used by both the one-shot backfill (jobs/backfillStyleGroups.ts) and
 * the SanMar import path (jobs/sanMarBulkSync.ts) so a row inserted today
 * gets the same key as a row backfilled yesterday.
 *
 * Supplier policy:
 *   SanMar: derived from product name (no true style number in bulk feed)
 *   S&S:    TBD — map their styleNumber when integrated
 *   ASI:    TBD
 */

/**
 * Slugify a product name into a stable styleGroup key.
 * Empty input → empty string; caller may choose to fall back to id.
 */
export function deriveStyleGroupSlug(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    // Strip HTML entity forms first so &reg; doesn't survive into the
    // alphanumeric pass below as the bare letters "reg".
    .replace(/&reg;|&trade;|&copy;/gi, "")
    .replace(/[™®©]/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

/**
 * Pull the human-readable color name out of a SanMar Canada catalog
 * image URL. Two patterns observed in the wild:
 *   New (post-2024): ".../<style>_form-front_<color>_<year>_<...>.jpg"
 *   Older catalog:   ".../<style>_form_front_<color>_<...>.jpg"
 * Both are matched. Returns Title Case ("Athletic Grey", "Dark Navy") or null.
 */
export function extractColorNameFromSanMarUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  // Try new pattern first (year suffix anchors color reliably).
  let m = imageUrl.match(/_form-front_([a-z0-9-]+)_\d{4}_/i);
  // Fall back to older pattern (no year, color is the segment after _form_front_).
  if (!m) m = imageUrl.match(/_form_front_([a-z0-9-]+)_/i);
  if (!m) return null;
  return m[1]
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}
