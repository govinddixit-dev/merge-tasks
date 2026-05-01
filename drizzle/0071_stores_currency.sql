-- 0071_stores_currency.sql
-- Adds a per-store ISO 4217 currency code used at Stripe checkout.
-- Defaults to "usd" so existing stores keep their current behavior; new
-- distributors can switch to "cad" (or future codes) from the store's
-- Settings tab. Nullable so any historic NULL value falls back to "usd"
-- in application code without requiring a backfill.
ALTER TABLE `stores`
  ADD COLUMN `currency` VARCHAR(3) NULL DEFAULT 'usd';
