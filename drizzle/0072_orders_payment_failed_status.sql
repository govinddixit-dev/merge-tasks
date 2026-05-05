-- 0072_orders_payment_failed_status.sql
-- Adds the `payment_failed` value to the `orders.orderStatus` enum so the
-- payment_intent.payment_failed Stripe webhook handler can record that a
-- store-order PaymentIntent was declined or failed by the gateway.
--
-- Note: 0070 was a typo (referenced column `status` rather than the actual
-- DB column name `orderStatus` — Drizzle maps the JS field name `status`
-- to the SQL column declared in `mysqlEnum("orderStatus", ...)`). 0070 was
-- removed before being merged; 0072 is the corrected version. Existing
-- rows are not affected; the default remains `pending`.
ALTER TABLE `orders`
  MODIFY COLUMN `orderStatus` ENUM(
    'pending',
    'processing',
    'production',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
    'partially_refunded',
    'payment_failed'
  ) NOT NULL DEFAULT 'pending';
