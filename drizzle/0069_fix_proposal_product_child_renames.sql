-- 0069_fix_proposal_product_child_renames.sql
-- Test/dev schema drift repair — align four proposalProduct child tables
-- with the production column naming.
--
-- Production DB columns are the short forms (ppvProdId, pptProdId,
-- ppiProdId, pscProdId). Some test/dev environments were created from a
-- migration path that left the long forms in place
-- (ppvProposalProductId, pptProposalProductId, ppiProposalProductId,
-- pscProposalProductId), so drizzle queries issued by the server —
-- which now target the short forms to match prod — fail with
-- "Unknown column" in CI.
--
-- This migration renames long → short in any environment where the
-- long form still exists, drops and re-creates the FK to
-- proposalProducts.id so constraint names stay discoverable, and is a
-- no-op on environments already on the short form (production).

-- ─── helper that renames one table's column if the long form is present ──
-- Each block is self-contained so a partial prior run does not block
-- later blocks. All SQL is prepared-statement driven to stay inert
-- when the guard evaluates false.

-- ============================================================
-- 1. proposalProductVariants: ppvProposalProductId → ppvProdId
-- ============================================================
SET @has_old := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalProductVariants' AND COLUMN_NAME = 'ppvProposalProductId');
SET @has_new := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalProductVariants' AND COLUMN_NAME = 'ppvProdId');
SET @do_rename := IF(@has_old = 1 AND @has_new = 0, 1, 0);

SET @old_fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalProductVariants'
    AND COLUMN_NAME = 'ppvProposalProductId' AND REFERENCED_TABLE_NAME = 'proposalProducts' LIMIT 1);
SET @drop_fk_sql := IF(@do_rename = 1 AND @old_fk IS NOT NULL,
  CONCAT('ALTER TABLE `proposalProductVariants` DROP FOREIGN KEY `', @old_fk, '`'), 'DO 0');
PREPARE stmt FROM @drop_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @rename_sql := IF(@do_rename = 1,
  'ALTER TABLE `proposalProductVariants` CHANGE COLUMN `ppvProposalProductId` `ppvProdId` INT NOT NULL', 'DO 0');
PREPARE stmt FROM @rename_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_fk_sql := IF(@do_rename = 1,
  'ALTER TABLE `proposalProductVariants` ADD CONSTRAINT `fk_proposalProductVariants_ppId` FOREIGN KEY (`ppvProdId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE', 'DO 0');
PREPARE stmt FROM @add_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 2. proposalPriceTiers: pptProposalProductId → pptProdId
-- ============================================================
SET @has_old := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalPriceTiers' AND COLUMN_NAME = 'pptProposalProductId');
SET @has_new := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalPriceTiers' AND COLUMN_NAME = 'pptProdId');
SET @do_rename := IF(@has_old = 1 AND @has_new = 0, 1, 0);

SET @old_fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalPriceTiers'
    AND COLUMN_NAME = 'pptProposalProductId' AND REFERENCED_TABLE_NAME = 'proposalProducts' LIMIT 1);
SET @drop_fk_sql := IF(@do_rename = 1 AND @old_fk IS NOT NULL,
  CONCAT('ALTER TABLE `proposalPriceTiers` DROP FOREIGN KEY `', @old_fk, '`'), 'DO 0');
PREPARE stmt FROM @drop_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @rename_sql := IF(@do_rename = 1,
  'ALTER TABLE `proposalPriceTiers` CHANGE COLUMN `pptProposalProductId` `pptProdId` INT NOT NULL', 'DO 0');
PREPARE stmt FROM @rename_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_fk_sql := IF(@do_rename = 1,
  'ALTER TABLE `proposalPriceTiers` ADD CONSTRAINT `fk_proposalPriceTiers_ppId` FOREIGN KEY (`pptProdId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE', 'DO 0');
PREPARE stmt FROM @add_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 3. proposalProductImages: ppiProposalProductId → ppiProdId
-- ============================================================
SET @has_old := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalProductImages' AND COLUMN_NAME = 'ppiProposalProductId');
SET @has_new := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalProductImages' AND COLUMN_NAME = 'ppiProdId');
SET @do_rename := IF(@has_old = 1 AND @has_new = 0, 1, 0);

SET @old_fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalProductImages'
    AND COLUMN_NAME = 'ppiProposalProductId' AND REFERENCED_TABLE_NAME = 'proposalProducts' LIMIT 1);
SET @drop_fk_sql := IF(@do_rename = 1 AND @old_fk IS NOT NULL,
  CONCAT('ALTER TABLE `proposalProductImages` DROP FOREIGN KEY `', @old_fk, '`'), 'DO 0');
PREPARE stmt FROM @drop_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @rename_sql := IF(@do_rename = 1,
  'ALTER TABLE `proposalProductImages` CHANGE COLUMN `ppiProposalProductId` `ppiProdId` INT NOT NULL', 'DO 0');
PREPARE stmt FROM @rename_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_fk_sql := IF(@do_rename = 1,
  'ALTER TABLE `proposalProductImages` ADD CONSTRAINT `fk_proposalProductImages_ppId` FOREIGN KEY (`ppiProdId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE', 'DO 0');
PREPARE stmt FROM @add_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 4. proposalSizeCharts: pscProposalProductId → pscProdId
-- ============================================================
SET @has_old := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalSizeCharts' AND COLUMN_NAME = 'pscProposalProductId');
SET @has_new := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalSizeCharts' AND COLUMN_NAME = 'pscProdId');
SET @do_rename := IF(@has_old = 1 AND @has_new = 0, 1, 0);

SET @old_fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposalSizeCharts'
    AND COLUMN_NAME = 'pscProposalProductId' AND REFERENCED_TABLE_NAME = 'proposalProducts' LIMIT 1);
SET @drop_fk_sql := IF(@do_rename = 1 AND @old_fk IS NOT NULL,
  CONCAT('ALTER TABLE `proposalSizeCharts` DROP FOREIGN KEY `', @old_fk, '`'), 'DO 0');
PREPARE stmt FROM @drop_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @rename_sql := IF(@do_rename = 1,
  'ALTER TABLE `proposalSizeCharts` CHANGE COLUMN `pscProposalProductId` `pscProdId` INT NOT NULL', 'DO 0');
PREPARE stmt FROM @rename_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_fk_sql := IF(@do_rename = 1,
  'ALTER TABLE `proposalSizeCharts` ADD CONSTRAINT `fk_proposalSizeCharts_ppId` FOREIGN KEY (`pscProdId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE', 'DO 0');
PREPARE stmt FROM @add_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
