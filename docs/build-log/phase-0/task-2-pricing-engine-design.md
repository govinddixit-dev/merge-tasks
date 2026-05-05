# Phase 0 Task 2 — Unified Pricing Engine Schema & API Design

**Status:** Draft for Yan review
**Author:** Phase 0 Task 2
**Date:** 2026-04-20
**Scope:** Design only — no code, no migrations. See "Deliverables" in the Task 2 prompt.
**Implemented by:** Phase 1 (Unified Pricing Engine)

---

## Section 1 — Design Overview

### 1.1 Locked decisions (restated for reference)

These three decisions are locked by the user and govern the entire design. They are not revisited here.

1. **Decoration cost granularity: Medium.** Decoration cost is tracked per method + per location + a flat decoration unit rate. Setup fees are tracked separately per method. The schema must not preclude a future upgrade to full granularity (stitch count, per-color) — all decoration-cost columns are designed so a future migration can add finer-grained columns without breaking existing data.
2. **Cost storage model: Global cost with per-webstore markup.** Product base cost, decoration rates, and setup fees live globally at the master catalog layer (fed by supplier APIs). Markup is applied per-webstore at calculation time. A per-webstore `costOverride` column exists as deferred flexibility (nullable, not surfaced in Phase 1 UI; rare case: negotiated deals). Per-product price override per webstore (`storeProducts.customPrice` today) is retained and continues to bypass calculated price when set.
3. **Mixed-cart / unified engine: Strategy pattern.** ONE pricing engine with a `productType` discriminator routes to `PromoCalculator` or `PrintCalculator`. Both calculators return the same `PriceBreakdown` shape. Cart, checkout, invoice, and order records consume the unified shape — they do not branch on `productType`.

### 1.2 What this design replaces

The current MergeTasks codebase contains **three parallel pricing systems**, each with a different storage model and calculation path. Audit results (file:line citations from a repo-wide read performed 2026-04-20):

| System | Storage | Calculation site | Status |
|---|---|---|---|
| **Webstore flat/tiered** | `storeProducts.customPrice` (`drizzle/schema.ts:273`) as a per-store override; `products.basePrice` (`drizzle/schema.ts:112`) as fallback; `products.pricingTiers` JSON (`drizzle/schema.ts:119`) as quantity-tier data | Server fallback: `server/routers/storeCheckout.ts:432` and `:993` — `customPrice ?? basePrice`. Client tier selection (webstore PDP): `client/src/pages/webstore/StoreProductDetailPage.tsx:78-84` — matches qty against `pricingTiers`. Catalog serialization: `server/routers/storesCatalog.ts:145,310`, `server/routers/storesCrud.ts:145,309`. | **All three paths consumed by webstore.** See **§1.4 Correction** below. |
| **Proposals** | `proposalPriceTiers` table (`drizzle/schema.ts:1005-1015`) with `tierType: "quantity" | "size"`, `label`, `minQty`, `maxQty`, `price`, `sortOrder`; `proposalProducts.unitPrice` fallback; `proposalOrderItems.unitPrice` + `costPrice` (`drizzle/schema.ts:1023-1043`) | Public view tier hydration: `server/routes/publicProposal/publicProposalHelpers.ts:340-352` and display mapping `:423-432`. Cascade delete: `server/routers/proposalsCrud.ts:422`. Estimate-creation pricing: `server/routers/estimatesInvoices.ts:316-333` — reads `unitPrice ?? basePrice`, no tier evaluation. | **Only partially tier-aware.** The proposal public view returns tier data but the estimate flow ignores tiers entirely and uses flat `unitPrice`. This is a bug surfaced by audit — logged in §6. |
| **Print products** | `printProductPricing` table (`drizzle/schema.ts:1476-1485`) with `printProductVariantId`, `quantity`, `priceInCents` | Variant hydration: `server/routers/printProducts.ts:42-74` (specifically the `hydrateVariants` helper). Write-side: `server/routers/printProducts.ts:200-206` (insert), `:258-264` and `:385-390` (delete-then-insert update). Client tier match: `client/src/pages/PrintStore.tsx:104,175` and `client/src/pages/webstore/StoreProductDetailPage.tsx:78-84`. | Cleanest of the three systems but completely disjoint from promo. |

The pricing-related fields on `products` (`drizzle/schema.ts:101-149`) that interact with this design:

- `type: mysqlEnum(["promotional", "print"])` at `:108` — **this enum already exists.** The rebuild design uses this existing column as the strategy-pattern discriminator. See §3.1. (Note: name is `type`, not `productType`. The design below uses `productType` in prose and TypeScript; the schema column name stays `type` to avoid an unnecessary rename migration. If Yan prefers the rename, flagged in §6.)
- `decorationMethods: json("decorationMethods").$type<string[]>()` at `:117` — a flat list of method names (e.g. `["embroidery", "screen_print"]`). No rate, setup fee, or location data. Readers: `server/routers/storesCrud.ts:308`, `server/routers/copilotExec/clientsProducts.ts:170`, `server/integrations/productSearchAdapter.ts:39,116,261`, `server/routers/proposalsCrud.ts:154`. Today this column only describes *which methods are available*; it says nothing about *cost*.
- `pricingTiers: json(...).$type<{minQty,maxQty,price}[]>()` at `:119` — quantity-tier data used at webstore PDP.
- `printAreas`, `printMethods`, `printColors`, `minOrderQty`, `fileSpecs` at `:134-139` — print-only fields currently co-located on `products`. See §3.4.

The `stores` table (`drizzle/schema.ts:183-261`) has `taxRate` and `currency` but **no markup/margin column of any kind**. The rebuild introduces one.

### 1.3 Design north star

