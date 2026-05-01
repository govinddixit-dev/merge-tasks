-- Purchase Orders system: supplier-facing POs generated from client orders
-- POs use cost prices (products.basePrice), NEVER sell prices (orderItems.unitPrice)

CREATE TABLE `purchaseOrders` (
  `id`                    INT AUTO_INCREMENT PRIMARY KEY,
  `userId`                INT NOT NULL,
  `organizationId`        INT NULL,
  `orderId`               INT NOT NULL,
  `supplierName`          VARCHAR(255) NOT NULL,
  `supplierCode`          VARCHAR(64) NULL,
  `supplierSource`        VARCHAR(32) NULL
    COMMENT 'asi | promostandards | sage | manual | csv | api | NULL',
  `supplierContactEmail`  VARCHAR(255) NULL,
  `supplierContactPhone`  VARCHAR(64) NULL,
  `supplierAccountNumber` VARCHAR(128) NULL,
  `poNumber`              VARCHAR(32) NOT NULL,
  -- Column name is `poStatus` (not `status`) to match drizzle/schema.ts where
  -- the field is declared `status: mysqlEnum("poStatus", [...])`. Later
  -- migrations (0062, 0063) MODIFY this column by name; a fresh replay that
  -- created it as `status` would diverge from production, where the column
  -- has always been `poStatus`. Edit is safe because migrate.sh tracks
  -- applied files per DB and never re-runs an applied migration.
  `poStatus`              ENUM(
    'draft','sent','acknowledged','in_production',
    'shipped','received','cancelled','partial'
  ) NOT NULL DEFAULT 'draft',
  `lineItems`             JSON NOT NULL
    COMMENT 'Array<POLineItem>',
  `subtotal`              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `shipping`              DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `tax`                   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `total`                 DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `shipToName`            VARCHAR(255) NULL,
  `shipToAddress`         TEXT NULL,
  `shipToType`            ENUM('decorator','warehouse','client_direct')
    NULL DEFAULT 'warehouse',
  `decorationInstructions` TEXT NULL,
  `requestedShipDate`     DATE NULL,
  `expectedDeliveryDate`  DATE NULL,
  `actualShipDate`        DATE NULL,
  `trackingNumbers`       JSON NULL
    COMMENT 'Array<string>',
  `internalNotes`         TEXT NULL,
  `supplierNotes`         TEXT NULL,
  `aiGroupingConfidence`  DECIMAL(5,2) NULL,
  `aiGroupingReason`      TEXT NULL,
  `sentAt`                TIMESTAMP NULL,
  `acknowledgedAt`        TIMESTAMP NULL,
  `createdAt`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY `uq_poNumber` (`poNumber`),
  KEY `idx_po_orderId` (`orderId`),
  KEY `idx_po_orgId` (`organizationId`),
  KEY `idx_po_status` (`poStatus`),
  KEY `idx_po_supplier` (`supplierCode`, `supplierSource`),
  CONSTRAINT `fk_po_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`),
  CONSTRAINT `fk_po_orgId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`),
  CONSTRAINT `fk_po_orderId` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `purchaseOrderEvents` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `purchaseOrderId` INT NOT NULL,
  `eventType`       ENUM(
    'created','sent','acknowledged','status_changed',
    'tracking_added','note_added','cancelled','received'
  ) NOT NULL,
  `description`     TEXT NULL,
  `userId`          INT NOT NULL,
  `metadata`        JSON NULL,
  `createdAt`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY `idx_poe_poId` (`purchaseOrderId`),
  CONSTRAINT `fk_poe_poId`
    FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchaseOrders`(`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_poe_userId`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
