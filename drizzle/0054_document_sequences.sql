-- 0054_document_sequences.sql
-- Adds:
--   1. documentSequences — per-org/user atomic counter for PO/EST/INV numbering.
--   2. poPreviewDrafts   — short-lived AI-generated PO preview payloads.
--
-- Both tables are zero-regression: no existing rows are touched and old
-- nanoid-based document numbers continue to render as-is. New documents
-- created on or after this migration will use sequential numbers starting
-- at 1001 per organization (or per user for solo accounts).

CREATE TABLE IF NOT EXISTS `documentSequences` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `organizationId` INT NULL,
  `userId` INT NOT NULL,
  `docType` VARCHAR(16) NOT NULL,
  `nextNumber` INT NOT NULL DEFAULT 1001,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `docseq_org_user_doctype_idx` (`organizationId`, `userId`, `docType`),
  CONSTRAINT `docseq_org_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations` (`id`),
  CONSTRAINT `docseq_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Allow proposal-only POs (no parent order) by making purchaseOrders.orderId nullable.
-- All existing rows have a non-null orderId so this is a non-destructive widen.
ALTER TABLE `purchaseOrders` MODIFY COLUMN `orderId` INT NULL;

-- Add a proposalId column on purchaseOrders so proposal-based generation
-- can be traced and queried efficiently. Nullable; FK to proposals.id.
ALTER TABLE `purchaseOrders` ADD COLUMN `proposalId` INT NULL AFTER `orderId`;
ALTER TABLE `purchaseOrders`
  ADD CONSTRAINT `po_proposal_fk` FOREIGN KEY (`proposalId`) REFERENCES `proposals` (`id`);
CREATE INDEX `po_proposal_idx` ON `purchaseOrders` (`proposalId`);

CREATE TABLE IF NOT EXISTS `poPreviewDrafts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(64) NOT NULL,
  `organizationId` INT NULL,
  `userId` INT NOT NULL,
  `payload` JSON NOT NULL,
  `sourceProposalIds` JSON NOT NULL,
  `expiresAt` TIMESTAMP NOT NULL,
  `confirmedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `popd_token_uniq` (`token`),
  KEY `popd_token_idx` (`token`),
  KEY `popd_org_idx` (`organizationId`),
  KEY `popd_expires_idx` (`expiresAt`),
  CONSTRAINT `popd_org_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations` (`id`),
  CONSTRAINT `popd_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
