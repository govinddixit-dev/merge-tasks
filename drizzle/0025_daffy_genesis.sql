CREATE TABLE `orgMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`userId` int,
	`orgRole` enum('owner','admin','member') NOT NULL DEFAULT 'member',
	`invitedByUserId` int,
	`inviteEmail` varchar(320),
	`inviteToken` varchar(255),
	`inviteAcceptedAt` timestamp,
	`orgMemberCreatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orgMembers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`ownerId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `productVariants` MODIFY COLUMN `variantType` enum('color','size','logo_position') NOT NULL;--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `source` enum('manual','csv','api','asi','sage','promostandards') NOT NULL DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `proposalProductVariants` MODIFY COLUMN `ppvVariantType` enum('color','size','logo_position') NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `externalId` varchar(512);--> statement-breakpoint
ALTER TABLE `products` ADD `externalSource` enum('asi','promostandards');--> statement-breakpoint
ALTER TABLE `products` ADD `hasLiveInventory` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `supplierCode` varchar(64);--> statement-breakpoint
ALTER TABLE `products` ADD `productNumber` varchar(128);--> statement-breakpoint
ALTER TABLE `products` ADD `currency` varchar(8) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `colors` json;--> statement-breakpoint
ALTER TABLE `products` ADD `sizes` json;--> statement-breakpoint
ALTER TABLE `products` ADD `minQuantity` int;--> statement-breakpoint
ALTER TABLE `proposalOrderItems` ADD `poiLogoPosition` varchar(256);--> statement-breakpoint
CREATE INDEX `orgMembers_organizationId_idx` ON `orgMembers` (`organizationId`);--> statement-breakpoint
CREATE INDEX `orgMembers_userId_idx` ON `orgMembers` (`userId`);--> statement-breakpoint
CREATE INDEX `orgMembers_inviteToken_idx` ON `orgMembers` (`inviteToken`);--> statement-breakpoint
CREATE INDEX `organizations_ownerId_idx` ON `organizations` (`ownerId`);--> statement-breakpoint
CREATE INDEX `clients_userId_idx` ON `clients` (`userId`);--> statement-breakpoint
CREATE INDEX `productVariants_productId_idx` ON `productVariants` (`productId`);--> statement-breakpoint
CREATE INDEX `products_userId_idx` ON `products` (`userId`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`productStatus`);--> statement-breakpoint
CREATE INDEX `proposalOrderItems_proposalId_idx` ON `proposalOrderItems` (`poiProposalId`);--> statement-breakpoint
CREATE INDEX `proposalOrderItems_proposalProductId_idx` ON `proposalOrderItems` (`poiProposalProductId`);--> statement-breakpoint
CREATE INDEX `proposalProductVariants_ppId_idx` ON `proposalProductVariants` (`proposalProductId`);--> statement-breakpoint
CREATE INDEX `proposalProducts_proposalId_idx` ON `proposalProducts` (`proposalId`);--> statement-breakpoint
CREATE INDEX `proposalProducts_productId_idx` ON `proposalProducts` (`productId`);--> statement-breakpoint
CREATE INDEX `proposals_userId_idx` ON `proposals` (`userId`);--> statement-breakpoint
CREATE INDEX `proposals_clientId_idx` ON `proposals` (`clientId`);--> statement-breakpoint
CREATE INDEX `proposals_status_idx` ON `proposals` (`proposalStatus`);--> statement-breakpoint
CREATE INDEX `proposals_viewToken_idx` ON `proposals` (`viewToken`);--> statement-breakpoint
CREATE INDEX `verificationCodes_userId_idx` ON `verificationCodes` (`userId`);--> statement-breakpoint
CREATE INDEX `verificationCodes_email_idx` ON `verificationCodes` (`email`);