/**
 * stripeClient.ts — Centralized Stripe client factory.
 *
 * Audit fix #13 (CRITICAL): All server code MUST obtain the Stripe instance
 * from this factory instead of calling `new Stripe(process.env.STRIPE_SECRET_KEY!, ...)`
 * directly. This ensures:
 *   1. The ENV object's validation (startup crash if key is missing) is always applied.
 *   2. A consistent API version is used everywhere.
 *   3. The key is never silently empty — the factory throws at call time if unconfigured.
 *
 * Usage:
 *   import { getStripe } from "../stripe/stripeClient";
 *   const stripe = getStripe();
 */
import Stripe from "stripe";
import { ENV } from "../_core/env";
import { STRIPE_API_VERSION } from "./stripeVersion";

let _stripeInstance: Stripe | null = null;

/**
 * Returns a singleton Stripe client initialized with the validated ENV key.
 * Throws a clear error if STRIPE_SECRET_KEY is not configured, rather than
 * crashing with an obscure Stripe SDK error at runtime.
 */
export function getStripe(): Stripe {
  if (!ENV.stripeSecretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Set it in your .env file before using Stripe features."
    );
  }
  if (!_stripeInstance) {
    _stripeInstance = new Stripe(ENV.stripeSecretKey, {
      // Stripe v22 accepts apiVersion as a plain string (no LatestApiVersion type)
      apiVersion: STRIPE_API_VERSION,
    });
  }
  return _stripeInstance;
}
