-- Phase 2: Add imprintZoneId to virtualProofs
-- A virtual proof is a visualization of a specific zone; the zone id is
-- more authoritative than the legacy decorationZone string (hardcoded enum).
-- Existing rows get NULL — bulkRender falls back to decorationZone for those.
--
-- ON DELETE SET NULL matches the pattern used by proposalProducts and
-- orderItems in migration 0084.

ALTER TABLE `virtualProofs`
  ADD COLUMN `imprintZoneId` INT NULL,
  ADD CONSTRAINT `vp_imprint_zone_fk` FOREIGN KEY (`imprintZoneId`) REFERENCES `productImprintZones`(`id`) ON DELETE SET NULL;
