import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * PageTransition — wraps page content in a subtle fade-in on mount.
 *
 * Use only on pages that are NOT already wrapped by a layout shell
 * that animates route transitions (e.g. DashboardLayout already
 * applies its own AnimatePresence + motion.div around children;
 * adding this on top would double-animate). Skip on pages with
 * their own top-level Framer Motion initial/animate.
 *
 * Honors prefers-reduced-motion by collapsing to no animation.
 */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const prefersReduced = useReducedMotion();
  const duration = prefersReduced ? 0 : 0.15;
  return (
    <motion.div
      initial={{ opacity: prefersReduced ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
