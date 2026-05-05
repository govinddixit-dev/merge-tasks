/**
 * ModernProductCard — compact, no-chrome product card for the Modern
 * template's home + shop grids.
 *
 * Differs from the shared ProductCard:
 *   - No card border, no shadow — just the image + name + price stacked
 *     on the paper background. Matches the wireframe Modern aesthetic
 *     (Apple Store density).
 *   - 4/5 portrait image aspect (vs 1/1 / 4/3 elsewhere) so more cards
 *     fit above the fold.
 *   - Smaller padding, smaller name + price text.
 *
 * Preserves regression-critical features:
 *   - Phase 6/7 logo overlay via WebstoreLogoOverlayCard (AI placement +
 *     photoreal render fallback)
 *   - Featured badge (pill / ribbon / corner per store.aiProductBadgeStyle)
 *   - print-type badge
 *   - addToCart on the inline + button (with stopPropagation)
 *   - SPA navigation via wouter (NOT window.location.href — that breaks
 *     the wouter `~/` prefix and lands on the wrong route)
 */
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { useStore, capitalize } from "../../StoreContext";
import type { StoreProduct } from "../../StoreContext";
import { WebstoreLogoOverlayCard, extractWebstorePlacement } from "../../WebstoreLogoOverlay";

function FeaturedBadge({ style, color }: { style: "pill" | "ribbon" | "corner"; color: string }) {
  if (style === "ribbon") {
    return (
      <div
        className="absolute top-0 left-0 px-2.5 py-0.5 text-[9px] font-bold text-white uppercase tracking-wider"
        style={{ backgroundColor: color, clipPath: "polygon(0 0, 100% 0, 90% 100%, 0 100%)" }}
      >
        Featured
      </div>
    );
  }
  if (style === "corner") {
    return (
      <div className="absolute top-0 right-0 w-14 h-14 overflow-hidden">
        <div
          className="absolute top-[6px] right-[-22px] w-[80px] text-center text-[8px] font-bold text-white uppercase tracking-wider py-0.5 rotate-45"
          style={{ backgroundColor: color }}
        >
          Featured
        </div>
      </div>
    );
  }
  return (
    <span
      className="absolute top-2.5 left-2.5 px-2 py-0.5 text-[9px] font-bold text-white uppercase tracking-wider"
      style={{ backgroundColor: color }}
    >
      Featured
    </span>
  );
}

export default function ModernProductCard({ product }: { product: StoreProduct }) {
  const { store, addToCart } = useStore();
  const [, navigate] = useLocation();
  const price = parseFloat(product.customPrice ?? product.basePrice);
  const badgeStyle = store.aiProductBadgeStyle ?? "pill";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`~/s/${store.slug}/product/${product.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(`~/s/${store.slug}/product/${product.id}`);
      }}
      className="group cursor-pointer"
    >
      <div className="relative aspect-[4/5] bg-paper-soft overflow-hidden">
        <WebstoreLogoOverlayCard
          productId={product.id}
          productImageUrl={product.imageUrl}
          logoUrl={store.client?.logoUrl ?? null}
          placement={extractWebstorePlacement(product)}
          renderedImageUrl={product.webstoreRenderedImageUrl}
          alt={product.name}
          className="w-full h-full transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
        {product.featured && <FeaturedBadge style={badgeStyle} color={store.primaryColor} />}
        {product.type === "print" && (
          <span className="absolute top-2.5 right-2.5 px-2 py-0.5 text-[9px] font-bold bg-indigo-600 text-white uppercase tracking-wider">
            Print
          </span>
        )}
        {/* Add-to-cart button reveals on hover. stopPropagation so it
            doesn't trigger the card-level navigate. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            addToCart(product);
          }}
          aria-label={`Add ${product.name} to cart`}
          className="absolute bottom-2.5 right-2.5 w-8 h-8 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: store.primaryColor }}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="pt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ws-muted leading-none">
          {capitalize(product.category || "Product")}
        </p>
        <p className="text-[13px] font-medium text-ink mt-1.5 line-clamp-1">
          {product.name}
        </p>
        <p className="text-[13px] text-ink/80 mt-0.5">
          ${price.toFixed(2)}
        </p>
      </div>
    </div>
  );
}
