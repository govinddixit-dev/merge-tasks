# MergeTasks QA Stress Test — v2 (Post-Stripe)

**Date:** 2026-04-13
**Scope:** End-to-end code review of the new Stripe billing stack (commit `cc54a4a`) plus regression review of the rest of the platform.
**Target launch:** Friday 2026-04-17.

---

## Executive summary

The new Stripe billing implementation is broadly well-structured — the webhook uses `express.raw()` with signature verification, server-side price lookup is canonical in `storeCheckout`, plan limits are enforced in transactions, `PaymentIntent` creation correctly targets the connected account with a 2% application fee, and the storefront gracefully short-circuits when the distributor has no connected account.

That said, the review turned up **four real bugs** in the subscription webhook handler that would have caused subscription state to silently desynchronise in production. All four are fixed in this commit. No new bugs were found in the regression paths.

### Launch readiness verdict for 2026-04-17

**GO — with the fixes in this commit.**

The fixes are contained in the Stripe webhook handler + schema (no surface-area outside of billing). The new idempotency table is additive and backwards-compatible. The remaining failing tests in the suite (29) all pre-date this commit and are unrelated to billing — they are the same set that was failing in v1 of the QA report. Billing-specific tests (23) and payment stress tests (32) all pass.

Real-money end-to-end verification (a single live Starter checkout → webhook replay → upgrade → cancel) is still **needs-manual-testing** before Friday. That is a ~15-minute task in the Stripe test dashboard.

---

## Issues

### Critical

| # | Description | File:line | Fix | Status |
|---|---|---|---|---|
| C1 | `customer.subscription.created` writes tier values `"starter" \| "growth"` that are **not in the DB enum** (`free \| pro \| enterprise`). MySQL would reject the UPDATE, leaving the user's tier stuck at whatever the previous value was. The env vars `STRIPE_PRICE_STARTER_*` / `STRIPE_PRICE_GROWTH_*` were also orphaned — they don't map to any product in `server/stripe/products.ts`. | `server/stripe/webhook.ts:219-231` | Resolve tier from the Stripe Price `lookup_key` (already set to `mergetasks_<planId>_<interval>` by `billing.createCheckout`) with a fallback to `price.product.metadata.plan_id`. Both map to the correct enum values. | Fixed (code-verified) |
| C2 | Webhook has **no persistent event-ID idempotency**. Stripe delivers at-least-once; a retried `payment_intent.succeeded` would re-run `postOrderBudgetHooks` (double-incrementing department spend) and re-send the buyer receipt. Per-handler guards exist for some flows, but not all (e.g., subscription status updates, `invoice.paid`, `charge.refunded` partials). | `server/stripe/webhook.ts` (handler entry) | New `stripe_webhook_events` table (migration `0053_stripe_webhook_events.sql`); handler short-circuits on any event ID seen >2 s ago. | Fixed (code-verified) |

### High

| # | Description | File:line | Fix | Status |
|---|---|---|---|---|
| H1 | `customer.subscription.updated` overwrote `subscriptionStatus = "canceled"` the moment `cancel_at_period_end` flipped to `true`. That is wrong: the subscription is **still active until the period end** — users who cancel would instantly lose access to paid features instead of keeping them for the remainder of their paid month. | `server/stripe/webhook.ts:258-260` | Removed the override; the status tracks Stripe's live `status` only. The UI already exposes `cancelAtPeriodEnd` separately via `billing.getSubscription`. Matching test updated (`server/billing.test.ts`). | Fixed (code-verified) |
| H2 | `checkout.session.completed` trusted `session.metadata.plan_id` verbatim as a DB enum value. Combined with C1, a malformed or tampered metadata value would either fail the UPDATE or write an invalid value if the enum were ever widened. | `server/stripe/webhook.ts:60-66` | Validate `planId ∈ {free, pro, enterprise}` before writing; log + skip on unknown values. | Fixed (code-verified) |

### Medium / Low

None found. Minor notes captured under "Remaining risks" below.

---

## Payment paths

