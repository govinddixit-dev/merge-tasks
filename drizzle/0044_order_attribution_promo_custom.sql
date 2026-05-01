-- Migration: 0044_order_attribution_promo_custom
-- Adds storeUserId + promo code fields to orders, customOrderRequests table, promoCodes + promoCodeUsages tables

-- Order Attribution: storeUserId on orders
ALTER TABLE `orders`
  ADD COLUMN `storeUserId` INT NULL AFTER `storeId`,
  ADD INDEX `orders_storeUserId_idx` (`storeUserId`);

-- Promo Code fields on orders
ALTER TABLE `orders`
  ADD COLUMN `promoCodeId` INT NULL AFTER `stripeRefundId`,
  ADD COLUMN `discountAmount` DECIMAL(10,2) NULL DEFAULT '0.00' AFTER `promoCodeId`;

-- Custom Order Requests
CREATE TABLE `customOrderRequests` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `storeId` INT NOT NULL,
  `storeUserId` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `quantity` INT NULL,
  `targetDate` TIMESTAMP NULL,
  `attachmentUrls` JSON NULL,
  `status` ENUM('pending','reviewed','approved','declined','fulfilled') NOT NULL DEFAULT 'pending',
  `pocNotes` TEXT NULL,
  `reviewedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `customOrderRequests_storeId_idx` (`storeId`),
  INDEX `customOrderRequests_storeUserId_idx` (`storeUserId`),
  INDEX `customOrderRequests_status_idx` (`status`),
  FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`),
  FOREIGN KEY (`storeUserId`) REFERENCES `storeUsers`(`id`)
);

-- Promo Codes
CREATE TABLE `promoCodes` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `storeId` INT NOT NULL,
  `organizationId` INT NULL,
  `code` VARCHAR(64) NOT NULL,
  `description` VARCHAR(255) NULL,
  `discountType` ENUM('percentage','fixed_amount') NOT NULL,
  `discountValue` DECIMAL(10,2) NOT NULL,
  `minOrderAmount` DECIMAL(10,2) NULL,
  `maxDiscountAmount` DECIMAL(10,2) NULL,
  `maxUses` INT NULL,
  `usedCount` INT NOT NULL DEFAULT 0,
  `maxUsesPerUser` INT DEFAULT 1,
  `startsAt` TIMESTAMP NULL,
  `expiresAt` TIMESTAMP NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `promoCodes_storeCode_idx` (`storeId`, `code`),
  INDEX `promoCodes_orgId_idx` (`organizationId`),
  FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`),
  FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`)
);

-- Promo Code Usages (per-user tracking)
CREATE TABLE `promoCodeUsages` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `promoCodeId` INT NOT NULL,
  `storeUserId` INT NOT NULL,
  `orderId` INT NOT NULL,
  `discountApplied` DECIMAL(10,2) NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `promoCodeUsages_promoUser_idx` (`promoCodeId`, `storeUserId`),
  FOREIGN KEY (`promoCodeId`) REFERENCES `promoCodes`(`id`),
  FOREIGN KEY (`storeUserId`) REFERENCES `storeUsers`(`id`),
  FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`)
);
