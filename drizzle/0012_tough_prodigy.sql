CREATE TABLE `aiEditFeedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trainingDataId` int NOT NULL,
	`entityType` varchar(50) NOT NULL,
	`entityId` int NOT NULL,
	`userId` int NOT NULL,
	`fieldName` varchar(100) NOT NULL,
	`valueBefore` text,
	`valueAfter` text,
	`editType` enum('replace','refine','delete') NOT NULL DEFAULT 'replace',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiEditFeedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `aiTrainingData` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` varchar(50) NOT NULL,
	`entityId` int NOT NULL,
	`userId` int,
	`inputContext` json NOT NULL,
	`systemPrompt` text,
	`aiOutput` json NOT NULL,
	`modelId` varchar(100),
	`wasAccepted` boolean DEFAULT true,
	`wasEdited` boolean DEFAULT false,
	`storeOrderCount` int DEFAULT 0,
	`storeViewCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiTrainingData_id` PRIMARY KEY(`id`)
);
