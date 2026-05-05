/**
 * OrdersTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Orders tab for StoreManagement: order stat cards, searchable orders table,
 * and CSV export.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from "react";
import { Search, Copy, ClipboardList, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import type { StoreOrder } from "./StoreManagementTypes";

interface OrdersTabProps {
  effectiveOrders: StoreOrder[];
  filteredOrders: StoreOrder[];
  orderSearch: string;
  setOrderSearch: (v: string) => void;
  effectiveStore: { gmv: string; name: string };
}

export function OrdersTab({
  effectiveOrders,
  filteredOrders,
  orderSearch,
  setOrderSearch,
  effectiveStore,
}: OrdersTabProps) {
  const handleExportCsv = () => {
    const headers = ["Order ID", "Date", "Customer", "Items", "Total", "Payment", "Status"];
    const rows = effectiveOrders.map((o: StoreOrder) =>
      [o.id, o.date, o.customer, o.items, o.total, o.method, o.status]
        .map((v: string | number) => {
          const s = String(v ?? "");
          return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders_${effectiveStore.name.replace(/\s+/g, "_")}_${
      new Date().toISOString().split("T")[0]
    }.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${effectiveOrders.length} orders`);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3 sm:gap-0">
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mt-ink-4" />
          <input
            className="w-full pl-10 pr-4 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-[#C4C4C4]"
            placeholder="Search orders..."
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
          />
        </div>
        <button
          className="sq-action-btn flex items-center gap-1.5 text-[12px]"
          onClick={handleExportCsv}
        >
          <Copy size={13} /> Export CSV
        </button>
      </div>

      {/* Order Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {[
          { label: "Total Orders", value: String(effectiveOrders.length), sub: "This month" },
          {
            label: "Processing",
            value: String(effectiveOrders.filter((o: StoreOrder) => o.status === "Processing").length),
            sub: "In progress",
          },
          {
            label: "Shipped",
            value: String(effectiveOrders.filter((o: StoreOrder) => o.status === "Shipped").length),
            sub: "In transit",
          },
          { label: "Revenue", value: effectiveStore.gmv, sub: "This month" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg border border-mt-border p-4">
            <span className="text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider">
              {stat.label}
            </span>
            <div className="text-[20px] font-bold text-mt-ink data-mono mt-1">{stat.value}</div>
            <span className="text-[11px] text-mt-ink-4">{stat.sub}</span>
          </div>
        ))}
      </div>

      {effectiveOrders.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-mt-border text-center py-16">
          <ClipboardList size={28} className="mx-auto mb-3 text-mt-ink-4" />
          <p className="text-[13px] font-semibold text-mt-ink">No orders yet</p>
          <p className="text-[12px] text-mt-ink-3 mt-1">
            Orders placed in this store will appear here.
          </p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-mt-border text-center py-16">
          <Search size={24} className="mx-auto mb-3 text-mt-ink-4" />
          <p className="text-[13px] font-semibold text-mt-ink">No matches</p>
          <p className="text-[12px] text-mt-ink-3 mt-1">Try a different search term.</p>
        </div>
      ) : (
      <div className="bg-white rounded-lg border border-mt-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
          <thead>
            <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
              {["Order ID", "Date", "Customer", "Items", "Total", "Payment", "Status", "POs"].map((h) => (
                <th
                  key={h}
                  className="text-left px-5 py-3 text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order, i) => (
              <tr
                key={order.id}
                className="hover:bg-mt-surface transition-colors cursor-pointer"
                style={{
                  borderBottom: i < filteredOrders.length - 1 ? "1px solid #F5F5F5" : "none",
                }}
              >
                <td className="px-5 py-3.5 text-[13px] font-semibold text-primary">{order.id}</td>
                <td className="px-5 py-3.5 text-[13px] text-mt-ink-3">{order.date}</td>
                <td className="px-5 py-3.5 text-[13px] text-mt-ink font-medium">{order.customer}</td>
                <td className="px-5 py-3.5 text-[13px] text-mt-ink-3 data-mono">{order.items}</td>
                <td className="px-5 py-3.5 text-[13px] font-semibold text-mt-ink data-mono">
                  {order.total}
                </td>
                <td className="px-5 py-3.5 text-[12px] text-mt-ink-3">{order.method}</td>
                <td className="px-5 py-3.5">
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
                <td className="px-5 py-3.5">
                  <GeneratePOButton orderId={order.dbId ?? order.id} />
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

/**
 * GeneratePOButton — Inline button for each order row.
 * Shows "Generate POs" if none exist, or "View POs (N)" if they do.
 */
function GeneratePOButton({ orderId }: { orderId: number | string }) {
  const [, navigate] = useLocation();
  const numericId = typeof orderId === "string" ? parseInt(orderId.replace(/\D/g, "")) : orderId;

  // Check if POs exist for this order
  const { data: poData } = trpc.purchaseOrders.list.useQuery(
    { orderId: numericId, limit: 10 },
    { enabled: !!numericId && numericId > 0 },
  );

  const generateMut = trpc.purchaseOrders.generateFromOrder.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.totalPOs} POs generated`);
      navigate(`/purchase-orders?orderId=${numericId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const existingCount = poData?.purchaseOrders?.length ?? 0;

  if (!numericId || numericId <= 0) return null;

  if (existingCount > 0) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/purchase-orders?orderId=${numericId}`);
        }}
        className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors hover:bg-[#654BF9]/10"
        style={{ color: "#654BF9" }}
      >
        <CheckCircle2 size={12} />
        View POs ({existingCount})
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        generateMut.mutate({ orderId: numericId });
      }}
      className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded border transition-all hover:bg-mt-surface-2"
      style={{ borderColor: "var(--mt-border, #E5E5E5)", color: "var(--mt-ink-2, #6B7280)" }}
      disabled={generateMut.isPending}
    >
      {generateMut.isPending ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <ClipboardList size={12} />
      )}
      Generate POs
    </button>
  );
}
