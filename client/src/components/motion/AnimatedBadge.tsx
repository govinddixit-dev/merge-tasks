/**
 * AnimatedBadge — Smooth status morph transitions.
 *
 * When a proposal or task changes status, the badge transitions
 * smoothly via AnimatePresence mode="wait" (sequential exit → enter).
 *
 * Usage:
 *   <AnimatedBadge status={proposal.status} className="bg-green-100 text-green-800" label="Accepted" />
 */
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface AnimatedBadgeProps {
  /** Current status key — used as the animation key */
  status: string;
  /** Tailwind classes for the badge appearance */
  className: string;
  /** Display label */
  label: string;
}

export function AnimatedBadge({ status, className, label }: AnimatedBadgeProps) {
  const prefersReduced = useReducedMotion();
  const duration = prefersReduced ? 0 : 0.2;

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={status}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration }}
        className={className}
      >
        {label}
      </motion.span>
    </AnimatePresence>
  );
}
