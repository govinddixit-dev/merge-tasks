/**
 * ModernShell — curtain-reveal layout for the Modern storefront template.
 *
 * Per /home/ubuntu/wireframes/handoff/IMPLEMENTATION_GUIDE.md §5: a fixed
 * graphite footer panel sits at viewport bottom, and the white paper
 * content panel scrolls above it with bottom margin equal to the footer
 * height. Scrolling to the bottom reveals the footer underneath.
 *
 * This is pure CSS — no scroll listener, no framer-motion, no JS.
 *
 * Mounted by every Modern surface (Home, Shop, Cart, Checkout, Custom
 * Request). The global StoreHeader/StoreFooter are suppressed by LiveStore
 * when the active surface is wrapped in this shell.
 */
import type { ReactNode } from "react";
import ModernHeader from "./ModernHeader";
import ModernFooter from "./ModernFooter";

// Curtain heights tuned to feel like a quiet "lift" at the bottom of the
// page rather than a dramatic full-panel reveal — about a third of the
// original handoff spec. Default is used on Home (where the footer carries
// the brand sign-off); compact is used on transactional pages where the
// reveal would distract.
const FOOTER_HEIGHT_DEFAULT = 240;
const FOOTER_HEIGHT_COMPACT = 140;

type Props = {
  children: ReactNode;
  footer?: "default" | "compact";
};

export default function ModernShell({ children, footer = "default" }: Props) {
  const h = footer === "compact" ? FOOTER_HEIGHT_COMPACT : FOOTER_HEIGHT_DEFAULT;
  return (
    <div className="bg-graphite text-ink min-h-screen relative">
      {/* Fixed graphite curtain panel underneath the content */}
      <div
        className="fixed inset-x-0 bottom-0 z-0 bg-graphite text-paper"
        style={{ height: h }}
      >
        <ModernFooter variant={footer} />
      </div>

      {/* Paper content panel sits above the curtain. Rounded bottom corners
          turn the reveal into a soft "lift" rather than a hard slide. */}
      <div
        className="relative z-10 bg-paper min-h-screen"
        style={{
          marginBottom: h,
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
        }}
      >
        <ModernHeader />
        <main className="pt-[88px]">{children}</main>
      </div>
    </div>
  );
}
