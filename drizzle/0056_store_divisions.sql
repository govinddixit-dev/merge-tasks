-- 0056_store_divisions.sql
-- Adds stores.divisions — JSON array of divisions captured during the
-- Create Store wizard Step 4. Each element: { id, name, departments[] }.
--
-- Zero-regression: column is NULL for all existing rows. Store creation
-- continues to work whether or not divisions are supplied.

ALTER TABLE `stores`
  ADD COLUMN `divisions` JSON NULL;
