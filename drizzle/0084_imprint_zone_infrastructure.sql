-- Phase 2: Imprint Zone Infrastructure
-- Adds product imprint zones, decoration method linkage, and zone presets.
-- Enables interactive zone selection on the webstore PDP with live logo preview.
--
-- Changes:
--   1. CREATE imprintZonePresets — 30 seeded common zones
--   2. CREATE productImprintZones — zones per master product
--   3. CREATE productImprintZoneDecorations — valid decoration methods per zone
--   4. ALTER clientProductConfig — add defaultImprintZoneId
--   5. ALTER proposalProducts — add imprintZoneId (decorationZone kept, deprecated)
--   6. ALTER orderItems — add imprintZoneId

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. imprintZonePresets
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `imprintZonePresets` (
  `id`        INT            NOT NULL AUTO_INCREMENT,
  `label`     VARCHAR(128)   NOT NULL,
  `slug`      VARCHAR(64)    NOT NULL,
  `category`  VARCHAR(64)    NULL,
  `x`         DECIMAL(5,2)   NOT NULL,
  `y`         DECIMAL(5,2)   NOT NULL,
  `w`         DECIMAL(5,2)   NOT NULL,
  `h`         DECIMAL(5,2)   NOT NULL,
  `sortOrder` INT            NOT NULL DEFAULT 0,
  `isActive`  BOOLEAN        NOT NULL DEFAULT TRUE,
  `createdAt` TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `izp_slug_unique` (`slug`)
);

