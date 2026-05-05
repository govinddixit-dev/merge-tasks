/**
 * ModernShop — wireframe-driven product grid for the Modern template.
 *
 * Preserves every behavior from StoreProductsPage.legacy.tsx:
 *   - `?cat=` URL parameter for deep-linkable category filters
 *   - Keyboard "/" shortcut focuses search
 *   - productGroups variant-grouped grid → falls back to flat ProductCard
 *   - BudgetBanner above the grid (regression checklist)
 *   - Skeleton loading state on initial mount
 *
 * Visual changes (Modern signature):
 *   - Italic-led page title, mixed serif/sans
 *   - Pill category filters with brand-accent active underline
 *   - No card chrome (paper background, hairline rules)
 */
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Search, Package } from "lucide-react";
import { useStore, capitalize } from "../../StoreContext";
import { BudgetBanner } from "../../BudgetBanner";
import { VariantProductCard } from "@/components/products/VariantProductCard";
import ModernShell from "./ModernShell";
import ModernProductCard from "./ModernProductCard";

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[4/5] bg-paper-soft" />
      <div className="pt-2.5 space-y-1.5">
        <div className="h-2.5 w-1/3 bg-paper-soft rounded" />
        <div className="h-3 w-2/3 bg-paper-soft rounded" />
        <div className="h-3 w-1/4 bg-paper-soft rounded" />
      </div>
    </div>
  );
}

export default function ModernShop() {
  const { store, isDark } = useStore();
  const [, navigate] = useLocation();
  const searchString = typeof window !== "undefined" ? window.location.search : "";
  const catParam = new URLSearchParams(searchString).get("cat") || "All";
  const [activeCategory, setActiveCategory] = useState(catParam);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  const categories = ["All", ...Array.from(new Set(store.products.map(p => p.category || "Other")))];

  const filtered = store.products.filter(p => {
    const matchCat = activeCategory === "All" || (p.category || "Other") === activeCategory;
    const matchSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  const groups = store.productGroups ?? [];
  const filteredGroups = groups.filter(g => {
    const matchCat = activeCategory === "All" || (g.primary.category || "Other") === activeCategory;
    const matchSearch = !searchQuery || g.primary.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 400);
    return () => clearTimeout(t);
  }, []);

  // "/" keyboard shortcut — preserved from legacy.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const heading =
    activeCategory === "All"
      ? store.aiProductGridHeading || "Everything we make"
      : capitalize(activeCategory);

  return (
    <ModernShell footer="default">
      <section className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-12 pt-12 pb-20">
        <BudgetBanner storeId={store.id} isDark={isDark} />

        <div className="mb-10">
          <h1 className="text-[44px] sm:text-[64px] font-bold tracking-tight leading-[1.05] text-ink">
            {heading}, <em className="font-serif-display font-normal italic">considered.</em>
          </h1>
          <p className="mt-3 text-[13px] text-ws-muted">
            Showing {filtered.length} {filtered.length === 1 ? "product" : "products"}
          </p>
        </div>

        {/* Filters + search */}
        <div className="flex flex-wrap items-center gap-3 mb-10 pb-6 border-b border-rule">
          {categories.map(cat => {
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                aria-pressed={active}
                className="px-4 py-1.5 text-[12px] font-bold tracking-[0.06em] uppercase transition-colors"
                style={{
                  color: active ? "var(--color-brand)" : "var(--color-ws-muted)",
                  borderBottom: active ? "2px solid var(--color-brand)" : "2px solid transparent",
                  paddingBottom: 6,
                }}
              >
                {capitalize(cat)}
              </button>
            );
          })}
          <div className="flex-1 min-w-[200px] ml-auto">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ws-muted" />
              <input
                ref={searchRef}
                type="text"
                placeholder='Search products… (press "/")'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-[13px] outline-none bg-transparent border border-rule focus:border-ink transition-colors text-ink placeholder:text-ws-muted-soft"
              />
            </div>
          </div>
        </div>

        {/* Grid — denser than the handoff default (5 cols on xl, 4 on lg)
            so more products land above the fold. Card chrome lives in the
            card itself; gap is tight. */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
            {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <Package size={40} className="mx-auto mb-4 text-ws-muted" />
            <p className="text-[14px] font-semibold text-ink">No products found</p>
            <p className="text-[12px] text-ws-muted">Try a different category or search term</p>
          </div>
        ) : groups.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
            {filteredGroups.map(g => {
              const variantRenderUrls = Object.fromEntries(
                g.variants.map(v => [v.productId, v.webstoreRenderedImageUrl]),
              );
              const primaryRenderUrl =
                g.variants.find(v => v.productId === g.primary.id)?.webstoreRenderedImageUrl ?? null;
              return (
                <VariantProductCard
                  key={g.styleGroup}
                  styleGroup={g.styleGroup}
                  primary={{
                    name: g.primary.name,
                    sku: g.primary.sku,
                    imageUrl: g.primary.imageUrl,
                    category: g.primary.category,
                    basePrice: g.primary.basePrice,
                  }}
                  variants={g.variants}
                  variantCount={g.variantCount}
                  primaryRenderUrl={primaryRenderUrl}
                  variantRenderUrls={variantRenderUrls}
                  // wouter SPA navigation to the primary product id —
                  // window.location.href + `~/` breaks the wouter prefix
                  // and lands users on the admin shell.
                  onSelect={() => navigate(`~/s/${store.slug}/product/${g.primary.id}`)}
                />
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
            {filtered.map(p => <ModernProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </ModernShell>
  );
}
