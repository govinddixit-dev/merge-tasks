-- Phase 6: Add fulfilled status to proposals, invoices, and estimates.
-- Also adds fulfilledAt timestamp to each table for audit trail.
-- POs already have "received" status which serves the same purpose.
-- Orders already have "delivered" status.

-- 1. proposals: add "fulfilled" to proposalStatus enum
ALTER TABLE `proposals` MODIFY COLUMN `proposalStatus` ENUM(
  'draft','sent','viewed','accepted','declined','expired','fulfilled'
) NOT NULL DEFAULT 'draft';

-- 2. proposals: add fulfilledAt timestamp
ALTER TABLE `proposals`
  ADD COLUMN `fulfilledAt` TIMESTAMP NULL AFTER `proposalStatus`;

-- 3. invoices: add "fulfilled" to invStatus enum
ALTER TABLE `invoices` MODIFY COLUMN `invStatus` ENUM(
  'draft','sent','paid','overdue','cancelled','void','refunded','partially_refunded','credit_issued','fulfilled'
) NOT NULL DEFAULT 'draft';

-- 4. invoices: add invFulfilledAt timestamp
ALTER TABLE `invoices`
  ADD COLUMN `invFulfilledAt` TIMESTAMP NULL AFTER `invStatus`;

-- 5. estimates: add "fulfilled" to estStatus enum
ALTER TABLE `estimates` MODIFY COLUMN `estStatus` ENUM(
  'draft','sent','accepted','declined','expired','converted','fulfilled'
) NOT NULL DEFAULT 'draft';

-- 6. estimates: add estFulfilledAt timestamp
ALTER TABLE `estimates`
  ADD COLUMN `estFulfilledAt` TIMESTAMP NULL AFTER `estStatus`;
