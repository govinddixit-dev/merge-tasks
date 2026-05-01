CREATE TABLE `distributorProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`companyName` varchar(255),
	`companySize` varchar(64),
	`annualRevenue` varchar(64),
	`yearsInBusiness` varchar(32),
	`specialties` json,
	`topCategories` json,
	`targetIndustries` json,
	`primaryGoal` varchar(255),
	`currentTools` varchar(512),
	`teamSize` varchar(32),
	`aiRecommendations` json,
	`aiWelcomeMessage` text,
	`onboardingCompleted` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `distributorProfiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verificationCodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`code` varchar(6) NOT NULL,
	`codeType` enum('login_2fa','signup_verify','password_reset') NOT NULL DEFAULT 'login_2fa',
	`expiresAt` timestamp NOT NULL,
	`used` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verificationCodes_id` PRIMARY KEY(`id`)
);
