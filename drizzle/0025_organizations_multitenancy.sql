-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0025: Organizations / Multi-Tenancy (idempotent version)
--
-- Adds:
--   1. `organizations` table — one row per distributor account
--   2. `orgMembers` table — maps users to organizations with roles
--   3. `organizationId` column to all 18 data tables
--   4. Indexes on organizationId for query performance
--
-- Strategy:
--   - Every existing user gets their own organization (1:1 migration)
--   - Their existing data rows get organizationId = their new org id
--   - This is a non-breaking migration: userId columns are preserved
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Create organizations table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `organizations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(100) NOT NULL,
  `ownerId` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `organizations_slug_unique` (`slug`),
  KEY `organizations_ownerId_idx` (`ownerId`)
);

-- ── 2. Create orgMembers table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `orgMembers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `organizationId` INT NOT NULL,
  `userId` INT NOT NULL,
  `role` ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member',
  `invitedByUserId` INT,
  `inviteEmail` VARCHAR(255),
  `inviteToken` VARCHAR(255),
  `inviteAcceptedAt` TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orgMembers_org_user_unique` (`organizationId`, `userId`),
  KEY `orgMembers_organizationId_idx` (`organizationId`),
  KEY `orgMembers_userId_idx` (`userId`),
  KEY `orgMembers_inviteToken_idx` (`inviteToken`)
);

-- ── 3. Create one organization per existing user (skip if already done) ───────
INSERT IGNORE INTO `organizations` (`name`, `slug`, `ownerId`, `createdAt`)
SELECT
  COALESCE(name, email, CONCAT('org-', id)),
  CONCAT('org-', id),
  id,
  createdAt
FROM `users`;

-- ── 4. Add each user as owner of their own organization (skip if already done)─
--
-- The column name is `orgRole` (not `role`). `0025_daffy_genesis.sql` runs
-- first and creates `orgMembers` with the MySQL column `orgRole`; the ORM
-- schema (drizzle/schema.ts) aliases that to the JS property `role`. The
-- INSERT below was originally written against the JS name, which breaks at
-- the SQL layer. Use the real column name. On a fresh DB there are no
-- organizations rows yet, so the INSERT is a no-op; on a legacy DB this was
-- already applied once and INSERT IGNORE makes a re-run safe.
INSERT IGNORE INTO `orgMembers` (`organizationId`, `userId`, `orgRole`)
SELECT o.id, o.ownerId, 'owner'
FROM `organizations` o;

-- ── 5. Add organizationId column + index to all data tables ──────────────────
--
-- The drizzle-generated 0026_dashing_lady_deathstrike.sql also adds
-- `organizationId` to the same set of tables. On a fresh DB 0025 runs first
-- and 0026 then errors with "Duplicate column name 'organizationId'"; on a
-- legacy prod DB 0025 was already applied and re-running it would error
-- similarly. Guard both the ADD COLUMN and the ADD KEY via a stored
-- procedure so each is a true upsert.

DROP PROCEDURE IF EXISTS `_add_org_col`;
DELIMITER $$
CREATE PROCEDURE `_add_org_col`(IN tbl VARCHAR(64))
BEGIN
  DECLARE has_col INT;
  DECLARE has_idx INT;
  SELECT COUNT(*) INTO has_col FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = tbl
      AND column_name = 'organizationId';
  IF has_col = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `organizationId` INT');
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
  SELECT COUNT(*) INTO has_idx FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = tbl
      AND index_name = CONCAT(tbl, '_organizationId_idx');
  IF has_idx = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `', tbl, '` ADD KEY `', tbl, '_organizationId_idx` (`organizationId`)');
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL `_add_org_col`('clients');
CALL `_add_org_col`('products');
CALL `_add_org_col`('apiConnections');
CALL `_add_org_col`('stores');
CALL `_add_org_col`('proposals');
CALL `_add_org_col`('orders');
CALL `_add_org_col`('virtualProofs');
CALL `_add_org_col`('clientLogos');
CALL `_add_org_col`('emailConnections');
CALL `_add_org_col`('distributorProfiles');
CALL `_add_org_col`('clientAssets');
CALL `_add_org_col`('aiEditFeedback');
CALL `_add_org_col`('copilot_conversations');
CALL `_add_org_col`('copilot_memory');
CALL `_add_org_col`('copilot_task_log');
CALL `_add_org_col`('printRequests');
CALL `_add_org_col`('estimates');
CALL `_add_org_col`('invoices');

DROP PROCEDURE `_add_org_col`;

-- ── 6. Backfill organizationId from userId on all data tables ─────────────────
-- Each row gets the organizationId of the organization owned by its userId.
--
-- These backfills were written assuming every per-tenant table had a uniform
-- `userId` column. In practice several tables use per-table-prefixed names
-- (e.g. `estimates.estUserId`, created by 0022_equal_black_panther.sql) and
-- a fresh-DB replay of this migration errors with "Unknown column ... in 'on
-- clause'". On a production DB the data has long since been backfilled, so
-- re-running these UPDATEs would be a no-op anyway. Guard each one so it is
-- skipped when either the target table or its `userId` column is absent.
-- Same dynamic-SQL pattern as the orgRole→role rename above.

DROP PROCEDURE IF EXISTS `_backfill_org_id`;
DELIMITER $$
CREATE PROCEDURE `_backfill_org_id`(IN tbl VARCHAR(64), IN alias VARCHAR(16))
BEGIN
  DECLARE has_col INT;
  SELECT COUNT(*) INTO has_col FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = tbl
      AND column_name = 'userId';
  IF has_col > 0 THEN
    SET @sql := CONCAT(
      'UPDATE `', tbl, '` ', alias, ' ',
      'JOIN `organizations` o ON o.ownerId = ', alias, '.userId ',
      'SET ', alias, '.organizationId = o.id ',
      'WHERE ', alias, '.organizationId IS NULL'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL `_backfill_org_id`('clients', 'c');
CALL `_backfill_org_id`('products', 'p');
CALL `_backfill_org_id`('apiConnections', 'a');
CALL `_backfill_org_id`('stores', 's');
CALL `_backfill_org_id`('proposals', 'p');
CALL `_backfill_org_id`('orders', 'ord');
CALL `_backfill_org_id`('virtualProofs', 'vp');
CALL `_backfill_org_id`('clientLogos', 'cl');
CALL `_backfill_org_id`('emailConnections', 'ec');
CALL `_backfill_org_id`('distributorProfiles', 'dp');
CALL `_backfill_org_id`('clientAssets', 'ca');
CALL `_backfill_org_id`('aiEditFeedback', 'aef');
CALL `_backfill_org_id`('copilot_conversations', 'cc');
CALL `_backfill_org_id`('copilot_memory', 'cm');
CALL `_backfill_org_id`('copilot_task_log', 'ctl');
CALL `_backfill_org_id`('printRequests', 'pr');
CALL `_backfill_org_id`('estimates', 'e');
CALL `_backfill_org_id`('invoices', 'i');

DROP PROCEDURE `_backfill_org_id`;
