/**
 * GroupedProductAutocomplete — variant-aware inline product picker.
 *
 * Replaces the flat per-row autocomplete in CreateEstimate, CreateInvoice,
 * and ProposalEditor. Same input ergonomics (type to filter, arrow-key
 * navigation, Enter to pick) but rows are grouped by styleGroup with
 * thumbnails and color swatches.
 *
 * Selection model:
 *   - Click the row body  → emits the primary variant (one-click flow).
 *   - Click a swatch       → emits that specific variant.
 *
 * The line item still references one specific productId; this component
 * just makes the grouped catalog browse-friendly.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { colorNameToHex } from "@/lib/colorMap";
import { Package } from "lucide-react";

export interface PickedProduct {
  id: number;
  name: string;
  sku: string | null;
  basePrice: string | null;
  imageUrl: string | null;
  colorName: string | null;
}

interface GroupedProductAutocompleteProps {
  /** Initial query value (uncontrolled). */
  initialQuery?: string;
  /** Optional override placeholder. */
  placeholder?: string;
  /** Width in px for the dropdown panel. Default 360. */
  panelWidth?: number;
  /** Disable input. */
  disabled?: boolean;
  /** Called when the user picks a specific variant. */
  onPick: (p: PickedProduct) => void;
  /** Filter to a specific product type. */
  type?: "promotional" | "print";
  /** Render a custom input instead of the default one. */
  inputClassName?: string;
}

const DEFAULT_LIMIT = 200;
const SWATCH_LIMIT = 5;

export function GroupedProductAutocomplete({
  initialQuery = "",
  placeholder = "Link a product…",
  panelWidth = 360,
  disabled,
  onPick,
  type,
  inputClassName,
}: GroupedProductAutocompleteProps) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data } = trpc.products.listGrouped.useQuery(
    { limit: DEFAULT_LIMIT, type },
    { staleTime: 60_000 },
  );
  const groups = data?.items ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups.slice(0, 8);
    return groups
      .filter((g) =>
        g.primary.name.toLowerCase().includes(needle) ||
        (g.primary.sku ?? "").toLowerCase().includes(needle) ||
        (g.primary.supplier ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [groups, query]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  function pickPrimary(g: typeof filtered[number]) {
    onPick({
      id: g.primary.id,
      name: g.primary.name,
      sku: g.primary.sku,
      basePrice: g.primary.basePrice,
      imageUrl: g.primary.imageUrl,
      colorName: g.primary.colorName ?? null,
    });
    setOpen(false);
    setQuery("");
    setCursor(0);
  }

  function pickVariant(g: typeof filtered[number], variantId: number) {
    const v = g.variants.find((x) => x.productId === variantId);
    if (!v) return pickPrimary(g);
    onPick({
      id: v.productId,
      name: g.primary.name,
      sku: g.primary.sku,
      basePrice: g.primary.basePrice,
      imageUrl: v.imageUrl ?? g.primary.imageUrl,
      colorName: v.colorName,
    });
    setOpen(false);
    setQuery("");
    setCursor(0);
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setCursor((c) => Math.min(filtered.length - 1, c + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === "Enter" && filtered[cursor]) {
            e.preventDefault();
            pickPrimary(filtered[cursor]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={
          inputClassName ??
          "w-full h-9 px-3 rounded-md border border-mt-border text-[13px] text-mt-ink outline-none transition-all duration-150 focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-[#C4C4C4] disabled:opacity-50"
        }
      />
      {open && filtered.length > 0 && (
        <div
          className="absolute left-0 z-30 mt-1 rounded-xl border border-mt-border bg-white shadow-lg overflow-hidden"
          style={{ width: panelWidth }}
        >
          <ul className="max-h-80 overflow-y-auto py-1">
            {filtered.map((g, i) => (
              <li
                key={g.styleGroup}
                className={
                  i === cursor
                    ? "bg-mt-surface-2"
                    : "hover:bg-mt-surface-2 transition-colors duration-150"
                }
              >
                {/* Row body — click picks primary variant */}
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickPrimary(g);
                  }}
                  className="w-full text-left px-3 py-2 flex items-start gap-2.5"
                >
                  {g.primary.imageUrl ? (
                    <img
                      src={g.primary.imageUrl}
                      alt={g.primary.name}
                      draggable={false}
                      className="h-10 w-10 rounded-md border border-mt-border object-cover bg-mt-surface-2 shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-md border border-mt-border bg-mt-surface-2 flex items-center justify-center shrink-0">
                      <Package size={14} className="text-mt-ink-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-mt-ink truncate">
                        {g.primary.name}
                      </span>
                      {g.primary.basePrice && (
                        <span className="text-[12px] text-mt-ink-3 font-mono shrink-0">
                          ${parseFloat(g.primary.basePrice).toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {g.primary.sku && (
                        <span className="text-[11px] text-mt-ink-4 font-mono truncate">
                          {g.primary.sku}
                        </span>
                      )}
                      {g.variantCount > 1 && (
                        <>
                          <span className="text-[10px] text-mt-ink-4">·</span>
                          <span className="text-[11px] text-mt-ink-3">
                            {g.variantCount} colors
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
                {/* Per-variant swatch row — only when group has multiple variants */}
                {g.variantCount > 1 && (
                  <div className="px-3 pb-2 pl-[3.25rem] flex items-center gap-1.5">
                    {g.variants.slice(0, SWATCH_LIMIT).map((v) => {
                      const hex = v.colorHex ?? colorNameToHex(v.colorName);
                      return (
                        <button
                          key={v.productId}
                          type="button"
                          title={v.colorName ?? "Variant"}
                          aria-label={v.colorName ?? "Variant"}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickVariant(g, v.productId);
                          }}
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
                          className="h-4 w-4 rounded-full ring-1 ring-mt-border hover:ring-2 hover:ring-primary transition-all duration-150"
                        />
                      );
                    })}
                    {g.variantCount > SWATCH_LIMIT && (
                      <span className="text-[10px] font-semibold text-mt-ink-4 ml-0.5">
                        +{g.variantCount - SWATCH_LIMIT}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
