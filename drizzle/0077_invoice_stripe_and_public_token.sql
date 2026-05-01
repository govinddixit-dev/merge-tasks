-- 0077_invoice_stripe_and_public_token.sql
-- Adds columns needed by the Session-2 preview / payment / draft flow:
--
--   1. invoices.publicToken — random opaque token used to load the
--      invoice over the unauthenticated payment route
--      (/invoices/pay/:token). Not an id, so it can't be enumerated and
--      can be rotated if ever leaked. NULL until the distributor sends
--      the invoice; drafts never expose one.
--
--   2. invoices.stripeCheckoutSessionId + invoices.stripeCheckoutUrl —
--      the Checkout Session created at send-time when the distributor's
--      Stripe Connect account can accept card payments. The URL is
--      reused by subsequent views until the session expires; the server
--      re-creates on demand if Stripe returns "session expired".
--
-- All three are nullable additive columns — existing rows, queries,
-- and mutations keep working unchanged.

ALTER TABLE `invoices`
  ADD COLUMN `invPublicToken` VARCHAR(64) NULL DEFAULT NULL;

ALTER TABLE `invoices`
  ADD COLUMN `invStripeCheckoutSessionId` VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE `invoices`
  ADD COLUMN `invStripeCheckoutUrl` VARCHAR(1024) NULL DEFAULT NULL;

CREATE INDEX `invoices_publicToken_idx` ON `invoices` (`invPublicToken`);
