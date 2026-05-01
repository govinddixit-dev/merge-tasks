# Tier 1 nano-banana — resume state (paused 2026-04-26 evening)

End-of-session snapshot. Next session: pick up from the multi-tenant
correctness fix.

---

## Sprint progress

| Step | Status |
|---|---|
| 1. Schema + migration 0098 (render columns on `products`) | ✅ deployed (drizzle/0098 applied) |
| 2. nano-banana Gemini service wrapper | ✅ deployed |
| 3. BullMQ render queue + tiered backoff | ✅ deployed |
| 4. Render worker as separate pm2 app | ✅ deployed (id 2, idle) |
| 5. Phase 5 ingestion hooks (orchestrator + 4 tRPC callsites) | ✅ deployed |
| 6. WebstoreLogoOverlay reads `webstoreRenderedImageUrl` | ✅ deployed (`pm2 reload` at 20:08:38Z) |
| 7. Backfill — enqueue per-binding renders for storeProducts without complete renders | ⏸ not started |
| 8. Commit + branch decision | ⏸ not started |

**Production has been reloaded twice tonight:**
- 19:53Z — Step 5 (Phase 5 hooks)
- 20:08Z — Step 6 (WebstoreLogoOverlay client + getBySlug select)

Both reloads were `pm2 reload mergetasks` (zero-downtime). The render
worker (`mergetasks-render-worker`) was launched once at 19:10Z and
has not been touched since.

---

## Production state at pause

```
mergetasks                 PID 627537   uptime 14m   restarts 143   online
mergetasks-render-worker   PID 623654   uptime 72m   restarts 0     online (idle)
```

Worker is idle — queue is empty (`completed=12, failed=0, wait=0,
active=0`). The Step 6 deploy is live and serving customer traffic.
Last user activity in the application logs was at 18:45Z (info@otentikbrand.com
denying pending copilot actions); nothing since. Nginx wildcard
subdomain `*.mergetasks.com` proxies storefront slugs to port 3000.

---

## Modified files on disk (uncommitted, safe to leave)

