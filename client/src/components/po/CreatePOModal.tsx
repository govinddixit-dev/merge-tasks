/**
 * CreatePOModal.tsx — shared reusable "Create Purchase Order" modal.
 *
 * Triggered from three entry points:
 *   1. ProposalDetail (accepted proposals)
 *   2. Estimate row action (sent / acknowledged only)
 *   3. Invoice row action
 *
 * Presents exactly two options:
 *   - Single PO         → one PO for the entire document, cost pricing only.
 *                         Lands directly in the PO tab.
 *   - Auto-Aggregate PO → AI groups line items by supplier, one PO per supplier.
 *                         Lands in the AI Inbox for distributor review first.
 *                         Multiple documents in one call consolidate into a
 *                         single inbox task.
 *
 * The modal blurs the dashboard behind it via `backdrop-blur-sm` on the overlay.
 */
import { useLocation } from "wouter";
import { Sparkles, FileStack, Loader2, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export type CreatePOSource =
  | { kind: "proposal"; proposalIds: number[]; label: string }
  | { kind: "estimate"; estimateIds: number[]; label: string }
  | { kind: "invoice"; invoiceIds: number[]; label: string };

interface Props {
  open: boolean;
  onClose: () => void;
  source: CreatePOSource | null;
}

export default function CreatePOModal({ open, onClose, source }: Props) {
  const [, navigate] = useLocation();

  const singleMut = trpc.purchaseOrders.generateSingleFromProposal.useMutation({
    onSuccess: (res) => {
      toast.success(`Created PO ${res.poNumber}`);
      onClose();
      navigate("/purchase-orders");
    },
    onError: (err) => toast.error(err.message),
  });

  const queueMut = trpc.purchaseOrders.queueAutoAggregateReview.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.groupCount > 0
          ? `Sent to AI Inbox — ${res.groupCount} supplier group${res.groupCount === 1 ? "" : "s"} ready to review`
          : "Sent to AI Inbox for review",
      );
      onClose();
      navigate("/agent-inbox");
    },
    onError: (err) => toast.error(err.message),
  });

  if (!open || !source) return null;

  const pending = singleMut.isPending || queueMut.isPending;

  const triggerSingle = () => {
    if (!source) return;
    // Single-PO path only supports a single source document for now. The
    // entry points never hand us more than one at a time.
    if (source.kind === "proposal") {
      const id = source.proposalIds[0];
      if (id == null) return;
      singleMut.mutate({ proposalId: id });
    } else if (source.kind === "estimate") {
      const id = source.estimateIds[0];
      if (id == null) return;
      singleMut.mutate({ estimateId: id });
    } else {
      const id = source.invoiceIds[0];
      if (id == null) return;
      singleMut.mutate({ invoiceId: id });
    }
  };

  const triggerAuto = () => {
    if (!source) return;
    if (source.kind === "proposal") {
      queueMut.mutate({ proposalIds: source.proposalIds });
    } else if (source.kind === "estimate") {
      queueMut.mutate({ estimateIds: source.estimateIds });
    } else {
      queueMut.mutate({ invoiceIds: source.invoiceIds });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onClick={() => { if (!pending) onClose(); }}
    >
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-[560px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-mt-border flex items-start justify-between">
          <div>
            <h3 className="text-[15px] font-bold text-mt-ink flex items-center gap-2">
              <ShieldCheck size={15} className="text-primary" /> Create Purchase Order
            </h3>
            <p className="text-[12px] text-mt-ink-4 mt-1">
              {source.label} — POs use supplier cost pricing only, never client-facing pricing.
            </p>
          </div>
          <button
            onClick={() => { if (!pending) onClose(); }}
            className="p-1 rounded hover:bg-mt-surface-2 disabled:opacity-50"
            disabled={pending}
            aria-label="Close"
          >
            <X size={14} className="text-mt-ink-4" />
          </button>
        </div>

        <div className="p-5 grid gap-3">
          <button
            onClick={triggerSingle}
            disabled={pending}
            className="text-left border border-mt-border rounded-lg p-4 hover:border-primary/60 hover:bg-mt-brand-light/40 transition-colors disabled:opacity-60"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-mt-surface-2 flex items-center justify-center flex-shrink-0">
                <FileStack size={16} className="text-mt-ink-2" />
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-mt-ink flex items-center gap-2">
                  Single PO
                  {singleMut.isPending && <Loader2 size={12} className="animate-spin" />}
                </div>
                <div className="text-[12px] text-mt-ink-4 mt-0.5">
                  One PO for the entire document using cost/wholesale pricing.
                  Placed directly in the Purchase Orders tab.
                </div>
              </div>
            </div>
          </button>

          <button
            onClick={triggerAuto}
            disabled={pending}
            className="text-left border border-mt-border rounded-lg p-4 hover:border-primary/60 hover:bg-mt-brand-light/40 transition-colors disabled:opacity-60"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
                <Sparkles size={16} className="text-violet-600" />
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-mt-ink flex items-center gap-2">
                  Auto-Aggregate PO
                  {queueMut.isPending && <Loader2 size={12} className="animate-spin" />}
                </div>
                <div className="text-[12px] text-mt-ink-4 mt-0.5">
                  AI groups line items by supplier and creates one PO per supplier.
                  Lands in the AI Inbox for review before anything is pushed to the PO tab.
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
