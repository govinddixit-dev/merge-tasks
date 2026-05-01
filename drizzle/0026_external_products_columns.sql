-- Migration: Add external product integration columns to products table
-- Supports ASI ESP and PromoStandards imports.
--
-- NOTE: Every column added here is also declared in 0025_daffy_genesis.sql
-- (the drizzle-generated snapshot that runs first lexically). On a fresh-DB
-- replay the columns already exist and the raw `ALTER TABLE ADD COLUMN`
-- form would fail with "Duplicate column name". On a production DB this
-- migration was marked applied via migrate.sh's first-run tracker seeding
-- and never runs. Guard each ADD via a stored procedure so both paths work.

DROP PROCEDURE IF EXISTS `_add_products_col`;
DELIMITER $$
CREATE PROCEDURE `_add_products_col`(IN col_name VARCHAR(64), IN col_def TEXT)
BEGIN
  DECLARE has_col INT;
  SELECT COUNT(*) INTO has_col FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = col_name;
  IF has_col = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `products` ADD COLUMN `', col_name, '` ', col_def);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL `_add_products_col`('externalId', "VARCHAR(512) NULL COMMENT 'Unique ID from external source: source:supplierCode:productNumber'");
CALL `_add_products_col`('externalSource', "ENUM('asi', 'promostandards') NULL COMMENT 'Which external API this product was imported from'");
CALL `_add_products_col`('hasLiveInventory', "BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'True if PromoStandards live inventory is available'");
CALL `_add_products_col`('supplierCode', "VARCHAR(64) NULL COMMENT 'Supplier short code (e.g. SANMAR, SSACT, ALPHA)'");
CALL `_add_products_col`('productNumber', "VARCHAR(128) NULL COMMENT 'Supplier product number / style number'");
CALL `_add_products_col`('currency', "VARCHAR(8) NOT NULL DEFAULT 'USD'");
CALL `_add_products_col`('colors', "JSON NULL COMMENT 'Available color names as JSON array'");
CALL `_add_products_col`('sizes', "JSON NULL COMMENT 'Available size names as JSON array'");
CALL `_add_products_col`('minQuantity', "INT NULL COMMENT 'Minimum order quantity from supplier'");

DROP PROCEDURE `_add_products_col`;

-- Index for fast lookup by externalId (used to check if already imported).
-- Guard in case a future migration adds the same index, or this file is
-- replayed on a DB that already has it.
DROP PROCEDURE IF EXISTS `_add_products_idx`;
DELIMITER $$
CREATE PROCEDURE `_add_products_idx`()
BEGIN
  DECLARE has_idx INT;
  SELECT COUNT(*) INTO has_idx FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'products_externalId_idx';
  IF has_idx = 0 THEN
    ALTER TABLE `products` ADD INDEX `products_externalId_idx` (`externalId`);
  END IF;
END$$
DELIMITER ;

CALL `_add_products_idx`();
DROP PROCEDURE `_add_products_idx`;
