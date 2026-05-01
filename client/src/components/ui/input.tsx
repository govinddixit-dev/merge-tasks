import { useDialogComposition } from "@/components/ui/dialog";
import { useComposition } from "@/hooks/useComposition";
import { cn } from "@/lib/utils";
import * as React from "react";

function Input({
  className,
  type,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  leadingIcon,
  trailingIcon,
  containerClassName,
  ...props
}: React.ComponentProps<"input"> & {
  /** Optional icon rendered absolutely at the leading edge. Adds `pl-10` padding. */
  leadingIcon?: React.ReactNode;
  /** Optional icon rendered absolutely at the trailing edge. Adds `pr-10` padding. */
  trailingIcon?: React.ReactNode;
  /** Class applied to the wrapper when leading/trailing icons are present. */
  containerClassName?: string;
}) {
  // Get dialog composition context if available (will be no-op if not inside Dialog)
  const dialogComposition = useDialogComposition();

  // Add composition event handlers to support input method editor (IME) for CJK languages.
  const {
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    onKeyDown: handleKeyDown,
  } = useComposition<HTMLInputElement>({
    onKeyDown: (e) => {
      // Check if this is an Enter key that should be blocked
      const isComposing = (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing || dialogComposition.justEndedComposing();

      // If Enter key is pressed while composing or just after composition ended,
      // don't call the user's onKeyDown (this blocks the business logic)
      if (e.key === "Enter" && isComposing) {
        return;
      }

      // Otherwise, call the user's onKeyDown
      onKeyDown?.(e);
    },
    onCompositionStart: e => {
      dialogComposition.setComposing(true);
      onCompositionStart?.(e);
    },
    onCompositionEnd: e => {
      // Mark that composition just ended - this helps handle the Enter key that confirms input
      dialogComposition.markCompositionEnd();
      // Delay setting composing to false to handle Safari's event order
      // In Safari, compositionEnd fires before the ESC keydown event
      setTimeout(() => {
        dialogComposition.setComposing(false);
      }, 100);
      onCompositionEnd?.(e);
    },
  });

  const inputEl = (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "cursor-text file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:cursor-pointer disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        leadingIcon && "pl-10",
        trailingIcon && "pr-10",
        className
      )}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );

  if (!leadingIcon && !trailingIcon) {
    return inputEl;
  }

  return (
    <div className={cn("relative", containerClassName)}>
      {leadingIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 flex items-center text-muted-foreground [&_svg]:size-4">
          {leadingIcon}
        </span>
      )}
      {inputEl}
      {trailingIcon && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center text-muted-foreground [&_svg]:size-4">
          {trailingIcon}
        </span>
      )}
    </div>
  );
}

export { Input };
