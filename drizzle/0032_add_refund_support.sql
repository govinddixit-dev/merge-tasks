-- Migration 0032: Add refund support
-- Adds refund_history table and refund columns to orders, invoices, proposals

-- 1. Extend orders status enum to include refund states
ALTER TABLE `orders`
  MODIFY COLUMN `orderStatus` ENUM('pending','processing','production','shipped','delivered','cancelled','refunded','partially_refunded') NOT NULL DEFAULT 'pending';

-- 2. Add refund columns to orders
ALTER TABLE `orders`
  ADD COLUMN `refundedAmount` INT NOT NULL DEFAULT 0 COMMENT 'Total refunded in cents',
  ADD COLUMN `refundedAt` DATETIME(3) NULL,
  ADD COLUMN `stripeRefundId` VARCHAR(255) NULL;

-- 3. Add refund columns to proposals
ALTER TABLE `proposals`
  ADD COLUMN `paymentRefunded` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `refundedAmount` INT NOT NULL DEFAULT 0 COMMENT 'Total refunded in cents',
  ADD COLUMN `refundedAt` DATETIME(3) NULL,
  ADD COLUMN `stripeRefundId` VARCHAR(255) NULL,
  ADD COLUMN `stripePaymentIntentId` VARCHAR(255) NULL;

-- 4. Extend invoices status enum to include refund/credit states
ALTER TABLE `invoices`
  MODIFY COLUMN `invStatus` ENUM('draft','sent','paid','overdue','cancelled','void','refunded','partially_refunded','credit_issued') NOT NULL DEFAULT 'draft';

-- 5. Add refund columns to invoices
ALTER TABLE `invoices`
  ADD COLUMN `refundedAmount` INT NOT NULL DEFAULT 0 COMMENT 'Total refunded/credited in cents',
  ADD COLUMN `refundedAt` DATETIME(3) NULL,
  ADD COLUMN `creditNoteNumber` VARCHAR(64) NULL,
  ADD COLUMN `stripeRefundId` VARCHAR(255) NULL;

-- 6. Create refund_history table
CREATE TABLE IF NOT EXISTS `refund_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `organizationId` INT NULL,
  `entityType` ENUM('order','invoice','proposal') NOT NULL,
  `entityId` INT NOT NULL,
  `amount` INT NOT NULL COMMENT 'Refund amount in cents',
  `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `type` ENUM('full','partial') NOT NULL,
  `reason` TEXT NULL,
  `stripeRefundId` VARCHAR(255) NULL,
  `stripePaymentIntentId` VARCHAR(255) NULL,
  `status` ENUM('pending','succeeded','failed') NOT NULL DEFAULT 'pending',
  `processedBy` INT NULL COMMENT 'User ID or org ID for system-initiated',
  `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `rh_org_idx` (`organizationId`),
  INDEX `rh_entity_idx` (`entityType`, `entityId`),
  INDEX `rh_stripe_idx` (`stripeRefundId`),
  INDEX `rh_processed_idx` (`processedAt`),
  CONSTRAINT `fk_rh_org` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Create refund_requests table (POC → Distributor refund request workflow)
CREATE TABLE IF NOT EXISTS `refund_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `organizationId` INT NULL,
  `storeId` INT NOT NULL,
  `proposalId` INT NOT NULL,
  `storeUserId` INT NOT NULL COMMENT 'The POC who requested the refund',
  `distributorUserId` INT NOT NULL COMMENT 'The distributor who owns the proposal',
  `reason` TEXT NOT NULL,
  `status` ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `responseNote` TEXT NULL COMMENT 'Distributor note when approving/denying',
  `respondedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `rr_org_idx` (`organizationId`),
  INDEX `rr_store_idx` (`storeId`),
  INDEX `rr_proposal_idx` (`proposalId`),
  INDEX `rr_distributor_idx` (`distributorUserId`),
  INDEX `rr_status_idx` (`status`),
  CONSTRAINT `fk_rr_store` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rr_proposal` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rr_store_user` FOREIGN KEY (`storeUserId`) REFERENCES `storeUsers`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rr_distributor` FOREIGN KEY (`distributorUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
