/**
 * StoreProductsPage — Product grid with skeleton loaders, keyboard search,
 * staggered card entrance animations, and branded AI heading.
 *
 * PRESERVED from original:
 * - catParam URL parameter reading
 * - activeCategory and searchQuery state
 * - categories array derivation
 * - filtered array derivation logic
 */

import { useState, useEffect, useRef } from "react";
import { Search, Package } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore, capitalize } from "./StoreContext";
import { getStoreTheme } from "./storeThemeUtils";
import ProductCard from "./ProductCard";
import { BudgetBanner } from "./BudgetBanner";

/** Skeleton card for loading state */
function SkeletonCard({ isDark }: { isDark: boolean }) {
  const bg = isDark ? "#333" : "#E5E5E5";
  const cardBg = isDark ? "#2A2A2A" : "#FFFFFF";
  return (
    <div
      className="rounded-xl overflow-hidden animate-pulse"
      style={{ backgroundColor: cardBg, border: `1px solid ${isDark ? "#333" : "#E5E5E5"}` }}
    >
      <div className="aspect-square" style={{ backgroundColor: bg }} />
      <div className="p-4 space-y-3">
        <div className="h-3 w-16 rounded-full" style={{ backgroundColor: bg }} />
        <div className="h-4 w-3/4 rounded" style={{ backgroundColor: bg }} />
        <div className="flex justify-between items-center">
          <div className="h-5 w-16 rounded" style={{ backgroundColor: bg }} />
          <div className="h-8 w-8 rounded-full" style={{ backgroundColor: bg }} />
        </div>
      </div>
    </div>
  );
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: "easeOut" as const },
  }),
};

export default function StoreProductsPage() {
  const { store, isDark } = useStore();
  const theme = getStoreTheme(store);
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const borderColor = isDark ? "#333" : "#E5E5E5";

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

  // Simulate initial load skeleton
  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 400);
    return () => clearTimeout(t);
  }, []);

  // Keyboard "/" shortcut for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const gridColsClass =
    theme.gridCols === 3
      ? "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3"
      : "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10">
      <BudgetBanner storeId={store.id} isDark={isDark} />
      {/* Branded heading */}
      <motion.h1
        className="text-2xl font-bold mb-2"
        style={{ color: fg }}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {activeCategory === "All" ? theme.gridHeading : capitalize(activeCategory)}
      </motion.h1>
      <p className="text-[13px] mb-6" style={{ color: mutedFg }}>
        Showing {filtered.length} product{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            aria-pressed={activeCategory === cat}
            className="px-4 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
            style={{
              backgroundColor: activeCategory === cat ? store.primaryColor : "transparent",
              color: activeCategory === cat ? "#FFFFFF" : mutedFg,
              border: `1px solid ${activeCategory === cat ? store.primaryColor : borderColor}`,
            }}
          >
            {capitalize(cat)}
          </button>
        ))}
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
            <input
              ref={searchRef}
              type="text"
              placeholder='Search products... (press "/")'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg text-[13px] outline-none"
              style={{ backgroundColor: isDark ? "#252525" : "#F5F5F5", color: fg, border: `1px solid ${borderColor}` }}
            />
          </div>
        </div>
      </div>

      {/* Product Grid */}
      {isLoading ? (
        <div className={`grid ${gridColsClass} gap-6`}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} isDark={isDark} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Package size={40} className="mx-auto mb-4" style={{ color: mutedFg }} />
          <p className="text-[14px] font-semibold" style={{ color: fg }}>No products found</p>
          <p className="text-[12px]" style={{ color: mutedFg }}>Try a different category or search term</p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeCategory + searchQuery}
            className={`grid ${gridColsClass} gap-6`}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            {filtered.map((product, i) => (
              <motion.div key={product.id} custom={i} variants={cardVariants}>
                <ProductCard product={product} />
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
