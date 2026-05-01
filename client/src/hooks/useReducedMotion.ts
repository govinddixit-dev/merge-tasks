/**
 * Re-export framer-motion's useReducedMotion hook.
 *
 * Every animation component in the app MUST check this hook and
 * collapse to duration: 0 when the user has enabled "Reduce motion"
 * in their OS accessibility settings.
 *
 * Non-negotiable: every animation must work at duration: 0.
 */
import { useReducedMotion } from "framer-motion";
export { useReducedMotion };

/** Standard easing curve used across all MergeTasks animations. */
export const MT_EASE = [0.25, 0.46, 0.45, 0.94] as const;

/** Returns a transition object that respects reduced-motion preferences. */
export function useMotionTransition(durationMs = 200) {
  const prefersReduced = useReducedMotion();
  return prefersReduced
    ? { duration: 0 }
    : { duration: durationMs / 1000, ease: [...MT_EASE] };
}
