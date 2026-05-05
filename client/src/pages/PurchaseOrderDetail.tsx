/**
 * PurchaseOrderDetail.tsx — Single PO detail page.
 * Shows supplier info, line items (cost prices), activity timeline,
 * notes, and action buttons (edit, send, receive, status updates).
 */
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { TableSkeleton } from "@/components/motion/Skeletons";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft, Truck, Package, Mail, Download, CheckCircle2, Clock,
  AlertTriangle, Send as SendIcon, Edit3, Trash2,
  Loader2, ExternalLink, Lock, FileText, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { generatePOPdf } from "@/utils/poPdfGenerator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { statusTone, type StatusTone } from "@/lib/statusPalette";

/** Matches server-side POLineItem type from drizzle/schema.ts */
type POLineItem = {
  orderItemId: number;
  productId: number;
  productName: string;
  supplierSku: string | null;
  productNumber: string | null;
  quantity: number;
  costPrice: number;
  totalCost: number;
  quantityReceived: number;
  color: string | null;
  size: string | null;
  decorationType: string | null;
  decorationLocation: string | null;
  logoUrl: string | null;
  imageUrl: string | null;
  notes: string | null;
};

// ── Status config ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { tone: StatusTone; label: string }> = {
  draft:          { tone: "gray",   label: "Draft" },
  sent:           { tone: "blue",   label: "Sent" },
  acknowledged:   { tone: "purple", label: "Acknowledged" },
  in_production:  { tone: "amber",  label: "In Production" },
  shipped:        { tone: "purple", label: "Shipped" },
  received:       { tone: "green",  label: "Received" },
  cancelled:      { tone: "red",    label: "Cancelled" },
  partial:        { tone: "amber",  label: "Partial" },
  declined:       { tone: "red",    label: "Declined" },
  consolidated:   { tone: "gray",   label: "Consolidated" },
  merged:         { tone: "purple", label: "Merged" },
};

const EVENT_DOT_COLORS: Record<string, string> = {
  created: "#9CA3AF",
  sent: "#3B82F6",
  acknowledged: "#6366F1",
  status_changed: "#D97706",
  tracking_added: "#654BF9",
  note_added: "#6B7280",
  cancelled: "#EF4444",
  received: "#22C55E",
};

const CONFIDENCE_STYLES = [
  { min: 90, bg: "rgba(34,197,94,0.08)", text: "#16A34A", label: "Auto-matched" },
  { min: 70, bg: "rgba(59,130,246,0.08)", text: "#2563EB", label: "High confidence" },
  { min: 50, bg: "rgba(245,158,11,0.08)", text: "#D97706", label: "Review recommended" },
  { min: 0,  bg: "rgba(239,68,68,0.08)",  text: "#DC2626", label: "Manually assigned" },
];

