/**
 * RefundDialog — modal for distributors to issue a full or partial refund.
 * Used from ProposalDetail (via RefundRequestBanner) or standalone.
 */
import { useState } from "react";
import { DollarSign, X, Loader2, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  entityType: "proposal" | "order" | "invoice";
  entityId: number;
  entityTitle: string;
  maxAmount: number;
  /** If triggered from a POC refund request, pass the request ID so the backend can auto-approve it */
  requestId?: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RefundDialog({
  entityType,
  entityId,
  entityTitle,
  maxAmount,
  requestId,
  onClose,
  onSuccess,
}: Props) {
  const [amount, setAmount] = useState(maxAmount.toFixed(2));
  const [reason, setReason] = useState(requestId ? "Approved POC refund request" : "");
  const [type, setType] = useState<"full" | "partial">("full");
  const [issueCreditNote, setIssueCreditNote] = useState(entityType === "invoice");

  const issueMutation = trpc.refunds.issueRefund.useMutation({
    onSuccess: (data) => {
      toast.success("Refund processed successfully");
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const parsedAmount = parseFloat(amount) || 0;
  const isValid = parsedAmount > 0 && parsedAmount <= maxAmount && reason.trim().length >= 3;

  const handleSubmit = () => {
    if (!isValid) return;
    // Convert dollars → cents for the backend (Stripe expects cents)
    const amountInCents = Math.round((type === "full" ? maxAmount : parsedAmount) * 100);
    issueMutation.mutate({
      entityType,
      entityId,
      amount: amountInCents,
      reason,
      requestId,
    });
  };

  return (
    <div className="fixed inset-0 z-[10002] bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-[#D97706] to-[#F59E0B] flex items-center justify-between">
          <div>
            <h3 className="text-white text-[16px] font-bold flex items-center gap-2">
              <DollarSign size={16} /> Issue Refund
            </h3>
            <p className="text-white/80 text-[12px] mt-0.5">Process a Stripe refund for this {entityType}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-full text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Entity info */}
          <div className="bg-[#FFFBEB] border border-amber-200 rounded-lg p-3">
            <p className="text-[11px] font-semibold text-amber-800">{entityType.charAt(0).toUpperCase() + entityType.slice(1)}</p>
            <p className="text-[13px] font-bold text-amber-900 mt-0.5">{entityTitle}</p>
            <p className="text-[12px] text-amber-700 mt-0.5">Maximum refundable: <strong>${maxAmount.toFixed(2)}</strong></p>
          </div>

          {/* Refund type toggle */}
          <div>
            <label className="text-[11px] font-semibold text-mt-ink block mb-2">Refund Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => { setType("full"); setAmount(maxAmount.toFixed(2)); }}
                className={`flex-1 py-2 text-[12px] font-semibold rounded-lg border transition-colors ${
                  type === "full"
                    ? "bg-amber-50 border-amber-400 text-amber-800"
                    : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                Full Refund
              </button>
              <button
                onClick={() => setType("partial")}
                className={`flex-1 py-2 text-[12px] font-semibold rounded-lg border transition-colors ${
                  type === "partial"
                    ? "bg-amber-50 border-amber-400 text-amber-800"
                    : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                Partial Refund
              </button>
            </div>
          </div>

          {/* Amount input (only for partial) */}
          {type === "partial" && (
            <div>
              <label className="text-[11px] font-semibold text-mt-ink block mb-1">Refund Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={maxAmount}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full text-[13px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              {parsedAmount > maxAmount && (
                <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                  <AlertTriangle size={10} /> Amount exceeds maximum refundable
                </p>
              )}
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="text-[11px] font-semibold text-mt-ink block mb-1">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why this refund is being issued..."
              className="w-full text-[12px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
              rows={2}
            />
          </div>

          {/* Invoice credit note option */}
          {entityType === "invoice" && (
            <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <input
                type="checkbox"
                id="creditNote"
                checked={issueCreditNote}
                onChange={(e) => setIssueCreditNote(e.target.checked)}
                className="mt-0.5 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="creditNote" className="text-[11px] text-blue-800 leading-relaxed cursor-pointer">
                <span className="font-semibold">Issue credit note</span> — Generate a formal credit note document linked to this invoice for accounting records.
              </label>
            </div>
          )}

          {/* Warning */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700">
              This will initiate a Stripe refund of <strong>${type === "full" ? maxAmount.toFixed(2) : parsedAmount.toFixed(2)}</strong>.
              This action cannot be undone.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#F8F8FA] flex items-center justify-end gap-3" style={{ borderTop: "1px solid #E5E5E5" }}>
          <button
            onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || issueMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 transition-colors"
          >
            {issueMutation.isPending ? (
              <><Loader2 size={12} className="animate-spin" /> Processing...</>
            ) : (
              <><DollarSign size={12} /> Process Refund</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
