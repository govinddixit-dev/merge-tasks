-- Phase 1.5: Add ssoGroup to storeUsers for SSO mapping health indicator.
-- Captures the SSO group name at login time so unmapped groups can be surfaced to the POC.
-- NULL for non-SSO users and SSO users who logged in before this migration.

ALTER TABLE `storeUsers`
  ADD COLUMN `ssoGroup` VARCHAR(255) NULL AFTER `ssoSubject`;
