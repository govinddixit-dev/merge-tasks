CREATE TABLE `collectionProducts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`collectionId` int NOT NULL,
	`productId` int NOT NULL,
	`addedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `collectionProducts_id` PRIMARY KEY(`id`),
	CONSTRAINT `cp_collection_product_idx` UNIQUE(`collectionId`,`productId`)
);
--> statement-breakpoint
CREATE TABLE `productCollections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`organizationId` int,
	`name` varchar(255) NOT NULL,
	`description` text,
	`color` varchar(32) NOT NULL DEFAULT '#654BF9',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `productCollections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `collectionProducts` ADD CONSTRAINT `collectionProducts_collectionId_productCollections_id_fk` FOREIGN KEY (`collectionId`) REFERENCES `productCollections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collectionProducts` ADD CONSTRAINT `collectionProducts_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `productCollections` ADD CONSTRAINT `productCollections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `productCollections` ADD CONSTRAINT `productCollections_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `cp_collectionId_idx` ON `collectionProducts` (`collectionId`);--> statement-breakpoint
CREATE INDEX `cp_productId_idx` ON `collectionProducts` (`productId`);--> statement-breakpoint
CREATE INDEX `collections_userId_idx` ON `productCollections` (`userId`);--> statement-breakpoint
CREATE INDEX `collections_orgId_idx` ON `productCollections` (`organizationId`);