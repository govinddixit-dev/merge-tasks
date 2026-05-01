/**
 * ProposalHeader.tsx — Logo, dark title banner, client info grid, and
 * summary stats card for the public proposal view.
 */
import { CheckCircle2, X, Info, AlertTriangle } from "lucide-react";
import type { ProposalData } from "./publicProposalTypes";
import { LOGO_URL, getExpirationInfo } from "./publicProposalTypes";

interface Props {
  proposal: ProposalData;
  primaryColor: string;
  brandName: string;
  brandLogo: string | null;
  checkoutStatus: "success" | "canceled" | null;
  setCheckoutStatus: (v: "success" | "canceled" | null) => void;
  editSuccess: boolean;
  setEditSuccess: (v: boolean) => void;
  approvedProofs: number;
}

export function ProposalHeader({
  proposal, primaryColor, brandName, brandLogo,
  checkoutStatus, setCheckoutStatus,
  editSuccess, setEditSuccess, approvedProofs,
}: Props) {
  const expiration = getExpirationInfo(proposal.validDays, proposal.sentAt);

  return (
    <>
      {/* CHECKOUT STATUS BANNERS */}
      {checkoutStatus === "success" && (
        <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-4 flex items-center gap-3 mb-5">
          <CheckCircle2 size={20} className="text-[#16A34A] shrink-0" />
          <div>
            <p className="text-[14px] font-semibold text-[#166534]">Payment Successful</p>
            <p className="text-[12px] text-[#15803D]">Thank you for your order! Your account manager will be in touch.</p>
          </div>
          <button onClick={() => setCheckoutStatus(null)} className="ml-auto p-1"><X size={14} className="text-[#16A34A]" /></button>
        </div>
      )}
      {checkoutStatus === "canceled" && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-4 flex items-center gap-3 mb-5">
          <Info size={20} className="text-[#D97706] shrink-0" />
          <div>
            <p className="text-[14px] font-semibold text-[#92400E]">Checkout Canceled</p>
            <p className="text-[12px] text-[#B45309]">No payment was processed. You can try again anytime.</p>
          </div>
          <button onClick={() => setCheckoutStatus(null)} className="ml-auto p-1"><X size={14} className="text-[#D97706]" /></button>
        </div>
      )}

      {/* EXPIRATION BANNER */}
      {expiration.expired && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-4 flex items-center gap-3 mb-5">
          <AlertTriangle size={20} className="text-[#DC2626] shrink-0" />
          <div>
            <p className="text-[14px] font-semibold text-[#DC2626]">This proposal has expired</p>
            <p className="text-[12px] text-[#991B1B]">Please contact your account manager for an updated proposal.</p>
          </div>
        </div>
      )}

      {/* BIG DISTRIBUTOR LOGO */}
      <div className="text-center mb-8 pt-2">
        {brandLogo ? (
          <img src={brandLogo} alt={brandName} className="h-20 mx-auto object-contain" />
        ) : (
          <img src={LOGO_URL} alt="MergeTasks" className="h-16 mx-auto object-contain" />
        )}
      </div>

      {/* PROPOSAL HEADER BAR (dark banner + Valid badge) */}
      <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-6">
        <div className="px-6 py-3.5 bg-[#2A2A2A] flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-white">{proposal.title}</h2>
          <span
            className="text-[11px] font-bold px-4 py-1.5 rounded-full text-white"
            style={{ backgroundColor: expiration.expired ? "#DC2626" : primaryColor }}
          >
            {expiration.expired ? "Expired" : `Valid until: ${proposal.validDays > 0 ? `${expiration.daysLeft} Days` : "\u221E"}`}
          </span>
        </div>

        {/* Client info grid */}
        <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-2">
          <div className="space-y-2">
            {([
              ["Name", proposal.client.contactName || "\u2014"],
              ["Company", proposal.client.companyName || "\u2014"],
              ["Address", proposal.client.address || "Contact for address"],
            ] as const).map(([label, val]) => (
              <div key={label} className="flex gap-4">
                <span className="text-[12px] font-bold text-mt-ink w-[80px] flex-shrink-0">{label}</span>
                <span className="text-[12px] text-mt-ink-2">{val}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {([
              ["Date", proposal.sentAt ? new Date(proposal.sentAt).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })],
              ["Phone", proposal.client.contactPhone || "\u2014"],
              ["Email Address", proposal.client.contactEmail || "\u2014"],
            ] as const).map(([label, val]) => (
              <div key={label} className="flex gap-4">
                <span className="text-[12px] font-bold text-mt-ink w-[100px] flex-shrink-0">{label}</span>
                <span className="text-[12px] text-mt-ink-2">{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PROPOSAL SUMMARY CARD */}
      <div className="bg-white rounded-lg border border-mt-border p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-[22px] font-bold text-mt-ink">{proposal.products.length}</p>
            <p className="text-[11px] text-mt-ink-4 uppercase tracking-wider">Products</p>
          </div>
          <div className="text-center">
            <p className="text-[22px] font-bold text-mt-ink">{proposal.validDays > 0 ? expiration.daysLeft : "\u221E"}</p>
            <p className="text-[11px] text-mt-ink-4 uppercase tracking-wider">Days Valid</p>
          </div>
          <div className="text-center">
            <p className="text-[22px] font-bold" style={{ color: primaryColor }}>{approvedProofs}</p>
            <p className="text-[11px] text-mt-ink-4 uppercase tracking-wider">Proofs Ready</p>
          </div>
          <div className="text-center">
            <p className="text-[22px] font-bold" style={{ color: proposal.status === "accepted" ? "#16A34A" : primaryColor }}>
              {proposal.status === "accepted" ? "Accepted" : proposal.status === "sent" ? "Active" : proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
            </p>
            <p className="text-[11px] text-mt-ink-4 uppercase tracking-wider">Status</p>
          </div>
        </div>
      </div>

      {/* EDIT SUCCESS BANNER */}
      {editSuccess && (
        <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-4 flex items-center gap-3 mb-5">
          <CheckCircle2 size={20} className="text-[#16A34A] shrink-0" />
          <div>
            <p className="text-[14px] font-semibold text-[#166534]">Changes Saved Successfully</p>
            <p className="text-[12px] text-[#15803D]">Your edits have been applied. You can request re-approval or proceed to fulfillment.</p>
          </div>
          <button onClick={() => setEditSuccess(false)} className="ml-auto p-1"><X size={14} className="text-[#16A34A]" /></button>
        </div>
      )}
    </>
  );
}
