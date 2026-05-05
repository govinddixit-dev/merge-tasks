-- Phase 1: Unified Pricing Engine
-- Replaces three divergent pricing systems (customPrice, proposalPriceTiers,
-- printProductPricing) with a single resolver-backed engine.
--
-- Changes in this migration:
--   1. productVariants.variantType  — loosen hardcoded ENUM → VARCHAR(128)
--   2. decorationMethods            — new table, seeded from existing enum values
--   3. masterProductPricing         — new table (supplier cost track)
--   4. clientProductConfig          — new table (anchor record per client × product)
--   5. clientProductPricingTiers    — new table (client sell price tiers)
--   6. clientProductVariantUpcharges — new table (per-variant upcharges)
--   7. clientProductOtherCosts      — new table (persistent free-form line items)
--   8. clientProductDecorationMethod — new table (one decoration method per client-product)
--
-- What is NOT touched:
--   - customPrice on storeProducts   — retained, ignored by resolver, hard-deleted Phase 6
--   - proposalPriceTiers             — historical proposals stay frozen, deprecated Phase 6
--   - printProductPricing            — separate subsystem, out of scope entirely
--
-- All money columns are BIGINT (integer cents). No decimals on price columns.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Loosen productVariants.variantType from hardcoded ENUM to VARCHAR
--    Existing values (color, size, logo_position) remain valid after change.
--    Unblocks generic variant dimensions from supplier APIs (Phase 3).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `productVariants`
  MODIFY COLUMN `variantType` VARCHAR(128) NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. decorationMethods
--    Replaces JSON array on products (line 117) and hardcoded enum on
--    proposalProducts (line 463). Seeded from existing enum values.
--    JSON arrays on product records migrated to FKs in Phase 3.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `decorationMethods` (
  `id`        INT           NOT NULL AUTO_INCREMENT,
  `name`      VARCHAR(128)  NOT NULL,
  `slug`      VARCHAR(128)  NOT NULL,
  `isActive`  BOOLEAN       NOT NULL DEFAULT TRUE,
  `createdAt` TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `decorationMethods_slug_unique` (`slug`)
);

INSERT INTO `decorationMethods` (`name`, `slug`) VALUES
  ('Embroidery',      'embroidery'),
  ('Screen Print',    'screen_print'),
  ('Laser Engraving', 'laser_engraving'),
  ('Heat Transfer',   'heat_transfer'),
  ('DTG',             'dtg'),
  ('Sublimation',     'sublimation'),
  ('Deboss',          'deboss'),
  ('Patch',           'patch');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. masterProductPricing
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `masterProductPricing` (
  `id`               BIGINT        NOT NULL AUTO_INCREMENT,
  `productId`        INT           NOT NULL,
  `supplierId`       INT           NOT NULL,
  `variantKey`       VARCHAR(256)  NULL,
  `minQty`           INT           NOT NULL,
  `maxQty`           INT           NULL,
  `nativeCostCents`  BIGINT        NOT NULL,
  `nativeCurrency`   CHAR(3)       NOT NULL,
  `unitCostCents`    BIGINT        NOT NULL,
  `currency`         CHAR(3)       NOT NULL,
  `syncedAt`         TIMESTAMP     NOT NULL,
  `isActive`         BOOLEAN       NOT NULL DEFAULT TRUE,
  PRIMARY KEY (`id`),
  CONSTRAINT `mpp_product_fk`   FOREIGN KEY (`productId`)  REFERENCES `products`(`id`),
  CONSTRAINT `mpp_supplier_fk`  FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`),
  INDEX `mpp_product_supplier_idx` (`productId`, `supplierId`),
  INDEX `mpp_variant_idx`          (`productId`, `variantKey`(128))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. clientProductConfig
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `clientProductConfig` (
  `id`          BIGINT                          NOT NULL AUTO_INCREMENT,
  `clientId`    INT                             NOT NULL,
  `productId`   INT                             NOT NULL,
  `displayMode` ENUM('itemize','roll_into_unit') NOT NULL DEFAULT 'itemize',
  `isActive`    BOOLEAN                         NOT NULL DEFAULT TRUE,
  `createdAt`   TIMESTAMP                       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`   TIMESTAMP                       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `cpc_client_fk`   FOREIGN KEY (`clientId`)  REFERENCES `clients`(`id`),
  CONSTRAINT `cpc_product_fk`  FOREIGN KEY (`productId`) REFERENCES `products`(`id`),
  UNIQUE KEY `cpc_client_product_unique` (`clientId`, `productId`),
  INDEX `cpc_client_idx` (`clientId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. clientProductPricingTiers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `clientProductPricingTiers` (
  `id`                    BIGINT    NOT NULL AUTO_INCREMENT,
  `clientProductConfigId` BIGINT    NOT NULL,
  `minQty`                INT       NOT NULL,
  `maxQty`                INT       NULL,
  `unitPriceCents`        BIGINT    NOT NULL,
  `createdAt`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `cppt_config_fk` FOREIGN KEY (`clientProductConfigId`)
    REFERENCES `clientProductConfig`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `cppt_config_minqty_unique` (`clientProductConfigId`, `minQty`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. clientProductVariantUpcharges
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `clientProductVariantUpcharges` (
  `id`                    BIGINT       NOT NULL AUTO_INCREMENT,
  `clientProductConfigId` BIGINT       NOT NULL,
  `variantKey`            VARCHAR(256) NOT NULL,
  `upchargeCents`         BIGINT       NOT NULL DEFAULT 0,
  `createdAt`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `cpvu_config_fk` FOREIGN KEY (`clientProductConfigId`)
    REFERENCES `clientProductConfig`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `cpvu_config_variant_unique` (`clientProductConfigId`, `variantKey`(128))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. clientProductOtherCosts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `clientProductOtherCosts` (
  `id`                    BIGINT                    NOT NULL AUTO_INCREMENT,
  `clientProductConfigId` BIGINT                    NOT NULL,
  `label`                 VARCHAR(255)              NOT NULL,
  `amountCents`           BIGINT                    NOT NULL,
  `side`                  ENUM('buying','selling')  NOT NULL,
  `sortOrder`             INT                       NOT NULL DEFAULT 0,
  `isActive`              BOOLEAN                   NOT NULL DEFAULT TRUE,
  `createdAt`             TIMESTAMP                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP                 NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `cpoc_config_fk` FOREIGN KEY (`clientProductConfigId`)
    REFERENCES `clientProductConfig`(`id`) ON DELETE CASCADE,
  INDEX `cpoc_config_idx` (`clientProductConfigId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. clientProductDecorationMethod
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `clientProductDecorationMethod` (
  `id`                    BIGINT                      NOT NULL AUTO_INCREMENT,
  `clientProductConfigId` BIGINT                      NOT NULL,
  `decorationMethodId`    INT                         NOT NULL,
  `setupFeeCents`         BIGINT                      NOT NULL DEFAULT 0,
  `setupFeeMode`          ENUM('one_time','per_order') NOT NULL DEFAULT 'one_time',
  `isActive`              BOOLEAN                     NOT NULL DEFAULT TRUE,
  `createdAt`             TIMESTAMP                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP                   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `cpdm_config_fk` FOREIGN KEY (`clientProductConfigId`)
    REFERENCES `clientProductConfig`(`id`) ON DELETE CASCADE,
  CONSTRAINT `cpdm_method_fk` FOREIGN KEY (`decorationMethodId`)
    REFERENCES `decorationMethods`(`id`),
  UNIQUE KEY `cpdm_config_unique` (`clientProductConfigId`)
);
