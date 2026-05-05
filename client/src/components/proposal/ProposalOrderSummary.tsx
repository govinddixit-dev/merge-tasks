/**
 * ProposalOrderSummary.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Three co-located order-summary UI pieces for the Proposal Detail view:
 *   1. Inline order list table with subtotal
 *   2. Floating vertical tab (when panel is closed)
 *   3. Slide-out panel overlay (when panel is open)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ShoppingCart, X, Sparkles, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

export interface OrderItem {
  productId: number;
  name: string;
  qty: number;
  price: number;
  imageUrl: string | null;
  proofImageUrl: string | null;
}

interface ProposalOrderSummaryProps {
  orderItems: OrderItem[];
  subtotal: number;
  showSummary: boolean;
  onShowSummary: (show: boolean) => void;
  onRemoveItem: (index: number) => void;
}

export default function ProposalOrderSummary({
  orderItems,
  subtotal,
  showSummary,
  onShowSummary,
  onRemoveItem,
}: ProposalOrderSummaryProps) {
  return (
    <>
      {/* ── Inline order list table ─────────────────────────────────────── */}
      {orderItems.length > 0 && (
        <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-6">
          <div
            className="px-5 py-3 flex items-center justify-between"
            style={{ borderBottom: "1px solid #F0F0F0" }}
          >
            <h3 className="text-[14px] font-bold text-mt-ink">Order List Summary</h3>
            <span className="text-[11px] text-mt-ink-4">
              {orderItems.length} item{orderItems.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="px-5 py-2">
            {orderItems.map((item, idx) => (
              <div
                key={item.productId}
                className="flex items-center gap-3 py-2.5"
                style={{
                  borderBottom: idx < orderItems.length - 1 ? "1px solid #F5F5F5" : "none",
                }}
              >
                <div className="w-10 h-10 bg-[#F8F8FA] rounded flex items-center justify-center p-1 flex-shrink-0">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-mt-ink truncate">
                    {item.name}{" "}
                    <span className="text-mt-ink-4 font-normal">x {item.qty}</span>
                  </p>
                  {item.proofImageUrl && (
                    <p className="text-[9px] text-primary flex items-center gap-1">
                      <Sparkles size={8} /> AI Proof Applied
                    </p>
                  )}
                </div>
                <span className="text-[12px] font-bold text-mt-ink flex-shrink-0">
                  ${(item.price * item.qty).toFixed(2)}
                </span>
                <button
                  className="p-1 hover:bg-mt-surface-2 rounded transition-colors flex-shrink-0"
                  onClick={() => onRemoveItem(idx)}
                >
                  <X size={11} className="text-mt-ink-4" />
                </button>
              </div>
            ))}
          </div>
          <div
            className="px-5 py-3 flex items-center justify-between"
            style={{ borderTop: "1px solid #E5E5E5" }}
          >
            <span className="text-[13px] font-bold text-mt-ink">Sub Total</span>
            <span className="text-[16px] font-bold text-mt-ink">$ {subtotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* ── Floating vertical tab ───────────────────────────────────────── */}
      {orderItems.length > 0 && !showSummary && (
        <button
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-primary text-white px-2 py-5 rounded-l-lg shadow-lg hover:bg-primary/90 transition-colors"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
          onClick={() => onShowSummary(true)}
        >
          <span className="text-[10px] font-bold tracking-wider flex items-center gap-1.5">
            <ShoppingCart size={11} /> Order Summary ({orderItems.length})
          </span>
        </button>
      )}

      {/* ── Slide-out panel ─────────────────────────────────────────────── */}
      {showSummary && (
        <div
          className="fixed inset-0 z-[10002] flex justify-end"
          style={{ backgroundColor: "rgba(0,0,0,0.3)", backdropFilter: "blur(4px)" }}
          onClick={() => onShowSummary(false)}
        >
          <div
            className="w-full sm:w-[380px] h-full bg-white shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: "1px solid #E5E5E5" }}
            >
              <h3 className="text-[14px] font-bold text-mt-ink">Order List Summary</h3>
              <button
                className="p-1 hover:bg-mt-surface-2 rounded-lg transition-colors"
                onClick={() => onShowSummary(false)}
              >
                <X size={14} className="text-mt-ink-4" />
              </button>
            </div>
            <div className="px-5 py-3">
              {orderItems.map((item) => (
                <div
                  key={item.productId}
                  className="flex items-center gap-3 py-2.5"
                  style={{ borderBottom: "1px solid #F5F5F5" }}
                >
                  <div className="w-12 h-12 bg-[#F8F8FA] rounded flex items-center justify-center p-1.5 flex-shrink-0">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-mt-ink truncate">
                      {item.name}{" "}
                      <span className="text-mt-ink-4 font-normal">x {item.qty}</span>
                    </p>
                  </div>
                  <span className="text-[12px] font-bold text-mt-ink flex-shrink-0">
                    ${(item.price * item.qty).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-5 py-4" style={{ borderTop: "1px solid #E5E5E5" }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[13px] font-bold text-mt-ink">Sub Total</span>
                <span className="text-[18px] font-bold text-mt-ink">$ {subtotal.toFixed(2)}</span>
              </div>
              <button
                className="w-full py-2.5 bg-[#1A1A1A] text-white text-[12px] font-bold rounded-lg hover:bg-[#333] transition-colors flex items-center justify-center gap-2"
                onClick={() => {
                  onShowSummary(false);
                  toast.success("Order submitted");
                }}
              >
                Submit Order →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
