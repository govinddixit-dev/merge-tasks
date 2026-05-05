/**
 * FulfillmentSection.tsx — "All Departments Approved" banner,
 * fulfillment request dialog modal, and fulfillment-requested banner.
 */
import { useState } from "react";
import { Check, Truck, X, Loader2 } from "lucide-react";

interface Props {
  allApproved: boolean;
  deptCount: number;
  multiDepartment: boolean;
  fulfillmentRequested: boolean;
  setFulfillmentRequested: (v: boolean) => void;
  token: string;
}

export function FulfillmentSection({
  allApproved, deptCount, multiDepartment,
  fulfillmentRequested, setFulfillmentRequested, token,
}: Props) {
  const [showDialog, setShowDialog] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [requesting, setRequesting] = useState(false);

  const handleRequest = async () => {
    setRequesting(true);
    try {
      const res = await fetch(`/api/proposals/public/${token}/request-fulfillment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: name.trim() || undefined, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request fulfillment");
      setFulfillmentRequested(true);
      setShowDialog(false);
    } catch (err: unknown) {
      // parent handles toast
    } finally { setRequesting(false); }
  };

  return (
    <>
      {/* All approved — send for fulfillment CTA */}
      {multiDepartment && allApproved && !fulfillmentRequested && (
        <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-5 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-[#16A34A] flex items-center justify-center">
              <Check size={18} className="text-white" />
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#166534]">All Departments Approved</p>
              <p className="text-[12px] text-[#15803D]">All {deptCount} departments have approved this proposal.</p>
            </div>
          </div>
          <button
            className="px-5 py-2.5 text-[12px] font-bold text-white rounded-md hover:opacity-90 transition-colors flex items-center gap-1.5"
            style={{ backgroundColor: "#16A34A" }}
            onClick={() => setShowDialog(true)}
          >
            <Truck size={14} /> Send for Fulfillment
          </button>
        </div>
      )}

      {/* Fulfillment already requested banner */}
      {fulfillmentRequested && (
        <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4 flex items-center gap-3 mb-6">
          <Truck size={20} className="text-[#2563EB] shrink-0" />
          <div>
            <p className="text-[14px] font-semibold text-[#1E40AF]">Fulfillment Requested</p>
            <p className="text-[12px] text-[#3B82F6]">This proposal has been sent for fulfillment. Your distributor will be in touch.</p>
          </div>
        </div>
      )}

      {/* Fulfillment dialog modal */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDialog(false)}>
          <div className="bg-white rounded-lg w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 bg-[#F8F8FA] border-b border-mt-border flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-mt-ink">Request Fulfillment</h3>
              <button className="p-1 hover:bg-[#E5E5E5] rounded" onClick={() => setShowDialog(false)}><X size={16} /></button>
            </div>
            <div className="p-5">
              <div className="mb-4">
                <label className="text-[12px] font-semibold text-mt-ink mb-1.5 block">Your Name</label>
                <input className="w-full px-3 py-2 text-[13px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white" placeholder="Enter your name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="mb-5">
                <label className="text-[12px] font-semibold text-mt-ink mb-1.5 block">Notes (optional)</label>
                <textarea className="w-full h-20 px-3 py-2 text-[13px] border border-mt-border rounded-md outline-none focus:border-[#999] resize-none bg-white" placeholder="Any special instructions for fulfillment..." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <button
                className="w-full py-2.5 text-[13px] font-bold text-white rounded-md hover:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ backgroundColor: "#16A34A" }}
                onClick={handleRequest}
                disabled={requesting}
              >
                {requesting ? <><Loader2 size={14} className="animate-spin" /> Sending...</> : <><Truck size={14} /> Send for Fulfillment</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
