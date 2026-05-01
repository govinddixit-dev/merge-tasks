/**
 * StaggerGroup + StaggerItem
 *
 * Container that staggers its children's entrance animation with a
 * 40ms delay between each child. Used for lists, card grids, and
 * table rows throughout the app.
 *
 * Usage:
 *   <StaggerGroup>
 *     {items.map(item => (
 *       <StaggerItem key={item.id}>
 *         <Card {...item} />
 *       </StaggerItem>
 *     ))}
 *   </StaggerGroup>
 */
import { motion, type Variants } from "framer-motion";
import React, { type ReactNode } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const MT_EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

const containerVariantsReduced: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: MT_EASE },
  },
};

const itemVariantsReduced: Variants = {
  hidden: { opacity: 0, y: 0 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0 },
  },
};

interface StaggerGroupProps {
  children: ReactNode;
  className?: string;
  as?: keyof typeof motion;
}

export function StaggerGroup({ children, className, as = "div" }: StaggerGroupProps) {
  const prefersReduced = useReducedMotion();
  // motion[as] is a valid motion component; cast to a generic component type
  const Component = motion[as] as React.ComponentType<React.HTMLAttributes<HTMLElement> & { variants?: object; initial?: string; animate?: string }>;

  return (
    <Component
      variants={prefersReduced ? containerVariantsReduced : containerVariants}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </Component>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
}

export function StaggerItem({ children, className }: StaggerItemProps) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      variants={prefersReduced ? itemVariantsReduced : itemVariants}
      className={className}
    >
      {children}
    </motion.div>
  );
}
