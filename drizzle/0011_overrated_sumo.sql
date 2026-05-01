ALTER TABLE `stores` ADD `aiDescription` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `aiTagline` varchar(512);--> statement-breakpoint
ALTER TABLE `stores` ADD `aiCategoryDescriptions` json;--> statement-breakpoint
ALTER TABLE `stores` ADD `aiOptimizedAt` timestamp;