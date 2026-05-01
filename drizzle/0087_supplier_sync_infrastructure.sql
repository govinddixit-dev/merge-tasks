-- Phase 3: Supplier Sync Infrastructure
-- Adds PSRESTful Sub-Accounts support, supplier sync job tracking,
-- cost change audit log, and external customer ID mapping.
--
-- Changes:
--   1. CREATE psRestfulSubAccounts — maps clients to PRESTful sub-accounts
--   2. CREATE supplierSyncJobs — tracks sync runs per supplier
--   3. CREATE supplierCostChangeLog — permanent audit log of price changes
--   4. ALTER organizations — add externalCustomerId, subAccountsEnabled
--   5. ALTER clients — add externalCustomerId
--   6. ALTER suppliers — add psRestfulCode
--   7. ALTER notifications — add supplier_cost_change to notifType enum
--
-- Architecture notes:
--   - PSRestfulService routes all API calls through a single service layer.
--     Phase 1 (Standard): uses PSRESTFUL_MASTER_KEY env var for all requests.
--     Phase 2 (Enterprise): uses per-client sub-account key from psRestfulSubAccounts.
--   - Feature flag: USE_SUB_ACCOUNTS env var (kill switch) + organizations.subAccountsEnabled
--     (per-distributor toggle). Both must be true for sub-account keys to be used.
--   - externalCustomerId global uniqueness: mkf_org_xxx (organizations) and
--     mkf_client_xxx (clients) are globally unique across both tables by prefix convention.
--     CHECK constraints enforce the prefix at the database level.
--   - variantKey serialization: multi-dimension variants encoded as "size:XL|color:Red"
--     (pipe-separated dimension:value pairs). Consistent across all pricing tables.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. psRestfulSubAccounts
--    Maps a MergeTasks client to a PRESTful sub-account.
--    NULL apiKey = not yet provisioned → system falls back to master key.
--    apiKey encrypted via encryptCredential() — TEXT not VARCHAR (unpredictable length).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `psRestfulSubAccounts` (
  `id`                    INT          NOT NULL AUTO_INCREMENT,
  `clientId`              INT          NOT NULL,
  `organizationId`        INT          NULL,
  `psRestfulSubAccountId` INT          NULL,
  `externalCustomerId`    VARCHAR(255) NOT NULL,
  `apiKey`                TEXT         NULL,
  `isActive`              BOOLEAN      NOT NULL DEFAULT TRUE,
  `provisionedAt`         TIMESTAMP    NULL,
  `createdAt`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `prsa_client_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `prsa_org_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL,
  UNIQUE KEY `prsa_client_unique` (`clientId`),
  UNIQUE KEY `prsa_external_id_unique` (`externalCustomerId`),
  INDEX `prsa_org_idx` (`organizationId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. supplierSyncJobs
--    Tracks each sync run. syncScope NULL = full supplier sync.
--    syncScope JSON array of productIds = targeted sync (future use).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `supplierSyncJobs` (
  `id`               INT          NOT NULL AUTO_INCREMENT,
  `supplierId`       INT          NOT NULL,
  `organizationId`   INT          NOT NULL,
  `status`           ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  `trigger`          ENUM('manual','scheduled','webhook') NOT NULL DEFAULT 'manual',
  `syncScope`        JSON         NULL COMMENT 'NULL = full sync. JSON array of productIds for targeted sync.',
  `productsScanned`  INT          NOT NULL DEFAULT 0,
  `productsUpdated`  INT          NOT NULL DEFAULT 0,
  `priceChanges`     INT          NOT NULL DEFAULT 0,
  `errorMessage`     TEXT         NULL,
  `startedAt`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completedAt`      TIMESTAMP    NULL,
  `createdAt`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `ssj_supplier_fk` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`),
  CONSTRAINT `ssj_org_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`),
  INDEX `ssj_supplier_idx` (`supplierId`, `createdAt`),
  INDEX `ssj_org_idx` (`organizationId`, `createdAt`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. supplierCostChangeLog
--    Permanent audit log — never purge. Partition by createdAt if volume demands.
--    variantKey format: "size:XL" or "size:XL|color:Red" (pipe-separated).
--    Future optimization: add clientId column if notification query needs it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `supplierCostChangeLog` (
  `id`                BIGINT    NOT NULL AUTO_INCREMENT,
  `supplierId`        INT       NOT NULL,
  `productId`         INT       NOT NULL,
  `variantKey`        VARCHAR(256) NULL COMMENT 'Format: "size:XL" or "size:XL|color:Red" (pipe-separated multi-dimension)',
  `previousCostCents` BIGINT    NULL COMMENT 'NULL on first sync — no previous price exists',
  `newCostCents`      BIGINT    NOT NULL,
  `currency`          CHAR(3)   NOT NULL,
  `syncJobId`         INT       NOT NULL,
  `notificationSent`  BOOLEAN   NOT NULL DEFAULT FALSE,
  `createdAt`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `sccl_supplier_fk` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`),
  CONSTRAINT `sccl_product_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`),
  CONSTRAINT `sccl_job_fk` FOREIGN KEY (`syncJobId`) REFERENCES `supplierSyncJobs`(`id`),
  INDEX `sccl_product_history_idx` (`supplierId`, `productId`, `createdAt`),
  INDEX `sccl_notification_idx` (`notificationSent`, `createdAt`),
  INDEX `sccl_job_idx` (`syncJobId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ALTER organizations
--    externalCustomerId: globally unique, prefix mkf_org_xxx enforced by CHECK.
--    subAccountsEnabled: per-distributor toggle for PSRESTful Sub-Accounts.
--    Two-layer flag: USE_SUB_ACCOUNTS env (kill switch) AND this column must both
--    be true before sub-account keys are used.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `organizations`
  ADD COLUMN `externalCustomerId` VARCHAR(255) NULL,
  ADD COLUMN `subAccountsEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT `org_external_id_unique` UNIQUE (`externalCustomerId`),
  ADD CONSTRAINT `org_external_id_prefix` CHECK (`externalCustomerId` IS NULL OR `externalCustomerId` LIKE 'mkf_org_%');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ALTER clients
--    externalCustomerId: primary PSRESTful Sub-Account mapping.
--    Globally unique — mkf_client_xxx prefix enforced by CHECK.
--    See organizations.externalCustomerId for mkf_org_xxx convention.
--    IMPORTANT: mkf_org_xxx and mkf_client_xxx are globally unique across both
--    tables by prefix convention. Never change the prefix without updating both.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `clients`
  ADD COLUMN `externalCustomerId` VARCHAR(255) NULL,
  ADD CONSTRAINT `client_external_id_unique` UNIQUE (`externalCustomerId`),
  ADD CONSTRAINT `client_external_id_prefix` CHECK (`externalCustomerId` IS NULL OR `externalCustomerId` LIKE 'mkf_client_%');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ALTER suppliers
--    psRestfulCode: supplier's code in the PRESTful network.
--    Used by the sync engine to know which supplier endpoint to call.
--    Examples: "SanMar", "pcna", "alphabroder"
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `suppliers`
  ADD COLUMN `psRestfulCode` VARCHAR(64) NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ALTER notifications — add supplier_cost_change to notifType enum
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `notifications` MODIFY COLUMN `notifType` ENUM(
  'proposal_sent','proposal_viewed','proposal_approved','proposal_declined',
  'order_placed','order_shipped','order_delivered',
  'store_order','store_user_joined',
  'payment_received','invoice_overdue',
  'approval_requested','approval_granted','approval_denied',
  'ai_insight','system',
  'po_created','po_sent','po_acknowledged','po_shipped','po_received','po_overdue',
  'custom_order_request',
  'print_request',
  'supplier_cost_change'
) NOT NULL DEFAULT 'system';
