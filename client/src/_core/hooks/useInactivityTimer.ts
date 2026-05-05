/**
 * useInactivityTimer — drive an inactivity-based session timeout.
 *
 * The hook owns two timestamps:
 *   - `lastActivityAt` — updated on mouse/keyboard/touch/scroll events on the
 *     document, throttled to at most once per second to avoid thrash.
 *   - `pausedAt`       — set while the tab is hidden so time spent away from
 *     the tab does not count toward the timeout.
 *
 * A single 1-second interval does the actual evaluation, so there is no
 * timer storm when events fire. At each tick the hook computes elapsed
 * active time and calls `onWarning` / `onTimeout` exactly once per
 * threshold crossing. Activity detected while the warning modal is open
 * does NOT reset the timer — only the explicit `reset()` returned from the
 * hook does. This matches the contract in the audit ("Stay logged in"
 * button resets, not a stray mouse jitter).
 *
 * The hook is role-agnostic: callers pass the inactivity threshold and the
 * warning lead time and own the UI + logout effect. That keeps distributor
 * vs. store-portal wiring out of the shared hook.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;
const ACTIVITY_SAMPLE_MS = 1000; // throttle activity updates to 1/s
const TICK_MS = 1000;            // evaluator runs every second

export interface UseInactivityTimerOptions {
  /** Fully enable/disable the timer (e.g. gate on auth state). */
  enabled: boolean;
  /** Total inactivity before `onTimeout` fires, in milliseconds. */
  timeoutMs: number;
  /** Lead time before `onTimeout` at which `onWarning` fires, in ms. */
  warningLeadMs: number;
  /** Called the first time elapsed ≥ (timeoutMs − warningLeadMs). */
  onWarning: () => void;
  /** Called when elapsed ≥ timeoutMs. */
  onTimeout: () => void;
}

export interface UseInactivityTimerResult {
  /** Seconds remaining until `onTimeout`. Updates every second. 0 while disabled. */
  secondsRemaining: number;
  /** True once `onWarning` has fired and before `reset()` is called. */
  warningActive: boolean;
  /** Manually reset the inactivity counter (use from "Stay logged in" button). */
  reset: () => void;
}

export function useInactivityTimer(opts: UseInactivityTimerOptions): UseInactivityTimerResult {
  const { enabled, timeoutMs, warningLeadMs, onWarning, onTimeout } = opts;

  // Refs carry mutable state without re-rendering. The evaluator interval
  // only rerenders via the `secondsRemaining` state hook.
  const lastActivityRef = useRef<number>(Date.now());
  const lastActivitySampleRef = useRef<number>(0);
  const pausedAccumulatedRef = useRef<number>(0);
  const pausedSinceRef = useRef<number | null>(null);
  const warningFiredRef = useRef<boolean>(false);
  const timeoutFiredRef = useRef<boolean>(false);
  const onWarningRef = useRef(onWarning);
  const onTimeoutRef = useRef(onTimeout);
  onWarningRef.current = onWarning;
  onTimeoutRef.current = onTimeout;

  const [secondsRemaining, setSecondsRemaining] = useState<number>(() =>
    enabled ? Math.ceil(timeoutMs / 1000) : 0,
  );
  const [warningActive, setWarningActive] = useState<boolean>(false);

  const reset = useCallback(() => {
    lastActivityRef.current = Date.now();
    pausedAccumulatedRef.current = 0;
    pausedSinceRef.current = null;
    warningFiredRef.current = false;
    timeoutFiredRef.current = false;
    setWarningActive(false);
    setSecondsRemaining(Math.ceil(timeoutMs / 1000));
  }, [timeoutMs]);

  // Activity listeners. Throttle updates to one per second so scroll/mousemove
  // storms don't dominate the main thread. Crucially we do NOT record activity
  // while the warning is already showing — the user must click "Stay logged in"
  // to actively acknowledge.
  useEffect(() => {
    if (!enabled) return;
    const onActivity = () => {
      if (warningFiredRef.current) return;
      const now = Date.now();
      if (now - lastActivitySampleRef.current < ACTIVITY_SAMPLE_MS) return;
      lastActivitySampleRef.current = now;
      lastActivityRef.current = now;
    };
    for (const e of ACTIVITY_EVENTS) {
      document.addEventListener(e, onActivity, { passive: true });
    }
    return () => {
      for (const e of ACTIVITY_EVENTS) {
        document.removeEventListener(e, onActivity);
      }
    };
  }, [enabled]);

  // Visibility — when the tab goes hidden we "freeze" elapsed time so a user
  // who leaves the tab for 10 minutes does not lose 10 minutes off their
  // remaining budget. When the tab becomes visible again we add the hidden
  // interval to `pausedAccumulatedRef`, which the evaluator subtracts from
  // elapsed.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (pausedSinceRef.current == null) pausedSinceRef.current = Date.now();
      } else {
        if (pausedSinceRef.current != null) {
          pausedAccumulatedRef.current += Date.now() - pausedSinceRef.current;
          pausedSinceRef.current = null;
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled]);

  // Evaluator — single interval, runs every second, fires callbacks exactly
  // once each and updates the visible countdown.
  useEffect(() => {
    if (!enabled) {
      setSecondsRemaining(0);
      return;
    }
    reset();
    const id = window.setInterval(() => {
      const now = Date.now();
      // Subtract paused-while-hidden time from elapsed.
      let paused = pausedAccumulatedRef.current;
      if (pausedSinceRef.current != null) paused += now - pausedSinceRef.current;
      // While the tab is hidden we neither fire callbacks nor update the
      // countdown — the state is paused in every sense.
      if (pausedSinceRef.current != null) return;
      const elapsed = now - lastActivityRef.current - paused;
      const remaining = Math.max(0, timeoutMs - elapsed);
      setSecondsRemaining(Math.ceil(remaining / 1000));

      if (!warningFiredRef.current && elapsed >= timeoutMs - warningLeadMs) {
        warningFiredRef.current = true;
        setWarningActive(true);
        onWarningRef.current();
      }
      if (!timeoutFiredRef.current && elapsed >= timeoutMs) {
        timeoutFiredRef.current = true;
        onTimeoutRef.current();
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, timeoutMs, warningLeadMs, reset]);

  return { secondsRemaining, warningActive, reset };
}
