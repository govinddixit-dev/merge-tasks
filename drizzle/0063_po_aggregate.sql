-- 0063_po_aggregate.sql
-- Adds the PO consolidation workflow:
--   - "consolidated": an original PO that has been rolled up into a
--     merged PO. Kept for historical reference; no further actions.
--   - "merged": a new PO created from two or more originals with the
--     same supplier. Points at its sources via mergedFromPoIds.
--
-- Zero-regression: enum is widened (existing rows untouched) and the
-- lineage column is NULL for every existing row.

-- NOTE: the DB column is named `poStatus` (see drizzle/schema.ts purchaseOrders:
-- `status: mysqlEnum("poStatus", [...])` — TS field name differs from column name).
ALTER TABLE `purchaseOrders`
  MODIFY COLUMN `poStatus` ENUM(
    'draft', 'sent', 'acknowledged', 'in_production',
    'shipped', 'received', 'cancelled', 'partial', 'declined',
    'consolidated', 'merged'
  ) NOT NULL DEFAULT 'draft';

ALTER TABLE `purchaseOrders`
  ADD COLUMN `mergedFromPoIds` JSON NULL DEFAULT NULL;
