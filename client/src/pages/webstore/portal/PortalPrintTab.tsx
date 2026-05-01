/**
 * PortalPrintTab — Print request list + submission form.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Printer, Plus, Send, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { StatusBadge } from "./portalHelpers";

const PRINT_CATEGORIES = [
  { value: "business_cards", label: "Business Cards" },
  { value: "envelopes", label: "Envelopes" },
  { value: "letterhead", label: "Letterhead" },
  { value: "brochures", label: "Brochures" },
  { value: "flyers", label: "Flyers" },
  { value: "banners", label: "Banners" },
  { value: "signage", label: "Signage" },
  { value: "promotional", label: "Promotional" },
  { value: "packaging", label: "Packaging" },
  { value: "other", label: "Other" },
];

interface PrintTabProps {
  storeSlug: string;
  pc: string;
}

export function PortalPrintTab({ storeSlug, pc }: PrintTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    category: "business_cards" as "business_cards" | "envelopes" | "letterhead" | "brochures" | "flyers" | "banners" | "signage" | "promotional" | "packaging" | "other",
    title: "",
    description: "",
    quantity: 100,
  });

  const utils = trpc.useUtils();
  const { data: requests, isLoading } = trpc.storePortal.print.list.useQuery(
    { storeSlug },
    { retry: false }
  );

  const submitMut = trpc.storePortal.print.submit.useMutation({
    onSuccess: () => {
      toast.success("Print request submitted");
      setShowForm(false);
      setFormData({ category: "business_cards", title: "", description: "", quantity: 100 });
      utils.storePortal.print.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't submit the request — please try again");
    },
  });

  if (isLoading) return <MergeTasksLoader variant="inline" message="Loading print requests..." />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[16px] font-bold text-mt-ink">Print Requests</h3>
          <p className="text-[12px] text-mt-ink-3">Submit print and decoration requests to your distributor</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white"
          style={{ backgroundColor: pc }}
        >
          <Plus size={14} /> New Request
        </button>
      </div>

      {/* Submit Form */}
      {showForm && (
        <div className="border border-mt-border rounded-lg p-5 bg-mt-surface">
          <h4 className="text-[14px] font-bold text-mt-ink mb-4">New Print Request</h4>
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Category</label>
              <select
                value={formData.category}
                onChange={e => setFormData(f => ({ ...f, category: e.target.value as "business_cards" | "envelopes" | "letterhead" | "brochures" | "flyers" | "banners" | "signage" | "promotional" | "packaging" | "other" }))}
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none"
              >
                {PRINT_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                value={formData.quantity}
                onChange={e => setFormData(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Title</label>
            <input
              type="text"
              placeholder="e.g., Q2 Business Cards — Marketing Team"
              value={formData.title}
              onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none"
            />
          </div>
          <div className="mb-4">
            <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Description / Specs</label>
            <textarea
              rows={3}
              placeholder="Include paper weight, finish, colors, any special instructions..."
              value={formData.description}
              onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!formData.title.trim()) {
                  toast.error("Please enter a title");
                  return;
                }
                submitMut.mutate({
                  storeSlug,
                  category: formData.category,
                  title: formData.title,
                  description: formData.description || undefined,
                  quantity: formData.quantity,
                });
              }}
              disabled={submitMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: pc }}
            >
              <Send size={13} /> {submitMut.isPending ? "Submitting..." : "Submit Request"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Request List */}
      {!requests || requests.length === 0 ? (
        <div className="text-center py-12 border border-mt-border rounded-lg">
          <Printer size={32} className="mx-auto mb-3 text-[#D4D4D4]" />
          <p className="text-[14px] font-semibold text-mt-ink mb-1">No print requests</p>
          <p className="text-[12px] text-mt-ink-3">Click "New Request" to submit your first print order</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="border border-mt-border rounded-lg px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${pc}15` }}>
                    <Printer size={16} style={{ color: pc }} />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-mt-ink">{r.title}</p>
                    <p className="text-[11px] text-mt-ink-3">
                      {PRINT_CATEGORIES.find(c => c.value === r.category)?.label || r.category} · Qty: {r.quantity} · {formatDate(r.createdAt)}
                    </p>
                  </div>
                </div>
                <StatusBadge status={r.status} pc={pc} />
              </div>
              {r.description && (
                <p className="text-[12px] text-mt-ink-2 mt-2">{r.description}</p>
              )}
              {r.quotedPrice && (
                <div className="mt-2 flex items-center gap-2 text-[12px]">
                  <DollarSign size={13} style={{ color: pc }} />
                  <span className="font-semibold text-mt-ink">Quoted: {formatCurrency(r.quotedPrice)}</span>
                  {r.estimatedDelivery && (
                    <span className="text-mt-ink-3">· Est. delivery: {formatDate(r.estimatedDelivery)}</span>
                  )}
                </div>
              )}
              {r.distributorNotes && (
                <div className="mt-2 text-[12px] text-mt-ink-2 bg-mt-surface rounded-lg p-3 border border-[#F5F5F5]">
                  <span className="font-semibold">Distributor notes:</span> {r.distributorNotes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
