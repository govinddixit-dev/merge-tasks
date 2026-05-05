/**
 * storeDivision.ts — multi-division helpers used by storefront queries.
 *
 * A workstore is "multi-division" when stores.divisions JSON has entries and
 * SSO is configured. Each storeUser may be assigned a divisionId at login
 * (via storeIdentityProviders.groupToDivisionMap). Products may be tagged
 * with divisionIds (JSON) — a product is visible to an employee when:
 *
 *   product.divisionIds is NULL / []                → shared with everyone
 *   product.divisionIds includes employee.divisionId → visible
 *   otherwise                                       → hidden
 *
 * Budgets remain department-scoped; the 80% warning threshold is read from
 * storeDepartments.warnThresholdPct.
 */

export type ProductDivisionScope = { divisionIds: number[] | null | undefined };

/**
 * Returns true when a product row should be visible to a viewer in the given
 * division. A NULL viewer division means the viewer is not assigned — only
 * shared products are visible in that case.
 */
export function isProductVisibleToDivision(
  product: ProductDivisionScope,
  viewerDivisionId: number | null | undefined,
): boolean {
  const tags = Array.isArray(product.divisionIds) ? product.divisionIds : [];
  if (tags.length === 0) return true;                       // shared
  if (viewerDivisionId == null) return false;               // restricted, no division
  return tags.includes(viewerDivisionId);
}

/** Filter a list of storeProducts rows by the caller's division. */
export function filterProductsByDivision<T extends ProductDivisionScope>(
  rows: T[],
  viewerDivisionId: number | null | undefined,
): T[] {
  return rows.filter((r) => isProductVisibleToDivision(r, viewerDivisionId));
}

/**
 * Budget warning helper — returns the threshold state for a department row.
 * "block" mirrors the existing 100% hard block; "warn" is new (default 80%).
 */
export function budgetWarningState(params: {
  budgetCents: number;
  spentCents: number;
  warnThresholdPct: number;
}): "ok" | "warn" | "block" {
  if (params.budgetCents <= 0) return "ok";
  const pct = (params.spentCents / params.budgetCents) * 100;
  if (pct >= 100) return "block";
  if (pct >= params.warnThresholdPct) return "warn";
  return "ok";
}
