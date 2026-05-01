-- Webstore overlay logo background-removal: cache the Cloudinary
-- processed (transparent PNG) URL alongside the original S3 URL.
-- Lazy-populated by server/services/logo-background-removal.ts on first
-- render; original logoUrl remains the source of truth.
--
-- Both columns nullable so existing rows backfill cleanly. ALGORITHM=INSTANT
-- is safe here:
--   - both columns are nullable
--   - both append at the end of the row (clientLogos' last existing
--     column is `createdAt`)
--   - no defaults beyond NULL

ALTER TABLE `clientLogos`
  ADD COLUMN `processedLogoUrl` text NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `clientLogos`
  ADD COLUMN `processedAt` timestamp NULL,
  ALGORITHM=INSTANT;
