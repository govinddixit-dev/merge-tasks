/**
 * OrderSummary.tsx — Bottom drawer with order items, inline order list
 * summary below the product carousel, and the submit CTA.
 */
import React from "react";
import { ShoppingCart, Package, X, Loader2 } from "lucide-react";
import type { OrderItem } from "./publicProposalTypes";

// ── Bottom Drawer ─────────────────────────────────────────────────────

interface DrawerProps {
  orderItems: OrderItem[];
  showSummary: boolean;
  setShowSummary: (v: boolean) => void;
  subtotal: number;
  primaryColor: string;
  submitting: boolean;
  onRemoveItem: (itemId: number | undefined, index: number) => void;
  onClear: () => void;
  onSubmit: () => void;
}

export function OrderDrawer({
  orderItems, showSummary, setShowSummary, subtotal,
  primaryColor, submitting, onRemoveItem, onClear, onSubmit,
}: DrawerProps) {
  return (
    <>
      {/* Overlay */}
      {showSummary && <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowSummary(false)} />}

      {/* Drawer */}
      <div
        className="fixed left-0 right-0 bottom-0 z-50 bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] transition-transform duration-300 ease-in-out flex flex-col"
        style={{ maxHeight: "75vh", borderRadius: "16px 16px 0 0", transform: showSummary ? "translateY(0)" : "translateY(100%)" }}
      >
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-mt-border-2" /></div>

        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #E5E5E5" }}>
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} style={{ color: primaryColor }} />
            <h3 className="text-[16px] font-bold text-mt-ink">Order Summary</h3>
            {orderItems.length > 0 && (
              <span className="text-[11px] font-bold text-white px-2 py-0.5 rounded-full" style={{ backgroundColor: primaryColor }}>{orderItems.length}</span>
            )}
          </div>
          <button className="p-1.5 rounded-full hover:bg-mt-surface-2 transition-colors" onClick={() => setShowSummary(false)}>
            <X size={16} className="text-mt-ink-3" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-2">
          {orderItems.length === 0 ? (
            <div className="text-center py-10">
              <ShoppingCart size={32} className="text-[#D4D4D4] mx-auto mb-3" />
              <p className="text-[13px] text-mt-ink-4">Your order list is empty</p>
              <p className="text-[11px] text-[#D4D4D4] mt-1">Add products to get started</p>
            </div>
          ) : (
            <>
              {orderItems.map((item, idx) => (
                <div key={item.id || idx} className="flex items-center gap-3 py-3" style={{ borderBottom: idx < orderItems.length - 1 ? "1px solid #F5F5F5" : "none" }}>
                  <div className="w-12 h-12 bg-[#F8F8FA] rounded flex items-center justify-center p-1 flex-shrink-0">
                    {item.productImage ? <img src={item.productImage} alt="" className="max-h-full max-w-full object-contain" /> : <Package size={16} className="text-[#D4D4D4]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-mt-ink truncate">
                      {item.productName || "Product"} <span className="text-mt-ink-4 font-normal">&times; {item.quantity}</span>
                    </p>
                    <p className="text-[11px] text-mt-ink-4">{[item.color, item.size].filter(Boolean).join(" \u00b7 ") || "Default"}</p>
                  </div>
                  <span className="text-[13px] font-bold text-mt-ink flex-shrink-0">${(parseFloat(item.unitPrice || "0") * item.quantity).toFixed(2)}</span>
                  <button className="p-1 hover:bg-mt-surface-2 rounded transition-colors flex-shrink-0" onClick={() => onRemoveItem(item.id, idx)}>
                    <X size={12} className="text-mt-ink-4" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        {orderItems.length > 0 && (
          <div className="px-5 py-4" style={{ borderTop: "1px solid #E5E5E5" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] font-bold text-mt-ink">Sub Total</span>
              <span className="text-[18px] font-bold text-mt-ink">$ {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 text-[11px] font-medium text-[#DC2626] border border-[#FECACA] rounded-md py-2.5 hover:bg-[#FEF2F2] transition-colors" onClick={onClear}>Clear All</button>
              <button
                className="flex-1 py-2.5 text-[12px] font-bold text-white rounded-md hover:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ backgroundColor: primaryColor }}
                onClick={() => { setShowSummary(false); onSubmit(); }}
                disabled={submitting}
              >
                {submitting ? <><Loader2 size={14} className="animate-spin" /> Submitting...</> : <>Submit &rarr;</>}
              </button>
            </div>
            {/* Tier 2 compliance touchpoint — proposal acceptance consent */}
            <p className="text-[10px] text-mt-ink-4 text-center mt-2 leading-relaxed">
              By submitting, you agree to MergeTasks'{" "}
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-mt-ink-3">Terms</a>
              {" "}and{" "}
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-mt-ink-3">Privacy Policy</a>.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

// ── Inline Order List Summary ─────────────────────────────────────────

interface InlineProps {
  orderItems: OrderItem[];
  subtotal: number;
  summaryRef: React.RefObject<HTMLDivElement | null>;
}

export function InlineOrderSummary({ orderItems, subtotal, summaryRef }: InlineProps) {
  if (orderItems.length === 0) return null;

  return (
    <div ref={summaryRef} className="mb-8">
      <h3 className="text-[18px] font-bold text-mt-ink text-center mb-5">Order List Summary</h3>
      <div className="max-w-[600px] mx-auto">
        {orderItems.map((item, idx) => (
          <div key={item.id || idx} className="flex items-center gap-4 py-3" style={{ borderBottom: idx < orderItems.length - 1 ? "1px solid #F0F0F0" : "none" }}>
            <div className="w-14 h-14 bg-[#1A1A1A] rounded flex items-center justify-center p-1 flex-shrink-0">
              {item.productImage ? <img src={item.productImage} alt="" className="max-h-full max-w-full object-contain" /> : <Package size={18} className="text-mt-ink-3" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-mt-ink">{item.productName || "Product"} <span className="text-mt-ink-4 font-normal">&times; {item.quantity}</span></p>
              <p className="text-[13px] text-mt-ink-4">${(parseFloat(item.unitPrice || "0") * item.quantity).toFixed(2)}</p>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between pt-4 mt-2" style={{ borderTop: "1px solid #E5E5E5" }}>
          <span className="text-[15px] font-bold text-mt-ink">Sub Total</span>
          <span className="text-[18px] font-bold text-mt-ink">$ {subtotal.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Floating Order Button ─────────────────────────────────────────────

interface FloatingProps {
  orderItems: OrderItem[];
  showSummary: boolean;
  setShowSummary: (v: boolean) => void;
  subtotal: number;
  primaryColor: string;
}

export function FloatingOrderButton({ orderItems, showSummary, setShowSummary, subtotal, primaryColor }: FloatingProps) {
  if (orderItems.length === 0 || showSummary) return null;

  return (
    <button
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-5 py-3 rounded-full shadow-lg transition-all hover:shadow-xl hover:scale-[1.02] active:scale-[0.97]"
      style={{ backgroundColor: primaryColor }}
      onClick={() => setShowSummary(true)}
    >
      <ShoppingCart size={15} className="text-white" />
      <span className="text-[12px] font-bold text-white">{orderItems.length} item{orderItems.length > 1 ? "s" : ""}</span>
      <span className="text-[12px] font-bold text-white/50">&middot;</span>
      <span className="text-[12px] font-bold text-white">${subtotal.toFixed(2)}</span>
    </button>
  );
}
