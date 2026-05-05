# Tier 1 — Phase 7 design notes

Architectural notes for the Phase 7 distributor manual-override UI,
captured during the 2026-04-26 nano-banana matrix validation session.
Not yet a final design — the open questions at the bottom of each note
are the inputs to Phase 7 detailed design when it picks up.

---

## Note 1 — Manual override preserves AI rendering quality

Manual override in Phase 7 modifies **placement input parameters**
(x, y, w, h, zone, decoration method) — NOT the rendered image
directly. When the distributor hits save, the override coordinates get
stored in `productImprintZones` (or whatever the Phase 7 schema lands
on; see Note 3), a `force: true` render job enqueues via
`addWebstoreRenderJob`, and nano-banana re-renders the product with
the corrected inputs.

The new render preserves all AI photorealistic capabilities — decoration
physics (embroidery thread texture, screen-print plastisol surface,
DTG fabric-weave bleed, etc.), fabric texture, lighting consistency,
transparent-logo alpha handling. **No fidelity loss between renders. No
edit-on-edit degradation cycle.** A distributor can adjust placement
ten times and the tenth render is no worse than the first.

This is structurally different from a "drag the logo around the
existing rendered image" UX, which would inevitably composite over an
AI-rendered surface and visibly fight the underlying decoration
physics. Phase 7 is "edit the inputs, get a fresh render," not "edit
the output."

---

## Note 2 — Hybrid customer-facing + distributor-facing UX during override re-renders

The customer-facing webstore and the distributor-facing curation UI
behave differently during the 30-60s re-render window after a
distributor saves a manual override.

### Customer-facing (Option A — continuity)

`WebstoreLogoOverlay` should **NOT** fall back to CSS overlay during
re-renders. It should continue showing the **PREVIOUS** nano-banana
render until the new one is ready, then swap. Customers always see a
high-quality preview, never see degraded output mid-edit.

Implementation:
- `WebstoreLogoOverlay` falls back to CSS overlay only when
  `webstoreRenderedImageUrl IS NULL` (no previous render exists at
  all).
- When `webstoreRenderedImageUrl` exists but `webstoreRenderStatus =
  'rendering'` (override re-render in progress), keep showing the
  existing URL.
- The `webstoreRenderStatus` field is for **distributor-side UI
  feedback only** — not for gating customer-facing rendering.

This means Step 6's WebstoreLogoOverlay (next in the current sprint)
needs to read `webstoreRenderedImageUrl` independently of
`webstoreRenderStatus` for the customer path. The status check is for
the distributor path only.

### Distributor-facing (Option B — explicit approval before publishing)

The distributor curation UI should **NOT** immediately publish the
override to customers. When the distributor hits save:

1. Show a "Rendering preview..." indicator with the new coordinates.
2. Wait for the new render to complete (30-60s).
3. Show the distributor the new render alongside the previous one
   (two-pane comparison or before/after toggle).
4. Distributor explicitly approves with a "Publish" button.
5. Only on Publish does the customer-facing webstore swap to the new
   render.

This protects against the distributor saving an override, realizing
the new render looks worse than the AI version, and customers seeing
the bad render in the meantime. Distributor previews internally,
approves, then publishes.

### Schema implication: need a "draft render" mechanism

Two candidate paths:

- **Two URL columns on `products`**: `webstoreRenderedImageUrl` =
  published-and-customer-visible, `webstoreDraftRenderUrl` = pending
  approval. Cheaper, but couples the draft state to the products
  table.
- **A separate `productOverrideDrafts` table** with its own render
  lifecycle. More flexible (multiple in-flight drafts per product,
  history, audit trail), more setup.

Decide during Phase 7 detailed design.

---

## Note 3 — Track AI-suggested vs effective coordinates separately

Phase 7 schema decision: store **AI-suggested coordinates** (immutable,
set by the analyzer at ingestion) separately from **effective
coordinates** (mutable, set by manual override or by re-running the
analyzer with `force: true`).

Use cases:

- **Distributor "revert to AI"** — one-click restore the AI's original
  suggestion if the distributor's manual override turns out worse.
- **A/B comparison UI** — show the distributor "AI suggested vs your
  override" side-by-side during the override flow so they can judge
  whether their edit is actually an improvement.
