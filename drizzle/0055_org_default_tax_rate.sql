-- 0055_org_default_tax_rate.sql
-- Adds organizations.defaultTaxRate — a per-org default applied to newly
-- created stores. Existing stores keep their own store.taxRate; this column
-- is purely a template for future stores under the same org.
--
-- Zero-regression: column is NULL for all existing rows. Any code that
-- previously relied on store.taxRate keeps working unchanged.

ALTER TABLE `organizations`
  ADD COLUMN `defaultTaxRate` DECIMAL(5,4) NULL DEFAULT NULL;
