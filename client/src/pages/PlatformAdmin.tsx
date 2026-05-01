/**
 * Platform Admin Dashboard — Owner-only view for tracking signups, churn, MRR.
 *
 * Accessible only to users with role: "admin". Shows platform-level metrics
 * that are invisible to regular distributors.
 */

import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Users,
  TrendingUp,
  TrendingDown,
  DollarSign,
  UserPlus,
  Activity,
  Store,
  FileText,
  ShoppingCart,
  Shield,
  ShieldOff,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatCard({ label, value, subValue, icon: Icon, color }: {
  label: string;
  value: string | number;
  subValue?: string;
  icon: typeof Users;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-mt-border p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-semibold text-mt-ink-3 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={16} className="text-white" />
        </div>
      </div>
      <p className="text-[28px] font-bold text-mt-ink leading-none">{value}</p>
      {subValue && <p className="text-[12px] text-mt-ink-3 mt-1">{subValue}</p>}
    </div>
  );
}

function MiniBarChart({ data, maxHeight = 60 }: { data: { label: string; value: number }[]; maxHeight?: number }) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-[3px]" style={{ height: maxHeight + 20 }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center flex-1 min-w-0">
          <div
            className="w-full bg-primary/80 rounded-t-sm min-h-[2px] transition-all"
            style={{ height: Math.max(2, (d.value / maxVal) * maxHeight) }}
            title={`${d.label}: ${d.value}`}
          />
          {i % 7 === 0 && (
            <span className="text-[9px] text-mt-ink-4 mt-1 truncate w-full text-center">{d.label.slice(5)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function PlatformAdmin() {
  const { user } = useAuth();
  const [userPage, setUserPage] = useState(1);
  const [tierFilter, setTierFilter] = useState<"all" | "free" | "pro" | "enterprise">("all");
  const [suspendTarget, setSuspendTarget] = useState<{ id: number; label: string } | null>(null);

  const overview = trpc.platformAdmin.overview.useQuery();
  const signupTimeline = trpc.platformAdmin.signupTimeline.useQuery({ days: 30 });
  const userList = trpc.platformAdmin.userList.useQuery({
    page: userPage,
    pageSize: 25,
    sortBy: "createdAt",
    sortOrder: "desc",
    tierFilter,
  });

  const suspendMutation = trpc.platformAdmin.suspendUser.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      userList.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const unsuspendMutation = trpc.platformAdmin.unsuspendUser.useMutation({
    onSuccess: () => {
      toast.success("User unsuspended");
      userList.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  // Gate: only admin role can see this
  if (user?.role !== "admin") {
    return (
      <DashboardLayout title="Access Denied">
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
            <h2 className="text-[18px] font-bold text-mt-ink mb-2">Platform Admin Only</h2>
            <p className="text-[14px] text-mt-ink-3">This page is restricted to the platform owner.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const o = overview.data;
  const isLoading = overview.isLoading;

  return (
    <DashboardLayout title="Platform Admin" subtitle="MergeTasks owner metrics — signups, churn, MRR">
      <div className="space-y-6 pb-12">
        {/* ── Top-level KPIs ── */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        ) : o ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Users"
                value={o.totalUsers}
                subValue={`+${o.signups.last7d} this week`}
                icon={Users}
                color="bg-blue-500"
              />
              <StatCard
                label="MRR"
                value={formatCurrency(o.mrr)}
                subValue={`${(o.tierBreakdown.pro?.active ?? 0) + (o.tierBreakdown.enterprise?.active ?? 0)} paying`}
                icon={DollarSign}
                color="bg-emerald-500"
              />
              <StatCard
                label="Active (30d)"
                value={o.activeUsers.last30d}
                subValue={`${o.activeUsers.last7d} in last 7d`}
                icon={Activity}
                color="bg-violet-500"
              />
              <StatCard
                label="Churned (30d)"
                value={o.churned30d}
                subValue="Inactive 30-60 days"
                icon={TrendingDown}
                color="bg-red-500"
              />
            </div>

            {/* ── Signup Timeline ── */}
            <div className="bg-white rounded-xl border border-mt-border p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-[15px] font-bold text-mt-ink">Signups — Last 30 Days</h3>
                  <p className="text-[12px] text-mt-ink-3">
                    {o.signups.last24h} today &middot; {o.signups.last7d} this week &middot; {o.signups.last30d} this month
                  </p>
                </div>
                <UserPlus size={18} className="text-primary" />
              </div>
              {signupTimeline.data && signupTimeline.data.length > 0 ? (
                <MiniBarChart
                  data={signupTimeline.data.map(d => ({ label: d.date, value: d.count }))}
                />
              ) : (
                <p className="text-[13px] text-mt-ink-4 py-8 text-center">No signup data yet</p>
              )}
            </div>

            {/* ── Tier Breakdown + Platform Totals ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Tier breakdown */}
              <div className="bg-white rounded-xl border border-mt-border p-5">
                <h3 className="text-[15px] font-bold text-mt-ink mb-4">Subscription Breakdown</h3>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-mt-ink-3 border-b border-mt-border">
                      <th className="text-left py-2 font-semibold">Tier</th>
                      <th className="text-right py-2 font-semibold">Active</th>
                      <th className="text-right py-2 font-semibold">Past Due</th>
                      <th className="text-right py-2 font-semibold">Canceled</th>
                      <th className="text-right py-2 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(o.tierBreakdown).map(([tier, data]) => (
                      <tr key={tier} className="border-b border-mt-border/50">
                        <td className="py-2.5 font-medium text-mt-ink capitalize">{tier}</td>
                        <td className="py-2.5 text-right text-emerald-600 font-medium">{data.active}</td>
                        <td className="py-2.5 text-right text-amber-600">{data.pastDue}</td>
                        <td className="py-2.5 text-right text-red-500">{data.canceled}</td>
                        <td className="py-2.5 text-right font-bold text-mt-ink">{data.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Platform totals */}
              <div className="bg-white rounded-xl border border-mt-border p-5">
                <h3 className="text-[15px] font-bold text-mt-ink mb-4">Platform Activity</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                        <Store size={16} className="text-blue-600" />
                      </div>
                      <span className="text-[13px] text-mt-ink">Total Stores</span>
                    </div>
                    <span className="text-[18px] font-bold text-mt-ink">{o.platformTotals.stores}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center">
                        <FileText size={16} className="text-violet-600" />
                      </div>
                      <span className="text-[13px] text-mt-ink">Total Proposals</span>
                    </div>
                    <span className="text-[18px] font-bold text-mt-ink">{o.platformTotals.proposals}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                        <ShoppingCart size={16} className="text-emerald-600" />
                      </div>
                      <span className="text-[13px] text-mt-ink">Total Orders</span>
                    </div>
                    <span className="text-[18px] font-bold text-mt-ink">{o.platformTotals.orders}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {/* ── User List ── */}
        <div className="bg-white rounded-xl border border-mt-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[15px] font-bold text-mt-ink">All Users</h3>
            <div className="flex items-center gap-2">
              <select
                value={tierFilter}
                onChange={(e) => { setTierFilter(e.target.value as "all" | "free" | "pro" | "enterprise"); setUserPage(1); }}
                className="text-[12px] border border-mt-border rounded-lg px-3 py-1.5 bg-white text-mt-ink"
              >
                <option value="all">All Tiers</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>

          {userList.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-primary" />
            </div>
          ) : userList.data ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-mt-ink-3 border-b border-mt-border">
                      <th className="text-left py-2 font-semibold">User</th>
                      <th className="text-left py-2 font-semibold">Tier</th>
                      <th className="text-left py-2 font-semibold">Status</th>
                      <th className="text-left py-2 font-semibold">Signed Up</th>
                      <th className="text-left py-2 font-semibold">Last Active</th>
                      <th className="text-right py-2 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userList.data.users.map((u) => {
                      const isSuspended = u.role === "admin" ? false : false; // Can't suspend yourself
                      return (
                        <tr key={u.id} className="border-b border-mt-border/50 hover:bg-mt-surface-1/50">
                          <td className="py-2.5">
                            <div>
                              <p className="font-medium text-mt-ink">{u.name || "—"}</p>
                              <p className="text-[11px] text-mt-ink-4">{u.email || "—"}</p>
                            </div>
                          </td>
                          <td className="py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              u.subscriptionTier === "enterprise" ? "bg-violet-100 text-violet-700" :
                              u.subscriptionTier === "pro" ? "bg-blue-100 text-blue-700" :
                              "bg-gray-100 text-gray-600"
                            }`}>
                              {u.subscriptionTier}
                            </span>
                          </td>
                          <td className="py-2.5">
                            <span className={`text-[12px] ${
                              u.subscriptionStatus === "active" ? "text-emerald-600" :
                              u.subscriptionStatus === "past_due" ? "text-amber-600" :
                              u.subscriptionStatus === "canceled" ? "text-red-500" :
                              "text-mt-ink-4"
                            }`}>
                              {u.subscriptionStatus}
                            </span>
                          </td>
                          <td className="py-2.5 text-mt-ink-3">
                            {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                          <td className="py-2.5 text-mt-ink-3">
                            {timeAgo(u.lastSignedIn)}
                          </td>
                          <td className="py-2.5 text-right">
                            {u.role !== "admin" && (
                              <button
                                onClick={() => setSuspendTarget({ id: u.id, label: u.email || u.name || `user #${u.id}` })}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Suspend user and revoke all sessions"
                              >
                                <Shield size={12} /> Suspend
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {userList.data.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-mt-border">
                  <p className="text-[12px] text-mt-ink-3">
                    Page {userList.data.page} of {userList.data.totalPages} ({userList.data.total} users)
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setUserPage(p => Math.max(1, p - 1))}
                      disabled={userPage <= 1}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-mt-border hover:bg-mt-surface-1 disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      onClick={() => setUserPage(p => Math.min(userList.data!.totalPages, p + 1))}
                      disabled={userPage >= userList.data.totalPages}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-mt-border hover:bg-mt-surface-1 disabled:opacity-40"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={suspendTarget !== null}
        title="Suspend this user?"
        description={
          suspendTarget
            ? <>{suspendTarget.label} will be signed out of every active session immediately. You can unsuspend them any time.</>
            : null
        }
        confirmLabel="Suspend"
        loading={suspendMutation.isPending}
        onCancel={() => setSuspendTarget(null)}
        onConfirm={() => {
          if (!suspendTarget) return;
          suspendMutation.mutate(
            { userId: suspendTarget.id },
            { onSettled: () => setSuspendTarget(null) },
          );
        }}
      />
    </DashboardLayout>
  );
}
