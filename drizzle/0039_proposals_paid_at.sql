-- Migration 0039: Add paidAt timestamp to proposals table
-- Tracks when a proposal was paid via Stripe checkout in the client portal.
-- NULL = not yet paid (draft, sent, viewed, accepted but unpaid).
-- Non-NULL = payment confirmed by Stripe (either via client confirmation or webhook fallback).

ALTER TABLE `proposals`
  ADD COLUMN `paidAt` TIMESTAMP NULL DEFAULT NULL
    COMMENT 'Set when Stripe payment_intent.succeeded is confirmed; NULL = unpaid'
  AFTER `stripePaymentIntentId`;
