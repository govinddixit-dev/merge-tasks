/**
 * formatCurrency.ts — Shared currency formatting utilities (server-side)
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for currency formatting on the server.
 * The client-side equivalent lives in client/src/lib/utils.ts.
 *
 * Exports:
 *   formatCurrency(val)       — Formats a dollar amount (number | string | null)
 *   formatCurrencyCents(val)  — Formats a cents integer (e.g. 1999 → "$19.99")
 * ─────────────────────────────────────────────────────────────────────────────
 */

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Format a dollar amount (number or string) as a USD currency string.
 * Returns "—" for null, undefined, empty string, or NaN values.
 *
 * @example
 *   formatCurrency(19.99)    → "$19.99"
 *   formatCurrency("19.99")  → "$19.99"
 *   formatCurrency(null)     → "—"
 */
export function formatCurrency(val: number | string | null | undefined): string {
  if (val == null || val === "") return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return USD.format(n);
}

/**
 * Format a cents integer as a USD currency string.
 * Useful for Stripe amounts which are always stored in cents.
 *
 * @example
 *   formatCurrencyCents(1999)  → "$19.99"
 *   formatCurrencyCents(0)     → "$0.00"
 */
export function formatCurrencyCents(cents: number): string {
  return USD.format(cents / 100);
}
