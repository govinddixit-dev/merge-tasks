-- Add aiApprovalLevel column to `users` so solo users (no organization) can
-- configure copilot approval behavior. The org-level column of the same name
-- on `organizations` is unchanged; consumers must read from this users column
-- only when the request has no resolved organizationId.
ALTER TABLE `users` ADD COLUMN `aiApprovalLevel`
  ENUM('all_auto','review_auto','all_review')
  NOT NULL DEFAULT 'review_auto';
