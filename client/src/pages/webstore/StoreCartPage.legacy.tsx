/**
 * StoreCartPage — Shopping cart with quantity controls and checkout CTA.
 */

import { useLocation } from "wouter";
import { ShoppingBag, Package, Minus, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useStore } from "./StoreContext";
import type { StoreData } from "./StoreContext";

export default function StoreCartPage() {
  const { store, cart, removeFromCart, updateQty, cartTotal, clearCart, isDark, isLoggedIn } = useStore();
  const [, navigate] = useLocation();
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const cardBg = isDark ? "#252525" : "#FAFAFA";
  const borderColor = isDark ? "#333" : "#E5E5E5";

  if (cart.length === 0) {
    const brandName = store.client?.companyName ?? store.name;
    const tagline = store.aiProductGridHeading ?? store.aiTagline ?? null;
    return (
      <motion.div
        className="max-w-[800px] mx-auto px-4 sm:px-6 py-20 text-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <ShoppingBag
          size={48}
          className="mx-auto mb-4"
          style={{ color: store.primaryColor }}
        />
        <h2 className="text-xl font-bold mb-2" style={{ color: fg }}>
          Your {brandName} cart is empty
        </h2>
        {tagline && (
          <p className="text-[14px] mb-1 font-medium" style={{ color: fg }}>
            {tagline}
          </p>
        )}
        <p className="text-[13px] mb-6" style={{ color: mutedFg }}>
          Browse the collection and add items to get started
        </p>
        <button
          onClick={() => navigate(`~/s/${store.slug}/products`)}
          className="px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white transition-transform hover:scale-[1.02]"
          style={{ backgroundColor: store.primaryColor }}
        >
          Browse Products
        </button>
      </motion.div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <h1 className="text-2xl font-bold" style={{ color: fg }}>Shopping Cart</h1>
        <button onClick={clearCart} className="text-[12px] font-semibold" style={{ color: "#EF4444" }}>Clear All</button>
      </div>

      <div className="space-y-4 mb-8">
        {cart.map(item => {
          // Print items come pre-quantified by tier (e.g. 500 units); the
          // quantity stepper then multiplies whole bundles. Promo items step
          // by 1 unit at a time — the original behavior.
          const isPrint = item.kind === "print";
          const step = isPrint ? Math.max(1, Math.round(item.quantity / Math.max(1, item.quantity))) : 1;
          return (
            <div key={item.lineKey} className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl" style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}>
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-white flex-shrink-0">
                {item.image ? (
                  <img src={item.image} alt={item.name} className="w-full h-full object-contain p-1" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Package size={20} className="text-[#D4D4D4]" /></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold truncate" style={{ color: fg }}>{item.name}</p>
                {isPrint && item.variantLabel && (
                  <p className="text-[11px] truncate" style={{ color: mutedFg }}>{item.variantLabel}</p>
                )}
                <p className="text-[12px]" style={{ color: mutedFg }}>${item.price.toFixed(2)} each</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQty(item.lineKey, item.quantity - step)}
                  aria-label={`Decrease quantity of ${item.name}`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                  style={{ backgroundColor: store.primaryColor }}
                >
                  <Minus size={12} />
                </button>
                <span className="w-12 text-center text-[14px] font-semibold" style={{ color: fg }}>{item.quantity}</span>
                <button
                  onClick={() => updateQty(item.lineKey, item.quantity + step)}
                  aria-label={`Increase quantity of ${item.name}`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                  style={{ backgroundColor: store.primaryColor }}
                >
                  <Plus size={12} />
                </button>
              </div>
              <p className="text-[14px] font-bold w-24 text-right" style={{ color: fg }}>${(item.price * item.quantity).toFixed(2)}</p>
              <button onClick={() => removeFromCart(item.lineKey)} aria-label={`Remove ${item.name} from cart`} className="p-2 rounded-lg transition-colors hover:bg-red-50">
                <Trash2 size={16} className="text-[#EF4444]" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="p-6 rounded-xl" style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-[16px] font-semibold" style={{ color: fg }}>Total</span>
          <span className="text-[24px] font-bold" style={{ color: fg }}>${cartTotal.toFixed(2)}</span>
        </div>
        <button
          onClick={() => {
            if (!isLoggedIn) {
              navigate(`~/s/${store.slug}/login`);
            } else {
              navigate(`~/s/${store.slug}/checkout`);
            }
          }}
          className="w-full py-3.5 rounded-lg text-[14px] font-semibold text-white transition-transform hover:scale-[1.01]"
          style={{ backgroundColor: store.primaryColor }}
        >
          {isLoggedIn ? "Proceed to Checkout" : "Sign In to Checkout"}
        </button>
      </div>
    </div>
  );
}
