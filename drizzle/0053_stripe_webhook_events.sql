-- QA v2 stress test: persistent Stripe webhook event idempotency
-- Without this table, Stripe's at-least-once delivery means duplicate events
-- can double-process (e.g., re-incrementing department spend on
-- payment_intent.succeeded retries, double-sending buyer receipts, etc.).
-- We record every processed event.id; handlers short-circuit on duplicates.

CREATE TABLE IF NOT EXISTS `stripe_webhook_events` (
  `id` varchar(255) NOT NULL,
  `type` varchar(128) NOT NULL,
  `receivedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `stripe_webhook_events_type_idx` (`type`)
);
