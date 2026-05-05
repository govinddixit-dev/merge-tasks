import { cn } from "@/lib/utils";

function FieldError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p role="alert" className={cn("text-xs text-red-500 mt-1", className)}>
      {message}
    </p>
  );
}

export { FieldError };
