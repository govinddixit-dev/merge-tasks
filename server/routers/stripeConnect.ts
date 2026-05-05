/**
 * stripeConnect.ts
 *
 * Handles Stripe Connect onboarding for distributors so they can receive
 * CC payments from their end-clients directly into their own bank account.
 *
 * Architecture:
 *   - MergeTasks is the "Platform" account (holds STRIPE_SECRET_KEY)
 *   - Each distributor gets a Stripe Express Connected Account
 *   - When an end-client pays by CC on a store or proposal:
 *       → Stripe charges the end-client
 *       → The full amount minus the MergeTasks platform fee goes to the distributor's bank
 *       → MergeTasks keeps the platform fee automatically
 *
 * The distributor NEVER touches MergeTasks' bank account.
 * The distributor NEVER has to manually transfer money.
 * Stripe handles everything automatically via the Connect payout schedule.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../stripe/stripeVersion";
import { ENV } from "../_core/env";
import { getLogger } from "../utils/logger";
import { auditLog } from "../utils/auditLog";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { BILLING_LIMIT } from "../utils/rateLimiter";

const log = getLogger("stripeConnect");

function getStripe(): Stripe {
  if (!ENV.stripeSecretKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Stripe is not configured on this server.",
    });
  }
  return new Stripe(ENV.stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
}

/**
 * Platform fee MergeTasks takes on every end-client CC payment.
 * Configurable per deployment via the `PLATFORM_FEE_PERCENT` env var
 * (multiplier, e.g. 0.02 = 2%). Defaults to 0.02 if unset.
 */
export const PLATFORM_FEE_PERCENT = ENV.platformFeePercent;

