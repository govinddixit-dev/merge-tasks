/**
 * LiveStore — Dynamic storefront wrapper.
 * Loads store data from DB by slug, manages cart / auth state,
 * and delegates rendering to focused sub-components.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, Link, Redirect } from "wouter";
import { Package, LogIn } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import ClientPortal from "./ClientPortal";

// Context + shared types
import { StoreContext } from "./StoreContext";
import type { StoreData, StoreProduct, StoreUserData, CartItem, CartItemKind, AddPrintToCartInput } from "./StoreContext";

// Sub-components (each in its own file)
import StoreHeader from "./StoreHeader";
import StoreFooter from "./StoreFooter";
import StoreHomePage from "./StoreHomePage";
import StoreProductsPage from "./StoreProductsPage";
import StoreProductDetailPage from "./StoreProductDetailPage";
import StoreCartPage from "./StoreCartPage";
import StoreLoginPage from "./StoreLoginPage";
import SetPasswordPage from "./SetPasswordPage";
import StoreCheckoutPage from "./StoreCheckoutPage";
import PrintStore from "../PrintStore";
import StoreCustomRequestPage from "./StoreCustomRequestPage";
import { StoreSessionTimeout } from "@/components/StoreSessionTimeout";

export default function LiveStore() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [location] = useLocation();
  // With wouter nest, location is relative to /s/:slug, e.g. "/" or "/products"
  const subPath = location.replace(/^\//, ""); // strip leading slash

  const { data: store, isLoading, error } = trpc.stores.getBySlug.useQuery(
    { slug: slug || "" },
    { enabled: !!slug, retry: false }
  );

  // ── Cart persistence (Steps 1–3 of Remaining Items Guide) ──────────────────
  // Cart is scoped per store slug so Store A and Store B never share a cart.
  // Format: { items: CartItem[], updatedAt: number }
  // Items older than 7 days are discarded on hydration.
  const CART_KEY = `mt_cart_${slug}`;
  const CART_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return [];
      const stored = JSON.parse(raw) as { items: Partial<CartItem>[]; updatedAt: number };
      if (Date.now() - stored.updatedAt > CART_TTL_MS) {
        localStorage.removeItem(CART_KEY);
        return [];
      }
      // Backfill older carts that predate kind/lineKey so existing promo
      // items continue to work after deploy without clearing user carts.
      return stored.items.map((item, idx): CartItem => ({
        lineKey: item.lineKey ?? `promo-${item.id ?? idx}`,
        kind: (item.kind as CartItemKind) ?? "promotional",
        id: item.id ?? 0,
        storeProductId: item.storeProductId ?? null,
        name: item.name ?? "",
        price: item.price ?? 0,
        quantity: item.quantity ?? 1,
        image: item.image ?? null,
        printProductId: item.printProductId,
        printVariantId: item.printVariantId,
        variantLabel: item.variantLabel,
        size: item.size,
        stock: item.stock,
      }));
    } catch {
      return [];
    }
  });

  // Sync cart to localStorage whenever it changes.
  // Skip the initial render (isFirstRender ref) to avoid overwriting a just-hydrated cart.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ items: cart, updatedAt: Date.now() }));
    } catch {
      // localStorage unavailable (private browsing / quota exceeded) — fail silently
    }
  }, [cart]);

  const [isDark, setIsDark] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [storeUser, setStoreUser] = useState<StoreUserData | null>(null);
  const [activeLocationId, setActiveLocationId] = useState<number | null>(null);

  // Check real server session on mount
  const { data: sessionData, isLoading: sessionLoading } = trpc.storeAuth.getSession.useQuery(
    { storeSlug: slug || "" },
    { enabled: !!slug, retry: false }
  );

  useEffect(() => {
    if (sessionData?.authenticated && sessionData.user) {
      setStoreUser(sessionData.user as StoreUserData);
      setIsLoggedIn(true);
    }
  }, [sessionData]);

  // Step 2: Validate hydrated cart against current store products.
  // Only promotional items are validated — print items come from a
  // separate catalog (printProducts) that isn't present on StoreData.
  useEffect(() => {
    if (!store || cart.length === 0) return;
    const productIds = new Set(store.products.map((p: { id: number }) => p.id));
    const validCart = cart.filter(item => item.kind !== "promotional" || productIds.has(item.id));
    if (validCart.length !== cart.length) {
      setCart(validCart);
      toast.info("Some items in your cart are no longer available and were removed.");
    }
  }, [store]); // run once when store data loads

  //  Cart helpers
  const addToCart = (
    product: StoreProduct,
    options?: { imprintZoneSlug?: string; decorationMethod?: string },
  ) => {
    // Two additions of the same product collapse into one line only when
    // the zone + decoration choice matches too — otherwise they're genuinely
    // different buying intents and deserve their own lines.
    const zone = options?.imprintZoneSlug ?? "";
    const deco = options?.decorationMethod ?? "";
    const lineKey = zone || deco
      ? `promo-${product.id}-${zone}-${deco}`
      : `promo-${product.id}`;
    setCart(prev => {
      const existing = prev.find(i => i.lineKey === lineKey);
      if (existing) {
        return prev.map(i => i.lineKey === lineKey ? { ...i, quantity: i.quantity + 1 } : i);
      }
      const item: CartItem = {
        lineKey,
        kind: "promotional",
        id: product.id,
        storeProductId: product.storeProductId ?? null,
        name: product.name,
        price: parseFloat(product.customPrice || product.basePrice),
        quantity: 1,
        image: product.imageUrl,
        ...(options?.imprintZoneSlug && { imprintZoneSlug: options.imprintZoneSlug }),
        ...(options?.decorationMethod && { decorationMethod: options.decorationMethod }),
      };
      return [...prev, item];
    });
    toast.success(`${product.name} added to cart`);
  };

  const addPrintToCart = (input: AddPrintToCartInput) => {
    // Two print lines are "the same line" only when product + variant + tier
    // match. Different tier quantities are different lines because pricing
    // changes per tier — collapsing them would misrepresent the total.
    const variantKey = input.printVariantId ?? `${input.size}|${input.stock}`;
    const lineKey = `print-${input.printProductId}-${variantKey}-${input.tierQuantity}`;
    const variantLabel = `${input.size} · ${input.stock} · ${input.tierQuantity} units`;
    setCart(prev => {
      const existing = prev.find(i => i.lineKey === lineKey);
      if (existing) {
        return prev.map(i => i.lineKey === lineKey
          ? { ...i, quantity: i.quantity + 1 }
          : i);
      }
      const item: CartItem = {
        lineKey,
        kind: "print",
        id: input.printProductId,
        storeProductId: null,
        name: input.name,
        price: input.unitPriceCents / 100,
        quantity: input.tierQuantity,
        image: input.image ?? null,
        printProductId: input.printProductId,
        printVariantId: input.printVariantId,
        printProductType: input.printProductType,
        variantLabel,
        size: input.size,
        stock: input.stock,
      };
      return [...prev, item];
    });
    toast.success(`${input.name} added to cart`);
  };

  // Bridge: PrintStore dispatches `webstore:add-print-to-cart` on the window
  // with an { detail } payload; we listen here so print products from any
  // storefront page wire into the same cart as promo items.
  useEffect(() => {
    function onAddPrint(e: Event) {
      const ce = e as CustomEvent<{
        printProductId: number;
        variantId?: number;
        productType: "business_cards" | "flyers" | "banners" | "posters";
        name: string;
        size?: string;
        stock?: string;
        tierQuantity: number;
        unitPriceCents: number;
        image?: string | null;
      }>;
      const d = ce.detail;
      if (!d || typeof d.printProductId !== "number" || typeof d.tierQuantity !== "number") return;
      addPrintToCart({
        printProductId: d.printProductId,
        printVariantId: d.variantId,
        printProductType: d.productType,
        name: d.name,
        size: d.size ?? "",
        stock: d.stock ?? "",
        tierQuantity: d.tierQuantity,
        unitPriceCents: d.unitPriceCents,
        image: d.image ?? null,
      });
    }
    window.addEventListener("webstore:add-print-to-cart", onAddPrint);
    return () => window.removeEventListener("webstore:add-print-to-cart", onAddPrint);
    // addPrintToCart closes over setCart (stable identity) — we intentionally
    // re-bind on cart changes to keep the closure pointing at the latest cart.
  }, [cart]);

  const removeFromCart = (lineKey: string) => setCart(prev => prev.filter(i => i.lineKey !== lineKey));
  const updateQty = (lineKey: string, qty: number) => {
    if (qty <= 0) { removeFromCart(lineKey); return; }
    setCart(prev => prev.map(i => i.lineKey === lineKey ? { ...i, quantity: qty } : i));
  };
  const clearCart = () => {
    setCart([]);
    try { localStorage.removeItem(CART_KEY); } catch {}
  };
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  const storeLogoutMut = trpc.storeAuth.logout.useMutation();
  const loginUser = (user: StoreUserData) => { setStoreUser(user); setIsLoggedIn(true); };
  const logoutUser = () => {
    storeLogoutMut.mutate({ storeSlug: slug || "" });
    setStoreUser(null);
    setIsLoggedIn(false);
  };

  // Location-scoped catalog visibility. When activeLocationId is null
  // ("All Locations" tab), every product is shown. When a location tab is
  // active, a product is visible if its divisionIds tag list is empty
  // (shared across all locations) or explicitly includes activeLocationId.
  // Must be declared before any early returns — Rules of Hooks.
  const storeData: StoreData | null = useMemo(() => {
    if (!store) return null;
    const rawStoreData = store as unknown as StoreData;

    const activeLocation = rawStoreData.locations.find(l => l.id === activeLocationId) ?? null;
    const effectiveBranding = activeLocation?.branding ?? null;

    const withBranding: StoreData = effectiveBranding
      ? {
          ...rawStoreData,
          primaryColor: effectiveBranding.primaryColor ?? rawStoreData.primaryColor,
          bannerUrl: effectiveBranding.bannerUrl ?? rawStoreData.bannerUrl,
          welcomeMessage: effectiveBranding.welcomeMessage ?? rawStoreData.welcomeMessage,
        }
      : rawStoreData;

    if (activeLocationId === null) return withBranding;
    const filtered = withBranding.products.filter((p) => {
      const tags = Array.isArray(p.divisionIds) ? p.divisionIds : [];
      if (tags.length === 0) return true;
      return tags.includes(activeLocationId);
    });
    return filtered.length === withBranding.products.length
      ? withBranding
      : { ...withBranding, products: filtered };
  }, [store, activeLocationId]);

  //  Loading / error states
  if (isLoading) return <MergeTasksLoader variant="page" />;

  if (error || !store || !storeData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mt-surface">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 rounded-full bg-[#FEF2F2] flex items-center justify-center mx-auto mb-4">
            <Package size={28} className="text-[#EF4444]" />
          </div>
          <h1 className="text-2xl font-bold text-mt-ink mb-2">Store Not Found</h1>
          <p className="text-[14px] text-mt-ink-3 mb-6">
            The store you're looking for doesn't exist or hasn't been activated yet.
          </p>
          <button
            onClick={() => window.location.href = "/"}
            className="px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white"
            style={{ backgroundColor: 'var(--mt-brand)' }}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  //  Login gate 
  // Access modes (controlled via Store Management > Settings > Store Access):
  //   requireAuth=true  -> "Private": login required to see anything (default)
  //   requireAuth=false -> "Open Browsing": browse freely, login required to order
  //   Future: guestCheckoutEnabled=true -> "Public": browse AND checkout without login
  //
  // The requireAuth field is set by the stores.update mutation when the distributor
  // changes the Store Access mode in SettingsTab.tsx.
  const isPublicSubPath = subPath === "login" || subPath === "set-password";
  const requiresAuth = storeData.requireAuth !== false; // true by default (Private mode)

  // While the session check is in flight, show the loader so we don’t flash
  // store content before the redirect fires.
  if (requiresAuth && !isPublicSubPath && sessionLoading) {
    return <MergeTasksLoader variant="page" />;
  }

  // Session check complete — redirect unauthenticated visitors to login.
  if (requiresAuth && !isLoggedIn && !isPublicSubPath) {
    return <Redirect to={`~/s/${storeData.slug}/login`} />;
  }

  const LocationTabBar = () => (
    <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto" style={{ borderColor: isDark ? "#333" : "#E5E5E5", backgroundColor: isDark ? "#1a1a1a" : "#fff" }}>
      <button
        onClick={() => setActiveLocationId(null)}
        className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-all ${activeLocationId === null ? "text-white" : "text-mt-ink-3 hover:bg-mt-surface"}`}
        style={activeLocationId === null ? { backgroundColor: "var(--mt-brand)" } : {}}
      >
        All Locations
      </button>
      {storeData.locations.map(loc => (
        <button
          key={loc.id}
          onClick={() => setActiveLocationId(loc.id)}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-all ${activeLocationId === loc.id ? "text-white" : "text-mt-ink-3 hover:bg-mt-surface"}`}
          style={activeLocationId === loc.id ? { backgroundColor: "var(--mt-brand)" } : {}}
        >
          {loc.name}
        </button>
      ))}
    </div>
  );

  return (
    <StoreContext.Provider value={{
      store: storeData,
      cart, addToCart, addPrintToCart, removeFromCart, updateQty, clearCart, cartTotal, cartCount,
      isDark, toggleTheme: () => setIsDark(!isDark),
      isLoggedIn, storeUser, loginUser, logoutUser,
      activeLocationId, setActiveLocationId,
    }}>
      <div className="min-h-screen transition-colors duration-300" style={{
        backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF",
        color: isDark ? "#F5F5F5" : "#1A1A1A",
      }}>
        {/* 30-min inactivity watchdog for logged-in store sessions. Renders
            no DOM when !isLoggedIn so guest browsing is unaffected. */}
        <StoreSessionTimeout
          storeSlug={storeData.slug}
          isLoggedIn={isLoggedIn}
          onLogoutLocal={() => { setStoreUser(null); setIsLoggedIn(false); }}
        />
        <StoreHeader />
        {storeData.multiLocationEnabled && storeData.locations.length > 0 && <LocationTabBar />}
        <main className="pt-[72px]">
          {(subPath === "" || subPath === "home") && <StoreHomePage />}
          {subPath === "login" && <StoreLoginPage />}
          {subPath === "set-password" && <SetPasswordPage />}
          {subPath === "products" && <StoreProductsPage />}
          {subPath.startsWith("product/") && <StoreProductDetailPage productId={subPath.replace("product/", "")} />}
          {subPath === "cart" && <StoreCartPage />}
          {subPath === "checkout" && <StoreCheckoutPage />}
          {subPath === "print" && <PrintStore />}
          {subPath === "custom-request" && <StoreCustomRequestPage />}
          {subPath === "portal" && (
            isLoggedIn ? (
              <ClientPortal
                storeSlug={storeData.slug}
                primaryColor={storeData.primaryColor}
                storeName={storeData.name}
                onNavigateToProposal={(token) => window.open(`/view/proposal/${token}`, "_blank")}
              />
            ) : (
              <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center max-w-sm">
                  <LogIn size={32} className="mx-auto mb-3 text-mt-ink-4" />
                  <h2 className="text-lg font-bold text-mt-ink mb-2">Sign in to access your portal</h2>
                  <p className="text-[13px] text-mt-ink-3 mb-4">Log in to view proposals, orders, and manage your team.</p>
                  <Link href={`~/s/${storeData.slug}/login`}>
                    <button className="px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white" style={{ backgroundColor: storeData.primaryColor }}>
                      Sign In
                    </button>
                  </Link>
                </div>
              </div>
            )
          )}
        </main>
        <StoreFooter />
      </div>
    </StoreContext.Provider>
  );
}
