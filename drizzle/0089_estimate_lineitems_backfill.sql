-- 0089_estimate_lineitems_backfill.sql
-- Lossless backfill of legacy JSON estimates.estLineItems into the
-- relational estimateLineItems + estimatePackages tables.
--
-- Two concerns:
--
--   1. Extend estimateLineItems with nullable color, size, imageUrl, sku
--      snapshot columns. The legacy JSON carried these fields; the
--      relational form didn't, so a blind backfill would drop them.
--      Adding them here makes the backfill lossless and matches what
--      createFromProposal (rewritten in the same PR) now writes.
--
--   2. Backfill: for every estimate with a non-null estLineItems JSON
--      value and no existing estimatePackages row, mint one "Default"
--      package and N estimateLineItems rows (one per JSON array
--      element). JSON_TABLE ordinality is mapped to eliSortOrder so
--      the list order survives.
--
-- The estLineItems JSON column is intentionally NOT dropped in this
-- migration -- it is retained as a rollback escape hatch for this
-- release cycle. A follow-up migration will drop it once the new
-- write path has soaked.

-- == 1. Additive columns on estimateLineItems ========================
-- All nullable -- builder rows created before this migration stay valid
-- and every future insert goes through the rewritten handler which
-- populates these from the proposal order items / product snapshot.

ALTER TABLE `estimateLineItems`
  ADD COLUMN `eliColor`    VARCHAR(128)  NULL DEFAULT NULL,
  ADD COLUMN `eliSize`     VARCHAR(128)  NULL DEFAULT NULL,
  ADD COLUMN `eliImageUrl` VARCHAR(1024) NULL DEFAULT NULL,
  ADD COLUMN `eliSku`      VARCHAR(128)  NULL DEFAULT NULL;

-- == 2a. Mint one "Default" package per legacy estimate ==============
-- NOT EXISTS guard makes the migration re-runnable: an estimate that
-- already has any package (including one from a previous partial run
-- of this migration, or from builderSave) is left alone.

INSERT INTO `estimatePackages` (`epEstimateId`, `epName`, `epSortOrder`)
SELECT e.`id`, 'Default', 0
FROM `estimates` e
WHERE e.`estLineItems` IS NOT NULL
  AND JSON_LENGTH(e.`estLineItems`) > 0
  AND NOT EXISTS (
    SELECT 1 FROM `estimatePackages` ep
    WHERE ep.`epEstimateId` = e.`id`
  );

-- == 2b. Expand the JSON array into estimateLineItems rows ===========
-- JSON_TABLE unpacks each element of the array into a row; FOR
-- ORDINALITY gives us a 1-based index which we drop to 0-based
-- eliSortOrder so the list order is preserved.
--
-- Fields:
--   eliPackageId   -> the "Default" package we just minted in 2a
--   eliProductId   -> NULL (legacy JSON did not carry productId)
--   eliDescription -> productName, coerced to "Product" if missing
--                     (the column is NOT NULL)
--   eliQuantity / eliUnitPrice / eliLineTotal -> direct copy, with
--   MySQL coercing JSON numbers into DECIMAL.
--
-- Idempotency: skip any estimate that already has at least one line
-- item row. Guards against re-runs and against stomping manual edits.

INSERT INTO `estimateLineItems` (
  `eliEstimateId`,  `eliPackageId`, `eliProductId`,
  `eliDescription`, `eliQuantity`,  `eliUnitPrice`, `eliLineTotal`,
  `eliSortOrder`,
  `eliColor`,       `eliSize`,      `eliImageUrl`,  `eliSku`
)
SELECT
  e.`id`,
  ep.`id`,
  NULL,
  COALESCE(NULLIF(j.`productName`, ''), 'Product'),
  j.`quantity`,
  j.`unitPrice`,
  j.`totalPrice`,
  j.`ord` - 1,
  j.`color`, j.`size`, j.`imageUrl`, j.`sku`
FROM `estimates` e
JOIN `estimatePackages` ep
  ON  ep.`epEstimateId` = e.`id`
  AND ep.`epName`       = 'Default'
JOIN JSON_TABLE(
  e.`estLineItems`,
  '$[*]' COLUMNS (
    `ord`         FOR ORDINALITY,
    `productName` VARCHAR(512)  PATH '$.productName',
    `sku`         VARCHAR(128)  PATH '$.sku',
    `color`       VARCHAR(128)  PATH '$.color',
    `size`        VARCHAR(128)  PATH '$.size',
    `quantity`    DECIMAL(12,3) PATH '$.quantity',
    `unitPrice`   DECIMAL(12,2) PATH '$.unitPrice',
    `totalPrice`  DECIMAL(12,2) PATH '$.totalPrice',
    `imageUrl`    VARCHAR(1024) PATH '$.imageUrl'
  )
) AS j
WHERE e.`estLineItems` IS NOT NULL
  AND JSON_LENGTH(e.`estLineItems`) > 0
  AND NOT EXISTS (
    SELECT 1 FROM `estimateLineItems` eli
    WHERE eli.`eliEstimateId` = e.`id`
  );
