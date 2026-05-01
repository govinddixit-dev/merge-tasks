-- Supplier Directory — auto-populated from PO creation history.
-- Tracks supplier contact info, spend, fulfillment speed, and PO counts.
-- Deduplication via UNIQUE(organizationId, normalizedName).

CREATE TABLE `suppliers` (
  `id`                  INT AUTO_INCREMENT PRIMARY KEY,
  `userId`              INT NOT NULL,
  `organizationId`      INT NULL,
  `name`                VARCHAR(255) NOT NULL,
  `normalizedName`      VARCHAR(255) NOT NULL,
  `code`                VARCHAR(64) NULL,
  `source`              VARCHAR(32) NULL
    COMMENT 'asi | promostandards | sage | manual | csv | api',
  `contactEmail`        VARCHAR(255) NULL,
  `contactPhone`        VARCHAR(64) NULL,
  `accountNumber`       VARCHAR(128) NULL,
  `website`             VARCHAR(512) NULL,
  `defaultShipTo`       ENUM('decorator','warehouse','client_direct') NULL DEFAULT 'warehouse',
  `notes`               TEXT NULL,
  `poCount`             INT NOT NULL DEFAULT 0,
  `totalSpend`          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `lastOrderDate`       TIMESTAMP NULL,
  `avgFulfillmentDays`  DECIMAL(5,1) NULL,
  `createdAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY `uq_supplier_org` (`organizationId`, `normalizedName`),
  KEY `idx_supplier_code` (`code`, `source`),
  KEY `idx_supplier_user` (`userId`),
  CONSTRAINT `fk_supplier_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`),
  CONSTRAINT `fk_supplier_orgId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
