/**
 * InvoicePreviewDocument
 * ──────────────────────
 * Single source of truth for the client-facing invoice document. Used by:
 *
 *   1. CreateInvoice preview mode — distributor hits "Preview" and sees
 *      exactly what the client will see, read-only. The Pay Now button is
 *      rendered as visual preview (no handler).
 *   2. PublicInvoicePay (/invoices/pay/:token) — the unauthenticated page
 *      a client lands on from the email CTA. Pay Now wires to the public
 *      checkout endpoint.
 *
 * Keeping one component means the preview never drifts from what the
 * client actually sees. The props split cleanly into two pieces:
 *   - `data`  — everything needed to render the document.
 *   - `pay`   — Pay Now state (card eligible, live/preview, handler, spinner).
 *
 * Styling choices follow the "Apple for enterprise" design standard:
 *   - Max-width 720 px, subtle shadow, no decorative frames.
 *   - Distributor logo top-left, invoice title top-right.
 *   - Clean line-item table, no edit affordances.
 *   - Glassmorphism Pay Now is the one moment of visual emphasis; every
 *     other element defers to the surrounding quiet aesthetic.
 */

import { Loader2 } from "lucide-react";

export interface InvoicePreviewLine {
  productName: string;
  description?: string | null;
  sku?: string | null;
  color?: string | null;
  size?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl?: string | null;
}

export interface InvoicePreviewDocumentProps {
  data: {
    invoiceNumber: string;
    status?: string | null;
    createdAt: Date | string | null;
    dueDate: Date | string | null;
    paidAt?: Date | string | null;
    lineItems: InvoicePreviewLine[];
    subtotal: number;
    totalDiscount?: number;
    tax: number;
    shipping: number;
    total: number;
    paymentTermsLabel?: string | null;
    notes?: string | null;
    client: {
      companyName: string | null;
      contactName?: string | null;
      contactEmail?: string | null;
      address?: string | null;
    } | null;
    distributor: {
      companyName: string;
      primaryColor: string;
      logoUrl: string | null;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
      website?: string | null;
    };
  };
  pay: {
    /** When true, the Pay Now button is shown. Otherwise hidden entirely. */
    visible: boolean;
    /**
     * Provide a handler for the live public view; omit in preview mode to
     * render a non-interactive visual approximation.
     */
    onPayNow?: () => void;
    /** Spinner inside the Pay Now button while the checkout POST is in-flight. */
    loading?: boolean;
    /** Optional inline error, rendered directly under the Pay Now button. */
    errorMessage?: string | null;
    /** Optional subline text shown under Pay Now (e.g. paid stamp). */
    sublineMessage?: string | null;
    /**
     * When true, short-circuit Pay Now to a disabled visual state with the
     * given label. Used when the invoice has already been paid.
     */
    disabled?: boolean;
    disabledLabel?: string;
  };
}

const fmtMoney = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined): string => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

