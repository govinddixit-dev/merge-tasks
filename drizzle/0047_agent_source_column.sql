-- Migration: 0047_agent_source_column
-- Distinguishes agent-initiated proposals from user-initiated CONFIRM actions.
-- Nullable with no default — existing rows will have NULL (treated as 'user').

-- The column in 0033_ai_audit_log_and_pending_actions.sql is `cpaStatus`,
-- not `status` — an earlier revision of this file referenced `status` and
-- hard-failed on fresh-DB replays.
ALTER TABLE copilotPendingActions
  ADD COLUMN `source` ENUM('user', 'agent') NULL AFTER `cpaStatus`;
