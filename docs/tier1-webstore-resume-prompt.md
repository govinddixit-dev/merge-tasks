# Tier 1 webstore — resume prompt

Context bridge for the next session picking up the Tier 1 webstore
AI-imprint-placement work. Read this top-to-bottom before touching
anything; the architectural decisions below are load-bearing and were
hard-fought across multiple sessions.

---

## Status snapshot (as of 2026-04-26)

**Tier 1 webstore work** = the customer-facing storefront's logo
overlay. Claude vision analyzes each product image once at ingestion
and caches normalized `{x, y, w, h, zone, blendMode, confidence}`
coordinates on `products.webstoreImprintPlacement*` columns; the
storefront's `WebstoreLogoOverlay` (Phase 6 component, not yet
written) composites the customer's logo on top using cheap CSS rather
than re-rendering the product image per view.

**This is intentionally separate** from the distributor virtual
proofing studio (`server/routers/proofing.ts` → OpenAI Images). See
`docs/virtual-proofing-recon.md` for the full boundary contract.
**Do not unify the two pipelines.**

### Phases complete

| Phase | What landed | Where to look |
|---|---|---|
| 0 | Recon: inventoried the 7 product-ingestion sites, decided on the customer-facing-overlay approach | (no commit, recon only) |
| 1 | Architectural split: which sites get real-time / batch / never hooks | Locked in `server/services/webstore-imprint-placement.ts` header comment block |
| 2 | Schema migration `0096_webstore_imprint_placement.sql` — 9 nullable placement columns + pending-backfill index | Commit `e1c5696` |
| 3 | Analysis service: `analyzeProductImage(imageUrl, productId?)` via Claude Sonnet vision, two-pass JSON parse, 15s hard timeout | Commit `e1c5696` (`server/services/webstore-imprint-placement.ts`) |
| — | Migration 0050 fix: rename `ppvProposalProductId` → `ppvProdId` to fit MySQL's 64-char identifier limit (the `migrate.sh` fail-loud patch from the same Phase 2/3 commit caught a pre-existing bug) | Commit `d625a57` |
| 4 | Three tRPC procedures: `analyzeWebstoreImprintPlacement` (single, with `force` flag), `analyzeWebstoreImprintPlacementBulk` (parallel via p-limit(10), rate-limited 20/hr/user), `overrideWebstoreImprintPlacement` (manual coords) | Commit `00e3468` |
| 5 | Ingestion hooks wired into `products.create` / `duplicate` / `seedCatalog` / `bulkCreate` / `uploadImage` / `copilotExecProducts.executeImportExternalProduct` + defensive no-hook comments on `supplierSync` and `sanMarBulkSync` | This commit (Phase 5) |

### Phases remaining

| Phase | Scope |
|---|---|
| 6 | Fork `client/src/pages/webstore/LogoOverlay.tsx` → `WebstoreLogoOverlay.tsx`. Rewrite to read placement coordinates from the `products` table (the new `webstoreImprintPlacement*` columns) instead of the distributor's `ImprintZoneEditor`. Customer-facing pages (`StoreProductDetailPage`, `StoreTemplateMinimal`, `StoreTemplateClassic`, `ProductCard`) swap their import to the new component. The original `LogoOverlay` stays untouched so the distributor's `ImprintZoneEditor` keeps working. **Show all files to be touched and proposed import swaps before writing code.** |
| 7 | Distributor override UI: a "Re-run AI" button on the catalog row + a placement-editor modal that calls `overrideWebstoreImprintPlacement`. Confirmation dialog required before sending `force=true` (see Phase 4 procedure JSDoc — the procedure does not enforce the prompt; the UI must). |
| 8 | Backfill script (`scripts/backfill-webstore-imprint-placements.ts`): scans `products WHERE webstoreImprintPlacementAnalyzedAt IS NULL` (the `webstore_placement_pending_idx` exists for exactly this query), runs analyses on a throttled schedule, idempotent on re-run. This is the recovery path for ALL the supplier-sync paths intentionally not hooked in Phase 5, plus any vision failures from Phase 5's fire-and-forget hooks. |
| 9 | Tests across the whole Tier 1 stack: analyzer service unit tests (mocked `invokeLLM`), procedure tests for the 3 Phase 4 procedures, hook tests (verify fire-and-forget pattern, manual_override skip, no_image skip), backfill script integration test. Phases 1–8 deliberately deferred tests; this is where they land. |

---

## Commits that matter

| SHA | Subject |
|---|---|
| `e1c5696` | feat(webstore): Phase 2 schema + Phase 3 analysis service for AI imprint placement (migration 0096 applied) |
| `00e3468` | feat(webstore): Phase 4 tRPC procedures for AI imprint placement |
| `d625a57` | fix(infra): rename ppvProposalProductId column + FK in migration 0050 to fit MySQL 64-char identifier limit |
| (this) | feat(webstore): Phase 5 ingestion hooks for AI imprint placement |

---

## Architectural decisions locked in

These have been negotiated and approved. **Do not relitigate without
new evidence.**

