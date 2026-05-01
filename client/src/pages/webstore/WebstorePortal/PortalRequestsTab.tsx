/**
 * PortalRequestsTab — Custom order requests review for POC portal.
 */

import React, { useState } from "react";
import { ClipboardList, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface PortalRequestsTabProps {
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  storeSlug: string;
}

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending", color: "#F59E0B" },
  { value: "reviewed", label: "Reviewed", color: "#3B82F6" },
  { value: "approved", label: "Approved", color: "#22C55E" },
  { value: "declined", label: "Declined", color: "#EF4444" },
  { value: "fulfilled", label: "Fulfilled", color: "#8B5CF6" },
];

export function PortalRequestsTab({
  isDark, fg, mutedFg, borderColor, cardBg, storeSlug,
}: PortalRequestsTabProps) {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");

  const { data: requests, isLoading } = trpc.storePortal.customRequests.list.useQuery(
    { storeSlug, status: statusFilter || undefined },
    { enabled: !!storeSlug },
  );

  const updateMut = trpc.storePortal.customRequests.updateStatus.useMutation({
    onSuccess: () => {
      utils.storePortal.customRequests.list.invalidate();
      utils.storePortal.customRequests.pendingCount.invalidate();
      setExpandedId(null);
      toast.success("Request updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleUpdate = (requestId: number) => {
    if (!editStatus) {
      toast.error("Please select a status");
      return;
    }
    updateMut.mutate({
      storeSlug,
      requestId,
      status: editStatus as "pending" | "reviewed" | "approved" | "declined" | "fulfilled",
      pocNotes: editNotes || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin" style={{ color: mutedFg }} />
        <span className="ml-3 text-[13px]" style={{ color: mutedFg }}>Loading requests...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Filter */}
      <div className="flex gap-3 mb-4">
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg text-[13px] outline-none appearance-none pr-8"
            style={{
              backgroundColor: cardBg,
              border: `1px solid ${borderColor}`,
              color: fg,
            }}
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: mutedFg }} />
        </div>
      </div>

      {/* Empty state */}
      {!requests || requests.length === 0 ? (
        <div
          className="text-center py-16 rounded-lg"
          style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
        >
          <ClipboardList size={32} className="mx-auto mb-3" style={{ color: mutedFg }} />
          <p className="text-[14px] font-semibold mb-1" style={{ color: fg }}>No custom order requests yet</p>
          <p className="text-[12px]" style={{ color: mutedFg }}>
            Custom requests from employees will appear here.
          </p>
        </div>
      ) : (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: `1px solid ${borderColor}` }}
        >
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: cardBg, borderBottom: `1px solid ${borderColor}` }}>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: mutedFg }}>Date</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: mutedFg }}>Employee</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: mutedFg }}>Title</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: mutedFg }}>Qty</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: mutedFg }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const statusOpt = STATUS_OPTIONS.find((s) => s.value === r.status);
                const isExpanded = expandedId === r.id;

                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className="cursor-pointer transition-colors"
                      style={{ borderBottom: `1px solid ${borderColor}` }}
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedId(null);
                        } else {
                          setExpandedId(r.id);
                          setEditStatus(r.status);
                          setEditNotes(r.pocNotes ?? "");
                        }
                      }}
                    >
                      <td className="px-4 py-3 text-[12px]" style={{ color: mutedFg }}>
                        {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-[12px] font-semibold" style={{ color: fg }}>{r.employeeName ?? "—"}</div>
                        <div className="text-[11px]" style={{ color: mutedFg }}>{r.employeeEmail ?? ""}</div>
                      </td>
                      <td className="px-4 py-3 text-[13px] font-medium" style={{ color: fg }}>{r.title}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: mutedFg }}>{r.quantity ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded-full"
                          style={{
                            backgroundColor: `${statusOpt?.color ?? mutedFg}15`,
                            color: statusOpt?.color ?? mutedFg,
                          }}
                        >
                          {statusOpt?.label ?? r.status}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} className="px-4 py-4" style={{ backgroundColor: cardBg, borderBottom: `1px solid ${borderColor}` }}>
                          <div className="space-y-3">
                            {/* Description */}
                            <div>
                              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: mutedFg }}>Description</label>
                              <p className="text-[13px]" style={{ color: fg }}>{r.description}</p>
                            </div>

                            {r.targetDate && (
                              <div>
                                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: mutedFg }}>Target Date</label>
                                <p className="text-[13px]" style={{ color: fg }}>{new Date(r.targetDate).toLocaleDateString()}</p>
                              </div>
                            )}

                            {/* Status update */}
                            <div className="pt-2" style={{ borderTop: `1px solid ${borderColor}` }}>
                              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>Update Status</label>
                              <div className="flex gap-2 flex-wrap mb-3">
                                {STATUS_OPTIONS.map((s) => (
                                  <button
                                    key={s.value}
                                    onClick={(e) => { e.stopPropagation(); setEditStatus(s.value); }}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                                    style={{
                                      backgroundColor: editStatus === s.value ? `${s.color}20` : "transparent",
                                      border: `1.5px solid ${editStatus === s.value ? s.color : borderColor}`,
                                      color: editStatus === s.value ? s.color : mutedFg,
                                    }}
                                  >
                                    {s.label}
                                  </button>
                                ))}
                              </div>

                              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>Notes</label>
                              <textarea
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="Add a response or notes..."
                                rows={2}
                                className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none border transition-colors"
                                style={{
                                  backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF",
                                  borderColor,
                                  color: fg,
                                }}
                              />

                              <button
                                onClick={(e) => { e.stopPropagation(); handleUpdate(r.id); }}
                                disabled={updateMut.isPending}
                                className="mt-2 px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
                                style={{ backgroundColor: "var(--mt-brand)" }}
                              >
                                {updateMut.isPending ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
