-- Move webstore render outputs from products (per-product, single-tenant-only)
-- to storeProducts (per-binding, multi-tenant-correct).
--
-- Background: 0098 added webstoreRender* columns on products. With multiple
-- distributors who have different client logos sharing the same SanMar SKU,
-- per-product storage causes one tenant's render to overwrite the other's.
-- Per-binding storage on storeProducts is the correct grain.
--
-- Existing renders are dropped, not migrated. Of the 6 product-level renders
-- as of 2026-04-26, 2 are catalog-only test scripts (no storeProducts
-- binding) and 3 of the remaining 4 used the wrong tenant's logo (clientId=1
-- "Otentik test" logo on a clientId=6 storefront). The Step 6.5 regeneration
-- backfill re-enqueues per-binding renders post-apply through the production
-- orchestrator path.
--
-- ALGORITHM=INSTANT preferred for both sides:
--   ADD on storeProducts: 5 rows, INSTANT trivially safe (same as 0098).
--   DROP on products:     13858 rows, INSTANT supported MySQL 8.0.29+;
--                         this DB is 8.4.8. If INSTANT is rejected at apply
--                         time (rare edge cases around column ordering /
--                         row format), re-run the DROP statement with
--                         ALGORITHM=INPLACE, LOCK=NONE.
--                         Revert path: drizzle/0099_webstore_render_per_binding_revert.sql.

ALTER TABLE `storeProducts`
  ADD COLUMN `webstoreRenderedImageUrl` text NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `webstoreRenderedAt` timestamp NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `webstoreRenderDecoration` varchar(50) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `webstoreRenderStatus` ENUM('pending','rendering','complete','failed') NULL DEFAULT NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `webstoreRenderModel` varchar(64) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  DROP COLUMN `webstoreRenderedImageUrl`,
  DROP COLUMN `webstoreRenderedAt`,
  DROP COLUMN `webstoreRenderDecoration`,
  DROP COLUMN `webstoreRenderStatus`,
  DROP COLUMN `webstoreRenderModel`,
  ALGORITHM=INSTANT;
