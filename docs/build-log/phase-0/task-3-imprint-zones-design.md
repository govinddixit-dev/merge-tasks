# Phase 0 Task 3 — Imprint Zone Schema Design

**Status:** Draft for Yan review
**Author:** Phase 0 Task 3
**Date:** 2026-04-21
**Scope:** Design only — no code, no migrations.
**Implemented by:** Phase 2 (Imprint Zone Infrastructure)
**Depends on:** Phase 0 Task 2 (Unified Pricing Engine) — this design provides the FK target for `productDecorationRates.imprintZoneId` and `storeProducts.chosenImprintZoneId`.

---

## Section 1 — Design Overview

### 1.1 Locked decisions (restated for reference)

Three decisions are locked by Yan and govern the entire design.

1. **Decision J — Multi-zone storage, single-zone Phase 1 checkout (Path A).** Schema supports ≥1 zone per product (one-to-many: `products` → `productImprintZones`). `storeProducts.chosenImprintZoneId` (Task 2 §3.5) remains the single-zone checkout mechanism in Phase 1. Multi-zone checkout is deferred but will require **no schema changes** — a future calculator iterates multiple chosen zones against the same table.
2. **Decision K — Zones declare maximum logo dimensions.** Each zone includes `maxWidthInches` and `maxHeightInches` as required columns. Distributor curation UX (Phase 4) enforces: a logo whose rendered dimensions exceed the zone's max cannot be selected for that zone. Declarative constraint per Principle #6 — policy lives in the schema, not the UI.
3. **Decision L — Zones are per-product, not per-category.** Each product has its own set of zones, fed by supplier API data where available (PromoStandards `Location` metadata, ASI imprint fields). No category-level default zone sets in the canonical schema. Category-level *fallback* is a calculation-time synthesis (§3), not a stored default.

### 1.2 What this design replaces

Three concrete surfaces in the current codebase are retired in Phase 2:

1. **Hardcoded `PLACEMENT_ZONES` array** at `client/src/pages/webstore/StoreProductDetailPage.tsx:44-52`:

   ```ts
   const PLACEMENT_ZONES: PlacementZone[] = [
     { id: "leftChest", label: "Left Chest", x: 16, y: 14, w: 20 },
     { id: "fullFront", label: "Full Front", x: 28, y: 22, w: 44 },
     { id: "back",      label: "Back",       x: 28, y: 22, w: 44 },
     { id: "sleeve",    label: "Sleeve",     x: 8,  y: 30, w: 16 },
   ];
   ```

   Every product in every webstore sees the same four placement options regardless of what the product actually supports. Zero constraint enforcement; zero connection to supplier data; no dimension limits. Violates Principle #6.

2. **`PlacementZone` interface + `getDefaultPlacement()` heuristic** at `client/src/pages/webstore/StoreContext.tsx:14-45`. The interface and category → zone heuristic (apparel → left chest; everything else → full front) are hardcoded in client state. The file's own comment admits this is *"derived heuristically from product category when not explicitly set"* — exactly the "policy hardcoded in UI" pattern Principle #6 bans.

3. **`virtualProofs.decorationZone` free-text `varchar(64)`** at `drizzle/schema.ts:467` with an inline hint comment (`// front, back, left_sleeve, right_sleeve, pocket`). No enum enforcement, no structural connection to any canonical zone, no dimension metadata. Consumed by:
   - `server/utils/generatePOsForOrder.ts:245,255,281` — read into `PO.lineItem.decorationLocation`.
   - `client/src/pages/public-proposal/ProductDetail.tsx:155` — rendered as a display badge.
   - `client/src/pages/public-proposal/publicProposalTypes.ts:37` — typed as `string | null`.

Retirement plan: §7.2.

### 1.3 Design north star

- **Percentage-based position coordinates**, not pixel coordinates on specific product photos. Photo-independent — the same "left chest" zone describes the same physical location whether the rendered product image is 800px or 2000px wide.
- **Structured semantic metadata** (body part, orientation, logo-type hint, supported decoration methods) that an AI agent can reason over declaratively.
- **Agent-accessible CRUD** (§5) with `orgScope`-enforced tRPC procedures and a documented tool contract per Principle #5.
- **Fallback chain** for legacy / zone-less products (§3) so the calculator can still price them without requiring a zone row to exist.
- **Supplier-ingestion-ready** schema (§4) — fields align with PromoStandards and ASI metadata without lossy conversion.

### 1.4 Schema drift from Task 2 §7.1 — flagged for Yan

Task 2 §7.1 described position and dimensions as **JSON columns** (`positionPct: json {x, y}`, `maxDimensionsInches: json`). This design proposes **four top-level `decimal(5,2)` columns** (`positionXPct`, `positionYPct`, `maxWidthInches`, `maxHeightInches`) instead. Rationale for the drift:

- **Queryability.** Phase 4 curation UX needs to filter on "zones wider than 3 inches" or "zones with X between 20 and 30." JSON-filter is slow on MySQL; decimal columns index cleanly.
- **AI tool schemas.** The agent tool contract (§5) exposes dimensions in its JSON Schema. Strict `decimal` columns let the tool declare `{type: "number", minimum: 0, maximum: 100}` per field; a single `json` column forces a looser contract.
- **Type safety.** Drizzle's `json.$type<{x, y}>()` is a compile-time hint, not a runtime check. `decimal` columns fail-loud at the DB level on invalid writes.
- **Supplier mapping.** PromoStandards returns `ImprintSize.Width` and `ImprintSize.Height` as separate numeric fields; flattening into our four columns is a 1:1 map.

Task 2 §7.1 expressed a *preference* for `onDelete: "set null"` on the two inbound FKs; this design **adopts that preference** without drift. All other contract elements (table name, `id` PK, `productId` FK, stable `zoneKey` varchar, unique index on `(productId, zoneKey)`) are satisfied.

**Action:** this drift is logged as Open Question §6.5 for Yan to either ratify as a Decision 13 entry in `rebuild-2026-q2.md` or push back on. Phase 2 implementation cannot proceed until the ratification is explicit — the FKs from the Task 2 tables pin down the column shape of this table, and any change propagates to Phase 1's migration plan.

**RESOLVED 2026-04-21 per Decision 13:** decimal columns ratified. Task 2 loader (`server/pricing/loader.ts`) and agent-tool JSON Schema (Task 2 §4.4 / Section 5) must be updated to decimal types during Phase 1 implementation — this is an implementation note, not a further schema change. The decimal shape is authoritative from this point forward.

---

## Section 2 — Schema Design

Every table or column added below ships in Phase 2 as one migration: add the table, add the FK relationships, wire reads/writes in the same PR per Principles #2–#4. `drizzle/_journal.json` is updated in the same commit as the SQL file (per the `feedback_migration_journal` memory).

### 2.1 — `productImprintZones` (new table)