export const stripeConnectRouter = router({
  /**
   * Get the current Stripe Connect status for the logged-in distributor.
   * Returns whether they have a connected account, whether payouts are enabled,
   * and whether they can accept charges.
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [user] = await db
      .select({
        stripeConnectAccountId: users.stripeConnectAccountId,
        stripeConnectOnboardingComplete: users.stripeConnectOnboardingComplete,
        stripeConnectPayoutsEnabled: users.stripeConnectPayoutsEnabled,
        stripeConnectChargesEnabled: users.stripeConnectChargesEnabled,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    // If they have an account, refresh the live status from Stripe
    if (user.stripeConnectAccountId) {
      try {
        const stripe = getStripe();
        const account = await stripe.accounts.retrieve(user.stripeConnectAccountId);
        const payoutsEnabled = account.payouts_enabled ?? false;
        const chargesEnabled = account.charges_enabled ?? false;
        const onboardingComplete = account.details_submitted ?? false;

        // Keep our DB in sync with Stripe's live status
        if (
          payoutsEnabled !== user.stripeConnectPayoutsEnabled ||
          chargesEnabled !== user.stripeConnectChargesEnabled ||
          onboardingComplete !== user.stripeConnectOnboardingComplete
        ) {
          await db
            .update(users)
            .set({
              stripeConnectPayoutsEnabled: payoutsEnabled,
              stripeConnectChargesEnabled: chargesEnabled,
              stripeConnectOnboardingComplete: onboardingComplete,
            })
            .where(eq(users.id, ctx.user.id));
        }

        return {
          hasConnectedAccount: true,
          accountId: user.stripeConnectAccountId,
          onboardingComplete,
          payoutsEnabled,
          chargesEnabled,
          canAcceptPayments: chargesEnabled && payoutsEnabled,
        };
      } catch (err) {
        log.warn("Failed to refresh Stripe Connect status:", err);
      }
    }

    return {
      hasConnectedAccount: !!user.stripeConnectAccountId,
      accountId: user.stripeConnectAccountId ?? null,
      onboardingComplete: user.stripeConnectOnboardingComplete,
      payoutsEnabled: user.stripeConnectPayoutsEnabled,
      chargesEnabled: user.stripeConnectChargesEnabled,
      canAcceptPayments: user.stripeConnectChargesEnabled && user.stripeConnectPayoutsEnabled,
    };
  }),

  /**
   * Create a Stripe Express Connected Account for the distributor (if they don't have one)
   * and return an onboarding link.
   *
   * The distributor clicks this link, goes to Stripe's hosted onboarding page,
   * enters their business info, bank account details, and SSN/EIN for identity verification.
   * Once complete, Stripe notifies us via webhook and we mark their account as ready.
   *
   * The distributor NEVER enters bank account info inside MergeTasks — it all happens
   * on Stripe's secure, PCI-compliant hosted page.
   */
  createOnboardingLink: protectedProcedure
    .use(rateLimited("stripeConnect.createOnboardingLink", BILLING_LIMIT))
    .input(
      z.object({
        /** The frontend URL to redirect back to after onboarding completes */
        returnUrl: z.string().url(),
        /** The frontend URL to redirect back to if they exit onboarding early */
        refreshUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const stripe = getStripe();

      // Check if distributor already has a Connect account
      const [user] = await db
        .select({
          stripeConnectAccountId: users.stripeConnectAccountId,
          email: users.email,
          name: users.name,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      let connectAccountId = user.stripeConnectAccountId;

      // Create a new Express account if they don't have one
      if (!connectAccountId) {
        const account = await stripe.accounts.create({
          type: "express",
          email: user.email ?? undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_profile: {
            name: user.name ?? undefined,
            // Promotional products / branded merchandise industry
            mcc: "5999",
          },
          metadata: {
            mergetasks_user_id: ctx.user.id.toString(),
          },
        });

        connectAccountId = account.id;

        // Save the new account ID to the database
        await db
          .update(users)
          .set({ stripeConnectAccountId: account.id })
          .where(eq(users.id, ctx.user.id));

        log.info(`Created Stripe Connect account ${account.id} for user ${ctx.user.id}`);
        auditLog({
          action: "stripe.connect.onboarded",
          userId: ctx.user.id,
          actorEmail: user.email ?? undefined,
          resourceType: "stripeConnectAccount",
          resourceId: account.id,
          description: `Created Stripe Connect Express account ${account.id}`,
        });
      }

      // Generate the onboarding link (valid for a few minutes)
      const accountLink = await stripe.accountLinks.create({
        account: connectAccountId,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        type: "account_onboarding",
      });

      return { url: accountLink.url };
    }),

  /**
   * Generate a Stripe Express Dashboard link for the distributor.
   * This lets them view their payouts, balance, and transaction history
   * directly on Stripe's dashboard — without leaving MergeTasks.
   *
   * Only works after onboarding is complete.
   */
  getDashboardLink: protectedProcedure.use(rateLimited("stripeConnect.getDashboardLink", BILLING_LIMIT)).mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const stripe = getStripe();

    const [user] = await db
      .select({ stripeConnectAccountId: users.stripeConnectAccountId })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user?.stripeConnectAccountId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "You must connect your bank account before accessing the payout dashboard.",
      });
    }

    const loginLink = await stripe.accounts.createLoginLink(user.stripeConnectAccountId);
    return { url: loginLink.url };
  }),

  /**
   * Fetch the connected account's current Stripe balance and most recent payout
   * so distributors can see money movement without leaving MergeTasks.
   *
   * Returns:
   *  - `available` and `pending` balances summed by currency (lowercase ISO 4217)
   *  - `lastPayout` { amount, currency, arrivalDate } if any payouts exist
   *
   * Only available after onboarding is complete; otherwise the client should
   * hide the section per the UI rule (see StripeConnectPanel).
   */
  getBalance: protectedProcedure
    .use(rateLimited("stripeConnect.getBalance", BILLING_LIMIT))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const stripe = getStripe();

      const [user] = await db
        .select({
          stripeConnectAccountId: users.stripeConnectAccountId,
          stripeConnectOnboardingComplete: users.stripeConnectOnboardingComplete,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user?.stripeConnectAccountId || !user.stripeConnectOnboardingComplete) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Complete Stripe onboarding before viewing your balance.",
        });
      }

      const stripeAccount = user.stripeConnectAccountId;

      // Fetch balance + most recent payout in parallel against the connected account.
      const [balance, payouts] = await Promise.all([
        stripe.balance.retrieve(undefined, { stripeAccount }),
        stripe.payouts.list({ limit: 1 }, { stripeAccount }),
      ]);

      const available = balance.available.map((b) => ({
        amount: b.amount, // minor units
        currency: b.currency, // lowercase ISO 4217
      }));
      const pending = balance.pending.map((b) => ({
        amount: b.amount,
        currency: b.currency,
      }));

      const lastPayoutRaw = payouts.data[0] ?? null;
      const lastPayout = lastPayoutRaw
        ? {
            amount: lastPayoutRaw.amount,
            currency: lastPayoutRaw.currency,
            status: lastPayoutRaw.status,
            arrivalDate: lastPayoutRaw.arrival_date, // unix seconds
          }
        : null;

      return { available, pending, lastPayout };
    }),

  /**
   * Disconnect / deauthorize the distributor's Stripe Connect account.
   * This does NOT delete the Stripe account — it just removes the connection
   * from MergeTasks. The distributor can reconnect at any time.
   */
  disconnect: protectedProcedure.use(rateLimited("stripeConnect.disconnect", BILLING_LIMIT)).mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [user] = await db
      .select({ stripeConnectAccountId: users.stripeConnectAccountId })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user?.stripeConnectAccountId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No connected account found." });
    }

    // Clear the Connect account from our database
    await db
      .update(users)
      .set({
        stripeConnectAccountId: null,
        stripeConnectOnboardingComplete: false,
        stripeConnectPayoutsEnabled: false,
        stripeConnectChargesEnabled: false,
      })
      .where(eq(users.id, ctx.user.id));

    log.info(`Disconnected Stripe Connect account for user ${ctx.user.id}`);
    auditLog({
      action: "stripe.connect.removed",
      userId: ctx.user.id,
      resourceType: "stripeConnectAccount",
      resourceId: user.stripeConnectAccountId,
      description: `Disconnected Stripe Connect account ${user.stripeConnectAccountId}`,
    });
    return { success: true };
  }),
});
