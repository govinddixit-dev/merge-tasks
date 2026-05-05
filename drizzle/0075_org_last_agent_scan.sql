-- 0075_org_last_agent_scan.sql
-- Adds lastAgentScanAt timestamp to organizations so the proactive agent cron
-- and the manual "Run Agent Scan Now" endpoint can stamp the wall-clock time
-- of the most recent successful scan. The Agent Inbox empty state reads this
-- value to show "Last scanned: X minutes ago".
--
-- NULL until the first scan runs. Safe for re-run via IF NOT EXISTS guard.

ALTER TABLE `organizations`
  ADD COLUMN `lastAgentScanAt` TIMESTAMP NULL DEFAULT NULL;