1. **Sonnet over Haiku** for vision analysis. Sonnet returns clean
   structured JSON ~95% of the time; Haiku is more prone to wrapping
   the reply in prose ("Here is the placement...") and burning a retry.
   Vision JSON discipline matters more than per-call cost — we run
   this once per product at ingestion, never in a hot loop.

2. **`runAnalysisAndPersist` lives in the service, not the router.**
   The Phase 5 copilot hooks needed it; a router→router import would
   be backwards. The helper's body is pure analyze-then-write logic
   with no router-specific state — it belongs in
   `server/services/webstore-imprint-placement.ts`. Same module also
   exports `runAnalysisAndPersistInBackground` (single-call
   fire-and-forget wrapper) and `runBulkAnalysisInBackground` (multi-id
   wrapper with p-limit(10)).

3. **Real-time hooks** on `products.create`, `products.duplicate`,
   `products.uploadImage`. Single-call fire-and-forget via
   `runAnalysisAndPersistInBackground`. Failure logged, never
   propagated; the Phase 8 backfill picks up `analyzedAt IS NULL`
   rows on its next pass.

4. **Background batch hooks** on `products.bulkCreate`,
   `products.seedCatalog`, and
   `copilotExecProducts.executeImportExternalProduct`. Multi-row
   fire-and-forget via `runBulkAnalysisInBackground`. IDs derived
   from `firstId + offset` per InnoDB's monotonic auto-increment
   guarantee for a single-statement INSERT (same trick
   `proofing.bulkRender` uses).

5. **No hooks on `supplierSync` / `sanMarBulkSync`.** Those paths
   move thousands to ~50k products per run — vision per row would
   blow up cost and rate limits. Defensive comment blocks at both
   sites explicitly forbid adding hooks. The Phase 8 backfill is the
   only path that touches these products' placement columns.

6. **Manual override is sacred.** Regular hooks (and the bulk
   procedure) hardcode `force=false` and skip with
   `reason: "manual_override"` when source is
   `'distributor_override'`. The ONLY way to re-analyze a manually
   placed product is `analyzeWebstoreImprintPlacement` with
   `force=true` — which the UI must guard with a confirmation
   dialog (Phase 7 obligation).

7. **`uploadImage` skips re-analysis on manual_override rows.** The
   re-uploaded image is stored, but the cached coordinates stay put.
   Forces the distributor to explicitly opt into re-analysis via the
   force-true path. Without this, swapping a product image would
   silently erase manual placement work.

8. **In-process p-limit(10) for bulk runs**, not BullMQ. At current
   ingestion volume (a few bulk imports per day) the in-process loss
   rate on process restart is acceptable; the Phase 8 backfill is
   the recovery net. Revisit BullMQ if bulk analyses start firing
   multiple times per minute — the failure mode is documented in the
   `runBulkAnalysisInBackground` JSDoc.

9. **WebstoreLogoOverlay forks from LogoOverlay in Phase 6.** Keeps
   the distributor's `ImprintZoneEditor` workflow on the original
   component unchanged. The two paths share zero runtime code after
   the fork — the fork is the point.

10. **The Tier 1 webstore overlay and the distributor virtual
    proofing studio are separate pipelines.** Different model,
    different audience, different cost profile, different output
    shape. See `docs/virtual-proofing-recon.md` for the full
    boundary contract. This is not a future-refactor opportunity —
    it is a deliberate split.

---

## Files to read first in the next session

1. `docs/tier1-webstore-resume-prompt.md` — this doc
2. `docs/virtual-proofing-recon.md` — architectural boundary with the
   distributor proofing studio. **DO NOT touch the proofing studio.**
3. `docs/migration-audit-followups.md` — engineering hygiene notes
   from the 0050 fix audit (data-loss risk in column renames, FK
   ON DELETE divergence, snapshot-vs-SQL consistency rule).
4. `server/services/webstore-imprint-placement.ts` — analyzer +
   helpers + the SCOPE BOUNDARY header comment block (the
   single source of truth for the Phase 5 hook split).
5. `server/routers/products.ts` — Phase 4 procedures + Phase 5
   real-time / bulk hooks.
6. `client/src/pages/webstore/LogoOverlay.tsx` — the component to
   fork in Phase 6.

---

## Phase 6 scope summary (next up)

Fork `client/src/pages/webstore/LogoOverlay.tsx` →
`WebstoreLogoOverlay.tsx`. Rewrite the new component to read placement
coordinates from the `products` table (the
`webstoreImprintPlacementX/Y/Width/Height/Zone/BlendMode` columns
populated by Phases 2–5), not from the distributor's `ImprintZoneEditor`
output. Customer-facing pages swap their imports to the new component:

- `client/src/pages/webstore/StoreProductDetailPage.tsx`
- `client/src/components/webstore/StoreTemplateMinimal.tsx`
- `client/src/components/webstore/StoreTemplateClassic.tsx`
- `client/src/components/webstore/ProductCard.tsx`

(Verify these paths in the next session — the file list may have
shifted.) The original `LogoOverlay.tsx` stays untouched so the
distributor's `ImprintZoneEditor` preview keeps working unchanged.

**Show all files to be touched and proposed import swaps before
writing code.** Hold for approval per file. Same per-step approval
process used in Phases 4 and 5.
