/**
 * PortalReportsTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Reports tab for WebstorePortal: four KPI stat cards, recent orders list,
 * and top-departments spend bar chart.
 *
 * Step 12/16: Replaced portalData.ts mock with real tRPC queries from
 * storePortal.stats.overview, storePortal.stats.departmentBreakdown,
 * and storePortal.stats.recentOrders.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Package, DollarSign, Users, TrendingUp, Download, Calendar, Loader2, Search,
} from "lucide-react";
import jsPDF from "jspdf";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface PortalReportsTabProps {
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  getStatusStyle: (status: string) => { bg: string; color: string };
  storeSlug?: string;
}

export function PortalReportsTab({
  isDark, fg, mutedFg, borderColor, cardBg, getStatusStyle, storeSlug,
}: PortalReportsTabProps) {
  // Employee email filter with debounce
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [debouncedEmail, setDebouncedEmail] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedEmail(employeeEmail.trim()), 400);
    return () => clearTimeout(timerRef.current);
  }, [employeeEmail]);

  // Real tRPC queries — replaces static monthlyStats, recentOrders, topDepartments
  const { data: overview, isLoading: loadingOverview } = trpc.storePortal.stats.overview.useQuery(
    { storeSlug: storeSlug || "" },
    { enabled: !!storeSlug },
  );
  const { data: deptBreakdown, isLoading: loadingDepts } = trpc.storePortal.stats.departmentBreakdown.useQuery(
    { storeSlug: storeSlug || "" },
    { enabled: !!storeSlug },
  );
  const { data: orders, isLoading: loadingOrders } = trpc.storePortal.stats.recentOrders.useQuery(
    { storeSlug: storeSlug || "", limit: 5, employeeEmail: debouncedEmail || undefined },
    { enabled: !!storeSlug },
  );

  const isLoading = loadingOverview || loadingDepts || loadingOrders;

  // Build KPI stats from real data
  const monthlyStats = overview ? [
    { label: "Total Orders", value: String(overview.orderCount) },
    { label: "Total Spend", value: `$${(overview.totalSpendCents / 100).toLocaleString()}` },
    { label: "Active Employees", value: String(overview.employeeCount) },
    { label: "Departments", value: String(deptBreakdown?.length ?? 0) },
  ] : [];

  const recentOrders = (orders ?? []).map((o) => ({
    id: o.orderNumber || `#${o.id}`,
    total: o.total ? `$${parseFloat(o.total).toFixed(2)}` : "$0.00",
    status: o.status || "unknown",
    date: o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "",
    employeeName: o.employeeName ?? null,
    employeeEmail: o.employeeEmail ?? null,
  }));

  const topDepartments = (deptBreakdown ?? [])
    .sort((a, b) => b.spentCents - a.spentCents)
    .slice(0, 5)
    .map((d) => ({
      name: d.name,
      spend: `$${(d.spentCents / 100).toLocaleString()}`,
      employeeCount: d.employeeCount,
      pct: d.budgetCents > 0 ? Math.round((d.spentCents / d.budgetCents) * 100) : 0,
    }));

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();

    doc.setFillColor(101, 75, 249);
    doc.rect(0, 0, pw, 36, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Portal Report", 20, 22);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(
      new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      pw - 20,
      22,
      { align: "right" }
    );

    let y = 50;
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Summary", 20, y);
    y += 8;

    monthlyStats.forEach((stat) => {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 100, 100);
      doc.text(stat.label, 20, y);
      doc.setTextColor(50, 50, 50);
      doc.setFont("helvetica", "bold");
      doc.text(stat.value, 100, y);
      y += 7;
    });

    y += 6;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    doc.text("Recent Orders", 20, y);
    y += 8;

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 80);
    ["Order ID", "Total", "Status", "Date"].forEach((h, i) => {
      doc.text(h, [20, 80, 120, 160][i], y);
    });
    y += 6;

    recentOrders.forEach((order) => {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(50, 50, 50);
      doc.setFontSize(8);
      doc.text(order.id, 20, y);
      doc.text(order.total, 80, y);
      doc.text(order.status, 120, y);
      doc.text(order.date, 160, y);
      y += 6;
    });

    doc.save("PortalReport.pdf");
    toast.success("Report PDF downloaded");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin" style={{ color: mutedFg }} />
        <span className="ml-3 text-[13px]" style={{ color: mutedFg }}>Loading reports…</span>
      </div>
    );
  }

  return (
    <div>
      {/* Actions */}
      <div className="flex justify-end mb-4 gap-2">
        <button
          onClick={handleExportPDF}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold"
          style={{ border: `1px solid ${borderColor}`, color: fg }}
        >
          <Download size={13} /> Export PDF
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold opacity-50 cursor-not-allowed"
          disabled
          title="Schedule reports — coming soon"
          style={{ border: `1px solid ${borderColor}`, color: fg }}
        >
          <Calendar size={13} /> Schedule Report
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {monthlyStats.map((stat, idx) => {
          const icons = [Package, DollarSign, Users, TrendingUp];
          const StatIcon = icons[idx];
          return (
            <div
              key={stat.label}
              className="p-5 rounded-lg"
              style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{
                    backgroundColor: isDark
                      ? "rgba(101,75,249,0.12)"
                      : "rgba(101,75,249,0.06)",
                  }}
                >
                  <StatIcon size={16} style={{ color: "var(--mt-brand)" }} />
                </div>
              </div>
              <div
                className="text-[24px] font-bold tracking-tight"
                style={{ color: fg, letterSpacing: "-0.5px" }}
              >
                {stat.value}
              </div>
              <div className="text-[11px] font-medium mt-0.5" style={{ color: mutedFg }}>
                {stat.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Orders + Departments */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Recent Orders */}
        <div
          className="lg:col-span-3 rounded-lg"
          style={{ border: `1px solid ${borderColor}` }}
        >
          <div
            className="px-5 py-4 flex items-center justify-between gap-3"
            style={{ borderBottom: `1px solid ${borderColor}` }}
          >
            <h3 className="text-[14px] font-semibold" style={{ color: fg }}>
              Recent Orders
            </h3>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
              <input
                type="text"
                placeholder="Filter by employee email..."
                value={employeeEmail}
                onChange={(e) => setEmployeeEmail(e.target.value)}
                className="pl-7 pr-3 py-1.5 rounded-lg text-[12px] outline-none w-52"
                style={{ backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF", border: `1px solid ${borderColor}`, color: fg }}
              />
            </div>
          </div>
          {recentOrders.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[13px]" style={{ color: mutedFg }}>No orders yet</p>
            </div>
          ) : (
            recentOrders.map((order, idx) => {
              const statusStyle = getStatusStyle(order.status);
              return (
                <div
                  key={order.id + idx}
                  className="flex items-center justify-between px-5 py-3"
                  style={{
                    borderBottom:
                      idx < recentOrders.length - 1 ? `1px solid ${borderColor}` : "none",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <span
                        className="text-[12px] font-mono font-medium"
                        style={{ color: mutedFg }}
                      >
                        {order.id}
                      </span>
                      <span className="text-[11px] ml-2" style={{ color: mutedFg }}>
                        {order.date}
                      </span>
                      {order.employeeName && (
                        <span className="text-[11px] ml-2 font-medium" style={{ color: fg }}>
                          {order.employeeName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[13px] font-semibold" style={{ color: fg }}>
                      {order.total}
                    </span>
                    <span
                      className="text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded-full"
                      style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}
                    >
                      {order.status}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Top Departments */}
        <div
          className="lg:col-span-2 rounded-lg"
          style={{ border: `1px solid ${borderColor}` }}
        >
          <div
            className="px-5 py-4"
            style={{ borderBottom: `1px solid ${borderColor}` }}
          >
            <h3 className="text-[14px] font-semibold" style={{ color: fg }}>
              Top Departments
            </h3>
          </div>
          <div className="p-5 space-y-4">
            {topDepartments.length === 0 ? (
              <p className="text-[13px] text-center" style={{ color: mutedFg }}>No departments</p>
            ) : (
              topDepartments.map((dept) => (
                <div key={dept.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-medium" style={{ color: fg }}>
                      {dept.name}
                    </span>
                    <span className="text-[12px] font-medium" style={{ color: mutedFg }}>
                      {dept.employeeCount} employees · {dept.spend}
                    </span>
                  </div>
                  <div
                    className="w-full h-2 rounded-full overflow-hidden"
                    style={{ backgroundColor: isDark ? "#2A2A32" : "#E5E5E5" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(dept.pct, 100)}%`,
                        backgroundColor: "var(--mt-brand)",
                        opacity: 0.4 + (dept.pct / 100) * 0.6,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
