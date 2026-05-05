/**
 * ProductCarousel.tsx — Horizontal scrollable carousel of all proposal
 * products with quick-add buttons.
 */
import { useRef } from "react";
import { Package, Plus, Check } from "lucide-react";
import type { ProposalProduct, OrderItem } from "./publicProposalTypes";
import { CATEGORY_LABELS } from "./publicProposalTypes";

interface Props {
  products: ProposalProduct[];
  selectedIndex: number;
  primaryColor: string;
  expired: boolean;
  orderItems: OrderItem[];
  onSelectProduct: (idx: number) => void;
  onQuickAdd: (product: ProposalProduct) => void;
}

export function ProductCarousel({
  products, selectedIndex, primaryColor, expired,
  orderItems, onSelectProduct, onQuickAdd,
}: Props) {
  const carouselRef = useRef<HTMLDivElement>(null);

  if (products.length <= 1) return null;

  return (
    <div className="mb-6">
      <h3 className="text-[16px] font-bold text-mt-ink mb-4">All Products</h3>
      <div ref={carouselRef} className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin", scrollBehavior: "smooth" }}>
        {products.map((p, idx) => {
          const isSelected = idx === selectedIndex;
          const isInOrder = orderItems.some(item => item.productId === p.productId);
          return (
            <div
              key={p.productId}
              className={`flex-shrink-0 w-[160px] cursor-pointer rounded-lg border overflow-hidden transition-all hover:shadow-md active:scale-[0.98] ${isSelected ? "ring-1" : "border-mt-border"}`}
              style={isSelected ? { borderColor: primaryColor, boxShadow: `0 0 0 1px ${primaryColor}` } : {}}
              onClick={() => onSelectProduct(idx)}
            >
              <div className="relative h-[130px] bg-[#F8F8FA] flex items-center justify-center p-3">
                {isInOrder && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#16A34A] flex items-center justify-center">
                    <Check size={10} color="#FFF" />
                  </div>
                )}
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="max-h-full max-w-full object-contain" />
                ) : (
                  <Package size={28} className="text-[#D4D4D4]" />
                )}
              </div>
              <div className="p-3">
                <p className="text-[10px] text-mt-ink-4 uppercase tracking-wider mb-0.5">
                  {CATEGORY_LABELS[p.category] || p.category}
                </p>
                <p className="text-[12px] font-semibold text-mt-ink truncate">{p.name}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[13px] font-bold text-mt-ink">
                    ${parseFloat(p.unitPrice || "0").toFixed(2)}
                  </span>
                  {!expired && (
                    <button
                      className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:opacity-80"
                      style={{ backgroundColor: primaryColor }}
                      onClick={(e) => { e.stopPropagation(); onQuickAdd(p); }}
                    >
                      <Plus size={14} color="#FFF" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
