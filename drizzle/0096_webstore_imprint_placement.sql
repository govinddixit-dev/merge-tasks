-- Webstore Tier 1 logo placement: per-product cached coordinates from
-- Claude vision analysis (server/services/webstore-imprint-placement.ts).
-- All columns nullable — existing rows are backfilled by
-- scripts/backfill-webstore-imprint-placements.ts. Distinct from
-- virtualProofs.placementData (proofing studio, server-rendered raster) —
-- see docs/virtual-proofing-recon.md.
--
-- Each ADD COLUMN carries an explicit ALGORITHM=INSTANT so MySQL fails
-- loudly (instead of silently downgrading to ALGORITHM=COPY, which
-- rewrites the table) if a future row-format change ever makes one of
-- these non-instant. We do NOT pair INSTANT with LOCK=NONE: MySQL
-- rejects that combination with ER 1221 because INSTANT operations
-- take no lock at all (LOCK= is meaningful only for COPY / INPLACE).
--
-- INSTANT requires:
--   - column added at end of row (true: products' last existing column
--     is `status`; these all append after it)
--   - column nullable (true: every column is NULL)
--   - default is NULL or constant literal (true: only `…Source` has a
--     default, and it's a constant string 'ai')
-- See https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementX` DECIMAL(5,4) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementY` DECIMAL(5,4) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementWidth` DECIMAL(5,4) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementHeight` DECIMAL(5,4) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementZone` VARCHAR(50) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementBlendMode` VARCHAR(20) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementConfidence` DECIMAL(3,2) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementAnalyzedAt` TIMESTAMP NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `products`
  ADD COLUMN `webstoreImprintPlacementSource` ENUM('ai','distributor_override') NULL DEFAULT 'ai',
  ALGORITHM=INSTANT;

-- Online (INPLACE) index build on a single nullable column. We use the
-- ALTER TABLE … ADD INDEX form because the equivalent CREATE INDEX with
-- trailing ALGORITHM/LOCK clauses is rejected with ER 1064 by this DB
-- build (Aurora MySQL accepts the clauses on ALTER TABLE only). Both
-- forms land the same physical index; ALTER TABLE is the portable choice.
-- LOCK=NONE keeps reads + writes flowing during the build.
ALTER TABLE `products`
  ADD INDEX `products_webstore_placement_pending_idx` (`webstoreImprintPlacementAnalyzedAt`),
  ALGORITHM=INPLACE, LOCK=NONE;
