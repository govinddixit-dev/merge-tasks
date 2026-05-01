CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`organizationId` int,
	`notifType` enum('proposal_sent','proposal_viewed','proposal_approved','proposal_declined','order_placed','order_shipped','order_delivered','store_order','store_user_joined','payment_received','invoice_overdue','approval_requested','approval_granted','approval_denied','ai_insight','system') NOT NULL DEFAULT 'system',
	`notifTitle` varchar(255) NOT NULL,
	`notifMessage` text NOT NULL,
	`notifRead` boolean NOT NULL DEFAULT false,
	`notifActionPath` varchar(512),
	`notifActionLabel` varchar(100),
	`notifEntityId` int,
	`notifEntityType` varchar(50),
	`notifCreatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stores` MODIFY COLUMN `storeStatus` enum('active','inactive','setup','draft','pending_approval') NOT NULL DEFAULT 'setup';--> statement-breakpoint
-- ── organizationId adds: guarded because 0025_organizations_multitenancy.sql
-- (hand-written, same prefix as 0025_daffy_genesis) adds the same columns
-- earlier in the chain. Unguarded, a fresh-DB replay errors with "Duplicate
-- column name 'organizationId'" the moment this file starts running.
DROP PROCEDURE IF EXISTS `_add_org_col_0026`;--> statement-breakpoint
DELIMITER $$
CREATE PROCEDURE `_add_org_col_0026`(IN tbl VARCHAR(64))
BEGIN
  DECLARE has_col INT;
  SELECT COUNT(*) INTO has_col FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = 'organizationId';
  IF has_col = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `', tbl, '` ADD `organizationId` int');
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;
CALL `_add_org_col_0026`('aiEditFeedback');--> statement-breakpoint
CALL `_add_org_col_0026`('apiConnections');--> statement-breakpoint
CALL `_add_org_col_0026`('clientAssets');--> statement-breakpoint
CALL `_add_org_col_0026`('clientLogos');--> statement-breakpoint
CALL `_add_org_col_0026`('clients');--> statement-breakpoint
CALL `_add_org_col_0026`('copilot_conversations');--> statement-breakpoint
CALL `_add_org_col_0026`('copilot_memory');--> statement-breakpoint
CALL `_add_org_col_0026`('copilot_task_log');--> statement-breakpoint
CALL `_add_org_col_0026`('distributorProfiles');--> statement-breakpoint
ALTER TABLE `distributorProfiles` ADD `senderEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `distributorProfiles` ADD `senderName` varchar(255);--> statement-breakpoint
CALL `_add_org_col_0026`('emailConnections');--> statement-breakpoint
CALL `_add_org_col_0026`('estimates');--> statement-breakpoint
CALL `_add_org_col_0026`('invoices');--> statement-breakpoint
CALL `_add_org_col_0026`('orders');--> statement-breakpoint
CALL `_add_org_col_0026`('printRequests');--> statement-breakpoint
CALL `_add_org_col_0026`('products');--> statement-breakpoint
CALL `_add_org_col_0026`('proposals');--> statement-breakpoint
CALL `_add_org_col_0026`('stores');--> statement-breakpoint
ALTER TABLE `stores` ADD `template` enum('classic','modern','minimal') DEFAULT 'modern' NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `aiHeroHeadline` varchar(255);--> statement-breakpoint
ALTER TABLE `stores` ADD `aiHeroSubtitle` varchar(512);--> statement-breakpoint
ALTER TABLE `stores` ADD `aiIndustryTheme` varchar(128);--> statement-breakpoint
ALTER TABLE `stores` ADD `aiColorPalette` json;--> statement-breakpoint
ALTER TABLE `stores` ADD `aiTemplateSuggestion` enum('classic','modern','minimal');--> statement-breakpoint
ALTER TABLE `stores` ADD `senderName` varchar(255);--> statement-breakpoint
ALTER TABLE `stores` ADD `senderEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `stores` ADD `approvalToken` varchar(64);--> statement-breakpoint
ALTER TABLE `stores` ADD `approvalClientEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `stores` ADD `approvalClientName` varchar(255);--> statement-breakpoint
ALTER TABLE `stores` ADD `approvalSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `stores` ADD `approvalApprovedAt` timestamp;--> statement-breakpoint
ALTER TABLE `stores` ADD `approvalNotes` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `approvalExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `stores` ADD `editorHeroHeadline` varchar(255);--> statement-breakpoint
ALTER TABLE `stores` ADD `editorHeroSubtitle` varchar(512);--> statement-breakpoint
ALTER TABLE `stores` ADD `editorTagline` varchar(512);--> statement-breakpoint
ALTER TABLE `stores` ADD `editorWelcomeMessage` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `editorCategoryOrder` json;--> statement-breakpoint
ALTER TABLE `stores` ADD `editorCategoryNames` json;--> statement-breakpoint
ALTER TABLE `stores` ADD `editorSubCategories` json;--> statement-breakpoint
ALTER TABLE `stores` ADD `editorProductNames` json;--> statement-breakpoint
ALTER TABLE `stores` ADD `editorProductDescriptions` json;--> statement-breakpoint
CALL `_add_org_col_0026`('virtualProofs');--> statement-breakpoint
DROP PROCEDURE `_add_org_col_0026`;--> statement-breakpoint
CREATE INDEX `notifications_userId_idx` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `notifications_orgId_idx` ON `notifications` (`organizationId`);--> statement-breakpoint
CREATE INDEX `notifications_read_idx` ON `notifications` (`userId`,`notifRead`);--> statement-breakpoint
CREATE INDEX `clients_orgId_idx` ON `clients` (`organizationId`);--> statement-breakpoint
CREATE INDEX `clients_orgStatus_idx` ON `clients` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `orders_userId_idx` ON `orders` (`userId`);--> statement-breakpoint
CREATE INDEX `orders_orgId_idx` ON `orders` (`organizationId`);--> statement-breakpoint
CREATE INDEX `orders_clientId_idx` ON `orders` (`clientId`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`orderStatus`);--> statement-breakpoint
CREATE INDEX `orders_orgStatus_idx` ON `orders` (`organizationId`,`orderStatus`);--> statement-breakpoint
CREATE INDEX `products_orgId_idx` ON `products` (`organizationId`);--> statement-breakpoint
CREATE INDEX `products_orgCategory_idx` ON `products` (`organizationId`,`category`);--> statement-breakpoint
CREATE INDEX `proposals_orgId_idx` ON `proposals` (`organizationId`);--> statement-breakpoint
CREATE INDEX `proposals_orgStatus_idx` ON `proposals` (`organizationId`,`proposalStatus`);--> statement-breakpoint
CREATE INDEX `stores_userId_idx` ON `stores` (`userId`);--> statement-breakpoint
CREATE INDEX `stores_orgId_idx` ON `stores` (`organizationId`);--> statement-breakpoint
CREATE INDEX `stores_clientId_idx` ON `stores` (`clientId`);--> statement-breakpoint
CREATE INDEX `stores_orgStatus_idx` ON `stores` (`organizationId`,`storeStatus`);