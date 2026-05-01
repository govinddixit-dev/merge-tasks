CREATE TABLE `copilot_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`summary` text,
	`messages` json NOT NULL,
	`messageCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `copilot_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `copilot_memory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`category` varchar(64) NOT NULL,
	`memoryKey` varchar(128) NOT NULL,
	`memoryValue` text NOT NULL,
	`confidence` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `copilot_memory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `copilot_task_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`taskType` varchar(64) NOT NULL,
	`taskData` json NOT NULL,
	`taskSummary` text NOT NULL,
	`taskLogStatus` enum('completed','failed') NOT NULL DEFAULT 'completed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `copilot_task_log_id` PRIMARY KEY(`id`)
);
