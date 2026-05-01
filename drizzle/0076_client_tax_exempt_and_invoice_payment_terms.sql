-- 0076_client_tax_exempt_and_invoice_payment_terms.sql
-- Two additive columns needed by the split-view Document Canvas invoice
-- creation flow:
--
--   1. clients.taxExempt — per-client tax-exempt flag. The canvas seeds
--      each line-item's Taxable toggle from this value. NULL-safe default
--      FALSE so every existing client keeps today's behaviour (taxable).
--
--   2. invoices.paymentTerms — the selected payment-terms label (e.g.
--      "net_30", "due_on_receipt", "custom"). Stored alongside dueDate so
--      the UI can re-render the selector on the detail page without
--      guessing backwards from a date. NULL on legacy rows; the detail
--      page treats NULL as "no terms recorded" and falls back to showing
--      just the dueDate.
--
-- Both are idempotent: MySQL raises error 1060 on re-run, but the
-- --force flag in scripts/migrate.sh ignores per-statement duplicates
-- while still recording the file as applied.

ALTER TABLE `clients`
  ADD COLUMN `taxExempt` BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE `invoices`
  ADD COLUMN `invPaymentTerms` VARCHAR(32) NULL DEFAULT NULL;
