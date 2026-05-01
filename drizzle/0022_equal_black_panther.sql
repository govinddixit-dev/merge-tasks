CREATE TABLE `estimates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`estUserId` int NOT NULL,
	`estProposalId` int NOT NULL,
	`estClientId` int NOT NULL,
	`estimateNumber` varchar(32) NOT NULL,
	`estStatus` enum('draft','sent','accepted','declined','converted') NOT NULL DEFAULT 'draft',
	`estLineItems` json,
	`estSubtotal` decimal(12,2) NOT NULL,
	`estTax` decimal(10,2) NOT NULL DEFAULT '0.00',
	`estShipping` decimal(10,2) NOT NULL DEFAULT '0.00',
	`estTotal` decimal(12,2) NOT NULL,
	`estNotes` text,
	`estValidDays` int NOT NULL DEFAULT 30,
	`convertedToInvoiceId` int,
	`estSentAt` timestamp,
	`estCreatedAt` timestamp NOT NULL DEFAULT (now()),
	`estUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `estimates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invUserId` int NOT NULL,
	`invProposalId` int,
	`invEstimateId` int,
	`invClientId` int NOT NULL,
	`invOrderId` int,
	`invoiceNumber` varchar(32) NOT NULL,
	`invStatus` enum('draft','sent','paid','overdue','cancelled','void') NOT NULL DEFAULT 'draft',
	`invLineItems` json,
	`invSubtotal` decimal(12,2) NOT NULL,
	`invTax` decimal(10,2) NOT NULL DEFAULT '0.00',
	`invShipping` decimal(10,2) NOT NULL DEFAULT '0.00',
	`invTotal` decimal(12,2) NOT NULL,
	`invNotes` text,
	`invPaidAt` timestamp,
	`invPaymentMethod` varchar(64),
	`invPaymentReference` varchar(255),
	`invStripePaymentIntentId` varchar(255),
	`invDueDate` timestamp,
	`invSentAt` timestamp,
	`invCreatedAt` timestamp NOT NULL DEFAULT (now()),
	`invUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `productVariants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`variantType` enum('color','size') NOT NULL,
	`value` varchar(128) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `productVariants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proposalOrderItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`poiProposalId` int NOT NULL,
	`poiProposalProductId` int NOT NULL,
	`poiProductId` int NOT NULL,
	`poiColor` varchar(128),
	`poiSize` varchar(128),
	`poiQuantity` int NOT NULL DEFAULT 1,
	`poiUnitPrice` decimal(10,2),
	`poiComment` text,
	`poiCreatedAt` timestamp NOT NULL DEFAULT (now()),
	`poiUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `proposalOrderItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proposalPriceTiers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pptProposalProductId` int NOT NULL,
	`tierType` enum('quantity','size') NOT NULL,
	`tierLabel` varchar(128) NOT NULL,
	`tierMinQty` int,
	`tierMaxQty` int,
	`tierPrice` decimal(10,2) NOT NULL,
	`tierSortOrder` int NOT NULL DEFAULT 0,
	`tierCreatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `proposalPriceTiers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proposalProductImages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ppiProposalProductId` int NOT NULL,
	`ppiImageUrl` varchar(1024) NOT NULL,
	`ppiSortOrder` int NOT NULL DEFAULT 0,
	`ppiCreatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `proposalProductImages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proposalProductVariants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`proposalProductId` int NOT NULL,
	`ppvVariantType` enum('color','size') NOT NULL,
	`ppvValue` varchar(128) NOT NULL,
	`ppvSortOrder` int NOT NULL DEFAULT 0,
	`ppvCreatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `proposalProductVariants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proposalSizeCharts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pscProposalProductId` int NOT NULL,
	`pscChartData` json,
	`pscImageUrl` varchar(1024),
	`pscCreatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `proposalSizeCharts_id` PRIMARY KEY(`id`)
);
