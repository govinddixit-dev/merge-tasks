/**
 * StoreHeader — Fixed top navigation with ring-logo brand mark, centered nav,
 * dark mode toggle, user avatar/sign-in pill, and cart badge.
 *
 * Design: Handoff wireframe BrandedNav treatment
 *   - Left: Ring-logo SVG mark (brand color as ring stroke) + company name
 *   - Center: Uppercase nav links with active underline
 *   - Right: Theme toggle · Account pill / Sign In · Cart badge
 *
 * Zero functional regression: all routing, cart, auth, and mobile menu
 * behaviour preserved exactly from the previous implementation.
 */

import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Menu, X, Sun, Moon, ShoppingCart, LogIn } from "lucide-react";
import { useStore } from "./StoreContext";

/** Ring-logo SVG mark — circular stroke ring with the client initial inside */
function RingLogo({ initial, color, size = 36 }: { initial: string; color: string; size?: number }) {
  const r = (size / 2) - 3;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
      {/* Outer ring — brand color */}
      <circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth="2" fill="none" />
      {/* Subtle inner fill */}
      <circle cx={cx} cy={cy} r={r - 4} fill={`${color}12`} />
      {/* Client initial */}
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

export default function StoreHeader() {
  const { store, cartCount, isDark, toggleTheme, isLoggedIn, storeUser } = useStore();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setMobileMenuOpen(false); }, [location]);

  const pc = store.primaryColor;
  const bg = isDark ? "#1A1A1A" : "#FFFFFF";
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const borderColor = isDark ? "#333" : "#E5E5E5";
  const headerBg = isDark
    ? (scrolled ? "rgba(26,26,26,0.95)" : "rgba(26,26,26,0.6)")
    : (scrolled ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)");

  const companyName = store.client?.companyName || store.name;
  const initial = companyName.charAt(0).toUpperCase();
  const logoUrl = store.logoUrl || store.client?.logoUrl;

  const navItems = [
    { label: "Home", path: `~/s/${store.slug}` },
    { label: "Products", path: `~/s/${store.slug}/products` },
    { label: "Cart", path: `~/s/${store.slug}/cart` },
    ...(isLoggedIn ? [
      { label: "Custom Request", path: `~/s/${store.slug}/custom-request` },
      { label: "Portal", path: `~/s/${store.slug}/portal` },
    ] : []),
  ];

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          backgroundColor: headerBg,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: scrolled ? `1px solid ${borderColor}` : "1px solid transparent",
        }}
      >
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 flex items-center h-[72px]">

          {/* ── Left: Ring-logo brand block ── */}
          <div className="flex items-center gap-3 min-w-[200px]">
            {/* Mobile hamburger — only visible on small screens */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden w-10 h-10 flex items-center justify-center mr-1"
              style={{ color: fg }}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>

            <Link href={`~/s/${store.slug}`}>
              <div className="flex items-center gap-2.5 cursor-pointer group">
                {logoUrl ? (
                  /* Uploaded logo: wrap in a ring frame */
                  <div
                    className="rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
                    style={{
                      width: 36,
                      height: 36,
                      border: `2px solid ${pc}`,
                      padding: 2,
                    }}
                  >
                    <img
                      src={logoUrl}
                      alt={companyName}
                      className="w-full h-full object-contain rounded-full"
                    />
                  </div>
                ) : (
                  /* No logo: SVG ring mark with initial */
                  <RingLogo initial={initial} color={pc} size={36} />
                )}
                <span
                  className="text-[15px] font-bold hidden sm:inline tracking-tight"
                  style={{ color: fg }}
                >
                  {companyName}
                </span>
              </div>
            </Link>
          </div>

          {/* ── Center: Nav links (desktop only) ── */}
          <nav className="hidden lg:flex items-center gap-8 flex-1 justify-center">
            {navItems.map(item => {
              const isActive =
                location === item.path ||
                (item.label === "Home" && location === item.path + "/home");
              return (
                <Link key={item.path} href={item.path}>
                  <span
                    className="text-[11px] font-bold tracking-[0.1em] uppercase transition-all duration-200 cursor-pointer"
                    style={{
                      color: isActive ? pc : mutedFg,
                      borderBottom: isActive ? `2px solid ${pc}` : "2px solid transparent",
                      paddingBottom: "4px",
                    }}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* ── Right: Theme toggle · Account · Cart ── */}
          <div className="flex items-center gap-3 min-w-[200px] justify-end">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:opacity-70"
              style={{ color: mutedFg }}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Account pill / Sign In */}
            {isLoggedIn ? (
              <Link href={`~/s/${store.slug}/portal`}>
                <div
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: `${pc}12`,
                    border: `1px solid ${pc}30`,
                  }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                    style={{ backgroundColor: pc }}
                  >
                    {storeUser?.name?.charAt(0) || "U"}
                  </div>
                  <span className="text-[12px] font-semibold" style={{ color: fg }}>
                    {storeUser?.name?.split(" ")[0] || "Account"}
                  </span>
                  {storeUser?.role && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                      style={{ backgroundColor: `${pc}20`, color: pc }}
                    >
                      {storeUser.role}
                    </span>
                  )}
                </div>
              </Link>
            ) : (
              <Link href={`~/s/${store.slug}/login`}>
                <button
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: pc }}
                >
                  <LogIn size={13} /> Sign In
                </button>
              </Link>
            )}

            {/* Cart badge */}
            <Link href={`~/s/${store.slug}/cart`}>
              <div
                className="relative w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-70"
                style={{ color: fg }}
                aria-label={`Cart (${cartCount} items)`}
              >
                <ShoppingCart size={18} />
                {cartCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                    style={{ backgroundColor: pc }}
                  >
                    {cartCount}
                  </span>
                )}
              </div>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Mobile slide-out menu ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            className="absolute left-0 top-0 bottom-0 w-[280px] p-6 flex flex-col"
            style={{ backgroundColor: bg }}
          >
            {/* Mobile menu header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2.5">
                {logoUrl ? (
                  <div
                    className="rounded-full overflow-hidden flex items-center justify-center"
                    style={{ width: 32, height: 32, border: `2px solid ${pc}`, padding: 2 }}
                  >
                    <img src={logoUrl} alt={companyName} className="w-full h-full object-contain rounded-full" />
                  </div>
                ) : (
                  <RingLogo initial={initial} color={pc} size={32} />
                )}
                <span className="text-[15px] font-bold" style={{ color: fg }}>{companyName}</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
                <X size={20} style={{ color: fg }} />
              </button>
            </div>

            {/* Mobile nav links */}
            <nav className="space-y-1 flex-1">
              {navItems.map(item => {
                const isActive = location === item.path;
                return (
                  <Link key={item.path} href={item.path}>
                    <span
                      className="flex items-center text-[14px] font-semibold py-3 px-3 rounded-lg cursor-pointer transition-colors"
                      style={{
                        color: isActive ? pc : fg,
                        backgroundColor: isActive ? `${pc}10` : "transparent",
                      }}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
              {!isLoggedIn && (
                <Link href={`~/s/${store.slug}/login`}>
                  <span
                    className="flex items-center gap-2 text-[14px] font-semibold py-3 px-3 rounded-lg cursor-pointer"
                    style={{ color: pc }}
                  >
                    <LogIn size={14} /> Sign In
                  </span>
                </Link>
              )}
            </nav>

            {/* Mobile theme toggle at bottom */}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 text-[13px] font-semibold py-3 px-3 rounded-lg mt-4"
              style={{ color: mutedFg }}
            >
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
              {isDark ? "Light mode" : "Dark mode"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
