/**
 * FadeIn
 *
 * Generic entrance animation that fades in + slides up 8px.
 * Used for page-level content, dialogs, and cards.
 *
 * Usage:
 *   <FadeIn>
 *     <PageContent />
 *   </FadeIn>
 */
import { motion } from "framer-motion";
import { type ReactNode } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const MT_EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

interface FadeInProps {
  children: ReactNode;
  className?: string;
  /** Delay in ms before the animation starts */
  delay?: number;
  /** Duration in ms */
  duration?: number;
}

export function FadeIn({
  children,
  className,
  delay = 0,
  duration = 200,
}: FadeInProps) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: prefersReduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: prefersReduced ? 0 : duration / 1000,
        delay: prefersReduced ? 0 : delay / 1000,
        ease: MT_EASE,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
