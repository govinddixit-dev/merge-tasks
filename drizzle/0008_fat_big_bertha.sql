CREATE TABLE `clientAssets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`clientId` int NOT NULL,
	`fileUrl` text NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileType` varchar(64),
	`fileSize` int,
	`assetCategory` enum('logo','brand_guide','artwork','document','photo','other') NOT NULL DEFAULT 'other',
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clientAssets_id` PRIMARY KEY(`id`)
);
