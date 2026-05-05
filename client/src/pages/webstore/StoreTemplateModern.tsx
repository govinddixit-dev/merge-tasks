/**
 * StoreTemplateModern — Full-width hero + card-based browsing (flagship).
 *
 * UI/UX lift (pure visual, zero functional regression):
 *   - AI-personalized hero greets the user by name, shows department
 *     and remaining budget, and surfaces role-relevant items.
 *   - Card-based product recommendations ordered by relevance.
 *   - Horizontal pill filter bar below the hero.
 *   - Parallax + fade-in hero on load.
 *   - Staggered entrance on category and product grids.
 *   - Curtain reveal footer + FAB + back-to-top.
 *
 * All original tRPC calls, cart handlers, navigation, and controls preserved.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Truck, Shield, Star, Headphones, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { useStore, capitalize, getCategoryIcon } from "./StoreContext";
import ProductCard from "./ProductCard";
import { usePersonalization } from "./usePersonalization";
import {
  BackToTop, CurtainContentWrapper, CurtainRevealFooter, FloatingCartFAB, MotionReveal, ParallaxHero,
} from "./templateChrome";

export default function StoreTemplateModern() {
  const { store, isDark } = useStore();
  const [, navigate] = useLocation();
  const personalization = usePersonalization();

  const pc = store.primaryColor;
  const bg = isDark ? "#151515" : "#FFFFFF";
  const cardBg = isDark ? "#252525" : "#FAFAFA";
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const borderColor = isDark ? "#333" : "#E5E5E5";

  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const rankedProducts = personalization.rankedProducts;
  const featuredProducts = rankedProducts.filter(p => p.featured).slice(0, 4);
  const displayProducts = featuredProducts.length > 0 ? featuredProducts : rankedProducts.slice(0, 4);

  const rawCategories = useMemo(
    () => Array.from(new Set(store.products.map(p => p.category || "Other"))),
    [store.products],
  );
  const categories = useMemo(() => {
    const rel = personalization.relevantCategories;
    if (rel.length === 0) return rawCategories;
    const lookup = new Map<string, string>();
    rawCategories.forEach(c => lookup.set(c.toLowerCase(), c));
    const ordered: string[] = [];
    rel.forEach(r => { const c = lookup.get(r); if (c && !ordered.includes(c)) ordered.push(c); });
    rawCategories.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
    return ordered;
  }, [rawCategories, personalization.relevantCategories]);

  const filteredForGrid = activeFilter
    ? rankedProducts.filter(p => (p.category || "Other") === activeFilter)
    : displayProducts;

  const heroHeadline =
    personalization.isPersonalized && personalization.firstName
      ? `Hi ${personalization.firstName}, welcome back`
      : store.aiHeroHeadline || store.aiTagline || store.welcomeMessage || `Welcome to ${store.client?.companyName || store.name}`;

  const heroSubtitle =
    personalization.isPersonalized && personalization.department
      ? `Curated picks for ${personalization.department}${personalization.budgetRemaining ? ` · ${personalization.budgetRemaining} budget remaining` : ""}.`
      : store.aiHeroSubtitle || store.aiDescription || "Premium branded merchandise, curated for your team.";

  return (
    <>
      <CurtainContentWrapper variant="modern" background={bg}>
        {/*  Full-Width AI Hero Banner  */}
        <ParallaxHero
          className="relative flex items-center justify-center overflow-hidden"
          style={{
            minHeight: "560px",
            background: store.bannerUrl
              ? `url(${store.bannerUrl}) center/cover no-repeat`
              : `linear-gradient(160deg, ${pc} 0%, ${pc}CC 40%, ${pc}66 100%)`,
          }}
        >
          {!store.bannerUrl && (
            <>
              <div className="absolute inset-0" style={{
                backgroundImage: `radial-gradient(circle at 20% 80%, rgba(255,255,255,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.12) 0%, transparent 50%)`,
              }} />
              <div className="absolute top-12 right-16 w-32 h-32 rounded-full opacity-10" style={{ backgroundColor: "#fff" }} />
              <div className="absolute bottom-8 left-12 w-20 h-20 rounded-xl opacity-10 rotate-12" style={{ backgroundColor: "#fff" }} />
              <div className="absolute top-1/2 right-1/4 w-4 h-4 rounded-full opacity-20" style={{ backgroundColor: "#fff" }} />
            </>
          )}
          {store.bannerUrl && <div className="absolute inset-0 bg-black/35" />}

          <div className="relative z-10 text-center px-6 py-20 max-w-3xl mx-auto">
            {personalization.isPersonalized ? (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-[11px] font-bold uppercase tracking-widest"
                style={{ backgroundColor: "rgba(255,255,255,0.18)", color: "#fff", backdropFilter: "blur(8px)" }}>
                <Sparkles size={10} />
                Personalized for {personalization.department || "your team"}
              </div>
            ) : (
              store.client?.industry && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full mb-6 text-[11px] font-bold uppercase tracking-widest"
                  style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "#fff", backdropFilter: "blur(8px)" }}>
                  <Sparkles size={10} />
                  {store.client.industry}
                </div>
              )
            )}

            {(store.client?.logoUrl || store.logoUrl) && (
              <div className="mb-6 flex justify-center">
                <img
                  src={store.client?.logoUrl || store.logoUrl || ""}
                  alt={store.client?.companyName || store.name}
                  className="h-16 sm:h-20 object-contain"
                  style={{ filter: (!store.bannerUrl && !isDark) ? "brightness(0) invert(1)" : undefined }}
                />
              </div>
            )}

            <motion.h1
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="text-3xl sm:text-4xl lg:text-5xl font-extrabold mb-5 leading-tight tracking-tight"
              style={{ color: "#FFFFFF" }}
            >
              {heroHeadline}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
              className="text-[17px] mb-10 max-w-xl mx-auto leading-relaxed"
              style={{ color: "rgba(255,255,255,0.88)" }}
            >
              {heroSubtitle}
            </motion.p>

            {personalization.isPersonalized && personalization.budgetRemaining && (
              <div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 text-[13px] font-bold"
                style={{ backgroundColor: "rgba(255,255,255,0.95)", color: pc }}
              >
                <Wallet size={14} />
                Budget remaining: {personalization.budgetRemaining}
                {personalization.budgetPct != null && (
                  <span className="opacity-70">({personalization.budgetPct}% used)</span>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => navigate(`~/s/${store.slug}/products`)}
                className="inline-flex items-center gap-2 px-10 py-3.5 rounded-lg text-[15px] font-bold transition-all hover:scale-105 hover:shadow-lg"
                style={{ backgroundColor: "#FFFFFF", color: pc }}
              >
                Shop Collection <ArrowRight size={16} />
              </button>
              {categories.length > 1 && (
                <button
                  onClick={() => {
                    const el = document.getElementById("categories-section");
                    el?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="inline-flex items-center gap-2 px-8 py-3.5 rounded-lg text-[15px] font-semibold transition-all hover:scale-105"
                  style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "#fff", backdropFilter: "blur(8px)" }}
                >
                  Browse Categories
                </button>
              )}
            </div>
          </div>
        </ParallaxHero>

        {/*  Horizontal pill filter bar  */}
        {categories.length > 1 && (
          <section className="sticky-filter-bar border-b" style={{ backgroundColor: bg, borderColor }}>
            <div className="max-w-[1200px] mx-auto px-6 py-4 flex gap-2 overflow-x-auto">
              <button
                onClick={() => setActiveFilter(null)}
                className="px-4 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-all"
                style={{
                  backgroundColor: !activeFilter ? pc : `${pc}12`,
                  color: !activeFilter ? "#fff" : pc,
                }}
              >
                All
              </button>
              {categories.map(cat => {
                const isActive = activeFilter === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveFilter(isActive ? null : cat)}
                    className="px-4 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-all"
                    style={{
                      backgroundColor: isActive ? pc : `${pc}12`,
                      color: isActive ? "#fff" : pc,
                    }}
                  >
                    {capitalize(cat)}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/*  Trust Bar  */}
        <section className="py-5" style={{ backgroundColor: isDark ? "#222" : "#F8F8F8" }}>
          <div className="max-w-[1200px] mx-auto px-6 flex flex-wrap items-center justify-center gap-8 sm:gap-14">
            {[
              { icon: Truck, text: "Free Shipping" },
              { icon: Shield, text: "Secure Checkout" },
              { icon: Star, text: "Premium Quality" },
              { icon: Headphones, text: "Dedicated Support" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${pc}15` }}>
                  <Icon size={15} style={{ color: pc }} />
                </div>
                <span className="text-[13px] font-semibold" style={{ color: fg }}>{text}</span>
              </div>
            ))}
          </div>
        </section>

        {store.aiTagline && (
          <section className="py-6" style={{ backgroundColor: `${pc}08` }}>
            <div className="max-w-[1200px] mx-auto px-6 text-center">
              <div className="inline-flex items-center gap-2">
                <TrendingUp size={16} style={{ color: pc }} />
                <span className="text-[15px] font-bold italic" style={{ color: pc }}>"{store.aiTagline}"</span>
              </div>
            </div>
          </section>
        )}

        {/*  Categories  */}
        {categories.length > 1 && (
          <section id="categories-section" className="py-14 sm:py-18">
            <div className="max-w-[1200px] mx-auto px-6">
              <div className="flex items-center justify-between mb-10">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight" style={{ color: fg }}>Shop by Category</h2>
                  <p className="text-[14px] mt-1" style={{ color: mutedFg }}>Browse our curated collections</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                {categories.map((cat, i) => {
                  const count = store.products.filter(p => (p.category || "Other") === cat).length;
                  const CatIcon = getCategoryIcon(cat);
                  const isRelevant = personalization.relevantCategories.slice(0, 3).includes(cat.toLowerCase());
                  return (
                    <MotionReveal key={cat} index={i}>
                      <button
                        onClick={() => navigate(`~/s/${store.slug}/products?cat=${encodeURIComponent(cat)}`)}
                        className="group w-full p-6 rounded-2xl text-left transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 relative"
                        style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
                      >
                        {isRelevant && personalization.isPersonalized && (
                          <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                            style={{ backgroundColor: `${pc}20`, color: pc }}>
                            <Sparkles size={9} className="inline -mt-0.5 mr-0.5" /> For you
                          </span>
                        )}
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110" style={{ backgroundColor: `${pc}15` }}>
                          <CatIcon size={22} style={{ color: pc }} />
                        </div>
                        <p className="text-[16px] font-bold mb-1" style={{ color: fg }}>{capitalize(cat)}</p>
                        {store.aiCategoryDescriptions?.[cat.toLowerCase()] && (
                          <p className="text-[12px] mb-1.5 leading-snug" style={{ color: mutedFg }}>{store.aiCategoryDescriptions[cat.toLowerCase()]}</p>
                        )}
                        <p className="text-[13px]" style={{ color: mutedFg }}>{count} product{count !== 1 ? "s" : ""}</p>
                      </button>
                    </MotionReveal>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/*  AI Card-Based Recommendations  */}
        <section className="py-14 sm:py-18" style={{ backgroundColor: cardBg }}>
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="flex items-center justify-between mb-10">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight" style={{ color: fg }}>
                  {personalization.isPersonalized
                    ? "Recommended for you"
                    : featuredProducts.length > 0 ? "Featured Products" : "Our Products"}
                </h2>
                <p className="text-[14px] mt-1" style={{ color: mutedFg }}>
                  {personalization.isPersonalized
                    ? `Ranked by relevance to ${personalization.department || "your role"}`
                    : "Hand-picked for your team"}
                </p>
              </div>
              <button
                onClick={() => navigate(`~/s/${store.slug}/products`)}
                className="text-[13px] font-bold flex items-center gap-1.5 px-4 py-2 rounded-lg transition-colors"
                style={{ color: pc, backgroundColor: `${pc}10` }}
              >
                View All <ArrowRight size={14} />
              </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              {filteredForGrid.map((product, i) => (
                <MotionReveal key={product.id} index={i}>
                  <ProductCard product={product} />
                </MotionReveal>
              ))}
            </div>
          </div>
        </section>

        {store.aiDescription && (
          <section className="py-14">
            <div className="max-w-[800px] mx-auto px-6 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ backgroundColor: `${pc}15` }}>
                <Sparkles size={22} style={{ color: pc }} />
              </div>
              <p className="text-[17px] leading-relaxed font-medium" style={{ color: fg }}>{store.aiDescription}</p>
            </div>
          </section>
        )}
      </CurtainContentWrapper>

      <CurtainRevealFooter variant="modern" />
      <FloatingCartFAB />
      <BackToTop />
    </>
  );
}
