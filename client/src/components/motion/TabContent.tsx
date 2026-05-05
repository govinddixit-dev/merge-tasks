/**
 * TabContent
 *
 * Cross-fade wrapper for tab panel content. Wraps children in
 * AnimatePresence mode="wait" so the exiting tab fades out before
 * the entering tab fades in. 150ms total perceived transition.
 *
 * Usage:
 *   <TabContent tabKey={activeTab}>
 *     {activeTab === "overview" && <OverviewTab />}
 *   </TabContent>
 */
import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const MT_EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

interface TabContentProps {
  tabKey: string;
  children: ReactNode;
  className?: string;
}

export function TabContent({ tabKey, children, className }: TabContentProps) {
  const prefersReduced = useReducedMotion();
  const duration = prefersReduced ? 0 : 0.15;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={tabKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration, ease: MT_EASE }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