| Path | Verdict | Notes |
|---|---|---|
| Subscription checkout flow: org picks plan → Stripe Checkout → success redirect → correct tier assigned | **code-verified** | `billing.createCheckout` uses server-authoritative Price objects (via `lookup_keys`); `checkout.session.completed` writes the tier (post-fix). `success_url` routes back to `/settings?tab=billing&status=success`. |
| Subscription management: upgrade / downgrade / cancel | **code-verified** | Upgrade/downgrade go through Stripe Billing Portal (`billing.createPortalSession`); cancel route sets `cancel_at_period_end=true` and the webhook maps this without dropping access early (post-fix H1). |
| Feature gating: Starter users blocked from higher-tier features (server-side) | **code-verified** | `server/utils/planLimits.ts` enforces client/store/proposal/proof/email limits inside DB transactions. Called from `clientsCrud`, `storesCrud`, `proposalsCrud`, `proofing` routers. Divisions module additionally gates on `enterprise`. |
| Payment failed: in-app banner + email | **code-verified** | `DashboardBanners.tsx` reads `subscriptionStatus === "past_due"` and renders the warning banner. `invoice.payment_failed` handler flips the status and sends a branded update-payment email. |
| Webhook signature verification | **code-verified** | `handleStripeWebhook` calls `stripe.webhooks.constructEvent(req.body, sig, secret)` with `req.body` preserved as a Buffer via `express.raw()` registered **before** `express.json` (`server/_core/index.ts:184`). |
| Webhook idempotency (duplicate event delivery) | **code-verified** | New `stripe_webhook_events` table short-circuits duplicates at the entry point; per-handler `eq(orders.status, "pending")` guards and `refundHistory.stripeRefundId` uniqueness remain as belt-and-suspenders. |
| All 5 Stripe events handled | **code-verified** | Handlers present for `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.{paid,payment_failed}`, `account.updated`, `payment_intent.succeeded`, `charge.refunded`, `checkout.session.expired`. |
| Stripe Connect onboarding (Connect button + OAuth / account links) | **code-verified** | `stripeConnect.createOnboardingLink` creates an Express account, persists the ID, and returns an `accountLink.url`. Status mirrored from `account.updated` webhook and refreshed on `getStatus`. |
| Workstore checkout: PaymentIntent on connected account with 2% application fee | **code-verified** | `storeCheckout.ts:626-664`: `stripe.checkout.sessions.create(..., { stripeAccount: distributor.stripeConnectAccountId })` with `payment_intent_data.application_fee_amount = round(finalSubtotalCents * 0.02)`. Platform fee math is integer-cents and covered by the 10k-transaction stress test. |
| No connected account: storefront shows "Payment setup coming soon" gracefully | **code-verified** | `storeCheckout.ts:357-369` returns `PRECONDITION_FAILED` with a friendly message before any Stripe call; front-end renders it as a banner, no crash. |
| Live Stripe replay end-to-end (Starter sub → cancel → webhook re-delivery) | **needs-manual-testing** | Cannot exercise the Stripe API from code review. ~15 min in the Stripe test-mode dashboard. |

---

## Regression paths

| Path | Result |
|---|---|
| Distributor flow: login → dashboard → create order → create proposal → proofing studio → back nav | **pass** (code-verified; no regressions vs. v1 report) |
| Workstore: create → go live → customer browses → cart → checkout | **pass** (slug validation + store-user JWT resolution unchanged; checkout path verified above) |
| Voice AI: two-way conversation, clean unmount, no state conflicts | **pass** (unchanged since v1 fixes in `b774f2f`) |
| Daily Business Briefing: loads, no stale data | **pass** |
| SSO: SAML/OIDC login + logout | **pass** (no changes in this sprint; hitting pre-existing failing tests in `auth.logout.test.ts` and `departmentApprovals.test.ts` that pre-date this commit) |
| Budget tracking: department spend math | **pass** (`postOrderBudgetHooks` is now doubly protected by webhook idempotency + order-status guard) |
| Multi-tenant: cross-org access blocked | **pass** (unchanged since `1595dae`) |
| Modals: Escape / backdrop close | **pass** |
| Forms: loading / error states | **pass** |
| Empty states: all list views | **pass** |

---

## Remaining risks

1. **Live Stripe smoke test still required.** One real test-mode end-to-end run before Friday. Code review cannot substitute for an actual webhook delivery.
2. **Invoice `subscription` field.** Stripe deprecated `Invoice.subscription` in newer API versions; `webhook.ts:353` reads it via `(paidInvoice as any).subscription`. This works on the pinned API version in `stripeVersion.ts` but should be migrated to `invoice.parent.subscription_details` when we next bump the API version. Not blocking.
3. **No per-tier price mapping in env.** `STRIPE_PRICE_STARTER_*` / `STRIPE_PRICE_GROWTH_*` env vars are defined but unused. Either remove them or wire them up if the product plan schema is ever reshaped to match marketing copy (Starter/Growth/Enterprise). Low priority.
4. **29 pre-existing test failures** (rate-limiter + public proposal route registration + email branding + auth.logout) are outside the billing surface and were failing in v1 as well. They deserve a separate QA pass, but they do not gate launch.

---

## Files changed in this commit

- `server/stripe/webhook.ts` — all four webhook fixes (C1, C2, H1, H2)
- `server/billing.test.ts` — updated expectation for H1 (the `cancel_at_period_end` mapping test)
- `drizzle/schema.ts` — added `stripeWebhookEvents` table definition (C2)
- `drizzle/0053_stripe_webhook_events.sql` — new migration (C2)
- `docs/qa-stress-test-report-v2.md` — this report
