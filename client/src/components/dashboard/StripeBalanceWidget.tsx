/**
 * StripeBalanceWidget — collapsible Stripe balance widget for the main
 * distributor dashboard. All data is fetched live from Stripe via
 * `stripeConnect.getBalance` for the authenticated distributor's connected
 * account.
 *
 * States:
 *  - Not connected:   small CTA linking to Settings > Billing
 *  - Connected (collapsed): single-line pill showing live available balance
 *  - Connected (expanded):  full card with available, pending, last payout,
 *                           "View Stripe Dashboard →" + minimize
 *
 * Dismiss: the user can hide the widget; localStorage remembers the choice.
 * The widget can be re-enabled from Settings > Billing > "Show on dashboard".
 */

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { toast } from "sonner";
import {
  Wallet,
  ChevronDown,
  ChevronUp,
  X as XIcon,
  ExternalLink,
  Loader2,
  ArrowRight,
} from "lucide-react";

const COLLAPSED_KEY = "mergetasks.stripeBalanceWidget.collapsed";
const DISMISSED_KEY = "mergetasks.stripeBalanceWidget.dismissed";

function readLocalFlag(key: string): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeLocalFlag(key: string, value: boolean) {
  try {
    if (typeof window === "undefined") return;
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // localStorage may be unavailable (private browsing, SSR) — silently ignore
  }
}

