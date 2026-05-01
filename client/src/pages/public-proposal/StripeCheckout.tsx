/**
 * StripeCheckout.tsx — Stripe checkout section with product selection
 * checkboxes and "Pay with Stripe" CTA.
 */
import { useMemo } from "react";
import { CreditCard, Package, Loader2 } from "lucide-react";
import type { ProposalProduct } from "./publicProposalTypes";

interface Props {
  products: ProposalProduct[];
  selectedForCheckout: Set<number>;
  toggleProductCheckout: (productId: number) => void;
  primaryColor: string;
  checkoutLoading: boolean;
  onCheckout: () => void;
}

export function StripeCheckout({
  products, selectedForCheckout, toggleProductCheckout,
  primaryColor, checkoutLoading, onCheckout,
}: Props) {
  const selectedTotal = useMemo(() => {
    return products
      .filter(p => selectedForCheckout.has(p.productId))
      .reduce((sum, p) => sum + parseFloat(p.unitPrice || "0") * p.quantity, 0);
  }, [products, selectedForCheckout]);

  return (
    <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-6">
      <div className="px-5 py-3.5 bg-[#2A2A2A] flex items-center gap-2">
        <CreditCard size={15} className="text-white" />
        <h3 className="text-[14px] font-bold text-white">Secure Checkout</h3>
      </div>
      <div className="p-5">
        <p className="text-[12px] text-mt-ink-2 mb-4">Select products to checkout with Stripe. Your payment is secure and encrypted.</p>
        <div className="space-y-2 mb-4">
          {products.map(p => (
            <label key={p.productId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-mt-surface transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={selectedForCheckout.has(p.productId)}
                onChange={() => toggleProductCheckout(p.productId)}
                className="rounded"
              />
              <div className="w-10 h-10 bg-[#F8F8FA] rounded flex items-center justify-center p-1 flex-shrink-0">
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="max-h-full max-w-full object-contain" /> : <Package size={14} className="text-[#D4D4D4]" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-mt-ink truncate">{p.name}</p>
                <p className="text-[11px] text-mt-ink-4">{p.quantity} &times; ${parseFloat(p.unitPrice || "0").toFixed(2)}</p>
              </div>
              <span className="text-[13px] font-bold text-mt-ink">${(parseFloat(p.unitPrice || "0") * p.quantity).toFixed(2)}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid #E5E5E5" }}>
          <span className="text-[14px] font-bold text-mt-ink">Selected Total: ${selectedTotal.toFixed(2)}</span>
          <button
            className="px-6 py-2.5 text-[12px] font-bold text-white rounded-md hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            style={{ backgroundColor: primaryColor }}
            onClick={onCheckout}
            disabled={checkoutLoading || selectedForCheckout.size === 0}
          >
            {checkoutLoading ? <><Loader2 size={14} className="animate-spin" /> Processing...</> : <><CreditCard size={14} /> Pay with Stripe</>}
          </button>
        </div>
      </div>
    </div>
  );
}
