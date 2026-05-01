/**
 * PortalOrdersTab — Order list with expandable OrderRow detail.
 */
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { ShoppingCart, Package, Search } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { StatusBadge } from "./portalHelpers";

type OrderListItem = {
  id: number;
  orderNumber: string;
  status: string;
  subtotal: string;
  tax: string;
  shipping: string;
  total: string;
  paymentMethod: string | null;
  trackingNumber: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  discountAmount: string | null;
};

type OrderDetailItem = {
  id: number;
  productId: number;
  name: string;
  imageUrl: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  decorationType: string | null;
  size: string | null;
  color: string | null;
};

interface OrdersTabProps {
  storeSlug: string;
  pc: string;
  userRole?: string;
}

export function PortalOrdersTab({ storeSlug, pc, userRole }: OrdersTabProps) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [employeeEmail, setEmployeeEmail] = useState<string>("");
  const [debouncedEmail, setDebouncedEmail] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const isAdmin = userRole === "admin" || userRole === "manager";

  // Debounce employee email input
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setDebouncedEmail(employeeEmail.trim());
    }, 400);
    return () => clearTimeout(timerRef.current);
  }, [employeeEmail]);

  const { data: orders, isLoading } = trpc.storePortal.orders.list.useQuery(
    {
      storeSlug,
      status: statusFilter || undefined,
      employeeEmail: debouncedEmail || undefined,
    },
    { retry: false }
  );

  if (isLoading) return <MergeTasksLoader variant="inline" message="Loading orders..." />;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-mt-border text-[13px] text-mt-ink focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="production">In Production</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
        </select>

        {/* Employee email filter — admin/manager only */}
        {isAdmin && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mt-ink-4" />
            <input
              type="text"
              placeholder="Filter by employee email..."
              value={employeeEmail}
              onChange={(e) => setEmployeeEmail(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-lg border border-mt-border text-[13px] text-mt-ink focus:outline-none focus:border-primary w-64"
            />
          </div>
        )}
      </div>

      {debouncedEmail && (
        <p className="text-[12px] text-mt-ink-3">
          Showing orders for <span className="font-semibold text-mt-ink">{debouncedEmail}</span>
        </p>
      )}

      {/* Order List */}
      {!orders || orders.length === 0 ? (
        <div className="text-center py-12 border border-mt-border rounded-lg">
          <ShoppingCart size={32} className="mx-auto mb-3 text-[#D4D4D4]" />
          <p className="text-[14px] font-semibold text-mt-ink mb-1">No orders found</p>
          <p className="text-[12px] text-mt-ink-3">Orders placed through the store will appear here</p>
        </div>
      ) : (
        <div className="border border-mt-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-mt-surface border-b border-mt-border">
                <th className="text-left px-4 py-3 text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide">Order #</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide">Employee</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide">Payment</th>
                <th className="text-right px-4 py-3 text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F5F5F5]">
              {orders.map((o) => (
                <OrderRow key={o.id} order={o} pc={pc} expanded={expandedId === o.id} onToggle={() => setExpandedId(expandedId === o.id ? null : o.id)} storeSlug={storeSlug} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── OrderRow ───────────────────────────────────────────────────────────

function OrderRow({ order: o, pc, expanded, onToggle, storeSlug }: {
  order: OrderListItem;
  pc: string;
  expanded: boolean;
  onToggle: () => void;
  storeSlug: string;
}) {
  const { data: detail } = trpc.storePortal.orders.getById.useQuery(
    { storeSlug, orderId: o.id },
    { enabled: expanded, retry: false }
  );

  return (
    <>
      <tr className="hover:bg-mt-surface cursor-pointer transition-colors" onClick={onToggle}>
        <td className="px-4 py-3 text-[13px] font-semibold text-mt-ink">{o.orderNumber}</td>
        <td className="px-4 py-3 text-[13px] text-mt-ink-2">{formatDate(o.createdAt)}</td>
        <td className="px-4 py-3">
          <div className="text-[12px] font-semibold text-mt-ink">{o.employeeName ?? "—"}</div>
          {o.employeeEmail && <div className="text-[11px] text-mt-ink-3">{o.employeeEmail}</div>}
        </td>
        <td className="px-4 py-3"><StatusBadge status={o.status} pc={pc} /></td>
        <td className="px-4 py-3 text-[12px] text-mt-ink-3 capitalize">{o.paymentMethod?.replace(/_/g, " ") || "—"}</td>
        <td className="px-4 py-3 text-[13px] font-bold text-mt-ink text-right">{formatCurrency(o.total)}</td>
      </tr>
      {expanded && detail && (
        <tr>
          <td colSpan={6} className="bg-mt-surface px-4 py-4 border-t border-mt-border">
            <div className="space-y-2">
              {detail.items.map((item: OrderDetailItem) => (
                <div key={item.id} className="flex items-center gap-3 bg-white rounded-lg p-3 border border-mt-border">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-10 h-10 rounded object-contain bg-mt-surface-2" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-mt-surface-2 flex items-center justify-center">
                      <Package size={16} className="text-mt-ink-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-mt-ink">{item.name}</p>
                    <p className="text-[11px] text-mt-ink-3">
                      Qty: {item.quantity} · {formatCurrency(item.unitPrice)}/ea
                      {item.size ? ` · ${item.size}` : ""}
                      {item.color ? ` · ${item.color}` : ""}
                    </p>
                  </div>
                  <p className="text-[13px] font-bold text-mt-ink">{formatCurrency(item.totalPrice)}</p>
                </div>
              ))}
              {detail.trackingNumber && (
                <div className="flex items-center gap-2 text-[12px] text-mt-ink-2 bg-white rounded-lg p-3 border border-mt-border">
                  <Package size={14} style={{ color: pc }} />
                  <span className="font-semibold">Tracking:</span> {detail.trackingNumber}
                </div>
              )}
              {detail.shippingAddress && (
                <div className="text-[12px] text-mt-ink-2 bg-white rounded-lg p-3 border border-mt-border">
                  <span className="font-semibold">Ship to:</span> {detail.shippingName} — {detail.shippingAddress}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
