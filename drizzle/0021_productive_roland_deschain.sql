CREATE TABLE `storePasswordTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`storeUserId` int NOT NULL,
	`token` varchar(64) NOT NULL,
	`tokenType` enum('set_password','reset_password') NOT NULL DEFAULT 'set_password',
	`tokenExpiresAt` timestamp NOT NULL,
	`tokenUsed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `storePasswordTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `storePasswordTokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `storeUsers` ADD `passwordHash` varchar(255);