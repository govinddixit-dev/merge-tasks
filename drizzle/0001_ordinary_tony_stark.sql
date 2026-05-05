CREATE TABLE `apiConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`baseUrl` varchar(1024) NOT NULL,
	`format` enum('rest_json','rest_xml','graphql','soap') NOT NULL DEFAULT 'rest_json',
	`authType` enum('api_key','oauth2','basic_auth','none') NOT NULL DEFAULT 'api_key',
	`credentials` json,
	`fieldMapping` json,
	`lastSyncAt` timestamp,
	`syncStatus` enum('connected','error','pending','never') NOT NULL DEFAULT 'never',
	`productCount` int NOT NULL DEFAULT 0,
	`apiStatus` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apiConnections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`companyName` varchar(255) NOT NULL,
	`industry` varchar(128),
	`companySize` varchar(64),
	`website` varchar(512),
	`address` text,
	`contactName` varchar(255) NOT NULL,
	`contactTitle` varchar(128),
	`contactEmail` varchar(320) NOT NULL,
	`contactPhone` varchar(32),
	`hasWebstore` boolean NOT NULL DEFAULT false,
	`status` enum('active','inactive','prospect') NOT NULL DEFAULT 'prospect',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orderItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`productId` int NOT NULL,
	`quantity` int NOT NULL,
	`unitPrice` decimal(10,2) NOT NULL,
	`totalPrice` decimal(10,2) NOT NULL,
	`decorationType` varchar(128),
	`size` varchar(32),
	`color` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orderItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`clientId` int NOT NULL,
	`storeId` int,
	`proposalId` int,
	`orderNumber` varchar(32) NOT NULL,
	`orderStatus` enum('pending','processing','production','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
	`subtotal` decimal(12,2) NOT NULL,
	`tax` decimal(10,2) NOT NULL DEFAULT '0.00',
	`shipping` decimal(10,2) NOT NULL DEFAULT '0.00',
	`total` decimal(12,2) NOT NULL,
	`shippingName` varchar(255),
	`shippingAddress` text,
	`trackingNumber` varchar(128),
	`paymentMethod` enum('credit_card','po_number','gl_code','company_points') DEFAULT 'credit_card',
	`paymentReference` varchar(255),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`sku` varchar(128),
	`category` enum('apparel','drinkware','tech','bags','writing','wellness','outdoor','office','other') NOT NULL DEFAULT 'other',
	`type` enum('promotional','print') NOT NULL DEFAULT 'promotional',
	`description` text,
	`supplier` varchar(255),
	`supplierSku` varchar(128),
	`basePrice` decimal(10,2),
	`imageUrl` varchar(1024),
	`additionalImages` json,
	`decorationMethods` json,
	`pricingTiers` json,
	`source` enum('manual','csv','api','asi','sage') NOT NULL DEFAULT 'manual',
	`sourceApiId` varchar(255),
	`productStatus` enum('active','inactive','draft') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proposalProducts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`proposalId` int NOT NULL,
	`productId` int NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unitPrice` decimal(10,2),
	`decorationType` varchar(128),
	`decorationNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `proposalProducts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`clientId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`proposalType` enum('promo','print','promo_print') NOT NULL DEFAULT 'promo',
	`proposalStatus` enum('draft','sent','viewed','accepted','declined','expired') NOT NULL DEFAULT 'draft',
	`estimatedValue` decimal(12,2),
	`deliveryMethod` enum('email','webstore','both') NOT NULL DEFAULT 'email',
	`storeId` int,
	`stripeCheckout` boolean NOT NULL DEFAULT false,
	`multiDepartment` boolean NOT NULL DEFAULT false,
	`virtualProofs` boolean NOT NULL DEFAULT false,
	`notes` text,
	`validDays` int NOT NULL DEFAULT 30,
	`sentAt` timestamp,
	`viewedAt` timestamp,
	`respondedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `proposals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storeProducts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`productId` int NOT NULL,
	`customPrice` decimal(10,2),
	`featured` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `storeProducts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`clientId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`storeType` enum('permanent','popup') NOT NULL DEFAULT 'permanent',
	`logoUrl` varchar(1024),
	`primaryColor` varchar(7) DEFAULT '#6C2BD9',
	`bannerUrl` varchar(1024),
	`welcomeMessage` text,
	`stripeEnabled` boolean NOT NULL DEFAULT false,
	`multiDepartment` boolean NOT NULL DEFAULT false,
	`rbacEnabled` boolean NOT NULL DEFAULT false,
	`ssoEnabled` boolean NOT NULL DEFAULT false,
	`startDate` timestamp,
	`endDate` timestamp,
	`linkedStoreId` int,
	`storeStatus` enum('active','inactive','setup') NOT NULL DEFAULT 'setup',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stores_id` PRIMARY KEY(`id`)
);
