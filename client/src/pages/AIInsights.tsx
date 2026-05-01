/**
 * AI Insights — Predictive Reordering & Churn/Engagement Signals
 * Portfolio-level analytics for the distributor's entire client base.
 *
 * Department-Aware Recommendations have been moved to the Store Detail page
 * where they are contextual to each specific client's webstore.
 */

import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  RefreshCw,
  AlertTriangle,
  Clock,
  TrendingDown,
  TrendingUp,
  ShieldAlert,
  ChevronRight,
  ArrowUpRight,
  Minus,
  Sparkles,
} from "lucide-react";
import { useLocation } from "wouter";
import { ListItemSkeleton } from "@/components/motion";

export default function AIInsights() {
  const [, navigate] = useLocation();

  const { data: reorderData, isLoading: reorderLoading } = trpc.aiInsights.predictiveReorders.useQuery();
  const { data: churnData, isLoading: churnLoading } = trpc.aiInsights.churnSignals.useQuery();

  return (
    <DashboardLayout title="AI Insights" subtitle="Predictive analytics across your client portfolio">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {/* Reorder Alerts */}
        <div className="bg-white rounded-lg border border-mt-border p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] text-mt-ink-4 font-medium uppercase tracking-wider">Reorder Alerts</span>
            <RefreshCw size={14} className="text-primary" />
          </div>
          {reorderLoading ? (
            <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
          ) : (
            <>
              <p className="text-[28px] font-bold text-mt-ink leading-none">
                {(reorderData?.summary.overdue ?? 0) + (reorderData?.summary.urgent ?? 0)}
              </p>
              <div className="flex items-center gap-3 mt-2">
                {(reorderData?.summary.overdue ?? 0) > 0 && (
                  <span className="text-[12px] font-medium text-[#DC2626]">
                    {reorderData?.summary.overdue} overdue
                  </span>
                )}
                {(reorderData?.summary.urgent ?? 0) > 0 && (
                  <span className="text-[12px] font-medium text-[#F59E0B]">
                    {reorderData?.summary.urgent} urgent
                  </span>
                )}
                {(reorderData?.summary.upcoming ?? 0) > 0 && (
                  <span className="text-[12px] font-medium text-[#16A34A]">
                    {reorderData?.summary.upcoming} upcoming
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Churn Risk */}
        <div className="bg-white rounded-lg border border-mt-border p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] text-mt-ink-4 font-medium uppercase tracking-wider">At-Risk Clients</span>
            <ShieldAlert size={14} className="text-[#DC2626]" />
          </div>
          {churnLoading ? (
            <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
          ) : (
            <>
              <p className="text-[28px] font-bold text-mt-ink leading-none">
                {churnData?.summary.high ?? 0}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[12px] font-medium text-[#DC2626]">
                  {churnData?.summary.high} high risk
                </span>
                <span className="text-[12px] font-medium text-[#F59E0B]">
                  {churnData?.summary.medium} medium
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/*  Predictive Reordering  */}
      <div className="bg-white rounded-lg border border-mt-border mb-8">
        <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-mt-ink">Predictive Reordering</h2>
            <p className="text-[12px] text-mt-ink-3 mt-0.5">
              Monitors order history and consumption patterns. Alerts before stockouts.
            </p>
          </div>
          <RefreshCw size={14} className="text-mt-ink-4" />
        </div>

        {reorderLoading ? (
          <div className="divide-y divide-[#F0F0F0]">
            {Array.from({ length: 5 }).map((_, i) => <ListItemSkeleton key={i} />)}
          </div>
        ) : !reorderData?.predictions.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <Sparkles size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No reorder predictions yet</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[280px]">More order history will improve accuracy — predictions appear once clients have re-ordered at least twice.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#F0F0F0]">
            {reorderData.predictions.slice(0, 10).map((pred, i) => {
              const urgencyConfig = {
                overdue: { color: "#DC2626", bg: "#FEF2F2", label: "Overdue", icon: AlertTriangle },
                urgent: { color: "#F59E0B", bg: "#FFFBEB", label: "Urgent", icon: Clock },
                upcoming: { color: 'var(--mt-brand)', bg: "#F5F3FF", label: "Upcoming", icon: ArrowUpRight },
                normal: { color: "#16A34A", bg: "#F0FDF4", label: "On Track", icon: Minus },
              };
              const config = urgencyConfig[pred.urgency];
              const UrgencyIcon = config.icon;

              return (
                <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-mt-surface transition-colors">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: config.bg }}
                  >
                    <UrgencyIcon size={14} style={{ color: config.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-mt-ink">
                      {pred.clientName} — {pred.productName}
                    </p>
                    <p className="text-[12px] text-mt-ink-3 mt-0.5">
                      {pred.urgency === "overdue"
                        ? `${Math.abs(pred.daysUntilReorder)} days overdue`
                        : `Reorder in ${pred.daysUntilReorder} days`}
                      {" · "}Avg {pred.avgQuantityPerOrder} units every {pred.avgIntervalDays} days
                      {" · "}{pred.orderCount} past orders
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: config.color, backgroundColor: config.bg }}
                  >
                    {config.label}
                  </span>
                  <button
                    className="text-[12px] font-semibold text-primary hover:underline shrink-0 flex items-center gap-1"
                    onClick={() => navigate("/create-proposal")}
                  >
                    Reorder <ChevronRight size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/*  Churn & Engagement Signals  */}
      <div className="bg-white rounded-lg border border-mt-border mb-8">
        <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-mt-ink">Churn & Engagement Signals</h2>
            <p className="text-[12px] text-mt-ink-3 mt-0.5">
              Flags declining logins, dropping order volume, and missed reorder patterns.
            </p>
          </div>
          <ShieldAlert size={14} className="text-mt-ink-4" />
        </div>

        {churnLoading ? (
          <div className="divide-y divide-[#F0F0F0]">
            {Array.from({ length: 5 }).map((_, i) => <ListItemSkeleton key={i} />)}
          </div>
        ) : !churnData?.signals.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <Sparkles size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No churn signals detected</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[280px]">Every active client is on a healthy ordering cadence — we'll flag declining engagement here as soon as it appears.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#F0F0F0]">
            {churnData.signals.map((signal, i) => {
              const riskConfig = {
                high: { color: "#DC2626", bg: "#FEF2F2", label: "High Risk" },
                medium: { color: "#F59E0B", bg: "#FFFBEB", label: "Medium Risk" },
                low: { color: "#16A34A", bg: "#F0FDF4", label: "Low Risk" },
              };
              const config = riskConfig[signal.riskLevel];
              const TrendIcon = signal.orderTrend === "declining" ? TrendingDown : signal.orderTrend === "growing" ? TrendingUp : Minus;

              return (
                <div key={i} className="px-5 py-4 hover:bg-mt-surface transition-colors">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: config.bg }}
                    >
                      <ShieldAlert size={14} style={{ color: config.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-mt-ink">{signal.clientName}</p>
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ color: config.color, backgroundColor: config.bg }}
                        >
                          {config.label} · {signal.riskScore}
                        </span>
                      </div>
                      <p className="text-[12px] text-mt-ink-3 mt-0.5">
                        {signal.contactName} · {signal.contactEmail}
                      </p>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <div className="flex items-center gap-1 justify-end">
                        <TrendIcon size={12} className={signal.orderTrend === "declining" ? "text-[#DC2626]" : signal.orderTrend === "growing" ? "text-[#16A34A]" : "text-mt-ink-4"} />
                        <span className="text-[12px] font-medium text-mt-ink-3">
                          ${signal.totalRevenue.toLocaleString()} total
                        </span>
                      </div>
                      <p className="text-[11px] text-mt-ink-4 mt-0.5">
                        {signal.lastOrderDate
                          ? `Last order ${signal.daysSinceLastOrder}d ago`
                          : "No orders yet"}
                      </p>
                    </div>
                  </div>
                  {/* Risk signals */}
                  <div className="flex flex-wrap gap-1.5 mt-2 ml-11">
                    {signal.signals.map((s, j) => (
                      <span key={j} className="text-[11px] text-mt-ink-3 bg-mt-surface-2 px-2 py-0.5 rounded-full">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
