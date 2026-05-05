CREATE TABLE `storeAllowedDomains` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`domain` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `storeAllowedDomains_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storeUsers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(255),
	`storeUserRole` enum('admin','manager','employee','intern') NOT NULL DEFAULT 'employee',
	`department` varchar(128),
	`spendingLimit` decimal(10,2),
	`pointsBalance` int NOT NULL DEFAULT 0,
	`storeUserStatus` enum('active','invited','suspended') NOT NULL DEFAULT 'invited',
	`lastLoginAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storeUsers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storeVerificationCodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`code` varchar(6) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`used` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `storeVerificationCodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stores` ADD `ssoProvider` enum('microsoft_entra','google_workspace','okta','none') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `allowedEmailsJson` json;--> statement-breakpoint
ALTER TABLE `stores` ADD `requireAuth` boolean DEFAULT true NOT NULL;