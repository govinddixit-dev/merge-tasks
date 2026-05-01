# Tier 1 Phase 6 — Architecture Finding

**Date:** 2026-04-26
**Status:** Decision recorded. Phase 6 unblocked.
**Audience:** future sessions picking up Tier 1 webstore work

This doc captures the architectural call made at the start of Phase 6
after a previous session paused on a perceived conflict between two
zone-configuration systems. The data gathered here recasts that
conflict as theoretical, not operational, and unblocks Phase 6 to ship
visual-only without touching the cart payload.

---

## The pause

Phases 2–5 of Tier 1 added AI-driven imprint placement to the
`products` table (`webstoreImprintPlacement*` columns) on the working
assumption that this was the source of truth for storefront logo
placement. The previous session, mid-Phase-6, surfaced a parallel
zone-configuration system — `productImprintZones` (per-product zones),
`imprintZonePresets` (seed catalog), `ImprintZoneEditor` (distributor
drag-and-drop UI) — and observed that the cart payload
(`storeCheckout.createSession` / `:1248`) reads `imprintZoneSlug` and
resolves it through `productImprintZones.id` to populate
`orderItems.imprintZoneId`. The previous session's framing:

> Phases 2–5 inverted the data ownership. `productImprintZones` is the
> source of truth for fulfillment; AI placement is competing with it.
> Three options on the table — A) cart reads from AI (couples
> fulfillment to AI), B) AI render reads from `productImprintZones`
> (AI becomes recommendation only), C) ship visual-only and document
> divergence.

Decision was deferred pending four diagnostic queries.

---

## Diagnostic findings (re-run 2026-04-26)

Source: `scripts/regression/diag-imprint-zones.ts` (Drizzle, read-only).

### Q1 — How populated is `productImprintZones`?

| Metric | Value |
|---|---|
| `productImprintZones` rows | **1** |
| `products` rows total | 13,858 |
| products with at least one zone | **1 (0.0%)** |
| `productImprintZoneDecorations` rows | 1 |

The single row: `slug = "main-panel"`, label "Main Panel".

### Q2 — How does the distributor create `productImprintZones` today?

Two insert sites:

1. **Manual via UI** — `server/routers/imprintZones.ts:278`,
   `imprintZones.upsert` mutation, called from
   `client/src/components/product/ImprintZoneEditor.tsx:303` "Save All".
   Per-product, opt-in, no automation.
2. **Supplier sync auto-seed** —
   `server/integrations/supplierSyncEngine.ts:256` upserts one zone per
   `loc.locationId` with hardcoded coordinates `(28, 22, 44, 40)`.
   Empirically not running (or not reaching the upsert) — accounts
   for ~zero of the 13,857 missing rows.

Customer-facing cart (`storeCheckout.ts:615` and `:1248`) reads via
`(productId, slug)` to resolve `imprintZoneSlug` →
`orderItems.imprintZoneId`. Today this lookup returns `null` for ~every
product because the table is empty. **Orders are being placed against
a `null` `imprintZoneId` already.**

### Q3 — Distributor admin UI for `productImprintZones`?

`client/src/components/product/ImprintZoneEditor.tsx` — 610-line
drag-and-drop editor, presets dropdown, decoration-method allowlist
per zone, one-default-per-product invariant. Embedded into
`client/src/pages/ProductDetail.tsx:621`. Hovers preview the brand
logo using the **original** `LogoOverlay` component — correct, the
Phase 6 fork is for customer-facing only.

### Q4 — Is `imprintZonePresets` populated?

| Metric | Value |
|---|---|
| preset rows total | **34** |
| preset rows active | 34 |

Sample slugs: `left-chest`, `right-chest`, `full-front`, `full-back`,
`left-sleeve`, `pocket`, `collar`, `hood`, `cap-front`, `cap-side`.

### Slug-convention comparison

| System | Convention | Sample |
|---|---|---|
| `imprintZonePresets` | kebab-case | `left-chest`, `cap-front` |
| `productImprintZones` | kebab-case (inherited from presets via editor + `slugify()`) | `main-panel` |
| AI vision (`webstoreImprintPlacementZone`) | snake_case | `chest_left`, `cap_front` (per analyzer service) |

Presets and `productImprintZones` agree (kebab). The AI service emits
snake. The divergence is real but narrow — easy to reconcile in either
direction at the boundary.

---

## Why the previous session's framing was overweighted

The "two competing sources of truth" framing assumed
`productImprintZones` was operationally load-bearing. The data
contradicts that:

- 1 row across 13,858 products = 0.00007% coverage.
- The cart's zone-slug → zone-id lookup already resolves to `null` for
  ~every order today.
- Whatever fulfillment logic depends on `orderItems.imprintZoneId` is
  either downstream-defaulting, accepting `null`, or cosmetic.
- `productImprintZones` is **aspirational infrastructure** — built,
  wired through to the cart, but never actually populated. The
  "source of truth" claim is structural (the schema and routers
  treat it as one), not operational.

