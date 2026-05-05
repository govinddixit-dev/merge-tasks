/**
 * StoreTemplateClassic — Traditional sidebar navigation + grid layout.
 * Best for: Large enterprises, government, healthcare — many categories.
 *
 * UI/UX lift (pure visual, zero functional regression):
 *   - Personalized greeting banner above the product grid.
 *   - Sidebar categories pre-ordered by relevance (division + role).
 *   - Sidebar product-tag hashtags pre-selected from relevant categories.
 *   - Staggered fade-in-up product grid entrance.
 *   - Curtain reveal footer with AI "Your team is ordering" strip.
 *   - Floating cart FAB + Back to Top.
 *
 * All original tRPC calls, cart handlers, navigation, and controls preserved.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Truck, Shield, Star, Headphones, ChevronRight, Grid3X3, List,
  Filter, SlidersHorizontal, Building2, Package, Sparkles, Hash, Wallet,
} from "lucide-react";
import { useStore, capitalize, getCategoryIcon } from "./StoreContext";
import ProductCard from "./ProductCard";
import { WebstoreLogoOverlayCard, extractWebstorePlacement } from "./WebstoreLogoOverlay";
import { usePersonalization } from "./usePersonalization";
import {
  BackToTop, CurtainContentWrapper, CurtainRevealFooter, FloatingCartFAB, MotionReveal,
} from "./templateChrome";

export default function StoreTemplateClassic() {
  const { store, isDark } = useStore();
  const [, navigate] = useLocation();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const personalization = usePersonalization();

  const pc = store.primaryColor;
  const bg = isDark ? "#1A1A1A" : "#FFFFFF";
  const contentBg = isDark ? "#1A1A1A" : "#FFFFFF";
  const sidebarBg = isDark ? "#111" : "#F4F4F5";
  const cardBg = isDark ? "#252525" : "#FAFAFA";
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const borderColor = isDark ? "#333" : "#E4E4E7";

  // Categories ordered so user's relevant ones come first.
  const rawCategories = useMemo(
    () => Array.from(new Set(store.products.map(p => p.category || "Other"))),
    [store.products],
  );
  const categories = useMemo(() => {
    const ranked = personalization.relevantCategories;
    if (ranked.length === 0) return rawCategories;
    const lookup = new Map<string, string>();
    rawCategories.forEach(c => lookup.set(c.toLowerCase(), c));
    const ordered: string[] = [];
    ranked.forEach(r => {
      const c = lookup.get(r);
      if (c && !ordered.includes(c)) ordered.push(c);
    });
    rawCategories.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
    return ordered;
  }, [rawCategories, personalization.relevantCategories]);

  // Pre-selected product-tag hashtags derived from the user's relevant
  // categories — purely a visual accent, clicking just selects that cat.
  const preselectedTags = useMemo(() => {
    const top = personalization.relevantCategories.slice(0, 5);
    return top.length > 0 ? top : rawCategories.map(c => c.toLowerCase()).slice(0, 5);
  }, [personalization.relevantCategories, rawCategories]);

  const filteredProducts = selectedCategory
    ? store.products.filter(p => (p.category || "Other") === selectedCategory)
    : personalization.rankedProducts;

  const heroHeadline = store.aiHeroHeadline || `Welcome to ${store.client?.companyName || store.name}`;
  const heroSubtitle = store.aiHeroSubtitle || store.aiDescription || "Premium branded merchandise for your team.";

  return (
    <>
      <CurtainContentWrapper variant="classic" background={contentBg}>
        <div style={{ backgroundColor: bg, color: fg }}>
          {/*  Compact Hero Banner  */}
          <section
            className="relative flex items-center overflow-hidden"
            style={{
              minHeight: "280px",
              background: store.bannerUrl
                ? `url(${store.bannerUrl}) center/cover no-repeat`
                : `linear-gradient(135deg, ${pc} 0%, ${pc}BB 100%)`,
            }}
          >
            {store.bannerUrl && <div className="absolute inset-0 bg-black/40" />}
            {!store.bannerUrl && (
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: `repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)`, backgroundSize: "24px 24px" }}
              />
            )}
            <div className="relative z-10 max-w-[1400px] mx-auto px-8 py-12 w-full flex items-center gap-8">
              {(store.client?.logoUrl || store.logoUrl) && (
                <div className="flex-shrink-0">
                  <img
                    src={store.client?.logoUrl || store.logoUrl || ""}
                    alt={store.client?.companyName || store.name}
                    className="h-16 object-contain"
                    style={{ filter: "brightness(0) invert(1)" }}
                  />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 size={14} className="opacity-70" style={{ color: "#fff" }} />
                  <span className="text-[12px] font-semibold uppercase tracking-widest opacity-70" style={{ color: "#fff" }}>
                    {store.client?.industry || "Company Store"}
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold mb-3 leading-tight" style={{ color: "#fff" }}>
                  {heroHeadline}
                </h1>
                <p className="text-[15px] max-w-xl leading-relaxed opacity-85" style={{ color: "#fff" }}>
                  {heroSubtitle}
                </p>
              </div>
              <div className="hidden lg:flex flex-col items-end gap-3">
                <div className="text-right">
                  <div className="text-[28px] font-extrabold" style={{ color: "#fff" }}>{store.products.length}</div>
                  <div className="text-[12px] opacity-70" style={{ color: "#fff" }}>Products Available</div>
                </div>
                <div className="text-right">
                  <div className="text-[28px] font-extrabold" style={{ color: "#fff" }}>{categories.length}</div>
                  <div className="text-[12px] opacity-70" style={{ color: "#fff" }}>Categories</div>
                </div>
              </div>
            </div>
          </section>

          {/*  Trust Bar  */}
          <section className="border-b" style={{ backgroundColor: isDark ? "#161616" : "#FAFAFA", borderColor }}>
            <div className="max-w-[1400px] mx-auto px-8 py-3 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-6">
                {[
                  { icon: Truck, text: "Free Shipping on Orders $50+" },
                  { icon: Shield, text: "Secure Checkout" },
                  { icon: Star, text: "Premium Quality Guaranteed" },
                  { icon: Headphones, text: "Dedicated Support" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-2">
                    <Icon size={13} style={{ color: pc }} />
                    <span className="text-[12px] font-medium" style={{ color: mutedFg }}>{text}</span>
                  </div>
                ))}
              </div>
              {store.aiTagline && (
                <span className="text-[12px] font-semibold italic" style={{ color: pc }}>"{store.aiTagline}"</span>
              )}
            </div>
          </section>

          {/*  Main Layout: Sidebar + Content  */}
          <div className="max-w-[1400px] mx-auto px-8 py-8 flex gap-8">
            {/*  LEFT SIDEBAR (sticky)  */}
            <aside className="w-64 flex-shrink-0 hidden lg:block">
              <div className="sticky top-[88px]">
                {/* Categories */}
                <div className="rounded-xl overflow-hidden border mb-6" style={{ borderColor, backgroundColor: sidebarBg }}>
                  <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor }}>
                    <Filter size={14} style={{ color: pc }} />
                    <span className="text-[13px] font-bold" style={{ color: fg }}>
                      {personalization.isPersonalized ? "Picked for you" : "Browse Categories"}
                    </span>
                  </div>
                  <div className="py-2">
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:opacity-80"
                      style={{
                        backgroundColor: !selectedCategory ? `${pc}15` : "transparent",
                        color: !selectedCategory ? pc : fg,
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        <Package size={15} />
                        <span className="text-[13px] font-semibold">All Products</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${pc}20`, color: pc }}>
                          {store.products.length}
                        </span>
                        <ChevronRight size={12} />
                      </div>
                    </button>
                    {categories.map(cat => {
                      const count = store.products.filter(p => (p.category || "Other") === cat).length;
                      const CatIcon = getCategoryIcon(cat);
                      const isActive = selectedCategory === cat;
                      const isRelevant = personalization.relevantCategories
                        .slice(0, 3)
                        .includes(cat.toLowerCase());
                      return (
                        <button
                          key={cat}
                          onClick={() => setSelectedCategory(isActive ? null : cat)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:opacity-80"
                          style={{
                            backgroundColor: isActive ? `${pc}15` : "transparent",
                            color: isActive ? pc : fg,
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <CatIcon size={15} />
                            <span className="text-[13px] font-semibold">{capitalize(cat)}</span>
                            {isRelevant && personalization.isPersonalized && (
                              <Sparkles size={10} style={{ color: pc }} aria-label="recommended" />
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: isActive ? `${pc}20` : `${isDark ? "#333" : "#E4E4E7"}`, color: isActive ? pc : mutedFg }}>
                              {count}
                            </span>
                            <ChevronRight size={12} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Product Tags — pill hashtags, pre-selected by relevance */}
                <div className="rounded-xl border p-4 mb-6" style={{ borderColor, backgroundColor: sidebarBg }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Hash size={14} style={{ color: pc }} />
                    <span className="text-[13px] font-bold" style={{ color: fg }}>Product Tags</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {preselectedTags.map(tag => {
                      const isActive = selectedCategory?.toLowerCase() === tag;
                      return (
                        <button
                          key={tag}
                          onClick={() => {
                            const match = categories.find(c => c.toLowerCase() === tag);
                            setSelectedCategory(isActive ? null : (match ?? null));
                          }}
                          className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
                          style={{
                            backgroundColor: isActive ? pc : `${pc}15`,
                            color: isActive ? "#fff" : pc,
                          }}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Store Info */}
                <div className="rounded-xl border p-4" style={{ borderColor, backgroundColor: sidebarBg }}>
                  <div className="flex items-center gap-2 mb-3">
                    <SlidersHorizontal size={14} style={{ color: pc }} />
                    <span className="text-[13px] font-bold" style={{ color: fg }}>Store Info</span>
                  </div>
                  {store.client?.companyName && (
                    <div className="mb-2">
                      <div className="text-[11px] uppercase tracking-wide font-semibold mb-0.5" style={{ color: mutedFg }}>Company</div>
                      <div className="text-[13px] font-semibold" style={{ color: fg }}>{store.client.companyName}</div>
                    </div>
                  )}
                  {store.client?.industry && (
                    <div className="mb-2">
                      <div className="text-[11px] uppercase tracking-wide font-semibold mb-0.5" style={{ color: mutedFg }}>Industry</div>
                      <div className="text-[13px] font-semibold" style={{ color: fg }}>{store.client.industry}</div>
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t" style={{ borderColor }}>
                    <button
                      onClick={() => navigate(`~/s/${store.slug}/products`)}
                      className="w-full py-2.5 rounded-lg text-[13px] font-bold text-white transition-all hover:opacity-90"
                      style={{ backgroundColor: pc }}
                    >
                      View All Products
                    </button>
                  </div>
                </div>
              </div>
            </aside>

            {/*  MAIN CONTENT  */}
            <main className="flex-1 min-w-0">
              {/* Personalized greeting banner */}
              {personalization.isPersonalized && personalization.greeting && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="mb-6 flex items-start gap-3 rounded-xl p-4 border"
                  style={{
                    backgroundColor: `${pc}0D`,
                    borderColor: `${pc}33`,
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[14px] font-bold flex-shrink-0"
                    style={{ backgroundColor: pc }}
                  >
                    {personalization.firstName?.charAt(0) ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold" style={{ color: fg }}>
                      {personalization.greeting}
                    </p>
                    <p className="text-[12px]" style={{ color: mutedFg }}>
                      {[personalization.department, personalization.role]
                        .filter(Boolean)
                        .join(" · ") || "Curated by your team's activity"}
                    </p>
                  </div>
                  {personalization.budgetRemaining && (
                    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold"
                      style={{ backgroundColor: pc, color: "#fff" }}>
                      <Wallet size={12} /> {personalization.budgetRemaining}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Breadcrumb + Controls */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2 text-[13px]" style={{ color: mutedFg }}>
                  <button onClick={() => setSelectedCategory(null)} className="hover:underline" style={{ color: selectedCategory ? mutedFg : pc }}>
                    All Products
                  </button>
                  {selectedCategory && (
                    <>
                      <ChevronRight size={12} />
                      <span style={{ color: fg, fontWeight: 600 }}>{capitalize(selectedCategory)}</span>
                    </>
                  )}
                  <span className="ml-2 text-[12px]">({filteredProducts.length} items)</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewMode("grid")}
                    className="p-2 rounded-lg transition-colors"
                    style={{ backgroundColor: viewMode === "grid" ? `${pc}15` : "transparent", color: viewMode === "grid" ? pc : mutedFg }}
                    aria-label="Grid view"
                  >
                    <Grid3X3 size={16} />
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    className="p-2 rounded-lg transition-colors"
                    style={{ backgroundColor: viewMode === "list" ? `${pc}15` : "transparent", color: viewMode === "list" ? pc : mutedFg }}
                    aria-label="List view"
                  >
                    <List size={16} />
                  </button>
                </div>
              </div>

              {/* Mobile category chips */}
              <div className="lg:hidden flex gap-2 flex-wrap mb-6">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
                  style={{ backgroundColor: !selectedCategory ? pc : `${pc}15`, color: !selectedCategory ? "#fff" : pc }}
                >
                  All
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                    className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
                    style={{ backgroundColor: selectedCategory === cat ? pc : `${pc}15`, color: selectedCategory === cat ? "#fff" : pc }}
                  >
                    {capitalize(cat)}
                  </button>
                ))}
              </div>

              {/* Category Header */}
              {selectedCategory && (
                <div className="mb-6 p-4 rounded-xl" style={{ backgroundColor: `${pc}08`, border: `1px solid ${pc}20` }}>
                  <h2 className="text-[18px] font-extrabold mb-1" style={{ color: fg }}>{capitalize(selectedCategory)}</h2>
                  {store.aiCategoryDescriptions?.[selectedCategory.toLowerCase()] && (
                    <p className="text-[13px]" style={{ color: mutedFg }}>{store.aiCategoryDescriptions[selectedCategory.toLowerCase()]}</p>
                  )}
                </div>
              )}

              {/* Product Grid / List */}
              {filteredProducts.length === 0 ? (
                <div className="text-center py-20">
                  <Package size={40} className="mx-auto mb-3" style={{ color: mutedFg }} />
                  <p className="text-[15px] font-semibold" style={{ color: fg }}>No products in this category</p>
                  <button onClick={() => setSelectedCategory(null)} className="mt-3 text-[13px] font-bold" style={{ color: pc }}>
                    View all products
                  </button>
                </div>
              ) : viewMode === "grid" ? (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-5">
                  {filteredProducts.map((product, i) => (
                    <MotionReveal key={product.id} index={i}>
                      <ProductCard product={product} />
                    </MotionReveal>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredProducts.map((product, i) => (
                    <MotionReveal key={product.id} index={i}>
                      <button
                        onClick={() => navigate(`~/s/${store.slug}/product/${product.id}`)}
                        className="w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all hover:shadow-md"
                        style={{ backgroundColor: cardBg, borderColor }}
                      >
                        <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0" style={{ backgroundColor: `${pc}10` }}>
                          {product.imageUrl ? (
                            <WebstoreLogoOverlayCard
                              productId={product.id}
                              productImageUrl={product.imageUrl}
                              logoUrl={store.client?.logoUrl ?? null}
                              placement={extractWebstorePlacement(product)}
                              renderedImageUrl={product.webstoreRenderedImageUrl}
                              alt={product.name}
                              className="w-full h-full"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package size={24} style={{ color: pc }} />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] font-bold truncate" style={{ color: fg }}>{product.name}</p>
                          {product.description && (
                            <p className="text-[13px] mt-0.5 line-clamp-1" style={{ color: mutedFg }}>{product.description}</p>
                          )}
                          <p className="text-[13px] mt-1" style={{ color: mutedFg }}>{capitalize(product.category || "Other")}</p>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-[17px] font-extrabold" style={{ color: pc }}>
                            ${parseFloat(product.customPrice || product.basePrice).toFixed(2)}
                          </p>
                          <div className="mt-1.5 px-3 py-1 rounded-lg text-[12px] font-bold text-white" style={{ backgroundColor: pc }}>
                            View
                          </div>
                        </div>
                      </button>
                    </MotionReveal>
                  ))}
                </div>
              )}
            </main>
          </div>
        </div>
      </CurtainContentWrapper>

      <CurtainRevealFooter variant="classic" />
      <FloatingCartFAB />
      <BackToTop />
    </>
  );
}