export function InvoicePreviewDocument({ data, pay }: InvoicePreviewDocumentProps) {
  const { distributor, client, lineItems } = data;
  const brand = distributor.primaryColor || "#654BF9";

  return (
    <div className="w-full flex justify-center px-4 py-8">
      <article
        className="w-full max-w-[720px] bg-white rounded-xl"
        style={{ boxShadow: "0 2px 12px rgba(0, 0, 0, 0.04)" }}
        aria-label={`Invoice ${data.invoiceNumber}`}
      >
        {/* ── Header — logo left, invoice title + number right ─────────── */}
        <header className="flex items-start justify-between gap-8 px-10 pt-10 pb-6">
          <div className="flex-1 min-w-0">
            {distributor.logoUrl ? (
              <img
                src={distributor.logoUrl}
                alt={distributor.companyName}
                className="h-10 w-auto max-w-[200px] object-contain object-left"
              />
            ) : (
              <p className="text-lg font-semibold text-mt-ink tracking-tight">
                {distributor.companyName}
              </p>
            )}
            <div className="mt-3 text-[11.5px] text-mt-ink-3 leading-relaxed">
              {distributor.logoUrl && (
                <p className="font-medium text-mt-ink-2 text-[12px]">{distributor.companyName}</p>
              )}
              {distributor.address && <p className="whitespace-pre-line">{distributor.address}</p>}
              {distributor.phone && <p>{distributor.phone}</p>}
              {distributor.email && <p>{distributor.email}</p>}
              {distributor.website && <p>{distributor.website}</p>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">
              Invoice
            </p>
            <p className="mt-1 text-2xl font-semibold text-mt-ink tabular-nums">
              {data.invoiceNumber}
            </p>
            {data.status === "paid" && (
              <span
                className="inline-block mt-2 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: "#ECFDF5", color: "#065F46" }}
              >
                Paid
              </span>
            )}
          </div>
        </header>

        {/* ── Dates + Bill-to ─────────────────────────────────────────── */}
        <section className="px-10 grid grid-cols-1 sm:grid-cols-3 gap-6 pb-8 border-t border-b border-[#F0F0F0] py-6">
          <div>
            <p className="text-[10.5px] uppercase tracking-wider text-gray-400 font-medium">
              Issued
            </p>
            <p className="mt-1 text-[13px] text-mt-ink">{fmtDate(data.createdAt)}</p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-wider text-gray-400 font-medium">
              Due
            </p>
            <p className="mt-1 text-[13px] text-mt-ink">{fmtDate(data.dueDate)}</p>
            {data.paymentTermsLabel && (
              <p className="text-[11px] text-mt-ink-3 mt-0.5">{data.paymentTermsLabel}</p>
            )}
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-wider text-gray-400 font-medium">
              Bill to
            </p>
            {client ? (
              <div className="mt-1 text-[13px] text-mt-ink leading-relaxed">
                <p className="font-medium">{client.companyName || client.contactName || "—"}</p>
                {client.contactName && client.companyName && (
                  <p className="text-mt-ink-2 text-[12px]">{client.contactName}</p>
                )}
                {client.contactEmail && (
                  <p className="text-mt-ink-3 text-[12px]">{client.contactEmail}</p>
                )}
                {client.address && (
                  <p className="text-mt-ink-3 text-[12px] whitespace-pre-line mt-0.5">
                    {client.address}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-mt-ink-4 italic">
                Client will appear here
              </p>
            )}
          </div>
        </section>

        {/* ── Line item table ─────────────────────────────────────────── */}
        <section className="px-10 pt-8 pb-4 overflow-x-auto sm:overflow-visible">
          <div className="grid grid-cols-[2.4fr_1fr_0.7fr_1fr_1fr] gap-3 pb-2 border-b border-[#F0F0F0] min-w-[720px] sm:min-w-0">
            <HeaderCell>Description</HeaderCell>
            <HeaderCell align="right">SKU</HeaderCell>
            <HeaderCell align="right">Qty</HeaderCell>
            <HeaderCell align="right">Unit Price</HeaderCell>
            <HeaderCell align="right">Total</HeaderCell>
          </div>
          <ul>
            {lineItems.length === 0 ? (
              <li className="py-6 text-center text-[12.5px] text-mt-ink-4 italic">
                Line items will appear here
              </li>
            ) : (
              lineItems.map((li, idx) => (
                <li
                  key={`${li.productName}-${idx}`}
                  className="grid grid-cols-[2.4fr_1fr_0.7fr_1fr_1fr] gap-3 py-3 border-b border-[#F6F6F6] items-start min-w-[720px] sm:min-w-0"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-mt-ink font-medium truncate">
                      {li.productName || "Item"}
                    </p>
                    {li.description && (
                      <p className="text-[11.5px] text-mt-ink-3 mt-0.5 leading-relaxed">
                        {li.description}
                      </p>
                    )}
                    {(li.color || li.size) && (
                      <p className="text-[11px] text-mt-ink-4 mt-0.5">
                        {[li.color, li.size].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <p className="text-right text-[12px] font-mono text-mt-ink-3 pt-0.5">
                    {li.sku || "—"}
                  </p>
                  <p className="text-right text-[13px] text-mt-ink tabular-nums pt-0.5">
                    {li.quantity}
                  </p>
                  <p className="text-right text-[13px] text-mt-ink tabular-nums pt-0.5">
                    {fmtMoney(li.unitPrice)}
                  </p>
                  <p className="text-right text-[13px] text-mt-ink font-medium tabular-nums pt-0.5">
                    {fmtMoney(li.totalPrice)}
                  </p>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* ── Totals block ─────────────────────────────────────────── */}
        <section className="px-10 pt-4 pb-8 flex justify-end">
          <div className="w-full sm:w-72 space-y-2">
            <TotalsRow label="Subtotal" value={fmtMoney(data.subtotal)} />
            {(data.totalDiscount ?? 0) > 0 && (
              <TotalsRow label="Discount" value={`−${fmtMoney(data.totalDiscount ?? 0)}`} />
            )}
            {data.tax > 0 && <TotalsRow label="Tax" value={fmtMoney(data.tax)} />}
            {data.shipping > 0 && <TotalsRow label="Shipping" value={fmtMoney(data.shipping)} />}
            <div
              className="flex items-center justify-between pt-3"
              style={{ borderTop: "1px solid #E5E7EB" }}
            >
              <span className="text-[13px] text-mt-ink-2 font-medium">
                {data.status === "paid" ? "Paid" : "Amount due"}
              </span>
              <span className="text-2xl font-semibold text-mt-ink tabular-nums">
                {fmtMoney(data.total)}
              </span>
            </div>
          </div>
        </section>

        {/* ── Pay Now button — the one glass moment ─────────────────── */}
        {pay.visible && (
          <section className="px-10 pb-8 flex flex-col items-end gap-2">
            {pay.disabled ? (
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="inline-flex items-center justify-center font-semibold rounded-lg cursor-not-allowed"
                style={{
                  padding: "14px 32px",
                  color: brand,
                  border: `1px solid ${brand}`,
                  background: "rgba(255,255,255,0.15)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  opacity: 0.55,
                }}
              >
                {pay.disabledLabel || "Paid"}
              </button>
            ) : (
              <button
                type="button"
                onClick={pay.onPayNow}
                disabled={!pay.onPayNow || pay.loading}
                className="inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-colors"
                style={{
                  padding: "14px 32px",
                  color: brand,
                  border: `1px solid ${brand}`,
                  background: "rgba(255,255,255,0.15)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
                onMouseEnter={(e) => {
                  if (!pay.onPayNow || pay.loading) return;
                  (e.currentTarget as HTMLButtonElement).style.background = `${brand}1a`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.15)";
                }}
              >
                {pay.loading && <Loader2 size={14} className="animate-spin" />}
                Pay Now
              </button>
            )}
            {pay.sublineMessage && (
              <p className="text-[11.5px] text-mt-ink-3">{pay.sublineMessage}</p>
            )}
            {pay.errorMessage && (
              <p className="text-[11.5px] text-red-600 text-right max-w-xs">
                {pay.errorMessage}
              </p>
            )}
          </section>
        )}

        {/* ── Notes / Terms ─────────────────────────────────────────── */}
        {data.notes && (
          <section className="px-10 pb-10 pt-2" style={{ borderTop: "1px solid #F0F0F0" }}>
            <p className="text-[10.5px] uppercase tracking-wider text-gray-400 font-medium pt-6">
              Notes
            </p>
            <p className="mt-2 text-[12.5px] text-mt-ink-2 leading-relaxed whitespace-pre-line">
              {data.notes}
            </p>
          </section>
        )}
      </article>
    </div>
  );
}

function HeaderCell({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <span
      className="text-[10.5px] uppercase tracking-wider text-gray-400 font-medium"
      style={{ textAlign: align }}
    >
      {children}
    </span>
  );
}

function TotalsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12.5px] text-gray-500">{label}</span>
      <span className="text-[13px] text-mt-ink tabular-nums">{value}</span>
    </div>
  );
}
