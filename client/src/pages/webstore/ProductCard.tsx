/**
 * ProductCard — Redesigned product card with hover CTA overlay,
 * badge style awareness, and smooth motion animations.
 *
 * PRESERVED from original:
 * - addToCart(product) call on button click
 * - navigate(`~/s/${store.slug}/product/${product.id}`) on card click
 * - e.stopPropagation() on the + button
 * - product.featured badge
 * - product.type === "print" badge
 * - store.primaryColor usage
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Package, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { useStore, capitalize } from "./StoreContext";
import type { StoreProduct } from "./StoreContext";
import { WebstoreLogoOverlayCard, extractWebstorePlacement } from "./WebstoreLogoOverlay";
import { getStoreTheme } from "./storeThemeUtils";

function FeaturedBadge({
  style,
  color,
}: {
  style: "pill" | "ribbon" | "corner";
  color: string;
}) {
  if (style === "ribbon") {
    return (
      <div
        className="absolute top-0 left-0 px-3 py-1 text-[10px] font-bold text-white uppercase tracking-wider"
        style={{
          backgroundColor: color,
          clipPath: "polygon(0 0, 100% 0, 90% 100%, 0 100%)",
        }}
      >
        Featured
      </div>
    );
  }
  if (style === "corner") {
    return (
      <div
        className="absolute top-0 right-0 w-16 h-16 overflow-hidden"
      >
        <div
          className="absolute top-[6px] right-[-20px] w-[80px] text-center text-[9px] font-bold text-white uppercase tracking-wider py-0.5 rotate-45"
          style={{ backgroundColor: color }}
        >
          Featured
        </div>
      </div>
    );
  }
  // pill (default)
  return (
    <span
      className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-wider"
      style={{ backgroundColor: color }}
    >
      Featured
    </span>
  );
}

export default function ProductCard({ product }: { product: StoreProduct }) {
  const { store, addToCart, isDark } = useStore();
  const [, navigate] = useLocation();
  const [isHovered, setIsHovered] = useState(false);
  const theme = getStoreTheme(store);

  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const cardBg = isDark ? "#2A2A2A" : "#FFFFFF";
  const borderColor = isDark ? "#333" : "#E5E5E5";
  const price = parseFloat(product.customPrice ?? product.basePrice);

  return (
    <motion.div
      className={`${theme.cardRadius} overflow-hidden transition-shadow cursor-pointer group`}
      style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
      onClick={() => navigate(`~/s/${store.slug}/product/${product.id}`)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={{ scale: 1.02, y: -4, boxShadow: "0 12px 40px rgba(0,0,0,0.10)" }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      {/* Image Container */}
      <div className={`${theme.imageAspect} overflow-hidden bg-mt-surface-2 relative`}>
        <motion.div
          className="w-full h-full"
          animate={{ scale: isHovered ? 1.06 : 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <WebstoreLogoOverlayCard
            productId={product.id}
            productImageUrl={product.imageUrl}
            logoUrl={store.client?.logoUrl ?? null}
            placement={extractWebstorePlacement(product)}
            renderedImageUrl={product.webstoreRenderedImageUrl}
            alt={product.name}
            className="w-full h-full"
          />
        </motion.div>

        {/* Badges */}
        {product.featured && (
          <FeaturedBadge style={theme.badgeStyle} color={store.primaryColor} />
        )}
        {product.type === "print" && (
          <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white uppercase tracking-wider">
            Print
          </span>
        )}

        {/* Hover CTA overlay */}
        <motion.div
          className="absolute inset-x-0 bottom-0 flex items-center justify-center pb-4 pt-10"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.5), transparent)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              addToCart(product);
            }}
            aria-label={`Add ${product.name} to cart`}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-semibold text-white transition-transform hover:scale-105 backdrop-blur-sm"
            style={{ backgroundColor: store.primaryColor }}
          >
            <Plus size={14} />
            {theme.ctaLabel}
          </button>
        </motion.div>
      </div>

      {/* Details */}
      <div className="p-4">
        <p
          className="text-[11px] font-semibold uppercase tracking-wider mb-1"
          style={{ color: store.primaryColor }}
        >
          {capitalize(product.category || "Product")}
        </p>
        <p
          className={`${theme.cardNameSize} font-bold mb-2 line-clamp-2`}
          style={{ color: fg }}
        >
          {product.name}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-bold" style={{ color: fg }}>
            ${price.toFixed(2)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              addToCart(product);
            }}
            aria-label={`Add ${product.name} to cart`}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform hover:scale-110"
            style={{ backgroundColor: store.primaryColor }}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
