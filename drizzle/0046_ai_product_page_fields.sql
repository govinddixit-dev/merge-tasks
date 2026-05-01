-- Migration: 0046_ai_product_page_fields
-- Adds three AI-generated product-page branding fields to the stores table.
-- All columns are nullable with no default — existing rows are unaffected.

ALTER TABLE stores
  ADD COLUMN `aiProductPageCTA` VARCHAR(100) NULL AFTER aiColorPalette,
  ADD COLUMN aiProductGridHeading VARCHAR(150) NULL AFTER aiProductPageCTA,
  ADD COLUMN aiProductBadgeStyle ENUM('pill', 'ribbon', 'corner') NULL AFTER aiProductGridHeading;
