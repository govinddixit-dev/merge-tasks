-- Migration: Create audit_log table for PCI DSS Req 10.2 compliance
-- This table is append-only. The application DB user should ideally have
-- only INSERT and SELECT privileges on this table (no UPDATE, no DELETE).
-- Retention: keep at least 90 days of data (PCI DSS Req 10.7).

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `timestamp` VARCHAR(30) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `user_id` INT DEFAULT NULL,
  `actor_email` VARCHAR(255) DEFAULT NULL,
  `ip` VARCHAR(45) DEFAULT NULL,
  `resource_type` VARCHAR(64) DEFAULT NULL,
  `resource_id` VARCHAR(255) DEFAULT NULL,
  `description` TEXT NOT NULL,
  `metadata` JSON DEFAULT NULL,
  INDEX `idx_audit_timestamp` (`timestamp`),
  INDEX `idx_audit_action` (`action`),
  INDEX `idx_audit_user_id` (`user_id`),
  INDEX `idx_audit_resource` (`resource_type`, `resource_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
