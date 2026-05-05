import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { trpc } from "@/lib/trpc";
import { Plus, ChevronRight, Check, Clock, X, FileText, Bot, Send, CreditCard, Eye, Users, Edit3, ArrowLeft, MoreHorizontal, Copy, Trash2, Loader2, Receipt, FileOutput } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { humanizeEmailMethod } from "@/lib/emailMethod";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ProposalSendConfirmModal } from "@/components/proposal";

interface Proposal {
  id: string;
  dbId?: number;
  /** DB clientId — used by the send-confirm modal to load the contacts list. */
  clientId?: number;
  client: string;
  title: string;
  value: string;
  numericValue: number;
  status: "Draft" | "Pending Approval" | "Approved" | "Sent" | "Accepted";
  departments: { name: string; status: "approved" | "pending" | "rejected" }[];
  items: number;
  created: string;
  aiGenerated: boolean;
  checkoutEnabled: boolean;
  multiDept: boolean;
  products: { name: string; sku: string; qty: number; price: number; decoration: string }[];
}

/* Static demo proposals removed — all data is now real-time from DB */

const statusStyles: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  "Pending Approval": "bg-amber-50 text-amber-700",
  Approved: "bg-purple-50 text-purple-700",
  Sent: "bg-blue-50 text-blue-700",
  Accepted: "bg-green-50 text-green-700",
  Refunded: "bg-red-50 text-red-700",
  "Partially Refunded": "bg-amber-50 text-amber-700",
  "Refund Pending": "bg-amber-50 text-amber-700",
};

/**
 * Skeleton row mirroring the Proposals table's 9 columns (see header at
 * line ~482). Widths approximate typical content so the skeleton reads as
 * a dim preview instead of a uniform bar grid.
 */
function ProposalsSkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid #F5F5F5" }}>
      <td className="px-5 py-4"><div className="h-3 bg-[#F0F0F0] rounded-full w-16 animate-pulse" /></td>
      <td className="px-5 py-4"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-32 animate-pulse" /></td>
      <td className="px-5 py-4"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-48 animate-pulse" /></td>
      <td className="px-5 py-4"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-16 animate-pulse" /></td>
      <td className="px-5 py-4"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-6 mx-auto animate-pulse" /></td>
      <td className="px-5 py-4"><div className="h-5 bg-[#F0F0F0] rounded-full w-16 animate-pulse" /></td>
      <td className="px-5 py-4"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-10 animate-pulse" /></td>
      <td className="px-5 py-4"><div className="h-5 bg-[#F0F0F0] rounded-full w-20 animate-pulse" /></td>
      <td className="px-5 py-4"><div className="h-7 w-7 rounded-md bg-[#F0F0F0] animate-pulse" /></td>
    </tr>
  );
}

