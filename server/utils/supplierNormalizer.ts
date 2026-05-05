/**
 * supplierNormalizer.ts — Normalize supplier names for fuzzy matching.
 *
 * Promotional products distributors enter supplier names inconsistently:
 * "SanMar", "SanMar Corporation", "SANMR", "Sanmar Inc." are all the same.
 * This module handles name normalization and known industry aliases.
 */

// ── Known aliases for major promo industry suppliers ────────────────────────

const KNOWN_ALIASES: Record<string, string> = {
  "s&s activewear": "ss activewear",
  "s & s activewear": "ss activewear",
  "ss activewear inc": "ss activewear",
  "hit promotional products": "hit promotional",
  "hit promo": "hit promotional",
  "alphabroder": "alphabroder",
  "alpha broder": "alphabroder",
  "sanmar corporation": "sanmar",
  "sanmar corp": "sanmar",
  "sanmr": "sanmar",
  "san mar": "sanmar",
  "cap america": "cap america",
  "cap america inc": "cap america",
  "gemline": "gemline",
  "gem line": "gemline",
  "pcna": "pcna",
  "polyconcept north america": "pcna",
  "leeds": "pcna",
  "bullet": "pcna",
  "trimark": "pcna",
  "journal books": "pcna",
  "prime line": "prime line",
  "primeline": "prime line",
  "prime line inc": "prime line",
  "bag makers": "bag makers",
  "bagmakers": "bag makers",
  "next level apparel": "next level apparel",
  "next level": "next level apparel",
  "bella canvas": "bella canvas",
  "bella+canvas": "bella canvas",
  "bellacanvas": "bella canvas",
  "gildan": "gildan",
  "gildan activewear": "gildan",
  "gildan brands": "gildan",
  "hanes": "hanesbrands",
  "hanesbrands": "hanesbrands",
  "hanes brands": "hanesbrands",
  "champion": "hanesbrands",
  "fruit of the loom": "fruit of the loom",
  "fotl": "fruit of the loom",
  "stahls": "stahls",
  "stahls' id direct": "stahls",
  "stahls id direct": "stahls",
};

// ── Suffix patterns to strip ────────────────────────────────────────────────

const SUFFIXES = /\b(inc|llc|corp|corporation|ltd|limited|co|company|group|enterprises|holdings|international|intl)\b\.?/gi;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Normalize a supplier name for comparison:
 * lowercase → trim → strip suffixes → collapse whitespace → check aliases.
 */
export function normalizeSupplierName(name: string): string {
  let n = name.toLowerCase().trim();
  // Strip common suffixes
  n = n.replace(SUFFIXES, "").trim();
  // Strip trailing punctuation and extra whitespace
  n = n.replace(/[.,;:!]+$/g, "").replace(/\s+/g, " ").trim();
  // Check known aliases
  return KNOWN_ALIASES[n] ?? n;
}

/**
 * Levenshtein distance between two strings.
 * Used for fuzzy matching when exact + alias matching fails.
 */
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const matrix: number[][] = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,       // deletion
        matrix[i][j - 1] + 1,       // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return matrix[la][lb];
}

/**
 * Check if two supplier names refer to the same supplier.
 * Uses normalization + alias resolution + Levenshtein distance < 3.
 */
export function areSameSupplier(a: string, b: string): boolean {
  const na = normalizeSupplierName(a);
  const nb = normalizeSupplierName(b);
  if (na === nb) return true;
  // Fuzzy: Levenshtein distance on normalized names
  if (na.length > 3 && nb.length > 3 && levenshtein(na, nb) < 3) return true;
  return false;
}
