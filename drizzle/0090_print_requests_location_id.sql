-- 0090_print_requests_location_id.sql
-- Adds the missing locationId column on printRequests so portal-minted
-- print submissions can record which location the requester belongs to.
--
-- Context: migration 0082 introduced storeLocations and moved per-user
-- scoping from storeUsers.divisionId to storeUsers.locationId, but the
-- corresponding column on printRequests was never added. The legacy
-- printRequests.divisionId column is retained as-is for historical
-- rows; new rows written by storePortalPrint.submit now populate
-- locationId instead.
--
-- Purely additive -- nullable column with no default. Existing rows
-- retain null locationId and the legacy divisionId column is untouched.

ALTER TABLE `printRequests`
  ADD COLUMN `locationId` INT NULL DEFAULT NULL,
  ADD CONSTRAINT `printRequests_locationId_fk`
    FOREIGN KEY (`locationId`) REFERENCES `storeLocations` (`id`) ON DELETE SET NULL,
  ADD INDEX `pr_location_idx` (`locationId`);
