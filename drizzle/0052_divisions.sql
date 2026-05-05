-- Multi-Division Architecture — additive only; zero regression on existing orgs.
-- Adds an optional business-unit layer between Organization and Department.
-- Gated behind the enterprise tier at the application layer (see server/routers/divisions.ts).

CREATE TABLE IF NOT EXISTS `divisions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organizationId` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `code` varchar(64) DEFAULT NULL,
  `settings` json DEFAULT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `divisions_organizationId_idx` (`organizationId`),
  UNIQUE KEY `divisions_org_code_uniq` (`organizationId`, `code`),
  CONSTRAINT `divisions_organizationId_fk` FOREIGN KEY (`organizationId`)
    REFERENCES `organizations` (`id`) ON DELETE CASCADE
);

-- Associate existing departments to a division (nullable; NULL = legacy org-level).
ALTER TABLE `storeDepartments`
  ADD COLUMN `divisionId` int DEFAULT NULL,
  ADD KEY `storeDepartments_divisionId_idx` (`divisionId`),
  ADD CONSTRAINT `storeDepartments_divisionId_fk` FOREIGN KEY (`divisionId`)
    REFERENCES `divisions` (`id`) ON DELETE SET NULL;
