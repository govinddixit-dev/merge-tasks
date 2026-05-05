/**
 * StripeConnectPanel.tsx
 *
 * Displays the Stripe Connect bank account onboarding status for a distributor.
 * Shown in Settings > Billing tab.
 *
 * This is how distributors connect their bank account so they can receive
 * CC payments from their end-clients (store buyers and proposal clients).
 *
 * The actual bank account entry happens on Stripe's secure hosted page —
 * MergeTasks never sees or stores bank account details.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Building2,
  ArrowRight,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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

export default function StripeConnectPanel() {
  const utils = trpc.useUtils();
  const [showDisconnect, setShowDisconnect] = useState(false);

  const { data: status, isLoading } = trpc.stripeConnect.getStatus.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  // Fetch balance only after onboarding is complete; otherwise the API throws
  // PRECONDITION_FAILED and we should hide the section.
  const onboardingComplete = Boolean(status?.hasConnectedAccount && status.onboardingComplete);
  const {
    data: balance,
    isLoading: isLoadingBalance,
    isError: isBalanceError,
  } = trpc.stripeConnect.getBalance.useQuery(undefined, {
    enabled: onboardingComplete,
    staleTime: 60_000,
    retry: false,
  });

  const createOnboardingLink = trpc.stripeConnect.createOnboardingLink.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, "_blank");
        toast.info("Stripe onboarding opened in a new tab. Complete the setup to start accepting payments.");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create onboarding link.");
    },
  });

  const getDashboardLink = trpc.stripeConnect.getDashboardLink.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, "_blank");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to open payout dashboard.");
    },
  });

  const disconnect = trpc.stripeConnect.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Stripe Connect account disconnected.");
      utils.stripeConnect.getStatus.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to disconnect account.");
    },
  });

  const handleConnect = () => {
    createOnboardingLink.mutate({
      returnUrl: `${window.location.origin}/settings?tab=billing&connect=success`,
      refreshUrl: `${window.location.origin}/settings?tab=billing&connect=refresh`,
    });
  };

  const handleRefreshStatus = () => {
    utils.stripeConnect.getStatus.invalidate();
    toast.info("Refreshing connection status...");
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading payment setup status...</span>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Collect Payments from Clients</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Connect your bank account to receive CC payments from store buyers and proposal clients
            </p>
          </div>
        </div>
        <button
          onClick={handleRefreshStatus}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh status"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5">
        {/* Not connected yet */}
        {!status?.hasConnectedAccount && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Bank account not connected</p>
                <p className="text-xs text-amber-700 mt-1">
                  Your clients cannot pay by credit card until you connect your bank account.
                  Store orders and proposal payments will be limited to PO numbers and GL codes.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center text-xs text-gray-500">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-semibold text-gray-700 text-sm mb-1">1. Connect</div>
                <div>Enter your business and bank info on Stripe's secure page</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-semibold text-gray-700 text-sm mb-1">2. Client Pays</div>
                <div>End-client enters CC on your store or proposal checkout</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-semibold text-gray-700 text-sm mb-1">3. You Get Paid</div>
                <div>Funds deposit directly to your bank on your payout schedule</div>
              </div>
            </div>

            <button
              onClick={handleConnect}
              disabled={createOnboardingLink.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {createOnboardingLink.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              Connect Bank Account via Stripe
            </button>

            <p className="text-xs text-center text-gray-400">
              Powered by Stripe Connect. MergeTasks never stores your bank account details.
              A 2% platform fee applies to all CC payments collected through MergeTasks.
            </p>
            {/* Tier 3 compliance touchpoint — Stripe Connect legal disclosure */}
            <p className="text-[10px] text-center text-gray-400 leading-relaxed mt-1">
              By connecting, you agree to MergeTasks'{" "}
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">Terms of Service</a>
              {" "}and{" "}
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">Privacy Policy</a>,
              including processing of banking information by Stripe.
            </p>
          </div>
        )}

        {/* Connected but onboarding incomplete */}
        {status?.hasConnectedAccount && !status.onboardingComplete && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-800">Onboarding incomplete</p>
                <p className="text-xs text-yellow-700 mt-1">
                  You started connecting your bank account but didn't finish.
                  Complete the setup to start accepting credit card payments.
                </p>
              </div>
            </div>

            <button
              onClick={handleConnect}
              disabled={createOnboardingLink.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {createOnboardingLink.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              Complete Stripe Onboarding
            </button>
          </div>
        )}

        {/* Fully connected and active */}
        {status?.hasConnectedAccount && status.onboardingComplete && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">Bank account connected</p>
                <p className="text-xs text-green-700 mt-1">
                  You can now accept credit card payments from your clients.
                  Funds go directly to your bank account on your Stripe payout schedule.
                </p>
              </div>
            </div>

            {/* Status indicators */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                {status.chargesEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                )}
                <div>
                  <div className="text-xs font-medium text-gray-700">Accept Payments</div>
                  <div className="text-xs text-gray-500">{status.chargesEnabled ? "Enabled" : "Pending"}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                {status.payoutsEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                )}
                <div>
                  <div className="text-xs font-medium text-gray-700">Bank Payouts</div>
                  <div className="text-xs text-gray-500">{status.payoutsEnabled ? "Enabled" : "Pending"}</div>
                </div>
              </div>
            </div>

            {/* In-app Stripe balance + most recent payout */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-indigo-600" />
                <h4 className="text-sm font-semibold text-gray-900">Stripe Balance</h4>
              </div>
              {isLoadingBalance ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading balance…
                </div>
              ) : isBalanceError || !balance ? (
                <p className="text-xs text-gray-500">
                  Couldn't fetch balance from Stripe right now. Try the full dashboard below.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-green-700 mb-1">Available</div>
                      {balance.available.length === 0 ? (
                        <div className="text-sm font-bold text-gray-900">$0.00</div>
                      ) : (
                        balance.available.map((b) => (
                          <div key={`a-${b.currency}`} className="text-sm font-bold text-gray-900">
                            {formatMoney(b.amount, b.currency)}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 mb-1">Pending</div>
                      {balance.pending.length === 0 ? (
                        <div className="text-sm font-bold text-gray-900">$0.00</div>
                      ) : (
                        balance.pending.map((b) => (
                          <div key={`p-${b.currency}`} className="text-sm font-bold text-gray-900">
                            {formatMoney(b.amount, b.currency)}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  {balance.lastPayout ? (
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Last Payout</div>
                        <div className="text-sm font-semibold text-gray-900">
                          {formatMoney(balance.lastPayout.amount, balance.lastPayout.currency)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-gray-500">Arrives</div>
                        <div className="text-xs font-medium text-gray-700">
                          {formatArrivalDate(balance.lastPayout.arrivalDate)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No payouts yet — your first payout will appear here once Stripe transfers funds to your bank.</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => getDashboardLink.mutate()}
                disabled={getDashboardLink.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {getDashboardLink.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
                View Full Dashboard
              </button>
              <button
                onClick={() => setShowDisconnect(true)}
                disabled={disconnect.isPending}
                className="px-4 py-2.5 border border-gray-200 hover:border-red-300 hover:text-red-600 text-gray-500 text-sm font-medium rounded-lg transition-colors"
              >
                {disconnect.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Disconnect"}
              </button>
            </div>

            <p className="text-xs text-center text-gray-400">
              Account ID: {status.accountId} · 2% platform fee on all CC payments
            </p>

            {/* Re-enable the dashboard balance widget if the user dismissed it */}
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem("mergetasks.stripeBalanceWidget.dismissed");
                    window.dispatchEvent(new CustomEvent("mergetasks:stripeBalanceWidget:reenable"));
                    toast.success("Stripe balance widget re-enabled on the dashboard.");
                  } catch {
                    toast.error("Couldn't update widget preference.");
                  }
                }}
                className="text-[11px] text-gray-500 hover:text-indigo-600 underline transition-colors"
              >
                Show balance widget on dashboard
              </button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={showDisconnect}
        title="Disconnect your Stripe bank account?"
        description="Your clients will no longer be able to pay by credit card until you reconnect. Existing payouts already in transit are unaffected."
        confirmLabel="Disconnect"
        loading={disconnect.isPending}
        onCancel={() => setShowDisconnect(false)}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSettled: () => setShowDisconnect(false),
          })
        }
      />
    </div>
  );
}
