-- Migration 0033: AI Audit Log + Copilot Pending Actions
-- ─────────────────────────────────────────────────────────────────────────────
-- Part 1: aiAuditLog
--   Layer 5 of the AI Architecture — pre-flight audit of every LLM invocation.
--   This table is written by safeLLM.ts before each call to the LLM provider.
--   It stores a SHA-256 hash of the sanitized prompt payload and the full
--   sanitized payload itself as proof of what was sent to the model.
--
--   Retention: keep at least 90 days (PCI DSS Req 10.7 analogue for AI calls).
--   The application DB user should have INSERT + SELECT only (no UPDATE/DELETE).
--
-- Part 2: copilotPendingActions
--   Layer 2 of the AI Architecture — Human Approval Gate.
--   Stores tool calls that require human confirmation before execution.
--   Status lifecycle: pending → approved | denied
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Part 1: AI Audit Log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `aiAuditLog` (
  `id`               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `organizationId`   INT NULL,
  `userId`           INT NULL,
  `messageCount`     INT NOT NULL,
  `toolCount`        INT NOT NULL DEFAULT 0,
  `model`            VARCHAR(128) NOT NULL,
  `promptHash`       VARCHAR(64) NOT NULL COMMENT 'SHA-256 hex of the sanitized payload',
  `promptSizeBytes`  INT NOT NULL,
  `sanitizedPayload` MEDIUMTEXT NOT NULL COMMENT 'Complete sanitized message array sent to LLM (MEDIUMTEXT = 16 MB, avoids truncation on long multi-tool conversations)',
  `compressed`       BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Whether sanitizedPayload is gzip-compressed (base64-encoded)',
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `aal_org_created_idx` (`organizationId`, `createdAt`),
  INDEX `aal_hash_idx` (`promptHash`),
  INDEX `aal_user_idx` (`userId`),
  CONSTRAINT `fk_aal_org`  FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_aal_user` FOREIGN KEY (`userId`)         REFERENCES `users`(`id`)         ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Append-only pre-flight audit log for every LLM invocation. No UPDATE or DELETE.';

-- ── Part 2: Copilot Pending Actions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `copilotPendingActions` (
  `id`             INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId`         INT NOT NULL,
  `organizationId` INT NULL,
  `toolCallId`     VARCHAR(128) NOT NULL COMMENT 'LLM-assigned tool call ID for conversation continuity',
  `toolName`       VARCHAR(128) NOT NULL COMMENT 'Tool function name, e.g. send_proposal',
  `summary`        TEXT NOT NULL COMMENT 'Human-readable description shown in the approval card',
  `serializedArgs` TEXT NOT NULL COMMENT 'Full JSON-serialized arguments for the tool call',
  `cpaStatus`      ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `denyReason`     TEXT NULL COMMENT 'Optional reason provided when denying',
  `resolvedAt`     DATETIME(3) NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `cpa_user_status_idx` (`userId`, `cpaStatus`),
  INDEX `cpa_org_idx` (`organizationId`),
  INDEX `cpa_created_idx` (`createdAt`),
  CONSTRAINT `fk_cpa_user` FOREIGN KEY (`userId`)         REFERENCES `users`(`id`)         ON DELETE CASCADE,
  CONSTRAINT `fk_cpa_org`  FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Copilot tool calls awaiting human approval. Status: pending → approved | denied.';
