/**
 * OverviewTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Overview tab for StoreManagement: KPI cards, revenue trend chart,
 * recent orders table, and AI recommendations panel.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useMemo } from "react";
import {
  DollarSign, ShoppingCart, TrendingUp, TrendingDown, Users,
  ChevronRight, Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EffectiveStore, type StoreOrder, type DbStore } from "./StoreManagementTypes";
import { StaggerGroup, StaggerItem } from "@/components/motion";

// Compute a percent-change trend from the last two buckets in a series.
// Returns null when there's no prior month to compare against (avoids
// rendering a misleading +Infinity% when the previous bucket is zero).
function computeTrend(series: number[]): { trend: string; up: boolean } | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2];
  const curr = series[series.length - 1];
  if (prev === 0) return null;
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  return { trend: `${sign}${pct.toFixed(1)}%`, up: pct >= 0 };
}

// ─── Sparkline helper ─────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 80, h = 28;
  if (data.length < 2) return <svg width={w} height={h} className="ml-auto" />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="ml-auto">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Location Budget Panel ────────────────────────────────────────────────────
// Per-location roll-up of department budgets and spend. The section is hidden
// when the store has no multi-location configuration or when the backend only
// returns unassigned departments (i.e. no real location tabs exist yet).

function LocationBudgetPanel({ storeId }: { storeId: number }) {
  const { data: locations, isLoading } = trpc.storeDepartmentBudgets.locationBreakdown.useQuery(
    { storeId },
    { enabled: !!storeId },
  );

  if (isLoading || !locations?.length) return null;
  const hasRealLocation = locations.some((l) => l.locationId !== null);
  if (!hasRealLocation) return null;

  return (
    <div className="bg-white rounded-lg border border-mt-border mt-6 p-5">
      <h3 className="text-[14px] font-bold text-mt-ink mb-4">Budget by Location</h3>
      <div className="space-y-3">
        {locations.map((loc) => {
          const totalBudget = loc.departments.reduce((sum, d) => sum + d.budgetCents, 0);
          const totalSpent = loc.departments.reduce((sum, d) => sum + d.spentCents, 0);
          const util = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
          const barColor = util >= 90 ? "#EF4444" : util >= 75 ? "#D97706" : "var(--mt-brand)";
          return (
            <div
              key={loc.locationId ?? "unassigned"}
              className="border border-mt-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-mt-ink">{loc.locationName}</span>
                <span className="text-[11px] text-mt-ink-4 data-mono">
                  ${(totalSpent / 100).toLocaleString()} / ${(totalBudget / 100).toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 w-full bg-mt-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(util, 100)}%`, backgroundColor: barColor }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-mt-ink-4">
                  {loc.departments.length} department{loc.departments.length === 1 ? "" : "s"}
                </span>
                <span className="text-[11px] font-semibold text-mt-ink-3 data-mono">{util}% used</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AI Recommendations Panel ─────────────────────────────────────────────────

function AIRecommendationsPanel({
  clientId,
  storeId,
  selectedDept,
  onSelectDept,
  expanded,
  onToggleExpanded,
}: {
  clientId?: number;
  storeId?: number;
  selectedDept?: string;
  onSelectDept: (dept: string | undefined) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { data: recsData, isLoading } = trpc.aiInsights.storeRecommendations.useQuery(
    { clientId: clientId!, storeId, department: selectedDept, limit: 6 },
    { enabled: !!clientId }
  );

  if (!clientId) {
    return (
      <div className="bg-white rounded-lg border border-mt-border mt-6 p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={14} className="text-primary" />
          <h3 className="text-[14px] font-bold text-mt-ink">AI Recommendations</h3>
        </div>
        <p className="text-[12px] text-mt-ink-4">
          Product recommendations will appear here once this store has order history.
        </p>
      </div>
    );
  }

  const departments = recsData?.activeDepartments || [];
  const clientName = recsData?.clientName || "";

  return (
    <div className="bg-white rounded-lg border border-mt-border mt-6">
      <button
        onClick={onToggleExpanded}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-mt-surface transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          <div className="text-left">
            <h3 className="text-[14px] font-bold text-mt-ink">
              AI Recommendations{clientName ? ` for ${clientName}` : ""}
            </h3>
            <p className="text-[11px] text-mt-ink-4 mt-0.5">
              Per-department product suggestions based on this client's ordering behavior
            </p>
          </div>
        </div>
        <ChevronRight
          size={14}
          className={`text-mt-ink-4 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-[#F0F0F0]">
          <div className="px-5 py-3 flex flex-wrap gap-2">
            <button
              className={`text-[11px] px-3 py-1 rounded-full border transition-colors ${
                !selectedDept
                  ? "bg-primary text-white border-primary"
                  : "text-mt-ink-3 border-mt-border hover:border-primary"
              }`}
              onClick={() => onSelectDept(undefined)}
            >
              All Departments
            </button>
            {departments.map((dept) => (
              <button
                key={dept}
                className={`text-[11px] px-3 py-1 rounded-full border transition-colors ${
                  selectedDept === dept
                    ? "bg-primary text-white border-primary"
                    : "text-mt-ink-3 border-mt-border hover:border-primary"
                }`}
                onClick={() => onSelectDept(dept)}
              >
                {dept.charAt(0).toUpperCase() + dept.slice(1)}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="px-5 py-6 text-center text-[12px] text-mt-ink-4">
              Loading recommendations...
            </div>
          ) : !recsData?.recommendations?.length ? (
            <div className="px-5 py-6 text-center text-[12px] text-mt-ink-4">
              No recommendations available yet for this client.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 px-5 pb-5">
              {recsData.recommendations.flatMap((deptRec, di) =>
                deptRec.recommendations.map((rec, i) => (
                  <div
                    key={`${di}-${i}`}
                    className="border border-mt-border rounded-lg p-3 hover:border-primary/40 transition-colors"
                  >
                    <div className="text-[13px] font-semibold text-mt-ink mb-1">{rec.productName}</div>
                    <div className="text-[11px] text-mt-ink-4 mb-2">{rec.reason}</div>
                    {deptRec.department && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-mt-brand-light text-primary">
                        {deptRec.department}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── OverviewTab ──────────────────────────────────────────────────────────────

interface OverviewTabProps {
  effectiveStore: EffectiveStore;
  effectiveOrders: StoreOrder[];
  isNumeric: boolean;
  dbStore: DbStore | null | undefined;
  numericId: number;
  selectedRecDept: string | undefined;
  setSelectedRecDept: (dept: string | undefined) => void;
  recsExpanded: boolean;
  setRecsExpanded: (v: boolean) => void;
  onViewAllOrders: () => void;
}

export function OverviewTab({
  effectiveStore,
  effectiveOrders,
  isNumeric,
  dbStore,
  numericId,
  selectedRecDept,
  setSelectedRecDept,
  recsExpanded,
  setRecsExpanded,
  onViewAllOrders,
}: OverviewTabProps) {
  // Real KPI time series — 6 months of monthly buckets. Disabled until we
  // resolve a numeric storeId (string-id stub stores never query).
  const kpiQuery = trpc.stores.kpiTimeSeries.useQuery(
    { storeId: numericId, months: 6 },
    { enabled: isNumeric && numericId > 0 },
  );

  const { gmvSpark, ordersSpark, aovSpark, gmvTrend, ordersTrend, aovTrend } = useMemo(() => {
    const series = kpiQuery.data?.months ?? [];
    const gmv = series.map(m => m.gmvCents / 100);
    const orderCount = series.map(m => m.orderCount);
    const aov = series.map(m => (m.orderCount > 0 ? m.gmvCents / 100 / m.orderCount : 0));
    return {
      gmvSpark: gmv,
      ordersSpark: orderCount,
      aovSpark: aov,
      gmvTrend: computeTrend(gmv),
      ordersTrend: computeTrend(orderCount),
      aovTrend: computeTrend(aov),
    };
  }, [kpiQuery.data]);

  type KpiCard = {
    label: string;
    value: string;
    icon: React.ReactNode;
    trend: { trend: string; up: boolean } | null;
    spark: number[];
    /** When true, render "—" trend + no sparkline + tooltip on the label. */
    noData?: boolean;
    noDataTooltip?: string;
  };

  const kpis: KpiCard[] = [
    { label: "Monthly GMV", value: effectiveStore.gmv, icon: <DollarSign size={16} />, trend: gmvTrend, spark: gmvSpark },
    { label: "Monthly Orders", value: effectiveStore.monthlyOrders.toString(), icon: <ShoppingCart size={16} />, trend: ordersTrend, spark: ordersSpark },
    { label: "Avg Order Value", value: effectiveStore.avgOrderValue, icon: <TrendingUp size={16} />, trend: aovTrend, spark: aovSpark },
    {
      label: "Conversion Rate",
      value: effectiveStore.conversionRate,
      icon: <Users size={16} />,
      trend: null,
      spark: [],
      noData: true,
      noDataTooltip: "Visit tracking not yet enabled",
    },
  ];

  return (
    <div>
      {/* KPI Cards */}
      <StaggerGroup className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi) => (
          <StaggerItem key={kpi.label}>
          <div className="bg-white rounded-lg border border-mt-border p-5">
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider"
                title={kpi.noDataTooltip}
              >
                {kpi.label}
              </span>
              <span className="w-8 h-8 rounded-lg bg-mt-brand-light flex items-center justify-center text-primary">
                {kpi.icon}
              </span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <span className="text-[24px] font-bold text-mt-ink data-mono">{kpi.value}</span>
                <div className="flex items-center gap-1 mt-1">
                  {kpi.trend ? (
                    <>
                      {kpi.trend.up
                        ? <TrendingUp size={11} className="text-[#16A34A]" />
                        : <TrendingDown size={11} className="text-[#EF4444]" />}
                      <span className={`text-[11px] font-semibold ${kpi.trend.up ? "text-[#16A34A]" : "text-[#EF4444]"}`}>
                        {kpi.trend.trend}
                      </span>
                      <span className="text-[11px] text-mt-ink-4">vs last month</span>
                    </>
                  ) : (
                    <span
                      className="text-[11px] font-semibold text-mt-ink-4"
                      title={kpi.noDataTooltip}
                    >
                      —
                    </span>
                  )}
                </div>
              </div>
              {!kpi.noData && (
                <Sparkline data={kpi.spark} color={kpi.trend?.up === false ? "#EF4444" : "#16A34A"} />
              )}
            </div>
          </div>
          </StaggerItem>
        ))}
      </StaggerGroup>

      {/* Revenue Chart + Store Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 bg-white rounded-lg border border-mt-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-bold text-mt-ink">Revenue Trend</h3>
            <span className="text-[11px] text-mt-ink-4">Last 6 months</span>
          </div>
          <div className="flex flex-col items-center justify-center h-[180px] text-center">
            <TrendingUp size={28} className="text-mt-ink-4 mb-3" />
            <p className="text-[12px] text-mt-ink-3 max-w-xs">
              Revenue trend will appear here once this store accumulates order history.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-mt-border p-5">
          <h3 className="text-[14px] font-bold text-mt-ink mb-4">Store Details</h3>
          <div className="space-y-3">
            {[
              { label: "POC", value: effectiveStore.pocName, sub: effectiveStore.pocEmail },
              { label: "Store Type", value: effectiveStore.storeType === "Both" ? "Promo + Print" : effectiveStore.storeType },
              { label: "Created", value: new Date(effectiveStore.createdDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) },
              { label: "Products", value: `${effectiveStore.totalProducts} active` },
              { label: "Duration", value: effectiveStore.durationType === "popup" ? "Pop-Up Shop" : "Permanent" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-start justify-between py-1.5"
                style={{ borderBottom: "1px solid #F5F5F5" }}
              >
                <span className="text-[11px] text-mt-ink-4 uppercase tracking-wider">{item.label}</span>
                <div className="text-right">
                  <span className="text-[13px] font-semibold text-mt-ink">{item.value}</span>
                  {item.sub && <div className="text-[11px] text-mt-ink-4">{item.sub}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg border border-mt-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-bold text-mt-ink">Recent Orders</h3>
          <button
            onClick={onViewAllOrders}
            className="text-[12px] font-semibold text-primary hover:text-[#4F3BC7] flex items-center gap-1 transition-colors"
          >
            View All <ChevronRight size={12} />
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
              {["Order ID", "Date", "Customer", "Items", "Total", "Status"].map((h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2 text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {effectiveOrders.slice(0, 5).map((order, i) => (
              <tr
                key={order.id}
                className="hover:bg-mt-surface transition-colors"
                style={{ borderBottom: i < 4 ? "1px solid #F5F5F5" : "none" }}
              >
                <td className="px-3 py-2.5 text-[12px] font-semibold text-primary">{order.id}</td>
                <td className="px-3 py-2.5 text-[12px] text-mt-ink-3">{order.date}</td>
                <td className="px-3 py-2.5 text-[12px] text-mt-ink font-medium">{order.customer}</td>
                <td className="px-3 py-2.5 text-[12px] text-mt-ink-3 data-mono">{order.items}</td>
                <td className="px-3 py-2.5 text-[12px] font-semibold text-mt-ink data-mono">{order.total}</td>
                <td className="px-3 py-2.5">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      order.status === "Delivered"
                        ? "bg-[#F0FDF4] text-[#16A34A]"
                        : order.status === "Shipped"
                        ? "bg-[#EFF6FF] text-[#3B82F6]"
                        : order.status === "Processing"
                        ? "bg-[#FEF3C7] text-[#D97706]"
                        : "bg-mt-surface-2 text-mt-ink-3"
                    }`}
                  >
                    {order.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Multi-location budget roll-up. Panel self-hides when the store has
          no configured locations; we gate on multiLocationEnabled here to
          skip the network round-trip entirely on legacy single-site stores. */}
      {isNumeric && dbStore?.multiLocationEnabled ? (
        <LocationBudgetPanel storeId={numericId} />
      ) : null}

      {/* AI Recommendations */}
      <AIRecommendationsPanel
        clientId={isNumeric && dbStore?.clientId ? dbStore.clientId : undefined}
        storeId={isNumeric ? numericId : undefined}
        selectedDept={selectedRecDept}
        onSelectDept={setSelectedRecDept}
        expanded={recsExpanded}
        onToggleExpanded={() => setRecsExpanded(!recsExpanded)}
      />
    </div>
  );
}