function formatMoney(minorUnits: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatArrivalDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Sum the largest balance entry across currencies. Most distributors operate
 * in a single currency so this matches the intuition of "your balance"; if
 * multiple currencies are present we display the first as the headline and
 * the rest are still visible in the expanded view.
 */
function headlineBalance(entries: Array<{ amount: number; currency: string }>): { amount: number; currency: string } | null {
  if (entries.length === 0) return null;
  return entries[0];
}

export default function StripeBalanceWidget() {
  const prefersReduced = useReducedMotion();

  const [dismissed, setDismissed] = useState<boolean>(() => readLocalFlag(DISMISSED_KEY));
  const [collapsed, setCollapsed] = useState<boolean>(() => readLocalFlag(COLLAPSED_KEY));

  // Allow Settings to re-enable the widget by clearing the dismissed flag
  // and dispatching a "storage" event, OR by directly dispatching a custom
  // event. We listen to both so the dashboard re-renders without reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DISMISSED_KEY) setDismissed(readLocalFlag(DISMISSED_KEY));
      if (e.key === COLLAPSED_KEY) setCollapsed(readLocalFlag(COLLAPSED_KEY));
    };
    const onCustom = () => setDismissed(readLocalFlag(DISMISSED_KEY));
    window.addEventListener("storage", onStorage);
    window.addEventListener("mergetasks:stripeBalanceWidget:reenable", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mergetasks:stripeBalanceWidget:reenable", onCustom);
    };
  }, []);

  const { data: status } = trpc.stripeConnect.getStatus.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const onboardingComplete = Boolean(status?.hasConnectedAccount && status.onboardingComplete);

  const {
    data: balance,
    isLoading: isLoadingBalance,
    isError: isBalanceError,
  } = trpc.stripeConnect.getBalance.useQuery(undefined, {
    enabled: onboardingComplete && !dismissed,
    staleTime: 60_000,
    retry: false,
  });

  const getDashboardLink = trpc.stripeConnect.getDashboardLink.useMutation({
    onSuccess: (data) => {
      if (data?.url) window.open(data.url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => toast.error(err.message || "Couldn't open Stripe dashboard"),
  });

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeLocalFlag(COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    writeLocalFlag(DISMISSED_KEY, true);
  }, []);

  // Hidden by user choice
  if (dismissed) return null;

  // Status still loading on first paint — render nothing rather than a flash
  if (!status) return null;

  // Not connected / onboarding in progress: render nothing. The
  // StripeStatusPill in the header already surfaces the connect CTA,
  // so a second prompt card on the dashboard was redundant.
  if (!status.hasConnectedAccount || !onboardingComplete) {
    return null;
  }

  // Connected & onboarded
  const head = balance ? headlineBalance(balance.available) : null;
  const headMoney = head ? formatMoney(head.amount, head.currency) : null;
  const transition = { duration: prefersReduced ? 0 : 0.2, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] };

  return (
    <motion.div
      layout
      transition={transition}
      className="mb-6 rounded-xl border border-mt-border bg-white overflow-hidden"
      style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}
    >
      {/* ── Header (always visible) ────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-mt-surface transition-colors"
        aria-expanded={!collapsed}
      >
        <div className="relative shrink-0">
          <div className="w-8 h-8 rounded-lg bg-mt-brand-light flex items-center justify-center">
            <Wallet size={15} className="text-primary" />
          </div>
          {status.payoutsEnabled && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#16A34A] ring-2 ring-white"
              title="Payouts enabled"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-mt-ink-4">Stripe Balance</p>
            <span className="text-[10px] text-mt-ink-4">· live</span>
          </div>
          <p className="text-[14px] font-semibold text-mt-ink truncate mt-0.5">
            {isLoadingBalance && !balance ? (
              <span className="inline-flex items-center gap-1.5 text-mt-ink-3">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </span>
            ) : isBalanceError ? (
              <span className="text-mt-ink-3">Couldn't fetch balance</span>
            ) : headMoney ? (
              <>
                {headMoney} <span className="text-[12px] font-medium text-mt-ink-3">available</span>
              </>
            ) : (
              <span className="text-mt-ink-3">$0.00 available</span>
            )}
          </p>
        </div>
        <span
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-mt-surface-2 text-mt-ink-4 transition-colors"
          role="button"
          aria-label="Dismiss"
          title="Dismiss — re-enable from Settings → Billing"
        >
          <XIcon size={13} />
        </span>
        <span className="w-7 h-7 flex items-center justify-center text-mt-ink-4">
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>

      {/* ── Expanded body ──────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition}
            style={{ overflow: "hidden" }}
          >
            <div className="px-4 pb-4 border-t border-[#F0F0F0] pt-4">
              {isLoadingBalance && !balance ? (
                <div className="flex items-center gap-2 text-mt-ink-3 text-[13px]">
                  <Loader2 size={14} className="animate-spin" /> Fetching the latest balance from Stripe…
                </div>
              ) : isBalanceError || !balance ? (
                <p className="text-[12px] text-mt-ink-3">
                  Couldn't fetch the live balance from Stripe just now. Try the dashboard below.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-green-700 mb-1">Available</div>
                      {balance.available.length === 0 ? (
                        <div className="text-[14px] font-bold text-mt-ink">$0.00</div>
                      ) : (
                        balance.available.map((b) => (
                          <div key={`a-${b.currency}`} className="text-[14px] font-bold text-mt-ink">
                            {formatMoney(b.amount, b.currency)}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-1">Pending</div>
                      {balance.pending.length === 0 ? (
                        <div className="text-[14px] font-bold text-mt-ink">$0.00</div>
                      ) : (
                        balance.pending.map((b) => (
                          <div key={`p-${b.currency}`} className="text-[14px] font-bold text-mt-ink">
                            {formatMoney(b.amount, b.currency)}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  {balance.lastPayout ? (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-mt-surface">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-mt-ink-4">Last Payout</div>
                        <div className="text-[14px] font-semibold text-mt-ink mt-0.5">
                          {formatMoney(balance.lastPayout.amount, balance.lastPayout.currency)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-mt-ink-4">Arrives</div>
                        <div className="text-[12px] font-medium text-mt-ink-2">
                          {formatArrivalDate(balance.lastPayout.arrivalDate)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-mt-ink-4">No payouts yet — your first payout will appear here once Stripe transfers funds to your bank.</p>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      onClick={() => getDashboardLink.mutate()}
                      disabled={getDashboardLink.isPending}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline disabled:opacity-60 transition-colors"
                    >
                      {getDashboardLink.isPending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <ExternalLink size={12} />
                      )}
                      View Stripe Dashboard
                      <ArrowRight size={12} />
                    </button>
                    <button
                      onClick={handleToggle}
                      className="text-[12px] font-medium text-mt-ink-4 hover:text-mt-ink-2 transition-colors"
                    >
                      Minimize
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
