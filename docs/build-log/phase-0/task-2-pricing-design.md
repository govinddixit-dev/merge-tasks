# Phase 0 Task 2 — Unified Pricing Engine: Schema Design

**Status:** Complete — ready for Phase 1 implementation  
**Author:** Yan + Claude planning session  
**Date:** 2026-04-22  
**Commit target:** `/docs/build-log/phase-0/task-2-pricing-design.md`

---

## Overview

This document is the authoritative design specification for the MergeTasks Unified Pricing Engine. It replaces the three divergent pricing systems currently in the codebase (`customPrice`, `proposalPriceTiers`, `printProductPricing`) with a single resolver-backed engine.

All locked decisions from the 2026-04-21 state-of-play doc are respected. No scope from Phase 1.5 or later phases is introduced here.

---

## Section 1 — Drizzle Schema

### Foundational work (Phase 1 prerequisites)

These two items must be completed before the pricing engine tables are built. They unblock clean FK relationships and the generic variant model required by the locked decisions.

#### 1a. Modify `productVariants` — loosen enum to VARCHAR

The existing `variantType` column is a hardcoded MySQL enum: `["color", "size", "logo_position"]`. This contradicts the locked decision that variants are generic — defined by the supplier API, not hardcoded in the database.

**Change:** Replace `mysqlEnum("variantType", [...])` with `varchar("variantType", { length: 128 })`.

No data loss. Existing values (`color`, `size`, `logo_position`) are valid VARCHAR values. Migration backfills nothing — existing rows are already strings.

#### 1b. Create `decorationMethods` table

No standalone decoration methods table exists. Decoration methods are currently stored as a JSON array on the products record (line 117) and as a hardcoded enum on proposal products (line 463). Neither supports FK relationships.

```typescript
export const decorationMethods = mysqlTable("decorationMethods", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
```

**Seed data on migration:** `embroidery`, `screen_print`, `laser_engraving`, `heat_transfer`, `dtg`, `sublimation`, `deboss`, `patch` — sourced from the existing enum values.

The JSON arrays on product records are migrated to FKs in Phase 3 (Supplier Sync) when the supplier adapter is built. Phase 1 seeds the table and uses it for `clientProductDecorationMethod` only.

---

### Pricing engine tables

All money stored as integer cents (BIGINT). No decimals on price columns. Tax rates remain decimals (ratios, not amounts).

---

#### Table 1 — `masterProductPricing`

Supplier cost track. What the distributor pays the supplier. Sourced from supplier API sync. Distributor never edits manually. One row per (product, variant, quantity tier, supplier).

#### Table 2 — `clientProductConfig`

Anchor record per client × product combination. All client-product pricing configuration hangs off this record. One row per (clientId, productId).

#### Table 3 — `clientProductPricingTiers`

Client sell price track. What the client pays the distributor, by quantity range. Child of `clientProductConfig`. One row per (config, tier break).

#### Table 3b — `clientProductVariantUpcharges`

Per-variant upcharge added on top of the base tier unit price. Implements Option A: base tier price + per-variant upcharge. Child of `clientProductConfig`. One row per (config, variantKey).

#### Table 4 — `clientProductOtherCosts`

Persistent free-form line items per client-product. Zero or more rows per config. Distinguishes buying-side costs (affect margin, not invoiced to client) from selling-side costs (invoiced to client). Soft-deleted.

#### Table 5 — `clientProductDecorationMethod`

One decoration method per client-product for the webstore context. Holds setup fee. Unique constraint on clientProductConfigId enforces one-per-client-product. Soft-deleted.

---

## Section 2 — Migration Plan

### System 1 — `customPrice` on `storeProducts` → retire

For every `storeProduct` row where `customPrice IS NOT NULL`: create `clientProductConfig` + single `clientProductPricingTiers` row (minQty:1, maxQty:null, unitPriceCents: customPrice × 100). Column retained post-migration, hard-deleted Phase 6.

### System 2 — `proposalPriceTiers` → preserve historical, replace going forward

Historical proposals untouched. New proposals call resolver at creation time, stamp result, freeze. `proposalPriceTiers` deprecated Phase 6.

### System 3 — `printProductPricing` → no migration, out of scope

Separate subsystem (business cards, flyers, banners, posters). Resolver does not touch it.

### Money conversion

All existing decimal price values × 100, stored as BIGINT cents.

### Decoration methods seed

Seed `decorationMethods` from existing enum values on migration. JSON arrays on product records migrated to FKs in Phase 3.

---

## Section 3 — Resolver Function Signature

Single resolver function. Every pricing touchpoint calls this and nothing else.

