-- 0061_dept_approval_token_expiry.sql
-- Adds optional expiry to department approval tokens. Expiry is controlled
-- per-proposal by the POC: when `approvalLinkExpiryEnabled` is true, each
-- approval token is stamped with `tokenExpiresAt = issuance + 72h`. When
-- false (the default), tokens never expire — preserving existing behaviour.
--
-- Zero-regression: both columns default to a null/false state; existing
-- rows retain indefinite-link semantics.

ALTER TABLE `proposals`
  ADD COLUMN `approvalLinkExpiryEnabled` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `departmentApprovals`
  ADD COLUMN `tokenExpiresAt` TIMESTAMP NULL DEFAULT NULL;
