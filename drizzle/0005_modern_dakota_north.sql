ALTER TABLE `emailConnections` MODIFY COLUMN `provider` enum('gmail','outlook','smtp') NOT NULL;--> statement-breakpoint
ALTER TABLE `emailConnections` ADD `smtpHost` varchar(255);--> statement-breakpoint
ALTER TABLE `emailConnections` ADD `smtpPort` int;--> statement-breakpoint
ALTER TABLE `emailConnections` ADD `smtpUsername` varchar(255);--> statement-breakpoint
ALTER TABLE `emailConnections` ADD `smtpPassword` text;--> statement-breakpoint
ALTER TABLE `emailConnections` ADD `smtpSecure` boolean DEFAULT true;