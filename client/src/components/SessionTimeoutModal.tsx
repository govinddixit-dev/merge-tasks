/**
 * SessionTimeoutModal — inactivity warning dialog.
 *
 * Non-dismissable by design: clicking outside and pressing Escape do not
 * close the modal. The user must commit to one of the two choices so that
 * idle tabs cannot silently bypass the timeout.
 *
 * Visual language matches the existing Dialog component — no new primitives.
 */
import { useMemo } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface SessionTimeoutModalProps {
  open: boolean;
  /** Seconds remaining until auto-logout. Updates every second via the hook. */
  secondsRemaining: number;
  /** Resets the inactivity counter and closes the modal. */
  onStay: () => void;
  /** Logs the user out immediately. */
  onLogout: () => void;
}

export function SessionTimeoutModal({
  open,
  secondsRemaining,
  onStay,
  onLogout,
}: SessionTimeoutModalProps) {
  const countdown = useMemo(() => {
    const total = Math.max(0, secondsRemaining);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    if (minutes > 0 && seconds > 0) {
      return `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} second${seconds === 1 ? "" : "s"}`;
    }
    if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }, [secondsRemaining]);

  return (
    <Dialog open={open} onOpenChange={() => { /* non-dismissable */ }}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-md"
        aria-labelledby="session-timeout-title"
      >
        <DialogTitle id="session-timeout-title" className="text-lg font-semibold tracking-tight">
          Still there?
        </DialogTitle>
        <DialogDescription className="text-[14px] leading-relaxed text-mt-ink-3">
          You&rsquo;ve been inactive for a while. You&rsquo;ll be automatically
          logged out in{" "}
          <span
            className="font-semibold tabular-nums"
            style={{ color: "#654BF9" }}
            aria-live="polite"
            aria-atomic="true"
          >
            {countdown}
          </span>{" "}
          to keep your account secure.
        </DialogDescription>

        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={onStay}
            className="w-full rounded-lg px-4 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
            style={{ backgroundColor: "#654BF9" }}
            autoFocus
          >
            Stay logged in
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="text-center text-[13px] font-medium text-mt-ink-3 underline-offset-2 hover:text-mt-ink hover:underline focus:outline-none"
          >
            Log out now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
