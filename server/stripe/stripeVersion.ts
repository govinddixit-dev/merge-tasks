/**
 * Single source of truth for the Stripe API version used across the entire app.
 *
 * Every file that creates a Stripe instance MUST import this constant
 * instead of hardcoding a version string. This prevents version mismatches
 * between checkout, webhooks, and refund processing.
 */
// Stripe v22 uses a plain string for apiVersion — cast to the expected type at call sites
export const STRIPE_API_VERSION = "2026-03-25.dahlia" as const;
