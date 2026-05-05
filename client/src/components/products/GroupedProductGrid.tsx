/**
 * GroupedProductGrid — variant-aware multi-select product grid.
 *
 * Drop-in replacement for the flat product grids in CreateProposal (Step 2)
 * and CreateWebstore (product assignment step). Selecting a card selects
 * ALL variant productIds for that styleGroup, mirroring the Curation
 * "Add Product" UX. Parent receives the set of productIds (all variants).
 *
 * Search and category filter applied client-side over the grouped feed.
 */
import React, { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { colorNameToHex } from "@/lib/colorMap";
import { Package, Search } from "lucide-react";

export interface GroupedProductGridGroup {
  styleGroup: string;
  primaryProductId: number;
  primaryName: string;
  primarySku: string | null;
  primaryImageUrl: string | null;
  primaryBasePrice: string | null;
  primaryCategory: string | null;
  variantIds: number[];
  variantCount: number;
}

interface GroupedProductGridProps {
  /** Selected productIds (variant-level). Selection of a styleGroup means
   *  all of its variantIds are present in this array. */
  selectedIds: number[];
  /** Replace the selection list. */
  onChange: (next: number[]) => void;
  /** Show the search bar. Default true. */
  showSearch?: boolean;
  /** Optional category filter list. Pass `null` to hide the chip row. */
  categories?: string[] | null;
  /** Filter to a specific product type. */
  type?: "promotional" | "print";
  /** Empty-state copy. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** When the user picks/unpicks a single styleGroup. Optional callback for
   *  parents that want to react beyond the selection list (e.g., default
   *  quantities). The number array is the variant ids that toggled. */
  onGroupToggle?: (group: GroupedProductGridGroup, picked: boolean) => void;
}

export function GroupedProductGrid({
  selectedIds,
  onChange,
  showSearch = true,
  categories: providedCategories,
  type,
  emptyTitle = "No matching products",
  emptyDescription = "Try a different search term or category.",
  onGroupToggle,
}: GroupedProductGridProps) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const { data, isLoading } = trpc.products.listGrouped.useQuery(
    { limit: 200, type },
    { staleTime: 60_000 },
  );
  const groups = data?.items ?? [];

  // Derive category list when not provided.
  const derivedCategories = useMemo(() => {
    if (providedCategories === null) return null;
    if (providedCategories) return providedCategories;
    const set = new Set<string>();
    for (const g of groups) {
      if (g.primary.category) set.add(g.primary.category);
    }
    return ["All", ...Array.from(set).sort()];
  }, [groups, providedCategories]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter((g) => {
      const matchSearch =
        !needle ||
        g.primary.name.toLowerCase().includes(needle) ||
        (g.primary.sku ?? "").toLowerCase().includes(needle);
      const matchCat =
        activeCategory === "All" ||
        (g.primary.category ?? "").toLowerCase() === activeCategory.toLowerCase();
      return matchSearch && matchCat;
    });
  }, [groups, query, activeCategory]);

  const isGroupSelected = (g: typeof groups[number]) =>
    g.variants.every((v) => selectedIds.includes(v.productId));

  function toggleGroup(g: typeof groups[number]) {
    const ids = g.variants.map((v) => v.productId);
    const next = new Set(selectedIds);
    const before = isGroupSelected(g);
    if (before) {
      ids.forEach((id) => next.delete(id));
    } else {
      ids.forEach((id) => next.add(id));
    }
    onChange(Array.from(next));
    if (onGroupToggle) {
      onGroupToggle(
        {
          styleGroup: g.styleGroup,
          primaryProductId: g.primary.id,
          primaryName: g.primary.name,
          primarySku: g.primary.sku,
          primaryImageUrl: g.primary.imageUrl,
          primaryBasePrice: g.primary.basePrice,
          primaryCategory: g.primary.category ?? null,
          variantIds: ids,
          variantCount: g.variantCount,
        },
        !before,
      );
    }
  }

  return (
    <div className="space-y-4">
      {/* Filter row */}
      {(showSearch || derivedCategories) && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {showSearch && (
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-mt-ink-4"
              />
              <input
                type="text"
                placeholder="Search products..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150 placeholder:text-[#C4C4C4]"
              />
            </div>
          )}
          {derivedCategories && derivedCategories.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {derivedCategories.map((c) => {
                const active = activeCategory === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setActiveCategory(c)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors duration-150 ${
                      active
                        ? "bg-primary text-white"
                        : "bg-mt-surface-2 text-mt-ink-3 hover:bg-mt-surface-3"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-mt-border p-3 animate-pulse"
            >
              <div className="aspect-square bg-mt-surface-2 rounded-lg mb-3" />
              <div className="h-3 w-3/4 bg-mt-surface-2 rounded mb-2" />
              <div className="h-3 w-1/2 bg-mt-surface-2 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center bg-white rounded-xl border border-mt-border">
          <div className="h-12 w-12 rounded-full bg-mt-surface-2 flex items-center justify-center mb-3">
            <Package size={18} className="text-mt-ink-4" />
          </div>
          <p className="text-[14px] font-semibold text-mt-ink-2 mb-1">
            {emptyTitle}
          </p>
          <p className="text-[12px] text-mt-ink-4">{emptyDescription}</p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((g) => {
            const selected = isGroupSelected(g);
            return (
              <button
                key={g.styleGroup}
                type="button"
                onClick={() => toggleGroup(g)}
                className={`group relative bg-white rounded-xl border p-3 flex flex-col text-left transition-all duration-150 ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-mt-border hover:border-primary/40 hover:shadow-sm"
                }`}
              >
                <div className="aspect-square w-full bg-mt-surface-2 rounded-lg overflow-hidden mb-3 flex items-center justify-center">
                  {g.primary.imageUrl ? (
                    <img
                      src={g.primary.imageUrl}
                      alt={g.primary.name}
                      draggable={false}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Package size={20} className="text-mt-ink-4" />
                  )}
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  <p className="text-[13px] font-semibold text-mt-ink leading-snug line-clamp-2">
                    {g.primary.name}
                  </p>
                  {g.primary.sku && (
                    <p className="text-[11px] text-mt-ink-4 font-mono truncate">
                      {g.primary.sku}
                    </p>
                  )}
                  {g.variantCount > 1 && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {g.variants.slice(0, 5).map((v) => {
                        const hex = v.colorHex ?? colorNameToHex(v.colorName);
                        return (
                          <span
                            key={v.productId}
                            title={v.colorName ?? "Variant"}
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
                            className="h-3.5 w-3.5 rounded-full ring-1 ring-mt-border"
                          />
                        );
                      })}
                      {g.variantCount > 5 && (
                        <span className="text-[10px] font-semibold text-mt-ink-4">
                          +{g.variantCount - 5}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-end justify-between gap-2 mt-1">
                    <div>
                      {g.primary.basePrice && Number(g.primary.basePrice) > 0 && (
                        <p className="text-[12px] font-semibold text-mt-ink font-mono">
                          ${Number(g.primary.basePrice).toFixed(2)}
                        </p>
                      )}
                      {g.primary.category && (
                        <p className="text-[10px] uppercase tracking-wider text-mt-ink-4 mt-0.5">
                          {g.primary.category}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {/* Selection indicator */}
                <span
                  className={`absolute top-3 right-3 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors duration-150 ${
                    selected ? "border-primary bg-primary" : "border-mt-border bg-white"
                  }`}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
