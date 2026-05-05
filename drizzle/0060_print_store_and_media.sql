-- Print Store + Media Library

CREATE TABLE `printProducts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `storeId` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `productType` ENUM('business_cards','flyers','banners','posters') NOT NULL,
  `imageUrls` JSON NOT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `divisionIds` JSON NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_print_products_store`
    FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE
);

CREATE TABLE `printProductVariants` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `printProductId` INT NOT NULL,
  `size` VARCHAR(64) NOT NULL,
  `stock` VARCHAR(128) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_print_product_variants_product`
    FOREIGN KEY (`printProductId`) REFERENCES `printProducts`(`id`) ON DELETE CASCADE
);

CREATE TABLE `printProductPricing` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `printProductVariantId` INT NOT NULL,
  `quantity` INT NOT NULL,
  `priceInCents` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_print_product_pricing_variant`
    FOREIGN KEY (`printProductVariantId`) REFERENCES `printProductVariants`(`id`) ON DELETE CASCADE
);

CREATE TABLE `printSupplierConnections` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `storeId` INT NOT NULL,
  `supplierName` VARCHAR(255) NOT NULL,
  `apiEndpoint` VARCHAR(1024) NULL,
  `apiKey` TEXT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `lastSyncedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_print_supplier_connections_store`
    FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE
);

CREATE TABLE `storeMediaFiles` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `storeId` INT NOT NULL,
  `uploadedBy` ENUM('distributor','poc') NOT NULL,
  `uploadedByUserId` INT NOT NULL,
  `fileName` VARCHAR(512) NOT NULL,
  `fileUrl` VARCHAR(2048) NOT NULL,
  `fileType` VARCHAR(128) NOT NULL,
  `fileSizeBytes` INT NOT NULL,
  `description` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_store_media_files_store`
    FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE
);
