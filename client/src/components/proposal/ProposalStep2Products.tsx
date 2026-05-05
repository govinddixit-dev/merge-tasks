/**
 * ProposalStep2Products
 * Phase 8 — variant-grouped product picker. Browses one card per styleGroup
 * with color swatches; selecting a card adds ALL its variant productIds. A
 * "Selected" panel below renders one row per picked variant with a quantity
 * editor and the optional Set Pricing trigger.
 */

import React from "react";
import { Printer, DollarSign, X } from "lucide-react";
import { GroupedProductGrid } from "@/components/products/GroupedProductGrid";

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
  clientDbId?: number | null;
  onOpenPriceMatrix?: (product: Product) => void;
}

export default function ProposalStep2Products({
  filteredProducts,
  selectedProducts,
  quantities,
  toggleProduct,
  setQuantities,
  totalValue,
  clientDbId,
  onOpenPriceMatrix,
}: Props) {
  const selectedIds = React.useMemo(
    () => Array.from(selectedProducts),
    [selectedProducts],
  );

  // The grid emits a full replacement set; diff against the current Set
  // and call toggleProduct for each id that flipped. This keeps the
  // parent's Set state and quantity-default logic untouched.
  function applySelection(next: number[]) {
    const nextSet = new Set(next);
    const toAdd: number[] = [];
    const toRemove: number[] = [];
    for (const id of next) if (!selectedProducts.has(id)) toAdd.push(id);
    selectedProducts.forEach((id) => {
      if (!nextSet.has(id)) toRemove.push(id);
    });
    [...toAdd, ...toRemove].forEach((id) => toggleProduct(id));
  }

  // Selected list — pull from filteredProducts (which is mergedProducts
  // upstream) so we keep names/prices/images. Variants outside of the
  // current category filter still render here so the user always sees
  // their selections.
  const productById = new Map(filteredProducts.map((p) => [p.id, p]));
  const selectedRows = selectedIds
    .map((id) => productById.get(id))
    .filter(Boolean) as Product[];

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-xl border border-mt-border p-6 sm:p-8 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-mt-ink mb-1">
              Select Products
            </h2>
            <p className="text-[13px] text-mt-ink-3">
              {selectedIds.length} variant{selectedIds.length === 1 ? "" : "s"} selected
              {" · "}${totalValue.toLocaleString()} est. value
            </p>
          </div>
        </div>

        <GroupedProductGrid
          selectedIds={selectedIds}
          onChange={applySelection}
          showSearch
          emptyTitle="No products in your catalog yet"
          emptyDescription="Import or create catalog products before adding them to a proposal."
        />
      </section>

      {selectedRows.length > 0 && (
        <section className="bg-white rounded-xl border border-mt-border p-6 sm:p-8">
          <h3 className="text-[15px] font-semibold text-mt-ink mb-4">
            Selected variants
          </h3>
          <div className="space-y-2">
            {selectedRows.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 p-3 rounded-xl border border-mt-border bg-white hover:bg-mt-surface-1 transition-colors duration-150"
              >
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.name}
                    draggable={false}
                    className="h-10 w-10 rounded-md border border-mt-border object-cover bg-mt-surface-2 shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-md border border-mt-border bg-mt-surface-2 flex items-center justify-center shrink-0">
                    <Printer size={14} className="text-primary/70" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-mt-ink truncate">
                    {p.name}
                  </p>
                  <p className="text-[11px] text-mt-ink-4">
                    ${p.price} · {p.supplier}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-[11px] text-mt-ink-3">Qty</label>
                  <input
                    type="number"
                    min={1}
                    className="w-20 px-2 py-1.5 text-[12px] font-mono border border-mt-border rounded-md outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150"
                    value={quantities[p.id] || 100}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [p.id]: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                  />
                  {clientDbId != null && onOpenPriceMatrix && (
                    <button
                      type="button"
                      onClick={() => onOpenPriceMatrix(p)}
                      className="inline-flex items-center gap-1 bg-mt-brand-light text-primary hover:bg-[#E5DCFF] px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors duration-150"
                    >
                      <DollarSign size={11} /> Set Pricing
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleProduct(p.id)}
                    aria-label="Remove variant"
                    className="text-mt-ink-4 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-colors duration-150"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