- **QA tracking** — measure how often manual overrides differ from AI
  placement, by how much, and on which product categories. Surfaces
  whether the AI's prior is reliable or whether certain product
  classes need special handling.
- **Future ML training data** — manual overrides are signal that the
  AI got it wrong. Useful for fine-tuning a follow-up vision model
  later.

### Schema candidates

- Add `aiSuggested*` columns to `products` mirroring the existing
  `webstoreImprintPlacement*` shape (X, Y, Width, Height, Zone,
  BlendMode, Confidence). Cheap, but doubles the column count.
- Use `productImprintZones` with a `source` column (`'ai'` |
  `'manual_override'`) so each row is tagged. Reuses the existing
  zone table that the cart payload already reads (see
  `docs/tier1-phase6-architecture-finding.md` for the cart-vs-AI
  divergence context).

Decide during Phase 7 detailed design. The `productImprintZones`
approach has the side effect of populating the (currently empty) cart
zone table, which closes the visual-vs-cart divergence flagged in the
Phase 6 architecture finding.

---

## Note 4 — Phase 7 frontend scope: Apple Enterprise Grade override editor

Phase 7 includes a full UI/UX for distributor manual override, not just
backend logic. The visual quality bar matches the rest of MergeTasks
(proposal builder, agentic inbox, curation surfaces) — clean visual
hierarchy, restrained color, direct manipulation feel, smooth state
transitions.

### Functional requirements

- Drag-to-reposition logo overlay (real-time preview during drag, not
  just on release).
- Corner-handle resize with aspect ratio lock toggle.
- Decoration method dropdown with method-appropriate visual hints
  (e.g., showing "embroidery" treatment preview on hover).
- Color picker for multi-colorway products so distributors can preview
  the logo on different SKU colors.
- Re-run AI button with confirmation modal ("This will replace your
  manual override with a fresh AI suggestion. Proceed?").
- Revert-to-AI-suggestion button (one-click restore of original AI
  placement; relies on Note 3's separately-stored AI-suggested
  coordinates).
- Save button that triggers a `force: true` re-render via the BullMQ
  queue from Step 3.
- Draft preview state vs. published state (per Note 2's hybrid
  Option A/B design).
- Undo / redo within an editing session.
- Snap-to-grid behavior for sensible position constraints.
- Visible state indicators: currently AI-placed / currently manually
  overridden / draft pending publish / published.

### Visual quality requirements

- Direct manipulation aesthetic — drag handles look intentional and
  well-crafted, not stock browser controls.
- Smooth animations communicating state transitions.
- Mobile / tablet responsive (distributors may curate from iPad).
- Accessible — keyboard navigation, ARIA labels, sufficient contrast.

### Effort estimate

Phase 7 backend logic (Notes 1-3) is ~30% of total Phase 7 scope. The
frontend editor is ~70%. Total Phase 7 estimate: 1-2 weeks of focused
design and engineering. Likely benefits from a separate UI/UX design
pass before implementation begins.

### Component reuse opportunity

The existing `ImprintZoneEditor` distributor component already handles
drag-to-reposition and corner-handle resize for the original CSS
overlay placement editor (referenced in
`docs/tier1-phase6-architecture-finding.md`). Phase 7 may extend that
component rather than building from scratch. Investigate during Phase
7 detailed design.

---

## Open questions for Phase 7 detailed design

1. Draft-render schema: two URL columns vs separate
   `productOverrideDrafts` table.
2. AI-suggested-vs-effective schema: `aiSuggested*` columns vs
   `productImprintZones` with `source`.
3. Confirmation dialog wording for `force: true` re-render
   (per the existing `analyzeWebstoreImprintPlacement` Phase 4
   procedure — its JSDoc requires the UI to guard, not the procedure).
4. Whether the override UI should allow edits to `decorationMethod`
   (changes the surface treatment) in addition to placement
   coordinates. Likely yes — the AI's category-based decoration
   guess will be wrong sometimes and distributors will want to
   correct it.
5. How to surface the "cap-front embroidery oversizes consistently"
   limitation (see migration-audit-followups.md) — probably a
   distributor-facing tooltip on cap products warning that AI
   tends to oversize, with a recommended manual adjustment.
