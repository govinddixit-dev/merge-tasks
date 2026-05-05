/**
 * Department Approval Page — unique per department.
 * Department contacts access this page from the approval email link.
 * Shows proposal summary, product list, and approve/reject actions.
 * NO forwarding capability — only approve/reject.
 */
import { useState, useEffect } from "react";
import { useParams } from "wouter";
import {
  Package, CheckCircle2, AlertTriangle, XCircle, Clock,
  Loader2, ShieldCheck, Users, Check, Sparkles, X
} from "lucide-react";

const LOGO_URL = "/logo_clean.png";

/** Matches the flat API response from GET /api/approve/:token */
interface ApprovalApiResponse {
  approval: {
    id: number;
    departmentName: string;
    contactName: string | null;
    contactEmail: string;
    description: string | null;
    status: string;
    approvedAt: string | null;
    approverName: string | null;
    approverNotes: string | null;
  };
  proposal: {
    title: string;
    estimatedValue: string;
    proposalType: string;
    notes: string | null;
  };
  products: Array<{
    name: string;
    category: string;
    quantity: number;
    unitPrice: string | null;
    imageUrl: string | null;
    decorationType: string | null;
  }>;
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    companyName: string;
  };
  allDepartments: Array<{
    departmentName: string;
    status: string;
    approvedAt: string | null;
  }>;
}

