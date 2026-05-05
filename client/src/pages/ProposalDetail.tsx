/**
 * Proposal Detail View — wired to real tRPC data with virtual proof integration
 */

import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import {
  ArrowLeft, Minus, Plus, Upload, ShoppingCart, Check, Send,
  FileText, X, Eye, Sparkles, Loader2, CheckCircle2, Printer,
  Image as ImageIcon, Download, Maximize2, Minimize2, RotateCcw,
  AlertCircle, ExternalLink, Users, Clock, XCircle, Mail, RefreshCw,
  MessageSquare, PackageCheck,
} from "lucide-react";
import { useRoute, Link, useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { humanizeEmailMethod } from "@/lib/emailMethod";
import RefundRequestBanner from "@/components/proposal/RefundRequestBanner";
import { TableSkeleton } from "@/components/motion/Skeletons";
import ProposalDeptApprovalPanel from "@/components/proposal/ProposalDeptApprovalPanel";
import ProposalOrderSummary from "@/components/proposal/ProposalOrderSummary";
import CreatePOModal, { type CreatePOSource } from "@/components/po/CreatePOModal";

export default function ProposalDetail() {
  const [, params] = useRoute("/proposals/:id");
  const [, navigate] = useLocation();
  const proposalId = parseInt(params?.id || "0", 10);

  // tRPC queries
  const { data: proposal, isLoading, error, refetch } = trpc.proposals.getById.useQuery(
    { id: proposalId },
    { enabled: proposalId > 0 }
  );

  // Documents queries (Estimates / Invoices / POs filtered to this proposal)
  const { data: estimatesData } = trpc.estimatesInvoices.estimates.list.useQuery();
  const { data: invoicesData } = trpc.estimatesInvoices.invoices.list.useQuery();
  const { data: poData } = trpc.purchaseOrders.list.useQuery({ limit: 100, offset: 0 });

  const proposalEstimates = (estimatesData ?? []).filter(e => e.proposalId === proposalId);
  const proposalInvoices = (invoicesData ?? []).filter(i => i.proposalId === proposalId);
  const proposalPOs = (poData?.purchaseOrders ?? []).filter(p => (p as { proposalId?: number | null }).proposalId === proposalId);

  // Generate-PO-from-proposal mutation
  const previewPOMutation = trpc.purchaseOrders.previewFromProposal.useMutation({
    onSuccess: (data) => {
      if (data.previewToken) {
        navigate(`/purchase-orders/preview/${data.previewToken}`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const createEstimateMutation = trpc.estimatesInvoices.estimates.createFromProposal.useMutation({
    onSuccess: (e) => { toast.success(`Estimate ${e?.estimateNumber ?? ""} created`); refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const createInvoiceMutation = trpc.estimatesInvoices.invoices.createFromProposal.useMutation({
    onSuccess: (i) => { toast.success(`Invoice ${i?.invoiceNumber ?? ""} created`); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const fulfillProposalMut = trpc.fulfillment.markProposalFulfilled.useMutation({
    onSuccess: () => { toast.success("Proposal marked as fulfilled — confirmation email sent"); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // Send mutation
  const sendMutation = trpc.proposals.send.useMutation({
    onSuccess: (data) => {
      refetch();
      setShowSendConfirm(false);
      if (data.emailSent) {
        toast.success(`Proposal sent to ${client?.contactEmail || 'client'} via ${humanizeEmailMethod(data.emailMethod)}`);
      } else {
        toast.success('Proposal marked as sent. Email delivery may be pending.');
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Department approvals — handled inside ProposalDeptApprovalPanel

  // Virtual Proofing state
  const [showProofing, setShowProofing] = useState(false);
  const [fullscreenProof, setFullscreenProof] = useState<string | null>(null);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);

  // Order list state
  const [orderItems, setOrderItems] = useState<Array<{
    productId: number; name: string; qty: number; price: number; imageUrl: string | null; proofImageUrl: string | null;
  }>>([]);
  const [showSummary, setShowSummary] = useState(false);

  // Selected product for detail view
  const [selectedProductIndex, setSelectedProductIndex] = useState(0);

  // Create-PO modal state (opened from the Create PO action on accepted proposals)
  const [poSource, setPoSource] = useState<CreatePOSource | null>(null);

  const products = proposal?.products || [];
  const client = proposal?.client;
  const selectedProduct = products[selectedProductIndex] || null;

  // Multi-contact recipient picker for the send confirm modal. Only fetch
  // once we know the client id; default the selection to the primary
  // contact (or the first contact with a usable email) on first arrival.
  const clientIdForContacts = proposal?.clientId;
  const { data: clientContacts } = trpc.clientContacts.list.useQuery(
    { clientId: clientIdForContacts ?? 0 },
    { enabled: !!clientIdForContacts },
  );
  useEffect(() => {
    if (!clientContacts || clientContacts.length === 0) return;
    if (selectedContactIds.length > 0) return;
    const withEmail = clientContacts.filter((c) => c.email && c.email.trim().length > 0);
    if (withEmail.length === 0) return;
    const primary = withEmail.find((c) => c.isPrimary) ?? withEmail[0];
    setSelectedContactIds([primary.id]);
  }, [clientContacts, selectedContactIds.length]);

  const proofCount = products.filter((p) => p.proof?.proofImageUrl).length;
  const approvedCount = products.filter((p) => p.proof?.status === "approved").length;

  // Status badge palette (per Part 8 spec):
  // Draft=slate, Pending=amber, Sent=#654BF9, Approved=emerald, Accepted=violet
  const statusColor: Record<string, string> = {
    draft: "#64748B",       // slate
    pending: "#D97706",     // amber
    sent: "#654BF9",        // brand
    viewed: "#3B82F6",      // blue
    approved: "#10B981",    // emerald
    accepted: "#8B5CF6",    // violet
    declined: "#EF4444",
    expired: "#D97706",
    fulfilled: "#059669",   // emerald-600
  };

  const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);

  const addToList = (product: (typeof products)[number]) => {
    const existing = orderItems.find(i => i.productId === product.productId);
    if (existing) {
      setOrderItems(prev => prev.map(i => i.productId === product.productId ? { ...i, qty: i.qty + 1 } : i));
    } else {
      setOrderItems(prev => [...prev, {
        productId: product.productId,
        name: product.product?.name || "Product",
        qty: product.quantity || 1,
        price: parseFloat(product.unitPrice || product.product?.basePrice || "0"),
        imageUrl: product.proof?.proofImageUrl || product.product?.imageUrl || null,
        proofImageUrl: product.proof?.proofImageUrl || null,
      }]);
    }
    toast.success(`${product.product?.name || "Product"} added to order list`);
  };

  const addAllToList = () => {
    const items = products.map((p) => ({
      productId: p.productId,
      name: p.product?.name || "Product",
      qty: p.quantity || 1,
      price: parseFloat(p.unitPrice || p.product?.basePrice || "0"),
      imageUrl: p.proof?.proofImageUrl || p.product?.imageUrl || null,
      proofImageUrl: p.proof?.proofImageUrl || null,
    }));
    setOrderItems(items);
    toast.success(`All ${products.length} products added to order list`);
  };

  const removeItem = (idx: number) => setOrderItems(prev => prev.filter((_, i) => i !== idx));

  const handleExportPNG = async (url: string, name: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `proof-${name.replace(/\s+/g, "-").toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success("Proof exported");
    } catch {
      toast.error("Couldn't export the proof");
    }
  };

  if (proposalId === 0) {
    return (
      <DashboardLayout title="Proposal Detail">
        <div className="text-center py-20">
          <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Invalid proposal ID</p>
          <Link href="/proposals" className="text-indigo-600 text-sm mt-2 inline-block">Back to Proposals</Link>
        </div>
      </DashboardLayout>
    );
  }

  if (isLoading) {
    return (
      <DashboardLayout title="Proposal Detail">
        <div className="space-y-4">
          <TableSkeleton rows={4} columns={5} />
          <TableSkeleton rows={3} columns={4} />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !proposal) {
    return (
      <DashboardLayout title="Proposal Detail">
        <div className="text-center py-20">
          <AlertCircle className="w-12 h-12 text-red-300 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Proposal not found</p>
          <p className="text-sm text-gray-500 mt-1">{error?.message || "This proposal may have been deleted."}</p>
          <Link href="/proposals" className="text-indigo-600 text-sm mt-4 inline-block">Back to Proposals</Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Proposal Detail" subtitle={`#${proposal.id} — ${proposal.title}`}>
      {/* Fullscreen proof overlay */}
      {fullscreenProof && (
        <div className="fixed inset-0 z-[10002] bg-black/90 flex items-center justify-center" onClick={() => setFullscreenProof(null)}>
          <button onClick={() => setFullscreenProof(null)} className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white">
            <Minimize2 className="w-5 h-5" />
          </button>
          <img src={fullscreenProof} alt="Fullscreen Proof" className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/*  SEND CONFIRMATION DIALOG  */}
      {showSendConfirm && (
        <div className="fixed inset-0 z-[10002] bg-black/50 flex items-center justify-center" onClick={() => setShowSendConfirm(false)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 bg-gradient-to-r from-primary to-[#8B6FFF]">
              <h3 className="text-white text-[16px] font-bold">Send Proposal</h3>
              <p className="text-white/80 text-[12px] mt-1">This will send a branded email to the client</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="bg-[#F8F8FA] rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-[11px] font-semibold text-mt-ink-3">Proposal</span>
                  <span className="text-[11px] text-mt-ink font-medium">{proposal.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] font-semibold text-mt-ink-3">Products</span>
                  <span className="text-[11px] text-mt-ink">{products.length} items</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] font-semibold text-mt-ink-3">Proofs</span>
                  <span className="text-[11px] text-mt-ink">{proofCount} generated, {approvedCount} approved</span>
                </div>
                {proposal.estimatedValue && (
                  <div className="flex justify-between">
                    <span className="text-[11px] font-semibold text-mt-ink-3">Est. Value</span>
                    <span className="text-[11px] text-mt-ink font-bold">${parseFloat(proposal.estimatedValue).toLocaleString()}</span>
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-2">Recipients</p>
                {clientContacts && clientContacts.length > 0 ? (
                  <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                    {clientContacts.map((c) => {
                      const hasEmail = !!(c.email && c.email.trim().length > 0);
                      const checked = selectedContactIds.includes(c.id);
                      const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed";
                      return (
                        <label
                          key={c.id}
                          className={`flex items-center gap-2 p-2 rounded-md border text-[12px] ${hasEmail ? "border-[#F0F0F0] hover:bg-mt-surface cursor-pointer" : "border-transparent opacity-50 cursor-not-allowed"}`}
                        >
                          <input
                            type="checkbox"
                            disabled={!hasEmail}
                            checked={checked}
                            onChange={() => {
                              if (!hasEmail) return;
                              setSelectedContactIds((prev) =>
                                prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                              );
                            }}
                            className="accent-primary"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-mt-ink truncate">{fullName}</span>
                              {c.isPrimary && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-mt-brand-light text-primary uppercase tracking-wide">Primary</span>}
                            </div>
                            <div className="text-[11px] text-mt-ink-4 truncate">{c.email || "No email on file"}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-mt-ink-4">No contacts with email on file.</p>
                )}
              </div>
              {proofCount === 0 && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertCircle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-amber-700">No virtual proofs have been generated yet. The email will include product images without branded mockups.</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  className="flex-1 py-2.5 rounded-lg border border-mt-border text-[12px] font-medium text-mt-ink-2 hover:bg-gray-50"
                  onClick={() => setShowSendConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 py-2.5 rounded-lg bg-primary text-white text-[12px] font-bold hover:bg-[#5438E0] flex items-center justify-center gap-2 disabled:opacity-50"
                  onClick={() => sendMutation.mutate({
                    id: proposal.id,
                    origin: window.location.origin,
                    contactIds: selectedContactIds.length > 0 ? selectedContactIds : undefined,
                  })}
                  disabled={sendMutation.isPending || selectedContactIds.length === 0}
                >
                  {sendMutation.isPending ? (
                    <><Loader2 size={14} className="animate-spin" /> Sending...</>
                  ) : (
                    <><Send size={14} /> Send to {selectedContactIds.length || 0} contact{selectedContactIds.length === 1 ? "" : "s"}</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Back + Actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-5">
        <Link href="/proposals" className="flex items-center gap-2 text-[12px] font-medium text-primary hover:opacity-80 transition-opacity">
          <ArrowLeft size={13} /> Back to Proposals
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="sq-action-btn flex items-center gap-1.5 text-[11px]"
            onClick={() => setShowProofing(!showProofing)}
            style={showProofing ? { backgroundColor: '#F5F3FF', borderColor: 'var(--mt-brand)', color: 'var(--mt-brand)' } : {}}
          >
            <Sparkles size={12} /> Virtual Proofing ({proofCount}/{products.length})
          </button>
          <button
            className="sq-action-btn flex items-center gap-1.5 text-[11px]"
            onClick={() => navigate(`/virtual-proofing?proposalId=${proposal.id}&clientId=${proposal.clientId}&productIds=${products.map((p) => p.productId).join(",")}&return=proposal`)}
          >
            <ExternalLink size={12} /> Open Proofing Studio
          </button>
          <button className="sq-action-btn flex items-center gap-1.5 text-[11px]" onClick={() => navigate(`/edit-proposal/${proposalId}?preview=1`)}>
            <Eye size={12} /> Client Preview
          </button>
          <button
            className="sq-action-btn primary flex items-center gap-1.5 text-[11px]"
            onClick={() => setShowSendConfirm(true)}
            disabled={sendMutation.isPending || proposal.status === 'sent'}
          >
            {sendMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {proposal.status === 'sent' ? 'Already Sent' : 'Send to Client'}
          </button>
          {proposal.status === 'accepted' && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold text-white bg-[#059669] hover:bg-[#047857] transition-colors disabled:opacity-50"
              onClick={() => {
                if (!window.confirm("Mark this proposal as fulfilled? A confirmation email will be sent to the client.")) return;
                fulfillProposalMut.mutate({ proposalId: proposal.id });
              }}
              disabled={fulfillProposalMut.isPending}
            >
              {fulfillProposalMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <PackageCheck size={12} />}
              Mark as Fulfilled
            </button>
          )}
        </div>
      </div>

      {/*  PROPOSAL HEADER  */}
      <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-5">
        <div className="px-5 py-3 bg-[#F8F8FA] flex items-center justify-between" style={{ borderBottom: "1px solid #E5E5E5" }}>
          <div className="flex items-center gap-3">
            <h2 className="text-[14px] font-bold text-mt-ink">{proposal.title}</h2>
            <span
              className="text-[10px] font-bold px-2.5 py-1 rounded-full text-white"
              style={{ backgroundColor: statusColor[proposal.status] || "var(--mt-brand)" }}
            >
              {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
            </span>
          </div>
          {proposal.estimatedValue && (
            <span className="text-[14px] font-bold text-mt-ink">
              ${parseFloat(proposal.estimatedValue).toLocaleString()}
            </span>
          )}
        </div>
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-1.5">
          <div className="space-y-1.5">
            {client && [
              ["Company", client.companyName],
              ["Contact", client.contactName],
              ["Email", client.contactEmail],
            ].map(([label, val]) => (
              <div key={label} className="flex gap-3">
                <span className="text-[11px] font-semibold text-mt-ink w-[60px] flex-shrink-0">{label}</span>
                <span className="text-[11px] text-mt-ink-2">{val}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {[
              ["Created", proposal.createdAt ? new Date(proposal.createdAt).toLocaleDateString() : "—"],
              ["Type", proposal.proposalType || "—"],
              ["Delivery", proposal.deliveryMethod || "—"],
            ].map(([label, val]) => (
              <div key={label} className="flex gap-3">
                <span className="text-[11px] font-semibold text-mt-ink w-[60px] flex-shrink-0">{label}</span>
                <span className="text-[11px] text-mt-ink-2">{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/*  DOCUMENTS SECTION  */}
      <section className="bg-white rounded-lg overflow-hidden mb-5"
        style={{ border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
      >
        <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: "#F8F8FA", borderBottom: "1px solid #E5E7EB" }}>
          <div className="flex items-center gap-2">
            <FileText size={14} style={{ color: "#654BF9" }} />
            <h3 className="text-[13px] font-bold text-[#1A1A1A]">Documents</h3>
            <span className="text-[11px] text-gray-500">
              {proposalEstimates.length} estimate · {proposalInvoices.length} invoice · {proposalPOs.length} PO
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => createEstimateMutation.mutate({ proposalId })}
              disabled={createEstimateMutation.isPending}
              className="px-2.5 py-1 rounded-md border text-[11px] font-semibold hover:bg-[#F8F8FA] disabled:opacity-50"
              style={{ borderColor: "#E5E7EB", color: "#1A1A1A" }}
            >
              {createEstimateMutation.isPending ? "..." : "Generate Estimate"}
            </button>
            <button
              onClick={() => createInvoiceMutation.mutate({ proposalId })}
              disabled={createInvoiceMutation.isPending}
              className="px-2.5 py-1 rounded-md border text-[11px] font-semibold hover:bg-[#F8F8FA] disabled:opacity-50"
              style={{ borderColor: "#E5E7EB", color: "#1A1A1A" }}
            >
              {createInvoiceMutation.isPending ? "..." : "Generate Invoice"}
            </button>
            <button
              onClick={() => previewPOMutation.mutate({ proposalId })}
              disabled={previewPOMutation.isPending}
              className="px-2.5 py-1 rounded-md text-[11px] font-bold text-white flex items-center gap-1 disabled:opacity-50"
              style={{ backgroundColor: "#654BF9" }}
            >
              {previewPOMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              Generate POs
            </button>
            {proposal?.status === "accepted" && (
              <button
                onClick={() =>
                  setPoSource({
                    kind: "proposal",
                    proposalIds: [proposalId],
                    label: `Proposal ${proposal.title || `#${proposalId}`}`,
                  })
                }
                className="px-2.5 py-1 rounded-md border text-[11px] font-semibold hover:bg-[#F8F8FA]"
                style={{ borderColor: "#654BF9", color: "#654BF9" }}
              >
                Create PO
              </button>
            )}
          </div>
        </div>

        <CreatePOModal
          open={poSource !== null}
          onClose={() => setPoSource(null)}
          source={poSource}
        />
        <div className="divide-y" style={{ borderColor: "#E5E7EB" }}>
          {proposalEstimates.length === 0 && proposalInvoices.length === 0 && proposalPOs.length === 0 && (
            <div className="px-5 py-6 text-center text-[12px] text-gray-500">
              No documents yet. Use the buttons above to generate an estimate, invoice, or AI-powered purchase orders.
            </div>
          )}
          {proposalEstimates.map(e => (
            <Link
              key={`est-${e.id}`}
              href={`/estimates/${e.id}`}
              className="px-5 py-2.5 flex items-center justify-between hover:bg-[#F8F8FA]"
            >
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 w-16">Estimate</span>
                <span className="text-[12px] font-medium text-[#1A1A1A]">{e.estimateNumber}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                  backgroundColor: e.status === "accepted" ? "#ECFDF5" : "#F1F5F9",
                  color: e.status === "accepted" ? "#047857" : "#475569",
                }}>{e.status}</span>
              </div>
              <span className="text-[12px] text-gray-500">${parseFloat(e.total).toFixed(2)}</span>
            </Link>
          ))}
          {proposalInvoices.map(i => (
            <Link
              key={`inv-${i.id}`}
              href={`/invoices/${i.id}`}
              className="px-5 py-2.5 flex items-center justify-between hover:bg-[#F8F8FA]"
            >
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 w-16">Invoice</span>
                <span className="text-[12px] font-medium text-[#1A1A1A]">{i.invoiceNumber}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                  backgroundColor: i.status === "paid" ? "#ECFDF5" : "#F1F5F9",
                  color: i.status === "paid" ? "#047857" : "#475569",
                }}>{i.status}</span>
              </div>
              <span className="text-[12px] text-gray-500">${parseFloat(i.total).toFixed(2)}</span>
            </Link>
          ))}
          {proposalPOs.map(p => (
            <Link
              key={`po-${p.id}`}
              href={`/purchase-orders/${p.id}`}
              className="px-5 py-2.5 flex items-center justify-between hover:bg-[#F8F8FA]"
            >
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 w-16">PO</span>
                <span className="text-[12px] font-medium text-[#1A1A1A]">{p.poNumber}</span>
                <span className="text-[11px] text-gray-500">{p.supplierName}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                  backgroundColor: p.status === "received" ? "#ECFDF5" : "#F1F5F9",
                  color: p.status === "received" ? "#047857" : "#475569",
                }}>{p.status}</span>
              </div>
              <span className="text-[12px] text-gray-500">${parseFloat(p.total).toFixed(2)}</span>
            </Link>
          ))}
        </div>
      </section>

      {/*  REFUND REQUEST BANNER (if any pending request)  */}
      <RefundRequestBanner
        proposalId={proposalId}
        proposalTitle={proposal.title}
        estimatedValue={proposal.estimatedValue}
      />

      {/*  VIRTUAL PROOFING PANEL  */}
      {showProofing && (
        <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-5">
          <div className="px-5 py-3 bg-mt-brand-light flex items-center justify-between" style={{ borderBottom: '1px solid #E5E5E5' }}>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-primary" />
              <h3 className="text-[13px] font-bold text-primary">Virtual Proofs</h3>
              <span className="text-[11px] text-primary/70 ml-2">
                {approvedCount} approved · {proofCount} generated · {products.length} total
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/virtual-proofing?proposalId=${proposal.id}&clientId=${proposal.clientId}&productIds=${products.map((p) => p.productId).join(",")}&return=proposal`)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded text-white"
                style={{ backgroundColor: 'var(--mt-brand)' }}
              >
                <Sparkles size={10} className="inline mr-1" /> Generate / Edit Proofs
              </button>
              <button onClick={() => setShowProofing(false)} className="p-1 hover:bg-white/50 rounded">
                <X size={12} className="text-primary" />
              </button>
            </div>
          </div>
          <div className="p-5">
            {proofCount === 0 ? (
              <div className="text-center py-8">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-mt-brand-light flex items-center justify-center">
                  <Sparkles size={24} className="text-primary" />
                </div>
                <h4 className="text-[14px] font-bold text-mt-ink mb-1">No Proofs Yet</h4>
                <p className="text-[12px] text-mt-ink-3 mb-4 max-w-sm mx-auto">
                  Open the Virtual Proofing Studio to generate AI-powered branded mockups for the {products.length} products in this proposal.
                </p>
                <button
                  onClick={() => navigate(`/virtual-proofing?proposalId=${proposal.id}&clientId=${proposal.clientId}&productIds=${products.map((p) => p.productId).join(",")}&return=proposal`)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold text-white"
                  style={{ backgroundColor: 'var(--mt-brand)' }}
                >
                  <Sparkles size={13} /> Open Proofing Studio
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {products.map((item, idx) => {
                  const proof = item.proof;
                  const product = item.product;
                  return (
                    <div key={idx} className={`border rounded-lg overflow-hidden ${
                      proof?.status === "approved" ? "border-green-300 bg-green-50/30" :
                      proof?.proofImageUrl ? "border-blue-200 bg-blue-50/20" :
                      "border-gray-200"
                    }`}>
                      <div className="relative h-28 bg-gray-50 flex items-center justify-center group">
                        {proof?.proofImageUrl ? (
                          <>
                            <img src={proof.proofImageUrl} alt={product?.name} className="h-full w-full object-contain p-2" />
                            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-full px-1.5 py-0.5 shadow opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => setFullscreenProof(proof.proofImageUrl)} className="p-0.5 hover:bg-gray-100 rounded-full">
                                <Maximize2 className="w-3 h-3 text-gray-600" />
                              </button>
                              <button onClick={() => handleExportPNG(proof.proofImageUrl!, product?.name || "proof")} className="p-0.5 hover:bg-gray-100 rounded-full">
                                <Download className="w-3 h-3 text-gray-600" />
                              </button>
                            </div>
                          </>
                        ) : product?.imageUrl ? (
                          <img src={product.imageUrl} alt={product?.name} className="h-full w-full object-contain p-3 opacity-50" />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-gray-300" />
                        )}
                        {proof?.status && (
                          <div className="absolute top-1 right-1">
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${
                              proof.status === "approved" ? "bg-green-100 text-green-700" :
                              proof.status === "ready" ? "bg-blue-100 text-blue-700" :
                              "bg-gray-100 text-gray-600"
                            }`}>
                              {proof.status === "approved" ? "Approved" : proof.status === "ready" ? "Ready" : proof.status}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-[10px] font-semibold text-mt-ink truncate">{product?.name || "Product"}</p>
                        {proof?.decorationMethod && (
                          <p className="text-[8px] text-gray-500 mt-0.5">{proof.decorationMethod.replace("_", " ")}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/*  DEPARTMENT APPROVAL TRACKING  */}
      {proposal.multiDepartment && (
        <ProposalDeptApprovalPanel proposalId={proposalId} />
      )}

      {/*  FULFILLMENT REQUEST STATUS  */}
      {proposal.fulfillmentRequestedAt && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={20} className="text-green-600" />
            </div>
            <div className="flex-1">
              <h4 className="text-[13px] font-bold text-green-800">Fulfillment Requested by Client</h4>
              <p className="text-[11px] text-green-600 mt-0.5">
                The client has approved this proposal and requested fulfillment on{" "}
                {new Date(proposal.fulfillmentRequestedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex-shrink-0">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-[11px] font-bold">
                <ShoppingCart size={12} /> Ready to Fulfill
              </span>
            </div>
          </div>
        </div>
      )}

      {/*
       *  CLIENT ACCEPTANCE COMMENT
       *  Shown only when the POC left a comment while accepting (distinct
       *  from the system fulfillment log in `notes`).
       */}
      {proposal.acceptanceComment && (
        <div className="bg-white border border-mt-border rounded-lg p-4 mb-5">
          <div className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: "rgba(101,75,249,0.10)", color: "var(--mt-brand)" }}
            >
              <MessageSquare size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[13px] font-bold text-mt-ink">Client Acceptance Comment</h4>
              <p className="text-[11px] text-mt-ink-3 mt-0.5">
                Left by the client when approving this proposal.
              </p>
              <p className="text-[13px] text-mt-ink mt-2 whitespace-pre-wrap break-words">
                {proposal.acceptanceComment}
              </p>
            </div>
          </div>
        </div>
      )}

      {/*  ADD ALL BUTTON  */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-5">
        <p className="text-[13px] font-semibold text-mt-ink">{products.length} Products in Proposal</p>
        <button className="sq-action-btn primary flex items-center gap-1.5 text-[11px]" onClick={addAllToList}>
          Add all to list
        </button>
      </div>

      {/*  PRODUCT DETAIL SECTION  */}
      {selectedProduct && (
        <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-5">
          <div className="p-5">
            <span className="inline-block text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 mb-3 border border-mt-border text-mt-ink-3">
              {selectedProduct.product?.category || "Product"}
            </span>

            <div className="flex flex-col sm:flex-row gap-6">
              {/* Left: Product image — show proof if available */}
              <div className="w-full sm:w-[42%] flex-shrink-0">
                <div className="w-full aspect-square bg-[#F8F8FA] rounded-lg flex items-center justify-center p-4 relative group">
                  {selectedProduct.proof?.proofImageUrl ? (
                    <>
                      <img src={selectedProduct.proof.proofImageUrl} alt={selectedProduct.product?.name} className="max-h-full max-w-full object-contain" />
                      <div className="absolute top-2 right-2">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                          selectedProduct.proof.status === "approved" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {selectedProduct.proof.status === "approved" ? "✓ Approved Proof" : "AI Proof"}
                        </span>
                      </div>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-full px-2 py-1 shadow opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setFullscreenProof(selectedProduct.proof!.proofImageUrl!)} className="p-1 hover:bg-gray-100 rounded-full">
                          <Maximize2 className="w-3.5 h-3.5 text-gray-600" />
                        </button>
                        <button onClick={() => handleExportPNG(selectedProduct.proof!.proofImageUrl!, selectedProduct.product?.name || "proof")} className="p-1 hover:bg-gray-100 rounded-full">
                          <Download className="w-3.5 h-3.5 text-gray-600" />
                        </button>
                      </div>
                    </>
                  ) : selectedProduct.product?.imageUrl ? (
                    <img src={selectedProduct.product.imageUrl} alt={selectedProduct.product?.name} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImageIcon className="w-16 h-16 text-gray-300" />
                  )}
                </div>
                {/* Thumbnails: original + proof */}
                <div className="flex gap-1.5 mt-2">
                  {selectedProduct.product?.imageUrl && (
                    <div className="w-14 h-14 rounded flex items-center justify-center p-1.5 border border-mt-border bg-mt-surface cursor-pointer hover:border-indigo-400">
                      <img src={selectedProduct.product.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
                    </div>
                  )}
                  {selectedProduct.proof?.proofImageUrl && (
                    <div className="w-14 h-14 rounded flex items-center justify-center p-1.5 border-2 border-primary bg-mt-brand-light cursor-pointer">
                      <img src={selectedProduct.proof.proofImageUrl} alt="" className="max-h-full max-w-full object-contain" />
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Product details */}
              <div className="flex-1 min-w-0">
                <h2 className="text-[18px] font-bold text-mt-ink mb-0.5">{selectedProduct.product?.name || "Product"}</h2>
                <p className="text-[18px] font-bold text-mt-ink mb-4">
                  ${parseFloat(selectedProduct.unitPrice || selectedProduct.product?.basePrice || "0").toFixed(2)}
                </p>

                {/* Quantity */}
                <div className="mb-4">
                  <label className="text-[10px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1 block">Quantity</label>
                  <p className="text-[14px] font-semibold text-mt-ink">{selectedProduct.quantity || 1} units</p>
                </div>

                {/* Decoration info */}
                {selectedProduct.proof && (
                  <div className="mb-4 p-3 bg-mt-brand-light rounded-lg border border-primary/20">
                    <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Decoration</p>
                    <p className="text-[12px] font-medium text-mt-ink">
                      {selectedProduct.proof.decorationMethod?.replace("_", " ")} — {selectedProduct.proof.decorationZone}
                    </p>
                    {selectedProduct.proof.status === "approved" && (
                      <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 size={10} /> Approved
                        {selectedProduct.proof.approvedAt && ` on ${new Date(selectedProduct.proof.approvedAt).toLocaleDateString()}`}
                      </p>
                    )}
                  </div>
                )}

                {/* Description */}
                {selectedProduct.product?.description && (
                  <div className="mb-4">
                    <label className="text-[10px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1 block">Description</label>
                    <p className="text-[11px] text-mt-ink-2 leading-relaxed">{selectedProduct.product.description}</p>
                  </div>
                )}

                {/* Add to list */}
                <button
                  className="h-9 px-5 bg-[#1A1A1A] text-white text-[11px] font-semibold rounded-md hover:bg-[#333] transition-colors"
                  onClick={() => addToList(selectedProduct)}
                >
                  Add to list
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*  ALL PRODUCTS CAROUSEL  */}
      <div className="mb-5">
        <h3 className="text-[14px] font-bold text-mt-ink mb-3">All Products</h3>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin" }}>
          {products.map((item, idx) => {
            const isSelected = idx === selectedProductIndex;
            const isInOrder = orderItems.some(i => i.productId === item.productId);
            const hasProof = !!item.proof?.proofImageUrl;
            return (
              <div key={idx}
                className={`flex-shrink-0 w-[140px] cursor-pointer rounded-lg border overflow-hidden transition-all hover:shadow-md ${
                  isSelected ? "border-primary ring-1 ring-primary" : "border-mt-border"
                }`}
                onClick={() => setSelectedProductIndex(idx)}
              >
                <div className="relative h-[100px] bg-[#F8F8FA] flex items-center justify-center p-2.5">
                  {isInOrder && (
                    <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-[#16A34A] flex items-center justify-center">
                      <Check size={9} color="#FFF" />
                    </div>
                  )}
                  {hasProof && (
                    <div className="absolute top-1.5 right-1.5">
                      <Sparkles size={10} className="text-primary" />
                    </div>
                  )}
                  <img
                    src={item.proof?.proofImageUrl || item.product?.imageUrl || ""}
                    alt={item.product?.name}
                    className="max-h-full max-w-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="p-2">
                  <p className="text-[8px] text-mt-ink-4 uppercase tracking-wider mb-0.5">{item.product?.category || ""}</p>
                  <p className="text-[10px] font-semibold text-mt-ink truncate">{item.product?.name || "Product"}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] font-bold text-mt-ink">
                      ${parseFloat(item.unitPrice || item.product?.basePrice || "0").toFixed(2)}
                    </span>
                    <button
                      className="w-4.5 h-4.5 rounded flex items-center justify-center bg-primary hover:bg-primary/90 transition-colors p-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        addToList(item);
                      }}
                    >
                      <Plus size={9} color="#FFF" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/*  ORDER LIST SUMMARY + FLOATING TAB + SLIDE-OUT PANEL  */}
      <ProposalOrderSummary
        orderItems={orderItems}
        subtotal={subtotal}
        showSummary={showSummary}
        onShowSummary={setShowSummary}
        onRemoveItem={removeItem}
      />

      {/*  READY TO PLACE ORDER CTA  */}
      <div className="text-center py-8">
        <h2 className="text-[24px] font-bold text-mt-ink mb-1">
          Ready to <span className="font-black">PLACE ORDER?</span>
        </h2>
        <button
          className="mt-3 px-7 py-2.5 border-2 border-[#1A1A1A] text-[12px] font-bold text-mt-ink rounded-full hover:bg-[#1A1A1A] hover:text-white transition-all inline-flex items-center gap-2"
          onClick={() => toast.success("Order submitted")}
        >
          Submit <span className="text-base">→</span>
        </button>
      </div>
    </DashboardLayout>
  );
}
