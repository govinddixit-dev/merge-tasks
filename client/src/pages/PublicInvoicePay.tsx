/**
 * PublicInvoicePay — /invoices/pay/:token
 * ────────────────────────────────────────
 * Unauthenticated client-facing page. Renders the same InvoicePreviewDocument
 * the distributor saw in preview mode, with a live Pay Now button wired to
 * the public checkout endpoint.
 *
 * Data model
 *   GET  /api/invoices/public/:token          → invoice + distributor branding
 *   POST /api/invoices/public/:token/checkout → returns { url } → window.location
 *
 * States handled
 *   - Loading             → quiet spinner
 *   - 404 / invalid token → clear error card, no sensitive info
 *   - Paid                → status badge + disabled Pay button + "Paid on …"
 *   - Card NOT eligible   → Pay Now hidden; Notes field carries instructions
 *   - Checkout in flight  → spinner inside Pay Now
 *   - Checkout canceled   → inline message, retry enabled
 *   - Checkout succeeded  → soft success state while the webhook flips status
 *
 * Security notes mirror publicProposalView: we never render anything the
 * GET endpoint didn't explicitly hand us, so it's not possible for a tweak
 * on this page to leak extra fields.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearch } from "wouter";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  InvoicePreviewDocument,
  type InvoicePreviewLine,
} from "@/components/invoice/InvoicePreviewDocument";

interface PublicInvoicePayload {
  invoiceNumber: string;
  status: string;
  createdAt: string | null;
  dueDate: string | null;
  paidAt: string | null;
  paymentTerms: string | null;
  notes: string | null;
  subtotal: string;
  tax: string;
  shipping: string;
  total: string;
  lineItems: Array<{
    productName: string;
    description?: string | null;
    sku?: string | null;
    color?: string | null;
    size?: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    imageUrl?: string | null;
  }>;
  client: {
    companyName: string | null;
    contactName: string | null;
    contactEmail: string | null;
    address?: string | null;
  } | null;
  distributor: {
    companyName: string;
    primaryColor: string;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  payment: {
    cardEligible: boolean;
    hasCheckoutUrl: boolean;
  };
}

const TERM_LABELS: Record<string, string> = {
  due_on_receipt: "Due on Receipt",
  net_15: "Net-15",
  net_30: "Net-30",
  net_60: "Net-60",
  custom: "Custom",
};

export default function PublicInvoicePay() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const searchString = useSearch();

  const [data, setData] = useState<PublicInvoicePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Query-param signals set by Stripe Checkout on return — used only to
  // show a soft confirmation banner; the webhook is authoritative for
  // the actual paid status.
  const returnStatus = useMemo(() => {
    const p = new URLSearchParams(searchString);
    const v = p.get("checkout");
    return v === "success" || v === "canceled" ? v : null;
  }, [searchString]);

  // Fetch the invoice. Token-shape errors land as 404 so the copy stays
  // generic — we never hint at whether a token did or didn't exist.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/invoices/public/${encodeURIComponent(token)}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "This invoice link is invalid or has expired.");
        }
        const json = (await res.json()) as PublicInvoicePayload;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load invoice");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handlePayNow() {
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const res = await fetch(
        `/api/invoices/public/${encodeURIComponent(token)}/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: typeof window !== "undefined" ? window.location.origin : undefined,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        throw new Error(body?.error || "Could not start checkout. Please try again.");
      }
      window.location.href = body.url as string;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Checkout failed.");
      setCheckoutLoading(false);
    }
  }

  // ── Loading shell ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB]">
        <Loader2 size={22} className="animate-spin text-mt-ink-3" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB] px-4">
        <div className="max-w-md text-center">
          <AlertTriangle size={32} className="mx-auto text-amber-500" />
          <h1 className="mt-4 text-lg font-semibold text-mt-ink">Invoice unavailable</h1>
          <p className="mt-2 text-sm text-mt-ink-3">
            {error || "This invoice link is invalid or has expired. Contact the sender if you believe this is a mistake."}
          </p>
        </div>
      </div>
    );
  }

  const isPaid = data.status === "paid";
  const cardVisible = data.payment.cardEligible && !isPaid;

  const lineItems: InvoicePreviewLine[] = (data.lineItems ?? []).map((li) => ({
    productName: li.productName,
    description: li.description ?? null,
    sku: li.sku ?? null,
    color: li.color ?? null,
    size: li.size ?? null,
    quantity: Number(li.quantity) || 0,
    unitPrice: Number(li.unitPrice) || 0,
    totalPrice: Number(li.totalPrice) || 0,
    imageUrl: li.imageUrl ?? null,
  }));

  const subtotal = parseFloat(data.subtotal || "0");
  const tax = parseFloat(data.tax || "0");
  const shipping = parseFloat(data.shipping || "0");
  const total = parseFloat(data.total || "0");

  let subline: string | null = null;
  if (isPaid && data.paidAt) {
    const d = new Date(data.paidAt);
    subline = `Paid ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  } else if (returnStatus === "success" && !isPaid) {
    // Webhook hasn't flipped status yet — keep it soft so the client
    // doesn't panic if the page loads before Stripe's event arrives.
    subline = "Payment received — confirmation in progress.";
  } else if (returnStatus === "canceled") {
    subline = "Checkout canceled. You can try again when ready.";
  }

  const paymentTermsLabel = data.paymentTerms
    ? TERM_LABELS[data.paymentTerms] ?? data.paymentTerms
    : null;

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <InvoicePreviewDocument
        data={{
          invoiceNumber: data.invoiceNumber,
          status: data.status,
          createdAt: data.createdAt,
          dueDate: data.dueDate,
          paidAt: data.paidAt,
          lineItems,
          subtotal,
          tax,
          shipping,
          total,
          paymentTermsLabel,
          notes: data.notes,
          client: data.client,
          distributor: data.distributor,
        }}
        pay={{
          visible: cardVisible || isPaid,
          onPayNow: cardVisible ? handlePayNow : undefined,
          loading: checkoutLoading,
          errorMessage: checkoutError,
          sublineMessage: subline,
          disabled: isPaid,
          disabledLabel: "Paid",
        }}
      />
    </div>
  );
}
