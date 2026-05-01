/**
 * Invoice calculation math — pure, deterministic, shared between:
 *   • the Document Canvas UI (live totals as the distributor types)
 *   • the invoices.create tRPC mutation (authoritative server-side total)
 *   • unit tests
 *
 * Keeping the math in one place is the only way to guarantee the number
 * the distributor sees while building is the number the server stores.
 * Every function here is pure — no I/O, no side effects, no rounding
 * surprises beyond the single `round2` helper.
 */

export type DiscountType = "percent" | "flat";

export interface InvoiceLineInput {
  quantity: number;
  unitPrice: number;
  discountType?: DiscountType;
  discountValue?: number;
  taxable?: boolean;
}

export interface InvoiceLineComputed {
  gross: number;        // quantity * unitPrice
  discount: number;     // absolute dollar discount applied
  net: number;          // gross - discount (never < 0)
  taxable: boolean;
}

export interface InvoiceTotals {
  lines: InvoiceLineComputed[];
  subtotal: number;         // sum of line.net
  totalDiscount: number;    // sum of line.discount
  taxableBase: number;      // sum of line.net where taxable
  tax: number;              // taxableBase * taxRate
  shipping: number;
  grandTotal: number;       // subtotal + tax + shipping
}

/** Round to 2 decimal places using banker-safe half-away-from-zero. */
export function round2(n: number): number {
  // Math.round alone has float-pair issues (e.g. 1.005 → 1). Scale by a
  // whole number first, then round.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeLine(line: InvoiceLineInput): InvoiceLineComputed {
  const qty = Number.isFinite(line.quantity) ? Math.max(0, line.quantity) : 0;
  const price = Number.isFinite(line.unitPrice) ? Math.max(0, line.unitPrice) : 0;
  const gross = round2(qty * price);

  let discount = 0;
  const dType = line.discountType ?? "flat";
  const dVal = Number.isFinite(line.discountValue ?? 0) ? (line.discountValue ?? 0) : 0;
  if (dVal > 0) {
    if (dType === "percent") {
      // Percent discount clamps at 100% — negative nets make no sense on
      // an invoice line, so a 150% discount is treated as 100%.
      const pct = Math.min(100, Math.max(0, dVal));
      discount = round2((gross * pct) / 100);
    } else {
      // Flat discount clamps at gross — you can't discount more than the line.
      discount = round2(Math.min(gross, Math.max(0, dVal)));
    }
  }

  const net = round2(Math.max(0, gross - discount));
  return {
    gross,
    discount,
    net,
    taxable: line.taxable ?? true,
  };
}

export function computeTotals(
  lines: InvoiceLineInput[],
  opts: { taxRate?: number; shipping?: number } = {},
): InvoiceTotals {
  const taxRate = Number.isFinite(opts.taxRate ?? 0) ? Math.max(0, opts.taxRate ?? 0) : 0;
  const shipping = round2(Number.isFinite(opts.shipping ?? 0) ? Math.max(0, opts.shipping ?? 0) : 0);

  const computed = lines.map(computeLine);
  const subtotal = round2(computed.reduce((s, l) => s + l.net, 0));
  const totalDiscount = round2(computed.reduce((s, l) => s + l.discount, 0));
  const taxableBase = round2(computed.reduce((s, l) => (l.taxable ? s + l.net : s), 0));
  const tax = round2(taxableBase * taxRate);
  const grandTotal = round2(subtotal + tax + shipping);

  return {
    lines: computed,
    subtotal,
    totalDiscount,
    taxableBase,
    tax,
    shipping,
    grandTotal,
  };
}

export type PaymentTerms =
  | "due_on_receipt"
  | "net_15"
  | "net_30"
  | "net_60"
  | "custom";

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  due_on_receipt: "Due on Receipt",
  net_15: "Net-15",
  net_30: "Net-30",
  net_60: "Net-60",
  custom: "Custom",
};

/**
 * Given a payment-terms value (and a custom date when relevant), return
 * the due date. `issuedAt` defaults to "now" so callers can resolve
 * forward-looking terms without plumbing a clock through.
 */
export function resolveDueDate(
  terms: PaymentTerms,
  customDate: string | Date | null | undefined,
  issuedAt: Date = new Date(),
): Date | null {
  const base = new Date(issuedAt);
  switch (terms) {
    case "due_on_receipt":
      return base;
    case "net_15":
      return addDays(base, 15);
    case "net_30":
      return addDays(base, 30);
    case "net_60":
      return addDays(base, 60);
    case "custom":
      if (!customDate) return null;
      return new Date(customDate);
  }
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}
