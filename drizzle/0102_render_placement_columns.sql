-- Phase 7+ — Visual Placement Editor.
--
-- Adds five nullable placement columns to `storeProducts` so distributors can
-- pin a precise per-binding logo position via the drag/resize/rotate editor.
-- All NULL means "no manual placement" — re-renders fall back to the AI
-- placement (products.webstoreImprintPlacement*) as before.
--
-- Coordinates are percentages (0-100) of the product image dimensions, so
-- they remain resolution-independent across re-renders and CDN sizings.
-- Rotation is in degrees with default 0 to keep math simple when only X/Y/W/H
-- are written.
--
-- Grandfathering: no data migration needed. Existing rows have NULL for all
-- five columns; orchestrator treats NULL as "no override" and continues with
-- the prior AI-derived placement. New rows from savePlacement begin to use
-- the manual coords.
--
-- ALGORITHM=INSTANT: nullable column adds on a small table, trivially safe
-- on MySQL 8.4.8.
--
-- Revert: drop the five columns. orchestrator/buildPrompt continue to work
-- against AI-only placement; the editor UI breaks until UI is also reverted.

ALTER TABLE `storeProducts`
  ADD COLUMN `renderPlacementX` decimal(5,2) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `renderPlacementY` decimal(5,2) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `renderPlacementWidth` decimal(5,2) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `renderPlacementHeight` decimal(5,2) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `renderPlacementRotation` decimal(5,2) NULL DEFAULT 0,
  ALGORITHM=INSTANT;
