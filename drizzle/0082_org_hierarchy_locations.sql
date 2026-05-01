-- Phase 1.5: Organization Hierarchy Consolidation
-- Replaces the fragmented org hierarchy (divisions in 2 representations,
-- POC in 4 places, free-text department heads) with a clean location model.
--
-- Changes in this migration:
--   1. DROP divisions table (0 rows — test data only)
--   2. DROP stores.divisions JSON column (0 rows — test data only)
--   3. CREATE storeLocations — new location table scoped per store
--   4. CREATE locationBrandingAssets — per-location branding overrides
--   5. ALTER stores — add multiLocationEnabled toggle
--   6. ALTER storeUsers — drop divisionId, add locationId, add poc role, add roleInDepartment
--   7. ALTER clients — add pocEmail, add pocStoreUserId
--   8. ALTER storeDepartments — drop divisionId, add locationId, add departmentHeadId
--   9. ALTER storeIdentityProviders — rename groupToDivisionMap → groupToLocationMap
--  10. ALTER customOrderRequests — add assignedPocId
--  11. ALTER orders — add glCode
--
-- What is NOT touched:
--   - departmentApprovals free-text fields — historical records preserved
--   - printRequests.requestedBy email string — out of scope
--   - storeUsers existing role values — enum extended, not changed
--   - All existing FK relationships — preserved except divisionId drops

-- Drop FK constraints referencing divisions before dropping the table
ALTER TABLE `printRequests` DROP FOREIGN KEY `fk_print_requests_division`;
ALTER TABLE `storeDepartments` DROP FOREIGN KEY `storeDepartments_divisionId_fk`;
ALTER TABLE `storeUsers` DROP FOREIGN KEY `storeUsers_divisionId_fk`;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DROP divisions table
--    Zero rows confirmed. Dead code — replaced by storeLocations.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS `divisions`;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DROP stores.divisions JSON column
--    Zero data confirmed. Replaced by storeLocations table.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `stores` DROP COLUMN `divisions`;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CREATE storeLocations
--    Location tabs per store (Ontario, Quebec, Michigan etc.)
--    Scoped per store. multiLocationEnabled toggle on stores controls
--    whether tabs render in the webstore UI.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `storeLocations` (
  `id`        INT           NOT NULL AUTO_INCREMENT,
  `storeId`   INT           NOT NULL,
  `name`      VARCHAR(255)  NOT NULL,
  `slug`      VARCHAR(128)  NOT NULL,
  `isActive`  BOOLEAN       NOT NULL DEFAULT TRUE,
  `sortOrder` INT           NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `sl_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `sl_store_slug_unique` (`storeId`, `slug`),
  INDEX `sl_store_idx` (`storeId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CREATE locationBrandingAssets
--    Per-location branding overrides. All fields nullable — null means
--    fall back to store-level branding. One record per location.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `locationBrandingAssets` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `locationId`     INT           NOT NULL,
  `logoUrl`        VARCHAR(1024) NULL,
  `primaryColor`   VARCHAR(32)   NULL,
  `bannerUrl`      VARCHAR(1024) NULL,
  `bannerText`     VARCHAR(512)  NULL,
  `welcomeMessage` TEXT          NULL,
  `aiTagline`      VARCHAR(255)  NULL,
  `createdAt`      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `lba_location_fk` FOREIGN KEY (`locationId`) REFERENCES `storeLocations`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `lba_location_unique` (`locationId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ALTER stores — add multiLocationEnabled
--    Controls whether location tabs render in the webstore UI.
--    Default false — existing stores unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `stores`
  ADD COLUMN `multiLocationEnabled` BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ALTER storeUsers
--    - Drop divisionId (replaced by locationId)
--    - Add locationId FK → storeLocations.id
--    - Add poc to role enum
--    - Add roleInDepartment enum
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `storeUsers`
  DROP COLUMN `divisionId`,
  ADD COLUMN `locationId` INT NULL AFTER `ssoSubject`,
  ADD COLUMN `roleInDepartment` ENUM('member', 'head') NOT NULL DEFAULT 'member' AFTER `locationId`,
  MODIFY COLUMN `storeUserRole` ENUM('poc', 'admin', 'manager', 'employee', 'intern') NOT NULL DEFAULT 'employee',
  ADD CONSTRAINT `su_location_fk` FOREIGN KEY (`locationId`) REFERENCES `storeLocations`(`id`) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ALTER clients
--    - Add pocEmail — source of truth for POC identity before store user exists
--    - Add pocStoreUserId — populated when POC first logs in, updated on succession
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `clients`
  ADD COLUMN `pocEmail` VARCHAR(320) NULL,
  ADD COLUMN `pocStoreUserId` INT NULL,
  ADD CONSTRAINT `c_poc_store_user_fk` FOREIGN KEY (`pocStoreUserId`) REFERENCES `storeUsers`(`id`) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ALTER storeDepartments
--    - Drop divisionId (replaced by locationId)
--    - Add locationId FK → storeLocations.id
--    - Add departmentHeadId FK → storeUsers.id (one head per department)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `storeDepartments`
  DROP COLUMN `divisionId`,
  ADD COLUMN `locationId` INT NULL,
  ADD COLUMN `departmentHeadId` INT NULL,
  ADD CONSTRAINT `sd_location_fk` FOREIGN KEY (`locationId`) REFERENCES `storeLocations`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `sd_dept_head_fk` FOREIGN KEY (`departmentHeadId`) REFERENCES `storeUsers`(`id`) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ALTER storeIdentityProviders
--    Rename groupToDivisionMap → groupToLocationMap
--    Same JSON shape { [groupOrAttr: string]: locationId }
--    Logic in resolveLocationFromSso() preserved — rename only.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `storeIdentityProviders`
  CHANGE COLUMN `groupToDivisionMap` `groupToLocationMap` JSON NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. ALTER customOrderRequests
--     Add assignedPocId — routes request to designated POC on submission.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `customOrderRequests`
  ADD COLUMN `assignedPocId` INT NULL,
  ADD CONSTRAINT `cor_poc_fk` FOREIGN KEY (`assignedPocId`) REFERENCES `storeUsers`(`id`) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. ALTER orders
--     Add glCode — GL code stamped at checkout by department head or POC.
--     Metadata only — not a real-time accounting integration.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `orders`
  ADD COLUMN `glCode` VARCHAR(128) NULL;