One canonical pricing API. Strategy-pattern internals: `PromoCalculator` vs `PrintCalculator`, chosen by `products.type`, both returning the same `PriceBreakdown`. Every consumer — checkout, cart, proposal, estimate, invoice, order — calls `pricingEngine.calculatePrice(...)` and consumes `PriceBreakdown`. Agent-accessible: the same function is exposed as a tRPC procedure and an agent tool, with `orgScope` enforcement unchanged. Every new column is supported by a Phase 1 migration that also deletes the column it replaces in the same commit (Principle #2, #3, #4).

### 1.4 Correction to the Task 2 prompt

**RESOLVED 2026-04-21 per Yan (Decision A, §6.1):** treat `products.pricingTiers` as live data; §5.1 runs full backfill. The repo audit was correct. The remainder of this section is preserved for historical context.

The Task 2 prompt states that `products.pricingTiers` is "dead code today per audit." **The repo audit performed 2026-04-20 contradicts that claim.** `products.pricingTiers` is the primary quantity-tier source consumed by:
- `client/src/pages/webstore/StoreProductDetailPage.tsx:78-84` (webstore PDP tier matching — the live customer-facing calculation)
- `client/src/pages/ProductDetail.tsx:158-163` (distributor dashboard)
- `client/src/pages/PrintStore.tsx:104,175`
- `server/routers/storesCrud.ts:309`, `server/routers/copilotExec/clientsProducts.ts:171` (serialized out of product listing APIs)
- `server/routers/products.ts:150,312` (write path, validated by `pricingTierSchema` at `:105-110`)

Treating it as dead would cause data loss on Phase 1 migration. The design in §3.3 and §5.1 assumes `products.pricingTiers` has live production data and migrates it into the new `productPriceTiers` table. **Yan: please confirm this interpretation before Phase 1 starts.** Logged in §6.1.

---

## Section 2 — Unified `PriceBreakdown` Response Shape

Every calculator returns one `PriceBreakdown` per line item. The cart/checkout/invoice/order surfaces consume this shape directly and never compute prices themselves (Principle #6 — policy is declarative, not hardcoded in UI).

```ts
// shared/pricing/types.ts (Phase 1)

/**
 * Canonical price breakdown returned by every calculator. Consumed by cart,
 * checkout, estimate, invoice, order-history, and the pricing agent tool.
 *
 * All monetary values are in MINOR UNITS (integer cents). Decimal arithmetic
 * is confined to the calculator; every caller sees cents. This matches the
 * existing `priceToCents()` convention in server/routers/storeCheckout.ts:133.
 */
export interface PriceBreakdown {
  /** Stable reference to the line the calculation was run for. Assigned by
   *  the caller (cart row id, proposal line id, or a synthetic ULID for
   *  preview-only calculations). Lets the client correlate breakdowns with
   *  cart rows without re-matching on productId+options. */
  lineItemId: string;

  /** Strategy-pattern discriminator. Echoed from products.type for the
   *  caller's convenience — the caller should not have to re-fetch the
   *  product to know which calculator ran. */
  productType: "promo" | "print";

  /** Units requested. Echoed back so callers can trust one source of truth
   *  (the calculator) rather than re-deriving from cart state. */
  quantity: number;

  /** Base cost per unit in cents, AFTER quantity-tier resolution but BEFORE
   *  decoration and markup. For promo: selected tier price. For print: the
   *  printProductPricing row matched to quantity. Distributor-facing COGS
   *  per unit, used by the distributor dashboard to show margin. */
  baseUnitCostCents: number;

  /** Sum of per-unit decoration cost across all selected methods/locations
   *  (medium granularity — see §3.2). Setup fees are NOT included here; they
   *  are a line-level fixed cost (see setupFeesTotalCents). */
  decorationUnitCostCents: number;

  /** Fixed setup fees for all decoration methods on this line, in cents.
   *  Not per-unit. Shown to the customer as a separate line (e.g. "$50
   *  one-time setup"). */
  setupFeesTotalCents: number;

  /** Markup rate applied to this line as a decimal (0.35 = 35%). Pulled
   *  from stores.markupPct or an override — see §3.6. Included so the
   *  distributor dashboard can show "you set 35% markup on this store"
   *  without re-querying. */
  markupAppliedPct: number;

  /** Customer-facing unit price in cents, after markup and decoration but
   *  before setup fees (which are line-level, not per-unit). Computed as:
   *    round((baseUnitCostCents + decorationUnitCostCents)
   *      * (1 + markupAppliedPct)).
   *  If storeProducts.customPrice is set, this equals that override and
   *  the decoration/markup contribution is zero — see §3.5. */
  unitSellPriceCents: number;

  /** Customer-facing line subtotal in cents. Equals:
   *    unitSellPriceCents * quantity + setupFeesTotalCents.
   *  This is what the cart/checkout displays per line. Tax and shipping are
   *  NOT included — those are handled downstream (Stripe Tax / shipping
   *  rules), which stay untouched per protected-subsystems.md. */
  lineSubtotalCents: number;

  /** Quantity tiers available for this product, for display in the
   *  customer PDP and proposal view. Returned in full (not just the current
   *  tier) so the UI can show "buy 50 → save 10%" hints without a second
   *  round trip. */
  tierBreakdown: Array<{
    minQty: number;
    maxQty: number | null; // null = unlimited upper bound
    /** Customer-facing unit sell price at this tier, post-markup. */
    unitSellPriceCents: number;
    /** Distributor cost at this tier, post-decoration. Included so the
     *  distributor dashboard can render margin per tier without recomputing. */
    baseUnitCostCents: number;
  }>;

  /** Index into tierBreakdown of the tier that matched `quantity`. -1 if
   *  the product has no tiers (flat-price). */
  appliedTierIndex: number;

  /** Distributor-only margin view. Never sent to customer-facing surfaces
   *  (see §4.4 for API contract). Contains the raw cost inputs so the
   *  dashboard can show margin without extra queries. */
  distributorCostView: {
    /** Pre-markup line COGS in cents:
     *    (baseUnitCostCents + decorationUnitCostCents) * quantity
     *      + setupFeesTotalCents. */
    lineCostCents: number;
    /** Post-markup customer subtotal in cents (mirrors lineSubtotalCents). */
    lineRevenueCents: number;
    /** Margin in cents (revenue − cost). */
    lineMarginCents: number;
    /** Margin as a percentage of revenue (0..1). */
    lineMarginPct: number;
    /** Whether this line was priced via storeProducts.customPrice override
     *  (bypassing calculated markup). If true, the distributor dashboard
     *  should flag "custom price overrides markup" so margin changes aren't
     *  silent. */
    usedCustomPriceOverride: boolean;
    /** Whether storeProducts.costOverride was applied (the "negotiated deal"
     *  path). Surfaced for audit. */
    usedCostOverride: boolean;
  };
}

/**
 * Calculation-time context. Passed to every calculator call. All IDs are
 * integers matching Drizzle schema PKs.
 */
export interface PricingContext {
  /** Multi-tenant scope. Mandatory. orgScope enforcement (protected
   *  subsystem) requires that the product and the store both belong to
   *  this org; mismatch throws. */
  orgId: number;
  /** Store the line is being priced for. Drives markup lookup and
   *  customPrice / costOverride resolution. */
  storeId: number;
  /** Optional customer identity for future per-customer pricing. Unused in
   *  Phase 1; reserved in context so the interface doesn't change when
   *  per-customer pricing ships. */
  customerId?: number;
  /** Selected decoration method (e.g. "embroidery"). Required when the
   *  product has any decorationRate rows; the engine throws if required
   *  and unset. */
  requestedDecorationMethod?: string;
  /** Selected imprint-zone FK (productImprintZones.id — see Task 3).
   *  Required when the product has any imprint zones; throws if required
   *  and unset. */
  requestedImprintZoneId?: number;
  /** Optional: force a specific quantity tier. Only used by preview tools
   *  ("show me the price at tier 3 even though qty is 1"). Unused in
   *  live checkout. */
  forceTierIndex?: number;
  /** Selected size (e.g. "XL", "3XL"). When set, calculator prefers
   *  size-matched tier from productPriceTiers; falls back to size-agnostic
   *  tier (sizeLabel = NULL) when absent. Per Decision B (§6.2 RESOLVED
   *  2026-04-21). */
  sizeLabel?: string;
  /** When set, calculator checks proposalPriceOverrides before
   *  productPriceTiers for this line. Per Decision C (§6.4 RESOLVED
   *  2026-04-21). */
  proposalProductId?: number;
  /** Print-product finishing upcharges (e.g. ["matte_lamination",
   *  "spot_uv"]). PrintCalculator adds matching printFinishingRates rows
   *  to decorationUnitCostCents / setupFeesTotalCents. Per Decision G
   *  (§6.6 RESOLVED 2026-04-21). */
  selectedFinishingOptions?: string[];
}
```

**Note — Decisions 37 & 38 (2026-04-22):** Multi-department approval and multi-division webstores were promoted to IN SCOPE as first-class features in Task 5. `PricingContext.departmentId` and `PricingContext.divisionId` become **first-class required-where-applicable fields** in the Phase 1 implementation (not optional placeholders). The interface as drafted above shows them as absent / reserved via §6.8 and §6.9 language; Phase 1 expands the interface to carry them explicitly. Pricing engine integrates both as calculation dimensions. See `rebuild-2026-q2.md` Decisions 37 and 38.

**Field-by-field justification (who consumes what, why at this layer):**

- `lineItemId`, `productType`, `quantity` — echoed for caller convenience; avoids re-query.
- `baseUnitCostCents`, `decorationUnitCostCents`, `setupFeesTotalCents` — the three cost inputs. Returned separately (instead of summed) because the distributor dashboard shows them broken out, and the cart UI shows setup fees as a distinct line. Summing early would require re-derivation.
- `markupAppliedPct` — returned explicitly because the distributor UI shows the rate, and agents need it to explain pricing decisions ("your store's markup is 35%").
- `unitSellPriceCents`, `lineSubtotalCents` — the two customer-facing numbers. Computed server-side; the client must not recompute (Principle #6).
- `tierBreakdown` + `appliedTierIndex` — returned as a full array so the PDP can display "buy more, save more" without a second call. `appliedTierIndex` is a pointer, not a duplicate of the tier data, to keep the response size bounded.
- `distributorCostView` — nested rather than flat to make the customer-vs-distributor split visually obvious in the type and trivially stripped by a single property omission when the response is serialized to a customer-facing endpoint (see §4.4).

---

## Section 3 — Schema Design

Every table or column added below is accompanied by a Phase 1 migration that, in the same commit:
1. Adds the new column/table.
2. Backfills data from the column/table it replaces.
3. Drops the replaced column/table.
4. Updates `drizzle/_journal.json` (per `feedback_migration_journal` memory).

Per Principle #4, migrations name the column they retire. No parallel paths survive Phase 1.

### 3.1 — `products` table modifications

```ts
// drizzle/schema.ts — products table (proposed deltas)

export const products = mysqlTable("products", {
  // ... existing columns kept: id, userId, organizationId, name, sku,
  // category, description, supplier, supplierSku, basePrice, imageUrl,
  // additionalImages, source, sourceApiId, externalId, externalSource,
  // hasLiveInventory, supplierCode, productNumber, currency, colors, sizes,
  // minQuantity, minOrderQty, status, createdAt, updatedAt.

  // --- STRATEGY DISCRIMINATOR ---
  // KEEP existing column: type: mysqlEnum("type", ["promotional", "print"])
  // Rename in code (TypeScript) to productType for clarity in calculator
  // dispatch; column name stays "type" to avoid a rename migration. See §6.3.

  // --- REMOVED COLUMNS (Phase 1 migration drops these) ---
  // REMOVE: decorationMethods: json.$type<string[]>()
  //   REASON: subsumed by productDecorationRates (§3.2). The existing JSON
  //   lists method names only; the new table carries names + rates + setup
  //   fees + location. Migration reads each product's string[] and creates
  //   placeholder productDecorationRates rows (see §5.2).
  // REMOVE: pricingTiers: json.$type<{minQty,maxQty,price}[]>()
  //   REASON: subsumed by productPriceTiers (§3.3). Migration reads the
  //   JSON array and inserts one productPriceTiers row per element.
  // REMOVE: printAreas, printMethods, printColors, fileSpecs
  //   REASON: print-specific; migrated to printProductSpecs (§3.4).

  // --- NEW / KEPT ---
  // basePrice stays; it is the flat/starting cost when the product has no
  // tiers. When tiers exist, basePrice equals the qty=1 tier's price (see
  // §5.4 on backfill).
}, (t) => ({ /* existing indexes kept */ }));
```

**Design intent:** reuse the existing `type` enum as the strategy discriminator. The enum values `"promotional"` / `"print"` map to the TypeScript `PromoCalculator` / `PrintCalculator`. Adding a new column when one already exists would violate Principle #3 (no parallel paths). Note the name mismatch: the task prompt says `productType`; the column is `type`. Column name stays; TS type `ProductType = "promotional" | "print"` aliases it.

**What happens to `products.decorationMethods`:** **replaced by `productDecorationRates`.** See §3.2 and migration §5.2.

**What happens to `products.pricingTiers`:** **replaced by `productPriceTiers`.** Production data present (§1.4); migration loops through every product and inserts one row per tier entry (§5.1).

### 3.2 — `productDecorationRates` (new table)

Per product × method × location: decoration unit rate and setup fee. Fed by supplier adapters in Phase 3. Medium-granularity per locked decision #1.

```ts
export const productDecorationRates = mysqlTable("productDecorationRates", {
  id: int("id").autoincrement().primaryKey(),

  productId: int("productId").notNull().references(() => products.id, { onDelete: "cascade" }),

  /** Decoration method. String rather than enum so suppliers can introduce
   *  new methods without a schema migration. Validated at write time
   *  against a declarative allow-list (Principle #6; allow-list ships in
   *  Phase 2 config, not hardcoded in UI). */
  method: varchar("method", { length: 64 }).notNull(),

  /** Imprint location / position string. Kept deliberately free-form for
   *  Phase 1. Position-as-percentage and multi-location modeling live in
   *  productImprintZones (Task 3). When this row is linked to an imprint
   *  zone the `imprintZoneId` FK below is set and `location` becomes a
   *  display string; for products without zones, `location` stands alone. */
  location: varchar("location", { length: 128 }).notNull(),

  /** FK to productImprintZones.id (Task 3). NULL for Phase 1 until zones
   *  ship. The FK contract Task 3 must satisfy: an int PK named `id`, a
   *  `productId` FK, and unique index on (productId, zoneKey) so this row
   *  can reference a zone deterministically. */
  imprintZoneId: int("imprintZoneId"),

  /** Per-unit decoration cost in cents. Flat rate per unit; no stitch-count
   *  or per-color tiering in Phase 1. */
  unitRateCents: int("unitRateCents").notNull(),

  /** One-time setup fee for this method/location in cents. Applied once per
   *  line, independent of quantity. */
  setupFeeCents: int("setupFeeCents").notNull(),

  /** Source of this rate — `"supplier_api"`, `"manual"`, `"csv_import"`.
   *  Lets Phase 3 supplier sync know whether it's safe to overwrite. */
  source: mysqlEnum("source", ["supplier_api", "manual", "csv_import"]).default("manual").notNull(),

  /** Legacy-placeholder flag. Set TRUE by the §5.2 migration for rows
   *  created from the retired products.decorationMethods JSON. Per
   *  Decision H (2026-04-21 engineering override). When true, calculator
   *  treats unitRateCents and setupFeeCents as zero and does NOT throw
   *  decorationRateNotSet — the row advertises that the method is
   *  available but no charge is set yet. Phase 2 supplier sync clears the
   *  flag when real rates arrive; Phase 6 cleanup sweep enumerates the
   *  remaining legacyPlaceholder = true rows for a distributor-dashboard
   *  "products needing decoration rates set" report. */
  legacyPlaceholder: boolean("legacyPlaceholder").default(false).notNull(),

  /** Future-proofing for full granularity (locked decision #1). These stay
   *  NULL in Phase 1 and are populated only when a product opts into full
   *  granularity. Presence is gated in the calculator — see §4.3. */
  stitchCountRangeMin: int("stitchCountRangeMin"),
  stitchCountRangeMax: int("stitchCountRangeMax"),
  colorCount: int("colorCount"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  productIdIdx: index("productDecorationRates_productId_idx").on(t.productId),
  productMethodIdx: index("productDecorationRates_productMethod_idx").on(t.productId, t.method),
  imprintZoneIdIdx: index("productDecorationRates_imprintZoneId_idx").on(t.imprintZoneId),
  // Enforce uniqueness per product × method × location so supplier syncs
  // update in place instead of duplicating rows.
  uniqMethodLocation: uniqueIndex("productDecorationRates_uniq_method_location")
    .on(t.productId, t.method, t.location),
}));
```

**Design intent:**
- Medium granularity today (unit rate + setup fee). Stitch/color columns nullable so Phase 3 or later can adopt full granularity without a schema break.
- The `imprintZoneId` FK is **nullable in Phase 1** because Task 3 ships the zones table. Phase 2 backfills. The FK contract Task 3 owes this table is listed in §7.1.
- `source` column lets Phase 3 sync know whether a rate is safe to overwrite (never overwrite `manual` without confirmation).
- `legacyPlaceholder` column (Decision H, 2026-04-21) lets §5.2 migration preserve the "decoration available but rate unknown" state without landmines; calculator treats such rows as zero-charge and does **not** throw. Phase 2 supplier sync clears the flag; Phase 6 cleanup sweep surfaces remainders to distributors.

**Migration note:** new table; no data to migrate *into* it. `products.decorationMethods` is retired in the same migration — see §5.2 for the backfill path.

### 3.3 — `productPriceTiers` (new table)

Quantity-tiered base cost per product. Consolidates `products.pricingTiers`, `proposalPriceTiers`, `printProductPricing`.

```ts
export const productPriceTiers = mysqlTable("productPriceTiers", {
  id: int("id").autoincrement().primaryKey(),

  productId: int("productId").notNull().references(() => products.id, { onDelete: "cascade" }),

  /** Inclusive lower bound of this quantity tier. */
  minQty: int("minQty").notNull(),

  /** Inclusive upper bound; NULL = unlimited. The calculator treats NULL as
   *  "match any qty >= minQty". */
  maxQty: int("maxQty"),

  /** Per-unit base cost at this tier, in cents. Pre-decoration, pre-markup. */
  unitCostCents: int("unitCostCents").notNull(),

  /** Ordering for display in the PDP and proposal view; not used in tier
   *  matching (matching is by minQty/maxQty). */
  sortOrder: int("sortOrder").default(0).notNull(),

  /** Source — same semantics as productDecorationRates.source. */
  source: mysqlEnum("source", ["supplier_api", "manual", "csv_import"]).default("manual").notNull(),

  /** Size-label match for apparel upcharges (e.g. "XL", "3XL"). NULL means
   *  size-agnostic (tier applies to any size). Per Decision B (§6.2
   *  RESOLVED 2026-04-21). Calculator prefers a size-matched tier when
   *  ctx.sizeLabel is set, else falls back to sizeLabel = NULL tiers. */
  sizeLabel: varchar("sizeLabel", { length: 16 }),

  /** Nullable FK to printProductVariants.id. NULL for promo products
   *  (tier applies to the product as a whole). Set for print-product tiers
   *  (tier applies to one specific variant — size/stock combo). Per
   *  Decision D (§6.7 RESOLVED 2026-04-21) — variant model preserved. */
  variantId: int("variantId"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  productIdIdx: index("productPriceTiers_productId_idx").on(t.productId),
  productQtyIdx: index("productPriceTiers_productQty_idx").on(t.productId, t.minQty),
  variantIdIdx: index("productPriceTiers_variantId_idx").on(t.variantId),
  uniqTier: uniqueIndex("productPriceTiers_uniq").on(t.productId, t.variantId, t.sizeLabel, t.minQty),
}));
```

**Design intent:** one tier table covers all three legacy systems. No print-specific fields; print-vs-promo differences live in §3.4.

**Field coverage audit** (does this table cover every field of the three tables it replaces?):

| Source table.column | New location | Covered? |
|---|---|---|
| `products.pricingTiers[].minQty` | `productPriceTiers.minQty` | ✅ |
| `products.pricingTiers[].maxQty` | `productPriceTiers.maxQty` | ✅ |
| `products.pricingTiers[].price` | `productPriceTiers.unitCostCents` (converted dollars→cents) | ✅ |
| `proposalPriceTiers.proposalProductId` | `proposalPriceOverrides.proposalProductId` (new table §3.8, per Decision C) | ✅ |
| `proposalPriceTiers.tierType = "quantity"` | implicit (this table is quantity-only) | ✅ |
| `proposalPriceTiers.tierType = "size"` | `productPriceTiers.sizeLabel` (per Decision B) or `proposalPriceOverrides.sizeLabel` (per-proposal, Decision C) | ✅ |
| `proposalPriceTiers.label` ("1-9") | computed from minQty/maxQty at display time | ✅ (computed) |
| `proposalPriceTiers.minQty`, `maxQty` | `productPriceTiers.minQty`, `maxQty` | ✅ |
| `proposalPriceTiers.price` | `productPriceTiers.unitCostCents` | ✅ |
| `proposalPriceTiers.sortOrder` | `productPriceTiers.sortOrder` | ✅ |
| `printProductPricing.printProductVariantId` | `productPriceTiers.variantId` (per Decision D) | ✅ |
| `printProductPricing.quantity` | `productPriceTiers.minQty` (single-qty rows expand to `minQty = maxQty = quantity`) | ✅ with §5.3 migration note |
| `printProductPricing.priceInCents` | `productPriceTiers.unitCostCents` | ✅ |

**Coverage gaps from the original draft are CLOSED by the 2026-04-21 resolutions:**

- **Proposal-specific tiers** are preserved via the new `proposalPriceOverrides` table (§3.8) per Decision C.
- **Variant-specific tiers** are preserved via the new `productPriceTiers.variantId` FK (per Decision D) — variant model retained rather than collapsed or promoted.
- **Size-based tiers** are preserved via the new `productPriceTiers.sizeLabel` column (per Decision B); calculator matches on `ctx.sizeLabel` and falls back to size-agnostic tiers when absent.

All three gaps were blocking Phase 1 start in the original draft; all three are resolved.

### 3.4 — `printProductSpecs` (new table)

Print-only fields. Recommendation: **separate table, not JSON column.**

```ts
export const printProductSpecs = mysqlTable("printProductSpecs", {
  id: int("id").autoincrement().primaryKey(),

  productId: int("productId").notNull().unique().references(() => products.id, { onDelete: "cascade" }),

  /** Paper stock display name (e.g. "100lb gloss cover"). */
  paperStock: varchar("paperStock", { length: 128 }),
  /** Trim size as a display string (e.g. "3.5x2", "8.5x11"). */
  size: varchar("size", { length: 64 }),
  /** Bleed spec in inches (decimal). */
  bleedInches: decimal("bleedInches", { precision: 4, scale: 3 }),
  /** Finishing options as a string[] (e.g. ["matte_lamination", "spot_uv"]). */
  finishingOptions: json("finishingOptions").$type<string[]>(),
  /** File upload specs (e.g. "PDF / AI, 300dpi, CMYK"). Migrated from the
   *  deprecated products.fileSpecs varchar column. */
  fileSpecs: varchar("fileSpecs", { length: 512 }),
  /** Print methods (offset, digital, letterpress) — migrated from
   *  products.printMethods. */
  printMethods: json("printMethods").$type<string[]>(),
  /** Color modes available (CMYK, 1-color, PMS) — migrated from
   *  products.printColors. */
  printColors: json("printColors").$type<string[]>(),
  /** Print areas migrated from products.printAreas. */
  printAreas: json("printAreas").$type<string[]>(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  productIdIdx: uniqueIndex("printProductSpecs_productId_uniq").on(t.productId),
}));
```

**Recommendation: separate table.** Reasoning:
- Keeping print-only fields on `products` as JSON (status quo) forces every promo-product query to carry unused payload — ~7 JSON columns per row.
- Queryability: Phase 4 curation UX will filter by paper stock, size, print method. JSON filter is slow and supplier-sync will need to diff these; dedicated columns diff cleanly.
- Referential integrity: a `UNIQUE` FK to `products.id` keeps the 1:1 contract explicit.

Rejected alternative (JSON column on products): simpler migration, but every print-detail change rewrites the whole product row and loses per-field type safety. Not worth the migration savings.

Alternatives also rejected: merging into `products` as top-level columns (keeps print-only cruft on every promo row). Merging into `printProducts` (`drizzle/schema.ts:1447-1462`) — this is a **store-scoped** catalog of print goods; it's a different entity (store-level bundle → variants with pricing). `printProductSpecs` is a **global** per-product spec sheet that both `products.type = "print"` rows and future print-supplier imports can share.

**Relationship to existing `printProducts`/`printProductVariants`/`printProductPricing`:** See §5.3. Phase 1 retires `printProductPricing` (its rows migrate to `productPriceTiers`). `printProducts` and `printProductVariants` remain for store-scoped bundles until Phase 5 or later (out of Task 2 scope — flagged §7.1 dependency on Phase 4 design).

### 3.5 — `storeProducts` modifications

```ts
export const storeProducts = mysqlTable("storeProducts", {
  // --- existing kept ---
  // id, storeId, productId, customPrice, featured, sortOrder,
  // trackInventory, stockQuantity, divisionIds, createdAt.

  // --- NEW ---

  /** Chosen decoration method for this store's listing of this product.
   *  When set, the calculator uses productDecorationRates rows matching
   *  (productId, method, location?). NULL means distributor did not
   *  pre-select a method; customer chooses at cart time. */
  chosenDecorationMethod: varchar("chosenDecorationMethod", { length: 64 }),

  /** Chosen imprint zone FK (→ productImprintZones.id, Task 3). Same
   *  semantics as chosenDecorationMethod — when set, locks the zone for
   *  this store's listing. NULL = customer chooses. */
  chosenImprintZoneId: int("chosenImprintZoneId"),

  /** Per-webstore cost override in cents. Rare negotiated-deal case; when
   *  set, replaces the product-level baseUnitCost in the calculation, but
   *  markup still applies. Nullable, defaults NULL, NOT surfaced in Phase 1
   *  UI (deferred flexibility per locked decision #2). Phase 4 or later
   *  surfaces the edit control. */
  costOverrideCents: int("costOverrideCents"),

  // --- existing customPrice semantics CLARIFIED (no schema change) ---
  // customPrice: decimal(10,2)
  //   Semantic: per-store SELL-PRICE override. When NOT NULL, the
  //   calculator returns unitSellPriceCents = toCents(customPrice) and
  //   sets distributorCostView.usedCustomPriceOverride = true. Markup is
  //   NOT applied on top. Decoration is NOT added on top. This is a
  //   "trust the distributor's number" path.
}, (t) => ({
  storeIdIdx: index("storeProducts_storeId_idx").on(t.storeId),
  productIdIdx: index("storeProducts_productId_idx").on(t.productId),
  chosenImprintZoneIdx: index("storeProducts_chosenImprintZoneId_idx").on(t.chosenImprintZoneId),
}));
```

**Interaction matrix (precedence):**

| `customPrice` set? | `costOverrideCents` set? | Calculator behaviour |
|---|---|---|
| Yes | * | `unitSellPrice = customPrice`. Decoration, tiers, markup, costOverride **all ignored**. `tierBreakdown` collapses to a single flat tier. `distributorCostView.usedCustomPriceOverride = true`. |
| No | Yes | `baseUnitCost = costOverrideCents`. Decoration and markup applied normally. `tierBreakdown` still computed from `productPriceTiers` but costs re-derived from the override (each tier applies the same override, since override is flat). `usedCostOverride = true`. |
| No | No | Standard path: `baseUnitCost` from `productPriceTiers` tier match. |

Rationale for this precedence: `customPrice` is the "distributor knows best" escape hatch and must bypass everything, including markup, because otherwise the distributor can't accurately hit a target contract price. `costOverrideCents` is a negotiated input cost; markup should still compound on top of it because the margin logic is store-level, not product-level.

### 3.6 — Webstore markup rule

**Recommendation: single column on `stores`, no separate table.**

```ts
// stores table delta (drizzle/schema.ts:183)
export const stores = mysqlTable("stores", {
  // ... existing columns kept ...

  /** Default markup rate for this store, as a decimal (0.3500 = 35%).
   *  Applied to (baseUnitCost + decorationUnitCost) unless overridden by
   *  storeProducts.customPrice. NULL = no markup (distributor is pricing
   *  at cost; legitimate for friends-and-family stores). */
  markupPct: decimal("markupPct", { precision: 5, scale: 4 }),
});
```

**Why a column, not a rules table:** Phase 1 ships one global rate per store. Tiered markup (higher margin on small orders, volume discount inverted) and product-category markup are features Yan may want later; they are **flagged as §6.5** as an explicit deferred-flexibility decision. Adding a full `storeMarkupRules` table now would violate "don't design for hypothetical future requirements." The column can be deprecated and replaced by a rules table in a later phase if that feature ships; the migration path is clean (one-row insert per store).

**Precedence recap across the whole design:**

1. If `storeProducts.customPrice` set → flat sell price; nothing else applies.
2. Else compute `baseUnitCostCents` from `productPriceTiers` tier match, overridden by `storeProducts.costOverrideCents` if set.
3. Add `decorationUnitCostCents` from matched `productDecorationRates` row.
4. Apply `stores.markupPct` (0 if NULL).
5. Apply `setupFeesTotalCents` as a line-level constant (not multiplied by qty).

### 3.7 — Retirement plan (dead code deleted in Phase 1 migration PR)

| Column / table | Consumed by today | Replaced by | Retired in migration |
|---|---|---|---|
| `products.pricingTiers` JSON | Webstore PDP client (`StoreProductDetailPage.tsx:78-84`), PrintStore (`:104,175`), ProductDetail (`:158-163`), catalog APIs | `productPriceTiers` rows | Phase 1 migration (same commit that adds `productPriceTiers`) |
| `products.decorationMethods` JSON | Catalog APIs (`storesCrud.ts:308`, `copilotExec/clientsProducts.ts:170`), proposal detail (`proposalsCrud.ts:154`), product-search adapter (`productSearchAdapter.ts:39,116,261`) | `productDecorationRates` rows (method column) | Phase 1 migration |
| `products.printAreas`, `printMethods`, `printColors`, `fileSpecs` | Unknown — audit flagged these as declared but no explicit consumer found in the audit sweep. | `printProductSpecs` columns | Phase 1 migration |
| `proposalPriceTiers` table | Public proposal view hydration (`publicProposalHelpers.ts:340-352,423-432`), cascade delete (`proposalsCrud.ts:422`) | `productPriceTiers` (global quantity) + `proposalPriceOverrides` (§3.8, per-proposal quantity & size) per Decision C | Phase 1 migration |
| `printProductPricing` table | Print product variant hydration (`printProducts.ts:42-74,200-206,258-264,385-390`), PrintStore client (`PrintStore.tsx:104,175`) | `productPriceTiers` rows via `variantId` FK (variant model preserved per Decision D — see §5.3) | Phase 1 migration |
| `storeProducts.customPrice` | Checkout (`storeCheckout.ts:432,993`), catalog (`storesCatalog.ts:145,310`, `storesCrud.ts:145`), PDP (`ProductCard.tsx:77`, `StoreProductDetailPage.tsx:84`, `StoreTemplateMinimal.tsx:285`) | **Kept**, semantics clarified (§3.5). | — |

**Authoritative after 2026-04-21 resolution:** every item listed above remains retired in Phase 1. The new tables added by Decisions C and G (`proposalPriceOverrides` §3.8, `printFinishingRates` §3.9) are additive — they do not change any item's retirement status.

### 3.8 — `proposalPriceOverrides` (new table — Decision C)

*Added 2026-04-21 per Decision C (§6.4 RESOLVED).* Preserves per-proposal quantity and size tiers so distributors can continue to negotiate custom deals (e.g. Unity Hospital Q3 order at a special rate) without regression.

```ts
export const proposalPriceOverrides = mysqlTable("proposalPriceOverrides", {
  id: int("id").autoincrement().primaryKey(),
  proposalProductId: int("proposalProductId").notNull().references(() => proposalProducts.id, { onDelete: "cascade" }),
  minQty: int("minQty").notNull(),
  maxQty: int("maxQty"),
  sizeLabel: varchar("sizeLabel", { length: 16 }),
  unitPriceCents: int("unitPriceCents").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  proposalProductIdIdx: index("proposalPriceOverrides_proposalProductId_idx").on(t.proposalProductId),
  uniqOverride: uniqueIndex("proposalPriceOverrides_uniq").on(t.proposalProductId, t.minQty, t.sizeLabel),
}));
```

**Precedence in the calculator:** when `ctx.proposalProductId` is set, the calculator checks `proposalPriceOverrides` **first**, matching on `(minQty/maxQty, sizeLabel)`. If no match, it falls back to `productPriceTiers` with the same size-matching logic (size-matched tier first, then `sizeLabel = NULL`). The override stores an explicit `unitPriceCents` (post-markup sell price, not a cost) — it represents a negotiated customer-facing price, and bypasses store markup in the same manner as `storeProducts.customPrice` bypasses markup at the store level.

**Migration source:** `proposalPriceTiers` rows whose tier data differs from the parent product's global schedule are inserted here (see §5.4).

### 3.9 — `printFinishingRates` (new table — Decision G)

*Added 2026-04-21 per Decision G (§6.6 RESOLVED).* Finishing options (matte lamination, spot UV, die-cut, etc.) are priced upgrades; this table carries the rates so Phase 1 ships with complete print pricing rather than a known Phase 2 compromise.

```ts
export const printFinishingRates = mysqlTable("printFinishingRates", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull().references(() => products.id, { onDelete: "cascade" }),
  finishingOption: varchar("finishingOption", { length: 64 }).notNull(),
  unitRateCents: int("unitRateCents").notNull(),
  setupFeeCents: int("setupFeeCents").notNull(),
  source: mysqlEnum("source", ["supplier_api", "manual", "csv_import"]).default("manual").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  productIdIdx: index("printFinishingRates_productId_idx").on(t.productId),
  uniqFinishing: uniqueIndex("printFinishingRates_uniq").on(t.productId, t.finishingOption),
}));
```

**Calculator integration (PrintCalculator):** iterates `ctx.selectedFinishingOptions`; for each option, looks up the matching `printFinishingRates` row on `(productId, finishingOption)` and adds `unitRateCents` to `decorationUnitCostCents` and `setupFeeCents` to `setupFeesTotalCents`. If a selected option has no configured rate, calculator throws `PricingError("finishingRateNotSet")`.

**Relationship to `printProductSpecs.finishingOptions`:** the specs column lists *which options are available* (declarative metadata); `printFinishingRates` carries *what each one costs*. Two orthogonal concerns, cleanly separated.

---

## Section 4 — Calculator Strategy Pattern

### 4.1 — File layout (proposed for Phase 1)

```
shared/pricing/
  types.ts             // PriceBreakdown, PricingContext, ProductPricingInput
  engine.ts            // PricingEngine entry point + type registry
  base.ts              // BaseCalculator abstract class
  promoCalculator.ts   // PromoCalculator extends BaseCalculator
  printCalculator.ts   // PrintCalculator extends BaseCalculator
  markup.ts            // resolveMarkup(storeId, ctx) — isolated for testability
  overrides.ts         // resolveOverrides(storeProductRow) — customPrice + costOverride precedence
server/pricing/
  loader.ts            // Drizzle fetchers: loadProductForPricing(productId, orgId)
  trpc.ts              // tRPC procedure wrapping pricingEngine.calculatePrice
  agentTool.ts         // Agent tool wrapper (same calc, different surface)
```

Placing pure calculation logic in `shared/` means the calculator runs in Node (tRPC/server) and in React (for optimistic preview on the PDP). Drizzle I/O is isolated to `server/pricing/loader.ts`.

### 4.2 — Calculator interface

```ts
// shared/pricing/base.ts

/**
 * Data shape the calculator needs, already fetched. The engine's job is
 * dispatch; the I/O is elsewhere. Keeps calculators pure and unit-testable.
 */
export interface ProductPricingInput {
  product: {
    id: number;
    organizationId: number;
    type: "promotional" | "print"; // discriminator
    basePriceCents: number | null;
    minQuantity: number | null;
  };
  /** Tier rows carry sizeLabel and variantId per Decisions B and D
   *  (2026-04-21). Loader orders rows so that size-matched and
   *  variant-matched tiers come first; calculator picks the first match. */
  tiers: Array<{
    minQty: number;
    maxQty: number | null;
    sizeLabel: string | null;
    variantId: number | null;
    unitCostCents: number;
  }>;
  /** Per-proposal custom pricing (Decision C, 2026-04-21). Populated by
   *  loader when ctx.proposalProductId is set. Null otherwise. Calculator
   *  checks these BEFORE tiers and bypasses markup (unitPriceCents is a
   *  post-markup sell price). */
  proposalOverrides: Array<{
    minQty: number;
    maxQty: number | null;
    sizeLabel: string | null;
    unitPriceCents: number;
  }> | null;
  /** Decoration rate rows. Each carries legacyPlaceholder (Decision H,
   *  2026-04-21): when true, calculator treats unitRateCents and
   *  setupFeeCents as zero and does NOT throw decorationRateNotSet. */
  decorationRates: Array<{
    method: string;
    location: string;
    imprintZoneId: number | null;
    unitRateCents: number;
    setupFeeCents: number;
    legacyPlaceholder: boolean;
  }>;
  /** Finishing-option rates for print products (Decision G, 2026-04-21).
   *  Populated by loader for all print products; empty array for promo.
   *  PrintCalculator sums matching rows per ctx.selectedFinishingOptions. */
  finishingRates: Array<{
    finishingOption: string;
    unitRateCents: number;
    setupFeeCents: number;
  }>;
  printSpecs: null | {
    paperStock: string | null;
    size: string | null;
    // ... other printProductSpecs fields
  };
  storeProduct: null | {
    customPriceCents: number | null;
    costOverrideCents: number | null;
    chosenDecorationMethod: string | null;
    chosenImprintZoneId: number | null;
  };
  store: {
    id: number;
    organizationId: number;
    markupPct: number; // 0 if null in DB
  };
}

export abstract class BaseCalculator {
  abstract readonly productType: "promotional" | "print";

  /** Pure function: given inputs + quantity + context, returns breakdown. No
   *  Drizzle calls, no network, no side effects. Deterministic. */
  abstract calculate(
    input: ProductPricingInput,
    quantity: number,
    ctx: PricingContext
  ): PriceBreakdown;

  /** Shared helpers available to concrete calculators:
   *    protected resolveTier(tiers, qty): matched tier, throws if none
   *    protected applyMarkup(costCents, markupPct): rounded cents
   *    protected applyOverrides(breakdown, storeProduct): mutates for
   *      customPrice / costOverride — shared across types
   */
}
```

### 4.3 — Concrete calculators

*Updated 2026-04-21 per Decisions B, C, D, G, H.*

**`PromoCalculator`** (`productType = "promotional"`):

1. **Resolve base cost.**
   a. **Proposal override check (Decision C).** If `ctx.proposalProductId` is set AND `input.proposalOverrides` is non-null: attempt to match a row on `(minQty/maxQty, sizeLabel)` against `ctx.sizeLabel` and the quantity. If matched → use `unitPriceCents` directly as the sell price for this line (bypasses markup, analogous to `customPrice`) and skip to step 5 tier-breakdown build.
   b. **Tier match from `productPriceTiers` (Decision B).** If `ctx.sizeLabel` is set, prefer a tier whose `sizeLabel === ctx.sizeLabel` and whose `minQty/maxQty` bracket contains `quantity`. If no size match, fall back to a size-agnostic tier (`sizeLabel === null`). Resolve → `baseUnitCostCents`.
   c. **Cost override.** If `input.storeProduct.costOverrideCents` is set, replace `baseUnitCostCents` with that value (§3.5 precedence: markup still applies).
2. **Resolve decoration.** Match `productDecorationRates` on `(productId, chosenDecorationMethod ?? ctx.requestedDecorationMethod, chosenImprintZoneId ?? ctx.requestedImprintZoneId)`. If the product has any decoration rates and no method resolved → throw `PricingError("decorationMethodRequired")`. Sum matched `unitRateCents` → `decorationUnitCostCents`; sum `setupFeeCents` → `setupFeesTotalCents`. **Per Decision H:** rows with `legacyPlaceholder = true` contribute zero to both sums and do **not** trigger `decorationRateNotSet`.
3. Check granularity flags (§3.2 stitch/color columns) — if present and `ctx.requestedDecorationMethod` has finer-grained rates in a later phase, dispatch to future handler. In Phase 1, throw if stitch/color is set on any non-placeholder row (schema allows, calc rejects — fail loudly until full granularity ships).
4. **Apply markup.** Multiply `(baseUnitCostCents + decorationUnitCostCents)` by `(1 + store.markupPct)`, round → `unitSellPriceCents`. Apply `customPrice` override (bypass everything — §3.5).
5. **Build `tierBreakdown`.** Re-run steps 1b and 4 for each tier (including per-size and per-proposal-override variants) so the PDP and proposal view can render the full matrix without a second query.

**`PrintCalculator`** (`productType = "print"`):

Structure parallels `PromoCalculator`. Differences:

- **Variant resolution (Decision D).** Resolve the customer's selection (size, stock) → `variantId`. Step 1b restricts tier match to `productPriceTiers` rows where `variantId` matches the resolved variant. Variant model is preserved; migration is a no-op today (no print products exist) — see §5.3.
- **Finishing options (Decision G).** After step 2 decoration resolution (typically empty for print), iterate `ctx.selectedFinishingOptions`. For each option, look up the matching row in `input.finishingRates` on `finishingOption` and add `unitRateCents` to `decorationUnitCostCents` and `setupFeeCents` to `setupFeesTotalCents`. If a selected option has no row, throw `PricingError("finishingRateNotSet")`.
- **`printSpecs` requirement.** Must be non-null for print products; calculator throws otherwise.
- **Tier match semantics.** Inclusive-range like promo tiers; if a variant's tiers were imported from a legacy `printProductPricing`-shaped source with `minQty = maxQty = quantity` rows, the same matching logic applies (each exact-qty row acts as a single-point bracket). Future-proof for supplier-imported variant pricing.

### 4.4 — Engine entry point and agent tool contract

```ts
// shared/pricing/engine.ts

const CALCULATOR_REGISTRY: Record<ProductType, BaseCalculator> = {
  promotional: new PromoCalculator(),
  print: new PrintCalculator(),
};

/** Public entry point. Fetches data, dispatches, returns breakdown. */
export async function calculatePrice(
  productId: number,
  quantity: number,
  ctx: PricingContext
): Promise<PriceBreakdown> {
  // 1. loader.ts fetches ProductPricingInput, enforcing orgScope
  //    (protected subsystem — must not be bypassed).
  // 2. Select calculator by input.product.type.
  // 3. Call calculator.calculate(input, quantity, ctx).
  // 4. Return breakdown.
}
```

**tRPC procedure** (`server/pricing/trpc.ts`):
- Name: `pricing.calculate`.
- Auth: distributor session OR storefront session (storefront cannot see `distributorCostView`; see below).
- Input: `{ productId, quantity, storeId, decorationMethod?, imprintZoneId?, customerId? }` (Zod).
- Output: `PriceBreakdown`.
- `distributorCostView` scrubbed from the response when the caller is a storefront customer. This is a one-line serializer wrapper; enforcement point is the tRPC layer, not the calculator.

**Agent tool contract** (`server/pricing/agentTool.ts`):

```ts
// agent tool declaration
{
  name: "pricing.calculate",
  description: "Calculate the unified price breakdown for a product in a store for a given quantity. Respects per-store markup, per-product decoration rates, and store-product overrides. Respects orgScope — returns permissionDenied if the product or store is outside the caller's org.",
  inputSchema: {
    type: "object",
    required: ["productId", "quantity", "storeId"],
    properties: {
      productId: { type: "integer" },
      quantity: { type: "integer", minimum: 1 },
      storeId: { type: "integer" },
      decorationMethod: { type: "string", nullable: true },
      imprintZoneId: { type: "integer", nullable: true },
      customerId: { type: "integer", nullable: true },
    },
  },
  outputSchema: /* JSON Schema mirroring PriceBreakdown; distributorCostView
                   included — agents have distributor scope by default */,
}
```

**Which existing protections apply:**
- `orgScope` enforcement (`protected-subsystems.md` #2): the loader checks `product.organizationId === ctx.orgId === store.organizationId`. Mismatch throws `OrgScopeViolation`. Agents invoking this tool inherit the caller's org from the tRPC context; no agent can calculate prices for a product outside their org.
- Auth (protected #1): the agent tool runs inside the existing tRPC session; no bypass.
- Stripe (protected #3, #4): untouched. The breakdown returns cents; Stripe Tax and Connect still handle tax and payout at checkout.

**Agent-accessibility requirement check:** every domain action in pricing is callable via `pricing.calculate`. Listing a product at a tier, previewing a decoration cost, showing a customer what 100 units would cost — all paths terminate in `calculatePrice`. Principle #5 (AI-native) satisfied.

---

## Section 5 — Migration Strategy

### 5.1 — `products.pricingTiers` → `productPriceTiers`

Phase 1 migration script (run inside the same SQL file that creates `productPriceTiers`):

```ts
// Pseudocode — actual migration written in Phase 1 as a SQL file + journal entry.
for (const product of await db.select().from(products).where(isNotNull(products.pricingTiers))) {
  const tiers = product.pricingTiers; // [{ minQty, maxQty, price }]
  for (const [i, tier] of tiers.entries()) {
    await db.insert(productPriceTiers).values({
      productId: product.id,
      minQty: tier.minQty,
      maxQty: tier.maxQty,
      unitCostCents: Math.round(tier.price * 100),
      sortOrder: i,
      source: "manual", // no supplier-source history on legacy rows
    });
  }
}
await sql`ALTER TABLE products DROP COLUMN pricingTiers`;
```

Audit whether data exists: yes — see §1.4. This is not a no-op.

### 5.2 — `products.decorationMethods` → `productDecorationRates`

*Rewritten 2026-04-21 per Decision H — legacy-placeholder flag replaces zero-rate landmine.*

Legacy rows contain only method names (`["embroidery", "screen_print"]`), no rate/location data. Migration creates one row per method with `legacyPlaceholder = true`, `unitRateCents = 0`, `setupFeeCents = 0`, `location = "default"`, `source = "manual"`. The `legacyPlaceholder` column (§3.2) signals: "this product advertises that the method is available; no charge is set yet." Calculator treats such rows as zero-charge and does **not** throw — a non-breaking migration, unlike the original draft which would have thrown on every existing product's decoration attempt the moment Phase 1 shipped.

**Lifecycle of legacy placeholders:**
- **Phase 2 supplier sync** replaces placeholder rows with real rates when the adapter returns them — clearing `legacyPlaceholder` and setting actual `unitRateCents` / `setupFeeCents`.
- **Phase 6 cleanup sweep** queries remaining `legacyPlaceholder = true` rows and produces a distributor-dashboard report: "products needing decoration rates set." Each distributor resolves each row (supply a rate) or explicitly marks it as "no upcharge" (by setting the rate to 0 and clearing the flag).

Migration pseudocode:

```ts
for (const product of await db.select().from(products).where(isNotNull(products.decorationMethods))) {
  for (const method of product.decorationMethods) {
    await db.insert(productDecorationRates).values({
      productId: product.id,
      method,
      location: "default",
      unitRateCents: 0,
      setupFeeCents: 0,
      source: "manual",
      legacyPlaceholder: true,
    }).onDuplicateKeyUpdate(...); // respect uniq index on (productId, method, location)
  }
}
await sql`ALTER TABLE products DROP COLUMN decorationMethods`;
```

### 5.3 — Print variants: variant model preserved (Decision D)

*Rewritten 2026-04-21 — Decision D supersedes the original Option (a)/(b)/(c) analysis.*

Yan has no print products in production today. That gives us freedom to pick the clean architectural model without migration pain. **Decision D: preserve the variant model.**

- `printProducts` → `printProductVariants` structure is kept as-is.
- Pricing for each variant lives in `productPriceTiers`, keyed by the new `variantId` nullable FK to `printProductVariants.id` (§3.3).
- Customer UX: one product page per print product, with dropdown pickers for size / stock / finish.
- **Migration: no data migration required.** There are no `printProductPricing` rows to move. The schema change is additive — add `productPriceTiers.variantId` column and retire the `printProductPricing` table (which is empty).
- `variantId = NULL` means the tier applies to the product as a whole (promo products). `variantId` set means the tier applies to a specific print variant.

**Principle #3 check:** this is not a parallel path. `productPriceTiers` is the single tier table; the `variantId` FK is a discriminator within it, analogous to how `products.type` discriminates promo vs print. One pricing engine reads one tier table via `variantId`-aware match in `PrintCalculator`.

**Superseded analysis retained for history:** the original draft considered (a) collapsing variants, (b) promoting variants to top-level products, or (c) keeping the variant model with a `variantId` FK and calling it a parallel path. Option (c) is now the selected approach — but without the parallel-path concern, because `printProductPricing` is retired and `productPriceTiers` becomes the single source of truth for all tiered pricing.

### 5.4 — `proposalPriceTiers` → `productPriceTiers` + `proposalPriceOverrides`

*Rewritten 2026-04-21 per Decisions B and C — size tiers and per-proposal tiers both preserved.*

For each row in `proposalPriceTiers`:

1. **`tierType = "quantity"`:**
   - Compare the row's `(minQty, maxQty, price)` against the parent product's global `productPriceTiers` rows (post-Decision-B, size-agnostic: `sizeLabel = NULL`).
   - If an exact match exists (same bounds and `unitCostCents` after dollars→cents conversion), skip — the row is a denormalized copy of the global schedule.
   - Otherwise, insert into `proposalPriceOverrides` with `sizeLabel = NULL`, preserving `minQty`/`maxQty`/`sortOrder` and converting `price × 100` → `unitPriceCents`.
2. **`tierType = "size"`:**
   - If the sizing applies globally to the product (same size tiers across every proposal for that product — determined by a dedupe check), insert into `productPriceTiers` with `sizeLabel` populated per Decision B.
   - Otherwise it's a per-proposal size upcharge: insert into `proposalPriceOverrides` with `sizeLabel` populated, `minQty = 1`, `maxQty = NULL`.

After the migration runs, drop `proposalPriceTiers` per the §3.7 retirement plan.

Migration pseudocode:

```ts
for (const row of await db.select().from(proposalPriceTiers)) {
  if (row.tierType === "quantity") {
    const globalMatch = await matchProductPriceTier(row); // bounds + cents equality
    if (globalMatch) continue; // denormalized copy of global schedule
    await db.insert(proposalPriceOverrides).values({
      proposalProductId: row.proposalProductId,
      minQty: row.minQty!,
      maxQty: row.maxQty,
      sizeLabel: null,
      unitPriceCents: Math.round(Number(row.price) * 100),
      sortOrder: row.sortOrder,
    });
  } else {
    // tierType === "size"
    const globalScope = await isGlobalSizingForProduct(row);
    if (globalScope) {
      await db.insert(productPriceTiers).values({
        productId: parentProductId(row),
        minQty: 1,
        maxQty: null,
        sizeLabel: row.label,
        unitCostCents: Math.round(Number(row.price) * 100),
        source: "manual",
      });
    } else {
      await db.insert(proposalPriceOverrides).values({
        proposalProductId: row.proposalProductId,
        minQty: 1,
        maxQty: null,
        sizeLabel: row.label,
        unitPriceCents: Math.round(Number(row.price) * 100),
        sortOrder: row.sortOrder,
      });
    }
  }
}
await sql`DROP TABLE proposalPriceTiers`;
```

**Phase 1 is no longer gated on §6.2 or §6.4** — both resolved 2026-04-21.

### 5.5 — `products.type` backfill

The `type` enum already exists; no backfill needed for new rows. For any legacy rows with NULL or invalid `type` (audit: none found — the column is `.notNull().default("promotional")`) the default applies. Products linked to a print supplier (check `externalSource = "promostandards"` or presence of a `printProductVariantId` pointer) stay "promotional" unless variant-promotion migration (§5.3) converts them. After §5.3, the set of products with `type = "print"` equals the set of migrated print variants.

### 5.6 — Dual-run safety

**No dual-run.** Phase 1 is a hard cutover per Principle #3 (no parallel paths). The migration is a single PR that:
1. Creates new tables.
2. Backfills data.
3. Rewires every read/write site (checkout, catalog, PDP, proposals, print-store) to use `calculatePrice`.
4. Drops retired columns/tables.
5. Lands on `main` as one atomic change.

Why not dual-run: dual-run preserves the bug we're eliminating (three parallel systems) for the duration of the dual-run window. The cutover is risky but it's the only way to meet Principle #1.

Risk mitigation:
- Phase 0 Task 6 (Foundation & Design close) includes a pre-cutover snapshot (per the RDS snapshot memory — Yan takes this manually; EC2 role can't snapshot).
- Phase 1 ships on a feature branch with the full regression protocol (`regression_protocol` memory) before merge.
- Smoke test at merge: run `pricing.calculate` against a representative set of seeded products and compare outputs against a fixture captured from the legacy engine on the pre-migration DB. Fixtures live in `e2e/pricing-parity.fixture.json`.

### 5.7 — Rollback plan

If Phase 1 ships and we need to revert:
1. `git revert` the merge commit.
2. Restore the pre-cutover RDS snapshot (Yan takes this manually — flagged in the existing `project_rds_snapshot_perms` memory; EC2 role can't snapshot, so this is a manual step coordinated with Yan).
3. Re-deploy the previous build.

This means rollback is destructive to any post-cutover writes — accepted risk given the single-track cutover model. Yan signs off on this explicitly at Phase 1 close.

---

## Section 6 — Open Questions for Yan

### 6.1 — Is `products.pricingTiers` really dead, or does it have live data?

**RESOLVED 2026-04-21 — Option (a) selected: treat `products.pricingTiers` as live data.** The repo audit was correct. Migration §5.1 runs a full backfill. Logged as Decision A (→ `rebuild-2026-q2.md` Decision 4).

**Why it matters:** the Task 2 prompt says "dead code today per audit." The repo audit on 2026-04-20 contradicts that — `pricingTiers` is the primary quantity-tier source on the live webstore PDP. If the prompt's claim is wrong, the migration in §5.1 must run a real data copy (not a DROP). If the prompt's claim is right (somehow, despite audit finding), Yan should correct the record so we don't waste migration complexity.

**Options:**
- **(a)** Treat as live (my recommendation): migration in §5.1 runs the full backfill. Safe even if data is small.
- **(b)** Treat as dead (per prompt): DROP COLUMN directly. Risks data loss if audit was right.

**Recommendation: (a).** Costs nothing if the column is empty; preserves everything if it's not.

### 6.2 — Size-based tiers (`proposalPriceTiers.tierType = "size"`): keep or drop?

**RESOLVED 2026-04-21 — Option (b) selected: add nullable `sizeLabel` column to `productPriceTiers`.** Size upcharge (2XL/3XL) is industry-standard in apparel; Otentik Brand (Yan's distribution business) depends on it. Dropping it would be a feature regression. Logged as Decision B (→ `rebuild-2026-q2.md` Decision 5).

**Why it matters:** apparel distributors commonly upcharge 2XL+ relative to XS-XL. The unified `productPriceTiers` model is quantity-only. Dropping size tiers removes this capability from proposals; agents can't price "50 shirts, 10 of which are 3XL" differently from "50 shirts, all XL".

**Options:**
- **(a) Drop:** simplest schema, loses size upcharge, forces distributors to split proposals.
- **(b) Keep in new schema:** add `sizeLabel` nullable column to `productPriceTiers`; calculator picks size-matched tier when `ctx.size` is provided. Modest complexity bump.
- **(c) Separate `productSizeUpcharges` table:** fully normalized, highest complexity, cleanest long-term.

**Recommendation: (b)** for Phase 1 (preserves capability at modest cost) and revisit for (c) in Phase 2 if the upcharge logic grows. **This is blocking for Phase 1 start — size-tier loss is not reversible silently.**

### 6.3 — Rename `products.type` → `products.productType`?

**RESOLVED 2026-04-21 — Option (a) selected: keep column name as `type`.** Migration churn not worth naming consistency benefit; TypeScript aliases `ProductType = "promotional" | "print"`. Logged as Decision E (→ `rebuild-2026-q2.md` Decision 8).

**Why it matters:** the Task 2 prompt uses `productType`; the column is `type`. Leaving them different means developers read code that says `products.type` and docs that say `productType`. Renaming is a one-liner migration + widespread codebase sed.

**Options:**
- **(a) Keep column as `type`, alias in TS:** zero migration risk, mild confusion.
- **(b) Rename to `productType`:** one migration, clearer code, ~20 file touchpoints based on audit.

**Recommendation: (a).** The mismatch is pure documentation; the rename adds migration surface without functional benefit. Flag it in the schema comment.

### 6.4 — Per-proposal and per-variant price customization

**RESOLVED 2026-04-21 — new `proposalPriceOverrides` table (§3.8) preserves per-proposal tier customization.** Overrides the restored doc's Option (c) "drop capability" recommendation. Per-proposal negotiated deals (e.g. Unity Hospital Q3 rates) are a real workflow and must be preserved. Logged as Decision C (→ `rebuild-2026-q2.md` Decision 6).

**Why it matters:** `proposalPriceTiers` lets a distributor price a product differently in Proposal #42 than in Proposal #43. `printProductPricing` lets them price size-S different from size-XL. The unified model has one price schedule per `products` row. §5.3 and §5.4 call out this consolidation.

Three places to land this capability:
- **(a)** `storeProducts.customPrice` (already exists): store-level flat override. Covers "this client's store gets a special price." Doesn't cover tier preservation.
- **(b)** New `proposalPriceOverrides` table (not designed here): preserves full fidelity. Adds a table.
- **(c)** Drop the capability entirely: rely on `customPrice`.

**Recommendation: (c)** for Phase 1, with a formal deprecation notice to any distributor using proposal-specific tiers today. This is the clean-slate bet: zero tech debt > full capability preservation. **Yan's call — this affects existing distributor workflows.**

### 6.5 — Tiered markup and category-specific markup

**RESOLVED 2026-04-21 — Option (a) selected: single `stores.markupPct` column in Phase 1.** `storeMarkupRules` deferred to a future phase if tiered or category-specific markup need surfaces. Logged as Decision F (→ `rebuild-2026-q2.md` Decision 9).

**Why it matters:** `stores.markupPct` is a single decimal. Real-world pricing often uses higher markup on smaller orders (compensate for fixed costs) and different markup by category (apparel 40%, drinkware 25%). Schema-time decision: single column vs rules table.

**Options:**
- **(a) Single column now, rules table later:** Phase 1 ships `stores.markupPct`; Phase 5 or a dedicated phase adds `storeMarkupRules` and deprecates the column.
- **(b) Rules table from day one:** `storeMarkupRules` with `(storeId, category, qtyMin, qtyMax, markupPct)` rows. Single row per store covers the simple case.

**Recommendation: (a).** YAGNI until Yan identifies a distributor who needs it. Deferred-flexibility approach.

### 6.6 — Finishing options (print) priced or not?

**RESOLVED 2026-04-21 — Option (b) selected: finishing options priced in Phase 1 via new `printFinishingRates` table (§3.9).** Overrides the restored doc's Option (a) "selection-only, defer to Phase 2" recommendation. Shipping without finishing pricing would create a known compromise that Phase 2 would need to unwind; zero-tech-debt goal wins. Logged as Decision G (→ `rebuild-2026-q2.md` Decision 10).

**Why it matters:** `printProductSpecs.finishingOptions` is `string[]` (matte lamination, spot UV, die-cut). In the real world these are paid upgrades ($0.10/pc for matte, $0.25/pc for spot UV). Phase 1 design lists them as selection-only, no pricing. This will surface as "customer selects spot UV → cart price doesn't change" which is wrong.

**Options:**
- **(a) Phase 1: selection-only, flagged for Phase 2:** ship as described, log as intentional compromise with resolution date Phase 2.
- **(b) Phase 1 includes finishing rates:** new table `printFinishingRates(productId, finishingOption, unitRateCents)`. Adds a week to Phase 1.

**Recommendation: (a)** — logged in `rebuild-2026-q2.md` Intentional Compromises table when Phase 1 opens. **Yan's call on whether the missed calc is acceptable in Phase 1.**

### 6.7 — Print product variant promotion (§5.3 Option b)

**RESOLVED 2026-04-21 — variant model preserved; `productPriceTiers.variantId` FK added.** Overrides the restored doc's Option (b) "promote variants to products" recommendation. No print products exist today, so no migration pain; customer UX is one product page per print product with dropdown pickers for size/stock/finish. Logged as Decision D (→ `rebuild-2026-q2.md` Decision 7).

**Why it matters:** current model has `printProduct → printProductVariant → printProductPricing` (3 tables). Unified model wants one `products` row per variant, which multiplies row count.

**Options** laid out in §5.3. **Recommendation (b) promote variants to products.**

**Yan's call — this changes the shape of the print catalog substantially.**

### 6.8 — Interaction with multi-department approval flows (conditional-protected)

**RESOLVED 2026-04-22 per Decision 37:** Multi-department approval promoted to **IN SCOPE as first-class feature**. `PricingContext.departmentId` becomes a first-class field in Phase 1 (not reserved). New tables in Phase 1: `departments`, `departmentBudgets`, `approvalChains`, `approvalRequests` (schema design deferred to Phase 1 opening). Pricing engine integrates `departmentId` as a dimension for pricing calculations. See `rebuild-2026-q2.md` Decision 37 for full implications.

**DEFERRED 2026-04-21 to Phase 0 Task 5 (Conditional subsystems) — historical:** No change to this design; `PricingContext.departmentId?: number` placeholder remains as documented. (This DEFERRED note is superseded by the RESOLVED banner above and kept only as a historical record of the Phase 0 Task 5 handoff.)

**Why it matters:** `protected-subsystems.md` lists "Multi-department approval architecture" as conditional, to be resolved in Phase 0. The pricing engine does not currently interact with department budgets, but if per-department pricing or budget tiers are added, `PricingContext` may need a `departmentId` field.

**Not answering here** (that's Task 5). Design decision reserved: `PricingContext.departmentId?: number` as a placeholder field, unused in Phase 1, reserved for Phase 2+ if Task 5 promotes multi-department into scope.

### 6.9 — Interaction with multi-division webstores (conditional-protected)

**RESOLVED 2026-04-22 per Decision 38:** Multi-division webstores promoted to **IN SCOPE as first-class feature with per-division pricing**. `PricingContext.divisionId` becomes a first-class field. Phase 1 adds either a `storeProductOverrides` table OR `divisionId`-scoped variants of the existing override fields (`storeProducts.customPrice` / `costOverrideCents`) — implementation choice deferred to Phase 1 opening. Pricing engine integrates `divisionId` as a dimension. See `rebuild-2026-q2.md` Decision 38 for full implications.

**DEFERRED 2026-04-21 to Phase 0 Task 5 (Conditional subsystems) — historical:** No change to this design. (This DEFERRED note is superseded by the RESOLVED banner above and kept only as a historical record of the Phase 0 Task 5 handoff.)

**Why it matters:** `storeProducts.divisionIds` already exists (`drizzle/schema.ts:280`). Division-level pricing is not yet a feature; if Task 5 promotes this into scope, we need per-division `customPrice` or `costOverride`.

**Not answering here** (Task 5). Reserved: no schema change in Phase 1; Phase 4 curation UX or Phase 5 distributor curation may add.

### 6.10 — Estimate-from-proposal flow currently ignores tiers

**LOGGED 2026-04-21 for Phase 6 per Decision I.** Entry added to `rebuild-2026-q2.md` → Bugs Discovered Mid-Phase with severity "potential billing error." Phase 1 cutover to `calculatePrice` fixes the bug by construction; Phase 6 may also need a customer-communication / invoice-correction plan depending on actual impact (→ `rebuild-2026-q2.md` Decision 12).

**Why it matters:** audit found that `server/routers/estimatesInvoices.ts:316` creates estimates using `pp.unitPrice ?? prod?.basePrice`, with **no call to `proposalPriceTiers`**. This is a bug (proposals show tiered pricing to the customer; when accepted, the estimate uses flat unit price). Phase 1 cutover to `calculatePrice` fixes this by construction, but this bug affects production today and may have produced incorrect invoices.

**Recommendation:** log as a Phase 6 bug (`Bugs Discovered Mid-Phase` table) with severity = "potential billing error," severity upgrade if Yan confirms any invoices were affected. Not blocking Phase 1 since Phase 1 fixes it.

---

## Section 7 — Dependencies on Other Phase 0 Tasks

### 7.1 — Task 3 (Imprint Zones)

This design references `productImprintZones` by FK. The contract Task 3 must satisfy for this design:

- Table named `productImprintZones` with at minimum: `id: int` (PK), `productId: int` (FK → products.id), `zoneKey: varchar` (stable identifier like "front_chest", "left_sleeve"), `positionPct: json` (e.g. `{x: 0.5, y: 0.3}` per locked decision that position is percentage-based), `maxDimensionsInches: json`.
- Unique index `(productId, zoneKey)`.
- `productDecorationRates.imprintZoneId` and `storeProducts.chosenImprintZoneId` FKs point to this table.
- Deletion semantics: a zone being deleted must cascade to orphan `productDecorationRates` rows that reference it (or the FK must be `onDelete: "set null"` — design decision for Task 3). Preference: `onDelete: "set null"` so the rate survives but needs relocation.

### 7.2 — Task 4 (Agent pattern)

This design defines a pricing agent-tool contract (§4.4). For that contract to be implementable, Task 4 must support:

- **Tool registration** in a central registry (§4.1 assumes `server/pricing/agentTool.ts` exports a tool object; Task 4 defines where the registry lives and how tools are registered).
- **Input/output schema enforcement** via Zod or JSON Schema at tool invocation time.
- **orgScope injection** into the tool's `ctx` from the caller's session — the tool cannot trust inputs for `orgId`.
- **Error propagation**: `PricingError` subclasses (decorationMethodRequired, decorationRateNotSet, orgScopeViolation, etc.) must surface structured to the agent so it can reason about the error and re-prompt the user, not just fail silently.

If Task 4 chooses a different tool pattern (e.g. function-calling vs MCP vs tRPC-only), the §4.4 wrapper adapts trivially; the calculator itself doesn't care.

### 7.3 — Task 5 (Conditional subsystems)

This design flags two interactions (§6.8, §6.9). Task 5 resolves whether multi-department and multi-division move into scope. The design is **structurally ready** for either answer:

- Multi-department promoted in-scope: `PricingContext.departmentId?: number` added, `stores.markupPct` optionally becomes `storeDepartmentMarkupRules`.
- Multi-division promoted in-scope: `storeProducts.customPrice` and `costOverrideCents` optionally extend with `divisionId` variants, OR a new `storeProductOverrides(storeProductId, divisionId, customPriceCents, costOverrideCents)` table.

Either case is additive to Phase 1, doable in Phase 2.

### 7.4 — Task 6 (Phase 0 close / regression baseline)

Task 6 runs the full regression protocol and captures a parity fixture for §5.6 smoke test. This design assumes a pre-cutover snapshot of pricing outputs from the legacy engine exists at Phase 1 open. If Task 6 does not produce that fixture, Phase 1 cannot run the smoke test.

---

## Appendix — Summary for Yan (read this if nothing else)

**Status (2026-04-21):** all 10 open questions are resolved. Phase 1 is no longer blocked on pricing-engine design. Remaining Phase 0 work is Tasks 3 (imprint zones), 4 (agent pattern), 5 (conditional subsystems), and 6 (regression baseline).

**Resolutions table** (all 2026-04-21; logged in `rebuild-2026-q2.md` as Decisions 4–12):

| § | Decision | Resolution |
|---|---|---|
| §6.1 | A | `products.pricingTiers` treated as live; §5.1 runs full backfill. |
| §6.2 | B | Add `sizeLabel` column to `productPriceTiers`; size upcharge preserved. |
| §6.3 | E | Column name stays `type`; TypeScript alias only. |
| §6.4 | C | New `proposalPriceOverrides` table (§3.8) preserves per-proposal tiers. |
| §6.5 | F | Single `stores.markupPct` column; `storeMarkupRules` deferred. |
| §6.6 | G | New `printFinishingRates` table (§3.9); finishing priced in Phase 1. |
| §6.7 | D | Variant model preserved; `productPriceTiers.variantId` FK added. No migration (no print products today). |
| §6.8 | — | Deferred to Phase 0 Task 5. |
| §6.9 | — | Deferred to Phase 0 Task 5. |
| §6.10 | I | Logged as Phase 6 bug in `rebuild-2026-q2.md` → Bugs Discovered Mid-Phase. |
| §5.2 engineering override | H | `productDecorationRates.legacyPlaceholder` flag replaces the zero-rate landmine. Non-breaking migration. |

**Structural summary (post-resolution):**

- **New tables:**
  - `productDecorationRates` — per-product/method/location rates + setup fees; `legacyPlaceholder` flag (Decision H).
  - `productPriceTiers` — unified tier table with `sizeLabel` (Decision B) and `variantId` FK to `printProductVariants.id` (Decision D); unique index on `(productId, variantId, sizeLabel, minQty)`.
  - `printProductSpecs` — per-product print spec sheet (paperStock, size, bleed, finishing options, etc.).
  - `proposalPriceOverrides` (§3.8, Decision C) — per-proposal custom tiers.
  - `printFinishingRates` (§3.9, Decision G) — per-product finishing-option upcharges.
- **`storeProducts`:** adds `chosenDecorationMethod`, `chosenImprintZoneId`, `costOverrideCents`. `customPrice` semantics clarified.
- **`stores`:** adds `markupPct`.
- **`products`:** retires `pricingTiers`, `decorationMethods`, `printAreas`, `printMethods`, `printColors`, `fileSpecs`. `type` column kept.
- **Retired tables:** `proposalPriceTiers`, `printProductPricing`.
- **One calculator entry point** (`calculatePrice`) consumed by checkout, proposals, print flow, cart, and an agent tool. `PricingContext` gains `sizeLabel`, `proposalProductId`, `selectedFinishingOptions`.

**Phase 1 unblock status:** pricing-engine design is complete and approved. Phase 1 remains gated only on the other Phase 0 tasks (3, 4, 5, 6) completing their gate reviews, plus Yan's phase-close sign-off per `phase-gate-template.md`.

