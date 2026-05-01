/**
 * PortalProposalCheckout.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * 3-step Stripe checkout overlay (Review → Payment → Confirmation) with a
 * downloadable PDF receipt. Rendered when the client clicks "Checkout with
 * Stripe" from the proposal detail view.
 *
 * PO-11 fix: Step 2 now redirects to Stripe Checkout via the public proposal
 * checkout endpoint instead of showing a fake card form with hardcoded "4242".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect } from "react";
import {
  ChevronRight, Check, CreditCard, Lock, CheckCircle2, Package,
  Download, ShieldCheck, Loader2, ExternalLink, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";

export type ProductRow = {
  name: string; sku: string; qty: number; unitPrice: number;
  total: number; decoration: string;
  /** Product ID for Stripe line item selection */
  productId?: number;
};

interface PortalProposalCheckoutProps {
  proposalId: string;
  proposalTitle: string;
  products: ProductRow[];
  checkoutStep: number;
  setCheckoutStep: (step: number) => void;
  onBackToProposals: () => void;
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  /** Tax rate as a decimal (e.g. 0.0875 = 8.75%). null means tax-exempt. Sourced from stores.taxRate via storePortal.dashboard. */
  taxRate: number | null;
  /** Store slug for constructing return URLs */
  storeSlug: string;
  /** Proposal viewToken for the public checkout API */
  viewToken?: string;
}

