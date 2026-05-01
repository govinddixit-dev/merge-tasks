/**
 * StripeStatusPill — compact header indicator for the distributor's
 * Stripe Connect state.
 *
 * Two states:
 *   1. NOT CONNECTED → amber pill that deep-links to Settings →
 *      Integrations (uses `?tab=integrations` which Settings.tsx picks
 *      up on mount). That tab hosts `StripePaymentsPanel` — the Stripe
 *      Connect onboarding entry point for the distributor's account.
 *   2. CONNECTED     → ghost pill with a pulsing brand-purple dot.
 *      Clicking opens a Popover with today's collected total, the next
 *      upcoming payout (only if Stripe has one pending), and a
 *      "View in Stripe Dashboard" external link.
 *
 * Data loading strategy:
 *   - `stripeConnect.getStatus` — cached 5 min. One lightweight server
 *     call per header mount; the server already falls back to the DB
 *     if live refresh throws.
 *   - Invoices list + Stripe balance — `enabled: popoverOpen` so the
 *     header doesn't pay for them on every page. react-query serves
 *     cached data on re-open.
 *
 * Rendering nothing while `status` is unknown avoids the pill flashing
 * from "Connect" to "Live" on load, which would be misleading.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { toast } from "sonner";

const BRAND_PURPLE = "#654BF9";

interface InvoiceLike {
  status: string;
  total: string | null;
  paidAt: Date | string | null;
}

/** Sum of `total` across invoices whose `paidAt` falls in today. */
function sumCollectedToday(list: InvoiceLike[]): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startMs = startOfDay.getTime();
  let sum = 0;
  for (const i of list) {
    if (i.status !== "paid" || !i.paidAt) continue;
    const paidMs = new Date(i.paidAt).getTime();
    if (paidMs >= startMs) {
      sum += parseFloat(i.total ?? "0");
    }
  }
  return sum;
}

export default function StripeStatusPill() {
  const [, navigate] = useLocation();
  const [popoverOpen, setPopoverOpen] = useState(false);

  const { data: status } = trpc.stripeConnect.getStatus.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const connected = status?.hasConnectedAccount ?? false;

  // Lazy loads — fire only when the popover is actually opened.
  const { data: invoicesData } =
    trpc.estimatesInvoices.invoices.list.useQuery(undefined, {
      enabled: connected && popoverOpen,
      staleTime: 60 * 1000,
    });

  const { data: balanceData } = trpc.stripeConnect.getBalance.useQuery(
    undefined,
    {
      enabled:
        connected && (status?.canAcceptPayments ?? false) && popoverOpen,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
  );

  const dashboardLinkMutation = trpc.stripeConnect.getDashboardLink.useMutation(
    {
      onSuccess: (res) => {
        window.open(res.url, "_blank", "noopener,noreferrer");
      },
      onError: (err) => {
        toast.error(err.message);
      },
    },
  );

  // Status not loaded yet — render nothing to avoid a mis-state flash.
  if (!status) return null;

  /* ---------- State 1: not connected ---------- */
  if (!connected) {
    return (
      <button
        type="button"
        onClick={() => navigate("/settings?tab=integrations")}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 transition-colors"
        aria-label="Connect Stripe"
      >
        <AlertTriangle size={12} />
        Connect Stripe
      </button>
    );
  }

  /* ---------- State 2: connected ---------- */
  const collectedToday = sumCollectedToday(invoicesData ?? []);
  const lastPayout = balanceData?.lastPayout;
  const nextPayoutDate =
    lastPayout &&
    (lastPayout.status === "pending" || lastPayout.status === "in_transit") &&
    lastPayout.arrivalDate * 1000 > Date.now()
      ? new Date(lastPayout.arrivalDate * 1000)
      : null;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 h-8 px-3 rounded-full text-[12px] font-medium text-mt-ink-2 border border-mt-border bg-transparent hover:bg-mt-surface-2 transition-colors"
          aria-label="Stripe connection status"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
              style={{ backgroundColor: BRAND_PURPLE }}
            />
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: BRAND_PURPLE }}
            />
          </span>
          Live
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4">
            Collected today
          </p>
          <p className="text-[22px] font-bold text-mt-ink tabular-nums mt-0.5">
            $
            {collectedToday.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
        {nextPayoutDate && (
          <div className="mt-4 pt-4 border-t border-mt-border">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4">
              Next payout
            </p>
            <p className="text-[13px] font-medium text-mt-ink mt-0.5">
              {nextPayoutDate.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => dashboardLinkMutation.mutate()}
          disabled={dashboardLinkMutation.isPending}
          className="mt-4 w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-[12px] font-semibold text-mt-ink-2 border border-mt-border hover:bg-mt-surface-2 disabled:opacity-50 transition-colors"
        >
          {dashboardLinkMutation.isPending ? "Opening…" : "View in Stripe Dashboard"}
          <ExternalLink size={11} />
        </button>
      </PopoverContent>
    </Popover>
  );
}
