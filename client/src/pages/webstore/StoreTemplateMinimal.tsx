/**
 * StoreTemplateMinimal — Clean single-column flow with large imagery.
 *
 * UI/UX lift (pure visual, zero functional regression):
 *   - Subtle personalized header strip with name + budget (unobtrusive).
 *   - Single-column product list reordered by AI relevance.
 *   - Minimal category filter bar at top (no sidebar).
 *   - Staggered editorial entrance.
 *   - Constrained centered curtain reveal footer — "Picked for you".
 *
 * All original tRPC calls, cart handlers, navigation, and controls preserved.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Package, Quote } from "lucide-react";
import { WebstoreLogoOverlayCard, extractWebstorePlacement } from "./WebstoreLogoOverlay";
import { useStore, capitalize, getCategoryIcon } from "./StoreContext";
import { usePersonalization } from "./usePersonalization";
import {
  BackToTop, CurtainContentWrapper, CurtainRevealFooter, FloatingCartFAB, MotionReveal,
} from "./templateChrome";

export default function StoreTemplateMinimal() {
  const { store, isDark } = useStore();
  const [, navigate] = useLocation();
  const personalization = usePersonalization();

  const pc = store.primaryColor;
  const bg = isDark ? "#0F0F0F" : "#FFFFFF";
  const cardBg = isDark ? "#1A1A1A" : "#F7F7F7";
  const fg = isDark ? "#F5F5F5" : "#111111";
  const mutedFg = isDark ? "#888" : "#888";
  const borderColor = isDark ? "#222" : "#E8E8E8";

  const [activeCat, setActiveCat] = useState<string | null>(null);

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

  const rankedProducts = personalization.rankedProducts;
  const featuredProducts = rankedProducts.filter(p => p.featured);
  const baseProducts = featuredProducts.length > 0 ? featuredProducts : rankedProducts;
  const displayProducts = activeCat
    ? rankedProducts.filter(p => (p.category || "Other") === activeCat)
    : baseProducts;

  const heroHeadline = store.aiHeroHeadline || `${store.client?.companyName || store.name}`;
  const heroSubtitle = store.aiHeroSubtitle || store.aiDescription || "Curated merchandise for your team.";

  return (
    <>
      <CurtainContentWrapper variant="minimal" background={bg}>
        <div style={{ backgroundColor: bg, color: fg }}>
          {/*  Subtle Personalized Strip  */}
          {personalization.isPersonalized && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="border-b"
              style={{ borderColor }}
            >
              <div className="max-w-[1100px] mx-auto px-8 sm:px-16 py-4 flex items-center justify-between gap-4">
                <span className="text-[12px] font-light" style={{ color: mutedFg }}>
                  {personalization.firstName ? (
                    <>
                      <span className="tracking-wide">
                        {personalization.firstName}
                      </span>
                      {personalization.department && (
                        <span className="opacity-70"> · {personalization.department}</span>
                      )}
                    </>
                  ) : (
                    "Signed in"
                  )}
                </span>
                {personalization.budgetRemaining && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: fg }}>
                    <span className="opacity-60">Budget</span>{" "}
                    <span style={{ color: pc }}>{personalization.budgetRemaining}</span>
                  </span>
                )}
              </div>
            </motion.div>
          )}

          {/*  Full-Bleed Hero  */}
          <section
            className="relative flex items-end overflow-hidden"
            style={{
              minHeight: "560px",
              background: store.bannerUrl
                ? `url(${store.bannerUrl}) center/cover no-repeat`
                : bg,
            }}
          >
            {store.bannerUrl && <div className="absolute inset-0 bg-black/50" />}
            {!store.bannerUrl && (
              <div
                className="absolute top-0 right-0 w-1/2 h-full opacity-5"
                style={{ backgroundColor: pc }}
              />
            )}

            <div className="relative z-10 max-w-[1100px] mx-auto px-8 sm:px-16 pb-20 pt-24 w-full">
              <div className="w-12 h-px mb-8" style={{ backgroundColor: store.bannerUrl ? "#fff" : pc }} />

              {(store.client?.logoUrl || store.logoUrl) && (
                <div className="mb-8">
                  <img
                    src={store.client?.logoUrl || store.logoUrl || ""}
                    alt={store.client?.companyName || store.name}
                    className="h-12 object-contain"
                    style={{ filter: store.bannerUrl ? "brightness(0) invert(1)" : undefined }}
                  />
                </div>
              )}

              <motion.h1
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="text-4xl sm:text-5xl lg:text-6xl font-black mb-6 leading-[1.05] tracking-tight max-w-2xl"
                style={{ color: store.bannerUrl ? "#fff" : fg }}
              >
                {heroHeadline}
              </motion.h1>

              <p
                className="text-[16px] sm:text-[18px] max-w-lg leading-relaxed mb-10 font-light"
                style={{ color: store.bannerUrl ? "rgba(255,255,255,0.8)" : mutedFg }}
              >
                {heroSubtitle}
              </p>

              <button
                onClick={() => navigate(`~/s/${store.slug}/products`)}
                className="inline-flex items-center gap-3 text-[14px] font-bold tracking-wider uppercase transition-all hover:gap-4"
                style={{ color: store.bannerUrl ? "#fff" : pc }}
              >
                Explore Collection
                <ArrowRight size={16} />
              </button>
            </div>
          </section>

          {/*  Tagline / Quote  */}
          {store.aiTagline && (
            <section className="py-16 border-b" style={{ borderColor }}>
              <div className="max-w-[1100px] mx-auto px-8 sm:px-16 flex items-start gap-4">
                <Quote size={24} className="flex-shrink-0 mt-1" style={{ color: pc, opacity: 0.4 }} />
                <p className="text-[20px] sm:text-[24px] font-light italic leading-relaxed" style={{ color: fg }}>
                  {store.aiTagline}
                </p>
              </div>
            </section>
          )}

          {/*  Minimal category filter row  */}
          {categories.length > 1 && (
            <section className="py-10 border-b" style={{ borderColor }}>
              <div className="max-w-[1100px] mx-auto px-8 sm:px-16">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: mutedFg }}>
                    Collections
                  </h2>
                  <button
                    onClick={() => navigate(`~/s/${store.slug}/products`)}
                    className="text-[11px] font-bold uppercase tracking-[0.15em] flex items-center gap-1.5 transition-opacity hover:opacity-60"
                    style={{ color: fg }}
                  >
                    View All <ArrowUpRight size={12} />
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setActiveCat(null)}
                    className="px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] border transition-colors"
                    style={{
                      borderColor: !activeCat ? fg : borderColor,
                      color: !activeCat ? (isDark ? "#000" : "#fff") : fg,
                      backgroundColor: !activeCat ? fg : "transparent",
                    }}
                  >
                    All
                  </button>
                  {categories.map(cat => {
                    const isActive = activeCat === cat;
                    const CatIcon = getCategoryIcon(cat);
                    return (
                      <button
                        key={cat}
                        onClick={() => setActiveCat(isActive ? null : cat)}
                        className="inline-flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] border transition-colors"
                        style={{
                          borderColor: isActive ? fg : borderColor,
                          color: isActive ? (isDark ? "#000" : "#fff") : fg,
                          backgroundColor: isActive ? fg : "transparent",
                        }}
                      >
                        <CatIcon size={11} />
                        {capitalize(cat)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/*  Single-column product list — large editorial cards  */}
          <section className="py-16">
            <div className="max-w-[1100px] mx-auto px-8 sm:px-16">
              <div className="flex items-center justify-between mb-12">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: mutedFg }}>
                  {personalization.isPersonalized ? "Picked for you" : featuredProducts.length > 0 ? "Featured" : "The Collection"}
                </h2>
                <button
                  onClick={() => navigate(`~/s/${store.slug}/products`)}
                  className="text-[11px] font-bold uppercase tracking-[0.15em] flex items-center gap-1.5 transition-opacity hover:opacity-60"
                  style={{ color: fg }}
                >
                  All Products <ArrowUpRight size={12} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-px" style={{ backgroundColor: borderColor }}>
                {displayProducts.slice(0, 8).map((product, i) => (
                  <MotionReveal key={product.id} index={i}>
                    <button
                      onClick={() => navigate(`~/s/${store.slug}/product/${product.id}`)}
                      className="group w-full text-left transition-opacity hover:opacity-90"
                      style={{ backgroundColor: bg }}
                    >
                      <div
                        className="w-full overflow-hidden"
                        style={{ height: i === 0 ? "520px" : "380px", backgroundColor: cardBg }}
                      >
                        {product.imageUrl ? (
                          <WebstoreLogoOverlayCard
                            productId={product.id}
                            productImageUrl={product.imageUrl}
                            logoUrl={store.client?.logoUrl ?? null}
                            placement={extractWebstorePlacement(product)}
                            renderedImageUrl={product.webstoreRenderedImageUrl}
                            alt={product.name}
                            className="w-full h-full transition-transform duration-700 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package size={i === 0 ? 48 : 32} style={{ color: mutedFg, opacity: 0.4 }} />
                          </div>
                        )}
                      </div>
                      <div className="p-6 sm:p-8 border-b" style={{ borderColor }}>
                        <div className="flex items-start justify-between gap-8">
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-1.5" style={{ color: mutedFg }}>
                              {capitalize(product.category || "Other")}
                            </p>
                            <p className={`font-bold tracking-tight leading-tight ${i === 0 ? "text-[26px]" : "text-[19px]"}`} style={{ color: fg }}>
                              {product.name}
                            </p>
                            {product.description && (
                              <p className="text-[13px] mt-2 font-light line-clamp-2 max-w-xl" style={{ color: mutedFg }}>
                                {product.description}
                              </p>
                            )}
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className={`font-black ${i === 0 ? "text-[24px]" : "text-[18px]"}`} style={{ color: pc }}>
                              ${parseFloat(product.customPrice || product.basePrice).toFixed(2)}
                            </p>
                            <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider transition-all group-hover:gap-2" style={{ color: fg }}>
                              View <ArrowUpRight size={11} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  </MotionReveal>
                ))}
              </div>

              {displayProducts.length > 8 && (
                <div className="mt-12 text-center">
                  <button
                    onClick={() => navigate(`~/s/${store.slug}/products`)}
                    className="inline-flex items-center gap-3 px-10 py-4 border text-[13px] font-bold uppercase tracking-[0.15em] transition-all hover:opacity-70"
                    style={{ borderColor: fg, color: fg }}
                  >
                    View All {displayProducts.length} Products
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          </section>

          {/*  AI Description  */}
          {store.aiDescription && (
            <section className="py-16 border-t" style={{ borderColor }}>
              <div className="max-w-[1100px] mx-auto px-8 sm:px-16">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                  <div>
                    <div className="w-8 h-px mb-6" style={{ backgroundColor: pc }} />
                    <p className="text-[18px] font-light leading-relaxed" style={{ color: fg }}>
                      {store.aiDescription}
                    </p>
                  </div>
                  <div className="flex flex-col gap-6">
                    {[
                      { label: "Products", value: store.products.length.toString() },
                      { label: "Categories", value: categories.length.toString() },
                      { label: "Company", value: store.client?.companyName || store.name },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between py-4 border-b" style={{ borderColor }}>
                        <span className="text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: mutedFg }}>{label}</span>
                        <span className="text-[15px] font-bold" style={{ color: fg }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </CurtainContentWrapper>

      <CurtainRevealFooter variant="minimal" />
      <FloatingCartFAB />
      <BackToTop />
    </>
  );
}
