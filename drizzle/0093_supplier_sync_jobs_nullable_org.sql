-- Allow solo users (no organization) to run supplier syncs.
-- organizationId becomes nullable; FK is recreated with ON DELETE SET NULL
-- so deleting an organization no longer blocks or cascades the sync history.
ALTER TABLE `supplierSyncJobs` MODIFY COLUMN `organizationId` int NULL;
ALTER TABLE `supplierSyncJobs` DROP FOREIGN KEY `ssj_org_fk`;
ALTER TABLE `supplierSyncJobs` ADD CONSTRAINT `ssj_org_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;
