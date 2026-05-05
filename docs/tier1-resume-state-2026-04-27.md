# Tier 1 nano-banana sprint — completion state (2026-04-27)

End-of-sprint snapshot. The multi-day Tier 1 webstore photoreal-render sprint
landed Steps 1-8. This file documents the as-shipped state for future sessions
that need to pick up Phase 7 (manual override editor) or Tier 2 work.

---

## Sprint outcome

| Step | Status |
|---|---|
| 1. Schema + migration 0098 (render columns on `products`) | ✅ shipped |
| 2. nano-banana Gemini service wrapper | ✅ shipped |
| 3. BullMQ render queue + tiered backoff | ✅ shipped |
| 4. Render worker as separate pm2 app | ✅ shipped |
| 5. Phase 5 ingestion hooks (orchestrator + 4 tRPC callsites) | ✅ shipped |
| 6. WebstoreLogoOverlay reads photoreal | ✅ shipped |
| 6.5. Multi-tenant correctness — migrate render columns to storeProducts (0099) | ✅ shipped |
| 7. Per-binding regeneration backfill | ✅ shipped (5/5 storeProducts bindings rendered) |
| 8. Feature branch commit + CI | ⏳ in progress (this commit) |

Two architectural fixes also landed during sprint closure:

- **Phase J analyzer fix** — Stage 1 prompt restructured to 5 bullets, `STAGE_1_MAX_TOKENS` 1500→220, wall time ~18s → ~7s. Resolves a long-standing intermittent timeout.
- **Phase J auth fix (0100)** — Explicit `selfSignupMode` enum on stores. New stores default to `invite_only` instead of the implicit "open by default" fallback. Existing stores backfilled to preserve current behavior.

Plus three iterations on a customer-facing visual bug in `WebstoreLogoOverlay`
(documented as followup A in `migration-audit-followups.md`).

---

## Production state at sprint close

```
mergetasks                  PID 640045   restart 148   online (post-Phase-G v3 reload)
mergetasks-render-worker    PID 633554   restart 1     online (uptime ~110m, since Phase E)
```

8 main-app reloads + 1 worker restart over the multi-day sprint. Worker has
been stable since Phase E (Step 6.5 deploy at 01:05Z 2026-04-27).

DB state:
- 5 storeProducts bindings, all with `webstoreRenderStatus='complete'` and
  populated `webstoreRenderedImageUrl`.
- Yan stores (id=2,3,4) all on `selfSignupMode='open_signup'`.
- storeId=3 migrated from clientId=6 to clientId=10 (Yan logo) during Step 6.5.
- storeId=2 still on clientId=1 with the mislabeled Otentik test logo (followup K).

BullMQ queue: clean — `wait=0 active=0 failed=0`, completed retention warm.

---

## Schema migrations shipped

| Migration | What | Notes |
|---|---|---|
| 0098 | Add `webstoreRendered*` (5 cols) on `products` | Day-1 schema; superseded by 0099 |
| 0099 | Move 5 render cols from `products` → `storeProducts` | Per-binding multi-tenant fix. Drops + re-adds, no data preservation (regeneration backfill restores) |
| 0100 | Add `selfSignupMode` enum on `stores` | Default `invite_only`; existing stores backfilled |

All three have revert SQL in `drizzle/reverts/` (the lesson learned during
0099 apply — `migrate.sh` globs `drizzle/*.sql` non-recursively, so revert
files MUST live outside that directory or they'll auto-apply).

---

## Files shipped in this branch (functional, not exhaustive)

**Schema + migrations:**
- `drizzle/schema.ts` — storeProducts render cols + stores selfSignupMode
- `drizzle/0098_webstore_render_columns.sql`
- `drizzle/0099_webstore_render_per_binding.sql`
- `drizzle/0100_self_signup_mode.sql`
- `drizzle/reverts/0099_webstore_render_per_binding_revert.sql`
- `drizzle/reverts/0100_self_signup_mode_revert.sql`
- `drizzle/meta/_journal.json` (entries 97–99 added)

**Server services:**
- `server/services/nano-banana.ts` — Gemini render wrapper
- `server/services/webstore-render-orchestrator.ts` — Phase 5 hook helpers
- `server/services/webstore-imprint-placement.ts` — analyzer (Phase J prompt fix landed here)

**Server queue + worker:**
- `server/queue/webstore-render-queue.ts`
- `server/workers/webstore-render-worker.ts`
- `server/workers/webstore-render-worker-entry.ts`
- `start-render-worker.sh`
- `ecosystem.config.cjs` — added `mergetasks-render-worker` app
- `package.json` — build script chains second esbuild for worker

**Server routers (Phase 5 hook integration + 6.5 reads + 0100 predicate):**
- `server/routers/products.ts`
- `server/routers/storesCatalog.ts`
- `server/routers/storesCrud.ts`
- `server/routers/copilotExec/webstore.ts`
- `server/routers/storeAuth.ts` — `evaluateSelfSignupAllowed` exported

**Client (Step 6 wiring + Phase G three-iteration fix):**
- `client/src/pages/webstore/StoreContext.tsx`
- `client/src/pages/webstore/WebstoreLogoOverlay.tsx`
- `client/src/pages/webstore/{ProductCard,StoreTemplateClassic,StoreTemplateMinimal,StoreProductDetailPage}.tsx`

**Regression scripts:**
- `scripts/regression/diag-render-queue.ts` — DB status + BullMQ counts
- `scripts/regression/check-existing-renders.ts` — diagnostic for existing renders
- `scripts/regression/verify-0098-render-columns.ts` — historical (pre-0099)
- `scripts/regression/verify-0099-render-columns.ts` — post-migration verifier
- `scripts/regression/verify-0100-selfsignup-modes.ts` — predicate matrix + DB assertions

**Docs:**
- `docs/migration-audit-followups.md` — sprint followups appended (A–W)
- `docs/tier1-phase7-design-notes.md` — Phase 7 architecture notes
- `docs/tier1-resume-state-2026-04-26.md` — mid-sprint snapshot (historical)
- `docs/tier1-resume-state-2026-04-27.md` — this file

---

## What's NOT in scope for tomorrow's session

- **Phase 7 manual override editor.** Design captured in `tier1-phase7-design-notes.md`.
  Implementation: 1-2 weeks. Likely extends the existing `ImprintZoneEditor`.
- **Sharp preprocessing for analyzer.** Followup D in audit doc. LOW priority.
- **Visual regression tests.** Followup B. MEDIUM priority — would have caught
  the Phase G overlay incidents earlier.
- **Yan storeId=2 cleanup.** Followup K. MEDIUM priority — pre-launch hygiene.
- **Redis maxmemory-policy.** Followup S. HIGH priority infrastructure.
- **pm2-logrotate install.** Followup T. Cheap, do soon.

---

## Operational notes for the next session

- Production process holds the latest code (`index-BGmSoqbd.js` client bundle,
  build at 02:53Z 2026-04-27). No further reload needed unless code changes.
- Worker code is stable since 01:05Z 2026-04-27 (Phase E). All sprint follow-ons
  affected client + server-main only.
- The customer-visible state on yan.mergetasks.com / yanfinancial.mergetasks.com /
  yan-financial.mergetasks.com is the demo target — three storefronts, five
  rendered storeProducts bindings, multi-tenant correctness verified.
- DO NOT run `pnpm db:generate` against this branch. Project convention is
  hand-authored SQL + journal entries; `drizzle-kit generate` would produce
  spurious "missing diff" migrations (see `scripts/migrate.sh:7-11` docblock).
