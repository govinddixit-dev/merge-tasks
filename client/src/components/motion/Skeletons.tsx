/**
 * Skeletons.tsx — Domain-specific skeleton loading states.
 *
 * These match the exact shape of the content they replace,
 * providing a seamless loading experience.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

/** Skeleton for a single metric card on the Dashboard. */
export function MetricCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-mt-border p-5">
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3.5 w-3.5 rounded" />
      </div>
      <Skeleton className="h-7 w-28 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

/** Skeleton for a data table with configurable rows and columns. */
export function TableSkeleton({
  rows = 5,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="bg-white rounded-lg border border-mt-border">
      <div className="p-5 border-b border-[#F0F0F0]">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="divide-y divide-[#F5F5F5]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5">
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton
                key={j}
                className={`h-3 ${j === 0 ? "w-24" : "w-20"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pulsing dots indicator for the copilot "thinking" state. */
export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

/** Skeleton grid for product/card list views. */
export function CardGridSkeleton({
  count = 6,
  columns = 4,
}: {
  count?: number;
  columns?: number;
}) {
  const gridClass =
    columns === 4
      ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
      : columns === 3
      ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
      : "grid grid-cols-1 sm:grid-cols-2 gap-5";
  return (
    <div className={gridClass}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border border-mt-border p-4 space-y-3">
          <Skeleton className="h-32 w-full rounded-md" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex items-center justify-between pt-1">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-7 w-16 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a proposal/client list item row. */
export function ListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <Skeleton className="h-8 w-8 rounded-lg" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  );
}
