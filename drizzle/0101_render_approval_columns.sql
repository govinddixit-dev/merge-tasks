-- Phase 7 — Hybrid distributor approval gate for webstore renders.
--
-- Adds the approval/override layer on top of the per-binding render columns
-- introduced in 0099. The webstore now shows the photorealistic render only
-- when `renderApproved = TRUE`; otherwise it falls back to the CSS logo
-- overlay. Distributors review and approve in the new Render Manager UI.
--
-- Columns added to `storeProducts`:
--   renderApproved          bool, default FALSE.
--                           Worker writes complete renders with approved=FALSE
--                           so they enter "Pending Review". Distributor flips
--                           via renderManager.approve / uploadOverride / bulk.
--   renderApprovedAt        timestamp, nullable.
--   renderApprovedBy        int FK -> users.id, nullable.
--   renderOverrideUrl       varchar(2048), nullable. Manual upload that
--                           supersedes the AI render. Webstore prefers
--                           override over AI when both exist.
--   renderPromptAdjustment  text, nullable. Per-binding free-text tweak the
--                           distributor appends to the base render prompt
--                           ("logo 30% smaller", etc). Persists across
--                           re-renders so logo-change re-enqueues remember
--                           the distributor's preference for that binding.
--
-- Grandfathering: every storeProducts row that already has a rendered image
-- (`webstoreRenderedImageUrl IS NOT NULL`) is auto-approved, so the customer
-- webstore continues to show the same images post-deploy with zero visual
-- disruption. New renders generated after deploy land as approved=FALSE and
-- are gated behind the distributor review queue.
--
-- ALGORITHM=INSTANT: all five ADDs are nullable / DEFAULT-FALSE additions on
-- a small table (5 rows as of 2026-04-26). INSTANT trivially safe on MySQL
-- 8.4.8. The UPDATE is a single-statement backfill, also trivial at this
-- size; if storeProducts grows large before another env applies this, the
-- UPDATE remains O(n) but row count is bounded by store-product bindings,
-- not catalog size.
--
-- Revert: drop the five columns. No data migration needed in reverse —
-- 0099's per-binding render columns continue to function without the
-- approval layer (webstore would simply show every render unconditionally,
-- which is the pre-Phase-7 behavior).

ALTER TABLE `storeProducts`
  ADD COLUMN `renderApproved` boolean NOT NULL DEFAULT FALSE,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `renderApprovedAt` timestamp NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `renderApprovedBy` int NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `renderOverrideUrl` varchar(2048) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD COLUMN `renderPromptAdjustment` text NULL,
  ALGORITHM=INSTANT;

ALTER TABLE `storeProducts`
  ADD CONSTRAINT `storeProducts_renderApprovedBy_fk`
  FOREIGN KEY (`renderApprovedBy`) REFERENCES `users` (`id`);

-- Grandfather pre-Phase-7 renders so the customer webstore does not blank
-- out at deploy. Anything already showing on the storefront stays showing.
UPDATE `storeProducts`
SET `renderApproved`   = TRUE,
    `renderApprovedAt` = COALESCE(`webstoreRenderedAt`, NOW())
WHERE `webstoreRenderedImageUrl` IS NOT NULL;