export function PortalProposalCheckout({
  proposalId, proposalTitle, products, checkoutStep, setCheckoutStep,
  onBackToProposals, isDark, fg, mutedFg, borderColor, cardBg, taxRate,
  storeSlug, viewToken,
}: PortalProposalCheckoutProps) {
  const [showReceipt, setShowReceipt] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const orderNum = `${proposalId}-ORD`;
  const orderDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  // Tax rate comes from stores.taxRate via storePortal.dashboard. null = tax-exempt (0%).
  const TAX_RATE = taxRate ?? 0;
  const taxRateLabel = `${(TAX_RATE * 100).toFixed(2)}%`;
  const grandTotal = products.reduce((s, p) => s + p.total, 0);
  const tax = grandTotal * TAX_RATE;
  const totalWithTax = grandTotal + tax;

  // Check if we're returning from Stripe checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success" && checkoutStep === 2) {
      setCheckoutStep(3);
      // Clean up the URL
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      window.history.replaceState({}, "", url.toString());
    }
  }, [checkoutStep, setCheckoutStep]);

  const handleStripeCheckout = async () => {
    if (!viewToken) {
      toast.error("Unable to process payment — proposal token not available");
      return;
    }

    setIsRedirecting(true);
    setStripeError(null);

    try {
      const selectedProductIds = products
        .filter((p) => p.productId != null)
        .map((p) => p.productId);

      const res = await fetch(`/api/proposals/public/${viewToken}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedProductIds: selectedProductIds.length > 0 ? selectedProductIds : undefined,
          origin: window.location.origin,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Payment processing failed";
      setStripeError(message);
      setIsRedirecting(false);
      toast.error(message);
    }
  };

  const generateReceiptPDF = () => {
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    doc.setFillColor(101, 75, 249);
    doc.rect(0, 0, pw, 40, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("MergeTasks", 20, 22);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Payment Receipt", 20, 32);
    doc.text(`Receipt #${orderNum}`, pw - 20, 22, { align: "right" });
    doc.text(orderDate, pw - 20, 32, { align: "right" });
    let y = 55;
    doc.setTextColor(34, 197, 94);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("PAYMENT SUCCESSFUL", 20, y);
    y += 12;
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Order Number: ${orderNum}`, 20, y);
    doc.text(`Payment Method: Stripe Checkout`, pw - 20, y, { align: "right" });
    y += 6;
    doc.text(`Proposal: ${proposalTitle}`, 20, y);
    y += 12;
    doc.setDrawColor(200, 200, 200);
    doc.line(20, y, pw - 20, y);
    y += 10;
    doc.setFillColor(248, 248, 250);
    doc.rect(20, y - 5, pw - 40, 10, "F");
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    ["ITEM", "SKU", "QTY", "UNIT PRICE", "TOTAL"].forEach((h, i) => {
      doc.text(h, [22, 80, 115, 135, pw - 22][i], y + 1, i === 4 ? { align: "right" } : undefined);
    });
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);
    products.forEach((p) => {
      doc.setFontSize(9);
      doc.text(p.name, 22, y);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(p.sku, 80, y);
      doc.text(String(p.qty), 115, y);
      doc.text(`$${p.unitPrice.toFixed(2)}`, 135, y);
      doc.setTextColor(50, 50, 50);
      doc.setFontSize(9);
      doc.text(`$${p.total.toFixed(2)}`, pw - 22, y, { align: "right" });
      y += 5;
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(p.decoration, 22, y);
      y += 9;
      doc.setTextColor(50, 50, 50);
    });
    doc.setDrawColor(200, 200, 200);
    doc.line(110, y, pw - 20, y);
    y += 8;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    [
      ["Subtotal", `$${grandTotal.toFixed(2)}`],
      [`Tax (${taxRateLabel})`, `$${tax.toFixed(2)}`],
      ["Shipping", "FREE"],
    ].forEach(([label, val]) => {
      doc.text(label, 110, y);
      doc.text(val, pw - 22, y, { align: "right" });
      y += 7;
    });
    doc.setDrawColor(101, 75, 249);
    doc.setLineWidth(0.5);
    doc.line(110, y, pw - 20, y);
    y += 8;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(101, 75, 249);
    doc.text("Total Charged", 110, y);
    doc.text(`$${totalWithTax.toFixed(2)}`, pw - 22, y, { align: "right" });
    y += 25;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(20, y, pw - 20, y);
    y += 10;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 150, 150);
    doc.text("Thank you for your order! Estimated delivery: 5-7 business days.", 20, y);
    y += 5;
    doc.text("For questions, contact support@mergetasks.com", 20, y);
    y += 10;
    doc.setFontSize(7);
    doc.text("MergeTasks Inc. | 100 Enterprise Way, Suite 400 | San Francisco, CA 94105", pw / 2, y, { align: "center" });
    doc.save(`MergeTasks_Receipt_${orderNum}.pdf`);
    toast.success("Receipt PDF downloaded");
  };

  return (
    <div>
      <button
        onClick={() => setCheckoutStep(0)}
        className="flex items-center gap-1.5 mb-5 text-[12px] font-semibold"
        style={{ color: "var(--mt-brand)" }}
      >
        <ChevronRight size={14} className="rotate-180" /> Back to Proposal
      </button>

      {/* Progress Steps */}
      <div className="flex items-center gap-3 mb-8">
        {["Review Order", "Payment", "Confirmation"].map((step, i) => (
          <div key={step} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                style={{
                  backgroundColor:
                    checkoutStep > i
                      ? "#22C55E"
                      : checkoutStep === i + 1
                      ? "var(--mt-brand)"
                      : isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  color: checkoutStep >= i + 1 ? "#FFFFFF" : mutedFg,
                }}
              >
                {checkoutStep > i + 1 ? <Check size={12} /> : i + 1}
              </div>
              <span
                className="text-[12px] font-medium"
                style={{ color: checkoutStep >= i + 1 ? fg : mutedFg }}
              >
                {step}
              </span>
            </div>
            {i < 2 && (
              <div
                className="w-12 h-0.5"
                style={{ backgroundColor: checkoutStep > i + 1 ? "#22C55E" : borderColor }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Review */}
      {checkoutStep === 1 && (
        <div>
          <div
            className="rounded-lg p-6 mb-6"
            style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
          >
            <h3 className="text-[16px] font-bold mb-1" style={{ color: fg }}>
              Review Your Order
            </h3>
            <p className="text-[12px] mb-5" style={{ color: mutedFg }}>
              Confirm the items and quantities before proceeding to payment
            </p>
            <div className="space-y-3">
              {products.map((p, i) => (
                <div
                  key={`${p.sku}-${i}`}
                  className="flex items-center justify-between py-3"
                  style={{ borderBottom: i < products.length - 1 ? `1px solid ${borderColor}` : "none" }}
                >
                  <div>
                    <div className="text-[13px] font-semibold" style={{ color: fg }}>{p.name}</div>
                    <div className="text-[11px]" style={{ color: mutedFg }}>
                      {p.sku} · {p.decoration} · Qty: {p.qty}
                    </div>
                  </div>
                  <span className="text-[13px] font-semibold" style={{ color: fg }}>
                    ${p.total.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="flex justify-between items-center mt-4 pt-4"
              style={{ borderTop: `2px solid ${borderColor}` }}
            >
              <span className="text-[13px] font-semibold" style={{ color: fg }}>Order Total</span>
              <span className="text-[18px] font-bold" style={{ color: "var(--mt-brand)" }}>
                ${grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setCheckoutStep(0)}
              className="px-5 py-2.5 rounded-lg text-[12px] font-semibold"
              style={{ border: `1px solid ${borderColor}`, color: fg }}
            >
              Cancel
            </button>
            <button
              onClick={() => setCheckoutStep(2)}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-[12px] font-semibold"
              style={{ backgroundColor: "var(--mt-brand)", color: "#FFFFFF" }}
            >
              <CreditCard size={14} /> Proceed to Payment
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Payment — Stripe Checkout redirect */}
      {checkoutStep === 2 && (
        <div>
          <div
            className="rounded-lg p-6 mb-6"
            style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
          >
            <h3 className="text-[16px] font-bold mb-1" style={{ color: fg }}>Secure Payment</h3>
            <p className="text-[12px] mb-5" style={{ color: mutedFg }}>
              You will be redirected to Stripe&apos;s secure checkout to complete your payment
            </p>

            <div className="space-y-4">
              {/* Stripe branding */}
              <div
                className="flex items-center gap-3 p-4 rounded-lg"
                style={{
                  backgroundColor: isDark ? "rgba(101,75,249,0.06)" : "rgba(101,75,249,0.03)",
                  border: `1px solid ${isDark ? "rgba(101,75,249,0.2)" : "rgba(101,75,249,0.1)"}`,
                }}
              >
                <CreditCard size={18} style={{ color: "var(--mt-brand)" }} />
                <div>
                  <span className="text-[12px] font-medium block" style={{ color: fg }}>
                    Stripe Checkout
                  </span>
                  <span className="text-[10px]" style={{ color: mutedFg }}>
                    Credit card, debit card, and other payment methods
                  </span>
                </div>
              </div>

              {/* Security badge */}
              <div
                className="p-3 rounded-lg flex items-center gap-2"
                style={{
                  backgroundColor: isDark ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.04)",
                  border: `1px solid ${isDark ? "rgba(34,197,94,0.2)" : "rgba(34,197,94,0.1)"}`,
                }}
              >
                <ShieldCheck size={14} style={{ color: "#22C55E" }} />
                <span className="text-[11px]" style={{ color: "#22C55E" }}>
                  256-bit SSL encrypted · PCI DSS Level 1 compliant · Powered by Stripe
                </span>
              </div>

              {/* Error message */}
              {stripeError && (
                <div
                  className="p-3 rounded-lg flex items-center gap-2"
                  style={{
                    backgroundColor: isDark ? "rgba(239,68,68,0.08)" : "rgba(239,68,68,0.04)",
                    border: `1px solid ${isDark ? "rgba(239,68,68,0.2)" : "rgba(239,68,68,0.1)"}`,
                  }}
                >
                  <AlertCircle size={14} style={{ color: "#EF4444" }} />
                  <span className="text-[11px]" style={{ color: "#EF4444" }}>
                    {stripeError}
                  </span>
                </div>
              )}

              {/* Order summary */}
              <div
                className="flex justify-between items-center mt-5 pt-4"
                style={{ borderTop: `1px solid ${borderColor}` }}
              >
                <span className="text-[12px]" style={{ color: mutedFg }}>Total to charge</span>
                <span className="text-[18px] font-bold" style={{ color: fg }}>
                  ${grandTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setCheckoutStep(1)}
              className="px-5 py-2.5 rounded-lg text-[12px] font-semibold"
              style={{ border: `1px solid ${borderColor}`, color: fg }}
              disabled={isRedirecting}
            >
              Back
            </button>
            <button
              onClick={handleStripeCheckout}
              disabled={isRedirecting || !viewToken}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#22C55E", color: "#FFFFFF" }}
            >
              {isRedirecting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Redirecting to Stripe...
                </>
              ) : (
                <>
                  <Lock size={14} /> Pay ${grandTotal.toFixed(2)}
                  <ExternalLink size={12} />
                </>
              )}
            </button>
          </div>
          {!viewToken && (
            <p className="text-[11px] mt-3" style={{ color: "#EF4444" }}>
              Payment unavailable — this proposal does not have a valid checkout token.
            </p>
          )}
        </div>
      )}

      {/* Step 3: Confirmation */}
      {checkoutStep === 3 && (
        <div className="text-center py-12">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: "rgba(34,197,94,0.1)" }}
          >
            <CheckCircle2 size={32} style={{ color: "#22C55E" }} />
          </div>
          <h3 className="text-[20px] font-bold mb-2" style={{ color: fg }}>Payment Successful!</h3>
          <p className="text-[13px] mb-1" style={{ color: mutedFg }}>Order #{orderNum} has been placed</p>
          <p className="text-[13px] mb-6" style={{ color: mutedFg }}>
            Amount charged:{" "}
            <strong style={{ color: fg }}>${grandTotal.toFixed(2)}</strong>
          </p>
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg mb-8"
            style={{
              backgroundColor: isDark ? "rgba(101,75,249,0.08)" : "rgba(101,75,249,0.04)",
              border: `1px solid ${isDark ? "rgba(101,75,249,0.15)" : "rgba(101,75,249,0.08)"}`,
            }}
          >
            <Package size={14} style={{ color: "var(--mt-brand)" }} />
            <span className="text-[12px] font-medium" style={{ color: "var(--mt-brand)" }}>
              Estimated delivery: 5-7 business days
            </span>
          </div>
          <div className="flex justify-center gap-3">
            <button
              onClick={onBackToProposals}
              className="px-5 py-2.5 rounded-lg text-[12px] font-semibold"
              style={{ backgroundColor: "var(--mt-brand)", color: "#FFFFFF" }}
            >
              Back to Proposals
            </button>
            <button
              onClick={() => setShowReceipt(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold"
              style={{ border: `1px solid ${borderColor}`, color: fg }}
            >
              <Download size={14} /> Download Receipt
            </button>
          </div>

          {/* Receipt Modal */}
          {showReceipt && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center"
              style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            >
              <div
                className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-lg"
                style={{ backgroundColor: isDark ? "#1A1A22" : "#FFFFFF" }}
              >
                <div className="px-8 py-6" style={{ backgroundColor: "var(--mt-brand)" }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-[20px] font-bold text-white">MergeTasks</h2>
                      <p className="text-[12px] text-white/70">Payment Receipt</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12px] text-white/90 font-semibold">Receipt #{orderNum}</p>
                      <p className="text-[11px] text-white/60">{orderDate}</p>
                    </div>
                  </div>
                </div>
                <div
                  className="px-8 py-4 flex items-center gap-3"
                  style={{
                    backgroundColor: "rgba(34,197,94,0.06)",
                    borderBottom: `1px solid ${borderColor}`,
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "rgba(34,197,94,0.15)" }}
                  >
                    <CheckCircle2 size={18} style={{ color: "#22C55E" }} />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold" style={{ color: "#22C55E" }}>Payment Confirmed</p>
                    <p className="text-[11px]" style={{ color: mutedFg }}>
                      Processed via Stripe Checkout
                    </p>
                  </div>
                </div>
                <div className="px-8 py-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    {[
                      { label: "Order Number", value: orderNum },
                      { label: "Order Date", value: orderDate },
                      { label: "Proposal", value: proposalTitle },
                      { label: "Payment Method", value: "Stripe Checkout" },
                    ].map((item) => (
                      <div key={item.label}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: mutedFg }}>
                          {item.label}
                        </p>
                        <p className="text-[13px] font-semibold mt-0.5" style={{ color: fg }}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
                    <div
                      className="px-4 py-2.5 grid grid-cols-5 text-[10px] font-bold uppercase tracking-wide"
                      style={{ backgroundColor: isDark ? "#16161A" : "#F8F8FA", color: mutedFg }}
                    >
                      {["Item", "SKU", "Qty", "Unit Price", "Total"].map((h) => (
                        <span key={h}>{h}</span>
                      ))}
                    </div>
                    {products.map((p, i) => (
                      <div
                        key={`${p.sku}-${i}`}
                        className="px-4 py-3 grid grid-cols-5"
                        style={{ borderTop: `1px solid ${borderColor}` }}
                      >
                        <div>
                          <p className="text-[12px] font-semibold" style={{ color: fg }}>{p.name}</p>
                          <p className="text-[10px]" style={{ color: mutedFg }}>{p.decoration}</p>
                        </div>
                        <span className="text-[11px]" style={{ color: mutedFg }}>{p.sku}</span>
                        <span className="text-[12px]" style={{ color: fg }}>{p.qty}</span>
                        <span className="text-[12px]" style={{ color: fg }}>${p.unitPrice.toFixed(2)}</span>
                        <span className="text-[12px] font-semibold" style={{ color: fg }}>${p.total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 space-y-2">
                    {[
                      { label: "Subtotal", value: `$${grandTotal.toFixed(2)}` },
                      { label: `Tax (${taxRateLabel})`, value: `$${tax.toFixed(2)}` },
                      { label: "Shipping", value: "FREE" },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between">
                        <span className="text-[12px]" style={{ color: mutedFg }}>{row.label}</span>
                        <span className="text-[12px]" style={{ color: fg }}>{row.value}</span>
                      </div>
                    ))}
                    <div
                      className="flex justify-between pt-3"
                      style={{ borderTop: `2px solid ${borderColor}` }}
                    >
                      <span className="text-[14px] font-bold" style={{ color: fg }}>Total Charged</span>
                      <span className="text-[16px] font-bold" style={{ color: "var(--mt-brand)" }}>
                        ${totalWithTax.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  className="px-8 py-4 flex items-center justify-between"
                  style={{ borderTop: `1px solid ${borderColor}` }}
                >
                  <p className="text-[11px]" style={{ color: mutedFg }}>
                    Questions? support@mergetasks.com
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowReceipt(false)}
                      className="px-4 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ border: `1px solid ${borderColor}`, color: fg }}
                    >
                      Close
                    </button>
                    <button
                      onClick={generateReceiptPDF}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold"
                      style={{ backgroundColor: "var(--mt-brand)", color: "#FFFFFF" }}
                    >
                      <Download size={13} /> Download PDF
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
