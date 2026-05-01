/**
 * BillingTab — Settings > Billing tab
 * Displays current plan, plan cards, and billing management.
 * Extracted from Settings.tsx for maintainability.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CreditCard, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import StripeConnectPanel from "./StripeConnectPanel";
import TaxSettingsPanel from "./TaxSettingsPanel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function BillingTab() {
  const { data: plans, isLoading: plansLoading } = trpc.billing.getPlans.useQuery();
  const { data: subscription, isLoading: subLoading } = trpc.billing.getSubscription.useQuery();
  const createCheckout = trpc.billing.createCheckout.useMutation();
  const createPortal = trpc.billing.createPortalSession.useMutation();
  const cancelSub = trpc.billing.cancelSubscription.useMutation();
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const [showCancel, setShowCancel] = useState(false);
  const utils = trpc.useUtils();

  const handleSubscribe = async (planId: "pro" | "enterprise") => {
    try {
      const result = await createCheckout.mutateAsync({
        planId,
        interval: billingInterval,
        origin: window.location.origin,
      });
      if (result.url) {
        toast.info("Redirecting to Stripe checkout...");
        window.open(result.url, "_blank");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create checkout session";
      toast.error(message);
    }
  };

  const handleManageBilling = async () => {
    try {
      const result = await createPortal.mutateAsync({ origin: window.location.origin });
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to open billing portal";
      toast.error(message);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelSub.mutateAsync();
      toast.success("Subscription will be canceled at the end of the billing period.");
      utils.billing.getSubscription.invalidate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to cancel subscription";
      toast.error(message);
    } finally {
      setShowCancel(false);
    }
  };

  if (plansLoading || subLoading) {
    return (
      <div className="bg-white rounded-lg border border-mt-border p-7">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-mt-surface-2 rounded w-48" />
          <div className="h-32 bg-mt-surface-2 rounded" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-64 bg-mt-surface-2 rounded" />
            <div className="h-64 bg-mt-surface-2 rounded" />
            <div className="h-64 bg-mt-surface-2 rounded" />
          </div>
        </div>
      </div>
    );
  }

  const currentTier = subscription?.tier || "free";
  const currentPlan = plans?.find((p) => p.id === currentTier);

  return (
    <div>
      {/* Current Plan */}
      <div className="bg-white rounded-lg border border-mt-border p-7 mb-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-mt-ink">Current Plan</h3>
          {currentTier !== "free" && (
            <button onClick={handleManageBilling} className="sq-action-btn flex items-center gap-2" style={{ border: '1px solid #E5E5E5', color: '#525252' }}>
              <CreditCard size={12} /> Manage Billing
            </button>
          )}
        </div>
        <div className="p-5 bg-mt-surface rounded-lg border border-mt-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-medium text-mt-ink-4 mb-1.5">Active Plan</p>
              <p className="text-[22px] font-bold text-mt-ink">{currentPlan?.name || "Starter"}</p>
              {subscription?.stripeSubscription && (
                <p className="text-[11px] text-mt-ink-3 mt-1">
                  Status: <span className="font-semibold capitalize">{subscription.stripeSubscription.status}</span>
                  {subscription.stripeSubscription.cancelAtPeriodEnd && " (cancels at period end)"}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[28px] font-bold text-primary tracking-tight">
                ${((currentPlan?.monthlyPrice || 0) / 100).toFixed(0)}
                <span className="text-[13px] font-normal text-mt-ink-4">/mo</span>
              </p>
            </div>
          </div>
        </div>
        {currentTier !== "free" && !subscription?.stripeSubscription?.cancelAtPeriodEnd && (
          <div className="mt-3">
            <button onClick={() => setShowCancel(true)} className="text-[11px] text-red-500 hover:text-red-700 font-medium transition-colors">
              Cancel Subscription
            </button>
            {/* Tier 3 compliance touchpoint — account cancellation/deletion notice */}
            <p className="text-[10px] text-mt-ink-4 mt-1 leading-relaxed">
              Canceling ends your subscription at the billing period end. Your data is retained for 30 days per our{" "}
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-mt-ink-3">Privacy Policy</a>
              {" "}and{" "}
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-mt-ink-3">Terms of Service</a>.
            </p>
          </div>
        )}
      </div>

      {/* Billing Interval Toggle */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <button
          onClick={() => setBillingInterval("month")}
          className={`px-4 py-2 text-[12px] font-semibold rounded-lg transition-all ${
            billingInterval === "month"
              ? "bg-primary text-white"
              : "bg-mt-surface-2 text-mt-ink-3 hover:bg-[#EBEBEB]"
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingInterval("year")}
          className={`px-4 py-2 text-[12px] font-semibold rounded-lg transition-all ${
            billingInterval === "year"
              ? "bg-primary text-white"
              : "bg-mt-surface-2 text-mt-ink-3 hover:bg-[#EBEBEB]"
          }`}
        >
          Yearly <span className="text-[10px] ml-1 opacity-80">(Save 17%)</span>
        </button>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans?.map((plan) => {
          const price = billingInterval === "year" ? plan.yearlyPrice / 12 : plan.monthlyPrice;
          const isCurrentPlan = plan.id === currentTier;
          const isUpgrade = plan.id !== "free" && (currentTier === "free" || (currentTier === "pro" && plan.id === "enterprise"));

          return (
            <div
              key={plan.id}
              className={`bg-white rounded-lg border p-6 transition-all relative ${
                plan.popular ? "border-primary ring-1 ring-primary/20" : "border-mt-border"
              } ${isCurrentPlan ? "bg-mt-brand-light" : ""}`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary text-white text-[9px] font-bold uppercase tracking-wider rounded-full">
                  Most Popular
                </div>
              )}
              <h4 className="text-[16px] font-bold text-mt-ink mb-1">{plan.name}</h4>
              <p className="text-[11px] text-mt-ink-3 mb-4">{plan.description}</p>
              <p className="text-[32px] font-bold text-mt-ink mb-1">
                ${(price / 100).toFixed(0)}
                <span className="text-[13px] font-normal text-mt-ink-4">/mo</span>
              </p>
              {billingInterval === "year" && plan.monthlyPrice > 0 && (
                <p className="text-[10px] text-[#22C55E] font-semibold mb-4">
                  Billed ${(plan.yearlyPrice / 100).toFixed(0)}/year
                </p>
              )}
              <div className="space-y-2 mb-6 mt-4">
                {plan.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    {f.included ? (
                      <CheckCircle2 size={12} className="text-[#22C55E] flex-shrink-0" />
                    ) : (
                      <XCircle size={12} className="text-[#D4D4D4] flex-shrink-0" />
                    )}
                    <span className={f.included ? "text-mt-ink-2" : "text-mt-ink-4"}>
                      {f.name}{f.limit ? ` — ${f.limit}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              {isCurrentPlan ? (
                <button disabled className="w-full py-2.5 text-[12px] font-semibold rounded-lg bg-mt-surface-2 text-mt-ink-4 cursor-not-allowed">
                  Current Plan
                </button>
              ) : plan.id === "free" ? (
                <button disabled className="w-full py-2.5 text-[12px] font-semibold rounded-lg bg-mt-surface-2 text-mt-ink-3 cursor-not-allowed">
                  Free Tier
                </button>
              ) : (
                <button
                  onClick={() => handleSubscribe(plan.id as "pro" | "enterprise")}
                  disabled={createCheckout.isPending}
                  className={`w-full py-2.5 text-[12px] font-bold rounded-lg transition-all ${
                    plan.popular
                      ? "bg-primary text-white hover:bg-[#5438D8]"
                      : "bg-[#1A1A1A] text-white hover:bg-[#333]"
                  }`}
                >
                  {createCheckout.isPending ? "Processing..." : isUpgrade ? "Upgrade" : "Subscribe"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Stripe Connect — Distributor Bank Account for Collecting Client Payments */}
      <div className="mt-6">
        <h3 className="text-[15px] font-semibold text-mt-ink mb-3">Collect Payments from Your Clients</h3>
        <p className="text-[12px] text-mt-ink-3 mb-3">
          Connect your bank account so your clients can pay by credit card on store orders and proposals.
          Payments go directly to your bank — MergeTasks never holds your funds.
        </p>
        <StripeConnectPanel />
      </div>

      {/* Default Tax Rate */}
      <div className="mt-4">
        <TaxSettingsPanel />
      </div>

      {/* Test Mode Notice */}
      <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-[11px] text-amber-800 font-medium">
          🧪 <strong>Test Mode Active</strong> — Use card number <code className="bg-amber-100 px-1 rounded">4242 4242 4242 4242</code> with any future expiry and CVC to test payments. No real charges will be made.
        </p>
      </div>
      <ConfirmDialog
        open={showCancel}
        title="Cancel your subscription?"
        description="Your subscription will remain active until the end of the current billing period. After that, the workspace will downgrade to the free tier."
        confirmLabel="Cancel subscription"
        loading={cancelSub.isPending}
        onCancel={() => setShowCancel(false)}
        onConfirm={handleCancel}
      />
    </div>
  );
}
