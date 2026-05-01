import { AlertTriangle, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * DashboardBanners — blocking alerts that go at the very top of the
 * dashboard. Currently only the subscription past-due banner lives here;
 * the Stripe Connect prompt was removed because the StripeStatusPill in
 * the top-right header already surfaces that state.
 */
export default function DashboardBanners() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const isPastDue = (user as { subscriptionStatus?: string } | null)?.subscriptionStatus === "past_due";

  if (!isPastDue) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
        <AlertTriangle size={18} className="text-red-600 shrink-0" />
        <div className="flex-1 text-sm">
          <strong className="text-red-900">Payment failed.</strong>{" "}
          <span className="text-red-800">Your MergeTasks subscription is past due — update your payment method to keep your workspace active.</span>
        </div>
        <button
          onClick={() => navigate("/settings?tab=billing")}
          className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-red-700 transition-colors"
        >
          Update billing <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}
