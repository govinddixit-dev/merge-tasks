import { useState } from "react";
import {
  BarChart3, TrendingUp, DollarSign, ShoppingCart, Users, Package,
  Download, Calendar, Filter, ArrowUpRight, ArrowDownRight,
  FileText, RefreshCw, ChevronDown, RotateCcw, CheckCircle2,
  XCircle, Clock, AlertTriangle, Loader2
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { StaggerGroup, StaggerItem, TabContent } from "@/components/motion";
import { MetricCardSkeleton, TableSkeleton } from "@/components/motion/Skeletons";
import { motion } from "framer-motion";

const PERIODS = ["7D", "30D", "90D", "12M", "YTD", "All"] as const;

interface MetricCardProps {
  label: string;
  value: string;
  change: string;
  positive: boolean;
  icon: React.ReactNode;
}

function MetricCard({ label, value, change, positive, icon }: MetricCardProps) {
  return (
    <div className="bg-white border border-mt-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] text-mt-ink-3 font-medium">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-mt-brand-light flex items-center justify-center text-primary">
          {icon}
        </div>
      </div>
      <div className="text-[28px] font-bold text-mt-ink tracking-tight">{value}</div>
      <div className="flex items-center gap-1 mt-1">
        {positive ? (
          <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
        )}
        <span className={`text-[12px] font-medium ${positive ? "text-emerald-500" : "text-red-500"}`}>
          {change}
        </span>
        <span className="text-[12px] text-mt-ink-4 ml-1">vs prev period</span>
      </div>
    </div>
  );
}

/* Revenue chart and Orders trend render real-time from DB stats.
   When no order data exists yet, a clean empty state is shown. */
function RevenueChart() {
  const { data: stats } = trpc.orders.stats.useQuery();
  const gmv = stats?.monthlyGmv ?? 0;
  return (
    <div className="bg-white border border-mt-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[15px] font-semibold text-mt-ink">Revenue Overview</h3>
          <p className="text-[12px] text-mt-ink-4 mt-0.5">Gross merchandise value</p>
        </div>
      </div>
      {gmv > 0 ? (
        <div className="flex items-end justify-center h-[200px]">
          <div className="text-center">
            <p className="text-[32px] font-bold text-primary">${gmv >= 1000 ? `${(gmv / 1000).toFixed(1)}K` : gmv.toFixed(0)}</p>
            <p className="text-[12px] text-mt-ink-3 mt-1">Last 30 days</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-[200px]">
          <BarChart3 size={32} className="text-[#D4D4D4] mb-3" />
          <p className="text-[13px] text-mt-ink-3">Revenue data will appear as orders come in</p>
        </div>
      )}
    </div>
  );
}

function OrdersTrend() {
  const { data: stats } = trpc.orders.stats.useQuery();
  const totalOrders = stats?.totalOrders ?? 0;
  return (
    <div className="bg-white border border-mt-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[15px] font-semibold text-mt-ink">Orders Trend</h3>
          <p className="text-[12px] text-mt-ink-4 mt-0.5">Total order volume</p>
        </div>
        {totalOrders > 0 && (
          <div className="text-right">
            <div className="text-[20px] font-bold text-mt-ink">{totalOrders.toLocaleString()}</div>
            <div className="text-[11px] text-mt-ink-3 font-medium">all time</div>
          </div>
        )}
      </div>
      {totalOrders > 0 ? (
        <div className="flex items-end justify-center h-[120px]">
          <div className="text-center">
            <p className="text-[28px] font-bold text-mt-ink">{totalOrders.toLocaleString()}</p>
            <p className="text-[12px] text-mt-ink-3 mt-1">{stats?.pendingOrders ?? 0} pending</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-[120px]">
          <TrendingUp size={32} className="text-[#D4D4D4] mb-3" />
          <p className="text-[13px] text-mt-ink-3">Order trends will appear as orders come in</p>
        </div>
      )}
    </div>
  );
}

/* Static demo data arrays removed — Reports page renders from real DB data.
   Products, clients, categories, and activity will populate as real data flows in. */

function RealTimeKPIs() {
  const { data: stats, isLoading } = trpc.orders.stats.useQuery();
  if (isLoading) {
    return (
      <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => <StaggerItem key={i}><MetricCardSkeleton /></StaggerItem>)}
      </StaggerGroup>
    );
  }
  const gmv = stats?.monthlyGmv ?? 0;
  const totalOrders = stats?.totalOrders ?? 0;
  const activeStores = stats?.activeStores ?? 0;
  const avgOrder = totalOrders > 0 ? gmv / totalOrders : 0;
  return (
    <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StaggerItem><MetricCard
        label="Total GMV"
        value={gmv > 0 ? `$${gmv >= 1000 ? `${(gmv / 1000).toFixed(1)}K` : gmv.toFixed(0)}` : '$0'}
        change={gmv > 0 ? 'Live' : 'No data yet'}
        positive={gmv > 0}
        icon={<DollarSign className="w-4 h-4" />}
      /></StaggerItem>
      <StaggerItem><MetricCard
        label="Total Orders"
        value={totalOrders.toLocaleString()}
        change={totalOrders > 0 ? 'Live' : 'No data yet'}
        positive={totalOrders > 0}
        icon={<ShoppingCart className="w-4 h-4" />}
      /></StaggerItem>
      <StaggerItem><MetricCard
        label="Active Webstores"
        value={activeStores.toString()}
        change={activeStores > 0 ? `${stats?.totalClients ?? 0} clients` : 'No stores yet'}
        positive={activeStores > 0}
        icon={<Package className="w-4 h-4" />}
      /></StaggerItem>
      <StaggerItem><MetricCard
        label="Avg. Order Value"
        value={avgOrder > 0 ? `$${avgOrder.toFixed(0)}` : '$0'}
        change={avgOrder > 0 ? 'Live' : 'No data yet'}
        positive={avgOrder > 0}
        icon={<TrendingUp className="w-4 h-4" />}
      /></StaggerItem>
    </StaggerGroup>
  );
}

