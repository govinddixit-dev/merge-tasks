# Migration Journal Fix (C2)

## Problem

The Drizzle migration journal (`meta/_journal.json`) was missing entries for migrations 0027 through 0047. Additionally, two orphan migration files existed with duplicate numbers:

- `0025_organizations_multitenancy.sql` (duplicate of `0025_daffy_genesis.sql`)
- `0026_external_products_columns.sql` (duplicate of `0026_dashing_lady_deathstrike.sql`)

These files were present on disk but had no corresponding entries in the journal, meaning Drizzle's migration runner would not recognize or execute them.

## Fix Applied

Added journal entries for all missing migrations (idx 27-49):

| idx | Tag (filename without .sql) | Note |
|-----|----------------------------|------|
| 27 | `0025_organizations_multitenancy` | Orphan duplicate of 0025 |
| 28 | `0026_external_products_columns` | Orphan duplicate of 0026 |
| 29 | `0027_add_foreign_keys` | |
| 30 | `0028_create_audit_log_table` | |
| 31 | `0029_pci_lockout_and_audit_fix` | |
| 32 | `0030_complete_foreign_keys` | |
| 33 | `0031_store_identity_providers` | |
| 34 | `0032_add_refund_support` | |
| 35 | `0033_ai_audit_log_and_pending_actions` | |
| 36 | `0034_org_ai_approval_level` | |
| 37 | `0035_copilot_memory_indexes` | |
| 38 | `0036_store_product_inventory` | |
| 39 | `0037_store_departments` | |
| 40 | `0038_stores_tax_rate` | |
| 41 | `0039_proposals_paid_at` | |
| 42 | `0040_purchase_orders` | |
| 43 | `0041_po_notification_types` | |
| 44 | `0042_suppliers_directory` | |
| 45 | `0043_checkout_enhancements` | |
| 46 | `0044_order_attribution_promo_custom` | |
| 47 | `0045_custom_request_notif_type` | |
| 48 | `0046_ai_product_page_fields` | |
| 49 | `0047_agent_source_column` | |

## Important Notes

- No SQL migration files were modified. This was a metadata-only fix to `_journal.json`.
- The duplicate-numbered files (`0025_organizations_multitenancy` and `0026_external_products_columns`) were given sequential idx values after the existing entries to avoid renumbering.
- Future migrations should continue from number `0048` onward to avoid further conflicts.
- If these migrations have already been applied to the database manually, the Drizzle migration runner's `__drizzle_migrations` table may need to be updated to reflect the new journal state.
