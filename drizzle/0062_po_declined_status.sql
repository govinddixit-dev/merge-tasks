-- 0062_po_declined_status.sql
-- Adds "declined" to the supplier-facing purchaseOrders.status enum.
-- Suppliers can decline a PO (e.g. out of stock, rejected terms); this was
-- previously bucketed into "cancelled", which conflates distributor-initiated
-- cancellation with supplier-initiated rejection.
--
-- Zero-regression: enum widening only. No existing rows change state.

-- NOTE: the DB column is named `poStatus` (see drizzle/schema.ts purchaseOrders:
-- `status: mysqlEnum("poStatus", [...])` — TS field name differs from column name).
ALTER TABLE `purchaseOrders`
  MODIFY COLUMN `poStatus` ENUM(
    'draft', 'sent', 'acknowledged', 'in_production',
    'shipped', 'received', 'cancelled', 'partial', 'declined'
  ) NOT NULL DEFAULT 'draft';
