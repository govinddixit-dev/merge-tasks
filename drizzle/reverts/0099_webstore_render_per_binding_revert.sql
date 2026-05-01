-- Revert 0099 — restore webstoreRender* columns on products and drop them
-- from storeProducts. ONLY for emergency rollback after 0099 applied but
-- the corresponding code reload failed catastrophically.
--
-- All renders are lost in either direction (0099 forward drops products
-- renders unconditionally; this revert drops the storeProducts renders
-- that may have been written between the two events). Acceptable: the
-- regeneration backfill is cheap and idempotent.
--
-- LIVES IN drizzle/reverts/, NOT drizzle/. This is intentional:
-- scripts/migrate.sh globs `drizzle/*.sql` non-recursively and would
-- otherwise apply this file in alphabetical order right after the
-- forward migration, immediately reverting the change. (This actually
-- happened on the first 0099 apply attempt on 2026-04-27 — caught by
-- post-apply verification before any user-facing impact.)
--
-- To apply this revert: invoke directly via the mysql CLI with the
-- production credentials, then DELETE the 0099 row from
-- _schema_migrations so a future migrate.sh run does not skip the
-- forward migration on a re-attempted deploy.

ALTER TABLE `products`
  ADD COLUMN `webstoreRenderedImageUrl` text NULL,
  ADD COLUMN `webstoreRenderedAt` timestamp NULL,
  ADD COLUMN `webstoreRenderDecoration` varchar(50) NULL,
  ADD COLUMN `webstoreRenderStatus` ENUM('pending','rendering','complete','failed') NULL DEFAULT NULL,
  ADD COLUMN `webstoreRenderModel` varchar(64) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  DROP COLUMN `webstoreRenderedImageUrl`,
  DROP COLUMN `webstoreRenderedAt`,
  DROP COLUMN `webstoreRenderDecoration`,
  DROP COLUMN `webstoreRenderStatus`,
  DROP COLUMN `webstoreRenderModel`,
  ALGORITHM=INSTANT;