```ts
// drizzle/schema.ts — Phase 2

export const productImprintZones = mysqlTable("productImprintZones", {
  id: int("id").autoincrement().primaryKey(),

  /** Parent product. CASCADE delete: zones are a child aggregate of the
   *  product; when the product goes, zones go. */
  productId: int("productId").notNull().references(() => products.id, { onDelete: "cascade" }),

  /** Multi-tenant scope. Required NOT NULL per the orgScope protected
   *  subsystem (protected-subsystems.md #2). Every read/write goes through
   *  scopeFor(productImprintZones) in server/utils/orgScope.ts (Phase 2
   *  adds the entry). Denormalized from products.organizationId for
   *  query-path efficiency and defense-in-depth against a missing join. */
  orgId: int("orgId").notNull().references(() => organizations.id),

  /** Stable semantic identifier. Snake_case canonical vocabulary
   *  (e.g. "left_chest", "full_back", "right_sleeve_hem",
   *  "cap_front_panel"). Serves as the stable identifier for URLs,
   *  agent-tool arguments, and supplier-feed matching. Unique per product
   *  — a product cannot declare the same zone twice. */
  zoneKey: varchar("zoneKey", { length: 64 }).notNull(),

  /** Human-readable display name. Localization-ready; the default English
   *  string is distributor-editable in Phase 4 UX. */
  zoneLabel: varchar("zoneLabel", { length: 128 }).notNull(),

  /** X coordinate as a percentage of the product's bounding box (0.00–
   *  100.00). Photo-independent. NULLABLE because some supplier feeds give
   *  a named location with no coordinates; calculator and UX fall back to
   *  named-location lookup / zoneNameNormalized when null. */
  positionXPct: decimal("positionXPct", { precision: 5, scale: 2 }),

  /** Y coordinate, same semantics. */
  positionYPct: decimal("positionYPct", { precision: 5, scale: 2 }),

  /** Maximum allowed logo width in inches (Decision K). Required. Phase 4
   *  curation UX rejects any logo whose rendered width > this value. */
  maxWidthInches: decimal("maxWidthInches", { precision: 5, scale: 2 }).notNull(),

  /** Maximum allowed logo height in inches (Decision K). Required. */
  maxHeightInches: decimal("maxHeightInches", { precision: 5, scale: 2 }).notNull(),

  /** Minimum allowed logo width in inches (Decision 15, 2026-04-21).
   *  Nullable; non-null values are enforced at curation time in Phase 4
   *  (warn when logo renders below minimum for legibility reasons —
   *  e.g., embroidery below 1.5" is industry-known bad output). */
  minWidthInches: decimal("minWidthInches", { precision: 5, scale: 2 }),

  /** Minimum allowed logo height in inches (Decision 15, 2026-04-21).
   *  Nullable; same curation-time semantics as minWidthInches. */
  minHeightInches: decimal("minHeightInches", { precision: 5, scale: 2 }),

  /** Decoration methods this zone supports (e.g. ["embroidery",
   *  "screen_print"]). Enables Phase 4 method picker to filter per zone.
   *  Values validated against the same method allow-list that
   *  productDecorationRates.method uses (Task 2 §3.2). */
  supportedDecorationMethods: json("supportedDecorationMethods").$type<string[]>().notNull(),

  /** Exactly one zone per product SHOULD be primary. Soft constraint —
   *  enforced at application layer (§6.6 flags hard-constraint options).
   *  The primary zone is the default when a distributor adds the product
   *  to a webstore without picking a zone; if none is primary, calculator
   *  falls back to sortOrder. */
  isPrimary: boolean("isPrimary").default(false).notNull(),

  /** Display order for distributor and customer UX. Ties broken by id. */
  sortOrder: int("sortOrder").default(0).notNull(),

  /** Provenance of this row. Same enum and semantics as
   *  productDecorationRates.source (Task 2 §3.2). Lets Phase 3 supplier
   *  sync know whether it's safe to overwrite a row. */
  source: mysqlEnum("source", ["supplier_api", "manual", "csv_import"]).default("manual").notNull(),

  /** Normalized form of zoneKey for supplier-vocabulary matching. Written
   *  by the §2.2 normalizer on insert/update. Stored rather than computed
   *  so an index can serve "does supplier name X already exist for this
   *  product" lookups during Phase 3 sync. Same value as zoneKey for
   *  manually-created zones; for supplier-imported zones, zoneNameNormalized
   *  records the canonical resolution of the supplier's original label. */
  zoneNameNormalized: varchar("zoneNameNormalized", { length: 64 }).notNull(),

  // --- Semantic AI metadata (§2.3) — top-level columns for queryability ---

  /** Structured body-part classification for agent reasoning (§2.3). */
  bodyPart: mysqlEnum("bodyPart", [
    "chest", "back", "sleeve", "hem", "collar",
    "cap_front", "cap_back", "cap_side",
    "bag_front", "bag_back",
    "drinkware_wrap", "drinkware_bottom",
    "pocket", "handle", "other",
  ]).notNull(),

  /** Spatial modifier within the body part. */
  orientation: mysqlEnum("orientation", ["left", "right", "center", "upper", "lower", "n_a"]).default("n_a").notNull(),

  /** Hint about what content style typically looks good here. Agents use
   *  this to suggest "try a monogram" vs "try a full-color logo." */
  typicalLogoType: mysqlEnum("typicalLogoType", ["logo", "text", "monogram", "pattern", "any"]).default("any").notNull(),

  /** Optional natural-language description. Agents may use this in their
   *  reasoning; Phase 4 UX may surface as tooltip. */
  description: text("description"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  productIdIdx: index("productImprintZones_productId_idx").on(t.productId),
  productOrgIdx: index("productImprintZones_productOrg_idx").on(t.productId, t.orgId),
  productPrimaryIdx: index("productImprintZones_productPrimary_idx").on(t.productId, t.isPrimary),
  zoneNormalizedIdx: index("productImprintZones_zoneNormalized_idx").on(t.productId, t.zoneNameNormalized),
  uniqZoneKey: uniqueIndex("productImprintZones_productId_zoneKey_uniq").on(t.productId, t.zoneKey),
}));

export type ProductImprintZone = typeof productImprintZones.$inferSelect;
export type InsertProductImprintZone = typeof productImprintZones.$inferInsert;
```

**Index rationale:**

- `productId` — base lookup by product.
- `(productId, orgId)` — orgScope-guarded product queries in a single index hit.
- `(productId, isPrimary)` — "find the primary zone for this product" at O(log n).
- `(productId, zoneNameNormalized)` — Phase 3 supplier sync checks "does a zone with this normalized name already exist for this product?" before inserting vs updating.
- **Unique `(productId, zoneKey)`** — satisfies Task 2 §7.1 contract; prevents duplicate zones.

**FK shape satisfied for Task 2:**

- `productDecorationRates.imprintZoneId` → `productImprintZones.id` with `onDelete: "set null"` — the rate survives zone deletion but the distributor is prompted to relocate it.
- `storeProducts.chosenImprintZoneId` → `productImprintZones.id` with `onDelete: "set null"` — the store listing survives; customer re-picks at cart time or distributor re-selects in Phase 4 UX.

Both FKs are defined in the Task 2 design; Phase 2's migration adds them in the same commit that creates `productImprintZones`.

### 2.2 — Zone name normalization (recommendation: in-code map)

Suppliers use inconsistent vocabulary for the same physical zone. The `zoneNameNormalized` column stores the canonical form; this section specifies how the normalizer works.

**Recommendation: in-code constant map at `server/pricing/zoneNormalization.ts`. CONFIRMED 2026-04-21 per Decision 16.** Rejected alternative: a `productImprintZoneAliases` table.

Why in-code rather than a table:

