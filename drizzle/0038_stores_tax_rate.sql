-- Migration: 0038_stores_tax_rate
-- Adds taxRate column to the stores table.
-- taxRate is stored as a decimal (e.g. 0.0875 = 8.75%).
-- NULL means the store is tax-exempt or has not yet configured a tax rate.
-- Default is NULL so existing stores are unaffected until they set a rate.

ALTER TABLE `stores`
  ADD COLUMN `taxRate` DECIMAL(6, 4) NULL DEFAULT NULL
  COMMENT 'Sales tax rate as a decimal fraction (e.g. 0.0875 = 8.75%). NULL = tax-exempt.';