A "two competing systems" conflict requires both systems to be
actively producing data. Only one is.

---

## Decision — Revised Option B

**Two-layer system, ship visual-only Phase 6 unchanged.**

| Layer | Source | Behavior |
|---|---|---|
| Visual render (storefront) | `products.webstoreImprintPlacement*` (AI vision) | New `WebstoreLogoOverlay` reads from AI columns. Image-relative coordinate space (OGIO Crunch fix). |
| Cart payload | `productImprintZones` via `imprintZoneSlug` | **Unchanged.** `selectedPlacement` state, `imprintZones` query, `addToCart` payload all stay exactly as they are today. Continues to resolve to `null` zone for ~every order — same as before Phase 6. |

This is a deliberate, documented divergence. The visual layer gets
the OGIO Crunch fix immediately. The cart layer stays on its existing
(mostly-null) path. We are **not breaking anything that wasn't already
null.**

### Why not the other options

- **Option A** (cart reads from AI). The previous session's main
  objection — "couples fulfillment to AI" — is weakened by the empty
  table, but the action would still rip out the existing cart wiring
  and rebuild it on AI columns. Not in Phase 6's scope. Premature
  given that distributors haven't asserted what they want from the
  cart yet.
- **Option C** (visual-only, document divergence as a temporary
  hack). Functionally identical to Revised Option B in the immediate
  term, but framed as a hack. Revised B reframes it as the **stable
  two-layer design** — AI for render, distributor config for
  fulfillment — which is what Phase 7 will formalize.

---

## Phase 7 implication

Phase 7 changes shape: instead of "edit AI placement", it becomes
**"edit `productImprintZones` with AI placement seeded as a suggestion."**

The Phase 7 distributor override UI:

1. Loads any existing `productImprintZones` for the product (likely
   none today).
2. If none exist, seeds the editor with the AI placement coordinates
   from `webstoreImprintPlacement*` as a starting point — with a clear
   "AI suggestion, click Save to commit" affordance.
3. Saves to `productImprintZones` via the existing
   `imprintZones.upsert` mutation. No new schema, no new mutation.
4. Optionally also writes back to `webstoreImprintPlacement*` with
   `webstoreImprintPlacementSource = 'distributor_override'` so the
   visual layer updates without waiting for re-analysis (Phase 4's
   `overrideWebstoreImprintPlacement` already does this).

Once distributors start populating `productImprintZones` through this
flow, the cart payload becomes meaningful and the visual-vs-cart
divergence closes naturally — without a forced migration.

The slug-convention divergence (snake vs kebab) is reconciled at the
override-UI boundary: when seeding from AI, normalize
`webstoreImprintPlacementZone` to kebab-case before populating the
editor's slug field.

---

## Documented followup — visual-vs-cart divergence

**Known:** The customer's storefront preview shows AI-placed logos.
The cart payload, if it carries an `imprintZoneSlug`, resolves through
`productImprintZones` (today: empty). For a product with AI placement
but no `productImprintZones` row, the customer sees the logo on
"Left Chest" (or wherever vision picked) but the order ships with
`imprintZoneId = null`.

**Operational impact today:** None. The cart already resolves to
`null` for ~every order — this Phase 6 change does not regress that
path. Order fulfillment downstream of `imprintZoneId` is whatever it
is today.

**When this matters:** Once a distributor uses Phase 7's override UI
to populate `productImprintZones` for a product, the cart payload
becomes accurate for that product. Until then, parity between visual
and cart is best-effort.

**Tier 1.5 candidate (deferred):** If `productImprintZones` coverage
crosses some threshold (say 50% of active products) and divergence
becomes a real customer-facing issue, fix the cart to fall back to
`webstoreImprintPlacement*` when no `productImprintZones` row exists.
Not in scope today.

---

## What Phase 6 ships

- `client/src/pages/webstore/WebstoreLogoOverlay.tsx` (new fork from `LogoOverlay.tsx`)
- `client/src/pages/webstore/StoreContext.tsx` — 5-column extension to `StoreProduct`
- `server/routers/storesCrud.ts` — 5-column extension to `getBySlug` mapper (and any other store mappers found in the audit)
- 4 customer-facing swap targets:
  - `client/src/pages/webstore/ProductCard.tsx`
  - `client/src/pages/webstore/StoreTemplateMinimal.tsx`
  - `client/src/pages/webstore/StoreTemplateClassic.tsx`
  - `client/src/pages/webstore/StoreProductDetailPage.tsx` (last remaining)
- Cart payload code paths: **untouched**.
- Distributor `ImprintZoneEditor` and original `LogoOverlay`: **untouched**.

---

## Reference — the diagnostic script

`scripts/regression/diag-imprint-zones.ts` — read-only, idempotent.
Re-run any time to monitor `productImprintZones` coverage. Useful for
deciding when the Tier 1.5 cart-fallback work becomes necessary.
