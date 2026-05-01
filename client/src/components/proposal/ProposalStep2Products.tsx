/**
 * ProposalStep2Products
 * Step 2 of the Create Proposal wizard — Product selection
 */

import { Search, Printer, DollarSign } from "lucide-react";

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  image: string;
  supplier: string;
}

interface Props {
  filteredProducts: Product[];
  selectedProducts: Set<number>;
  quantities: Record<number, number>;
  productSearch: string;
  setProductSearch: (v: string) => void;
  toggleProduct: (id: number) => void;
  setQuantities: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  totalValue: number;
  /**
   * DB id of the selected existing client. When null/undefined the Set Pricing
   * affordance is omitted — new-client proposals can't have client-specific
   * pricing configured until the client row is persisted.
   */
  clientDbId?: number | null;
  /** Opens the PriceMatrixModal for the given product. Required when clientDbId is set. */
  onOpenPriceMatrix?: (product: Product) => void;
}

export default function ProposalStep2Products({
  filteredProducts, selectedProducts, quantities,
  productSearch, setProductSearch, toggleProduct, setQuantities, totalValue,
  clientDbId, onOpenPriceMatrix,
}: Props) {
  return (
    <div className="bg-white rounded-xl border border-mt-border p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-mt-ink mb-1">Select Products</h2>
          <p className="text-[13px] text-mt-ink-3">{selectedProducts.size} selected · ${totalValue.toLocaleString()} est. value</p>
        </div>
      </div>
      <div className="flex items-center gap-3 px-4 py-2.5 bg-mt-surface rounded-lg border border-mt-border">
        <Search size={14} className="text-mt-ink-4" />
        <input className="flex-1 text-[13px] outline-none bg-transparent" placeholder="Search products..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {filteredProducts.map((p) => {
          const isSelected = selectedProducts.has(p.id);
          return (
            <button key={p.id} onClick={() => toggleProduct(p.id)} className={`p-3 rounded-xl border-2 text-left transition-all ${isSelected ? "border-primary bg-mt-brand-light/50" : "border-mt-border hover:border-mt-border-2"}`}>
              {p.image ? (
                <div className="w-full h-20 mb-2 flex items-center justify-center bg-[#F8F8FA] rounded-lg p-2">
                  <img src={p.image} alt={p.name} className="h-full object-contain" />
                </div>
              ) : (
                <div className="w-full h-20 mb-2 flex items-center justify-center bg-gradient-to-br from-[#F5F3FF] to-[#EEF2FF] rounded-lg">
                  <Printer size={20} className="text-primary" />
                </div>
              )}
              <p className="text-[11px] font-semibold text-mt-ink truncate">{p.name}</p>
              <p className="text-[10px] text-mt-ink-4">${p.price} · {p.supplier}</p>
              {isSelected && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[9px] text-mt-ink-3">Qty:</label>
                  <input
                    type="number"
                    className="w-16 px-2 py-1 text-[11px] border border-mt-border rounded"
                    value={quantities[p.id] || 100}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      setQuantities(prev => ({ ...prev, [p.id]: parseInt(e.target.value) || 0 }));
                    }}
                  />
                </div>
              )}
              {isSelected && clientDbId != null && onOpenPriceMatrix && (
                // role=button on a <div> so we can nest inside the card's outer
                // <button> without producing invalid HTML. stopPropagation keeps
                // the outer toggle from firing when the user clicks this trigger.
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onOpenPriceMatrix(p); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenPriceMatrix(p);
                    }
                  }}
                  className="mt-2 bg-[#F0EEFF] text-primary hover:bg-[#E5DCFF] px-2 py-1 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 transition-colors active:scale-[0.97] cursor-pointer w-fit"
                >
                  <DollarSign size={11} /> Set Pricing
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
