-- Migration: 0043_checkout_enhancements
-- Adds branch locations to stores, and PO/GL checkout fields to orders.

ALTER TABLE `stores`
  ADD COLUMN `branchLocations` JSON NULL AFTER `taxRate`,
  ADD COLUMN `allowedPaymentMethods` JSON NULL AFTER `branchLocations`;

ALTER TABLE `orders`
  ADD COLUMN `billingAddress` TEXT NULL AFTER `shippingAddress`,
  ADD COLUMN `branchLocationId` VARCHAR(64) NULL AFTER `billingAddress`,
  ADD COLUMN `glCode` VARCHAR(128) NULL AFTER `branchLocationId`,
  ADD COLUMN `branchAllocation` JSON NULL AFTER `glCode`;
