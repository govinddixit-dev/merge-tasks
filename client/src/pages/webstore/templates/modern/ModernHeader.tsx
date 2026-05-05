/**
 * ModernHeader — centered logo + thin nav header for the Modern template.
 *
 * Differs from the global StoreHeader in two ways:
 *   1. Logo is centered, not left-aligned (Modern signature).
 *   2. Nav links sit symmetrically left and right of the logo.
 *
 * Reads cart/auth/theme from StoreContext, same as the global header — so
 * cart count, login state, theme toggle, and brand color stay live.
 *
 * Mobile: collapses to hamburger + drawer (same UX pattern as the global
 * header) so the regression checklist's "mobile hamburger menu" item is
 * preserved.
 */
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Sun, Moon, ShoppingCart, LogIn } from "lucide-react";
import { useStore } from "../../StoreContext";

function RingLogo({ initial, color, size = 36 }: { initial: string; color: string; size?: number }) {
  const r = (size / 2) - 3;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth="2" fill="none" />
      <circle cx={cx} cy={cy} r={r - 4} fill={`${color}12`} />
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={size * 0.38}
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="-0.02em"
      >
        {initial}
      </text>
    </svg>
  );
}

export default function ModernHeader() {
  const { store, cartCount, isDark, toggleTheme, isLoggedIn, storeUser } = useStore();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location]);

  const companyName = store.client?.companyName || store.name;
  const initial = companyName.charAt(0).toUpperCase();
  const logoUrl = store.logoUrl || store.client?.logoUrl;
  const pc = store.primaryColor;

  // Wireframe nav set: Shop / Custom / Story / Account is hinted in the
  // handoff but our app's actual nav matches the global StoreHeader: Home,
  // Products, Cart, Custom Request, Portal. Keep parity so deep links keep
  // working after a deploy and so the regression checklist's nav coverage
  // holds.
  const links = [
    { label: "Home", path: `~/s/${store.slug}` },
    { label: "Shop", path: `~/s/${store.slug}/products` },
    ...(isLoggedIn ? [
      { label: "Custom", path: `~/s/${store.slug}/custom-request` },
      { label: "Portal", path: `~/s/${store.slug}/portal` },
    ] : []),
  ];

  // Split nav left/right of the centered logo for the Modern look.
  const half = Math.ceil(links.length / 2);
  const leftLinks = links.slice(0, half);
  const rightLinks = links.slice(half);

  const isActive = (path: string) =>
    location === path || (path.endsWith(store.slug) && (location === "" || location === "/" || location === "/home"));

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-40 transition-all duration-300"
        style={{
          backgroundColor: scrolled ? "rgba(250,250,247,0.95)" : "rgba(250,250,247,0.7)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: scrolled ? "1px solid var(--color-rule)" : "1px solid transparent",
        }}
      >
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-12 grid grid-cols-[1fr_auto_1fr] items-center h-[88px] gap-4">
          {/* Left: hamburger (mobile) + left nav */}
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden w-10 h-10 -ml-2 flex items-center justify-center text-ink"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <nav className="hidden lg:flex items-center gap-7">
              {leftLinks.map(item => (
                <Link key={item.path} href={item.path}>
                  <span
                    className="text-[11px] font-bold tracking-[0.14em] uppercase cursor-pointer transition-colors"
                    style={{
                      color: isActive(item.path) ? "var(--color-brand)" : "var(--color-ws-muted)",
                      borderBottom: isActive(item.path) ? "2px solid var(--color-brand)" : "2px solid transparent",
                      paddingBottom: 4,
                    }}
                  >
                    {item.label}
                  </span>
                </Link>
              ))}
            </nav>
          </div>

          {/* Center: logo */}
          <Link href={`~/s/${store.slug}`}>
            <div className="flex items-center justify-center cursor-pointer gap-2.5">
              {logoUrl ? (
                <div
                  className="rounded-full overflow-hidden flex items-center justify-center"
                  style={{ width: 40, height: 40, border: `2px solid ${pc}`, padding: 2 }}
                >
                  <img src={logoUrl} alt={companyName} className="w-full h-full object-contain rounded-full" />
                </div>
              ) : (
                <RingLogo initial={initial} color={pc} size={40} />
              )}
              <span className="hidden sm:inline font-serif-display italic text-[22px] tracking-tight text-ink leading-none">
                {companyName}
              </span>
            </div>
          </Link>

          {/* Right: nav links + theme + account + cart */}
          <div className="flex items-center justify-end gap-3 lg:gap-5">
            <nav className="hidden lg:flex items-center gap-7 mr-2">
              {rightLinks.map(item => (
                <Link key={item.path} href={item.path}>
                  <span
                    className="text-[11px] font-bold tracking-[0.14em] uppercase cursor-pointer transition-colors"
                    style={{
                      color: isActive(item.path) ? "var(--color-brand)" : "var(--color-ws-muted)",
                      borderBottom: isActive(item.path) ? "2px solid var(--color-brand)" : "2px solid transparent",
                      paddingBottom: 4,
                    }}
                  >
                    {item.label}
                  </span>
                </Link>
              ))}
            </nav>
            <button
              type="button"
              onClick={toggleTheme}
              className="w-9 h-9 flex items-center justify-center text-ws-muted hover:text-ink transition-colors"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {isLoggedIn ? (
              <Link href={`~/s/${store.slug}/portal`}>
                <div
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ backgroundColor: `${pc}12`, border: `1px solid ${pc}30` }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                    style={{ backgroundColor: pc }}
                  >
                    {storeUser?.name?.charAt(0) || "U"}
                  </div>
                  <span className="text-[12px] font-semibold text-ink">
                    {storeUser?.name?.split(" ")[0] || "Account"}
                  </span>
                </div>
              </Link>
            ) : (
              <Link href={`~/s/${store.slug}/login`}>
                <button
                  type="button"
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-[12px] font-semibold"
                  style={{ backgroundColor: pc }}
                >
                  <LogIn size={12} /> Sign in
                </button>
              </Link>
            )}
            <Link href={`~/s/${store.slug}/cart`}>
              <button
                type="button"
                className="relative w-9 h-9 flex items-center justify-center text-ink"
                aria-label={`Cart with ${cartCount} items`}
              >
                <ShoppingCart size={18} />
                {cartCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1"
                    style={{ backgroundColor: pc }}
                  >
                    {cartCount}
                  </span>
                )}
              </button>
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-paper">
          <div className="flex items-center justify-between h-[88px] px-4 border-b border-rule">
            <span className="font-serif-display italic text-[22px] text-ink">{companyName}</span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="w-10 h-10 flex items-center justify-center text-ink"
              aria-label="Close menu"
            >
              <X size={22} />
            </button>
          </div>
          <nav className="px-6 py-8 flex flex-col gap-5">
            {links.map(item => (
              <Link key={item.path} href={item.path}>
                <span className="text-[14px] font-bold tracking-[0.14em] uppercase cursor-pointer text-ink">
                  {item.label}
                </span>
              </Link>
            ))}
            <button
              type="button"
              onClick={toggleTheme}
              className="text-[14px] font-bold tracking-[0.14em] uppercase text-ws-muted text-left"
            >
              {isDark ? "Light Mode" : "Dark Mode"}
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
