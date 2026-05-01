/**
 * ProposalProductSearchModal
 * Modal for searching and adding products from the DB catalog inside ProposalEditor.
 */

import { X, Search, Package, Plus } from "lucide-react";

interface DbProduct {
  id: number;
  name: string;
  sku?: string | null;
  basePrice?: string | number | null;
  imageUrl?: string | null;
  decorationMethods?: string | string[] | null;
  category?: string | null;
  source?: string | null;
  hasLiveInventory?: boolean | null;
}

interface Props {
  show: boolean;
  productSearch: string;
  productCategory: string;
  categories: string[];
  products: DbProduct[];
  onClose: () => void;
  onSearchChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onAddProduct: (p: DbProduct) => void;
}

export default function ProposalProductSearchModal({
  show, productSearch, productCategory, categories, products,
  onClose, onSearchChange, onCategoryChange, onAddProduct,
}: Props) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-mt-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[18px] font-bold text-mt-ink">Add Product from Catalog</h2>
              <p className="text-[12px] text-[#A1A1AA] mt-0.5">Search and add products from your curated inventory</p>
            </div>
            <button onClick={onClose} className="p-2 text-[#A1A1AA] hover:text-mt-ink transition-colors"><X size={18} /></button>
          </div>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
            <input
              value={productSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by product name or SKU..."
              className="w-full pl-9 pr-4 py-2.5 text-[13px] border border-mt-border focus:border-primary focus:outline-none"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => onCategoryChange(cat)}
                className="px-3 py-1 text-[11px] font-semibold transition-all"
                style={{ backgroundColor: productCategory === cat ? "var(--mt-brand)" : "transparent", color: productCategory === cat ? "white" : "#737373", border: `1px solid ${productCategory === cat ? "var(--mt-brand)" : "#E5E5E5"}` }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {products.length === 0 ? (
              <div className="text-center py-12">
                <Package size={32} className="text-[#D4D4D4] mx-auto mb-3" />
                <p className="text-[13px] text-[#A1A1AA]">No matching products found</p>
                <p className="text-[11px] text-[#D4D4D4] mt-1">Try a different search term or category</p>
              </div>
            ) : (
              products.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-4 p-4 border border-[#F0F0F0] hover:border-primary hover:bg-mt-surface transition-all cursor-pointer group"
                  onClick={() => onAddProduct(p)}
                >
                  {p.imageUrl ? (
                    <div className="w-12 h-12 bg-[#F8F8FA] rounded flex items-center justify-center flex-shrink-0 border border-[#F0F0F0]">
                      <img src={p.imageUrl} alt={p.name} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 bg-gradient-to-br from-primary to-[#8B5CF6] flex items-center justify-center flex-shrink-0">
                      <Package size={18} className="text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13px] font-semibold text-mt-ink">{p.name}</p>
                      {p.source === "asi" && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">ASI</span>}
                      {p.source === "promostandards" && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">Live</span>}
                      {p.hasLiveInventory && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-600"> Live Inv.</span>}
                    </div>
                    <p className="text-[11px] text-[#A1A1AA]">{p.sku || "—"} · {Array.isArray(p.decorationMethods) ? p.decorationMethods.join(", ") : (p.decorationMethods || "Standard")} · {p.category || "General"}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[14px] font-bold text-mt-ink">${p.basePrice ? Number(p.basePrice).toFixed(2) : "0.00"}</p>
                    <p className="text-[10px] text-[#A1A1AA]">per unit</p>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus size={16} className="text-primary" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-4 border-t border-mt-border flex items-center justify-between">
          <p className="text-[11px] text-[#A1A1AA]">{products.length} products available</p>
          <button onClick={onClose} className="px-4 py-2 text-[12px] font-semibold text-mt-ink-3 border border-mt-border hover:border-[#1A1A1A] transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}
