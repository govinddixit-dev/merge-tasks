/**
 * PortalProposalsTab — Proposal list with expandable ProposalCard.
 *
 * Contains: ProposalsTab (list + filters) and ProposalCard (detail + actions).
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  FileText, Search, Package, Clock, CheckCircle2,
  AlertTriangle, Eye, ExternalLink, Send, ShieldCheck,
  X, Check, RotateCcw, Layers, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { StatusBadge } from "./portalHelpers";

// ── ProposalsTab ───────────────────────────────────────────────────────

interface ProposalsTabProps {
  storeSlug: string;
  pc: string;
  onNavigateToProposal?: (token: string) => void;
}

export function PortalProposalsTab({ storeSlug, pc, onNavigateToProposal }: ProposalsTabProps) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: proposals, isLoading } = trpc.storePortal.proposals.list.useQuery(
    { storeSlug, status: statusFilter || undefined },
    { retry: false }
  );

  const filtered = useMemo(() => {
    if (!proposals) return [];
    if (!search) return proposals;
    const q = search.toLowerCase();
    return proposals.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.proposalType.toLowerCase().includes(q)
    );
  }, [proposals, search]);

  if (isLoading) return <MergeTasksLoader variant="inline" message="Loading proposals..." />;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mt-ink-4" />
          <input
            type="text"
            placeholder="Search proposals..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-mt-border text-[13px] text-mt-ink placeholder:text-mt-ink-4 focus:outline-none focus:border-mt-border-2"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-mt-border text-[13px] text-mt-ink focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="viewed">Viewed</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
        </select>
      </div>

      {/* Proposal List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 border border-mt-border rounded-lg">
          <FileText size={32} className="mx-auto mb-3 text-[#D4D4D4]" />
          <p className="text-[14px] font-semibold text-mt-ink mb-1">No proposals found</p>
          <p className="text-[12px] text-mt-ink-3">Proposals sent to you will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              pc={pc}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              storeSlug={storeSlug}
              onNavigateToProposal={onNavigateToProposal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────

type ProposalListItem = {
  id: number;
  title: string;
  proposalType: string;
  status: string;
  estimatedValue: string;
  productCount: number;
  createdAt: string | null;
  sentAt: string | null;
  multiDepartment: boolean;
  fulfillmentRequestedAt: string | null;
  viewToken: string | null;
};

// ── ProposalCard ───────────────────────────────────────────────────────

function ProposalCard({ proposal: p, pc, expanded, onToggle, storeSlug, onNavigateToProposal }: {
  proposal: ProposalListItem;
  pc: string;
  expanded: boolean;
  onToggle: () => void;
  storeSlug: string;
  onNavigateToProposal?: (token: string) => void;
}) {
  // Fetch detail when expanded
  const { data: detail } = trpc.storePortal.proposals.getById.useQuery(
    { storeSlug, proposalId: p.id },
    { enabled: expanded, retry: false }
  );

  const utils = trpc.useUtils();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [fulfillmentNotes, setFulfillmentNotes] = useState("");
  const [showFulfillmentInput, setShowFulfillmentInput] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState("");
  const [showOverrideInput, setShowOverrideInput] = useState(false);
  const [showRefundInput, setShowRefundInput] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const fulfillMut = trpc.storePortal.proposals.requestFulfillment.useMutation();
  const overrideMut = trpc.storePortal.proposals.overrideFulfillment.useMutation();
  const declineMut = trpc.storePortal.proposals.decline.useMutation();
  const refundMut = trpc.storePortal.refunds.requestRefund.useMutation();

  // Refund status query
  const { data: refundStatus } = trpc.storePortal.refunds.getStatus.useQuery(
    { storeSlug, proposalId: p.id },
    { enabled: expanded && (p.status === "accepted" || p.status === "delivered" || p.status === "shipped"), retry: false }
  );

  const refreshAll = () => {
    utils.storePortal.proposals.list.invalidate();
    utils.storePortal.proposals.getById.invalidate();
    utils.storePortal.dashboard.invalidate();
    utils.storePortal.refunds.getStatus.invalidate();
  };

  const handleFulfillment = async () => {
    setActionLoading("fulfill");
    try {
      await fulfillMut.mutateAsync({ storeSlug, proposalId: p.id, pocNotes: fulfillmentNotes || undefined });
      toast.success("Fulfillment request sent to distributor");
      setShowFulfillmentInput(false);
      refreshAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the fulfillment request");
    } finally { setActionLoading(null); }
  };

  const handleOverride = async () => {
    setActionLoading("override");
    try {
      await overrideMut.mutateAsync({ storeSlug, proposalId: p.id, overrideNotes: overrideNotes || undefined });
      toast.success("Override sent — distributor notified");
      setShowOverrideInput(false);
      refreshAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the override");
    } finally { setActionLoading(null); }
  };

  const handleDecline = async () => {
    setActionLoading("decline");
    try {
      await declineMut.mutateAsync({ storeSlug, proposalId: p.id, reason: declineReason || undefined });
      toast.success("Proposal declined");
      setShowDeclineInput(false);
      refreshAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't decline the proposal");
    } finally { setActionLoading(null); }
  };

  // Determine available actions based on proposal state
  const canApprove = p.status === "sent" || p.status === "viewed";
  const canDecline = p.status !== "declined" && p.status !== "accepted";
  const hasPendingDepts = detail?.departments?.some((d) => d.status === "pending") ?? false;
  const allDeptsApproved = (detail?.departments?.length ?? 0) > 0 && (detail?.departments?.every((d) => d.status === "approved") ?? false);
  const isMultiDept = p.multiDepartment;

  return (
    <div className="border border-mt-border rounded-lg overflow-hidden">
      {/* Summary Row */}
      <div
        className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-mt-surface transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${pc}15` }}>
            <FileText size={16} style={{ color: pc }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold text-mt-ink truncate">{p.title}</p>
              {p.multiDepartment && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-mt-brand-light text-[#7C3AED]">
                  Multi-Dept
                </span>
              )}
            </div>
            <p className="text-[11px] text-mt-ink-3">
              {p.productCount} product{p.productCount !== 1 ? "s" : ""} · {formatCurrency(p.estimatedValue)} · {formatDate(p.sentAt || p.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <StatusBadge status={p.status} pc={pc} />
          {p.fulfillmentRequestedAt && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[#F0FDF4] text-[#16A34A]">
              Fulfillment Sent
            </span>
          )}
          <ChevronDown size={16} className={`text-mt-ink-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </div>

      {/* Expanded Detail */}
      {expanded && detail && (
        <div className="border-t border-mt-border px-5 py-4 bg-mt-surface">
          {/* Products */}
          <div className="mb-4">
            <h4 className="text-[12px] font-bold text-mt-ink-3 uppercase tracking-wide mb-2">Products</h4>
            <div className="space-y-2">
              {detail.products.map((prod) => (
                <div key={prod.id} className="flex items-center gap-3 bg-white rounded-lg p-3 border border-mt-border">
                  {prod.imageUrl ? (
                    <img src={prod.imageUrl} alt={prod.name} className="w-10 h-10 rounded object-contain bg-mt-surface-2" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-mt-surface-2 flex items-center justify-center">
                      <Package size={16} className="text-mt-ink-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-mt-ink truncate">{prod.name}</p>
                    <p className="text-[11px] text-mt-ink-3">
                      Qty: {prod.quantity} · {formatCurrency(prod.unitPrice)}/ea
                      {prod.decorationType ? ` · ${prod.decorationType}` : ""}
                    </p>
                  </div>
                  <p className="text-[13px] font-bold text-mt-ink">
                    {formatCurrency(parseFloat(prod.unitPrice || "0") * prod.quantity)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Department Approvals */}
          {detail.multiDepartment && detail.departments.length > 0 && (
            <div className="mb-4">
              <h4 className="text-[12px] font-bold text-mt-ink-3 uppercase tracking-wide mb-2">
                Department Approvals
                <span className="ml-2 text-[10px] font-medium normal-case" style={{ color: pc }}>
                  ({detail.approvalRouting === "sequential" ? "Sequential" : "Parallel"})
                </span>
              </h4>
              <div className="space-y-2">
                {detail.departments.map((dept) => (
                  <div key={dept.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-mt-border">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{
                        backgroundColor: dept.status === "approved" ? "#F0FDF4" : dept.status === "rejected" ? "#FEF2F2" : "#FFF7ED",
                      }}>
                        {dept.status === "approved" ? <Check size={13} className="text-[#16A34A]" /> :
                         dept.status === "rejected" ? <X size={13} className="text-[#DC2626]" /> :
                         <Clock size={13} className="text-[#EA580C]" />}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-mt-ink">{dept.departmentName}</p>
                        <p className="text-[10px] text-mt-ink-3">
                          {dept.contactName || dept.contactEmail || "No contact assigned"}
                          {dept.addedBy === "poc" ? " · Added by you" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={dept.status} pc={pc} />
                      {dept.approvedAt && (
                        <p className="text-[10px] text-mt-ink-4 mt-0.5">{formatDate(dept.approvedAt)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {detail.notes && (
            <div className="mb-4">
              <h4 className="text-[12px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Notes</h4>
              <p className="text-[13px] text-mt-ink-2 bg-white rounded-lg p-3 border border-mt-border">{detail.notes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {p.viewToken && (
                <button
                  onClick={() => onNavigateToProposal?.(p.viewToken!)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white"
                  style={{ backgroundColor: pc }}
                >
                  <Eye size={13} /> View Full Proposal
                </button>
              )}
              {p.viewToken && (
                <button
                  onClick={() => window.open(`/view/proposal/${p.viewToken}`, "_blank")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2"
                >
                  <ExternalLink size={13} /> Open in New Tab
                </button>
              )}

              {/* Approve / Send for Fulfillment */}
              {canApprove && !p.fulfillmentRequestedAt && (
                isMultiDept && !allDeptsApproved ? (
                  <button
                    onClick={() => setShowOverrideInput(!showOverrideInput)}
                    disabled={!!actionLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-60"
                  >
                    <ShieldCheck size={13} /> Override & Approve
                  </button>
                ) : (
                  <button
                    onClick={() => setShowFulfillmentInput(!showFulfillmentInput)}
                    disabled={!!actionLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-60"
                  >
                    <Send size={13} /> Approve & Send to Distributor
                  </button>
                )
              )}

              {/* Decline */}
              {canDecline && !p.fulfillmentRequestedAt && (
                <button
                  onClick={() => setShowDeclineInput(!showDeclineInput)}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#DC2626] border border-[#FCA5A5] hover:bg-[#FEF2F2] disabled:opacity-60"
                >
                  <X size={13} /> Decline
                </button>
              )}

              {/* Request Refund */}
              {(p.status === "accepted" || p.status === "delivered" || p.status === "shipped") && !refundStatus && (
                <button
                  onClick={() => setShowRefundInput(!showRefundInput)}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#D97706] border border-[#FDE68A] hover:bg-[#FFFBEB] disabled:opacity-60"
                >
                  <RotateCcw size={13} /> Request Refund
                </button>
              )}
            </div>

            {/* Fulfillment notes input */}
            {showFulfillmentInput && (
              <div className="bg-[#F0FDF4] rounded-lg p-3 border border-[#BBF7D0]">
                <p className="text-[11px] font-semibold text-[#166534] mb-2">Send for Fulfillment</p>
                <textarea
                  value={fulfillmentNotes}
                  onChange={(e) => setFulfillmentNotes(e.target.value)}
                  placeholder="Optional notes for the distributor..."
                  className="w-full px-3 py-2 rounded-lg text-[12px] border border-[#BBF7D0] bg-white text-mt-ink outline-none resize-none"
                  rows={2}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={handleFulfillment} disabled={!!actionLoading}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-60">
                    {actionLoading === "fulfill" ? "Sending..." : "Confirm & Send"}
                  </button>
                  <button onClick={() => setShowFulfillmentInput(false)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-mt-ink-3 hover:bg-mt-surface-2">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Override notes input */}
            {showOverrideInput && (
              <div className="bg-[#FFF7ED] rounded-lg p-3 border border-[#FED7AA]">
                <p className="text-[11px] font-semibold text-[#9A3412] mb-1">Override Department Approvals</p>
                <p className="text-[10px] text-[#C2410C] mb-2">
                  {hasPendingDepts ? "Some departments haven't responded yet." : ""} You're overriding and sending directly to the distributor.
                </p>
                <textarea
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  placeholder="Reason for override..."
                  className="w-full px-3 py-2 rounded-lg text-[12px] border border-[#FED7AA] bg-white text-mt-ink outline-none resize-none"
                  rows={2}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={handleOverride} disabled={!!actionLoading}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-60">
                    {actionLoading === "override" ? "Sending..." : "Override & Send"}
                  </button>
                  <button onClick={() => setShowOverrideInput(false)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-mt-ink-3 hover:bg-mt-surface-2">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Refund request status banner */}
            {refundStatus && (
              <div className={`rounded-lg p-3 border ${
                refundStatus.status === "pending" ? "bg-[#FFFBEB] border-[#FDE68A]" :
                refundStatus.status === "approved" ? "bg-[#F0FDF4] border-[#BBF7D0]" :
                "bg-[#FEF2F2] border-[#FCA5A5]"
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  {refundStatus.status === "pending" ? <Clock size={13} className="text-[#D97706]" /> :
                   refundStatus.status === "approved" ? <CheckCircle2 size={13} className="text-[#16A34A]" /> :
                   <AlertTriangle size={13} className="text-[#DC2626]" />}
                  <p className={`text-[11px] font-bold ${
                    refundStatus.status === "pending" ? "text-[#92400E]" :
                    refundStatus.status === "approved" ? "text-[#166534]" :
                    "text-[#991B1B]"
                  }`}>
                    Refund {refundStatus.status === "pending" ? "Pending" : refundStatus.status === "approved" ? "Approved" : "Denied"}
                  </p>
                </div>
                <p className="text-[11px] text-mt-ink-2">
                  {refundStatus.status === "pending" ? "Your refund request is under review by the distributor." :
                   refundStatus.status === "approved" ? "Your refund has been processed." :
                   `Request was denied${refundStatus.responseNote ? `: "${refundStatus.responseNote}"` : "."}`}
                </p>
                <p className="text-[10px] text-mt-ink-4 mt-1">
                  Submitted {formatDate(refundStatus.createdAt)}
                  {refundStatus.respondedAt ? ` · Responded ${formatDate(refundStatus.respondedAt)}` : ""}
                </p>
              </div>
            )}

            {/* Refund reason input */}
            {showRefundInput && (
              <div className="bg-[#FFFBEB] rounded-lg p-3 border border-[#FDE68A]">
                <p className="text-[11px] font-semibold text-[#92400E] mb-2">Request a Refund</p>
                <p className="text-[10px] text-[#B45309] mb-2">Your distributor will review this request and process the refund if approved.</p>
                <textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Please explain why you're requesting a refund (min 10 characters)..."
                  className="w-full px-3 py-2 rounded-lg text-[12px] border border-[#FDE68A] bg-white text-mt-ink outline-none resize-none"
                  rows={3}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={async () => {
                      setActionLoading("refund");
                      try {
                        await refundMut.mutateAsync({ storeSlug, proposalId: p.id, reason: refundReason });
                        toast.success("Refund request submitted — your distributor will review it");
                        setShowRefundInput(false);
                        setRefundReason("");
                        refreshAll();
                      } catch (err: unknown) {
                        toast.error(err instanceof Error ? err.message : "Couldn't submit the refund request");
                      } finally { setActionLoading(null); }
                    }}
                    disabled={refundReason.length < 10 || !!actionLoading}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#D97706] hover:bg-[#B45309] disabled:opacity-60"
                  >
                    {actionLoading === "refund" ? "Submitting..." : "Submit Refund Request"}
                  </button>
                  <button onClick={() => { setShowRefundInput(false); setRefundReason(""); }}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-mt-ink-3 hover:bg-mt-surface-2">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Decline reason input */}
            {showDeclineInput && (
              <div className="bg-[#FEF2F2] rounded-lg p-3 border border-[#FCA5A5]">
                <p className="text-[11px] font-semibold text-[#991B1B] mb-2">Decline Proposal</p>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Reason for declining (optional)..."
                  className="w-full px-3 py-2 rounded-lg text-[12px] border border-[#FCA5A5] bg-white text-mt-ink outline-none resize-none"
                  rows={2}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={handleDecline} disabled={!!actionLoading}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] disabled:opacity-60">
                    {actionLoading === "decline" ? "Declining..." : "Confirm Decline"}
                  </button>
                  <button onClick={() => setShowDeclineInput(false)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-mt-ink-3 hover:bg-mt-surface-2">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