export default function Reports() {
  const [period, setPeriod] = useState<typeof PERIODS[number]>("30D");
  const [activeTab, setActiveTab] = useState<"overview" | "products" | "clients" | "refunds" | "suppliers">("overview");

  return (
    <DashboardLayout title="Reports & Analytics" subtitle="Track performance across all your webstores">
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div />
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-mt-ink-3 border border-mt-border rounded-lg hover:bg-mt-surface transition-colors">
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-mt-ink-3 border border-mt-border rounded-lg hover:bg-mt-surface transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Period selector + Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-1 bg-mt-surface-2 rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                period === p
                  ? "bg-white text-mt-ink shadow-sm"
                  : "text-mt-ink-3 hover:text-mt-ink"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {(["overview", "products", "clients", "refunds", "suppliers"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-4 py-1.5 text-[13px] font-medium rounded-lg transition-all capitalize ${
                activeTab === tab
                  ? "text-white"
                  : "text-mt-ink-3 hover:bg-mt-surface-2"
              }`}
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="reportsTabs"
                  className="absolute inset-0 bg-primary rounded-lg"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative z-10">{tab}</span>
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards — real-time from DB */}
      <RealTimeKPIs />

      <TabContent tabKey={activeTab}>
      {activeTab === "overview" && (
        <>
          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <RevenueChart />
            <OrdersTrend />
          </div>

          {/* Empty state placeholder for overview — will populate with real data */}
          <div className="bg-white border border-mt-border rounded-lg p-10 text-center mb-6">
            <BarChart3 size={32} className="mx-auto mb-3 text-[#D4D4D4]" />
            <p className="text-[14px] font-semibold text-mt-ink mb-1">Analytics will populate here</p>
            <p className="text-[12px] text-mt-ink-3">As your stores generate orders, category breakdowns and activity feeds will appear automatically</p>
          </div>
        </>
      )}

      {activeTab === "products" && (
        <div className="bg-white border border-mt-border rounded-lg">
          <div className="p-5 border-b border-[#F0F0F0]">
            <h3 className="text-[15px] font-semibold text-mt-ink">Top Products</h3>
            <p className="text-[12px] text-mt-ink-4 mt-0.5">Ranked by order volume</p>
          </div>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <BarChart3 size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No product data yet</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[280px]">Product rankings will appear here as orders come in.</p>
          </div>
        </div>
      )}

      {activeTab === "refunds" && <RefundsTab />}

      {activeTab === "clients" && (
        <div className="bg-white border border-mt-border rounded-lg">
          <div className="p-5 border-b border-[#F0F0F0]">
            <h3 className="text-[15px] font-semibold text-mt-ink">Client Performance</h3>
            <p className="text-[12px] text-mt-ink-4 mt-0.5">Ranked by GMV contribution</p>
          </div>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <BarChart3 size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No client data yet</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[280px]">Client performance will appear once stores generate orders.</p>
          </div>
        </div>
      )}
      {activeTab === "suppliers" && <SuppliersTab />}
      </TabContent>
    </div>
    </DashboardLayout>
  );
}

//  Refunds Tab 

function RefundsTab() {
  // entityFilter removed — refundRequests table is proposal-only; no entity column in DB;
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "approved" | "denied">("");

  // Refund requests — the primary data source for the refunds overview.
  // Note: trpc.refunds.getHistory is entity-scoped (requires entityType + entityId),
  // so it's not suitable for an org-wide overview. listRequests gives us the full picture.
  const { data: requests, isLoading } = trpc.refunds.listRequests.useQuery({});

  // Compute summary stats from requests
  const stats = {
    total: requests?.length ?? 0,
    pending: requests?.filter(r => r.status === "pending").length ?? 0,
    approved: requests?.filter(r => r.status === "approved").length ?? 0,
    denied: requests?.filter(r => r.status === "denied").length ?? 0,
    totalValue: requests?.reduce((sum, r) => sum + parseFloat(r.proposalValue || "0"), 0) ?? 0,
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <MetricCardSkeleton key={i} />)}
        </div>
        <TableSkeleton rows={6} columns={5} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-mt-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <RotateCcw size={16} className="text-[#D97706]" />
          </div>
          <p className="text-[22px] font-bold text-mt-ink">{stats.total}</p>
          <p className="text-[12px] text-mt-ink-3">Total Requests</p>
        </div>
        <div className="bg-white border border-mt-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <Clock size={16} className="text-[#EA580C]" />
          </div>
          <p className="text-[22px] font-bold text-mt-ink">{stats.pending}</p>
          <p className="text-[12px] text-mt-ink-3">Pending Review</p>
        </div>
        <div className="bg-white border border-mt-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle2 size={16} className="text-[#16A34A]" />
          </div>
          <p className="text-[22px] font-bold text-mt-ink">{stats.approved}</p>
          <p className="text-[12px] text-mt-ink-3">Approved</p>
        </div>
        <div className="bg-white border border-mt-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <XCircle size={16} className="text-[#DC2626]" />
          </div>
          <p className="text-[22px] font-bold text-mt-ink">{stats.denied}</p>
          <p className="text-[12px] text-mt-ink-3">Denied</p>
        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-white border border-mt-border rounded-lg">
        <div className="p-5 border-b border-[#F0F0F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
          <div>
            <h3 className="text-[15px] font-semibold text-mt-ink">Refund Requests</h3>
            <p className="text-[12px] text-mt-ink-4 mt-0.5">POC-initiated refund requests across all proposals</p>
          </div>
          <div className="flex items-center gap-2">

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as "" | "pending" | "approved" | "denied")}
              className="px-3 py-1.5 rounded-lg border border-mt-border text-[12px] text-mt-ink focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
            <button
              onClick={() => {
                if (!requests || requests.length === 0) return;
                const rows = requests.map(r => ({
                  Proposal: r.proposalTitle || `#${r.proposalId}`,
                  Requester: r.pocName || "—",
                  Store: r.storeName || "—",
                  Reason: r.reason,
                  Value: parseFloat(r.proposalValue || "0").toFixed(2),
                  Status: r.status,
                  Date: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—",
                }));
                const headers = Object.keys(rows[0]);
                const csv = [headers.join(","), ...rows.map(r => headers.map(h => `"${r[h as keyof typeof r]}"`).join(","))].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `refund-requests-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-mt-border text-[12px] font-semibold text-mt-ink-2 hover:bg-mt-surface transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>

        {!requests || requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <BarChart3 size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No refund requests yet</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[280px]">Refund requests submitted by your clients' POCs will appear here for review.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-[#F0F0F0]">
                  <th className="text-left text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Proposal</th>
                  <th className="text-left text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Requester</th>
                  <th className="text-left text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Store</th>
                  <th className="text-left text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Reason</th>
                  <th className="text-right text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Value</th>
                  <th className="text-center text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="text-right text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {requests
                  .filter(r => !statusFilter || r.status === statusFilter)

                  .map((req) => (
                  <tr key={req.id} className="border-b border-[#F5F5F5] last:border-0 hover:bg-mt-surface transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-[13px] font-medium text-mt-ink">{req.proposalTitle || `Proposal #${req.proposalId}`}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div>
                        <span className="text-[13px] text-mt-ink-2">{req.pocName || "—"}</span>
                        {req.pocEmail && <p className="text-[10px] text-mt-ink-4">{req.pocEmail}</p>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-[13px] text-mt-ink-2">{req.storeName || "—"}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-[12px] text-mt-ink-3 line-clamp-2 max-w-[200px]">{req.reason}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[13px] font-semibold text-mt-ink">
                        ${parseFloat(req.proposalValue || "0").toLocaleString()}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                        req.status === "pending" ? "bg-amber-50 text-amber-600" :
                        req.status === "approved" ? "bg-emerald-50 text-emerald-600" :
                        "bg-red-50 text-red-600"
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[12px] text-mt-ink-3">
                        {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Suppliers & Margins Tab ─────────────────────────────────────────────────

function SuppliersTab() {
  const { data: poData, isLoading: posLoading } = trpc.purchaseOrders.list.useQuery({ limit: 200 });
  const { data: supplierData, isLoading: suppliersLoading } = trpc.purchaseOrders.listSuppliers.useQuery({});
  const { data: summaryData } = trpc.aiInsights.dashboardSummary.useQuery();

  const isLoading = posLoading || suppliersLoading;
  const pos = poData?.purchaseOrders ?? [];
  const suppliersList = supplierData?.suppliers ?? [];
  const poMetrics = summaryData?.purchaseOrders;

  // Margin by order — group POs by orderId and calculate margin
  const orderMargins = new Map<number, { orderId: number; cost: number; poCount: number }>();
  for (const po of pos) {
    if (po.orderId == null) continue;
    const existing = orderMargins.get(po.orderId) || { orderId: po.orderId, cost: 0, poCount: 0 };
    existing.cost += parseFloat(po.total || "0");
    existing.poCount += 1;
    orderMargins.set(po.orderId, existing);
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <MetricCardSkeleton key={i} />)}
        </div>
        <TableSkeleton rows={6} columns={5} />
      </div>
    );
  }

  const totalCost = pos.reduce((sum, po) => sum + parseFloat(po.total || "0"), 0);
  const marginPct = poMetrics?.grossMarginPercent ?? 0;

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <StaggerGroup className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StaggerItem>
          <div className="bg-white rounded-lg border border-mt-border p-4">
            <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-2">Total Suppliers</p>
            <p className="text-[24px] font-bold text-mt-ink leading-none tabular-nums">{suppliersList.length}</p>
            <p className="text-[11px] text-mt-ink-3 mt-1.5">Active in your catalog</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="bg-white rounded-lg border border-mt-border p-4">
            <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-2">Cost of Goods</p>
            <p className="text-[24px] font-bold text-mt-ink leading-none tabular-nums">
              ${totalCost >= 1000 ? `${(totalCost / 1000).toFixed(1)}K` : totalCost.toFixed(0)}
            </p>
            <p className="text-[11px] text-mt-ink-3 mt-1.5">{pos.length} purchase orders</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="bg-white rounded-lg border border-mt-border p-4">
            <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-2">Gross Margin</p>
            <p className="text-[24px] font-bold leading-none tabular-nums" style={{ color: marginPct >= 30 ? '#16A34A' : marginPct >= 20 ? '#F59E0B' : '#EF4444' }}>
              {marginPct}%
            </p>
            <p className="text-[11px] mt-1.5" style={{ color: marginPct >= 30 ? '#16A34A' : marginPct >= 20 ? '#F59E0B' : '#EF4444' }}>
              {marginPct >= 30 ? "Healthy" : marginPct >= 20 ? "Average" : "Below target"}
            </p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="bg-white rounded-lg border border-mt-border p-4">
            <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-2">Pending POs</p>
            <p className="text-[24px] font-bold text-mt-ink leading-none">{pos.filter(p => p.status === "draft" || p.status === "sent").length}</p>
            <p className="text-[11px] text-mt-ink-3 mt-1.5">Awaiting supplier action</p>
          </div>
        </StaggerItem>
      </StaggerGroup>

      {/* Supplier Performance Table */}
      <div className="bg-white rounded-lg border border-mt-border overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#F0F0F0]">
          <h3 className="text-[14px] font-semibold text-mt-ink">Supplier Performance</h3>
        </div>
        {suppliersList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <BarChart3 size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No suppliers yet</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[280px]">Generate purchase orders to start building your supplier directory and performance metrics.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-[#F0F0F0] bg-mt-surface-2">
                  <th className="text-left text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Supplier</th>
                  <th className="text-left text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Source</th>
                  <th className="text-right text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">POs</th>
                  <th className="text-right text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Total Spend</th>
                  <th className="text-right text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Avg Fulfillment</th>
                  <th className="text-right text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider px-5 py-3">Last Order</th>
                </tr>
              </thead>
              <tbody>
                {suppliersList.map((supplier) => (
                  <tr key={supplier.id} className="border-b border-[#F7F7F7] hover:bg-mt-surface-2 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-mt-ink">{supplier.name}</span>
                        {supplier.code && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-mt-surface-2 text-mt-ink-3 font-mono">{supplier.code}</span>
                        )}
                      </div>
                      {supplier.contactEmail && (
                        <p className="text-[11px] text-mt-ink-3 mt-0.5">{supplier.contactEmail}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-[11px] text-mt-ink-3 uppercase">{supplier.source || "Manual"}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[13px] text-mt-ink tabular-nums">{supplier.poCount}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[13px] font-medium text-mt-ink tabular-nums font-mono">
                        ${parseFloat(String(supplier.totalSpend || "0")).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {supplier.avgFulfillmentDays ? (
                        <span className="text-[13px] tabular-nums" style={{
                          color: parseFloat(String(supplier.avgFulfillmentDays)) <= 7 ? "#16A34A" : parseFloat(String(supplier.avgFulfillmentDays)) <= 14 ? "#F59E0B" : "#EF4444",
                        }}>
                          {parseFloat(String(supplier.avgFulfillmentDays)).toFixed(1)} days
                        </span>
                      ) : (
                        <span className="text-[11px] text-mt-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[12px] text-mt-ink-3">
                        {supplier.lastOrderDate ? new Date(supplier.lastOrderDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
