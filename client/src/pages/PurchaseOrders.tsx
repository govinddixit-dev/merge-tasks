/**
 * PurchaseOrders.tsx — Purchase Orders list page.
 * Shows all POs with KPI cards, filters, and status badges.
 * Follows the same DashboardLayout + tRPC pattern as Proposals.tsx.
 */
import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { TableSkeleton } from "@/components/motion/Skeletons";
import { trpc } from "@/lib/trpc";
import {
  Truck, Package, Clock, DollarSign, ChevronRight, Search,
  FileText, Download, Trash2, Loader2, Eye,
  ClipboardList, CheckCircle2, AlertTriangle, Send as SendIcon,
  Layers, X,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { statusTone, statusBadgeClass, type StatusTone } from "@/lib/statusPalette";

// ── Status badge config ─────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { tone: StatusTone; label: string }> = {
  draft:          { tone: "gray",   label: "Draft" },
  sent:           { tone: "blue",   label: "Sent" },
  acknowledged:   { tone: "purple", label: "Acknowledged" },
  in_production:  { tone: "amber",  label: "In Production" },
  shipped:        { tone: "purple", label: "Shipped" },
  received:       { tone: "green",  label: "Received" },
  cancelled:      { tone: "red",    label: "Cancelled" },
  partial:        { tone: "amber",  label: "Partial" },
  declined:       { tone: "red",    label: "Declined" },
  consolidated:   { tone: "gray",   label: "Consolidated" },
  merged:         { tone: "purple", label: "Merged" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.draft;
  const t = statusTone[s.tone];
  return (
    <span className={statusBadgeClass} style={{ backgroundColor: t.bg, color: t.text }}>
      {s.label}
    </span>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

const AGGREGABLE_STATUSES = new Set(["draft", "sent", "acknowledged"]);

export default function PurchaseOrders() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewGroups, setPreviewGroups] = useState<Array<{ supplierName: string; pos: Array<{ id: number; poNumber: string; total: string; itemCount: number }> }>>([]);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.purchaseOrders.list.useQuery({
    limit: 100,
    status: statusFilter !== "all" ? statusFilter : undefined,
    supplierName: searchQuery || undefined,
  });

  const deleteMut = trpc.purchaseOrders.delete.useMutation({
    onSuccess: () => { toast.success("Purchase order deleted"); },
    onError: (err) => { toast.error(err.message); },
  });

  const previewAggregateQuery = trpc.purchaseOrders.previewAggregate.useQuery(
    { poIds: selectedIds.size > 0 ? Array.from(selectedIds) : undefined },
    { enabled: false },
  );

  const aggregateMut = trpc.purchaseOrders.aggregate.useMutation({
    onSuccess: (res) => {
      utils.purchaseOrders.list.invalidate();
      setPreviewOpen(false);
      setSelectedIds(new Set());
      toast.success(`Consolidated into ${res.merged.length} merged PO${res.merged.length === 1 ? "" : "s"}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const openAggregatePreview = async () => {
    const res = await previewAggregateQuery.refetch();
    const groups = res.data?.consolidatableGroups ?? [];
    if (groups.length === 0) {
      toast("No consolidation opportunities — no supplier appears on 2+ POs right now.");
      return;
    }
    setPreviewGroups(groups);
    setPreviewOpen(true);
  };

  const togglePoFromGroup = (supplierKey: string, poId: number) => {
    setPreviewGroups((groups) =>
      groups
        .map((g) =>
          g.supplierName === supplierKey
            ? { ...g, pos: g.pos.filter((p) => p.id !== poId) }
            : g,
        )
        .filter((g) => g.pos.length >= 2),
    );
  };

  const confirmAggregate = () => {
    aggregateMut.mutate({
      groups: previewGroups.map((g) => ({ supplierName: g.supplierName, poIds: g.pos.map((p) => p.id) })),
    });
  };

  const pos = data?.purchaseOrders ?? [];
  const total = data?.total ?? 0;

  const aggregableCount = useMemo(() => pos.filter((po) => AGGREGABLE_STATUSES.has(po.status)).length, [pos]);
  const selectedAggregableCount = useMemo(
    () => pos.filter((po) => selectedIds.has(po.id) && AGGREGABLE_STATUSES.has(po.status)).length,
    [pos, selectedIds],
  );

  // KPI calculations
  const totalCost = pos.reduce((sum, po) => sum + parseFloat(po.total || "0"), 0);
  const pendingCount = pos.filter(po => po.status === "draft" || po.status === "sent").length;
  const inTransitCount = pos.filter(po => po.status === "shipped").length;
  const receivedCount = pos.filter(po => po.status === "received").length;

  const statusOptions = [
    { value: "all", label: "All Status" },
    { value: "draft", label: "Draft" },
    { value: "sent", label: "Sent" },
    { value: "acknowledged", label: "Acknowledged" },
    { value: "in_production", label: "In Production" },
    { value: "shipped", label: "Shipped" },
    { value: "received", label: "Received" },
    { value: "cancelled", label: "Cancelled" },
    { value: "declined", label: "Declined" },
  ];

  return (
    <DashboardLayout title="Purchase Orders" subtitle="Track supplier orders, costs, and margins">

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total POs", value: total, icon: ClipboardList, color: "var(--mt-ink, #1A1A1A)" },
          { label: "Pending", value: pendingCount, icon: Clock, color: "#D97706" },
          { label: "In Transit", value: inTransitCount, icon: Truck, color: "#654BF9" },
          { label: "Total Cost", value: `$${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: "#16A34A" },
        ].map((kpi, i) => (
          <div
            key={i}
            className="rounded-lg border p-5 transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
            style={{ borderColor: "var(--mt-border, #E5E5E5)", backgroundColor: "var(--mt-surface, #FFFFFF)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <kpi.icon size={18} style={{ color: kpi.color }} strokeWidth={2} />
            </div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: kpi.color }}>{kpi.value}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider mt-1" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--mt-ink-3, #9CA3AF)" }} />
          <input
            type="text"
            placeholder="Search supplier..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-md border text-sm outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
            style={{ borderColor: "var(--mt-border, #E5E5E5)" }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-3 rounded-md border text-sm outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
          style={{ borderColor: "var(--mt-border, #E5E5E5)" }}
        >
          {statusOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {aggregableCount >= 2 && (
          <button
            onClick={openAggregatePreview}
            disabled={previewAggregateQuery.isFetching}
            className="h-9 px-3 rounded-md text-sm font-semibold inline-flex items-center gap-1.5 border transition-colors bg-white text-primary border-primary/40 hover:bg-mt-brand-light disabled:opacity-60"
          >
            {previewAggregateQuery.isFetching ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Layers size={14} />
            )}
            {selectedAggregableCount >= 2
              ? `Aggregate ${selectedAggregableCount} Selected`
              : "Aggregate"}
          </button>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <TableSkeleton rows={6} columns={7} />
      ) : pos.length === 0 ? (
        (statusFilter !== "all" || searchQuery) ? (
          <div className="text-center py-16">
            <Truck size={48} strokeWidth={1} style={{ color: "var(--mt-ink-3, #9CA3AF)", margin: "0 auto 16px" }} />
            <p className="text-lg font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>No purchase orders match your filters</p>
            <p className="text-sm mt-1 mb-3" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>
              Try adjusting your search or status filter
            </p>
            <button
              type="button"
              onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}
              className="text-[12px] font-semibold text-primary hover:underline transition-colors duration-150"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="text-center py-16">
            <Truck size={48} strokeWidth={1} style={{ color: "var(--mt-ink-3, #9CA3AF)", margin: "0 auto 16px" }} />
            <p className="text-lg font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>No purchase orders yet</p>
            <p className="text-sm mt-1" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>
              Generate POs from an order to get started
            </p>
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--mt-border, #E5E5E5)" }}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
                <th className="px-3 py-3 w-8" style={{ borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}></th>
                {["PO #", "Supplier", "Order", "Items", "Total Cost", "Status", "Created", ""].map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "var(--mt-ink-3, #9CA3AF)", borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => {
                const items = (po.lineItems as Array<Record<string, unknown>>) || [];
                const inactive = po.status === "consolidated";
                const selectable = AGGREGABLE_STATUSES.has(po.status);
                return (
                  <tr
                    key={po.id}
                    className={`transition-colors duration-100 cursor-pointer hover:bg-[var(--mt-surface-2,#F9FAFB)] ${inactive ? "opacity-60" : ""}`}
                    onClick={() => navigate(`/purchase-orders/${po.id}`)}
                    style={{ borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(po.id)}
                          onChange={(e) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(po.id);
                              else next.delete(po.id);
                              return next;
                            });
                          }}
                          className="rounded border-mt-border"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                      {po.poNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span style={{ color: "var(--mt-ink, #1A1A1A)" }}>{po.supplierName}</span>
                        {po.supplierSource && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{
                            backgroundColor: "var(--mt-surface-2, #F9FAFB)",
                            color: "var(--mt-ink-3, #9CA3AF)",
                          }}>
                            {po.supplierSource.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--mt-ink-2, #6B7280)" }}>
                      #{po.orderId}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums" style={{ color: "var(--mt-ink-2, #6B7280)" }}>
                      {items.length}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm tabular-nums text-right" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                      ${parseFloat(po.total || "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={po.status} />
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>
                      {po.createdAt ? new Date(po.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/purchase-orders/${po.id}`);
                        }}
                        className="p-1.5 rounded-md transition-colors hover:bg-[var(--mt-surface-2,#F9FAFB)]"
                      >
                        <ChevronRight size={16} style={{ color: "var(--mt-ink-3, #9CA3AF)" }} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Aggregate preview modal — review + edit proposed groupings before confirm. */}
      {previewOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-mt-border flex items-start justify-between">
              <div>
                <h3 className="text-[15px] font-bold text-mt-ink flex items-center gap-2">
                  <Layers size={15} className="text-primary" /> Aggregate Purchase Orders
                </h3>
                <p className="text-[12px] text-mt-ink-4 mt-1">
                  Review the proposed supplier groupings. Remove a PO from any group to exclude it.
                  Each group will become one merged PO; the originals will be marked Consolidated.
                </p>
              </div>
              <button onClick={() => setPreviewOpen(false)} className="p-1 rounded hover:bg-mt-surface-2">
                <X size={14} className="text-mt-ink-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {previewGroups.length === 0 ? (
                <p className="text-[13px] text-mt-ink-4 py-8 text-center">
                  No groups left. Close this dialog and try again with a different selection.
                </p>
              ) : previewGroups.map((g) => (
                <div key={g.supplierName} className="border border-mt-border rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-mt-surface flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-semibold text-mt-ink">{g.supplierName}</div>
                      <div className="text-[11px] text-mt-ink-4">
                        {g.pos.length} PO{g.pos.length === 1 ? "" : "s"} →
                        {" "}${g.pos.reduce((s, p) => s + parseFloat(p.total || "0"), 0).toFixed(2)} total
                      </div>
                    </div>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-mt-brand-light text-primary">
                      → 1 Merged PO
                    </span>
                  </div>
                  <div>
                    {g.pos.map((p) => (
                      <div key={p.id} className="px-4 py-2 flex items-center justify-between text-[12px]" style={{ borderTop: "1px solid #F5F5F5" }}>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-mt-ink">{p.poNumber}</span>
                          <span className="text-mt-ink-4">{p.itemCount} item{p.itemCount === 1 ? "" : "s"}</span>
                          <span className="font-mono tabular-nums text-mt-ink-2">${parseFloat(p.total || "0").toFixed(2)}</span>
                        </div>
                        <button
                          className="text-[11px] text-mt-ink-4 hover:text-[#DC2626]"
                          onClick={() => togglePoFromGroup(g.supplierName, p.id)}
                          title="Remove from group"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-mt-border flex items-center justify-between">
              <span className="text-[12px] text-mt-ink-4">
                {previewGroups.length} group{previewGroups.length === 1 ? "" : "s"} ·
                {" "}{previewGroups.reduce((n, g) => n + g.pos.length, 0)} POs → {previewGroups.length} merged
              </span>
              <div className="flex gap-2">
                <button
                  className="sq-action-btn text-[12px]"
                  onClick={() => setPreviewOpen(false)}
                  disabled={aggregateMut.isPending}
                >
                  Cancel
                </button>
                <button
                  className="sq-action-btn primary text-[12px] flex items-center gap-1"
                  disabled={previewGroups.length === 0 || aggregateMut.isPending}
                  onClick={confirmAggregate}
                >
                  {aggregateMut.isPending ? (
                    <><Loader2 size={11} className="animate-spin" /> Merging…</>
                  ) : "Confirm & Merge"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </DashboardLayout>
  );
}