function getConfidenceStyle(confidence: number) {
  return CONFIDENCE_STYLES.find(c => confidence >= c.min) || CONFIDENCE_STYLES[3];
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PurchaseOrderDetail() {
  const params = useParams<{ id: string }>();
  const poId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: po, isLoading } = trpc.purchaseOrders.getById.useQuery(
    { id: poId },
    { enabled: poId > 0 },
  );

  // Live distributor branding — pulled at render time for branded PO PDFs.
  const { data: branding } = trpc.branding.get.useQuery();
  // Pre-loaded logo as a data URL so jsPDF can embed it directly. Fetched
  // server-side (proxy) to bypass S3 CORS restrictions in the browser.
  const { data: logoData } = trpc.branding.getLogoDataUrl.useQuery();

  const [sendMethod, setSendMethod] = useState<"email" | "download" | null>(null);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [supplierNotes, setSupplierNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);

  // Load notes from PO data
  if (po && !notesLoaded) {
    setSupplierNotes(po.supplierNotes || "");
    setInternalNotes(po.internalNotes || "");
    setNotesLoaded(true);
  }

  const sendMut = trpc.purchaseOrders.send.useMutation({
    onSuccess: (res) => {
      toast.success(res.method === "email" ? "PO emailed to supplier" : "PO ready for download");
      utils.purchaseOrders.getById.invalidate({ id: poId });
      setSendMethod(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateStatusMut = trpc.purchaseOrders.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("PO status updated");
      utils.purchaseOrders.getById.invalidate({ id: poId });
      setShowStatusMenu(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMut = trpc.purchaseOrders.update.useMutation({
    onSuccess: () => toast.success("Notes saved"),
    onError: (err) => toast.error(err.message),
  });

  const deleteMut = trpc.purchaseOrders.delete.useMutation({
    onSuccess: () => { toast.success("PO deleted"); navigate("/purchase-orders"); },
    onError: (err) => toast.error(err.message),
  });

  const receiveMut = trpc.purchaseOrders.receive.useMutation({
    onSuccess: (res) => {
      toast.success(res.status === "received" ? "All items received" : `${res.totalReceived} of ${res.totalOrdered} items received`);
      utils.purchaseOrders.getById.invalidate({ id: poId });
      setShowReceiveModal(false);
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <DashboardLayout title="Purchase Order" subtitle="Loading...">
        <TableSkeleton rows={6} columns={5} />
      </DashboardLayout>
    );
  }

  if (!po) {
    return (
      <DashboardLayout title="Purchase Order" subtitle="Not found">
        <div className="text-center py-16">
          <p style={{ color: "var(--mt-ink-2, #6B7280)" }}>Purchase order not found</p>
          <button onClick={() => navigate("/purchase-orders")} className="mt-4 text-sm font-medium" style={{ color: "#654BF9" }}>
            Back to Purchase Orders
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const statusEntry = STATUS_STYLES[po.status] || STATUS_STYLES.draft;
  const status = { ...statusTone[statusEntry.tone], label: statusEntry.label };
  const items = (po.lineItems || []) as POLineItem[];
  const confidence = parseFloat(String(po.aiGroupingConfidence || "100"));
  const confStyle = getConfidenceStyle(confidence);
  const isDraft = po.status === "draft";
  const isMerged = po.status === "merged";
  const isConsolidated = po.status === "consolidated";

  return (
    <DashboardLayout title="Purchase Order" subtitle={po.poNumber}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/purchase-orders")} className="p-1.5 rounded-md transition-colors hover:bg-[var(--mt-surface-2,#F9FAFB)]">
          <ArrowLeft size={18} style={{ color: "var(--mt-ink-2, #6B7280)" }} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold" style={{ color: "var(--mt-ink, #1A1A1A)" }}>{po.poNumber}</h2>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: status.bg, color: status.text }}>
              {status.label}
            </span>
          </div>
          <p className="text-sm mt-0.5" style={{ color: "var(--mt-ink-2, #6B7280)" }}>
            {po.supplierName}{po.orderNumber ? ` · Order #${po.orderNumber}` : ""}{po.clientName ? ` · ${po.clientName}` : ""}
          </p>
        </div>

        {/* Action buttons — suppressed on consolidated POs (read-only history). */}
        <div className="flex flex-wrap items-center gap-2">
          {isDraft && !isConsolidated && (
            <button
              onClick={() => deleteMut.mutate({ id: poId })}
              className="h-9 px-3 rounded-md border text-sm font-medium transition-all hover:bg-red-50 hover:border-red-200 hover:text-red-600"
              style={{ borderColor: "var(--mt-border, #E5E5E5)", color: "var(--mt-ink-2, #6B7280)" }}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          )}
          <button
            onClick={async () => {
              try {
                await generatePOPdf(
                  {
                    ...po,
                    lineItems: items,
                    subtotal: po.subtotal || "0",
                    shipping: po.shipping || "0",
                    tax: po.tax || "0",
                    total: po.total || "0",
                    createdAt: po.createdAt ? String(po.createdAt) : new Date().toISOString(),
                    requestedShipDate: po.requestedShipDate ? new Date(po.requestedShipDate).toISOString() : null,
                    orderNumber: po.orderNumber,
                  },
                  branding
                    ? {
                        brandLogoUrl: branding.brandLogoUrl,
                        brandLogoDataUrl: logoData?.dataUrl ?? null,
                        brandPrimaryColor: branding.brandPrimaryColor,
                        brandCompanyName: branding.brandCompanyName,
                        companyAddress: branding.companyAddress,
                        companyPhone: branding.companyPhone,
                        companyEmail: branding.companyEmail,
                        companyWebsite: branding.companyWebsite,
                      }
                    : undefined,
                );
                toast.success("PO downloaded as PDF");
              } catch {
                toast.error("Couldn't generate the PDF — please try again");
              }
            }}
            className="h-9 px-3 rounded-md border text-sm font-medium transition-all hover:bg-[var(--mt-surface-2,#F9FAFB)]"
            style={{ borderColor: "var(--mt-border, #E5E5E5)", color: "var(--mt-ink, #1A1A1A)" }}
          >
            <Download size={14} />
          </button>
          {po.supplierContactEmail && !isConsolidated && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="h-9 px-4 rounded-md text-sm font-medium text-white transition-all opacity-50 cursor-not-allowed"
                    style={{ backgroundColor: "#654BF9" }}
                  >
                    <Mail size={14} className="inline mr-1.5" />Email to Supplier
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Email delivery coming soon. Download PDF to email manually.
              </TooltipContent>
            </Tooltip>
          )}
          {!isConsolidated && (po.status === "sent" || po.status === "acknowledged" || po.status === "in_production" || po.status === "shipped") && (
            <button
              onClick={() => setShowReceiveModal(true)}
              className="h-9 px-4 rounded-md border text-sm font-medium transition-all hover:bg-green-50 hover:border-green-200"
              style={{ borderColor: "var(--mt-border, #E5E5E5)", color: "#16A34A" }}
            >
              <Package size={14} className="inline mr-1.5" />Mark Received
            </button>
          )}
        </div>
      </div>

      {/* ── Merged / Consolidated lineage banner ────────────────── */}
      {isMerged && <MergedSourcesPanel poId={po.id} onNavigate={(id) => navigate(`/purchase-orders/${id}`)} />}
      {isConsolidated && (
        <div className="mb-6 rounded-lg border p-4 flex items-start gap-3" style={{ borderColor: "var(--mt-border, #E5E5E5)", backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
          <Package size={16} className="text-mt-ink-3 mt-0.5" />
          <div className="text-[13px]">
            <div className="font-semibold text-mt-ink">This PO has been consolidated</div>
            <p className="text-mt-ink-3 mt-0.5">
              Its line items were rolled up into a merged PO. This record is kept for history — no further actions are available on it.
            </p>
          </div>
        </div>
      )}

      {/* ── Two-column info cards ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Supplier card */}
        <div className="rounded-lg border p-6 transition-all duration-200 hover:border-[#654BF9]/20" style={{ borderColor: "var(--mt-border, #E5E5E5)", backgroundColor: "var(--mt-surface, #FFFFFF)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Supplier</p>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-lg font-semibold" style={{ color: "var(--mt-ink, #1A1A1A)" }}>{po.supplierName}</p>
            {po.supplierSource && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)", color: "var(--mt-ink-3, #9CA3AF)" }}>
                {po.supplierSource.toUpperCase()}
              </span>
            )}
          </div>
          <div className="space-y-2 text-sm">
            {po.supplierCode && <div><span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Code:</span> <span className="font-mono" style={{ color: "var(--mt-ink, #1A1A1A)" }}>{po.supplierCode}</span></div>}
            {po.supplierContactEmail && <div><span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Email:</span> <a href={`mailto:${po.supplierContactEmail}`} className="hover:underline" style={{ color: "#654BF9" }}>{po.supplierContactEmail}</a></div>}
            {po.supplierContactPhone && <div><span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Phone:</span> <span style={{ color: "var(--mt-ink, #1A1A1A)" }}>{po.supplierContactPhone}</span></div>}
            {po.supplierAccountNumber && <div><span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Account:</span> <span className="font-mono" style={{ color: "var(--mt-ink, #1A1A1A)" }}>{po.supplierAccountNumber}</span></div>}
          </div>
          {/* AI confidence badge */}
          <div className="mt-4">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: confStyle.bg, color: confStyle.text }}>
              {confidence >= 90 ? <CheckCircle2 size={12} /> : confidence >= 50 ? <AlertTriangle size={12} /> : <Clock size={12} />}
              {confStyle.label} ({confidence}%)
            </span>
          </div>
        </div>

        {/* Shipping card */}
        <div className="rounded-lg border p-6 transition-all duration-200 hover:border-[#654BF9]/20" style={{ borderColor: "var(--mt-border, #E5E5E5)", backgroundColor: "var(--mt-surface, #FFFFFF)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Shipping</p>
          <div className="space-y-2 text-sm">
            {po.shipToName && <div><span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Ship to:</span> <span style={{ color: "var(--mt-ink, #1A1A1A)" }}>{po.shipToName}</span></div>}
            {po.shipToAddress && <div><span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Address:</span> <span style={{ color: "var(--mt-ink, #1A1A1A)" }}>{po.shipToAddress}</span></div>}
            {po.shipToType && (
              <div>
                <span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Type:</span>{" "}
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)", color: "var(--mt-ink, #1A1A1A)" }}>
                  {po.shipToType === "decorator" ? "Decorator" : po.shipToType === "warehouse" ? "Warehouse" : "Direct to Client"}
                </span>
              </div>
            )}
            {po.requestedShipDate && <div><span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Requested ship:</span> <span style={{ color: "var(--mt-ink, #1A1A1A)" }}>{new Date(po.requestedShipDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>}
            {po.expectedDeliveryDate && <div><span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Expected delivery:</span> <span style={{ color: "var(--mt-ink, #1A1A1A)" }}>{new Date(po.expectedDeliveryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>}
            {po.trackingNumbers && (po.trackingNumbers as string[]).length > 0 && (
              <div>
                <span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Tracking:</span>{" "}
                {(po.trackingNumbers as string[]).map((tn, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono mr-1.5 cursor-pointer transition-colors hover:bg-[#654BF9]/10" style={{ backgroundColor: "rgba(101,75,249,0.05)", color: "#654BF9" }}>
                    {tn} <ExternalLink size={10} />
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Line Items Table ────────────────────────────────────── */}
      <div className="rounded-lg border mb-6 overflow-hidden" style={{ borderColor: "var(--mt-border, #E5E5E5)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)", borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
            Line Items <span className="text-xs ml-1.5 px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--mt-surface, #FFFFFF)", color: "var(--mt-ink-2, #6B7280)" }}>{items.length} items</span>
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--mt-surface, #FFFFFF)" }}>
              {["Product", "Supplier SKU", "Qty", "Unit Cost", "Total", "Decoration"].map((h, i) => (
                <th key={i} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--mt-ink-3, #9CA3AF)", borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: idx < items.length - 1 ? "1px solid var(--mt-border, #E5E5E5)" : undefined }}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="w-10 h-10 rounded-md object-contain" style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }} />
                    ) : (
                      <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
                        <Package size={16} style={{ color: "var(--mt-ink-3, #9CA3AF)" }} />
                      </div>
                    )}
                    <div>
                      <p className="font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>{item.productName}</p>
                      {item.productNumber && <p className="text-xs" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>{item.productNumber}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--mt-ink-2, #6B7280)" }}>
                  {item.supplierSku || "—"}
                </td>
                <td className="px-4 py-3 tabular-nums" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                  {item.quantity}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums" style={{ color: item.costPrice === 0 ? "#D97706" : "var(--mt-ink, #1A1A1A)" }}>
                  ${item.costPrice.toFixed(2)}
                  {item.costPrice === 0 && (
                    <span className="ml-1" title="Cost price missing — update product catalog">
                      <AlertTriangle size={12} className="inline" style={{ color: "#D97706" }} />
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                  ${item.totalCost.toFixed(2)}
                </td>
                <td className="px-4 py-3">
                  {item.decorationType ? (
                    <div>
                      <p className="text-xs font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>{item.decorationType}</p>
                      {item.decorationLocation && <p className="text-xs" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>{item.decorationLocation}</p>}
                    </div>
                  ) : (
                    <span style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {/* Totals footer */}
          <tfoot>
            <tr style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)", borderTop: "1px solid var(--mt-border, #E5E5E5)" }}>
              <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-medium" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Subtotal</td>
              <td className="px-4 py-2.5 font-mono tabular-nums font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>${parseFloat(po.subtotal || "0").toFixed(2)}</td>
              <td />
            </tr>
            {parseFloat(po.shipping || "0") > 0 && (
              <tr style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
                <td colSpan={4} className="px-4 py-1.5 text-right text-xs font-medium" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Shipping</td>
                <td className="px-4 py-1.5 font-mono tabular-nums" style={{ color: "var(--mt-ink, #1A1A1A)" }}>${parseFloat(po.shipping || "0").toFixed(2)}</td>
                <td />
              </tr>
            )}
            {parseFloat(po.tax || "0") > 0 && (
              <tr style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
                <td colSpan={4} className="px-4 py-1.5 text-right text-xs font-medium" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Tax</td>
                <td className="px-4 py-1.5 font-mono tabular-nums" style={{ color: "var(--mt-ink, #1A1A1A)" }}>${parseFloat(po.tax || "0").toFixed(2)}</td>
                <td />
              </tr>
            )}
            <tr style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
              <td colSpan={4} className="px-4 py-2.5 text-right text-sm font-bold" style={{ color: "var(--mt-ink, #1A1A1A)" }}>Total</td>
              <td className="px-4 py-2.5 font-mono tabular-nums text-base font-bold" style={{ color: "#654BF9" }}>${parseFloat(po.total || "0").toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Notes ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-lg border p-5" style={{ borderColor: "var(--mt-border, #E5E5E5)", backgroundColor: "var(--mt-surface, #FFFFFF)" }}>
          <div className="flex items-center gap-2 mb-3">
            <FileText size={14} style={{ color: "var(--mt-ink-3, #9CA3AF)" }} />
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Supplier Notes</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(59,130,246,0.06)", color: "#3B82F6" }}>Included on PO</span>
          </div>
          <textarea
            value={supplierNotes}
            onChange={(e) => setSupplierNotes(e.target.value)}
            placeholder="Notes included on the PO PDF sent to the supplier..."
            className="w-full min-h-[100px] p-3 rounded-md border text-sm outline-none resize-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
            style={{ borderColor: "var(--mt-border, #E5E5E5)" }}
          />
          {supplierNotes !== (po.supplierNotes || "") && (
            <button
              onClick={() => updateMut.mutate({ id: poId, supplierNotes })}
              className="mt-2 h-8 px-3 rounded-md text-xs font-medium text-white transition-all hover:opacity-90"
              style={{ backgroundColor: "#654BF9" }}
              disabled={updateMut.isPending}
            >
              {updateMut.isPending ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </button>
          )}
        </div>
        <div className="rounded-lg border p-5" style={{ borderColor: "var(--mt-border, #E5E5E5)", backgroundColor: "rgba(245,158,11,0.02)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Lock size={14} style={{ color: "var(--mt-ink-3, #9CA3AF)" }} />
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Internal Notes</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(245,158,11,0.06)", color: "#D97706" }}>Team only</span>
          </div>
          <textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="Internal notes — never shown to the supplier..."
            className="w-full min-h-[100px] p-3 rounded-md border text-sm outline-none resize-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
            style={{ borderColor: "var(--mt-border, #E5E5E5)" }}
          />
          {internalNotes !== (po.internalNotes || "") && (
            <button
              onClick={() => updateMut.mutate({ id: poId, internalNotes })}
              className="mt-2 h-8 px-3 rounded-md text-xs font-medium text-white transition-all hover:opacity-90"
              style={{ backgroundColor: "#654BF9" }}
              disabled={updateMut.isPending}
            >
              {updateMut.isPending ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </button>
          )}
        </div>
      </div>

      {/* ── Activity Timeline ───────────────────────────────────── */}
      {po.events && po.events.length > 0 && (
        <div className="rounded-lg border p-4 sm:p-5" style={{ borderColor: "var(--mt-border, #E5E5E5)", backgroundColor: "var(--mt-surface, #FFFFFF)" }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} style={{ color: "var(--mt-ink-3, #9CA3AF)" }} />
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Activity</p>
          </div>
          <div className="relative pl-6">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-0.5" style={{ backgroundColor: "var(--mt-border, #E5E5E5)" }} />
            <div className="space-y-4">
              {po.events.map((event, idx) => (
                <div key={event.id || idx} className="relative flex items-start gap-3">
                  {/* Dot */}
                  <div
                    className="absolute -left-6 top-1.5 w-[10px] h-[10px] rounded-full border-2 border-white"
                    style={{ backgroundColor: EVENT_DOT_COLORS[event.eventType] || "#9CA3AF" }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: "var(--mt-ink, #1A1A1A)" }}>{event.description}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>
                      {event.createdAt ? new Date(event.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Receive Modal (simple overlay) ──────────────────────── */}
      {showReceiveModal && (
        <div className="fixed inset-0 z-[10002] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg mx-4 p-6">
            <h3 className="text-lg font-bold mb-4" style={{ color: "var(--mt-ink, #1A1A1A)" }}>Receive Items — {po.poNumber}</h3>
            <div className="space-y-3 mb-6">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-2" style={{ borderBottom: idx < items.length - 1 ? "1px solid var(--mt-border, #E5E5E5)" : undefined }}>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>{item.productName}</p>
                    <p className="text-xs" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>Ordered: {item.quantity}</p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={item.quantity}
                    defaultValue={item.quantity}
                    id={`receive-${idx}`}
                    className="w-20 h-8 text-center font-mono rounded-md border text-sm outline-none focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
                    style={{ borderColor: "var(--mt-border, #E5E5E5)" }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowReceiveModal(false)}
                className="h-9 px-4 rounded-md text-sm font-medium transition-colors hover:bg-[var(--mt-surface-2,#F9FAFB)]"
                style={{ color: "var(--mt-ink-2, #6B7280)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const receivedItems = items.map((_, idx) => ({
                    lineItemIndex: idx,
                    quantityReceived: parseInt((document.getElementById(`receive-${idx}`) as HTMLInputElement)?.value || "0"),
                  }));
                  receiveMut.mutate({ id: poId, receivedItems });
                }}
                className="h-9 px-4 rounded-md text-sm font-medium text-white transition-all hover:opacity-90"
                style={{ backgroundColor: "#16A34A" }}
                disabled={receiveMut.isPending}
              >
                {receiveMut.isPending ? <Loader2 size={14} className="animate-spin inline mr-1.5" /> : <CheckCircle2 size={14} className="inline mr-1.5" />}
                Confirm Receiving
              </button>
            </div>
          </div>
        </div>
      )}

    </DashboardLayout>
  );
}

/**
 * MergedSourcesPanel — lineage card shown on a merged PO, listing the
 * original POs it was consolidated from. Each row links to its source.
 */
function MergedSourcesPanel({ poId, onNavigate }: { poId: number; onNavigate: (id: number) => void }) {
  const { data } = trpc.purchaseOrders.getMergedSources.useQuery({ id: poId });
  const sources = data?.sources ?? [];
  if (sources.length === 0) return null;
  return (
    <div className="mb-6 rounded-lg border p-4" style={{ borderColor: "var(--mt-border, #E5E5E5)", backgroundColor: "var(--mt-surface, #FFFFFF)" }}>
      <div className="flex items-center gap-2 mb-3">
        <Package size={14} className="text-primary" />
        <span className="text-[12px] font-semibold uppercase tracking-wide text-mt-ink-3">
          Merged from {sources.length} PO{sources.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-1">
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => onNavigate(s.id)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-mt-surface text-left"
          >
            <div className="flex items-center gap-3 text-[13px]">
              <span className="font-mono text-mt-ink">{s.poNumber}</span>
              <span className="text-mt-ink-3">{s.supplierName}</span>
            </div>
            <span className="font-mono tabular-nums text-[12px] text-mt-ink-2">
              ${parseFloat(s.total || "0").toFixed(2)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
