/**
 * MergeTasks Subscription Plans
 * Define products and prices for Stripe billing.
 */

export interface PlanFeature {
  name: string;
  included: boolean;
  limit?: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number; // in cents
  yearlyPrice: number; // in cents (annual)
  features: PlanFeature[];
  limits: {
    clients: number;
    proposals: number; // per month
    stores: number;
    proofs: number; // per month
    emailSends: number; // per month
  };
  popular?: boolean;
}

export const PLANS: SubscriptionPlan[] = [
  {
    id: "free",
    name: "Starter",
    description: "Get started with MergeTasks basics",
    monthlyPrice: 0,
    yearlyPrice: 0,
    features: [
      { name: "Client Management", included: true, limit: "Up to 5 clients" },
      { name: "Product Catalog", included: true, limit: "Up to 50 products" },
      { name: "Proposals", included: true, limit: "3 per month" },
      { name: "Webstores", included: true, limit: "1 store" },
      { name: "Virtual Proofing", included: true, limit: "5 proofs/month" },
      { name: "AI Copilot", included: false },
      { name: "Email Integration", included: false },
      { name: "Priority Support", included: false },
    ],
    limits: {
      clients: 5,
      proposals: 3,
      stores: 1,
      proofs: 5,
      emailSends: 10,
    },
  },
  {
    id: "pro",
    name: "Professional",
    description: "For growing distributors who need more power",
    monthlyPrice: 7900, // $79/month
    yearlyPrice: 79000, // $790/year ($65.83/mo)
    popular: true,
    features: [
      { name: "Client Management", included: true, limit: "Up to 50 clients" },
      { name: "Product Catalog", included: true, limit: "Up to 500 products" },
      { name: "Proposals", included: true, limit: "Unlimited" },
      { name: "Webstores", included: true, limit: "Up to 10 stores" },
      { name: "Virtual Proofing", included: true, limit: "50 proofs/month" },
      { name: "AI Copilot", included: true },
      { name: "Email Integration", included: true, limit: "Gmail & Outlook" },
      { name: "Priority Support", included: false },
    ],
    limits: {
      clients: 50,
      proposals: -1, // unlimited
      stores: 10,
      proofs: 50,
      emailSends: 500,
    },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Full platform access for large operations",
    monthlyPrice: 19900, // $199/month
    yearlyPrice: 199000, // $1990/year ($165.83/mo)
    features: [
      { name: "Client Management", included: true, limit: "Unlimited" },
      { name: "Product Catalog", included: true, limit: "Unlimited" },
      { name: "Proposals", included: true, limit: "Unlimited" },
      { name: "Webstores", included: true, limit: "Unlimited" },
      { name: "Virtual Proofing", included: true, limit: "Unlimited" },
      { name: "AI Copilot", included: true },
      { name: "Email Integration", included: true, limit: "Gmail & Outlook" },
      { name: "Priority Support", included: true },
      { name: "Custom Branding", included: true },
      { name: "API Access", included: true },
      { name: "Dedicated Account Manager", included: true },
    ],
    limits: {
      clients: -1,
      proposals: -1,
      stores: -1,
      proofs: -1,
      emailSends: -1,
    },
  },
];

export function getPlanById(planId: string): SubscriptionPlan | undefined {
  return PLANS.find((p) => p.id === planId);
}
