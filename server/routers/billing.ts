import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { PLANS, getPlanById } from "../stripe/products";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../stripe/stripeVersion";
import { getLogger } from "../utils/logger";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { BILLING_LIMIT } from "../utils/rateLimiter";

const log = getLogger("billing");

function getStripe() {
  if (!ENV.stripeSecretKey) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe is not configured. Please add your Stripe API keys." });
  }
  return new Stripe(ENV.stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
}

export const billingRouter = router({
  /** Get available subscription plans */
  getPlans: publicProcedure.query(() => {
    return PLANS.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      monthlyPrice: plan.monthlyPrice,
      yearlyPrice: plan.yearlyPrice,
      features: plan.features,
      limits: plan.limits,
      popular: plan.popular || false,
    }));
  }),

  /** Get current user's subscription status */
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [user] = await db!
      .select({
        subscriptionTier: users.subscriptionTier,
        subscriptionStatus: users.subscriptionStatus,
        stripeCustomerId: users.stripeCustomerId,
        stripeSubscriptionId: users.stripeSubscriptionId,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user) return null;

    let subscription = null;
    if (user.stripeSubscriptionId && ENV.stripeSecretKey) {
      try {
        const stripe = getStripe();
        subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      } catch (e) {
        // Subscription may have been deleted
        log.warn("Failed to retrieve Stripe subscription:", e);
      }
    }

    const plan = getPlanById(user.subscriptionTier || "free");

    return {
      tier: user.subscriptionTier || "free",
      status: user.subscriptionStatus || "none",
      plan,
      stripeSubscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            // Stripe types expose these as numbers at runtime even though the
            // SDK types them as Date objects in newer versions — cast via unknown.
            currentPeriodEnd: (subscription as unknown as { current_period_end?: number }).current_period_end
              ? new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000)
              : null,
            cancelAtPeriodEnd: (subscription as unknown as { cancel_at_period_end?: boolean }).cancel_at_period_end ?? false,
          }
        : null,
    };
  }),

  /** Create a Stripe Checkout session for a subscription */
  createCheckout: protectedProcedure
    .use(rateLimited("billing.createCheckout", BILLING_LIMIT))
    .input(
      z.object({
        planId: z.enum(["pro", "enterprise"]),
        interval: z.enum(["month", "year"]).default("month"),
        origin: z.string(), // frontend origin for redirect URLs
      })
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const plan = getPlanById(input.planId);
      if (!plan) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid plan" });

      const priceInCents =
        input.interval === "year" ? plan.yearlyPrice : plan.monthlyPrice;

      // Get or create Stripe customer
      let stripeCustomerId: string;
      const [user] = await db!
        .select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (user?.stripeCustomerId) {
        stripeCustomerId = user.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          email: ctx.user.email || undefined,
          name: ctx.user.name || undefined,
          metadata: {
            user_id: ctx.user.id.toString(),
          },
        });
        stripeCustomerId = customer.id;
        await db!
          .update(users)
          .set({ stripeCustomerId: customer.id })
          .where(eq(users.id, ctx.user.id));
      }

      // S39: Reuse existing Stripe Price if one exists for this plan+interval
      const lookupKey = `mergetasks_${plan.id}_${input.interval}`;
      const existingPrices = await stripe.prices.list({
        lookup_keys: [lookupKey],
        limit: 1,
      });
      let price: { id: string };
      if (existingPrices.data.length > 0) {
        price = existingPrices.data[0];
      } else {
        price = await stripe.prices.create({
          unit_amount: priceInCents,
          currency: "usd",
          recurring: { interval: input.interval },
          lookup_key: lookupKey,
          product_data: {
            name: `MergeTasks ${plan.name} Plan`,
            metadata: { plan_id: plan.id },
          },
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "subscription",
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${input.origin}/settings?tab=billing&status=success`,
        cancel_url: `${input.origin}/settings?tab=billing&status=canceled`,
        allow_promotion_codes: true,
        client_reference_id: ctx.user.id.toString(),
        metadata: {
          user_id: ctx.user.id.toString(),
          plan_id: input.planId,
          customer_email: ctx.user.email || "",
          customer_name: ctx.user.name || "",
        },
      });

      return { url: session.url };
    }),

  /** Create a portal session for managing subscription */
  createPortalSession: protectedProcedure
    .use(rateLimited("billing.createPortalSession", BILLING_LIMIT))
    .input(z.object({ origin: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [user] = await db!
        .select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user?.stripeCustomerId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No billing account found. Please subscribe to a plan first." });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${input.origin}/settings?tab=billing`,
      });

      return { url: session.url };
    }),

  /** Cancel subscription */
  cancelSubscription: protectedProcedure.use(rateLimited("billing.cancelSubscription", BILLING_LIMIT)).mutation(async ({ ctx }) => {
    const stripe = getStripe();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [user] = await db!
      .select({ stripeSubscriptionId: users.stripeSubscriptionId })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user?.stripeSubscriptionId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No active subscription found." });
    }

    // Cancel at period end (not immediately)
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    return { success: true };
  }),
});
