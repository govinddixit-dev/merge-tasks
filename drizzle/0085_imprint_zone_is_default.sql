-- Phase 2: Add isDefault to productImprintZones
-- Tracks which zone is the default for a product at the master level.
-- Per-client default lives on clientProductConfig.defaultImprintZoneId (Phase 4).

ALTER TABLE `productImprintZones`
  ADD COLUMN `isDefault` BOOLEAN NOT NULL DEFAULT FALSE;
