/**
 * PortalProposalDetail.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-screen detail view for a single portal proposal. Supports:
 *  - Multi-department approval tracker (sourced from storePortal.proposals.getById)
 *  - Edit mode: adjust quantities, remove items
 *  - Action buttons: Approve, Reject, Checkout, Download PDF
 *  - Delegates checkout flow to PortalProposalCheckout
 *
 * Data sources:
 *  - Line items + departments + branding: storePortal.proposals.getById
 *  - Mutations: requestFulfillment (approve), decline, editProducts
 *
 * "Add Product" is intentionally disabled. A portal-scoped, cross-tenant-safe
 * catalog endpoint and corresponding storePortal.proposals.addProduct mutation
 * are deferred to a separate PR; the K-3 cross-tenant fix forbids reusing the
 * distributor-scoped trpc.products.list here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useMemo, useEffect } from "react";
import {
  ChevronRight, GitBranch, Clock, Check, X, Edit3, Plus, Minus, Trash2,
  Send, FileText, ShoppingCart, Download, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PortalProposalCheckout, type ProductRow } from "./PortalProposalCheckout";

export type DeptApproval = {
  name: string;
  status: "approved" | "pending" | "rejected" | "not_started";
  approver?: string;
  date?: string;
};

export type PortalProposal = {
  id: string;
  title: string;
  distributor: string;
  items: number;
  total: string;
  date: string;
  status: string;
  urgent: boolean;
  type: "regular" | "multi-department";
  departments?: DeptApproval[];
  viewToken?: string;
};

// Addable catalog deferred — needs a portal-scoped, cross-tenant-safe products
// endpoint plus a storePortal.proposals.addProduct mutation. See file header.
const ADDABLE_CATALOG: ProductRow[] = [];

interface PortalProposalDetailProps {
  proposal: PortalProposal;
  onBack: () => void;
  getStatusStyle: (status: string) => { bg: string; color: string };
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  taxRate: number | null;
  storeSlug?: string;
}

export function PortalProposalDetail({
  proposal, onBack, getStatusStyle, isDark, fg, mutedFg, borderColor, cardBg, taxRate, storeSlug,
}: PortalProposalDetailProps) {
  const [editMode, setEditMode] = useState(false);
  const [editProducts, setEditProducts] = useState<ProductRow[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(0);
  const [currentProposal, setCurrentProposal] = useState<PortalProposal>(proposal);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const proposalIdNum = parseInt(currentProposal.id.replace(/\D/g, "") || "0");
  const slug = storeSlug || "";

  // ─── Real proposal data ──────────────────────────────────────────────────────
  const detailQuery = trpc.storePortal.proposals.getById.useQuery(
    { storeSlug: slug, proposalId: proposalIdNum },
    { enabled: !!slug && proposalIdNum > 0, retry: false },
  );
  const utils = trpc.useUtils();

  // Map server line items → ProductRow[] for the table.
  // Carry the proposalProductId through `productId` so editProducts can target real DB rows.
  const liveProducts = useMemo<ProductRow[]>(() => {
    if (!detailQuery.data?.products) return [];
    return detailQuery.data.products.map((pp) => {
      const qty = pp.quantity ?? 1;
      const unitPrice = parseFloat(pp.unitPrice ?? "0");
      return {
        name: pp.name,
        sku: pp.sku ?? "",
        qty,
        unitPrice,
        total: qty * unitPrice,
        decoration: pp.decorationType ?? "",
        productId: pp.id,
      };
    });
  }, [detailQuery.data?.products]);

  // Map server departments → DeptApproval[] for the multi-dept tracker.
  const liveDepts = useMemo<DeptApproval[]>(() => {
    if (!detailQuery.data?.departments) return [];
    return detailQuery.data.departments.map((d) => {
      const status: DeptApproval["status"] =
        d.status === "approved" ? "approved"
        : d.status === "rejected" ? "rejected"
        : d.status === "pending" ? "pending"
        : d.emailSentAt ? "pending"
        : "not_started";
      return {
        name: d.departmentName,
        status,
        approver: d.approverName ?? d.contactName ?? undefined,
        date: d.approvedAt ? new Date(d.approvedAt).toLocaleDateString() : undefined,
      };
    });
  }, [detailQuery.data?.departments]);

  // Reset edit buffer when leaving edit mode or when fresh data arrives mid-edit.
  useEffect(() => {
    if (!editMode) setEditProducts(liveProducts);
  }, [liveProducts, editMode]);

  // ─── tRPC mutations ──────────────────────────────────────────────────────────
  const fulfillMut = trpc.storePortal.proposals.requestFulfillment.useMutation();
  const declineMut = trpc.storePortal.proposals.decline.useMutation();
  const editProductsMut = trpc.storePortal.proposals.editProducts.useMutation();

  const isMulti = currentProposal.type === "multi-department";
  const depts = liveDepts.length > 0 ? liveDepts : currentProposal.departments || [];
  const approvedCount = depts.filter((d) => d.status === "approved").length;
  const vpStatusStyle = getStatusStyle(currentProposal.status);
  const products = editMode ? editProducts : liveProducts;
  const grandTotal = products.reduce((s, p) => s + p.total, 0);
  const totalUnits = products.reduce((s, p) => s + p.qty, 0);
  const addableProducts = ADDABLE_CATALOG.filter(
    (ap) => !products.some((p) => p.sku === ap.sku)
  );

  // ─── Action handlers ─────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!slug) {
      toast.error("Store context unavailable");
      return;
    }
    setActionLoading("approve");
    try {
      await fulfillMut.mutateAsync({
        storeSlug: slug,
        proposalId: proposalIdNum,
        pocNotes: "Approved via portal",
      });
      toast.success(`Proposal ${currentProposal.id} approved — sent for fulfillment`);
      setCurrentProposal({ ...currentProposal, status: "Approved" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't approve the proposal");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!slug) {
      toast.error("Store context unavailable");
      return;
    }
    setActionLoading("reject");
    try {
      await declineMut.mutateAsync({
        storeSlug: slug,
        proposalId: proposalIdNum,
        reason: "Declined via portal",
      });
      toast.success(`Proposal ${currentProposal.id} declined`);
      onBack();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't decline the proposal");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmitEdits = async () => {
    if (!slug) {
      toast.error("Store context unavailable");
      return;
    }
    setActionLoading("submit");
    try {
      // Diff against the live server snapshot. Each item carries its real
      // proposalProductId via productId — that's what the mutation expects.
      const edits: Array<{ proposalProductId: number; quantity?: number; removed?: boolean }> = [];
      liveProducts.forEach((orig) => {
        if (orig.productId === undefined) return;
        const current = editProducts.find((p) => p.productId === orig.productId);
        if (!current) {
          edits.push({ proposalProductId: orig.productId, removed: true });
        } else if (current.qty !== orig.qty) {
          edits.push({ proposalProductId: orig.productId, quantity: current.qty });
        }
      });

      if (edits.length === 0) {
        toast.info("No changes to submit");
        setEditMode(false);
        return;
      }

      await editProductsMut.mutateAsync({
        storeSlug: slug,
        proposalId: proposalIdNum,
        edits,
        editNotes: "Edited via portal",
      });
      toast.success("Changes submitted to distributor");
      setEditMode(false);
      await utils.storePortal.proposals.getById.invalidate({ storeSlug: slug, proposalId: proposalIdNum });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit changes");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadPdf = () => {
    // Open the public proposal PDF view in a new tab
    const pdfUrl = `/view/proposal/${currentProposal.id}`;
    window.open(pdfUrl, "_blank");
    toast.info("Opening proposal in new tab for download...");
  };

  const getDeptStatusStyle = (status: DeptApproval["status"]) => {
    switch (status) {
      case "approved": return { bg: "rgba(34,197,94,0.1)", color: "#22C55E", label: "Approved" };
      case "pending": return { bg: "rgba(251,191,36,0.1)", color: "#F59E0B", label: "Pending" };
      case "rejected": return { bg: "rgba(239,68,68,0.1)", color: "#EF4444", label: "Rejected" };
      case "not_started":
      default:
        return {
          bg: isDark ? "rgba(107,107,118,0.1)" : "rgba(115,115,115,0.06)",
          color: mutedFg,
          label: "Waiting",
        };
    }
  };

  // ─── Loading / error states ──────────────────────────────────────────────────
  // First-load only: don't blank the screen on background refetches.
  if (detailQuery.isLoading && !detailQuery.data) {
    return (
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 mb-5 text-[12px] font-semibold"
          style={{ color: "var(--mt-brand)" }}
        >
          <ChevronRight size={14} className="rotate-180" /> Back to Proposals
        </button>
        <div
          className="rounded-xl p-10 flex items-center justify-center"
          style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
        >
          <Loader2 size={18} className="animate-spin" style={{ color: mutedFg }} />
          <span className="ml-3 text-[13px]" style={{ color: mutedFg }}>Loading proposal…</span>
        </div>
      </div>
    );
  }

  if (detailQuery.error) {
    return (
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 mb-5 text-[12px] font-semibold"
          style={{ color: "var(--mt-brand)" }}
        >
          <ChevronRight size={14} className="rotate-180" /> Back to Proposals
        </button>
        <div
          className="rounded-xl p-8"
          style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
        >
          <p className="text-[13px] font-semibold mb-1" style={{ color: fg }}>
            Couldn't load proposal details
          </p>
          <p className="text-[12px]" style={{ color: mutedFg }}>{detailQuery.error.message}</p>
        </div>
      </div>
    );
  }

  // ─── Checkout overlay ────────────────────────────────────────────────────────
  if (checkoutStep > 0) {
    return (
      <PortalProposalCheckout
        proposalId={currentProposal.id}
        proposalTitle={currentProposal.title}
        products={products}
        checkoutStep={checkoutStep}
        setCheckoutStep={setCheckoutStep}
        onBackToProposals={() => { setCheckoutStep(0); onBack(); }}
        isDark={isDark}
        fg={fg}
        mutedFg={mutedFg}
        borderColor={borderColor}
        cardBg={cardBg}
        taxRate={taxRate}
        storeSlug={slug}
        viewToken={currentProposal.viewToken}
      />
    );
  }

  // ─── Proposal detail ─────────────────────────────────────────────────────────
  return (
    <div>
      <button
        onClick={() => { onBack(); setEditMode(false); setCheckoutStep(0); }}
        className="flex items-center gap-1.5 mb-5 text-[12px] font-semibold"
        style={{ color: "var(--mt-brand)" }}
      >
        <ChevronRight size={14} className="rotate-180" /> Back to Proposals
      </button>

      {/* Header */}
      <div
        className="rounded-xl p-6 mb-6"
        style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-[20px] font-bold" style={{ color: fg }}>{currentProposal.title}</h2>
              <span
                className="text-[10px] font-semibold tracking-wide uppercase px-2.5 py-1 rounded-full"
                style={{ backgroundColor: vpStatusStyle.bg, color: vpStatusStyle.color }}
              >
                {currentProposal.status}
              </span>
              {currentProposal.urgent && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "#EF4444" }}
                >
                  Urgent
                </span>
              )}
              {isMulti && (
                <span
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: isDark ? "rgba(101,75,249,0.1)" : "rgba(101,75,249,0.06)",
                    color: "var(--mt-brand)",
                  }}
                >
                  <GitBranch size={9} /> Multi-Dept
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-[12px]" style={{ color: mutedFg }}>
              <span>Proposal {currentProposal.id}</span>
              <span>·</span>
              <span>{currentProposal.distributor}</span>
              <span>·</span>
              <span>{currentProposal.date}</span>
            </div>
          </div>
          {!editMode && (
            <button
              onClick={() => setEditMode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{ border: `1px solid ${borderColor}`, color: fg }}
            >
              <Edit3 size={12} /> Edit Proposal
            </button>
          )}
        </div>

        {/* Multi-dept progress */}
        {isMulti && depts.length > 0 && (
          <div
            className="rounded-lg p-4"
            style={{
              backgroundColor: isDark ? "rgba(101,75,249,0.04)" : "rgba(101,75,249,0.02)",
              border: `1px solid ${isDark ? "rgba(101,75,249,0.15)" : "rgba(101,75,249,0.08)"}`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <GitBranch size={13} style={{ color: "var(--mt-brand)" }} />
                <span className="text-[12px] font-semibold" style={{ color: fg }}>
                  Department Approval Progress
                </span>
              </div>
              <span className="text-[10px]" style={{ color: mutedFg }}>
                {approvedCount} of {depts.length} approved
              </span>
            </div>
            <div
              className="w-full h-2 rounded-full mb-3"
              style={{ backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(approvedCount / depts.length) * 100}%`,
                  backgroundColor: depts.some((d) => d.status === "rejected") ? "#EF4444" : "#22C55E",
                }}
              />
            </div>
            <div className="space-y-2">
              {depts.map((dept, dIdx) => {
                const dStyle = getDeptStatusStyle(dept.status);
                return (
                  <div
                    key={`${dept.name ?? "dept"}-${dIdx}`}
                    className="flex items-center justify-between py-1.5 px-3 rounded-md"
                    style={{ backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)" }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: dStyle.bg }}
                      >
                        {dept.status === "approved" && <Check size={11} style={{ color: dStyle.color }} />}
                        {dept.status === "pending" && <Clock size={11} style={{ color: dStyle.color }} />}
                        {dept.status === "rejected" && <X size={11} style={{ color: dStyle.color }} />}
                        {dept.status === "not_started" && (
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: mutedFg }} />
                        )}
                      </div>
                      <div>
                        <span className="text-[12px] font-semibold" style={{ color: fg }}>{dept.name}</span>
                        {dept.approver && (
                          <span className="text-[10px] ml-2" style={{ color: mutedFg }}>
                            {dept.approver}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {dept.date && (
                        <span className="text-[10px]" style={{ color: mutedFg }}>{dept.date}</span>
                      )}
                      <span
                        className="text-[9px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: dStyle.bg, color: dStyle.color }}
                      >
                        {dStyle.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Products Table */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ border: `1px solid ${borderColor}` }}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ backgroundColor: cardBg }}>
          <h3 className="text-[12px] font-bold tracking-[0.08em] uppercase" style={{ color: fg }}>
            Products ({products.length})
          </h3>
          {editMode && (
            <button
              disabled={addableProducts.length === 0}
              onClick={() => setShowAddProduct(!showAddProduct)}
              title={addableProducts.length === 0 ? "Add product — coming soon" : undefined}
              className="flex items-center gap-1 text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: "var(--mt-brand)" }}
            >
              <Plus size={12} />
              {addableProducts.length === 0 ? "Add product (coming soon)" : "Add Product"}
            </button>
          )}
        </div>

        {/* Add product dropdown */}
        {editMode && showAddProduct && (
          <div className="px-5 py-3" style={{ borderBottom: `1px solid ${borderColor}`, backgroundColor: isDark ? "rgba(101,75,249,0.04)" : "rgba(101,75,249,0.02)" }}>
            <p className="text-[11px] font-semibold mb-2" style={{ color: fg }}>Select a product to add:</p>
            <div className="flex flex-wrap gap-2">
              {addableProducts.map((ap) => (
                <button
                  key={ap.sku}
                  onClick={() => {
                    setEditProducts([...editProducts, { ...ap }]);
                    setShowAddProduct(false);
                    toast.success(`Added ${ap.name}`);
                  }}
                  className="px-3 py-1.5 rounded text-[11px] font-medium"
                  style={{ border: `1px solid ${borderColor}`, color: fg }}
                >
                  {ap.name} — ${ap.unitPrice.toFixed(2)}
                </button>
              ))}
            </div>
          </div>
        )}

        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: `1px solid ${borderColor}` }}>
              <th className="text-left px-5 py-3 text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color: mutedFg }}>Product</th>
              <th className="text-left px-5 py-3 text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color: mutedFg }}>SKU</th>
              <th className="text-left px-5 py-3 text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color: mutedFg }}>Decoration</th>
              <th className="text-left px-5 py-3 text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color: mutedFg }}>Qty</th>
              <th className="text-left px-5 py-3 text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color: mutedFg }}>Unit Price</th>
              <th className="text-left px-5 py-3 text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color: mutedFg }}>Total</th>
              {editMode && <th className="px-5 py-3" />}
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={editMode ? 7 : 6} className="px-5 py-12 text-center">
                  <p className="text-[13px] font-medium mb-1" style={{ color: fg }}>
                    No items on this proposal yet
                  </p>
                  <p className="text-[12px]" style={{ color: mutedFg }}>
                    Distributor needs to add items via the editor.
                  </p>
                </td>
              </tr>
            )}
            {products.map((product, pIdx) => (
              <tr key={product.sku} style={{ borderBottom: `1px solid ${isDark ? "#1A1A22" : "#F5F5F5"}` }}>
                <td className="px-5 py-3 text-[13px] font-semibold" style={{ color: fg }}>{product.name}</td>
                <td className="px-5 py-3 text-[12px]" style={{ color: mutedFg }}>{product.sku}</td>
                <td className="px-5 py-3 text-[12px]" style={{ color: mutedFg }}>{product.decoration}</td>
                <td className="px-5 py-3">
                  {editMode ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const updated = [...editProducts];
                          const newQty = Math.max(1, updated[pIdx].qty - 5);
                          updated[pIdx] = { ...updated[pIdx], qty: newQty, total: newQty * updated[pIdx].unitPrice };
                          setEditProducts(updated);
                        }}
                        className="w-6 h-6 rounded flex items-center justify-center"
                        style={{ border: `1px solid ${borderColor}` }}
                      >
                        <Minus size={10} style={{ color: fg }} />
                      </button>
                      <span className="text-[13px] font-medium w-8 text-center" style={{ color: fg }}>
                        {product.qty}
                      </span>
                      <button
                        onClick={() => {
                          const updated = [...editProducts];
                          updated[pIdx] = {
                            ...updated[pIdx],
                            qty: updated[pIdx].qty + 5,
                            total: (updated[pIdx].qty + 5) * updated[pIdx].unitPrice,
                          };
                          setEditProducts(updated);
                        }}
                        className="w-6 h-6 rounded flex items-center justify-center"
                        style={{ border: `1px solid ${borderColor}` }}
                      >
                        <Plus size={10} style={{ color: fg }} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[13px] font-medium" style={{ color: fg }}>{product.qty}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-[13px]" style={{ color: fg }}>${product.unitPrice.toFixed(2)}</td>
                <td className="px-5 py-3 text-[13px] font-semibold" style={{ color: fg }}>
                  ${product.total.toFixed(2)}
                </td>
                {editMode && (
                  <td className="px-5 py-3">
                    <button
                      onClick={() => {
                        const updated = editProducts.filter((_, i) => i !== pIdx);
                        setEditProducts(updated);
                        toast.info(`Removed ${product.name}`);
                      }}
                      className="w-7 h-7 rounded flex items-center justify-center"
                      style={{ backgroundColor: "rgba(239,68,68,0.08)" }}
                    >
                      <Trash2 size={12} style={{ color: "#EF4444" }} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${borderColor}` }}>
              <td colSpan={3} className="px-5 py-3 text-[12px] font-semibold" style={{ color: fg }}>
                Proposal Total
              </td>
              <td className="px-5 py-3 text-[13px] font-bold" style={{ color: fg }}>{totalUnits}</td>
              <td className="px-5 py-3" />
              <td className="px-5 py-3 text-[14px] font-bold" style={{ color: "var(--mt-brand)" }}>
                ${grandTotal.toFixed(2)}
              </td>
              {editMode && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        {editMode ? (
          <>
            <button
              onClick={handleSubmitEdits}
              disabled={actionLoading === "submit"}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: "var(--mt-brand)", color: "#FFFFFF" }}
            >
              {actionLoading === "submit" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {actionLoading === "submit" ? "Submitting..." : "Submit to Distributor"}
            </button>
            <button
              onClick={() => { toast.info("Changes saved as draft"); setEditMode(false); }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold"
              style={{ border: `1px solid ${borderColor}`, color: fg }}
            >
              <FileText size={14} /> Save Draft
            </button>
            <button
              onClick={() => { setEditMode(false); setEditProducts(liveProducts); setShowAddProduct(false); }}
              className="px-5 py-2.5 rounded-lg text-[12px] font-semibold"
              style={{ color: "#EF4444" }}
            >
              Cancel Editing
            </button>
          </>
        ) : (
          <>
            {currentProposal.status !== "Approved" && (
              <>
                <button
                  onClick={handleApprove}
                  disabled={actionLoading === "approve"}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
                  style={{ backgroundColor: "#22C55E", color: "#FFFFFF" }}
                >
                  {actionLoading === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {actionLoading === "approve" ? "Approving..." : "Approve Proposal"}
                </button>
                <button
                  onClick={handleReject}
                  disabled={actionLoading === "reject"}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
                  style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "#EF4444" }}
                >
                  {actionLoading === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  {actionLoading === "reject" ? "Declining..." : "Reject"}
                </button>
              </>
            )}
            {currentProposal.status === "Approved" && (
              <button
                onClick={() => setCheckoutStep(1)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold"
                style={{ backgroundColor: "var(--mt-brand)", color: "#FFFFFF" }}
              >
                <ShoppingCart size={14} /> Checkout with Stripe
              </button>
            )}
            <button
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold"
              style={{ border: `1px solid ${borderColor}`, color: fg }}
            >
              <Download size={14} /> Download PDF
            </button>
          </>
        )}
      </div>
    </div>
  );
}