export default function Proposals() {
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiStep, setAiStep] = useState(0);
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("All");
  const [viewingDetail, setViewingDetail] = useState<Proposal | null>(null);
  // Send-confirm modal state
  const [sendTarget, setSendTarget] = useState<Proposal | null>(null);

  // Fetch real proposals from DB
  const utils = trpc.useUtils();
  const { data: _dbProposalsRaw, isLoading: proposalsLoading } = trpc.proposals.list.useQuery();
  const dbProposals = _dbProposalsRaw?.items ?? [];
  const sendProposal = trpc.proposals.send.useMutation({
    onSuccess: (data) => {
      utils.proposals.list.invalidate();
      toast.success(
        data.emailSent
          ? `Proposal sent via ${humanizeEmailMethod(data.emailMethod)}`
          : "Proposal marked as sent. Email delivery pending.",
      );
    },
    onError: (err) => {
      toast.error("Failed to send: " + err.message);
    },
  });
  const deleteProposal = trpc.proposals.delete.useMutation({
    onSuccess: () => {
      utils.proposals.list.invalidate();
      toast.success("Proposal deleted");
    },
    onError: (err) => {
      toast.error("Failed to delete: " + err.message);
    },
  });
  const duplicateProposal = trpc.proposals.duplicate.useMutation({
    onSuccess: (data) => {
      utils.proposals.list.invalidate();
      toast.success(`Proposal duplicated — ${data.title}`);
    },
    onError: (err) => {
      toast.error(`Failed to duplicate — ${err.message}`);
    },
  });
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);

  const generatePdfMut = trpc.proposals.generatePdf.useMutation({
    onSuccess: (data) => {
      // Open the HTML in a new tab — the browser's print dialog handles PDF export
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(data.html);
        win.document.close();
      } else {
        // Fallback: download as HTML file
        const blob = new Blob([data.html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = data.filename.replace(".pdf", ".html");
        a.click();
        URL.revokeObjectURL(url);
      }
      setPdfLoadingId(null);
    },
    onError: (err) => {
      toast.error("Failed to generate PDF: " + err.message);
      setPdfLoadingId(null);
    },
  });

  // Estimate/Invoice mutations
  const createEstimate = trpc.estimatesInvoices.estimates.createFromProposal.useMutation({
    onSuccess: (data) => {
      toast.success(`Estimate #${data.estimateNumber} created`);
      navigate(`/estimates/${data.id}`);
    },
    onError: (err) => toast.error("Failed to create estimate: " + err.message),
  });
  const createInvoice = trpc.estimatesInvoices.invoices.createFromProposal.useMutation({
    onSuccess: (data) => {
      toast.success(`Invoice #${data.invoiceNumber} created`);
      navigate(`/invoices/${data.id}`);
    },
    onError: (err) => toast.error("Failed to create invoice: " + err.message),
  });

  /** Opens the send-confirm modal for the given proposal. */
  const handleOpenSendModal = (p: Proposal) => {
    if (!p.dbId) { toast.error("Can't send — proposal isn't saved yet"); return; }
    setSendTarget(p);
  };

  /** Called by the modal after the user confirms recipient selection. */
  const handleConfirmSend = async (contactIds: number[]) => {
    if (!sendTarget?.dbId) return;
    const id = sendTarget.dbId;
    setSendingId(id);
    setSendTarget(null);
    try {
      await sendProposal.mutateAsync({
        id,
        origin: window.location.origin,
        contactIds: contactIds.length > 0 ? contactIds : undefined,
      });
    } finally {
      setSendingId(null);
    }
  };

  // All proposals from DB — no static demo data
  const allProposals = useMemo(() => {
    const statusMap: Record<string, Proposal["status"]> = {
      draft: "Draft", sent: "Sent", viewed: "Sent", accepted: "Accepted", declined: "Draft", expired: "Draft",
      refunded: "Accepted", partially_refunded: "Accepted", refund_pending: "Accepted"
    };
    return dbProposals.map((p: { id: number; clientId: number; client: { companyName: string } | null; title: string; estimatedValue: string | null; status: string; productCount: number | null; createdAt: Date; stripeCheckout: boolean | null; multiDepartment: boolean | null; products?: { name?: string; sku?: string; qty?: number; price?: number; decoration?: string }[] }) => ({
      id: `P-${1100 + p.id}`,
      dbId: p.id,
      clientId: p.clientId,
      client: p.client?.companyName || "(Deleted Client)",
      title: p.title,
      value: `$${parseFloat(p.estimatedValue || "0").toLocaleString()}`,
      numericValue: parseFloat(p.estimatedValue || "0"),
      status: statusMap[p.status] || "Draft",
      departments: [] as Proposal["departments"],
      items: p.productCount || 0,
      created: new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      aiGenerated: false,
      checkoutEnabled: p.stripeCheckout || false,
      multiDept: p.multiDepartment || false,
      products: (p.products || []).map((pr) => ({
        name: pr.name || "Unknown",
        sku: pr.sku || "",
        qty: pr.qty || 0,
        price: pr.price || 0,
        decoration: pr.decoration || "",
      })),
    }));
  }, [dbProposals]);

  const tabs = ["All", "Draft", "Pending", "Approved", "Sent", "Accepted"];

  const filteredProposals = allProposals.filter(p => {
    if (activeTab === "All") return true;
    if (activeTab === "Pending") return p.status === "Pending Approval";
    return p.status === activeTab;
  });

  const draftCount = allProposals.filter(p => p.status === "Draft").length;
  const completedCount = allProposals.filter(p => p.status !== "Draft").length;

  const startAI = () => {
    setShowAIModal(true);
    setAiStep(0);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step > 4) { clearInterval(interval); } else { setAiStep(step); }
    }, 1200);
  };

  // Full detail view for a proposal
  if (viewingDetail) {
    const p = viewingDetail;
    const isDraft = p.status === "Draft";
    const productTotal = p.products.reduce((sum, pr) => sum + pr.qty * pr.price, 0);

    return (
      <DashboardLayout title="Proposals" subtitle="Create, approve, and track proposals">
        <button onClick={() => setViewingDetail(null)} className="flex items-center gap-2 text-[13px] text-mt-ink-3 hover:text-mt-ink transition-colors mb-6">
          <ArrowLeft size={14} /> Back to Proposals
        </button>

        <div className="max-w-4xl space-y-6">
          {/* Header */}
          <div className="bg-white rounded-xl border border-mt-border p-6">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-[20px] font-bold text-mt-ink">{p.title}</h2>
                  {p.multiDept && <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-mt-brand-light text-primary uppercase">Multi-Dept</span>}
                  {isDraft && <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-mt-surface-2 text-mt-ink-3 uppercase">Draft</span>}
                </div>
                <p className="text-[13px] text-mt-ink-3">{p.id} · {p.client} · {p.created}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[11px] font-semibold px-3 py-1.5 rounded ${statusStyles[p.status]}`}>{p.status}</span>
                <span className="text-[20px] font-bold text-mt-ink">{p.value}</span>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Products", value: p.products.length },
                { label: "Total Units", value: p.products.reduce((s, pr) => s + pr.qty, 0) },
                { label: "Avg Unit Cost", value: `$${(productTotal / p.products.reduce((s, pr) => s + pr.qty, 0)).toFixed(2)}` },
                { label: p.multiDept ? "Depts" : "Checkout", value: p.multiDept ? `${p.departments.filter(d => d.status === "approved").length}/${p.departments.length}` : p.checkoutEnabled ? "Stripe" : "Manual" },
              ].map((s) => (
                <div key={s.label} className="p-3 bg-mt-surface rounded-lg border border-mt-border">
                  <p className="text-[20px] font-bold text-mt-ink">{s.value}</p>
                  <p className="text-[11px] text-mt-ink-3">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Department Approvals (for multi-dept) */}
          {p.multiDept && p.departments.length > 0 && (
            <div className="bg-white rounded-xl border border-mt-border p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users size={16} className="text-primary" />
                <h3 className="text-[14px] font-bold text-mt-ink">Department Approval Workflow</h3>
                <span className="ml-auto text-[12px] text-mt-ink-3">
                  {p.departments.filter(d => d.status === "approved").length} of {p.departments.length} approved
                </span>
              </div>
              <div className="w-full h-2 bg-[#F0F0F0] rounded-full mb-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(p.departments.filter(d => d.status === "approved").length / p.departments.length) * 100}%`,
                    backgroundColor: p.departments.some(d => d.status === "rejected") ? "#EF4444" : "var(--mt-brand)"
                  }}
                />
              </div>
              <div className="space-y-2">
                {p.departments.map((d, i) => (
                  <div key={i} className="flex items-center justify-between py-3 px-4 rounded-lg border border-[#F0F0F0]">
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        d.status === "approved" ? "bg-[#16A34A]" : d.status === "pending" ? "bg-[#D97706]" : "bg-[#EF4444]"
                      }`}>
                        {d.status === "approved" ? <Check size={12} color="#FFF" /> : d.status === "pending" ? <Clock size={12} color="#FFF" /> : <X size={12} color="#FFF" />}
                      </div>
                      <span className="text-[13px] font-medium text-mt-ink">{d.name}</span>
                    </div>
                    <span className={`text-[11px] font-semibold uppercase ${
                      d.status === "approved" ? "text-[#16A34A]" : d.status === "pending" ? "text-[#D97706]" : "text-[#EF4444]"
                    }`}>{d.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Products Table */}
          <div className="bg-white rounded-xl border border-mt-border p-6">
            <h3 className="text-[14px] font-bold text-mt-ink mb-4">Products in This Proposal</h3>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
                  {["Product", "SKU", "Decoration", "Qty", "Unit Price", "Total"].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.products.map((pr, i) => (
                  <tr key={i} style={{ borderBottom: i < p.products.length - 1 ? "1px solid #F5F5F5" : "none" }}>
                    <td className="px-4 py-3 text-[13px] font-medium text-mt-ink">{pr.name}</td>
                    <td className="px-4 py-3 text-[12px] text-mt-ink-3 font-mono">{pr.sku}</td>
                    <td className="px-4 py-3 text-[12px] text-mt-ink-3">{pr.decoration}</td>
                    <td className="px-4 py-3 text-[13px] text-mt-ink font-mono">{pr.qty}</td>
                    <td className="px-4 py-3 text-[13px] text-mt-ink-3">${pr.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-mt-ink">${(pr.qty * pr.price).toFixed(2)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid #E5E5E5" }}>
                  <td colSpan={3} className="px-4 py-3 text-[13px] font-bold text-mt-ink">Proposal Total</td>
                  <td className="px-4 py-3 text-[13px] font-mono text-mt-ink">{p.products.reduce((s, pr) => s + pr.qty, 0)}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-[14px] font-bold text-primary">${productTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Checkout & Payment Info */}
          {p.checkoutEnabled && (
            <div className="bg-white rounded-xl border border-mt-border p-6">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard size={16} className="text-primary" />
                <h3 className="text-[14px] font-bold text-mt-ink">Stripe Checkout</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#F0FDF4] text-[#16A34A] uppercase">Enabled</span>
              </div>
              <p className="text-[12px] text-mt-ink-3 mb-3">Client can pay directly from the proposal after approval. Payment is processed via Stripe.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-mt-surface rounded-lg border border-mt-border">
                  <p className="text-[11px] text-mt-ink-3">Payment Status</p>
                  <p className="text-[13px] font-semibold text-mt-ink">{p.status === "Accepted" ? "Paid" : "Awaiting"}</p>
                </div>
                <div className="p-3 bg-mt-surface rounded-lg border border-mt-border">
                  <p className="text-[11px] text-mt-ink-3">Method</p>
                  <p className="text-[13px] font-semibold text-mt-ink">Credit Card</p>
                </div>
                <div className="p-3 bg-mt-surface rounded-lg border border-mt-border">
                  <p className="text-[11px] text-mt-ink-3">Amount</p>
                  <p className="text-[13px] font-semibold text-primary">{p.value}</p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            {isDraft && (
              <>
                <button
                  onClick={() => { toast.success("Opening editor..."); navigate(p.dbId ? `/edit-proposal/${p.dbId}` : `/edit-proposal/${p.id}`); }}
                  className="flex items-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold text-white transition-transform duration-75 active:scale-[0.97]"
                  style={{ backgroundColor: 'var(--mt-brand)' }}
                >
                  <Edit3 size={14} /> Continue Editing
                </button>
                <button
                  onClick={() => handleOpenSendModal(p)}
                  disabled={sendingId === p.dbId}
                  className="flex items-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface disabled:opacity-50"
                >
                  {sendingId === p.dbId ? <><Loader2 size={14} className="animate-spin" /> Sending...</> : <><Send size={14} /> Send to Client</>}
                </button>
              </>
            )}
            {!isDraft && (
              <button
                onClick={() => handleOpenSendModal(p)}
                disabled={sendingId === p.dbId}
                className="flex items-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface disabled:opacity-50"
              >
                {sendingId === p.dbId ? <><Loader2 size={14} className="animate-spin" /> Resending...</> : <><Send size={14} /> Resend to Client</>}
              </button>
            )}
            <button
              onClick={() => {
                if (!p.dbId) { toast.error("Can't generate the PDF — proposal isn't saved yet"); return; }
                setPdfLoadingId(p.dbId);
                generatePdfMut.mutate({ id: p.dbId });
              }}
              disabled={pdfLoadingId === p.dbId}
              className="flex items-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface disabled:opacity-50"
            >
              {pdfLoadingId === p.dbId ? <><Loader2 size={14} className="animate-spin" /> Generating...</> : <><FileText size={14} /> Download PDF</>}
            </button>
            <button
              onClick={() => navigate(p.dbId ? `/proposals/${p.dbId}` : `/proposals/${p.id}`)}
              className="flex items-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface"
            >
              <Eye size={14} /> Full Detail Page
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Proposals" subtitle="Create, approve, and track proposals">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Proposals", value: allProposals.length, color: 'var(--mt-brand)' },
          { label: "Drafts", value: draftCount, color: "#737373" },
          { label: "Active", value: allProposals.filter(p => ["Pending Approval", "Sent"].includes(p.status)).length, color: "#D97706" },
          { label: "Completed", value: allProposals.filter(p => ["Approved", "Accepted"].includes(p.status)).length, color: "#16A34A" },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-lg border border-mt-border p-4">
            <p className="text-[28px] font-bold" style={{ color: card.color }}>{card.value}</p>
            <p className="text-[12px] text-mt-ink-3">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {tabs.map((tab) => {
            const count = tab === "All" ? allProposals.length
              : tab === "Pending" ? allProposals.filter(p => p.status === "Pending Approval").length
              : allProposals.filter(p => p.status === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-[12px] font-medium px-3.5 py-1.5 rounded-md transition-all duration-150 ${
                  activeTab === tab ? "bg-primary text-white" : "bg-white text-mt-ink-3 border border-mt-border hover:bg-mt-surface"
                }`}
              >
                {tab} {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button className="sq-action-btn flex items-center gap-2" onClick={startAI}>
            <Bot size={14} /> AI Generate
          </button>
          <button className="sq-action-btn primary flex items-center gap-2 active:scale-[0.97]" onClick={() => navigate("/create-proposal")}>
            <Plus size={14} /> New Proposal
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-mt-border overflow-hidden">
        {proposalsLoading ? (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
                {["ID", "Client", "Proposal", "Value", "Items", "Type", "Approvals", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => <ProposalsSkeletonRow key={i} />)}
            </tbody>
          </table>
        ) : filteredProposals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-14 h-14 rounded-full bg-mt-brand-light flex items-center justify-center mb-4">
              <FileText size={24} className="text-primary" />
            </div>
            <p className="text-[14px] font-semibold text-mt-ink mb-1">No proposals found</p>
            <p className="text-[12px] text-mt-ink-3 mb-4">Create your first proposal to get started</p>
            <button className="sq-action-btn primary flex items-center gap-2 active:scale-[0.97]" onClick={() => navigate("/create-proposal")}>
              <Plus size={14} /> New Proposal
            </button>
          </div>
        ) : (
          <>
            <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
              {["ID", "Client", "Proposal", "Value", "Items", "Type", "Approvals", "Status", ""].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredProposals.map((p, i) => (
              <motion.tr
                key={p.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, delay: Math.min(i, 15) * 0.03 }}
                className="cursor-pointer hover:bg-mt-surface transition-colors duration-150"
                style={{ borderBottom: i < filteredProposals.length - 1 ? "1px solid #F5F5F5" : "none" }}
                onClick={() => setViewingDetail(p)}
              >
                <td className="px-5 py-4 text-[12px] text-mt-ink-4 font-mono">{p.id}</td>
                <td className="px-5 py-4 text-[13px] font-semibold text-mt-ink">{p.client}</td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-mt-ink-2">{p.title}</span>
                    {p.aiGenerated && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 tracking-wider uppercase bg-mt-brand-light text-primary rounded">AI</span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4 text-[13px] font-semibold text-mt-ink font-mono">{p.value}</td>
                <td className="px-5 py-4 text-[13px] text-mt-ink-3 font-mono">{p.items}</td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1.5">
                    {p.multiDept ? (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-mt-brand-light text-primary uppercase">Multi-Dept</span>
                    ) : (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-mt-surface-2 text-mt-ink-3 uppercase">Regular</span>
                    )}
                    {p.checkoutEnabled && (
                      <CreditCard size={12} className="text-primary" />
                    )}
                  </div>
                </td>
                <td className="px-5 py-4">
                  {p.departments.length > 0 ? (
                    <div className="flex items-center gap-1">
                      {p.departments.map((d, di) => (
                        <div key={di} className={`w-5 h-5 rounded-full flex items-center justify-center ${
                          d.status === "approved" ? "bg-[#16A34A]" : d.status === "pending" ? "bg-[#D97706]" : "bg-[#EF4444]"
                        }`} title={`${d.name}: ${d.status}`}>
                          {d.status === "approved" ? <Check size={10} color="#FFF" /> : d.status === "pending" ? <Clock size={10} color="#FFF" /> : <X size={10} color="#FFF" />}
                        </div>
                      ))}
                    </div>
                  ) : <span className="text-[11px] text-[#D4D4D4]">—</span>}
                </td>
                <td className="px-5 py-4">
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded ${statusStyles[p.status]}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-1.5 rounded-md hover:bg-[#F0F0F0] transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal size={16} className="text-mt-ink-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[180px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenuItem
                        icon={<Eye />}
                        onSelect={() => setViewingDetail(p)}
                      >
                        View Details
                      </DropdownMenuItem>
                      {p.status === "Draft" && p.dbId && (
                        <DropdownMenuItem
                          icon={<Edit3 />}
                          onSelect={() => navigate(`/edit-proposal/${p.dbId}`)}
                        >
                          Edit Proposal
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        icon={<Copy />}
                        loading={duplicatingId === p.dbId}
                        onSelect={async () => {
                          if (!p.dbId) { toast.error("Can't duplicate — proposal isn't saved yet"); return; }
                          setDuplicatingId(p.dbId);
                          try { await duplicateProposal.mutateAsync({ id: p.dbId }); } finally { setDuplicatingId(null); }
                        }}
                      >
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<Send />}
                        loading={sendingId === p.dbId}
                        onSelect={() => handleOpenSendModal(p)}
                      >
                        Send to Client
                      </DropdownMenuItem>
                      {(p.status === "Accepted" || p.status === "Approved") && p.dbId && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            icon={<FileOutput />}
                            loading={convertingId === p.dbId}
                            onSelect={async () => {
                              setConvertingId(p.dbId!);
                              try { await createEstimate.mutateAsync({ proposalId: p.dbId! }); } finally { setConvertingId(null); }
                            }}
                          >
                            Convert to Estimate
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            icon={<Receipt />}
                            loading={convertingId === p.dbId}
                            onSelect={async () => {
                              setConvertingId(p.dbId!);
                              try { await createInvoice.mutateAsync({ proposalId: p.dbId! }); } finally { setConvertingId(null); }
                            }}
                          >
                            Convert to Invoice
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        icon={<Trash2 />}
                        loading={deletingId === p.dbId}
                        onSelect={() => {
                          if (!p.dbId) { toast.error("Can't delete — proposal isn't saved yet"); return; }
                          setDeleteTarget({ id: p.dbId, title: p.title });
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </motion.tr>
            ))}
          </tbody>
            </table>
          </>)}
      </div>

      {/* AI Generate Modal */}
      {showAIModal && (
        <div className="fixed inset-0 z-[10002] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-lg bg-white rounded-xl p-8 shadow-lg">
            <h2 className="text-xl font-bold text-mt-ink mb-1">AI Proposal Generator</h2>
            <p className="text-[13px] text-mt-ink-3 mb-7">Copilot analyzes past orders to draft proposals</p>

            <div className="space-y-3 mb-7">
              {[
                "Analyzing client order history...",
                "Identifying seasonal patterns...",
                "Selecting recommended products...",
                "Generating pricing & quantities...",
                "Proposal draft ready for review",
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  {i < aiStep ? (
                    <div className="w-6 h-6 rounded-full bg-[#16A34A] flex items-center justify-center">
                      <Check size={14} color="#FFF" />
                    </div>
                  ) : i === aiStep ? (
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <Bot size={14} color="#FFF" className="animate-pulse" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border border-mt-border flex items-center justify-center">
                      <span className="text-[10px] text-mt-ink-4">{i + 1}</span>
                    </div>
                  )}
                  <span className={`text-[13px] ${i <= aiStep ? "text-mt-ink font-medium" : "text-mt-ink-4"}`}>
                    {step}
                  </span>
                </div>
              ))}
            </div>

            {aiStep >= 4 && (
              <div className="flex gap-3">
                <button className="sq-action-btn primary flex-1 justify-center py-3 active:scale-[0.97]"
                  onClick={() => { setShowAIModal(false); toast.success("AI proposal added to drafts"); }}>
                  Review Draft
                </button>
                <button className="sq-action-btn px-5 py-3" onClick={() => setShowAIModal(false)}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Send-confirm modal — shared across all send surfaces on this page */}
      {sendTarget && (
        <ProposalSendConfirmModal
          show={!!sendTarget}
          clientId={sendTarget.clientId}
          clientContact={sendTarget.client}
          clientEmail=""
          title={sendTarget.title}
          productTotal={sendTarget.numericValue}
          deliveryMethod="email"
          validDays={30}
          multiDept={sendTarget.multiDept}
          departments={[]}
          approvalRouting="parallel"
          sending={sendingId === sendTarget.dbId}
          sendPending={sendProposal.isPending}
          onClose={() => setSendTarget(null)}
          onConfirm={handleConfirmSend}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this proposal?"
        description={deleteTarget ? <>&ldquo;{deleteTarget.title}&rdquo; will be removed permanently. This cannot be undone.</> : null}
        confirmLabel="Delete"
        loading={deletingId !== null}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeletingId(deleteTarget.id);
          try {
            await deleteProposal.mutateAsync({ id: deleteTarget.id });
            setDeleteTarget(null);
          } finally {
            setDeletingId(null);
          }
        }}
      />
    </DashboardLayout>
  );
}