INSERT INTO `imprintZonePresets` (`label`, `slug`, `category`, `x`, `y`, `w`, `h`, `sortOrder`) VALUES
  -- Apparel
  ('Left Chest',          'left-chest',         'apparel',    16.00, 14.00, 20.00, 18.00,  1),
  ('Right Chest',         'right-chest',        'apparel',    64.00, 14.00, 20.00, 18.00,  2),
  ('Full Front',          'full-front',         'apparel',    28.00, 22.00, 44.00, 40.00,  3),
  ('Full Back',           'full-back',          'apparel',    28.00, 22.00, 44.00, 40.00,  4),
  ('Left Sleeve',         'left-sleeve',        'apparel',     8.00, 35.00, 14.00, 12.00,  5),
  ('Right Sleeve',        'right-sleeve',       'apparel',    78.00, 35.00, 14.00, 12.00,  6),
  ('Pocket',              'pocket',             'apparel',    18.00, 18.00, 12.00, 10.00,  7),
  ('Collar',              'collar',             'apparel',    35.00,  4.00, 30.00,  6.00,  8),
  ('Hood',                'hood',               'apparel',    28.00,  5.00, 44.00, 20.00,  9),
  ('Hem',                 'hem',                'apparel',    28.00, 88.00, 44.00,  8.00, 10),
  ('Chest Inside Left',   'chest-inside-left',  'apparel',    16.00, 14.00, 20.00, 18.00, 11),
  ('Nape',                'nape',               'apparel',    35.00,  8.00, 30.00, 10.00, 12),
  ('Cuff',                'cuff',               'apparel',    10.00, 80.00, 20.00,  8.00, 13),
  -- Headwear
  ('Cap Front',           'cap-front',          'headwear',   28.00, 20.00, 44.00, 40.00, 14),
  ('Cap Side',            'cap-side',           'headwear',   10.00, 25.00, 30.00, 28.00, 15),
  ('Cap Back Strap',      'cap-back',           'headwear',   30.00, 60.00, 40.00, 20.00, 16),
  ('Cap Visor',           'cap-visor',          'headwear',   20.00, 75.00, 60.00, 15.00, 17),
  -- Drinkware
  ('Wrap',                'wrap',               'drinkware',  20.00, 25.00, 60.00, 50.00, 18),
  ('Front Panel',         'front-panel',        'drinkware',  25.00, 25.00, 50.00, 50.00, 19),
  ('Bottom',              'bottom',             'drinkware',  30.00, 75.00, 40.00, 20.00, 20),
  -- Bags
  ('Main Panel',          'main-panel',         'bags',       15.00, 15.00, 70.00, 60.00, 21),
  ('Front Pocket',        'front-pocket',       'bags',       25.00, 55.00, 50.00, 30.00, 22),
  ('Side Panel',          'side-panel',         'bags',        5.00, 20.00, 25.00, 50.00, 23),
  ('Strap',               'strap',              'bags',       40.00,  5.00, 20.00, 90.00, 24),
  -- Hard goods / Tech
  ('Top Face',            'top-face',           'tech',       15.00, 15.00, 70.00, 60.00, 25),
  ('Front Face',          'front-face',         'tech',       20.00, 20.00, 60.00, 60.00, 26),
  ('Clip',                'clip',               'tech',       40.00,  5.00, 20.00, 30.00, 27),
  -- Stationery
  ('Cover',               'cover',              'stationery', 15.00, 15.00, 70.00, 60.00, 28),
  ('Spine',               'spine',              'stationery',  2.00, 10.00, 10.00, 80.00, 29),
  ('Interior',            'interior',           'stationery', 15.00, 15.00, 70.00, 60.00, 30),
  -- Lanyards
  ('Badge',               'badge',              'lanyards',   25.00, 60.00, 50.00, 30.00, 31),
  ('Full Length',         'full-length',        'lanyards',   35.00,  5.00, 30.00, 90.00, 32),
  -- Universal
  ('Full Bleed',          'full-bleed',         NULL,          5.00,  5.00, 90.00, 90.00, 33),
  ('Center',              'center',             NULL,         28.00, 28.00, 44.00, 44.00, 34);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. productImprintZones
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `productImprintZones` (
  `id`          INT           NOT NULL AUTO_INCREMENT,
  `productId`   INT           NOT NULL,
  `label`       VARCHAR(128)  NOT NULL,
  `slug`        VARCHAR(64)   NOT NULL,
  `x`           DECIMAL(5,2)  NOT NULL,
  `y`           DECIMAL(5,2)  NOT NULL,
  `w`           DECIMAL(5,2)  NOT NULL,
  `h`           DECIMAL(5,2)  NOT NULL,
  `sortOrder`   INT           NOT NULL DEFAULT 0,
  `isActive`    BOOLEAN       NOT NULL DEFAULT TRUE,
  `createdAt`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `piz_product_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `piz_product_slug_unique` (`productId`, `slug`),
  INDEX `piz_product_idx` (`productId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. productImprintZoneDecorations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `productImprintZoneDecorations` (
  `id`                  INT       NOT NULL AUTO_INCREMENT,
  `imprintZoneId`       INT       NOT NULL,
  `decorationMethodId`  INT       NOT NULL,
  `isDefault`           BOOLEAN   NOT NULL DEFAULT FALSE,
  `createdAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `pizd_zone_fk`       FOREIGN KEY (`imprintZoneId`)      REFERENCES `productImprintZones`(`id`) ON DELETE CASCADE,
  CONSTRAINT `pizd_decoration_fk` FOREIGN KEY (`decorationMethodId`) REFERENCES `decorationMethods`(`id`),
  UNIQUE KEY `pizd_zone_method_unique` (`imprintZoneId`, `decorationMethodId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ALTER clientProductConfig — add defaultImprintZoneId
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `clientProductConfig`
  ADD COLUMN `defaultImprintZoneId` INT NULL,
  ADD CONSTRAINT `cpc_imprint_zone_fk` FOREIGN KEY (`defaultImprintZoneId`) REFERENCES `productImprintZones`(`id`) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ALTER proposalProducts — add imprintZoneId
--    decorationZone VARCHAR kept for backward compat — deprecated, ignored going forward
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `proposalProducts`
  ADD COLUMN `imprintZoneId` INT NULL,
  ADD CONSTRAINT `pp_imprint_zone_fk` FOREIGN KEY (`imprintZoneId`) REFERENCES `productImprintZones`(`id`) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ALTER orderItems — add imprintZoneId
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `orderItems`
  ADD COLUMN `imprintZoneId` INT NULL,
  ADD CONSTRAINT `oi_imprint_zone_fk` FOREIGN KEY (`imprintZoneId`) REFERENCES `productImprintZones`(`id`) ON DELETE SET NULL;
