-- Phase 8 — Product Variant Grouping (Session 1).
--
-- Adds a canonical styleGroup column to products so every color/size
-- variant of the same product family shares one key. UI grids and the
-- PDP read this to collapse 13,871 SKU rows into ~407 product cards.
--
-- styleGroup        — slugified product name, e.g. "atc-werk-heavyweight-...".
--                     Stable, human-readable, URL-safe for PDP routes.
-- isVariantPrimary  — exactly one row per group is the cover variant
--                     (whose image/name appears on the grid card).
-- colorName/Hex/    — variant identity for the color selector. Hex is
-- swatchUrl           lazy-populated; swatchUrl falls back to imageUrl.
--
-- Grandfathering: all five columns nullable + DEFAULT FALSE; the
-- separate populator job (server/jobs/backfillStyleGroups.ts) fills them
-- in chunks after the columns exist. Populator is idempotent: rerunning
-- yields the same slug + same primary pick.
--
-- ALGORITHM=INSTANT for all five ADDs (nullable / default-false on a
-- 14k-row table — trivial on MySQL 8.4.8). Index add cannot use INSTANT
-- on this MySQL build but is also bounded (14k rows, single column).
--
-- Revert: drop the five columns + index. Display code falls back to
-- one-card-per-row as before.

ALTER TABLE `products` ADD COLUMN `styleGroup`       varchar(128) NULL, ALGORITHM=INSTANT;
ALTER TABLE `products` ADD COLUMN `isVariantPrimary` boolean NOT NULL DEFAULT FALSE, ALGORITHM=INSTANT;
ALTER TABLE `products` ADD COLUMN `colorName`        varchar(64)  NULL, ALGORITHM=INSTANT;
ALTER TABLE `products` ADD COLUMN `colorHex`         varchar(9)   NULL, ALGORITHM=INSTANT;
ALTER TABLE `products` ADD COLUMN `swatchUrl`        varchar(1024) NULL, ALGORITHM=INSTANT;

CREATE INDEX `products_styleGroup_idx` ON `products` (`styleGroup`);
