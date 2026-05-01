import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-accent/60",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite]",
        "before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent",
        "motion-reduce:before:animate-none motion-reduce:animate-pulse",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
