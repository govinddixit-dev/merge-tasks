/**
 * templateChrome — Shared UI chrome used by Classic, Modern and Minimal
 * storefront templates:
 *   - CurtainRevealFooter: fixed z-0 footer that reveals as the main
 *     content scrolls past its bottom edge.
 *   - FloatingCartFAB: bottom-right mini cart button in the store brand
 *     color, only when cart has items.
 *   - BackToTop: scale-in arrow after scrolling past 300px.
 *   - StaggeredGrid / MotionReveal: framer-motion entrance wrappers for
 *     product grids.
 *
 * All pieces are pure UI — they read from StoreContext only; they do not
 * alter cart logic, routing, or tRPC calls.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ArrowUp, ShoppingCart } from "lucide-react";
import { useLocation } from "wouter";
import { useStore } from "./StoreContext";
import type { StoreProduct } from "./StoreContext";
import { usePersonalization } from "./usePersonalization";

// ── Curtain Reveal Footer ─────────────────────────────────────────────

type Variant = "classic" | "modern" | "minimal";

interface CurtainRevealFooterProps {
  variant: Variant;
  /** When rendered inside a template we also need to know the store brand
   *  color for the CTA pill. Read from context for consistency. */
  label?: string;
}

/**
 * The curtain reveal footer is fixed to the viewport bottom at z-0. The
 * template's main content sits at z-10 with its own solid background so
 * the footer stays hidden until the user scrolls past the content.
 * This component only renders the fixed footer layer; callers are
 * responsible for wrapping their scrollable content with
 * `<CurtainContentWrapper>` so the layering works correctly.
 */
