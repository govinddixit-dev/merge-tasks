/**
 * PortalOverviewTab — Dashboard overview with stats, recent proposals/orders, and quick actions.
 */
import {
  FileText, ShoppingCart, Printer, Package, Clock,
  TrendingUp, DollarSign, Layers,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { StatusBadge } from "./portalHelpers";

interface DashboardStats {
  activeProposals: number;
  acceptedProposals: number;
  pendingApprovals: number;
  totalApprovals: number;
  pendingOrders: number;
  totalOrders: number;
  totalSpent: string;
  activePrintRequests: number;
}

interface DashboardProposal {
  id: number;
  title: string;
  status: string;
  estimatedValue: string;
  createdAt: string | null;
  sentAt: string | null;
  multiDepartment: boolean;
  fulfillmentRequestedAt: string | null;
  viewToken?: string;
}

interface DashboardOrder {
  id: number;
  orderNumber: string;
  status: string;
  total: string;
  createdAt: string | null;
}

interface DashboardData {
  stats: DashboardStats;
  recentProposals: DashboardProposal[];
  recentOrders: DashboardOrder[];
}

interface OverviewTabProps {
  dashboard: DashboardData;
  pc: string;
  storeSlug: string;
  onNavigateToProposal?: (token: string) => void;
  /** Switch the parent ClientPortal to a named tab without a page reload */
  onTabChange?: (tab: "proposals" | "orders" | "print" | "team") => void;
}

export function PortalOverviewTab({ dashboard, pc, storeSlug, onNavigateToProposal, onTabChange }: OverviewTabProps) {
  const stats = dashboard.stats;

  const statCards = [
    { label: "Active Proposals", value: stats.activeProposals, icon: FileText, color: "#2563EB" },
    { label: "Pending Approvals", value: stats.pendingApprovals, icon: Clock, color: "#EA580C" },
    { label: "Pending Orders", value: stats.pendingOrders, icon: Package, color: "#7C3AED" },
    { label: "Total Spent", value: formatCurrency(stats.totalSpent), icon: DollarSign, color: "#16A34A" },
  ];

  return (
    <div className="space-y-5">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s, i) => (
          <div key={i} className="border border-mt-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <s.icon size={18} style={{ color: s.color }} />
              <TrendingUp size={14} className="text-mt-ink-4" />
            </div>
            <p className="text-[22px] font-bold text-mt-ink">{s.value}</p>
            <p className="text-[12px] text-mt-ink-3 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Recent Proposals & Orders */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Proposals */}
        <div className="border border-mt-border rounded-lg">
          <div className="px-5 py-4 border-b border-mt-border flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-mt-ink">Recent Proposals</h3>
            <span className="text-[11px] font-semibold" style={{ color: pc }}>
              {stats.activeProposals + stats.acceptedProposals} total
            </span>
          </div>
          <div className="divide-y divide-[#F5F5F5]">
            {dashboard.recentProposals.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <FileText size={24} className="mx-auto mb-2 text-[#D4D4D4]" />
                <p className="text-[13px] text-mt-ink-3">No proposals yet</p>
              </div>
            ) : (
              dashboard.recentProposals.map((p) => (
                <div
                  key={p.id}
                  className="px-5 py-3 flex items-center justify-between hover:bg-mt-surface cursor-pointer transition-colors"
                  onClick={() => p.viewToken && onNavigateToProposal?.(p.viewToken)}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-mt-ink truncate">{p.title}</p>
                    <p className="text-[11px] text-mt-ink-3">{formatDate(p.sentAt || p.createdAt)} · {formatCurrency(p.estimatedValue)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={p.status} pc={pc} />
                    {p.multiDepartment && (
                      <span title="Multi-department"><Layers size={13} className="text-[#7C3AED]" /></span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Orders */}
        <div className="border border-mt-border rounded-lg">
          <div className="px-5 py-4 border-b border-mt-border flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-mt-ink">Recent Orders</h3>
            <span className="text-[11px] font-semibold" style={{ color: pc }}>
              {stats.totalOrders} total
            </span>
          </div>
          <div className="divide-y divide-[#F5F5F5]">
            {dashboard.recentOrders.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <ShoppingCart size={24} className="mx-auto mb-2 text-[#D4D4D4]" />
                <p className="text-[13px] text-mt-ink-3">No orders yet</p>
              </div>
            ) : (
              dashboard.recentOrders.map((o) => (
                <div key={o.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-mt-ink">{o.orderNumber}</p>
                    <p className="text-[11px] text-mt-ink-3">{formatDate(o.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold text-mt-ink">{formatCurrency(o.total)}</span>
                    <StatusBadge status={o.status} pc={pc} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="border border-mt-border rounded-lg p-5">
        <h3 className="text-[14px] font-bold text-mt-ink mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            { label: "Browse Store", icon: Package, desc: "Shop products", tab: null as null, href: `/s/${storeSlug}/products` },
            { label: "View Proposals", icon: FileText, desc: "Review & approve", tab: "proposals" as const, href: null },
            { label: "Order History", icon: ShoppingCart, desc: "Track orders", tab: "orders" as const, href: null },
            { label: "Print Request", icon: Printer, desc: "Submit request", tab: "print" as const, href: null },
          ] as const).map((action, i) => (
            <button
              key={i}
              className="text-left p-3 rounded-lg border border-mt-border hover:border-mt-border-2 transition-colors group"
              onClick={() => {
                if (action.href) {
                  // Push via History API so wouter picks it up without a full reload
                  window.history.pushState(null, "", action.href);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                } else if (action.tab) {
                  onTabChange?.(action.tab);
                }
              }}
            >
              <action.icon size={18} className="mb-2" style={{ color: pc }} />
              <p className="text-[12px] font-semibold text-mt-ink">{action.label}</p>
              <p className="text-[11px] text-mt-ink-4">{action.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
