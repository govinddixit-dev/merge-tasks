-- 0066_proposal_acceptance_comment.sql
-- Adds a dedicated column to capture the free-form comment a POC leaves
-- when accepting a proposal (either via request-fulfillment or override).
-- Until now the comment was only concatenated into `proposals.notes`
-- alongside system audit markers, which made it impossible to surface
-- the client's words distinctly on the distributor's proposal detail page.
-- The value is NULL when no comment was provided (or for Stripe-paid
-- acceptances where the flow does not collect free text).
ALTER TABLE `proposals`
  ADD COLUMN `acceptanceComment` TEXT NULL;
