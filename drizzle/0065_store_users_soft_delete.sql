-- 0065_store_users_soft_delete.sql
-- Adds soft-delete semantics to storeUsers so deactivating a user preserves
-- their order history, approvals, and spend records. Every active-user
-- query must filter `deletedAt IS NULL`.

ALTER TABLE `storeUsers`
  ADD COLUMN `deletedAt` TIMESTAMP NULL DEFAULT NULL;
