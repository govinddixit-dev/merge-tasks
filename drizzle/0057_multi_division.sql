-- 0057_multi_division.sql
-- Wires multi-division into catalog filtering and SSO routing.
--
-- - storeProducts.divisionIds: JSON array of division IDs the product is
--   restricted to. NULL or [] = shared (visible to every division).
-- - storeUsers.divisionId: nullable FK resolved at SSO login time from
--   SSO group/email mapping. NULL on legacy (non-divisioned) stores.
-- - storeIdentityProviders.groupToDivisionMap: JSON map of SSO group or
--   email attribute → divisionId, used by the resolver to assign division.
-- - storeDepartmentBudgets.warnThresholdPct: soft threshold (default 80)
--   at which the storefront surfaces a "nearing limit" warning.
--
-- Zero-regression: every added column is NULL-able or defaulted.

ALTER TABLE `storeProducts`
  ADD COLUMN `divisionIds` JSON NULL;

ALTER TABLE `storeUsers`
  ADD COLUMN `divisionId` int DEFAULT NULL,
  ADD KEY `storeUsers_divisionId_idx` (`divisionId`),
  ADD CONSTRAINT `storeUsers_divisionId_fk` FOREIGN KEY (`divisionId`)
    REFERENCES `divisions` (`id`) ON DELETE SET NULL;

ALTER TABLE `storeIdentityProviders`
  ADD COLUMN `groupToDivisionMap` JSON NULL;

ALTER TABLE `storeDepartments`
  ADD COLUMN `warnThresholdPct` int NOT NULL DEFAULT 80;
