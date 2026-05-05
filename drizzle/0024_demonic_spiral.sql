CREATE TABLE `proposalVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`proposalId` int NOT NULL,
	`userId` int NOT NULL,
	`authorName` varchar(255) NOT NULL,
	`snapshotTitle` varchar(255),
	`snapshotEstimatedValue` decimal(12,2),
	`snapshotStatus` varchar(64),
	`snapshotProductCount` int,
	`snapshotDepartmentCount` int,
	`changes` json NOT NULL,
	`versionAction` enum('created','updated','sent','reverted') NOT NULL DEFAULT 'updated',
	`versionCreatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `proposalVersions_id` PRIMARY KEY(`id`)
);
