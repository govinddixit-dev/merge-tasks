-- Migration 0034: Per-org AI Approval Level
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds the `aiApprovalLevel` column to the `organizations` table.
-- This controls how much autonomy the AI copilot has for each organization:
--
--   all_auto     — All tool calls execute immediately (no approval required).
--                  Suitable for power users who trust the AI.
--   review_auto  — SAFE-tier calls execute immediately; CONFIRM-tier calls
--                  require 1-click approval. (Default for all existing orgs)
--   all_review   — Every tool call requires approval, including SAFE reads.
--                  Maximum control; suitable for regulated environments.
--
-- Existing organizations default to 'review_auto' (conservative, preserves
-- current behavior before this feature was introduced).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `organizations`
  ADD COLUMN `aiApprovalLevel`
    ENUM('all_auto', 'review_auto', 'all_review')
    NOT NULL
    DEFAULT 'review_auto'
    COMMENT 'AI copilot autonomy level: all_auto | review_auto | all_review'
  AFTER `ownerId`;
