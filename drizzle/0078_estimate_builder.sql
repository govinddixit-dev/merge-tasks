-- 0078_estimate_builder.sql
-- Schema changes backing the unified-canvas Estimate Builder.
--
-- Four concerns in one migration:
--
--   1. estimates.estProposalId becomes NULLABLE. The legacy createFromProposal
--      flow still sets it; the builder mints estimates from scratch with no
--      parent proposal. Pure relaxation — existing rows stay valid.
--
--   2. estimates.estStatus enum gains "expired". Needed so estimates whose
--      validUntil has passed can flip status without a surprise enum error.
--      MySQL enum additions are backwards-compatible when appended.
--
--   3. estimates gains three nullable columns — estTerms, estValidUntil —
--      and one non-null column with a default — estCurrency. The legacy
--      estValidDays column is retained as a read-time fallback for rows
--      created before the builder; new rows write estValidUntil directly.
--
--   4. Two new normalized tables — estimatePackages and estimateLineItems —
--      replace the JSON estLineItems column for builder-created estimates.
--      The JSON column is retained as a deprecated read-path until legacy
--      rows are backfilled (tracked as TODO(estimate-builder) in
--      drizzle/schema.ts and server/routers/estimatesInvoices.ts).
--
-- All changes are additive or relaxations; no existing row is invalidated
-- and no existing query needs to change before this migration runs.

-- 1. Relax proposal FK so standalone estimates are allowed.
ALTER TABLE `estimates`
  MODIFY COLUMN `estProposalId` INT NULL;

-- 2. Extend status enum with "expired".
ALTER TABLE `estimates`
  MODIFY COLUMN `estStatus`
    ENUM('draft','sent','accepted','declined','expired','converted')
    NOT NULL DEFAULT 'draft';

-- 3. Additive columns for the builder.
ALTER TABLE `estimates`
  ADD COLUMN `estTerms` TEXT NULL DEFAULT NULL,
  ADD COLUMN `estCurrency` VARCHAR(3) NOT NULL DEFAULT 'CAD',
  ADD COLUMN `estValidUntil` TIMESTAMP NULL DEFAULT NULL;

-- 3b. Supporting indexes for list / filter queries.
CREATE INDEX `estimates_clientId_idx` ON `estimates` (`estClientId`);
CREATE INDEX `estimates_org_status_idx` ON `estimates` (`organizationId`, `estStatus`);

-- 4a. Package groupings (optional — estimates without packages are valid).
CREATE TABLE `estimatePackages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `epEstimateId` INT NOT NULL,
  `epName` VARCHAR(255) NOT NULL,
  `epSortOrder` INT NOT NULL DEFAULT 0,
  `epCreatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `estimatePackages_estimateId_fk`
    FOREIGN KEY (`epEstimateId`) REFERENCES `estimates` (`id`) ON DELETE CASCADE,
  KEY `ep_estimate_idx` (`epEstimateId`)
);

-- 4b. Normalized line items. package_id nullable — ungrouped lines sit at
-- the root of the estimate. product_id nullable — one-off custom items.
CREATE TABLE `estimateLineItems` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `eliEstimateId` INT NOT NULL,
  `eliPackageId` INT NULL DEFAULT NULL,
  `eliProductId` INT NULL DEFAULT NULL,
  `eliDescription` TEXT NOT NULL,
  `eliQuantity` DECIMAL(12,3) NOT NULL DEFAULT '1.000',
  `eliUnitPrice` DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `eliLineTotal` DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `eliSortOrder` INT NOT NULL DEFAULT 0,
  `eliCreatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `eliUpdatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `estimateLineItems_estimateId_fk`
    FOREIGN KEY (`eliEstimateId`) REFERENCES `estimates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `estimateLineItems_packageId_fk`
    FOREIGN KEY (`eliPackageId`) REFERENCES `estimatePackages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `estimateLineItems_productId_fk`
    FOREIGN KEY (`eliProductId`) REFERENCES `products` (`id`),
  KEY `eli_estimate_idx` (`eliEstimateId`),
  KEY `eli_package_idx` (`eliPackageId`)
);