**Modified, tracked:**
- `client/src/pages/webstore/ProductCard.tsx`
- `client/src/pages/webstore/StoreContext.tsx`
- `client/src/pages/webstore/StoreProductDetailPage.tsx`
- `client/src/pages/webstore/StoreTemplateClassic.tsx`
- `client/src/pages/webstore/StoreTemplateMinimal.tsx`
- `client/src/pages/webstore/WebstoreLogoOverlay.tsx`
- `docs/migration-audit-followups.md`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`
- `ecosystem.config.cjs`
- `package.json`
- `server/routers/copilotExec/webstore.ts`
- `server/routers/products.ts`
- `server/routers/storesCatalog.ts`
- `server/routers/storesCrud.ts`

**Untracked, new:**
- `docs/tier1-nano-banana-resume-prompt.md`
- `docs/tier1-phase7-design-notes.md`
- `docs/tier1-resume-state-2026-04-26.md` (this file)
- `drizzle/0098_webstore_render_columns.sql`
- `scripts/regression/diag-render-queue.ts`
- `scripts/regression/verify-0098-render-columns.ts`
- `server/queue/webstore-render-queue.ts`
- `server/services/nano-banana.ts`
- `server/services/webstore-render-orchestrator.ts`
- `server/workers/` (directory)
- `start-render-worker.sh`

Nothing is staged. Working tree matches what was deployed via `pnpm
build` + `pm2 reload`. The next session can edit any of these files
freely; the running production process holds the previously-built
bundle and won't pick up source changes until the next `pnpm build`
+ `pm2 reload`.

---

## Next-session priorities (ordered)

### 1. Multi-tenant correctness fix — HIGH

Migrate render columns from `products` to `storeProducts`. Currently
the same product on two distributors' stores would have one render
overwritten by the other. N=0 such products today but the schema
allows it.

Scope:

1. **Migration 0099** — add `webstoreRenderedImageUrl`,
   `webstoreRenderStatus`, `webstoreRenderedAt` to `storeProducts`;
   drop the same columns from `products` (or leave them and
   deprecate — discuss before dropping in case of in-flight reads).
2. **Worker** (`server/workers/webstore-render-worker.ts`) — write
   results keyed by (storeId, productId) instead of productId.
3. **Queue** (`server/queue/webstore-render-queue.ts`) — change
   jobId from `product-${id}` to `sp-${storeId}-${productId}`;
   `addWebstoreRenderJob` payload now needs `storeId`.
4. **Orchestrator**
   (`server/services/webstore-render-orchestrator.ts`) — pass
   storeId into the job payload; `fanOutRenderForProduct` already
   iterates per store, just need to wire storeId through to
   `addWebstoreRenderJob`.
5. **Reader: `getBySlug`** in `server/routers/storesCrud.ts` —
   project `webstoreRenderedImageUrl` from the joined
   `storeProducts` row, not from `products`.
6. **Client** (`StoreContext.StoreProduct`,
   `WebstoreLogoOverlay`) — type and prop signature unchanged from
   the client side; only the source of truth on the server moves.
7. **Regenerate the 4 existing renders** per binding via the
   production orchestrator path (the URLs from the `products` table
   become the seed; for a clean migration just clear them and
   re-enqueue per binding).

Estimated effort: 3-5 hours per the followup doc. Will require one
more `pnpm build` + `pm2 reload`.

### 2. Yan Financial test data cleanup — MEDIUM

Three Yan stores exist with three different clientIds:

- `storeId=2` (slug `yan-financial`, clientId 1) — has clientId=1's
  logo (Otentik test logo, mislabeled as Yan).
- `storeId=3` (slug `yan`, clientId 6) — **clientId=6 has zero logo
  rows.** Storefront cannot render or fall back to CSS. Currently
  shows old test-script renders.
- `storeId=4` (slug `yanfinancial`, clientId 10) — has the actual
  Yan Financial logo. After tonight's orchestrator-path re-render,
  this storefront shows pId=66 (OGIO Duffel) with the correct logo.

Options for cleanup:
- Consolidate to one canonical test store (recommend storeId=4 with
  clientId=10).
- Or, less aggressively: upload a logo for clientId=6 so storeId=3's
  3 demo products can render through the production path.

This is independent of the schema migration but should be done
before re-recording the visual demo.

### 3. Step 7 backfill — LOW until #1 is done

Currently planned as: enqueue renders for any `storeProducts`
binding where the joined product lacks a complete render. **After
the multi-tenant fix, this becomes: enqueue per `storeProducts.id`
where `storeProducts.webstoreRenderStatus IS NULL`** — the per-
binding migration changes the predicate. Don't write Step 7 against
the current schema; it'd need to be re-implemented after the
migration.

### 4. Step 8 commit decision

Leaning Option B (feature branch) per tonight's discussion:
- Branch `tier1-nano-banana` from main
- All Steps 1-6 + multi-tenant fix + Yan cleanup + Step 7 backfill
  land on the branch
- Merge to main only when multi-tenant correctness is verified
  end-to-end with a two-tenant test
- See tonight's transcript for the full Option A vs Option B
  analysis (and the pushback on the "main never contains a
  compromise" framing — Option A remains a defensible alternative
  if a second real distributor is far off)

---

## Reference points

### Six rendered products and storefront bindings

| pId | name | renderedAt (UTC) | storeId | storefront slug | logo source |
|---|---|---|---|---|---|
| 64 | Nike Shirt | 19:44Z (test script) | 3 | yan | clientId=1 (test logo) — **stale, wrong logo for clientId=6** |
| 66 | OGIO Crunch Duffel 41L | **20:16Z (orchestrator path)** | 4 | yanfinancial | clientId=10 (genuine Yan logo) ✓ |
| 77 | Baseball Tee | 18:48Z (test script) | 3 | yan | clientId=1 (test logo) — stale |
| 124 | SnapBack Cap | (test script) | — | (catalog only) | clientId=1 |
| 670 | Knit Cuff Toque | (test script) | — | (catalog only) | clientId=1 |
| 2232 | Pro Team Jersey | 18:54Z (test script) | 3 | yan | clientId=1 (test logo) — stale |

The schema migration in priority #1 would obsolete this table since
each binding gets its own render anyway. Until then: pId=66 is the
only product in the database with a render produced through the
production code path.

### Documentation already on disk

- **`docs/migration-audit-followups.md`** — three new entries appended
  tonight:
  - "Render-side-effect hooks fire from tRPC mutations only" (LOW)
  - "Render output should be per-storeProduct, not per-product" (HIGH)
  - "Yan Financial test stores have data drift" (MEDIUM)
- **`docs/tier1-phase7-design-notes.md`** — Phase 7 manual override
  editor design (Notes 1-3 covering AI re-render fidelity, hybrid
  customer/distributor UX during overrides, and AI-suggested vs
  effective coordinate tracking). Read before designing the Phase 7
  override UI.
- **`docs/tier1-nano-banana-resume-prompt.md`** — earlier mid-Step-5
  resume prompt; superseded by this file.

### Verification tools

- `scripts/regression/diag-render-queue.ts` — DB status distribution
  + BullMQ queue counts.
- `scripts/regression/verify-0098-render-columns.ts` — schema check
  for migration 0098.

---

## What NOT to do in the next session without explicit approval

- Do not run `pm2 reload mergetasks` or `pm2 restart`. Production is
  serving correctly.
- Do not run `pnpm build` on its own. Build is only run as the last
  step before a planned reload.
- Do not run destructive git operations (`git reset --hard`,
  `git checkout -- .`). All Step 1-6 work is uncommitted on disk.
- Do not touch the production database via `mysql` CLI. Use Drizzle
  scripts only (per memory `feedback_db_verification.md`).
- Do not touch the proofing pipeline (`server/routers/proofing.ts`)
  — it's a separate decoupled pipeline.
