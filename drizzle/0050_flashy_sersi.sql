CREATE TABLE IF NOT EXISTS `aiAuditLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int,
	`userId` int,
	`messageCount` int NOT NULL,
	`toolCount` int NOT NULL DEFAULT 0,
	`model` varchar(128) NOT NULL,
	`promptHash` varchar(64) NOT NULL,
	`promptSizeBytes` int NOT NULL,
	`sanitizedPayload` mediumtext NOT NULL,
	`compressed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiAuditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `copilotPendingActions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`organizationId` int,
	`toolCallId` varchar(128) NOT NULL,
	`toolName` varchar(128) NOT NULL,
	`summary` text NOT NULL,
	`serializedArgs` text NOT NULL,
	`cpaStatus` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
	`source` enum('user','agent'),
	`denyReason` text,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `copilotPendingActions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `customOrderRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`storeUserId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`quantity` int,
	`targetDate` timestamp,
	`attachmentUrls` json,
	`customOrderStatus` enum('pending','reviewed','approved','declined','fulfilled') NOT NULL DEFAULT 'pending',
	`pocNotes` text,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customOrderRequests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `promoCodeUsages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`promoCodeId` int NOT NULL,
	`storeUserId` int NOT NULL,
	`orderId` int NOT NULL,
	`discountApplied` decimal(10,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `promoCodeUsages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `promoCodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`organizationId` int,
	`code` varchar(64) NOT NULL,
	`description` varchar(255),
	`discountType` enum('percentage','fixed_amount') NOT NULL,
	`discountValue` decimal(10,2) NOT NULL,
	`minOrderAmount` decimal(10,2),
	`maxDiscountAmount` decimal(10,2),
	`maxUses` int,
	`usedCount` int NOT NULL DEFAULT 0,
	`maxUsesPerUser` int DEFAULT 1,
	`startsAt` timestamp,
	`expiresAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `promoCodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `promoCodes_storeCode_idx` UNIQUE(`storeId`,`code`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `purchaseOrderEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`purchaseOrderId` int NOT NULL,
	`poeEventType` enum('created','sent','acknowledged','status_changed','tracking_added','note_added','cancelled','received') NOT NULL,
	`description` text,
	`userId` int NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchaseOrderEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `purchaseOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`organizationId` int,
	`orderId` int NOT NULL,
	`supplierName` varchar(255) NOT NULL,
	`supplierCode` varchar(64),
	`supplierSource` varchar(32),
	`supplierContactEmail` varchar(255),
	`supplierContactPhone` varchar(64),
	`supplierAccountNumber` varchar(128),
	`poNumber` varchar(32) NOT NULL,
	`poStatus` enum('draft','sent','acknowledged','in_production','shipped','received','cancelled','partial') NOT NULL DEFAULT 'draft',
	`lineItems` json NOT NULL,
	`subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
	`shipping` decimal(10,2) NOT NULL DEFAULT '0.00',
	`tax` decimal(10,2) NOT NULL DEFAULT '0.00',
	`total` decimal(12,2) NOT NULL DEFAULT '0.00',
	`shipToName` varchar(255),
	`shipToAddress` text,
	`shipToType` enum('decorator','warehouse','client_direct') DEFAULT 'warehouse',
	`decorationInstructions` text,
	`requestedShipDate` timestamp,
	`expectedDeliveryDate` timestamp,
	`actualShipDate` timestamp,
	`trackingNumbers` json,
	`internalNotes` text,
	`supplierNotes` text,
	`aiGroupingConfidence` decimal(5,2),
	`aiGroupingReason` text,
	`sentAt` timestamp,
	`acknowledgedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchaseOrders_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchaseOrders_poNumber_unique` UNIQUE(`poNumber`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `refund_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int,
	`entityType` enum('order','invoice','proposal') NOT NULL,
	`entityId` int NOT NULL,
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`type` enum('full','partial') NOT NULL,
	`reason` text,
	`stripeRefundId` varchar(255),
	`stripePaymentIntentId` varchar(255),
	`status` enum('pending','succeeded','failed') NOT NULL DEFAULT 'pending',
	`processedBy` int,
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refund_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `refund_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int,
	`storeId` int NOT NULL,
	`proposalId` int NOT NULL,
	`storeUserId` int NOT NULL,
	`distributorUserId` int NOT NULL,
	`reason` text NOT NULL,
	`rrStatus` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
	`responseNote` text,
	`respondedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `refund_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storeDepartments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`budgetCents` int NOT NULL DEFAULT 0,
	`spentCents` int NOT NULL DEFAULT 0,
	`maxPerOrderCents` int,
	`fiscalPeriodStart` date NOT NULL,
	`fiscalPeriodEnd` date NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`departmentCreatedBy` enum('distributor','poc') NOT NULL DEFAULT 'distributor',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storeDepartments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storeIdentityProviders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`sipProtocol` enum('saml','oidc') NOT NULL,
	`domain` varchar(255) NOT NULL,
	`samlEntryPoint` text,
	`samlCertificate` text,
	`samlIssuer` varchar(512),
	`oidcDiscoveryUrl` text,
	`oidcClientId` varchar(255),
	`oidcClientSecret` text,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storeIdentityProviders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_store_domain` UNIQUE(`storeId`,`domain`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`organizationId` int,
	`name` varchar(255) NOT NULL,
	`normalizedName` varchar(255) NOT NULL,
	`code` varchar(64),
	`source` varchar(32),
	`contactEmail` varchar(255),
	`contactPhone` varchar(64),
	`accountNumber` varchar(128),
	`website` varchar(512),
	`defaultShipTo` enum('decorator','warehouse','client_direct') DEFAULT 'warehouse',
	`notes` text,
	`poCount` int NOT NULL DEFAULT 0,
	`totalSpend` decimal(14,2) NOT NULL DEFAULT '0.00',
	`lastOrderDate` timestamp,
	`avgFulfillmentDays` decimal(5,1),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Both indexes are referenced by FK constraints added in
-- 0027_add_foreign_keys.sql (fk_productVariants_productId,
-- fk_proposalProductVariants_ppId). You can't drop an index while an FK
-- still needs it — SET FOREIGN_KEY_CHECKS=0 doesn't help here, that flag
-- only relaxes data validation. The correct sequence is: drop FK, drop
-- index, then the rest of this file renames the columns and recreates
-- FKs on the new columns (lines 305-306). Guarded because the FK name
-- has to exist for DROP to succeed.
SET @has_fk_pv := (SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'productVariants'
    AND constraint_name = 'fk_productVariants_productId');
SET @sql := IF(@has_fk_pv > 0,
  'ALTER TABLE `productVariants` DROP FOREIGN KEY `fk_productVariants_productId`',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;--> statement-breakpoint
SET @has_fk_ppv := (SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'proposalProductVariants'
    AND constraint_name = 'fk_proposalProductVariants_ppId');
SET @sql := IF(@has_fk_ppv > 0,
  'ALTER TABLE `proposalProductVariants` DROP FOREIGN KEY `fk_proposalProductVariants_ppId`',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;--> statement-breakpoint
DROP INDEX `productVariants_productId_idx` ON `productVariants`;--> statement-breakpoint
DROP INDEX `proposalProductVariants_ppId_idx` ON `proposalProductVariants`;--> statement-breakpoint
ALTER TABLE `invoices` MODIFY COLUMN `invStatus` enum('draft','sent','paid','overdue','cancelled','void','refunded','partially_refunded','credit_issued') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `notifType` enum('proposal_sent','proposal_viewed','proposal_approved','proposal_declined','order_placed','order_shipped','order_delivered','store_order','store_user_joined','payment_received','invoice_overdue','approval_requested','approval_granted','approval_denied','ai_insight','system','po_created','po_sent','po_acknowledged','po_shipped','po_received','po_overdue','custom_order_request') NOT NULL DEFAULT 'system';--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `orderStatus` enum('pending','processing','production','shipped','delivered','cancelled','refunded','partially_refunded') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `printRequests` MODIFY COLUMN `clientId` int;--> statement-breakpoint
ALTER TABLE `storeVerificationCodes` MODIFY COLUMN `code` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` MODIFY COLUMN `storeStatus` enum('active','inactive','setup','draft','pending_approval','revision_requested') NOT NULL DEFAULT 'setup';--> statement-breakpoint
ALTER TABLE `verificationCodes` MODIFY COLUMN `code` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `invRefundedAmount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `invRefundedAt` timestamp;--> statement-breakpoint
ALTER TABLE `invoices` ADD `invCreditNoteNumber` varchar(64);--> statement-breakpoint
ALTER TABLE `invoices` ADD `invStripeRefundId` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `stripePaymentIntentId` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `stripeConnectAccountId` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `platformFeeAmount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `orders` ADD `branchLocationId` varchar(64);--> statement-breakpoint
ALTER TABLE `orders` ADD `glCode` varchar(128);--> statement-breakpoint
ALTER TABLE `orders` ADD `branchAllocation` json;--> statement-breakpoint
ALTER TABLE `orders` ADD `refundedAt` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripeRefundId` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `discountAmount` decimal(10,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `productVariants` ADD `pvProductId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `proposalProductVariants` ADD `ppvProdId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `stripePaymentIntentId` varchar(255);--> statement-breakpoint
ALTER TABLE `proposals` ADD `refundedAmount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `refundedAt` timestamp;--> statement-breakpoint
ALTER TABLE `proposals` ADD `stripeRefundId` varchar(255);--> statement-breakpoint
ALTER TABLE `storeProducts` ADD `stockQuantity` int;--> statement-breakpoint
ALTER TABLE `storeUsers` ADD `ssoSubject` varchar(255);--> statement-breakpoint
ALTER TABLE `storeUsers` ADD `lockedUntil` timestamp;--> statement-breakpoint
ALTER TABLE `stores` ADD `aiProductGridHeading` varchar(150);--> statement-breakpoint
ALTER TABLE `stores` ADD `aiProductBadgeStyle` enum('pill','ribbon','corner');--> statement-breakpoint
ALTER TABLE `stores` ADD `allowedPaymentMethods` json;--> statement-breakpoint
ALTER TABLE `users` ADD `stripeConnectAccountId` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `stripeConnectOnboardingComplete` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `stripeConnectPayoutsEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `stripeConnectChargesEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `lockedUntil` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_orderNumber_unique` UNIQUE(`orderNumber`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_stripePaymentIntent_idx` UNIQUE(`stripePaymentIntentId`);--> statement-breakpoint
ALTER TABLE `stores` ADD CONSTRAINT `stores_slug_unique` UNIQUE(`slug`);--> statement-breakpoint
ALTER TABLE `aiAuditLog` ADD CONSTRAINT `aiAuditLog_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `aiAuditLog` ADD CONSTRAINT `aiAuditLog_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `copilotPendingActions` ADD CONSTRAINT `copilotPendingActions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `copilotPendingActions` ADD CONSTRAINT `copilotPendingActions_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customOrderRequests` ADD CONSTRAINT `customOrderRequests_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customOrderRequests` ADD CONSTRAINT `customOrderRequests_storeUserId_storeUsers_id_fk` FOREIGN KEY (`storeUserId`) REFERENCES `storeUsers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promoCodeUsages` ADD CONSTRAINT `promoCodeUsages_promoCodeId_promoCodes_id_fk` FOREIGN KEY (`promoCodeId`) REFERENCES `promoCodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promoCodeUsages` ADD CONSTRAINT `promoCodeUsages_storeUserId_storeUsers_id_fk` FOREIGN KEY (`storeUserId`) REFERENCES `storeUsers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promoCodeUsages` ADD CONSTRAINT `promoCodeUsages_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promoCodes` ADD CONSTRAINT `promoCodes_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promoCodes` ADD CONSTRAINT `promoCodes_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchaseOrderEvents` ADD CONSTRAINT `purchaseOrderEvents_purchaseOrderId_purchaseOrders_id_fk` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchaseOrders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchaseOrderEvents` ADD CONSTRAINT `purchaseOrderEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchaseOrders` ADD CONSTRAINT `purchaseOrders_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchaseOrders` ADD CONSTRAINT `purchaseOrders_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchaseOrders` ADD CONSTRAINT `purchaseOrders_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_history` ADD CONSTRAINT `refund_history_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_requests` ADD CONSTRAINT `refund_requests_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_requests` ADD CONSTRAINT `refund_requests_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_requests` ADD CONSTRAINT `refund_requests_proposalId_proposals_id_fk` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_requests` ADD CONSTRAINT `refund_requests_storeUserId_storeUsers_id_fk` FOREIGN KEY (`storeUserId`) REFERENCES `storeUsers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_requests` ADD CONSTRAINT `refund_requests_distributorUserId_users_id_fk` FOREIGN KEY (`distributorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `storeDepartments` ADD CONSTRAINT `storeDepartments_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `storeIdentityProviders` ADD CONSTRAINT `storeIdentityProviders_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `poe_po_idx` ON `purchaseOrderEvents` (`purchaseOrderId`);--> statement-breakpoint
CREATE INDEX `po_order_idx` ON `purchaseOrders` (`orderId`);--> statement-breakpoint
CREATE INDEX `po_org_idx` ON `purchaseOrders` (`organizationId`);--> statement-breakpoint
CREATE INDEX `po_status_idx` ON `purchaseOrders` (`poStatus`);--> statement-breakpoint
CREATE INDEX `po_supplier_idx` ON `purchaseOrders` (`supplierCode`,`supplierSource`);--> statement-breakpoint
CREATE INDEX `supplier_org_name_idx` ON `suppliers` (`organizationId`,`normalizedName`);--> statement-breakpoint
CREATE INDEX `supplier_code_idx` ON `suppliers` (`code`,`source`);--> statement-breakpoint
CREATE INDEX `supplier_user_idx` ON `suppliers` (`userId`);--> statement-breakpoint
ALTER TABLE `productVariants` ADD CONSTRAINT `productVariants_pvProductId_products_id_fk` FOREIGN KEY (`pvProductId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `proposalProductVariants` ADD CONSTRAINT `proposalProductVariants_ppvProdId_proposalProducts_id_fk` FOREIGN KEY (`ppvProdId`) REFERENCES `proposalProducts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `clientLogos_clientId_idx` ON `clientLogos` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_cc_user_created` ON `copilot_conversations` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_cc_org_created` ON `copilot_conversations` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_cm_user_cat` ON `copilot_memory` (`userId`,`category`);--> statement-breakpoint
CREATE INDEX `idx_cm_user_key` ON `copilot_memory` (`userId`,`memoryKey`);--> statement-breakpoint
CREATE INDEX `idx_ctl_user_created` ON `copilot_task_log` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_ctl_org_created` ON `copilot_task_log` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `departmentApprovals_proposalId_idx` ON `departmentApprovals` (`proposalId`);--> statement-breakpoint
CREATE INDEX `estimates_proposalId_idx` ON `estimates` (`estProposalId`);--> statement-breakpoint
CREATE INDEX `invoices_proposalId_idx` ON `invoices` (`invProposalId`);--> statement-breakpoint
CREATE INDEX `orderItems_orderId_idx` ON `orderItems` (`orderId`);--> statement-breakpoint
CREATE INDEX `storeProducts_storeId_idx` ON `storeProducts` (`storeId`);--> statement-breakpoint
CREATE INDEX `storeProducts_productId_idx` ON `storeProducts` (`productId`);--> statement-breakpoint
CREATE INDEX `storeUsers_storeId_idx` ON `storeUsers` (`storeId`);--> statement-breakpoint
CREATE INDEX `storeUsers_email_idx` ON `storeUsers` (`email`);--> statement-breakpoint
CREATE INDEX `virtualProofs_proposalId_idx` ON `virtualProofs` (`proposalId`);--> statement-breakpoint
CREATE INDEX `virtualProofs_clientId_idx` ON `virtualProofs` (`clientId`);--> statement-breakpoint
ALTER TABLE `productVariants` DROP COLUMN `productId`;--> statement-breakpoint
ALTER TABLE `proposalProductVariants` DROP COLUMN `proposalProductId`;