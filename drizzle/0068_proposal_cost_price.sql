-- 0068_proposal_cost_price.sql
-- Adds nullable cost / wholesale price fields for PO generation.
-- These fields are NEVER surfaced in client-facing documents (proposals,
-- estimates, invoices); POs use costPrice (falling back to products.basePrice)
-- and show "TBD" if neither is populated.

ALTER TABLE proposalProducts
  ADD COLUMN costPrice DECIMAL(10, 2) NULL;

ALTER TABLE proposalOrderItems
  ADD COLUMN poiCostPrice DECIMAL(10, 2) NULL;