**Inputs:** clientId, productId, quantity, variantKey (nullable), decorationMethodId (nullable), includeOtherCosts (boolean)

**Outputs:** unitPriceCents, variantUpchargeCents, setupFeeCents, setupFeeMode, otherCosts[], displayMode, resolvedAt, fallbackUsed

**Fallback rules:**
1. Client pricing exists in `clientProductPricingTiers` → use matching tier
2. No client pricing → fall back to `products.basePrice`, set fallbackUsed: true
3. No basePrice → throw PricingNotFoundError. Never silently return zero.

**fallbackUsed surface:** ⚠ warning badge in price matrix popup when true.

---

## Section 4 — PRESTful-Compatible Adapter Contract

Interface only. No implementation in Phase 1. Every supplier integration must implement both methods.

**Method 1 — `getSupplierCost`:** takes (supplierId, productId, variantKey?) → returns tiers[] with nativeCostCents + nativeCurrency + syncedAt

**Method 2 — `getProductVariants`:** takes (supplierId, productId) → returns variants[] with variantKey + label. Never returns null — empty array if supplier has no variants.

**Currency:** Adapters return native currency. Pricing engine converts to distributor home currency. Both stored on the row (nativeCostCents + unitCostCents).

---

## Section 5 — Price Matrix Popup UI Spec

### Layout
Wide modal, two-column. Left: supplier cost reference (read-only, greyed). Right: client pricing (editable). Bottom bar: margin indicator.

### Header
Product thumbnail + name + client name + ⚠ "Using default pricing" badge (when fallbackUsed: true)

### Left column
Supplier name + syncedAt. Quantity tier table (Qty range | Unit cost | Variant). Additional charges buying list. All in distributor home currency.

### Right column panels
1. Unit pricing tiers — editable table (Min qty | Max qty | Unit price). Add/remove tier.
2. Variant upcharges — per-variant upcharge inputs. Visible only if product has variants.
3. Decoration method + setup fee — dropdown + amount + one_time/per_order toggle.
4. Additional charges selling — free-form rows (label + amount + buying/selling toggle).
5. Display mode — itemize vs roll_into_unit radio.

### Margin indicator (bottom bar)
Live calculated. Shows: Total selling price | Total buying cost | Profit | Margin %. Colour: green ≥ 20%, yellow 10-19%, red < 10%. Threshold configurable Phase 4.

### Interactions
Autosave on blur. Single save button. Live margin recalculation. ⚠ badge dismissed on first tier save.

---

## Section 6 — Regression Baseline Plan

**Before migration snapshots:** customPrice values, proposalPriceTiers row count, printProductPricing row count.

**After migration checks:**
- Every customPrice → clientProductPricingTiers row at ×100
- proposalPriceTiers row count unchanged
- printProductPricing row count unchanged
- Zero parseFloat in pricing paths
- PDP and checkout agree on three test products

**End-to-end price trace (three products):**
- Product A: single flat price, no variants, no setup fee
- Product B: three quantity tiers, no variants
- Product C: two tiers + variant upcharges + setup fee + two selling other costs

Full journey per product: PDP → cart → checkout → proposal → webhook. Resolver output asserted at every step. Committed as `/scripts/regression/price-trace.ts`.

---

## Section 7 — Gate Criteria Verification Plan

| Gate criterion | Verification method |
|---|---|
| One resolver, three systems retired | grep confirms zero direct reads of customPrice/proposalPriceTiers outside resolver |
| Supplier/client cost separated | Schema review — distinct tables, no cross-references |
| Integer cents, no parseFloat | grep returns zero hits in pricing files |
| PDP and checkout agree | End-to-end price trace — Products A, B, C |
| Proposal acceptance re-validates | Webhook step of price trace — billing integrity bug confirmed closed |
| Price matrix popup works | Manual QA — edit, save, reload, confirm persisted. ⚠ warning appears/dismisses correctly |
| PRESTful contract defined | This document committed |
| No billing regression | Snapshot script clean. Price trace passes all steps |
| All tests pass | npm run build exits zero. Zero TS errors. Zero ts-ignore |

---

## Appendix — What Phase 1 does NOT deliver

- Estimate migration — Phase 6
- Polished price matrix UI — Phase 4
- Org hierarchy changes — Phase 1.5
- pricingResolverLog table — Phase 6 or 7
- PRESTful/ASI/PromoStandards implementation — Phase 3
- Per-location pricing — rejected entirely

---

*End of Phase 0 Task 2 — Unified Pricing Engine: Schema Design*  
*Committed: 2026-04-22*
