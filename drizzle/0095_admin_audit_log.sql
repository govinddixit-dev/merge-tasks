-- Admin audit log: append-only record of every platform-admin action
-- that touches another organization's data. Wired up by future admin
-- endpoints; this migration only creates the table.
CREATE TABLE `adminAuditLog` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `adminUserId` int NOT NULL,
  `action` varchar(128) NOT NULL,
  `targetOrgId` int,
  `metadata` json,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `adminAuditLog_id` PRIMARY KEY(`id`)
);

CREATE INDEX `aal_admin_idx` ON `adminAuditLog`(`adminUserId`, `timestamp`);
CREATE INDEX `aal_target_org_idx` ON `adminAuditLog`(`targetOrgId`, `timestamp`);

ALTER TABLE `adminAuditLog`
  ADD CONSTRAINT `aal_admin_user_fk`
  FOREIGN KEY (`adminUserId`) REFERENCES `users`(`id`);