export default function DepartmentApproval() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<ApprovalApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approverName, setApproverName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function fetchApproval() {
      try {
        const res = await fetch(`/api/approve/${params.token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body?.expired) setExpired(true);
          throw new Error(body.error || "Approval not found");
        }
        const result: ApprovalApiResponse = await res.json();
        setData(result);
        if (result.approval.status !== "pending") {
          setSubmitted(true);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load approval");
      } finally {
        setLoading(false);
      }
    }
    if (params.token) fetchApproval();
  }, [params.token]);

  const handleSubmit = async (action: "approved" | "rejected") => {
    if (!params.token || !data) return;
    // Rejection requires a reason — mirror the server-side rule so the
    // requester has actionable feedback to rework the proposal.
    if (action === "rejected" && !notes.trim()) {
      alert("Please provide a reason for rejection so the requester knows what to change.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/approve/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          approverName: approverName.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to submit");
      setData(prev => prev ? {
        ...prev,
        approval: {
          ...prev.approval,
          status: action,
          approverName: approverName.trim() || null,
          approverNotes: notes.trim() || null,
          approvedAt: new Date().toISOString(),
        }
      } : null);
      setSubmitted(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to submit approval");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-mt-surface-2 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[14px] text-mt-ink-3">Loading approval...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    if (expired) {
      return (
        <div className="min-h-screen bg-mt-surface-2 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-10 text-center max-w-md w-full shadow-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-mt-brand-light flex items-center justify-center">
              <Clock size={32} className="text-primary" />
            </div>
            <h1 className="text-[20px] font-bold text-mt-ink mb-2">Approval Link Expired</h1>
            <p className="text-[14px] text-mt-ink-3">This approval link has expired. Please contact your distributor to resend.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-mt-surface-2 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-10 text-center max-w-md w-full shadow-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#FEF2F2] flex items-center justify-center">
            <AlertTriangle size={32} className="text-[#DC2626]" />
          </div>
          <h1 className="text-[20px] font-bold text-mt-ink mb-2">Approval Not Found</h1>
          <p className="text-[14px] text-mt-ink-3">{error || "This approval link may be invalid or expired."}</p>
        </div>
      </div>
    );
  }

  const { approval, proposal, products: productList, branding, allDepartments } = data;
  const primaryColor = branding.primaryColor || "var(--mt-brand)";
  const brandName = branding.companyName || "MergeTasks";
  const brandLogo = branding.logoUrl;
  const totalValue = parseFloat(proposal.estimatedValue || "0");

  return (
    <div className="min-h-screen bg-mt-surface-2">
      {/* Header Banner */}
      <div style={{ backgroundColor: primaryColor }} className="py-6 px-4 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {brandLogo ? (
              <img src={brandLogo} alt={brandName} className="h-8 object-contain" style={{ filter: "brightness(0) invert(1)" }} />
            ) : (
              <img src={LOGO_URL} alt="MergeTasks" className="h-7 object-contain" />
            )}
            <span className="text-white/60 text-[12px] hidden sm:inline">|</span>
            <span className="text-white/80 text-[13px] font-medium hidden sm:inline">Department Approval</span>
          </div>
          <div className="flex items-center gap-2 text-white/80 text-[12px]">
            <ShieldCheck size={14} />
            <span className="hidden sm:inline">Secure</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Department Info Card */}
        <div className="bg-white rounded-2xl border border-mt-border overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
                <Users size={24} style={{ color: primaryColor }} />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">Department Review Request</p>
                <h1 className="text-[20px] font-bold text-mt-ink">{approval.departmentName}</h1>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-[#F9FAFB] rounded-lg p-3">
                <p className="text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-1">Proposal</p>
                <p className="text-[14px] font-semibold text-mt-ink">{proposal.title}</p>
              </div>
              <div className="bg-[#F9FAFB] rounded-lg p-3">
                <p className="text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-1">Estimated Value</p>
                <p className="text-[22px] font-bold" style={{ color: primaryColor }}>${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
            </div>

            {approval.description && (
              <div className="bg-[#F9FAFB] rounded-lg p-3 mb-4">
                <p className="text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-1">Review Scope</p>
                <p className="text-[12px] text-mt-ink-2">{approval.description}</p>
              </div>
            )}
          </div>

          {/* Other department statuses */}
          {allDepartments.length > 1 && (
            <div className="px-6 pb-4">
              <p className="text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-2">All Department Reviews</p>
              <div className="flex flex-wrap gap-2">
                {allDepartments.map((dept, idx) => {
                  const isMe = dept.departmentName === approval.departmentName;
                  const icon = dept.status === 'approved'
                    ? <CheckCircle2 size={10} className="text-[#16A34A]" />
                    : dept.status === 'rejected'
                    ? <XCircle size={10} className="text-[#EF4444]" />
                    : <Clock size={10} className="text-[#D97706]" />;
                  return (
                    <span key={idx} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                      isMe ? 'border-primary bg-mt-brand-light text-primary' : 'border-mt-border bg-white text-mt-ink-3'
                    }`}>
                      {icon} {dept.departmentName} {isMe && "(you)"}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Products Summary */}
        <div className="bg-white rounded-2xl border border-mt-border overflow-hidden">
          <div className="p-5 border-b border-[#F0F0F0]">
            <h2 className="text-[15px] font-bold text-mt-ink flex items-center gap-2">
              <Package size={16} style={{ color: primaryColor }} /> Products ({productList.length})
            </h2>
          </div>
          <div className="divide-y divide-[#F5F5F5]">
            {productList.map((product, idx) => {
              const lineTotal = parseFloat(product.unitPrice || "0") * product.quantity;
              return (
                <div key={idx} className="flex items-center gap-4 p-4">
                  <div className="w-14 h-14 rounded-lg border border-mt-border overflow-hidden bg-[#F9FAFB] shrink-0 flex items-center justify-center">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} className="w-full h-full object-contain" />
                    ) : (
                      <Package size={20} className="text-[#D4D4D4]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-mt-ink truncate">{product.name}</p>
                    <p className="text-[10px] text-mt-ink-4">{product.category} · Qty: {product.quantity}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] font-bold text-mt-ink">${lineTotal.toFixed(2)}</p>
                    <p className="text-[10px] text-mt-ink-4">${parseFloat(product.unitPrice || "0").toFixed(2)} ea</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-4 bg-[#F9FAFB] border-t border-[#F0F0F0]">
            <div className="flex justify-between items-center">
              <span className="text-[14px] font-semibold text-mt-ink-3">Estimated Total</span>
              <span className="text-[20px] font-bold" style={{ color: primaryColor }}>${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Approval Action Section */}
        {submitted ? (
          <div className={`rounded-2xl border p-8 text-center ${
            approval.status === 'approved'
              ? 'bg-[#F0FDF4] border-[#BBF7D0]'
              : 'bg-[#FEF2F2] border-[#FECACA]'
          }`}>
            <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${
              approval.status === 'approved' ? 'bg-[#DCFCE7]' : 'bg-[#FEE2E2]'
            }`}>
              {approval.status === 'approved'
                ? <CheckCircle2 size={32} className="text-[#16A34A]" />
                : <XCircle size={32} className="text-[#EF4444]" />
              }
            </div>
            <h2 className={`text-[20px] font-bold mb-2 ${
              approval.status === 'approved' ? 'text-[#166534]' : 'text-[#991B1B]'
            }`}>
              {approval.status === 'approved' ? 'Approved' : 'Rejected'}
            </h2>
            <p className={`text-[13px] ${
              approval.status === 'approved' ? 'text-[#15803D]' : 'text-[#B91C1C]'
            }`}>
              {approval.status === 'approved'
                ? `The ${approval.departmentName} department has approved this proposal.`
                : `The ${approval.departmentName} department has rejected this proposal.`
              }
            </p>
            {approval.approverName && (
              <p className="text-[12px] text-mt-ink-3 mt-2">Reviewed by: {approval.approverName}</p>
            )}
            {approval.approverNotes && (
              <p className="text-[12px] text-mt-ink-3 mt-1">Notes: {approval.approverNotes}</p>
            )}
            {approval.approvedAt && (
              <p className="text-[11px] text-mt-ink-4 mt-2">{new Date(approval.approvedAt).toLocaleString()}</p>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-mt-border overflow-hidden">
            <div className="p-6">
              <h2 className="text-[17px] font-bold text-mt-ink mb-1">Your Review</h2>
              <p className="text-[12px] text-mt-ink-3 mb-5">
                Please review the proposal above and approve or reject it on behalf of the <strong>{approval.departmentName}</strong> department.
              </p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider block mb-1.5">Your Name (optional)</label>
                  <input
                    value={approverName}
                    onChange={(e) => setApproverName(e.target.value)}
                    className="w-full px-4 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary outline-none"
                    placeholder="e.g., John Smith"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider block mb-1.5">
                    Notes <span className="text-mt-ink-4 normal-case font-normal">(optional for approval, required if rejecting)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-4 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary outline-none resize-none"
                    rows={3}
                    placeholder="Reason for rejection, or any comments for your approval..."
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleSubmit("rejected")}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold border-2 border-[#EF4444] text-[#EF4444] hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                  Reject
                </button>
                <button
                  onClick={() => handleSubmit("approved")}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#16A34A' }}
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  Approve
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Proposal Notes */}
        {proposal.notes && (
          <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-5">
            <p className="text-[12px] font-bold text-[#92400E] uppercase tracking-wider mb-2">Proposal Notes</p>
            <p className="text-[13px] text-[#78350F] leading-relaxed">{proposal.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-[12px] text-mt-ink-4">
            &copy; {new Date().getFullYear()} {brandName}
          </p>
          <p className="text-[11px] text-[#D4D4D4] mt-1">
            Powered by MergeTasks — Enterprise Branded Merchandise Platform
          </p>
        </div>
      </div>
    </div>
  );
}
