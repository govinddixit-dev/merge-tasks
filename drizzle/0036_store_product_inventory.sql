-- 0036: Add inventory tracking to storeProducts
-- Adds trackInventory flag and stockQuantity column for basic stock management.
-- When trackInventory=true, checkout validates and decrements stockQuantity atomically.

ALTER TABLE `storeProducts`
  ADD COLUMN `trackInventory` BOOLEAN NOT NULL DEFAULT false AFTER `sortOrder`,
  ADD COLUMN `stockQuantity` INT DEFAULT NULL AFTER `trackInventory`;
