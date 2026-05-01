/**
 * ProposalDeptApprovalPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Department approval workflow tracker for a proposal detail view.
 * Shows per-department status, progress bar, email send button, and rejection
 * notes. Fetches its own data via tRPC.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { trpc } from "@/lib/trpc";
import { Loader2, Users, Mail, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import type { DepartmentApproval } from "../../../../drizzle/schema";

interface ProposalDeptApprovalPanelProps {
  proposalId: number;
}

export default function ProposalDeptApprovalPanel({ proposalId }: ProposalDeptApprovalPanelProps) {
  // Audit fix #21: use invalidate() instead of refetch() so the query cache
  // is marked stale and any other component that reads the same query (e.g.
  // the proposal detail page header) also gets the updated data, rather than
  // only the local component re-fetching while siblings show stale state.
  const utils = trpc.useUtils();
  const deptApprovalsQuery = trpc.departmentApprovals.listByProposal.useQuery({ proposalId });
  const sendDeptEmailsMutation = trpc.departmentApprovals.sendEmails.useMutation({
    onSuccess: (data) => {
      utils.departmentApprovals.listByProposal.invalidate({ proposalId });
      import("sonner").then(({ toast }) =>
        toast.success(`Approval emails sent to ${data.sentCount} department${data.sentCount > 1 ? "s" : ""}`)
      );
    },
    onError: (err) => {
      import("sonner").then(({ toast }) => toast.error(err.message));
    },
  });

  const data: DepartmentApproval[] = deptApprovalsQuery.data ?? [];
  const approvedCount = data.filter((d) => d.status === "approved").length;

  return (
    <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-5">
      {/* Header */}
      <div
        className="px-5 py-3 bg-[#F8F8FA] flex items-center justify-between"
        style={{ borderBottom: "1px solid #E5E5E5" }}
      >
        <div className="flex items-center gap-2">
          <Users size={14} className="text-primary" />
          <h3 className="text-[13px] font-bold text-mt-ink">Department Approval Workflow</h3>
          {data.length > 0 && (
            <span className="text-[11px] text-mt-ink-3 ml-1">
              {approvedCount} of {data.length} approved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => deptApprovalsQuery.refetch()}
            className="p-1.5 hover:bg-white rounded text-mt-ink-4 hover:text-primary transition-colors"
            title="Refresh status"
          >
            <RefreshCw size={12} className={deptApprovalsQuery.isFetching ? "animate-spin" : ""} />
          </button>
          {data.some((d) => d.contactEmail && !d.emailSentAt) && (
            <button
              onClick={() =>
                sendDeptEmailsMutation.mutate({ proposalId, origin: window.location.origin })
              }
              disabled={sendDeptEmailsMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white rounded"
              style={{ backgroundColor: "var(--mt-brand)" }}
            >
              {sendDeptEmailsMutation.isPending ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Mail size={10} />
              )}
              Send Approval Emails
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-5">
        {deptApprovalsQuery.isError ? (
          <div className="flex items-center justify-center py-6 gap-2 text-red-500">
            <AlertTriangle size={16} />
            <span className="text-[12px]">Failed to load department approvals. Try refreshing.</span>
          </div>
        ) : deptApprovalsQuery.isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <span className="ml-2 text-[12px] text-mt-ink-3">Loading department statuses...</span>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-6">
            <Users size={24} className="text-[#D4D4D4] mx-auto mb-2" />
            <p className="text-[12px] text-mt-ink-3">
              Department approvals will appear here once the proposal is sent.
            </p>
            <p className="text-[11px] text-mt-ink-4 mt-1">
              Departments configured in the proposal will be created when you send it.
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {/* Progress bar */}
            {(() => {
              const total = data.length;
              const approved = data.filter((d) => d.status === "approved").length;
              const rejected = data.filter((d) => d.status === "rejected").length;
              const pct = total > 0 ? (approved / total) * 100 : 0;
              return (
                <div className="mb-4">
                  <div className="h-2 bg-[#F0F0F0] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: rejected > 0 ? "#EF4444" : "#16A34A",
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-mt-ink-4 mt-1">
                    {approved} approved{rejected > 0 ? `, ${rejected} rejected` : ""} —{" "}
                    {total - approved - rejected} pending
                  </p>
                </div>
              );
            })()}

            {/* Department rows */}
            {data.map((dept) => {
              const statusIcon =
                dept.status === "approved" ? (
                  <CheckCircle2 size={14} className="text-[#16A34A]" />
                ) : dept.status === "rejected" ? (
                  <XCircle size={14} className="text-[#EF4444]" />
                ) : (
                  <Clock size={14} className="text-[#D97706]" />
                );
              const statusLabel =
                dept.status === "approved"
                  ? "Approved"
                  : dept.status === "rejected"
                  ? "Rejected"
                  : "Pending";
              const statusColor =
                dept.status === "approved"
                  ? "#16A34A"
                  : dept.status === "rejected"
                  ? "#EF4444"
                  : "#D97706";
              return (
                <div
                  key={dept.id}
                  className="flex items-center justify-between py-3"
                  style={{ borderBottom: "1px solid #F5F5F5" }}
                >
                  <div className="flex items-center gap-3">
                    {statusIcon}
                    <div>
                      <p className="text-[12px] font-semibold text-mt-ink">{dept.departmentName}</p>
                      <p className="text-[10px] text-mt-ink-4">
                        {dept.contactName || "No contact"}
                        {dept.contactEmail ? ` · ${dept.contactEmail}` : ""}
                        {dept.addedBy === "poc" && (
                          <span className="ml-1 text-primary">(added by POC)</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {dept.emailSentAt && (
                      <span className="text-[9px] text-mt-ink-4 flex items-center gap-1">
                        <Mail size={8} /> Sent{" "}
                        {new Date(dept.emailSentAt).toLocaleDateString()}
                      </span>
                    )}
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ color: statusColor, backgroundColor: `${statusColor}15` }}
                    >
                      {statusLabel}
                    </span>
                    {dept.approvedAt && (
                      <span className="text-[9px] text-mt-ink-4">
                        {new Date(dept.approvedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Rejection notes */}
            {data.some((d) => d.status === "rejected" && d.approverNotes) && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-[10px] font-semibold text-red-700 mb-1">Rejection Notes</p>
                {data
                  .filter((d) => d.status === "rejected" && d.approverNotes)
                  .map((d) => (
                    <p key={d.id} className="text-[11px] text-red-600">
                      <strong>{d.departmentName}:</strong> {d.approverNotes}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
