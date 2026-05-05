/**
 * ProposalProductSearchModal
 * Phase 8 — variant-grouped picker for adding products to a proposal in
 * ProposalEditor. Shows one card per styleGroup with color swatches; the
 * user picks a specific variant (or the primary by clicking the row body)
 * and the modal calls onAddProduct with that variant's data.
 */

import React from "react";
import { X, Search, Package } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { colorNameToHex } from "@/lib/colorMap";

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
  /** Kept for backwards compatibility — modal now sources from listGrouped. */
  products: DbProduct[];
  onClose: () => void;
  onSearchChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onAddProduct: (p: DbProduct) => void;
}

export default function ProposalProductSearchModal({
  show,
  productSearch,
  productCategory,
  categories,
  onClose,
  onSearchChange,
  onCategoryChange,
  onAddProduct,
}: Props) {
  // Phase 8 — pull grouped feed directly so we can render swatches without
  // the parent reshuffling its data shape.
  const { data: grouped, isLoading } = trpc.products.listGrouped.useQuery(
    { limit: 200 },
    { enabled: show, staleTime: 60_000 },
  );
  const groups = grouped?.items ?? [];

  const filtered = React.useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return groups.filter((g) => {
      const matchSearch =
        !q ||
        g.primary.name.toLowerCase().includes(q) ||
        (g.primary.sku ?? "").toLowerCase().includes(q);
      const matchCat =
        productCategory === "All" ||
        productCategory === "" ||
        (g.primary.category ?? "").toLowerCase() ===
          productCategory.toLowerCase();
      return matchSearch && matchCat;
    });
  }, [groups, productSearch, productCategory]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-mt-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[18px] font-semibold text-mt-ink">
                Add Product from Catalog
              </h2>
              <p className="text-[12px] text-mt-ink-4 mt-0.5">
                Pick a product, then choose a specific color variant.
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 text-mt-ink-4 hover:text-mt-ink transition-colors duration-150"
            >
              <X size={18} />
            </button>
          </div>
          <div className="relative mb-3">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-mt-ink-4"
            />
            <input
              value={productSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by product name or SKU..."
              className="w-full pl-9 pr-4 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all duration-150"
              autoFocus
            />
          </div>
          {categories.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {categories.map((cat) => {
                const active = productCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => onCategoryChange(cat)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors duration-150 ${
                      active
                        ? "bg-primary text-white"
                        : "bg-mt-surface-2 text-mt-ink-3 hover:bg-mt-surface-3"
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 rounded-xl bg-mt-surface-2 animate-pulse"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <div className="h-12 w-12 rounded-full bg-mt-surface-2 flex items-center justify-center mx-auto mb-3">
                <Package size={18} className="text-mt-ink-4" />
              </div>
              <p className="text-[13px] font-semibold text-mt-ink-2">
                No matching products
              </p>
              <p className="text-[11px] text-mt-ink-4 mt-1">
                Try a different search term or category
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((g) => (
                <div
                  key={g.styleGroup}
                  className="rounded-xl border border-mt-border bg-white overflow-hidden hover:border-primary/40 hover:shadow-sm transition-all duration-150"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onAddProduct({
                        id: g.primary.id,
                        name: g.primary.name,
                        sku: g.primary.sku,
                        basePrice: g.primary.basePrice,
                        imageUrl: g.primary.imageUrl,
                        category: g.primary.category,
                        source: g.primary.source,
                        hasLiveInventory: g.primary.hasLiveInventory,
                      })
                    }
                    className="w-full flex items-center gap-4 p-3 text-left"
                  >
                    {g.primary.imageUrl ? (
                      <img
                        src={g.primary.imageUrl}
                        alt={g.primary.name}
                        draggable={false}
                        className="h-12 w-12 rounded-md border border-mt-border object-cover bg-mt-surface-2 flex-shrink-0"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-md border border-mt-border bg-mt-surface-2 flex items-center justify-center flex-shrink-0">
                        <Package size={16} className="text-mt-ink-4" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-semibold text-mt-ink truncate">
                          {g.primary.name}
                        </p>
                        {g.primary.source === "asi" && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                            ASI
                          </span>
                        )}
                        {g.primary.source === "promostandards" && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">
                            Live
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-mt-ink-4">
                        {g.primary.sku || "—"} · {g.primary.category || "General"}
                        {g.variantCount > 1 && (
                          <> · {g.variantCount} colors</>
                        )}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[14px] font-semibold text-mt-ink font-mono">
                        ${g.primary.basePrice ? Number(g.primary.basePrice).toFixed(2) : "0.00"}
                      </p>
                      <p className="text-[10px] text-mt-ink-4">per unit</p>
                    </div>
                  </button>
                  {g.variantCount > 1 && (
                    <div className="px-3 pb-3 pt-0 flex items-center gap-1.5 flex-wrap pl-[4.5rem]">
                      <span className="text-[10px] uppercase tracking-wider text-mt-ink-4 font-semibold mr-1">
                        Pick color
                      </span>
                      {g.variants.map((v) => {
                        const hex = v.colorHex ?? colorNameToHex(v.colorName);
                        return (
                          <button
                            key={v.productId}
                            type="button"
                            title={v.colorName ?? "Variant"}
                            aria-label={v.colorName ?? "Variant"}
                            onClick={() =>
                              onAddProduct({
                                id: v.productId,
                                name: g.primary.name,
                                sku: g.primary.sku,
                                basePrice: g.primary.basePrice,
                                imageUrl: v.imageUrl ?? g.primary.imageUrl,
                                category: g.primary.category,
                                source: g.primary.source,
                                hasLiveInventory: g.primary.hasLiveInventory,
                              })
                            }
                            style={
                              hex
                                ? { backgroundColor: hex }
                                : v.swatchUrl
                                ? {
                                    backgroundImage: `url(${v.swatchUrl})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }
                                : { backgroundColor: "#D4D4D4" }
                            }
                            className="h-5 w-5 rounded-full ring-1 ring-mt-border hover:ring-2 hover:ring-primary transition-all duration-150"
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-mt-border flex items-center justify-between">
          <p className="text-[11px] text-mt-ink-4">
            {filtered.length} product{filtered.length === 1 ? "" : "s"} available
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-mt-ink-3 border border-mt-border rounded-lg hover:bg-mt-surface-2 transition-colors duration-150"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
