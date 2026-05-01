-- Webstore Tier 1 photorealistic render outputs from the nano-banana pipeline
-- (server/services/nano-banana.ts). The render worker writes the resulting
-- WebP URL + metadata here so the customer-facing WebstoreLogoOverlay can
-- swap from CSS overlay to the rendered photograph when status='complete'.
--
-- All columns nullable — existing rows are populated by the BullMQ render
-- worker (server/workers/webstore-render-worker.ts) and the Phase 8-lite
-- backfill (scripts/backfill-webstore-renders.ts).
--
-- Distinct from virtualProofs.proofImageUrl (proofing studio, OpenAI Images,
-- distributor-facing). Different pipeline, different audience —
-- see docs/virtual-proofing-recon.md.
--
-- ALGORITHM=INSTANT is safe for every column added here:
--   - all nullable
--   - all append at the end of the row (the previous additions in 0096
--     left webstoreImprintPlacementSource as the last placement column;
--     these append after that)
--   - no defaults beyond NULL
-- We do NOT pair INSTANT with LOCK=NONE — MySQL rejects that combo (ER 1221)
-- because INSTANT takes no lock. See 0096 for the same convention.

ALTER TABLE `products`
  ADD COLUMN `webstoreRenderedImageUrl` text NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreRenderedAt` timestamp NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreRenderDecoration` varchar(50) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreRenderStatus` ENUM('pending','rendering','complete','failed') NULL DEFAULT NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreRenderModel` varchar(64) NULL,
  ALGORITHM=INSTANT;
