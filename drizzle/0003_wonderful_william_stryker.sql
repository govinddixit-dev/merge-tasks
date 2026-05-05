CREATE TABLE `clientLogos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`clientId` int NOT NULL,
	`logoUrl` text NOT NULL,
	`logoName` varchar(255) NOT NULL,
	`fileSize` int,
	`mimeType` varchar(64),
	`isPrimary` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clientLogos_id` PRIMARY KEY(`id`)
);
