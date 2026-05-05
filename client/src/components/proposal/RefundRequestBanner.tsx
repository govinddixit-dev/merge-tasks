/**
 * RefundRequestBanner — shown on ProposalDetail when a POC has submitted a refund request.
 * Distributor can approve (opens RefundDialog) or deny inline.
 */
import { useState } from "react";
import { AlertCircle, CheckCircle2, XCircle, Loader2, DollarSign } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import RefundDialog from "./RefundDialog";

interface Props {
  proposalId: number;
  proposalTitle: string;
  estimatedValue: string | null;
}

export default function RefundRequestBanner({ proposalId, proposalTitle, estimatedValue }: Props) {
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [denyReason, setDenyReason] = useState("");

  const { data: request, isLoading, refetch } = trpc.refunds.getRequestForProposal.useQuery(
    { proposalId },
    { enabled: proposalId > 0 }
  );

  const denyMutation = trpc.refunds.denyRequest.useMutation({
    onSuccess: () => {
      toast.success("Refund request denied");
      setShowDenyInput(false);
      setDenyReason("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !request) return null;

  // Already resolved
  if (request.status === "approved") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg px-5 py-3 mb-5 flex items-center gap-3">
        <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-[12px] font-semibold text-green-800">Refund Approved</p>
          <p className="text-[11px] text-green-700 mt-0.5">
            Refund was processed for this proposal.
            {request.responseNote && <span className="ml-1 italic">"{request.responseNote}"</span>}
          </p>
        </div>
      </div>
    );
  }

  if (request.status === "denied") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-3 mb-5 flex items-center gap-3">
        <XCircle size={16} className="text-red-500 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-[12px] font-semibold text-red-800">Refund Request Denied</p>
          <p className="text-[11px] text-red-700 mt-0.5">
            {request.responseNote && <span className="italic">"{request.responseNote}"</span>}
          </p>
        </div>
      </div>
    );
  }

  // Pending — show action buttons
  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-4 mb-5">
        <div className="flex items-start gap-3">
          <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[12px] font-bold text-amber-900">Refund Requested</p>
            <p className="text-[11px] text-amber-800 mt-1">
              <strong>{request.pocName || request.pocEmail}</strong> has requested a refund for this proposal.
            </p>
            <p className="text-[11px] text-amber-700 mt-1 italic">"{request.reason}"</p>
            <p className="text-[10px] text-amber-600 mt-1">
              Submitted {request.createdAt ? new Date(request.createdAt).toLocaleDateString() : "recently"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowRefundDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white rounded-md bg-green-600 hover:bg-green-700 transition-colors"
            >
              <DollarSign size={11} /> Approve & Refund
            </button>
            <button
              onClick={() => setShowDenyInput(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
            >
              <XCircle size={11} /> Deny
            </button>
          </div>
        </div>

        {/* Inline deny reason input */}
        {showDenyInput && (
          <div className="mt-3 pt-3 border-t border-amber-200">
            <label className="text-[11px] font-semibold text-amber-900 block mb-1">Reason for denial</label>
            <textarea
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="Explain why this refund request is being denied..."
              className="w-full text-[12px] border border-amber-300 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              rows={2}
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => denyMutation.mutate({ requestId: request.id, responseNote: denyReason })}
                disabled={!denyReason.trim() || denyMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 transition-colors"
              >
                {denyMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
                Confirm Denial
              </button>
              <button
                onClick={() => { setShowDenyInput(false); setDenyReason(""); }}
                className="text-[11px] text-amber-700 hover:text-amber-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Refund Dialog */}
      {showRefundDialog && (
        <RefundDialog
          entityType="proposal"
          entityId={proposalId}
          entityTitle={proposalTitle}
          maxAmount={parseFloat(estimatedValue || "0")}
          requestId={request.id}
          onClose={() => setShowRefundDialog(false)}
          onSuccess={() => {
            setShowRefundDialog(false);
            refetch();
          }}
        />
      )}
    </>
  );
}