export function CurtainRevealFooter({ variant, label }: CurtainRevealFooterProps) {
  const { store, cartCount } = useStore();
  const [, navigate] = useLocation();
  const personalization = usePersonalization();
  const pc = store.primaryColor;

  const headline = label ?? "Ready to Checkout?";

  // Minimal stays centered/constrained; Classic & Modern are full-width.
  const containerClass =
    variant === "minimal"
      ? "max-w-[720px] mx-auto px-8"
      : variant === "classic"
        ? "max-w-[1400px] mx-auto px-8"
        : "max-w-[1200px] mx-auto px-6";

  // Simplify on small screens (< 640px) — still renders but drops the recs
  // strip so the fold isn't dominated by animation work on phones.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <footer
      aria-label="Checkout reveal"
      className="fixed inset-x-0 bottom-0 z-0 flex items-center"
      style={{
        backgroundColor:
          variant === "minimal" ? "#0F0F0F" : variant === "classic" ? "#111111" : pc,
        color: "#ffffff",
        minHeight: variant === "minimal" ? "420px" : "460px",
      }}
    >
      <div className={`${containerClass} py-16 w-full`}>
        {/* AI recommendations strip */}
        {!isMobile && personalization.picks.length > 0 && (
          <div className="mb-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-70 mb-4">
              {variant === "classic"
                ? "Your team is ordering"
                : variant === "modern"
                  ? "Recommended for you"
                  : "Picked for you"}
            </p>
            <div
              className={
                variant === "minimal"
                  ? "grid grid-cols-2 gap-4"
                  : "grid grid-cols-2 sm:grid-cols-4 gap-4"
              }
            >
              {personalization.picks
                .slice(0, variant === "minimal" ? 2 : 4)
                .map(p => (
                  <button
                    key={p.id}
                    onClick={() => navigate(`~/s/${store.slug}/product/${p.id}`)}
                    className="text-left group rounded-xl overflow-hidden transition-transform hover:-translate-y-0.5"
                    style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                  >
                    <div
                      className="w-full h-28 sm:h-32 overflow-hidden"
                      style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
                    >
                      {p.imageUrl && (
                        <img
                          src={p.imageUrl}
                          alt={p.name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-[12px] font-semibold line-clamp-1">{p.name}</p>
                      <p className="text-[11px] opacity-70">
                        ${parseFloat(p.customPrice || p.basePrice).toFixed(2)}
                      </p>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        )}

        <h2
          className={
            variant === "minimal"
              ? "text-3xl sm:text-4xl font-light tracking-tight mb-6"
              : "text-4xl sm:text-5xl font-extrabold tracking-tight mb-6"
          }
        >
          {headline}
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={() => navigate(`~/s/${store.slug}/cart`)}
            className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-[14px] font-bold transition-all"
            style={{
              backgroundColor: variant === "modern" ? "#ffffff" : pc,
              color: variant === "modern" ? pc : "#ffffff",
            }}
          >
            Proceed to Cart
            <motion.span
              className="inline-flex"
              initial={false}
              whileHover={{ x: 5 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-[5px]" />
            </motion.span>
          </button>
          {cartCount > 0 && (
            <span className="text-[13px] font-semibold opacity-80">
              {cartCount} item{cartCount === 1 ? "" : "s"} in your cart
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}

// ── Content wrapper (z-10, solid bg) ───────────────────────────────────

interface CurtainContentWrapperProps {
  variant: Variant;
  /** Solid background for the content layer so the fixed footer at z-0
   *  stays hidden until the user scrolls to the bottom. */
  background: string;
  children: React.ReactNode;
  /** Extra bottom padding so the footer fully reveals. Must match the
   *  footer's minHeight exactly (460px for classic/modern, 420px for
   *  minimal — see CurtainRevealFooter above). */
  revealSpace?: number;
}

export function CurtainContentWrapper({
  variant,
  background,
  children,
  revealSpace,
}: CurtainContentWrapperProps) {
  // Keep the spacer height in lockstep with the footer so the curtain
  // reveal lands exactly at the top of the fixed footer on scroll.
  const effectiveRevealSpace =
    revealSpace ?? (variant === "minimal" ? 420 : 460);
  return (
    <div
      className="relative z-10"
      style={{
        backgroundColor: background,
        // Give enough room below so that the fixed footer underneath can
        // fully reveal on scroll. Spacer height matches footer minHeight.
        marginBottom: effectiveRevealSpace,
      }}
      data-template={variant}
    >
      {children}
    </div>
  );
}

// ── Floating Cart FAB ─────────────────────────────────────────────────

export function FloatingCartFAB() {
  const { store, cartCount } = useStore();
  const [, navigate] = useLocation();
  if (cartCount === 0) return null;
  return (
    <motion.button
      onClick={() => navigate(`~/s/${store.slug}/cart`)}
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white"
      style={{ backgroundColor: store.primaryColor }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      aria-label={`Open cart with ${cartCount} items`}
    >
      <ShoppingCart size={22} />
      <span
        className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-white text-[11px] font-bold flex items-center justify-center"
        style={{ color: store.primaryColor }}
      >
        {cartCount}
      </span>
    </motion.button>
  );
}

// ── Back to Top ───────────────────────────────────────────────────────

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 300);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          key="backtotop"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 right-6 z-40 w-11 h-11 rounded-full bg-white/90 shadow-md flex items-center justify-center text-mt-ink border border-mt-border"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          aria-label="Back to top"
        >
          <ArrowUp size={18} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

// ── Staggered entrance for grid/list items ────────────────────────────

export function MotionReveal({
  children,
  index = 0,
  y = 20,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: "easeOut", delay: (index % 8) * 0.1 }}
    >
      {children}
    </motion.div>
  );
}

// ── Parallax hero wrapper (Modern) ────────────────────────────────────

export function ParallaxHero({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 80]);
  return (
    <motion.section
      ref={ref as never}
      className={className}
      style={{ ...style, y }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {children}
    </motion.section>
  );
}

// ── Utility: resolve readable text color on a given bg ────────────────

export function readableOn(bgHex: string): string {
  const hex = bgHex.replace("#", "");
  if (hex.length !== 6) return "#ffffff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#111111" : "#ffffff";
}

// Silence unused-import warning for useMemo (kept for future extension).
void useMemo;
