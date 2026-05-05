-- Migration 0029: PCI DSS Req 8.1.6 — Account lockout columns + Audit log timestamp fix
-- Adds per-account lockout tracking to both platform users and store users.
-- Also fixes audit_log.timestamp from VARCHAR(30) to DATETIME(3) for proper temporal queries.

-- 1. Platform users: lockout columns
ALTER TABLE `users`
  ADD COLUMN `failedLoginAttempts` INT NOT NULL DEFAULT 0,
  ADD COLUMN `lockedUntil` TIMESTAMP NULL DEFAULT NULL;

-- 2. Store users: lockout columns
ALTER TABLE `storeUsers`
  ADD COLUMN `failedLoginAttempts` INT NOT NULL DEFAULT 0,
  ADD COLUMN `lockedUntil` TIMESTAMP NULL DEFAULT NULL;

-- 3. Widen OTP code columns from VARCHAR(6) to VARCHAR(64) for SHA-256 hashes
ALTER TABLE `verificationCodes` MODIFY COLUMN `code` VARCHAR(64) NOT NULL;
ALTER TABLE `storeVerificationCodes` MODIFY COLUMN `code` VARCHAR(64) NOT NULL;

-- 4. Fix audit_log timestamp column from VARCHAR to DATETIME(3)
-- Step 1: Add new column
ALTER TABLE `audit_log` ADD COLUMN `ts` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
-- Step 2: Migrate existing data (ISO 8601 strings → DATETIME)
UPDATE `audit_log` SET `ts` = STR_TO_DATE(`timestamp`, '%Y-%m-%dT%H:%i:%s') WHERE `timestamp` IS NOT NULL AND `timestamp` != '';
-- Step 3: Drop old column and rename
ALTER TABLE `audit_log` DROP COLUMN `timestamp`;
ALTER TABLE `audit_log` CHANGE COLUMN `ts` `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
-- Step 4: Index idx_audit_timestamp already exists from 0028 (created with original timestamp column)
