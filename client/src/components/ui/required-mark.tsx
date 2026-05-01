import { cn } from "@/lib/utils";

function RequiredMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("text-red-500 ml-0.5", className)}>
      *
    </span>
  );
}

export { RequiredMark };
