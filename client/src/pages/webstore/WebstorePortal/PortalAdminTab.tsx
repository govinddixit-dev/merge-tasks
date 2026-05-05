/**
 * PortalAdminTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin tab for WebstorePortal: pending approval queue with approve/deny
 * actions, admin override log, and a quick-actions modal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from "react";
import {
  AlertTriangle, Check, X, Package, AlertCircle, TrendingUp, RotateCcw,
  Lock, Download, Ban, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// Phase 6: wire to admin action audit log
const overrideLog: { id: string; action: string; dept: string; from?: string; to?: string; orderId?: string; employee?: string; by: string; date: string; reason: string }[] = [];

interface PortalAdminTabProps {
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  storeSlug: string;
  showOverrideModal: boolean;
  setShowOverrideModal: (v: boolean) => void;
}

export function PortalAdminTab({
  isDark, fg, mutedFg, borderColor, cardBg, storeSlug,
  showOverrideModal, setShowOverrideModal,
}: PortalAdminTabProps) {
  const utils = trpc.useUtils();
  const { data: pendingApprovals = [], isLoading } = trpc.storePortal.pendingApprovals.useQuery(
    { storeSlug },
    { enabled: !!storeSlug }
  );
  const [approvedOrders, setApprovedOrders] = useState<Set<string>>(new Set());
  const [deniedOrders, setDeniedOrders] = useState<Set<string>>(new Set());

  const approveMutation = trpc.storePortal.approveOrder.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(`Order ${vars.orderId} approved!`);
      utils.storePortal.pendingApprovals.invalidate();
    },
    onError: (err, vars) => {
      // Roll back optimistic state so the row reverts to its pending UI
      setApprovedOrders((prev) => {
        const next = new Set(prev);
        next.delete(vars.orderId);
        return next;
      });
      toast.error(err.message || `Failed to approve order ${vars.orderId}`);
    },
  });

  const denyMutation = trpc.storePortal.denyOrder.useMutation({
    onSuccess: (_res, vars) => {
      toast.error(`Order ${vars.orderId} denied`);
      utils.storePortal.pendingApprovals.invalidate();
    },
    onError: (err, vars) => {
      setDeniedOrders((prev) => {
        const next = new Set(prev);
        next.delete(vars.orderId);
        return next;
      });
      toast.error(err.message || `Failed to deny order ${vars.orderId}`);
    },
  });

  const handleApprove = (id: string) => {
    setApprovedOrders((prev) => new Set([...Array.from(prev), id]));
    approveMutation.mutate({ storeSlug, orderId: id });
  };

  const handleDeny = (id: string) => {
    setDeniedOrders((prev) => new Set([...Array.from(prev), id]));
    denyMutation.mutate({ storeSlug, orderId: id });
  };

  const pendingCount = pendingApprovals.filter(
    (o) => !approvedOrders.has(o.id) && !deniedOrders.has(o.id)
  ).length;

  const actionColors: Record<string, string> = {
    "Budget Increase": "#22C55E",
    "Order Override": "var(--mt-brand)",
    "Access Revoked": "#EF4444",
    "Category Lock": "#F59E0B",
    "Spending Freeze": "#EF4444",
  };

  return (
    <div>
      {/* Coming Soon Banner */}
      <div
        className="mb-6 p-4 rounded-xl flex items-center gap-3"
        style={{
          backgroundColor: isDark ? "rgba(251,191,36,0.08)" : "rgba(251,191,36,0.06)",
          border: `1px solid ${isDark ? "rgba(251,191,36,0.2)" : "rgba(251,191,36,0.15)"}`,
        }}
      >
        <AlertTriangle size={18} style={{ color: "#F59E0B" }} />
        <div>
          <p className="text-[13px] font-semibold" style={{ color: fg }}>
            Admin Panel — Coming Soon
          </p>
          <p className="text-[11px]" style={{ color: mutedFg }}>
            Approval workflows, override logging, and admin quick actions are under active development.
          </p>
        </div>
      </div>

      {/* Pending Approvals */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: "#F59E0B" }} />
            <h3 className="text-[16px] font-bold" style={{ color: fg }}>
              Pending Approvals
            </h3>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "#EF4444" }}
            >
              {pendingCount}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {pendingApprovals.map((order) => {
            const isApproved = approvedOrders.has(order.id);
            const isDenied = deniedOrders.has(order.id);
            const isResolved = isApproved || isDenied;

            return (
              <div
                key={order.id}
                className="p-5 rounded-xl"
                style={{
                  border: `1px solid ${
                    isResolved
                      ? isApproved
                        ? "rgba(34,197,94,0.3)"
                        : "rgba(239,68,68,0.3)"
                      : borderColor
                  }`,
                  backgroundColor: isResolved
                    ? isApproved
                      ? isDark ? "rgba(34,197,94,0.05)" : "rgba(34,197,94,0.03)"
                      : isDark ? "rgba(239,68,68,0.05)" : "rgba(239,68,68,0.03)"
                    : cardBg,
                  opacity: isResolved ? 0.7 : 1,
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="text-[12px] font-mono font-medium"
                      style={{ color: mutedFg }}
                    >
                      {order.id}
                    </span>
                    <span className="text-[14px] font-semibold" style={{ color: fg }}>
                      {order.employee}
                    </span>
                    <span
                      className="text-[11px] px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: isDark
                          ? "rgba(101,75,249,0.1)"
                          : "rgba(101,75,249,0.06)",
                        color: "var(--mt-brand)",
                      }}
                    >
                      {order.dept}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[16px] font-bold" style={{ color: fg }}>
                      {order.total}
                    </span>
                    {isResolved ? (
                      <span
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-lg"
                        style={{ color: isApproved ? "#22C55E" : "#EF4444" }}
                      >
                        {isApproved ? "Approved" : "Denied"}
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApprove(order.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                          style={{ backgroundColor: "#22C55E", color: "#FFF" }}
                        >
                          <Check size={12} /> Approve
                        </button>
                        <button
                          onClick={() => handleDeny(order.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                          style={{
                            backgroundColor: isDark ? "#2A2A32" : "#F5F5F5",
                            color: "#EF4444",
                          }}
                        >
                          <X size={12} /> Deny
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <Package size={12} style={{ color: mutedFg }} />
                    <span className="text-[12px]" style={{ color: mutedFg }}>
                      {order.items.join(", ")}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <AlertCircle size={11} style={{ color: "#F59E0B" }} />
                  <span className="text-[11px] font-medium" style={{ color: "#F59E0B" }}>
                    {order.reason}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Override Log */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold" style={{ color: fg }}>
            Admin Override Log
          </h3>
          <span className="text-[11px] font-medium" style={{ color: mutedFg }}>
            {overrideLog.length} actions
          </span>
        </div>
        <div className="rounded-lg" style={{ border: `1px solid ${borderColor}` }}>
          {overrideLog.map((entry, idx) => {
            const color = actionColors[entry.action] || mutedFg;
            return (
              <div
                key={entry.id}
                className="flex items-center gap-4 px-5 py-4"
                style={{
                  borderBottom:
                    idx < overrideLog.length - 1 ? `1px solid ${borderColor}` : "none",
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${color}15` }}
                >
                  {entry.action === "Budget Increase" && (
                    <TrendingUp size={14} style={{ color }} />
                  )}
                  {entry.action === "Order Override" && (
                    <RotateCcw size={14} style={{ color }} />
                  )}
                  {entry.action === "Access Revoked" && (
                    <Ban size={14} style={{ color }} />
                  )}
                  {entry.action === "Category Lock" && (
                    <Lock size={14} style={{ color }} />
                  )}
                  {entry.action === "Spending Freeze" && (
                    <AlertTriangle size={14} style={{ color }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold" style={{ color: fg }}>
                      {entry.action}
                    </span>
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: `${color}15`, color }}
                    >
                      {entry.dept}
                    </span>
                  </div>
                  <p className="text-[11px] mt-0.5" style={{ color: mutedFg }}>
                    {entry.reason}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] font-medium" style={{ color: mutedFg }}>
                    {entry.by}
                  </p>
                  <p className="text-[10px]" style={{ color: mutedFg }}>
                    {entry.date}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Admin Quick Actions Modal */}
      {showOverrideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          onClick={() => setShowOverrideModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl p-6 shadow-lg"
            style={{ backgroundColor: isDark ? "#1A1A20" : "#FFFFFF" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[16px] font-bold" style={{ color: fg }}>
                Admin Quick Actions
              </h3>
              <button
                onClick={() => setShowOverrideModal(false)}
                className="p-1 rounded-lg"
                style={{ backgroundColor: cardBg }}
              >
                <X size={16} style={{ color: mutedFg }} />
              </button>
            </div>
            <div
              className="p-4 rounded-xl flex items-center gap-3"
              style={{
                backgroundColor: isDark ? "rgba(251,191,36,0.08)" : "rgba(251,191,36,0.06)",
                border: `1px solid ${isDark ? "rgba(251,191,36,0.2)" : "rgba(251,191,36,0.15)"}`,
              }}
            >
              <AlertTriangle size={16} style={{ color: "#F59E0B" }} />
              <p className="text-[12px]" style={{ color: mutedFg }}>
                Quick actions are coming soon. Admin workflows are under active development.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
