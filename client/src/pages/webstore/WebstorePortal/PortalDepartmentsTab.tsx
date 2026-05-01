/**
 * PortalDepartmentsTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Departments tab for WebstorePortal: aggregated budget stats and per-
 * department cards with spend progress bars, employee/order counts, and
 * per-order limits.
 *
 * Step 11/16: Replaced portalData.ts mock with real tRPC queries from
 * storePortal.budgets.list. Falls back to empty state when no data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from "react";
import { DollarSign, TrendingUp, Users, Package, Lock, Loader2, UserCheck, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface PortalDepartmentsTabProps {
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  storeSlug?: string;
  canManage: boolean;
}

export function PortalDepartmentsTab({
  isDark, fg, mutedFg, borderColor, cardBg, storeSlug, canManage,
}: PortalDepartmentsTabProps) {
  const utils = trpc.useUtils();
  // Real tRPC query — replaces static departmentRouting from portalData.ts
  const { data: departments, isLoading } = trpc.storePortal.budgets.list.useQuery(
    { storeSlug: storeSlug || "" },
    { enabled: !!storeSlug },
  );

  const [openDeptId, setOpenDeptId] = useState<number | null>(null);
  const setHeadMut = trpc.storePortal.budgets.setDepartmentHead.useMutation({
    onSuccess: () => {
      toast.success("Department head updated");
      utils.storePortal.budgets.list.invalidate({ storeSlug: storeSlug || "" });
      setOpenDeptId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const depts = departments ?? [];

  const totalBudget = depts.reduce((s, d) => s + (d.budgetCents ?? 0), 0);
  const totalSpent = depts.reduce((s, d) => s + (d.spentCents ?? 0), 0);
  const totalEmployees = depts.reduce((s, d) => s + (d.users?.length ?? 0), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin" style={{ color: mutedFg }} />
        <span className="ml-3 text-[13px]" style={{ color: mutedFg }}>Loading departments…</span>
      </div>
    );
  }

  if (depts.length === 0) {
    return (
      <div className="text-center py-20">
        <Package size={32} className="mx-auto mb-3" style={{ color: mutedFg }} />
        <p className="text-[14px] font-semibold" style={{ color: fg }}>No departments configured</p>
        <p className="text-[12px] mt-1" style={{ color: mutedFg }}>
          Ask your distributor to set up department budgets for your store.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 items-start sm:items-center justify-between mb-6">
        <div>
          <h3 className="text-[16px] font-bold" style={{ color: fg }}>
            Department Routing & Budgets
          </h3>
          <p className="text-[12px] mt-1" style={{ color: mutedFg }}>
            Manage per-department budgets, approval rules, and order limits
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{
            backgroundColor: isDark ? "rgba(34,197,94,0.1)" : "rgba(34,197,94,0.06)",
            border: "1px solid rgba(34,197,94,0.2)",
          }}
        >
          <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
          <span className="text-[11px] font-semibold" style={{ color: "#22C55E" }}>
            {depts.length} department{depts.length !== 1 ? "s" : ""} active
          </span>
        </div>
      </div>

      {/* Aggregated Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Budget", value: `$${(totalBudget / 100).toLocaleString()}`, icon: DollarSign },
          { label: "Total Spent", value: `$${(totalSpent / 100).toLocaleString()}`, icon: TrendingUp },
          { label: "Total Employees", value: String(totalEmployees), icon: Users },
          { label: "Departments", value: String(depts.length), icon: Package },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="p-4 rounded-lg"
              style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} style={{ color: "var(--mt-brand)" }} />
                <span className="text-[11px] font-medium" style={{ color: mutedFg }}>
                  {stat.label}
                </span>
              </div>
              <span className="text-[20px] font-bold" style={{ color: fg }}>
                {stat.value}
              </span>
            </div>
          );
        })}
      </div>

      {/* Department Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {depts.map((dept) => {
          const pctUsed = dept.budgetCents > 0
            ? Math.round((dept.spentCents / dept.budgetCents) * 100)
            : 0;
          const isNearLimit = pctUsed > 75;
          return (
            <div
              key={dept.id}
              className="p-5 rounded-xl"
              style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-[15px] font-bold" style={{ color: fg }}>
                    {dept.name}
                  </h4>
                  <p className="text-[11px]" style={{ color: mutedFg }}>
                    {dept.users?.length ?? 0} employee{(dept.users?.length ?? 0) !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {dept.maxPerOrderCents && dept.maxPerOrderCents > 0 && (
                    <span
                      className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded"
                      style={{
                        backgroundColor: isDark
                          ? "rgba(251,191,36,0.1)"
                          : "rgba(251,191,36,0.08)",
                        color: "#F59E0B",
                      }}
                    >
                      <Lock size={9} /> ${(dept.maxPerOrderCents / 100).toLocaleString()} cap
                    </span>
                  )}
                  <span
                    className="text-[10px] font-semibold px-2 py-1 rounded"
                    style={{
                      backgroundColor: isDark
                        ? "rgba(34,197,94,0.1)"
                        : "rgba(34,197,94,0.06)",
                      color: "#22C55E",
                    }}
                  >
                    Active
                  </span>
                </div>
              </div>

              {/* Budget Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium" style={{ color: mutedFg }}>
                    Budget: ${(dept.spentCents / 100).toLocaleString()} / ${(dept.budgetCents / 100).toLocaleString()}
                  </span>
                  <span
                    className="text-[11px] font-bold"
                    style={{ color: isNearLimit ? "#EF4444" : "var(--mt-brand)" }}
                  >
                    {pctUsed}%
                  </span>
                </div>
                <div
                  className="w-full h-2 rounded-full overflow-hidden"
                  style={{ backgroundColor: isDark ? "#2A2A32" : "#E5E5E5" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(pctUsed, 100)}%`,
                      backgroundColor: isNearLimit ? "#EF4444" : "var(--mt-brand)",
                    }}
                  />
                </div>
              </div>

              {/* Department Head */}
              <div
                className="mb-3 p-2.5 rounded-lg"
                style={{ backgroundColor: isDark ? "#16161A" : "#F8F8F8", border: `1px solid ${borderColor}` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: isDark ? "rgba(124,58,237,0.15)" : "rgba(124,58,237,0.1)" }}
                    >
                      <UserCheck size={13} style={{ color: "var(--mt-brand)" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: mutedFg }}>
                        Department Head
                      </p>
                      {dept.head ? (
                        <p className="text-[12px] font-medium truncate" style={{ color: fg }}>
                          {dept.head.name || dept.head.email}
                          {dept.head.name && (
                            <span className="ml-1.5 text-[11px] font-normal" style={{ color: mutedFg }}>
                              · {dept.head.email}
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-[12px]" style={{ color: mutedFg }}>No head assigned</p>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={() => setOpenDeptId(openDeptId === dept.id ? null : dept.id)}
                        disabled={setHeadMut.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all disabled:opacity-50"
                        style={{
                          backgroundColor: isDark ? "rgba(124,58,237,0.15)" : "rgba(124,58,237,0.1)",
                          color: "var(--mt-brand)",
                        }}
                      >
                        {setHeadMut.isPending && setHeadMut.variables?.departmentId === dept.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <ChevronDown size={11} />
                        )}
                        {dept.head ? "Change" : "Assign"}
                      </button>
                      {openDeptId === dept.id && (
                        <div
                          className="absolute right-0 top-full mt-1 min-w-[200px] rounded-lg shadow-lg z-10 py-1 max-h-64 overflow-y-auto"
                          style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
                        >
                          {(dept.users?.length ?? 0) === 0 ? (
                            <p className="px-3 py-2 text-[11px]" style={{ color: mutedFg }}>
                              No users in this department
                            </p>
                          ) : (
                            <>
                              {dept.users.map((u) => (
                                <button
                                  key={u.id}
                                  onClick={() =>
                                    setHeadMut.mutate({
                                      storeSlug: storeSlug || "",
                                      departmentId: dept.id,
                                      storeUserId: u.id,
                                    })
                                  }
                                  className="w-full text-left px-3 py-1.5 text-[12px] hover:opacity-80 transition-opacity"
                                  style={{ color: fg }}
                                >
                                  <span className="font-medium">{u.name || u.email}</span>
                                  {u.name && (
                                    <span className="ml-1 text-[10px]" style={{ color: mutedFg }}>
                                      {u.email}
                                    </span>
                                  )}
                                  {dept.head?.id === u.id && (
                                    <span className="ml-1 text-[10px]" style={{ color: "var(--mt-brand)" }}>
                                      · current
                                    </span>
                                  )}
                                </button>
                              ))}
                              {dept.head && (
                                <button
                                  onClick={() =>
                                    setHeadMut.mutate({
                                      storeSlug: storeSlug || "",
                                      departmentId: dept.id,
                                      storeUserId: null,
                                    })
                                  }
                                  className="w-full text-left px-3 py-1.5 text-[11px] border-t transition-opacity hover:opacity-80"
                                  style={{ color: "#EF4444", borderColor }}
                                >
                                  Clear assignment
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Employees", value: dept.users?.length ?? 0 },
                  { label: "Remaining", value: `$${((dept.budgetCents - dept.spentCents) / 100).toLocaleString()}` },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="text-center p-2 rounded-lg"
                    style={{ backgroundColor: isDark ? "#16161A" : "#F0F0F0" }}
                  >
                    <span
                      className="text-[14px] font-bold block"
                      style={{ color: fg }}
                    >
                      {item.value}
                    </span>
                    <span className="text-[10px]" style={{ color: mutedFg }}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
