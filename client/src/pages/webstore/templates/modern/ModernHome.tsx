/**
 * ModernHome — wireframe-driven home for the Modern template.
 *
 * Sections (per /home/ubuntu/wireframes/handoff/screens/storefront-home.md):
 *   1. Hero — mixed serif italic + sans headline + small CTA pair
 *   2. Categories strip — 4-up cards
 *   3. Featured products — same grid as Modern shop, branded overlays
 *      preserved via the existing <ProductCard> (Phase 6/7 AI placement)
 *      or <VariantProductCard> (variant grouping)
 *   4. How-it-works dark band — 3-step
 *
 * Wires to existing data from StoreContext only — no new tRPC hooks.
 * Reads editor overrides (editorHeroHeadline / editorTagline) before AI
 * fallbacks and finally the brand defaults so the regression checklist's
 * "AI-generated content" + "Editor overrides" items both work.
 */
import { Link, useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { useStore, capitalize } from "../../StoreContext";
import { VariantProductCard } from "@/components/products/VariantProductCard";
import ModernShell from "./ModernShell";
import ModernProductCard from "./ModernProductCard";

export default function ModernHome() {
  const { store, isLoggedIn, storeUser } = useStore();
  const [, navigate] = useLocation();
  const companyName = store.client?.companyName || store.name;

  // Hero copy — editor wins, then AI, then a static fallback. Italic word
  // is the LAST whitespace-delimited token of the headline, mirroring the
  // wireframe pattern ("Branded gear for your *team*.").
  const heroHeadlineRaw =
    store.editorHeroHeadline?.trim() ||
    store.aiHeroHeadline?.trim() ||
    `Branded gear for your team`;
  const heroSubtitle =
    store.editorHeroSubtitle?.trim() ||
    store.aiHeroSubtitle?.trim() ||
    store.aiDescription?.trim() ||
    "Browse, customize and order on-demand decoration. Quotes within 24h.";
  const tagline = store.editorTagline || store.aiTagline;

  const headlineParts = heroHeadlineRaw.split(/\s+/);
  const italicWord = headlineParts.length > 1 ? headlineParts.pop() : null;
  const headlineLead = headlineParts.join(" ");

  // Categories — same source as Classic/Minimal so distributor-curated
  // category lists stay consistent across templates.
  const categories = Array.from(
    new Set(store.products.map(p => p.category || "Other")),
  ).filter(Boolean).slice(0, 4);

  // Featured = first 8 products. Falls through to the variant-grouped
  // grid when productGroups is present so swatch strips + per-variant
  // approved renders show on cards.
  const groups = store.productGroups ?? [];
  const featuredGroups = groups.slice(0, 4);
  const featuredFlat = store.products.slice(0, 4);

  return (
    <ModernShell footer="default">
      {/* ── HERO ── */}
      <section className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-12 pt-12 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-16 items-center">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-brand mb-4">
              {isLoggedIn && storeUser?.name
                ? `Welcome back, ${storeUser.name.split(" ")[0]}`
                : `${companyName} Collection`}
            </p>
            <h1 className="text-[48px] sm:text-[68px] lg:text-[80px] font-bold leading-[1] tracking-tight text-ink">
              {headlineLead}
              {italicWord && (
                <>
                  {" "}
                  <em className="font-serif-display font-normal italic text-ink">
                    {italicWord}.
                  </em>
                </>
              )}
            </h1>
            <p className="mt-6 max-w-[480px] text-[15px] leading-[1.6] text-ws-muted">
              {heroSubtitle}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(`~/s/${store.slug}/products`)}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-none bg-ink text-paper text-[12px] font-bold tracking-[0.12em] uppercase hover:bg-ink-soft transition-colors"
              >
                Shop Now <ArrowRight size={14} />
              </button>
              {isLoggedIn && (
                <Link href={`~/s/${store.slug}/custom-request`}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-none border border-ink text-ink text-[12px] font-bold tracking-[0.12em] uppercase hover:bg-ink hover:text-paper transition-colors"
                  >
                    Custom Request
                  </button>
                </Link>
              )}
            </div>
          </div>

          {/* Hero image — bannerUrl from editor override or AI, or empty
              paper-soft block (no broken image). */}
          <div
            className="aspect-[4/5] bg-paper-soft border border-rule overflow-hidden"
            style={store.bannerUrl ? { backgroundImage: `url(${store.bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : {}}
          />
        </div>

        {tagline && (
          <p className="mt-12 max-w-[640px] text-[20px] sm:text-[24px] leading-[1.4] font-serif-display italic text-ink">
            "{tagline}"
          </p>
        )}
      </section>

      {/* ── CATEGORIES ── */}
      {categories.length > 0 && (
        <section className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-12 pb-20">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-[28px] sm:text-[32px] font-bold tracking-tight text-ink">
              Shop by category
            </h2>
            <Link href={`~/s/${store.slug}/products`}>
              <span className="text-[12px] font-bold tracking-[0.14em] uppercase text-brand cursor-pointer hover:underline underline-offset-4">
                View all →
              </span>
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
            {categories.map(cat => (
              <Link key={cat} href={`~/s/${store.slug}/products?cat=${encodeURIComponent(cat)}`}>
                <div className="cursor-pointer group">
                  <div className="aspect-square bg-paper-soft border border-rule overflow-hidden" />
                  <div className="pt-3 text-[15px] font-semibold text-ink">
                    {capitalize(cat)}
                  </div>
                  {store.aiCategoryDescriptions?.[cat.toLowerCase()] && (
                    <p className="text-[12px] text-ws-muted mt-0.5 line-clamp-2">
                      {store.aiCategoryDescriptions[cat.toLowerCase()]}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── FEATURED ── */}
      {(featuredGroups.length > 0 || featuredFlat.length > 0) && (
        <section className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-12 pb-20">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="text-[24px] sm:text-[28px] font-bold tracking-tight text-ink">
              Featured
            </h2>
            <Link href={`~/s/${store.slug}/products`}>
              <span className="text-[12px] font-bold tracking-[0.14em] uppercase text-brand cursor-pointer hover:underline underline-offset-4">
                View all →
              </span>
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
            {featuredGroups.length > 0
              ? featuredGroups.slice(0, 5).map(g => {
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
                      // Use wouter SPA navigation to the primary product's
                      // numeric id so PDP can resolve it. The previous
                      // window.location.href + `~/` breaks the wouter
                      // root-relative prefix and 404s into the admin shell.
                      onSelect={() => navigate(`~/s/${store.slug}/product/${g.primary.id}`)}
                    />
                  );
                })
              : featuredFlat.slice(0, 5).map(p => <ModernProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* ── CLOSING CTA ──
          Replaces the old "Ready to checkout?" copy that lived in the
          legacy CurtainRevealFooter. A homepage closer makes more sense
          here as a brand prompt to either request a custom item (logged
          in) or explore the catalog (everyone). */}
      <section className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-12 pb-24">
        <div className="bg-ink text-paper px-6 lg:px-16 py-14 lg:py-20 text-center">
          <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-brand mb-3">
            {isLoggedIn ? "Don't see what you need?" : "Have a closer look"}
          </p>
          <h2 className="font-serif-display italic text-[36px] sm:text-[52px] leading-[1.05] mb-4">
            {isLoggedIn
              ? <>Tell us what you have in <span className="not-italic font-bold tracking-tight">mind.</span></>
              : <>Explore the full <span className="not-italic font-bold tracking-tight">catalog.</span></>
            }
          </h2>
          <p className="max-w-[480px] mx-auto text-[14px] text-paper/70 leading-relaxed mb-8">
            {isLoggedIn
              ? "Submit a custom request and your distributor will respond within one business day with options and pricing."
              : "Hundreds of curated items, ready to brand for your team."}
          </p>
          <Link href={`~/s/${store.slug}/${isLoggedIn ? "custom-request" : "products"}`}>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-paper text-ink text-[12px] font-bold tracking-[0.12em] uppercase hover:bg-paper-soft transition-colors"
            >
              {isLoggedIn ? "Submit a Custom Request" : "Browse the Catalog"}
              <ArrowRight size={14} />
            </button>
          </Link>
        </div>
      </section>
    </ModernShell>
  );
}
