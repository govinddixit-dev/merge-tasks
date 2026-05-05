ALTER TABLE `distributorProfiles` ADD `brandLogoUrl` text;--> statement-breakpoint
ALTER TABLE `distributorProfiles` ADD `brandLogoOriginalUrl` text;--> statement-breakpoint
ALTER TABLE `distributorProfiles` ADD `brandPrimaryColor` varchar(7) DEFAULT '#654BF9';--> statement-breakpoint
ALTER TABLE `distributorProfiles` ADD `brandSecondaryColor` varchar(7) DEFAULT '#1A1A1A';--> statement-breakpoint
ALTER TABLE `distributorProfiles` ADD `brandCompanyName` varchar(255);