- **Cardinality is small and stable.** ~50–100 canonical zones covering the promo+print universe. Adding one is a code change, not a data operation.
- **Compile-time safety.** Matching against a TypeScript union is type-checked; matching against a DB table is runtime-only.
- **Determinism.** The normalizer must be deterministic at ingest time and at agent-tool time; an in-code map is trivially reproducible across environments. A table introduces a read and a potential staleness gap.
- **No orgScope concern.** Normalization is a platform-wide concern (PromoStandards' vocabulary is the same for every distributor), not a per-tenant one.
- **Easy override path.** If a distributor wants to add a custom alias, we can add a column to `productImprintZones` (`customAliases: json`) in a future phase — that's additive and doesn't compromise the core normalizer.

File shape:

```ts
// server/pricing/zoneNormalization.ts — Phase 2

export interface ZoneCanonical {
  zoneKey: string;           // stable snake_case identifier
  zoneLabel: string;         // default English display label
  bodyPart: BodyPart;        // see §2.3
  orientation: Orientation;  // see §2.3
  aliases: readonly string[]; // case-insensitive match targets
}

export const ZONE_CANONICALS: readonly ZoneCanonical[] = [ /* starter table below */ ];

/** Returns the canonical zone for a supplier-provided label, or null. */
export function normalizeZoneName(supplierLabel: string): ZoneCanonical | null { /* ... */ }
```

**Starter mapping table** (≥15 canonical entries; aliases drawn from PromoStandards `Location` enums, SanMar imprint areas, ASI ESP imprint metadata, and common distributor vocabulary). Case-insensitive, punctuation-agnostic match:

| zoneKey | zoneLabel | bodyPart | orientation | Aliases |
|---|---|---|---|---|
| `left_chest` | Left Chest | `chest` | `left` | "Left Chest", "LC", "Chest - Left", "Chest (Left)", "Front Left Chest", "FLC", "Left Chest (Wearer's Left)", "Chest Left" |
| `right_chest` | Right Chest | `chest` | `right` | "Right Chest", "RC", "Chest - Right", "Chest (Right)", "Front Right Chest", "FRC" |
| `center_chest` | Center Chest | `chest` | `center` | "Center Chest", "CC", "FCC", "Front Center Chest", "Chest Center" |
| `full_front` | Full Front | `chest` | `center` | "Full Front", "FF", "Front", "Full Chest", "Front Full" |
| `full_back` | Full Back | `back` | `center` | "Full Back", "FB", "Back", "Back Full" |
| `upper_back` | Upper Back / Yoke | `back` | `upper` | "Upper Back", "UB", "Yoke", "Back Yoke", "Back Neck", "Neck Yoke" |
| `left_sleeve` | Left Sleeve | `sleeve` | `left` | "Left Sleeve", "LS", "Sleeve - Left", "Sleeve Left" |
| `right_sleeve` | Right Sleeve | `sleeve` | `right` | "Right Sleeve", "RS", "Sleeve - Right", "Sleeve Right" |
| `left_sleeve_hem` | Left Sleeve Hem | `sleeve` | `left` | "Left Sleeve Hem", "LSH", "Left Cuff" |
| `right_sleeve_hem` | Right Sleeve Hem | `sleeve` | `right` | "Right Sleeve Hem", "RSH", "Right Cuff" |
| `bottom_hem` | Bottom Hem | `hem` | `lower` | "Hem", "Bottom Hem", "Shirt Hem" |
| `collar` | Collar | `collar` | `n_a` | "Collar", "Neck", "Neckline", "Back of Neck" |
| `left_chest_pocket` | Left Chest Pocket | `pocket` | `left` | "Pocket", "Front Pocket", "Left Chest Pocket", "Chest Pocket" |
| `cap_front` | Cap Front | `cap_front` | `center` | "Cap Front", "Front Panel", "Crown", "Cap - Front Panel", "Cap Front Panel" |
| `cap_back` | Cap Back | `cap_back` | `center` | "Cap Back", "Cap Closure", "Back of Cap", "Cap - Back" |
| `cap_side_left` | Cap Side (Left) | `cap_side` | `left` | "Left Side Panel", "Cap Side Left", "Side Left", "Left Cap Side" |
| `cap_side_right` | Cap Side (Right) | `cap_side` | `right` | "Right Side Panel", "Cap Side Right", "Side Right", "Right Cap Side" |
| `drinkware_wrap` | Wrap / Body | `drinkware_wrap` | `center` | "Wrap", "Body Wrap", "Drinkware Wrap", "Body", "Around", "Full Wrap" |
| `drinkware_bottom` | Bottom | `drinkware_bottom` | `lower` | "Bottom", "Base" |
| `bag_front` | Bag Front | `bag_front` | `center` | "Bag Front", "Front Panel", "Main Panel" |
| `bag_back` | Bag Back | `bag_back` | `center` | "Bag Back", "Back Panel" |
| `handle` | Handle | `handle` | `n_a` | "Handle", "Strap" |

22 canonical entries; ~80 aliases. Phase 2 extends the table based on real supplier-feed samples encountered during Phase 3 implementation. Unknown supplier labels fall through the normalizer and are stored in `zoneLabel` verbatim with `zoneKey = slugify(label)` and `zoneNameNormalized = zoneKey` — a distributor can reconcile later via the Phase 4 UX or by adding the alias to the canonical table.

### 2.3 — Semantic AI metadata

Zones are agent-accessible. Four metadata fields give an agent enough structure to reason about a zone without parsing `zoneLabel`:

- `bodyPart` (enum) — structured classification. Lets an agent answer "find me all chest zones across apparel products" with a plain WHERE clause.
- `orientation` (enum) — spatial modifier within the body part.
- `typicalLogoType` (enum) — hint about content. An agent asked "is this a good zone for a monogram?" reads this field.
- `description` (text, nullable) — natural-language description. Populated by suppliers or distributors; agents may use it in reasoning; Phase 4 UX renders as tooltip.

**Schema choice: top-level columns vs JSON.** This design uses top-level columns for the three enums and a `text` column for description. Rejected alternatives:

- **JSON blob (`metadata: json.$type<{bodyPart, orientation, ...}>`)** — saves one column, costs query-ability (the Phase 4 curation filter "show me all zones on chest" needs an index), costs AI tool-schema tightness (JSON Schema for agent tools wants strict field types), and costs Drizzle type safety (runtime `$type` hint only).
- **Separate `zoneMetadata` table** — over-normalized for a 1:1 relationship. Adds a join on every zone read.

Top-level columns win on every axis except column count. The column count is 4 (three enums + one text) — well under any reasonable table width limit.

**Queryability examples enabled by this layout:**

- "Find all apparel products that have a `left_chest` zone supporting embroidery" → index on `(productId, zoneKey)` + JSON contains on `supportedDecorationMethods`.
- "Find all zones on the back of a product that accept monograms" → WHERE `bodyPart = "back" AND typicalLogoType IN ("monogram", "any")`.
- "Find all zones missing a description" → WHERE `description IS NULL`. Useful for Phase 6 distributor-dashboard "zones needing enrichment" report.

---

## Section 3 — Fallback chain for legacy / zone-less products

Task 2 §4.3's `PromoCalculator` and `PrintCalculator` expect a `chosenImprintZoneId` when the product has any decoration rates. Many existing products will have no `productImprintZones` rows until a supplier sync populates them (Phase 3) or a distributor creates them manually (Phase 4). This fallback keeps the calculator operable on day one of Phase 2.

**Three-tier fallback:**

1. **Real zone row.** Product has ≥1 row in `productImprintZones`.
   - If the caller sets `ctx.requestedImprintZoneId` → use that.
   - Else if `storeProducts.chosenImprintZoneId` is set → use that.
   - Else if the product has an `isPrimary = true` zone → use the primary.
   - Else use the zone with the lowest `sortOrder`.

2. **Category-synthesized virtual zone.** No rows in `productImprintZones`, but `products.category` maps to a known default in `server/pricing/categoryDefaultZones.ts`. Calculator synthesizes a `ProductImprintZone`-shaped object *at calculation time* and does **not** persist it — the fallback is observational, not durable. Persisting would hide the gap that Phase 3 supplier sync is supposed to fill.

3. **No zone available.** Product has no zones and no category default. Decoration is not available for this product in Phase 2 (customer can still buy it blank). `PromoCalculator` surfaces a structured error `PricingError("noImprintZoneResolvable")` when the caller requests decoration; the calculator still returns a valid `PriceBreakdown` for the blank (non-decorated) path.

**Category → virtual zone map** lives at `server/pricing/categoryDefaultZones.ts`. Starter shape:

```ts
// server/pricing/categoryDefaultZones.ts — Phase 2
// Code-driven to match the zoneNormalization map's locality (§2.2).

export const CATEGORY_DEFAULT_ZONES: Record<string, VirtualZone> = {
  apparel_tshirt:      { zoneKey: "left_chest",     positionXPct: 28, positionYPct: 22, maxWidthInches: 4.0, maxHeightInches: 4.0, bodyPart: "chest",     orientation: "left",   supportedDecorationMethods: ["screen_print", "embroidery", "heat_transfer", "dtg"] },
  apparel_polo:        { zoneKey: "left_chest",     positionXPct: 28, positionYPct: 22, maxWidthInches: 4.0, maxHeightInches: 4.0, bodyPart: "chest",     orientation: "left",   supportedDecorationMethods: ["embroidery", "screen_print"] },
  apparel_hoodie:      { zoneKey: "full_front",     positionXPct: 50, positionYPct: 40, maxWidthInches: 12.0, maxHeightInches: 12.0, bodyPart: "chest",   orientation: "center", supportedDecorationMethods: ["screen_print", "heat_transfer", "dtg"] },
  cap:                 { zoneKey: "cap_front",      positionXPct: 50, positionYPct: 50, maxWidthInches: 4.0, maxHeightInches: 2.25, bodyPart: "cap_front", orientation: "center", supportedDecorationMethods: ["embroidery"] },
  drinkware:           { zoneKey: "drinkware_wrap", positionXPct: 50, positionYPct: 50, maxWidthInches: 8.0, maxHeightInches: 3.0, bodyPart: "drinkware_wrap", orientation: "center", supportedDecorationMethods: ["laser_engraving", "screen_print", "sublimation"] },
  bags:                { zoneKey: "bag_front",      positionXPct: 50, positionYPct: 50, maxWidthInches: 8.0, maxHeightInches: 6.0, bodyPart: "bag_front", orientation: "center", supportedDecorationMethods: ["screen_print", "embroidery", "heat_transfer"] },
  // ... extended in Phase 2 based on real category coverage
};

/** Virtual (non-persisted) zone object returned by the calculator when
 *  no productImprintZones row exists. Calculator consumes the same shape
 *  as a real zone but skips the FK check. */
export interface VirtualZone {
  zoneKey: string;
  positionXPct: number;
  positionYPct: number;
  maxWidthInches: number;
  maxHeightInches: number;
  bodyPart: BodyPart;
  orientation: Orientation;
  supportedDecorationMethods: readonly string[];
}
```

**Why a code file rather than a DB table:** same reasoning as §2.2 normalizer — small, stable, deterministic, no orgScope concern, compile-time safety beats runtime flexibility. **CONFIRMED 2026-04-21 per Decision 14.** File: `server/pricing/categoryDefaultZones.ts` (created in Phase 2). Initial category coverage required: `apparel_polo`, `apparel_tshirt`, `apparel_hoodie`, `drinkware_mug`, `drinkware_bottle`, `cap`, `bag_tote`, `bag_backpack`, `notebook`, `pen`, `banner` — final shape drafted in Phase 2 with Yan review.

**Observability:** the calculator emits a structured log line every time a virtual zone is synthesized (`virtualZoneFallback`, `productId`, `category`). Phase 6 cleanup uses these logs to prioritize which products Phase 3 sync or manual distributor entry should populate first.

---

## Section 4 — Supplier feed ingestion (Phase 3 preview)

Phase 2 ships the schema, the normalizer, and the virtual-zone fallback. Phase 3 builds the supplier sync that populates real rows. This section specifies what Phase 3's parsers must produce so Phase 2's schema is correctly shaped.

### 4.1 — PromoStandards

PromoStandards returns imprint-zone data through the `getProduct` service's `ProductPart` → `Location` and `ImprintSize` sub-objects.

**Field mapping:**

| PromoStandards field | `productImprintZones` column | Transform |
|---|---|---|
| `Location.LocationName` (string) | `zoneLabel` | verbatim |
| `Location.LocationName` (string) | `zoneKey` | `normalizeZoneName(LocationName).zoneKey`; fall back to `slugify(LocationName)` if unknown |
| `Location.LocationName` (string) | `zoneNameNormalized` | same as zoneKey when normalizer matched; else `slugify(LocationName)` |
| `Location.LocationType` (enum-ish string, when present) | `bodyPart` | lookup into `BODY_PART_FROM_PROMOSTANDARDS_TYPE` map (Phase 3 const) |
| `ImprintSize.Width` (decimal, inches) | `maxWidthInches` | verbatim |
| `ImprintSize.Height` (decimal, inches) | `maxHeightInches` | verbatim |
| `ImprintSize.PositionX` *if available* | `positionXPct` | verbatim (PromoStandards returns percentage) |
| `ImprintSize.PositionY` *if available* | `positionYPct` | verbatim |
| — | `supportedDecorationMethods` | derived from `ProductPart.DecorationMethodArray` filtered to the Location |
| — | `source` | `"supplier_api"` |

**When coordinates are missing:** PromoStandards frequently returns a `LocationName` string with no explicit X/Y. Store `positionXPct = positionYPct = NULL`; the UX and calculator fall back to the `zoneNameNormalized` lookup (which our normalizer resolves to a known canonical zone with default coords).

**Method derivation:** PromoStandards `DecorationMethodArray` is at the `ProductPart` level, not the `Location` level. **RESOLVED 2026-04-21 per Decision 18:** the compatibility table at `server/pricing/methodZoneCompatibility.ts` maps zone `bodyPart` → `Set<decorationMethod>` (e.g., `"chest"` → `{embroidery, screen_print, heat_transfer, dtg}`; `"cap_front"` → `{embroidery, laser_engraving}`; `"drinkware_wrap"` → `{laser_engraving, screen_print, sublimation}`). On supplier ingestion, Phase 3 Cartesian-joins methods × locations and then filters through this compatibility table: `(zone, method)` combos permitted by the table are assumed valid without supplier confirmation; incompatible combinations (e.g., embroidery on a drinkware wrap) are elided at parse time.

### 4.2 — ASI ESP

ASI's imprint metadata is less structured than PromoStandards. Key fields:

- `ImprintArea` (free-text, supplier-specific vocabulary) — normalized via the `zoneNormalization` map.
- `ImprintSize` (free-text, e.g., `"3.5\" x 2\""`) — parsed by a regex into `maxWidthInches` / `maxHeightInches`.
- `ImprintMethods` (array of strings, supplier-specific) — normalized into the canonical method vocabulary via a separate `methodNormalization` helper (Phase 3 adds; outside Task 3 scope).

**Missing-coord behavior is identical** to PromoStandards: NULL coords, rely on named lookup.

### 4.3 — Zero-data fallback

When a supplier provides no imprint metadata at all for a product, Phase 3 ingests the product with **zero** `productImprintZones` rows. The calculator falls through to §3's category-default fallback. Phase 3 surfaces the product in a Phase 6 cleanup report: "supplier provided no zone data; default synthesized from category; confirm or override." Phase 3's supplier adapter logs a `supplierMissingZoneData` structured event when it elides.

### 4.4 — Update semantics: source-gated overwrite

**RESOLVED 2026-04-21 per Decision 19.** On supplier re-sync of an existing product:

- Rows with `source = "supplier_api"` **can** be overwritten by the sync (new position, new dimensions, new method list propagate verbatim).
- Rows with `source = "manual"` or `source = "csv_import"` are protected — the sync **must not** overwrite them.
- When a supplier reports a zone change that conflicts with a manual/csv row, the sync emits a distributor-dashboard notification: _"Supplier reports '<zoneKey>' zone has new dimensions / position / methods; your manual configuration is unchanged — review and reconcile if needed."_

This protects distributor customizations while letting supplier-sourced rows evolve naturally with the supplier catalog. The `source` column (§2.1) is the sole arbiter — no separate "locked" flag.

---

## Section 5 — Agent tool contract

Per Principle #5, every domain action is callable by an agent. Four tools for zone CRUD; all run inside the tRPC session and inherit `orgScope` from the caller.

### 5.1 — `zones.list` (read)

```jsonc
{
  "name": "zones.list",
  "description": "List imprint zones for a product. Respects orgScope; returns empty array if the product has no zones. Fallback zones (category-synthesized) are NOT included unless includeFallback is true — agents planning a decoration decision typically want the authoritative set, not the heuristic.",
  "inputSchema": {
    "type": "object",
    "required": ["productId"],
    "properties": {
      "productId":       { "type": "integer" },
      "includeFallback": { "type": "boolean", "default": false }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "zones": {
        "type": "array",
        "items": { "$ref": "#/definitions/ProductImprintZone" }
      },
      "fallbackSource": {
        "type": "string",
        "enum": ["real", "category_default", "none"],
        "description": "How the caller should interpret the result: 'real' = rows from productImprintZones; 'category_default' = synthesized from categoryDefaultZones (only when includeFallback=true and no real rows exist); 'none' = no zones and no fallback available."
      }
    }
  }
}
```

### 5.2 — `zones.create` (write, distributor-only)

```jsonc
{
  "name": "zones.create",
  "description": "Create a new imprint zone on a product. orgScope: product must belong to caller's org; created row's orgId is forced from context, not input. Returns the created zone.",
  "inputSchema": {
    "type": "object",
    "required": ["productId", "zoneKey", "zoneLabel", "maxWidthInches", "maxHeightInches", "supportedDecorationMethods", "bodyPart"],
    "properties": {
      "productId":                  { "type": "integer" },
      "zoneKey":                    { "type": "string", "maxLength": 64, "pattern": "^[a-z0-9_]+$" },
      "zoneLabel":                  { "type": "string", "maxLength": 128 },
      "positionXPct":               { "type": "number", "minimum": 0, "maximum": 100, "nullable": true },
      "positionYPct":               { "type": "number", "minimum": 0, "maximum": 100, "nullable": true },
      "maxWidthInches":             { "type": "number", "minimum": 0 },
      "maxHeightInches":            { "type": "number", "minimum": 0 },
      "supportedDecorationMethods": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
      "isPrimary":                  { "type": "boolean", "default": false },
      "sortOrder":                  { "type": "integer", "default": 0 },
      "bodyPart":                   { "type": "string", "enum": ["chest","back","sleeve","hem","collar","cap_front","cap_back","cap_side","bag_front","bag_back","drinkware_wrap","drinkware_bottom","pocket","handle","other"] },
      "orientation":                { "type": "string", "enum": ["left","right","center","upper","lower","n_a"], "default": "n_a" },
      "typicalLogoType":            { "type": "string", "enum": ["logo","text","monogram","pattern","any"], "default": "any" },
      "description":                { "type": "string", "nullable": true }
    }
  }
}
```

**Error cases:**

- `OrgScopeViolation` — `product.organizationId !== ctx.orgId`.
- `DuplicateZoneKey` — unique index `(productId, zoneKey)` violated.
- `UnknownDecorationMethod` — `supportedDecorationMethods` contains a string outside the canonical allow-list.
- `PrimaryConflict` — `isPrimary = true` while another zone for this product is already primary (§6.6 open — app-level or DB-level enforcement).

### 5.3 — `zones.update` (write, distributor-only)

Partial update (PATCH semantics). Cannot change `productId`, `orgId`, or `id`. All other fields optional.

**Error cases:** same as `zones.create` plus `ZoneNotFound`.

### 5.4 — `zones.delete` (write, distributor-only)

```jsonc
{
  "name": "zones.delete",
  "description": "Delete an imprint zone. Will fail if productDecorationRates rows reference this zone and force=false. With force=true, referenced rows are set to imprintZoneId=NULL (they survive but need relocation). storeProducts.chosenImprintZoneId rows are always set to NULL per FK onDelete semantics.",
  "inputSchema": {
    "type": "object",
    "required": ["zoneId"],
    "properties": {
      "zoneId": { "type": "integer" },
      "force":  { "type": "boolean", "default": false }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "deleted":                 { "type": "boolean" },
      "decorationRatesOrphaned": { "type": "integer", "description": "Count of productDecorationRates rows whose imprintZoneId was set to NULL as a side effect." },
      "storeProductsOrphaned":   { "type": "integer", "description": "Count of storeProducts rows whose chosenImprintZoneId was set to NULL." }
    }
  }
}
```

**Error cases:**

- `OrgScopeViolation` — zone's product is outside caller's org.
- `ZoneHasDecorationRatesRefused` — returned when `force=false` and ≥1 `productDecorationRates` row references the zone. Agent decides whether to retry with `force=true`.
- `ZoneIsOnlyPrimaryForProduct` — if the zone is the only `isPrimary=true` zone and ≥1 other zones exist, require promoting another to primary first (prevents accidental "product has zones but no primary" state).

### 5.5 — Protection & enforcement

- **orgScope (protected #2):** the loader reads `product.organizationId` and compares to `ctx.orgId`; every read path also joins on `zones.orgId = ctx.orgId` for defense in depth.
- **Auth (protected #1):** tool runs inside the existing tRPC session; no bypass.
- **Agents inherit scope:** `ctx.orgId` is injected from the session, not trusted from tool input.

Task 4 must support: structured error propagation (so the agent can re-prompt the user on `ZoneHasDecorationRatesRefused`), tool registration via the central registry, and Zod/JSON Schema input validation at invocation time. Flagged in §7.2.

---

## Section 6 — Open questions for Yan

### 6.1 — Category-to-virtual-zone fallback: data-driven table or code-driven constants?

**RESOLVED 2026-04-21 — Decision 14:** code constants at `server/pricing/categoryDefaultZones.ts`. Initial category coverage: `apparel_polo`, `apparel_tshirt`, `apparel_hoodie`, `drinkware_mug`, `drinkware_bottle`, `cap`, `bag_tote`, `bag_backpack`, `notebook`, `pen`, `banner`. Reason: simpler, versioned with code, no admin-UI surface needed for Phase 1.

**Why it matters:** §3 recommends a code-driven file (`server/pricing/categoryDefaultZones.ts`). Alternative is a DB table (`categoryDefaultZones` with the same columns). Code is simpler, deterministic, and ships changes via PR review. Table is distributor-editable without a deploy.

**Options:**
- **(a) Code constants (recommended).** Fast, deterministic, reviewable, requires redeploy to change.
- **(b) DB table.** Distributor can edit via UX / tool; adds an orgScope concern (is the default shared across orgs or per-org?) and a migration path if the fallback schema changes.

**Recommendation:** (a) for Phase 2. Revisit in Phase 4 or Phase 6 if distributors actually ask to customize.

### 6.2 — Orphan discovery when a zone is deleted

**RESOLVED 2026-04-21 — Decision 22:** Phase 6 cleanup sweep. When a zone is deleted and `onDelete: "set null"` cascades produce orphaned `productDecorationRates` rows (`imprintZoneId` now NULL), the rows remain valid but disconnected. The Phase 6 cleanup sweep surfaces them alongside `legacyPlaceholder` and zero/multi-primary reports for distributor reconciliation. Reason: non-blocking at runtime; surfaced for distributor action via the established Phase 6 mechanism — no new audit table.

**Why it matters:** `onDelete: "set null"` on `productDecorationRates.imprintZoneId` means the rate survives zone deletion but the distributor may not notice. Similar pattern to Task 2's `legacyPlaceholder` sweep.

**Options:**
- **(a) Phase 6 cleanup sweep.** Mirror the `legacyPlaceholder` report: enumerate `productDecorationRates` rows with non-null `imprintZoneId` that fail the join (FK would catch this, but after a set-null the row has `NULL` — so the query is "rows with a non-NULL previous zone that have been orphaned"). Actually easier: Phase 6 enumerates `productDecorationRates WHERE imprintZoneId IS NULL AND product has other zones` — distributor can relocate.
- **(b) Transactional side-effect log.** Every set-null writes a `zoneDeletionOrphan` row to an audit table. Phase 6 reads that.

**Recommendation:** (a) — simpler, mirrors the established `legacyPlaceholder` pattern.

### 6.3 — Interaction with Task 2 §3.2 `legacyPlaceholder` decoration rates

**RESOLVED 2026-04-21 — Decision 21:** legacy `legacyPlaceholder = true` decoration rates remain unzoned (`imprintZoneId = NULL`) through Phase 2. Phase 6 cleanup sweep surfaces them alongside the other `legacyPlaceholder` reports for distributor reconciliation. Reason: auto-linking to the primary zone risks silent wrong-association (products with multiple zones at different rates would get the wrong rate); leaving unzoned forces distributor intentionality when they're ready to clean up.

**Why it matters:** Task 2 §5.2 creates `productDecorationRates` rows with `legacyPlaceholder = true` from `products.decorationMethods`. Those rows have no zone (`imprintZoneId = NULL`). When Phase 2 imports zones for a product, should those placeholder rows get auto-linked to the product's primary zone, or stay unzoned?

**Options:**
- **(a) Stay unzoned.** Calculator already treats placeholder rows as zero-charge without throwing (Task 2 Decision H). Distributor resolves both the rate and the zone relationship in Phase 6 sweep.
- **(b) Auto-link to primary zone on Phase 2 zone insertion.** Convenience, but risks the wrong zone getting the rate (a product may have three zones at different rates — "one size fits all" is a bad assumption).

**Recommendation:** (a). The flag is explicitly "historical marker, no rate yet"; auto-inferring a zone defeats the "surface for distributor to resolve" design.

### 6.4 — Minimum logo dimensions (`minWidthInches`, `minHeightInches`)?

**RESOLVED 2026-04-21 — Decision 15:** add `minWidthInches` and `minHeightInches` as nullable `decimal(5,2)` columns on `productImprintZones` (see §2.1). Phase 4 curation UX warns distributors when a logo renders below the minimum (e.g., _"Your logo renders at 0.8" wide on left chest; this zone requires a minimum of 1.5" for embroidery legibility"_). Reason: Yan is an apparel distributor; embroidery under 1.5" is industry-known bad output. Catching this at curation time prevents customer complaints later.

**Why it matters:** embroidery below 1.5 inches is illegible; screen print below 0.75" has registration problems. Phase 4 curation could warn distributors when a logo is too small for the zone's chosen decoration method.

**Options:**
- **(a) Ship Phase 2 without min dimensions.** Add only if Phase 4 UX proves the need.
- **(b) Add nullable `minWidthInches` / `minHeightInches` columns now.** Zero cost if unused; saves a migration later.

**Recommendation:** (b). The cost is two nullable columns; the value is optionality. Default NULL = "no minimum."

### 6.5 — Ratify the schema drift from Task 2 §7.1 as Decision 13?

**RESOLVED 2026-04-21 — Decision 13:** decimal columns ratified. `positionXPct` / `positionYPct` / `maxWidthInches` / `maxHeightInches` are `decimal(5,2)` (position nullable; dimensions NOT NULL); `minWidthInches` / `minHeightInches` added nullable per Decision 15. Task 2 §7.1's JSON shape is superseded. Implementation note: Task 2 loader (`server/pricing/loader.ts`) and agent-tool JSON Schema (Task 2 §4.4 / this doc's Section 5) must use decimal types during Phase 1 implementation — this is a downstream implementation note, not a further schema change.

**Why it matters:** §1.4 flags that Task 2 §7.1 described position/dimensions as JSON; this design uses four decimal columns. That's a real design decision with consequences for the Task 2 pricing engine's loader (`server/pricing/loader.ts`), which must hydrate `ProductPricingInput.decorationRates[].imprintZoneId` in a query that also reads zone dimensions.

**Options:**
- **(a) Formalize as Decision 13** in `rebuild-2026-q2.md` with a dated entry. Updates Task 2 §7.1 to reference Decision 13.
- **(b) Leave as an informal refinement** noted only in this Task 3 doc.

**Recommendation:** (a). The drift changes the loader's query shape and the agent tool's JSON Schema; both deserve a traceable decision record. Drafting the decision entry is trivial if Yan confirms.

### 6.6 — `isPrimary` enforcement — soft (app-level) or hard (DB trigger)?

**RESOLVED 2026-04-21 — Decision 17:** application-level enforcement in `zones.create` and `zones.update`. When a write sets `isPrimary = true`, the same transaction flips all other zones for that `productId` to `isPrimary = false`. No DB-level enforcement (no partial unique index, no trigger). Phase 6 cleanup sweep detects products with 0 or 2+ primary zones and reports them for manual correction. Reason: keeps schema portable across MySQL versions, avoids DB-specific SQL, handles edge cases via the primary write path.

**Why it matters:** the schema allows multiple rows per product to have `isPrimary = true`, which would be semantically broken. Options for enforcing "at most one primary per product":

- **(a) App-level check in every writer.** Zones.create / zones.update / migration / supplier-sync all check and demote a prior primary. Risks drift if a writer forgets.
- **(b) DB-level unique index `(productId, isPrimary)` WHERE `isPrimary = TRUE`.** MySQL doesn't support partial unique indexes directly; we'd emulate with a generated column and a unique index on it. Complexity.
- **(c) DB trigger on INSERT/UPDATE** that demotes any other primary for the same productId. Hidden side effect; complicates debugging.

**Recommendation:** (a) with a Phase 6 sweep that reports any product with ≠1 primary zone. MySQL's lack of proper partial indexes makes (b) awkward; (c) is debugging surface area we don't want.

### 6.7 — Method × zone Cartesian join during supplier ingest

**RESOLVED 2026-04-21 — Decision 18:** hardcoded compatibility table at `server/pricing/methodZoneCompatibility.ts` (`Record<zoneBodyPart, Set<decorationMethod>>`). On supplier ingestion, `(zone, method)` combos permitted by the table are assumed valid without supplier confirmation; incompatible combos (e.g., embroidery on a drinkware wrap) are elided at parse time. Reason: industry knowledge is stable and short; overclaim-and-prune adds phantom complexity for a rare edge case.

**Why it matters:** PromoStandards returns decoration methods at the `ProductPart` level, not the `Location` level. Phase 3 must choose how to populate `productImprintZones.supportedDecorationMethods`:

- **(a) Copy all product-level methods to every zone.** Overclaims — implies embroidery is valid on a drinkware wrap. Distributor prunes later.
- **(b) Prune via a hardcoded `methodBodyPartCompatibility` table.** Knows that `embroidery` is only compatible with `chest`, `back`, `sleeve`, `cap_front`, etc.; filters the Cartesian join. More accurate on day one, more code to maintain.
- **(c) Ingest empty and surface a Phase 6 report to the distributor.** Maximally safe, minimally useful on ingest.

**Recommendation:** (b). The compatibility knowledge is stable industry-wide (you can't embroider a ceramic mug), and the table is short enough to maintain.

### 6.8 — Supplier zone updates: overwrite vs version

**RESOLVED 2026-04-21 — Decision 19:** source-gated overwrite (see §4.4). Rows with `source = "supplier_api"` can be overwritten on re-sync; rows with `source = "manual"` or `"csv_import"` are protected. Conflicts emit a distributor-dashboard notification ("Supplier reports '<zoneKey>' has new dimensions; your manual configuration is unchanged — review and reconcile if needed"). Reason: protects distributor customizations while letting supplier data evolve naturally; matches the `source`-gated pattern from Task 2 §3.2.

**Why it matters:** Phase 3 re-syncs periodically. Suppliers occasionally change zone definitions (refine dimensions, rename). Overwriting silently may clobber distributor customizations; versioning adds complexity.

**Options:**
- **(a) Overwrite only when `source = "supplier_api"` AND no distributor edit since last sync.** Distributor edits flip `source` to `"manual"` and become sticky.
- **(b) Store supplier-provided values in a sibling `productImprintZonesSupplierOriginal` table; current row is always the distributor's edited view.** Heavy.
- **(c) Never overwrite — emit a diff report for distributor review.**

**Recommendation:** (a). Matches the `source` pattern from Task 2 §3.2.

### 6.9 — Migration for legacy `virtualProofs.decorationZone` strings

**RESOLVED 2026-04-21 — Decision 20:** Phase 2 migration runs the `server/pricing/zoneNormalization.ts` normalizer against every non-null `virtualProofs.decorationZone` string and writes the resolved FK into a new `virtualProofs.imprintZoneId` column. Non-matches are logged to a migration-report file for manual review. After the report is reviewed, the `virtualProofs.decorationZone` column is dropped in the same phase (no parallel path survives Phase 2, per Principle #3). Reason: clean cutover preserving existing proof data with FK integrity.

**Why it matters:** the retirement plan (§7.2) drops `virtualProofs.decorationZone` but historical proof rows hold free-text strings ("front", "left_sleeve", etc.). Phase 2 must decide:

- **(a) Best-effort translate via the normalizer; store resolved zone FK on `virtualProofs` (new column `virtualProofs.imprintZoneId`) before dropping the varchar.** Preserves historical context; requires the product referenced by the proof to have the zone.
- **(b) Drop the column, archive the old values in a one-time audit table before dropping.** Simpler; loses live linkage.
- **(c) Keep both columns in parallel for Phase 2 and retire in Phase 6.** Violates Principle #3 (no parallel paths).

**Recommendation:** (a). Adds one new FK column on `virtualProofs` and a Phase 2 migration that runs the normalizer over existing rows. Historical PO/proof displays continue to resolve.

### 6.10 — Multi-decoration-method pricing per zone

**NO DECISION REQUIRED — informational confirmation 2026-04-21.** A zone might support embroidery and screen print at different per-unit rates. Task 2 §3.2 `productDecorationRates` is already keyed by `(productId, method, location)` with a unique index — pricing-per-method-per-zone is handled by Task 2 without schema change. Listed here for completeness because reviewers may ask.

---

## Section 7 — Dependencies

### 7.1 — Task 2 (Pricing Engine) — contract satisfied (with drift)

The Task 2 §7.1 FK contract expected:

- ✅ Table named `productImprintZones`.
- ✅ `id: int` PK.
- ✅ `productId: int` FK → `products.id` with `onDelete: "cascade"`.
- ✅ Stable `zoneKey: varchar(64)` (canonical snake_case vocabulary).
- ⚠️ **Drift:** `positionPct: json {x, y}` → split into `positionXPct: decimal(5,2)` + `positionYPct: decimal(5,2)`, both nullable. Justification in §1.4; ratification proposed as Decision 13 per §6.5.
- ⚠️ **Drift:** `maxDimensionsInches: json` → split into `maxWidthInches: decimal(5,2)` + `maxHeightInches: decimal(5,2)`, both NOT NULL.
- ✅ Unique index on `(productId, zoneKey)`.
- ✅ `productDecorationRates.imprintZoneId` FK → this table with `onDelete: "set null"` (Task 2 preference adopted).
- ✅ `storeProducts.chosenImprintZoneId` FK → this table with `onDelete: "set null"`.

**Loader impact (Task 2 §4.1):** `server/pricing/loader.ts` hydrates `ProductPricingInput.decorationRates[*].imprintZoneId` and will also need a zone-bundle read for the calculator's dimension checks (Phase 4 curation enforcement — Phase 2 only loads the FK itself). No change to Task 2's `ProductPricingInput` shape in Phase 2; Phase 4 adds a `zones` field if the curation UX needs dimensions at calc time.

### 7.2 — Retirement plan (authoritative)

Phase 2 deletes the three surfaces listed in §1.2 in the same PR that adds `productImprintZones`:

| Deletion | File/Location | Replaced by |
|---|---|---|
| `PLACEMENT_ZONES` const array | `client/src/pages/webstore/StoreProductDetailPage.tsx:44-52` | Phase 2 picker fetches `zones.list` tRPC endpoint per product |
| `PlacementZone` interface + `getDefaultPlacement()` | `client/src/pages/webstore/StoreContext.tsx:14-45` | Replaced by a shared `ImprintZone` type (mirrors the Drizzle row) + `categoryDefaultZones.ts` lookup |
| `virtualProofs.decorationZone: varchar(64)` | `drizzle/schema.ts:467` | Replaced by `virtualProofs.imprintZoneId: int` FK → `productImprintZones.id` (per §6.9 recommendation); migration translates legacy strings via the normalizer |

Principles #2 and #3 bind: same PR deletes the three surfaces listed above. No parallel paths survive Phase 2. Downstream consumers (`generatePOsForOrder.ts`, the public-proposal detail page) are migrated to read `virtualProofs.imprintZoneId` and join to `productImprintZones.zoneLabel`.

### 7.3 — Task 4 (Agent pattern)

For §5's tool contract to be implementable, Task 4 must support:

- **Tool registration** in a central registry (§5 assumes zones tools are registered alongside `pricing.calculate` from Task 2 §4.4).
- **orgScope injection** from `ctx` — the tool cannot trust `orgId` from input.
- **Structured error propagation** — the agent needs to distinguish `ZoneHasDecorationRatesRefused` (recoverable with `force=true`) from `OrgScopeViolation` (permanent).
- **Zod / JSON Schema validation** at invocation time for the enum fields (`bodyPart`, `orientation`, `typicalLogoType`).

If Task 4 picks a different runtime (MCP, function-calling, etc.), the tool wrappers adapt trivially — the calculator and DB layer don't change.

### 7.4 — Task 5 (Conditional subsystems)

**RESOLVED 2026-04-22 per Decisions 37 and 38:** both conditional items promoted to **IN SCOPE as first-class features**. Imprint zone schema requires **no direct changes** — zones remain product-scoped, not department- or division-scoped. Downstream impact lands in Phase 4 curation UX: when presenting the zone picker, Phase 4 must handle division-scoped product visibility (a product not visible to the current division doesn't surface its zones). Department-scoped zone defaults are not part of Decisions 37/38 scope and remain a future-phase possibility only if requirements surface.

- **Multi-department:** no current zone-schema interaction. Future phases may add per-department zone defaults (e.g., department A wants left-chest logos; department B wants full-front); no schema change needed — the `productImprintZones` data model already supports it.
- **Multi-division:** `storeProducts.divisionIds` drives division-scoped product visibility in Phase 4; the zone picker inherits that visibility filter without any schema change. Zones themselves are product-scoped; no division-schema interaction at the zone layer.

### 7.5 — Phase 2 implementation work items (derived from this design)

Phase 2's task list, in dependency order (reflects all 2026-04-21 Decisions 13–22):

1. Drizzle table definition: `productImprintZones` in `drizzle/schema.ts` per §2.1 — **19 columns**, including `minWidthInches` / `minHeightInches` nullable decimals (Decision 15) and the four position/dimension decimals ratified by Decision 13.
2. Drizzle relations entry: `drizzle/relations.ts` wiring to `products` and the inbound FKs from `productDecorationRates` / `storeProducts`.
3. Migration SQL file + matching `drizzle/_journal.json` entry (per the `feedback_migration_journal` memory).
4. `orgScope` utility entry: add `productImprintZones` to `server/utils/orgScope.ts` (protected subsystem — careful single-file edit, same pattern as existing entries at `:27,:60,:137`).
5. Normalizer module: `server/pricing/zoneNormalization.ts` per §2.2 and Decision 16, with the starter table (22 canonical zones, ~80 aliases) and `normalizeZoneName()`.
6. Category defaults module: `server/pricing/categoryDefaultZones.ts` per §3 and Decision 14. Initial coverage: `apparel_polo`, `apparel_tshirt`, `apparel_hoodie`, `drinkware_mug`, `drinkware_bottle`, `cap`, `bag_tote`, `bag_backpack`, `notebook`, `pen`, `banner`.
7. Method-zone compatibility module: `server/pricing/methodZoneCompatibility.ts` per Decision 18 — `Record<zoneBodyPart, Set<decorationMethod>>` consumed by supplier ingest (§4.1) and by `zones.create` / `zones.update` validation.
8. Calculator integration: Task 2 `PromoCalculator` / `PrintCalculator` read `input.zones` (new field, to be added to `ProductPricingInput` in Phase 2) and apply the fallback chain. Phase 2 extends Task 2's interface; Task 2's design anticipates this (see §7.1).
9. tRPC router: `server/routers/zones.ts` implementing the §5 agent tools. Writes enforce `isPrimary` uniqueness at application level (Decision 17) — when `isPrimary = true` is written, the same transaction flips all other zones for that `productId` to `isPrimary = false`.
10. Agent tool registration: register `zones.list`/`.create`/`.update`/`.delete` alongside `pricing.calculate` (pattern follows Task 4's contract).
11. Client picker component: new `<ImprintZonePicker>` replacing the hardcoded `PLACEMENT_ZONES` + `getDefaultPlacement` usage at `StoreProductDetailPage.tsx`. Apple-for-enterprise UX standard per Principle #7.
12. Retirement (same PR as additions, per Principles #2 and #3): delete `PLACEMENT_ZONES`, delete `PlacementZone` / `getDefaultPlacement`, migrate `virtualProofs.decorationZone` per Decision 20 (add `virtualProofs.imprintZoneId` FK column, run normalizer over existing strings, emit migration-report file for unresolved rows, then drop `decorationZone` column).
13. Supplier adapter shims: stub out `server/integrations/promoStandardsZoneIngest.ts` and `server/integrations/asiZoneIngest.ts` with the §4 field mapping and §4.4 source-gated overwrite semantics (Decision 19). Real sync is Phase 3, but Phase 2 ships the parser interfaces, the compatibility filter from item 7, and the overwrite-guard logic.
14. Task 2 implementation note (Decision 13): when Phase 1 implements `server/pricing/loader.ts` and the `pricing.calculate` agent-tool JSON Schema, use decimal types for position / dimensions / min-dimensions columns. This is an implementation reminder for Phase 1, not a Phase 2 deliverable — logged here so it isn't lost.
15. Phase 6 cleanup-sweep additions (Decisions 17, 21, 22): the existing sweep must also report (a) products with 0 or 2+ `isPrimary` zones, (b) `productDecorationRates` rows with `legacyPlaceholder = true` still unzoned, and (c) `productDecorationRates` rows orphaned by zone deletion (non-null→null `imprintZoneId` via `onDelete: "set null"`). Phase 6 is non-blocking at runtime; the sweep surfaces these for distributor reconciliation.
16. Tests: unit tests for the normalizer and the method-zone compatibility filter, integration test for `zones.create` orgScope enforcement and `isPrimary` uniqueness, end-to-end test for the picker + cart flow, regression-protocol baseline on every touched file.
17. Build log updates: Phase 2 summary, Architectural Decisions updated as needed, Dead Code Deleted entries for all three §7.2 retirements.

---

## Appendix — Summary for Yan (read this if nothing else)

**Status (2026-04-21):** all 9 open questions from §6 resolved (§6.10 is informational — no decision required). Decisions 13–22 recorded in `rebuild-2026-q2.md`. Phase 2 is unblocked pending Phase 0 Tasks 4, 5, 6.

**Shipping in Phase 2:**

- **New table** `productImprintZones` — **19 columns**: four ratified decimal position/dimension columns (Decision 13), two new nullable `minWidthInches` / `minHeightInches` columns (Decision 15), plus zoneKey/label/normalized, source, primary flag, sort order, supported methods, body-part/orientation/typicalLogoType enums, description text, timestamps.
- **In-code normalizer** `server/pricing/zoneNormalization.ts` with 22 canonical zones and ~80 aliases (Decision 16). Extensible via PR.
- **In-code category defaults** `server/pricing/categoryDefaultZones.ts` powering the 3-tier fallback chain (§3; Decision 14). Initial coverage: `apparel_polo`, `apparel_tshirt`, `apparel_hoodie`, `drinkware_mug`, `drinkware_bottle`, `cap`, `bag_tote`, `bag_backpack`, `notebook`, `pen`, `banner`.
- **In-code method-zone compatibility table** `server/pricing/methodZoneCompatibility.ts` filtering supplier Cartesian-joined `(zone, method)` combos at ingest time (Decision 18).
- **Agent tools** `zones.list` / `.create` / `.update` / `.delete` with structured error propagation, orgScope enforcement, and application-level `isPrimary` uniqueness (Decision 17).
- **Supplier sync policy** source-gated overwrite: `supplier_api` rows can be overwritten on re-sync; `manual` / `csv_import` rows are protected and conflicts emit a distributor-dashboard notification (Decision 19).
- **Retirement** (same Phase 2 PR, per Principles #2 and #3): the hardcoded `PLACEMENT_ZONES` array, the `getDefaultPlacement` heuristic, and the `virtualProofs.decorationZone` varchar. Legacy `decorationZone` strings are translated via the normalizer into a new `virtualProofs.imprintZoneId` FK column; unresolved rows are logged to a migration-report file for review (Decision 20).
- **Phase 6 cleanup-sweep extensions:** detect products with 0 or 2+ `isPrimary` zones (Decision 17); surface still-unzoned `legacyPlaceholder` decoration rates (Decision 21); surface decoration-rate rows orphaned by zone deletion (Decision 22).

**Resolved open questions (§6):**

| Open Q | Resolution | Decision |
|---|---|---|
| §6.1 — Category fallback storage | Code constants at `categoryDefaultZones.ts` | **14** |
| §6.2 — Orphan discovery on zone deletion | Phase 6 cleanup report | **22** |
| §6.3 — Legacy `legacyPlaceholder` rates | Left unzoned; Phase 6 reconciles | **21** |
| §6.4 — Minimum logo dimensions | Add `min{Width,Height}Inches` nullable decimals | **15** |
| §6.5 — Ratify decimal-column drift | Ratified | **13** |
| §6.6 — `isPrimary` enforcement | Application-level + Phase 6 sweep | **17** |
| §6.7 — Method × zone ingest filter | Hardcoded compatibility table | **18** |
| §6.8 — Supplier update semantics | Source-gated overwrite | **19** |
| §6.9 — Legacy `virtualProofs.decorationZone` | Normalize → FK on migration; drop column | **20** |
| §6.10 — Multi-method pricing per zone | Informational confirmation (Task 2 already handles) | — |

**Task 2 downstream implementation note (Decision 13):** when Phase 1 ships `server/pricing/loader.ts` and the `pricing.calculate` agent-tool JSON Schema, position/dimension/min-dimension fields must use decimal types — not JSON blobs. Logged here so it isn't lost between Phase 0 Task 3 close and Phase 1 kickoff.

**Phase 2 unblock status:** this design is complete and ratified. Phase 2 implementation begins after Phase 0 Tasks 4, 5, 6 reach their gate reviews.
