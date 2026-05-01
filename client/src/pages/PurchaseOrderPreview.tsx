/**
 * PurchaseOrderPreview — review-before-commit screen for AI-generated POs.
 *
 * Route: /purchase-orders/preview/:token
 *
 * - Fetches the supplier bucket payload from `purchaseOrders.getPreview`.
 * - Lets the user drag items between supplier groups (HTML5 DnD).
 * - Surfaces low-confidence buckets in a "Needs Review" section.
 * - Inline "Edit supplier name" doubles as create-new-supplier (the
 *   confirm step auto-upserts the suppliers directory).
 * - Confirm calls `purchaseOrders.confirmGeneration` and navigates to
 *   /purchase-orders.
 */

import { useState, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft, AlertCircle, CheckCircle2, Loader2, Sparkles, Edit2, Package,
} from "lucide-react";

type BucketItem = {
  orderItemId: number;
  productId: number;
  productName: string;
  sku: string | null;
  quantity: number;
  basePrice: string | null;
  color: string | null;
  size: string | null;
};

type Bucket = {
  supplierName: string;
  supplierCode: string | null;
  supplierSource: string | null;
  confidence: number;
  reason: string;
  items: BucketItem[];
  needsManualAssignment: boolean;
};

export default function PurchaseOrderPreview() {
  const [, params] = useRoute("/purchase-orders/preview/:token");
  const [, navigate] = useLocation();
  const token = params?.token ?? "";

  const { data, isLoading, error } = trpc.purchaseOrders.getPreview.useQuery(
    { token },
    { enabled: token.length > 0 },
  );

  const [groups, setGroups] = useState<Bucket[] | null>(null);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const [draggedItem, setDraggedItem] = useState<{ groupIdx: number; itemIdx: number } | null>(null);

  useEffect(() => {
    if (data?.payload?.groups) {
      setGroups(JSON.parse(JSON.stringify(data.payload.groups)) as Bucket[]);
    }
  }, [data]);

  const confirmMutation = trpc.purchaseOrders.confirmGeneration.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.totalPOs} purchase order${res.totalPOs > 1 ? "s" : ""} created`);
      navigate("/purchase-orders");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleDragStart = (groupIdx: number, itemIdx: number) =>
    setDraggedItem({ groupIdx, itemIdx });

  const handleDrop = (targetGroupIdx: number) => {
    if (!draggedItem || !groups) return;
    if (draggedItem.groupIdx === targetGroupIdx) {
      setDraggedItem(null);
      return;
    }
    const next = groups.map(g => ({ ...g, items: [...g.items] }));
    const [moved] = next[draggedItem.groupIdx].items.splice(draggedItem.itemIdx, 1);
    next[targetGroupIdx].items.push(moved);
    setGroups(next);
    setDraggedItem(null);
  };

  const handleRenameSupplier = (idx: number, newName: string) => {
    if (!groups) return;
    const next = [...groups];
    next[idx] = { ...next[idx], supplierName: newName.trim() || next[idx].supplierName };
    setGroups(next);
  };

  const handleAddSupplierBucket = () => {
    if (!groups) return;
    setGroups([
      ...groups,
      {
        supplierName: "New Supplier",
        supplierCode: null,
        supplierSource: null,
        confidence: 100,
        reason: "Manually created",
        items: [],
        needsManualAssignment: false,
      },
    ]);
  };

  const handleConfirm = () => {
    if (!groups) return;
    const nonEmpty = groups.filter(g => g.items.length > 0);
    if (nonEmpty.length === 0) {
      toast.error("No items to generate POs for");
      return;
    }
    confirmMutation.mutate({ previewToken: token, editedGroups: nonEmpty });
  };

  if (token.length === 0) {
    return (
      <DashboardLayout title="Purchase Order Preview">
        <div className="text-center py-20">
          <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Invalid preview token</p>
          <Link href="/purchase-orders" className="text-[#654BF9] text-sm mt-2 inline-block">Back to Purchase Orders</Link>
        </div>
      </DashboardLayout>
    );
  }

  if (isLoading) {
    return (
      <DashboardLayout title="Purchase Order Preview">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-[#654BF9]" />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !data || !groups) {
    return (
      <DashboardLayout title="Purchase Order Preview">
        <div className="text-center py-20">
          <AlertCircle className="w-12 h-12 text-red-300 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Preview not found</p>
          <p className="text-sm text-gray-500 mt-1">{error?.message || "This preview may have expired or been confirmed."}</p>
          <Link href="/purchase-orders" className="text-[#654BF9] text-sm mt-4 inline-block">Back to Purchase Orders</Link>
        </div>
      </DashboardLayout>
    );
  }

  const flagged = groups.filter(g => g.needsManualAssignment);
  const ok = groups.filter(g => !g.needsManualAssignment);
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);
  const sourceProposalIds = data.sourceProposalIds as number[];

  return (
    <DashboardLayout title="Purchase Order Preview" subtitle={`${groups.length} suppliers · ${totalItems} items · ${sourceProposalIds.length} source proposal${sourceProposalIds.length !== 1 ? "s" : ""}`}>
      <div className="flex items-center justify-between mb-5">
        <Link href="/purchase-orders" className="flex items-center gap-2 text-[12px] font-medium text-[#654BF9] hover:opacity-80">
          <ArrowLeft size={13} /> Back to Purchase Orders
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddSupplierBucket}
            className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[12px] font-medium text-[#1A1A1A] hover:bg-[#F8F8FA]"
          >
            + Add supplier
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmMutation.isPending}
            className="px-4 py-1.5 rounded-md text-white text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-50"
            style={{ backgroundColor: "#654BF9" }}
          >
            {confirmMutation.isPending ? (
              <><Loader2 className="size-3 animate-spin" /> Generating...</>
            ) : (
              <><CheckCircle2 className="size-3" /> Confirm & Generate POs</>
            )}
          </button>
        </div>
      </div>

      {flagged.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[13px] font-bold text-amber-700 mb-3 flex items-center gap-2">
            <AlertCircle className="size-4" /> Needs Review ({flagged.length})
          </h2>
          <div className="space-y-3">
            {flagged.map((g) => {
              const idx = groups.indexOf(g);
              return renderBucket(g, idx);
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[13px] font-bold text-[#1A1A1A] mb-3 flex items-center gap-2">
          <Sparkles className="size-4" style={{ color: "#654BF9" }} /> Supplier Groups ({ok.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ok.map((g) => {
            const idx = groups.indexOf(g);
            return renderBucket(g, idx);
          })}
        </div>
      </section>
    </DashboardLayout>
  );

  function renderBucket(g: Bucket, idx: number) {
    const subtotal = g.items.reduce((sum, it) => {
      const cost = parseFloat(it.basePrice || "0") || 0;
      return sum + cost * it.quantity;
    }, 0);

    return (
      <div
        key={`g-${idx}`}
        className="rounded-lg bg-white p-4"
        style={{ border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => handleDrop(idx)}
      >
        <div className="flex items-center justify-between mb-2">
          {editingNameIdx === idx ? (
            <input
              autoFocus
              defaultValue={g.supplierName}
              onBlur={(e) => { handleRenameSupplier(idx, e.target.value); setEditingNameIdx(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { handleRenameSupplier(idx, (e.target as HTMLInputElement).value); setEditingNameIdx(null); }
                if (e.key === "Escape") setEditingNameIdx(null);
              }}
              className="text-[13px] font-bold border-b border-[#654BF9] outline-none px-1"
            />
          ) : (
            <button
              className="flex items-center gap-1.5 group"
              onClick={() => setEditingNameIdx(idx)}
            >
              <span className="text-[13px] font-bold text-[#1A1A1A]">{g.supplierName}</span>
              <Edit2 className="size-3 text-gray-400 opacity-0 group-hover:opacity-100" />
            </button>
          )}
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={
              g.confidence >= 80
                ? { backgroundColor: "#ECFDF5", color: "#047857" }
                : g.confidence >= 50
                  ? { backgroundColor: "#FEF3C7", color: "#B45309" }
                  : { backgroundColor: "#FEE2E2", color: "#B91C1C" }
            }
          >
            {g.confidence}% confidence
          </span>
        </div>
        <p className="text-[10px] text-gray-500 mb-3">{g.reason}</p>

        <ul className="space-y-1.5 mb-3">
          {g.items.length === 0 ? (
            <li className="text-[11px] italic text-gray-400 py-3 text-center border border-dashed rounded-md" style={{ borderColor: "#E5E7EB" }}>
              Drop items here
            </li>
          ) : g.items.map((it, j) => (
            <li
              key={`${idx}-${j}-${it.orderItemId}`}
              draggable
              onDragStart={() => handleDragStart(idx, j)}
              className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded cursor-move"
              style={{ backgroundColor: "#F8F8FA" }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Package className="size-3 text-gray-400 shrink-0" />
                <span className="truncate font-medium text-[#1A1A1A]">{it.productName}</span>
              </span>
              <span className="text-gray-500 shrink-0">
                {it.quantity} × ${(parseFloat(it.basePrice || "0") || 0).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between text-[11px] pt-2" style={{ borderTop: "1px solid #E5E7EB" }}>
          <span className="text-gray-500">{g.items.length} item{g.items.length !== 1 ? "s" : ""}</span>
          <span className="font-bold text-[#1A1A1A]">${subtotal.toFixed(2)}</span>
        </div>
      </div>
    );
  }
}
