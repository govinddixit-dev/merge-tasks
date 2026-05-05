/**
 * ModernCart — wireframe-driven cart for the Modern template.
 *
 * Behavior preserved from StoreCartPage.legacy.tsx:
 *   - clearCart, removeFromCart, updateQty consumed from StoreContext
 *     (so the lineKey coalescence in LiveStore.addToCart / addPrintToCart
 *     stays intact)
 *   - print items step by their bundled tier; promo items step by 1
 *     (matches legacy stepper math)
 *   - empty state CTA → /products
 *   - "Sign In to Checkout" if not logged in, else "Proceed to Checkout"
 *
 * Visual changes:
 *   - Two-column: line items left (60%) + sticky paper-soft summary right
 *   - Line items separated by hairline rules, no card chrome
 *   - Italic "Shipping calculated at checkout." note (handoff spec)
 */
import { useLocation, Link } from "wouter";
import { ShoppingBag, Package, Minus, Plus, Trash2 } from "lucide-react";
import { useStore } from "../../StoreContext";
import ModernShell from "./ModernShell";

export default function ModernCart() {
  const { store, cart, removeFromCart, updateQty, cartTotal, clearCart, isLoggedIn } = useStore();
  const [, navigate] = useLocation();

  // ── Empty cart ────────────────────────────────────────────────────────
  if (cart.length === 0) {
    const brandName = store.client?.companyName ?? store.name;
    return (
      <ModernShell footer="compact">
        <section className="max-w-[720px] mx-auto px-4 sm:px-6 py-24 text-center">
          <ShoppingBag size={48} className="mx-auto mb-6 text-brand" />
          <h1 className="font-serif-display italic text-[40px] sm:text-[56px] text-ink leading-[1.05] mb-4">
            Your {brandName} cart is empty.
          </h1>
          <p className="text-[14px] text-ws-muted mb-8">
            Browse the collection and add items to get started.
          </p>
          <Link href={`~/s/${store.slug}/products`}>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-ink text-paper text-[12px] font-bold tracking-[0.12em] uppercase hover:bg-ink-soft transition-colors"
            >
              Browse Products
            </button>
          </Link>
        </section>
      </ModernShell>
    );
  }

  return (
    <ModernShell footer="compact">
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-12 pt-12 pb-20">
        <div className="flex flex-wrap items-baseline justify-between mb-10 gap-3">
          <h1 className="text-[48px] sm:text-[64px] font-bold tracking-tight leading-[1] text-ink">
            Cart<span className="font-serif-display italic font-normal">.</span>
          </h1>
          <button
            type="button"
            onClick={clearCart}
            className="text-[11px] font-bold tracking-[0.12em] uppercase text-red-600 hover:underline underline-offset-4"
          >
            Clear All
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
          {/* Line items */}
          <div>
            {cart.map((item, i) => {
              const isPrint = item.kind === "print";
              // Mirrors the legacy stepper: print bundles step by their
              // tier quantity (preserving tier-based pricing); promo
              // items step by 1.
              const step = isPrint ? Math.max(1, item.quantity) : 1;
              return (
                <div
                  key={item.lineKey}
                  className="flex flex-col sm:flex-row items-center gap-4 py-5"
                  style={{ borderTop: i > 0 ? "1px solid var(--color-rule)" : "none" }}
                >
                  <div className="w-20 h-20 bg-paper-soft border border-rule overflow-hidden flex-shrink-0">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-full object-contain p-1" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package size={20} className="text-ws-muted-soft" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-ink truncate">{item.name}</p>
                    {isPrint && item.variantLabel && (
                      <p className="text-[12px] text-ws-muted truncate">{item.variantLabel}</p>
                    )}
                    <p className="text-[12px] text-ws-muted">${item.price.toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center border border-rule rounded-full overflow-hidden">
                    <button
                      type="button"
                      onClick={() => updateQty(item.lineKey, item.quantity - step)}
                      aria-label={`Decrease quantity of ${item.name}`}
                      className="w-9 h-9 flex items-center justify-center text-ink hover:bg-paper-soft transition-colors"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-10 text-center text-[13px] font-semibold text-ink">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQty(item.lineKey, item.quantity + step)}
                      aria-label={`Increase quantity of ${item.name}`}
                      className="w-9 h-9 flex items-center justify-center text-ink hover:bg-paper-soft transition-colors"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  <p className="text-[15px] font-bold text-ink w-24 text-right">
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeFromCart(item.lineKey)}
                    aria-label={`Remove ${item.name} from cart`}
                    className="p-2 text-ws-muted hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <aside className="bg-paper-soft p-6 lg:sticky lg:top-[104px] self-start">
            <h2 className="text-[20px] font-bold text-ink mb-4">
              Order summary
            </h2>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between text-ws-muted">
                <span>Subtotal</span>
                <span className="text-ink">${cartTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-ws-muted">
                <span>Shipping</span>
                <span>Calculated at checkout</span>
              </div>
              <div className="flex justify-between text-ws-muted">
                <span>Estimated tax</span>
                <span>—</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-rule flex justify-between">
              <span className="text-[15px] font-bold text-ink">Total</span>
              <span className="text-[20px] font-bold text-ink">${cartTotal.toFixed(2)}</span>
            </div>
            <p className="mt-4 mb-4 text-[12px] font-serif-display italic text-ws-muted">
              Shipping calculated at checkout.
            </p>
            <button
              type="button"
              onClick={() =>
                navigate(isLoggedIn
                  ? `~/s/${store.slug}/checkout`
                  : `~/s/${store.slug}/login`)
              }
              className="w-full py-3.5 text-[12px] font-bold tracking-[0.12em] uppercase text-paper transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--color-brand)" }}
            >
              {isLoggedIn ? "Continue to checkout" : "Sign in to checkout"}
            </button>
            <Link href={`~/s/${store.slug}/products`}>
              <button
                type="button"
                className="w-full mt-3 text-[11px] font-bold tracking-[0.14em] uppercase text-ws-muted hover:text-ink transition-colors"
              >
                ← Continue shopping
              </button>
            </Link>
          </aside>
        </div>
      </section>
    </ModernShell>
  );
}
