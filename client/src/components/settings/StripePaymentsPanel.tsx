/**
 * StripePaymentsPanel.tsx
 * Integrations-tab card for Stripe Connect. Mirrors QuickBooksPanel's shape.
 * Connect → triggers existing Stripe Connect onboarding OAuth flow.
 * Manage → opens the Stripe payout dashboard.
 */

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { CheckCircle2, ArrowUpRight, Loader2, ExternalLink } from "lucide-react";
import IntegrationLogo from "./IntegrationLogo";

export default function StripePaymentsPanel() {
  const { data: status } = trpc.stripeConnect.getStatus.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const createOnboardingLink = trpc.stripeConnect.createOnboardingLink.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, "_blank");
        toast.info("Stripe onboarding opened in a new tab.");
      }
    },
    // Swallow the raw Stripe error (e.g. "You can only create new accounts if
    // you've signed up for Connect.") and show a friendly message instead.
    // The real error is still available in the network tab for debugging, and
    // server logs retain the original message via the tRPC error handler.
    onError: () => {
      toast.error("Unable to connect Stripe right now — please try again or contact support.");
    },
  });

  const getDashboardLink = trpc.stripeConnect.getDashboardLink.useMutation({
    onSuccess: (data) => {
      if (data.url) window.open(data.url, "_blank");
    },
    onError: (err) => toast.error(err.message || "Failed to open Stripe dashboard."),
  });

  const isConnected = status?.hasConnectedAccount === true;

  const handleConnect = () => {
    createOnboardingLink.mutate({
      returnUrl: `${window.location.origin}/settings?tab=integrations&connect=success`,
      refreshUrl: `${window.location.origin}/settings?tab=integrations&connect=refresh`,
    });
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border p-6">
      <div className="flex items-start gap-4">
        <IntegrationLogo kind="stripe" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-[14px] font-semibold text-mt-ink">Stripe Payments</h4>
            {isConnected ? (
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] px-2 py-0.5 rounded">
                <CheckCircle2 size={9} /> Connected
              </span>
            ) : (
              <span className="text-[9px] font-bold uppercase tracking-wider text-mt-ink-4 bg-mt-surface-2 border border-mt-border px-2 py-0.5 rounded">
                Not Connected
              </span>
            )}
          </div>
          <p className="text-[12px] text-mt-ink-3 mt-0.5 leading-relaxed">
            Accept payments from your workstore customers. Connect your Stripe account to receive payouts directly to your bank.
          </p>
          <div className="flex items-center gap-2 mt-3">
            {isConnected ? (
              <button
                onClick={() => getDashboardLink.mutate()}
                disabled={getDashboardLink.isPending}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-white rounded-lg transition-colors disabled:opacity-60"
                style={{ backgroundColor: "#635BFF" }}
              >
                {getDashboardLink.isPending ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                Manage
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={createOnboardingLink.isPending}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-white rounded-lg transition-colors disabled:opacity-60"
                style={{ backgroundColor: "#635BFF" }}
              >
                {createOnboardingLink.isPending ? <Loader2 size={12} className="animate-spin" /> : <>Connect Stripe <ArrowUpRight size={12} /></>}
              </button>
            )}
            <a
              href="https://dashboard.stripe.com/connect"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-mt-ink-4 hover:text-mt-ink-3 underline"
              title="Stripe Connect enrollment"
            >
              Learn more
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
