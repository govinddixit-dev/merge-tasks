-- 0067_fix_proposalOrderItems_ppId_rename.sql
-- Production schema drift repair.
--
-- The `proposalOrderItems` table was originally created with a column named
-- `poiProdId` (INT NOT NULL, FK → proposalProducts.id). Migration
-- 0022_equal_black_panther.sql later re-emitted the table definition with
-- `poiProposalProductId`, but the rename was never applied to existing
-- environments, so the DB kept the old column name. Every router query that
-- references `proposalOrderItems.proposalProductId` (drizzle → `poiProposalProductId`)
-- fails with "Unknown column 'poiProposalProductId'" — this is what breaks
-- "Generate Estimate" and "Generate Invoice" on the distributor proposal detail
-- page.
--
-- The table has no data (0 rows) so the rename is lossless. We drop the FK
-- that references the old column name, rename the column, then re-create the
-- FK under the naming convention used by 0027_add_foreign_keys.sql
-- (`fk_proposalOrderItems_ppId`). The index
-- `proposalOrderItems_proposalProductId_idx` updates its column pointer
-- automatically in MySQL when the underlying column is renamed.
--
-- Idempotency: guarded so re-runs on environments that already have the
-- correct column name are no-ops.

SET @has_old := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'proposalOrderItems'
    AND COLUMN_NAME = 'poiProdId'
);

SET @has_new := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'proposalOrderItems'
    AND COLUMN_NAME = 'poiProposalProductId'
);

-- Only run when the old column is present and the new one is not.
SET @do_rename := IF(@has_old = 1 AND @has_new = 0, 1, 0);

-- Locate the existing FK name on the old column so we can drop it regardless
-- of which naming convention it was created under.
SET @old_fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'proposalOrderItems'
    AND COLUMN_NAME = 'poiProdId'
    AND REFERENCED_TABLE_NAME = 'proposalProducts'
  LIMIT 1
);

SET @drop_fk_sql := IF(
  @do_rename = 1 AND @old_fk IS NOT NULL,
  CONCAT('ALTER TABLE `proposalOrderItems` DROP FOREIGN KEY `', @old_fk, '`'),
  'DO 0'
);
PREPARE stmt FROM @drop_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @rename_sql := IF(
  @do_rename = 1,
  'ALTER TABLE `proposalOrderItems` CHANGE COLUMN `poiProdId` `poiProposalProductId` INT NOT NULL',
  'DO 0'
);
PREPARE stmt FROM @rename_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_fk_sql := IF(
  @do_rename = 1,
  'ALTER TABLE `proposalOrderItems` ADD CONSTRAINT `fk_proposalOrderItems_ppId` FOREIGN KEY (`poiProposalProductId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE',
  'DO 0'
);
PREPARE stmt FROM @add_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
