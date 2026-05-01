# Migration audit follow-ups

Items found while auditing migration files but intentionally left out of
the immediate fix. Each entry: what the issue is, where it came from, why
it was deferred, and what an eventual follow-up should do.

---

## 0050 data-loss risk on non-empty tables

**Source:** `drizzle/0050_flashy_sersi.sql` lines 267 + 340 (post-fix).

The migration adds the new column with `ADD ppvProdId INT NOT NULL` and
later does `DROP COLUMN proposalProductId` — with **no copy step in
between**. On any environment with existing rows in
`proposalProductVariants`:

- `ppvProdId` would default to `0` for every existing row (the implicit
  default for a NOT NULL int column).
- The FK at line 321 (`FOREIGN KEY (ppvProdId) REFERENCES
  proposalProducts(id)`) would then refuse to apply against orphan refs
  to `proposalProducts.id = 0`.
- The original `proposalProductId` values would be lost when line 340
  drops the column.

Production dodged this entirely because `scripts/migrate.sh`'s first-run
seeding branch (lines 89–99) inserted 0050 into `_schema_migrations`
without executing the SQL — the pre-existing prod schema already had
the short-form column from a pre-tracker era. CI was unaffected because
the `proposalProductVariants` table on the fresh service-container DB
was empty.

**Follow-up:** future migrations that rename a NOT NULL column must
either:

1. Add the new column as nullable, copy data via
   `UPDATE table SET newCol = oldCol`, then `ALTER COLUMN newCol SET NOT
   NULL` before dropping the old column; or
2. Use `ALTER TABLE ... CHANGE COLUMN oldName newName` which preserves
   data and the NOT NULL constraint atomically.

Add a CI guard or a `db:check` script that flags any migration where
`ADD COLUMN ... NOT NULL` and `DROP COLUMN <other>` both touch the same
table without an intervening UPDATE.

---

## FK ON DELETE divergence — proposalProductVariants → proposalProducts

**Source:** `drizzle/0027_add_foreign_keys.sql:124` vs production state vs
post-fix `drizzle/0050_flashy_sersi.sql:321`.

Three different definitions of the same FK exist in the migration
history:

| Where | FK name | ON DELETE |
|---|---|---|
| `0027_add_foreign_keys.sql:124` | `fk_proposalProductVariants_ppId` | CASCADE |
| Production (today, verified via `information_schema.KEY_COLUMN_USAGE`) | `proposalProductVariants_ppvProdId_proposalProducts_id_fk` | NO ACTION |
| `0050_flashy_sersi.sql:321` (post-fix) | `proposalProductVariants_ppvProdId_proposalProducts_id_fk` | NO ACTION |

Prod and the fixed 0050 agree on `NO ACTION`. The 0027 `CASCADE` form
never made it to prod (prod is on the auto-generated Drizzle name, not
the manual `fk_*_ppId` form, suggesting prod was created by a
pre-0027 path entirely).

**Follow-up:** audit application code that deletes from
`proposalProducts` and confirm no caller assumes child rows in
`proposalProductVariants` will cascade-delete. If any caller does, add
an explicit cleanup of `proposalProductVariants` before deleting the
parent — relying on the DB to cascade is unsafe given the live
`NO ACTION` constraint. Likely callers to check:

- `server/routers/proposals.ts` — proposal deletion path
- Any `DELETE FROM proposalProducts` in cleanup scripts under
  `scripts/`
- Copilot exec routes that mutate proposal products

Same audit should also check the parallel children
(`proposalPriceTiers`, `proposalProductImages`, `proposalSizeCharts`)
which have similar FK histories.

---

## Snapshot files must track migration SQL edits

**Source:** `drizzle/meta/NNNN_snapshot.json` files paired with each
`drizzle/NNNN_*.sql` migration.

When a migration's SQL file is edited (rare — only allowed when no
environment has actually executed the broken statement, as with the
0050 fix) the matching `drizzle/meta/NNNN_snapshot.json` must be
updated in the **same commit** to keep Drizzle Kit's diff machinery
honest. Each snapshot is a frozen representation of the schema state
*after* its migration applies; a stale snapshot diverges from
`drizzle/schema.ts` and causes Drizzle Kit to emit a spurious
`CHANGE COLUMN` / `RENAME` migration on the next `pnpm db:generate`.

This is exactly the failure mode that `scripts/migrate.sh` warns
against in its docstring (lines 7–11) — the spurious-diff pathology
that produced the 0050 mess in the first place.

**Follow-up:** add a CI guard that fails when a `drizzle/NNNN_*.sql`
diff is committed without a matching `drizzle/meta/NNNN_snapshot.json`
diff in the same commit (and vice versa). A simple shell check in a
pre-commit hook or a workflow step would suffice.

---

## StoreProduct.material typed but never populated

**Source:** `client/src/pages/webstore/StoreContext.tsx:65` declares
`material: string | null` on the `StoreProduct` interface, but
`server/routers/storesCrud.ts:396` has the comment
`// material: not in products schema — omitted` and skips populating
it in the `getBySlug` mapper. The field is therefore always
`undefined` at runtime despite the type claiming otherwise.

`StoreProductDetailPage.tsx:404` reads `product.material` (under the
"Additional Info" tab fallback). Today that read silently produces
`undefined` and the JSX falls through to the generic "Contact your
distributor for additional information…" string — the bug is masked
by the existing fallback path.

Type lies about runtime behavior. Two ways to resolve:

1. Add a `material` column to the `products` schema in a new migration
   and populate it in the `getBySlug` mapper. Preserves the existing
   PDP read path.
2. Remove `material` from the `StoreProduct` interface and from
   `StoreProductDetailPage.tsx`'s read site. Eliminates the lie at
   the cost of dropping a field that may have been planned but never
   shipped.

Out of scope for Phase 6 (surfaced during the storefront API audit
that preceded the WebstoreLogoOverlay swap). Flagged for later
cleanup.

---

## Global TASK_ROUTES has a stale Sonnet model ID and a routing bug

**Source:** `server/_core/llmConfig.ts:200-201` (TASK_ROUTES) and
`server/_core/llm.ts:439-441` (invokeLLM provider dispatch).

Two compounding bugs were surfaced during Phase 6 verification when the
imprint-placement analyzer's vision calls returned 404 for every product:

1. **Stale model ID.** `TASK_ROUTES.reasoning` and `TASK_ROUTES.proposal`
   both point at `claude-sonnet-4-5`. The current Sonnet ID is
   `claude-sonnet-4-6`. `claude-sonnet-4-5` appears to be retired —
   Anthropic returns 404 / not-available when called directly with that
   ID. The analyzer's local `ANALYSIS_MODEL` constant was the same
   stale ID.

2. **Default-provider routing trap.** `invokeLLM` falls through to
   `loadLLMConfig()` when no `task:` parameter is passed, which honors
   `LLM_PROVIDER` (default: `openai`). Any call site that passes a
   Claude model ID via `model:` *without* a `task:` parameter ends up
   sending the Anthropic ID to the OpenAI adapter, which 404s. The
   Google fallback also rejects Claude IDs. Net: such call sites
   silently fail every call.

The Phase 6 analyzer was hit by both bugs (stale ID + missing `task:`).
Phase 6 unblocked itself with a surgical, localized fix: hardcode
`provider: "anthropic"` and `model: "claude-sonnet-4-6"` at the call
site via direct `invokeAnthropic()`, bypassing the broken global
routing entirely. See `server/services/webstore-imprint-placement.ts`
`ANALYSIS_PROVIDER` docblock.

**Follow-up:** the global path is still broken for any other caller
that combines a Claude model ID with no `task:`. Required before this
can close:

1. Update `TASK_ROUTES.reasoning` and `TASK_ROUTES.proposal` to
   `claude-sonnet-4-6`.
2. Validate proposal generation behavior is equivalent under 4.6 — at
   minimum, generate a proposal end-to-end and eyeball the output. The
   proposal flow has its own prompt-engineering assumptions that may or
   may not survive a model bump.
3. Audit all `invokeLLM` call sites for missing `task:` parameters.
   A grep for `invokeLLM(` that doesn't include `task:` should produce
   a small, finite list. Each such call is at risk of the
   default-provider routing trap.
4. Once the global path is verified, simplify
   `webstore-imprint-placement.ts` to call `invokeLLM({ task: "reasoning", ... })`
   instead of `invokeAnthropic` directly. The current direct call is
   correct but couples the service to provider-level wiring; the
   simplification is a quality-of-life cleanup, not a correctness fix.

**Not in scope for Phase 6.** Track and validate separately.

---

## Dev/prod environment separation needed

**Source:** discovered during Phase 6 visual verification on 2026-04-26.
The production EC2 instance (`app.mergetasks.com`) is also the
distributor/builder workstation. There is no separate dev or staging
environment. Port 3000 is held by the production node process; nginx
is fronting it at the apex domain plus a wildcard `*.mergetasks.com`
for tenant store subdomains. Running `pnpm dev` on the default port
would either collide with the production bind or — if the production
process were killed — silently take over customer-facing traffic with
hot-reloaded dev code.

**Follow-up:** provision a separate dev/staging EC2 (or container, or
Codespaces) before the next major feature push. Until then:

- Never run `pnpm dev` on the production box without explicit port
  isolation (e.g. `PORT=3100 pnpm dev` + SSH-tunnel access).
- Never run `pm2 restart` / equivalent on the production box during
  active development unless the working tree is committed and pushed
  and CI is green.
- Document the dev-vs-prod boundary in `CLAUDE.md` or an ops runbook
  so future sessions don't assume `pnpm dev` is safe.

---

## Working-tree-vs-running-process drift on prod EC2

**Source:** observed during Phase 6 regression on 2026-04-26. The
`pnpm build` step of the regression run wrote a fresh `dist/index.js`
to disk on the production EC2 box. The running production process
(PID at observation, started ~1 hour earlier) has not picked up the
new bundle. If `pm2 reload` (or any other restart trigger) fires
before the working tree is committed, **uncommitted Phase 6 changes
would ship to customers without going through CI or PR review.**

**Follow-up:**

1. Avoid running `pnpm build` on the production box unless we're
   deliberately deploying. Type-check (`pnpm check`) and tests
   (`pnpm test`) are sufficient for regression on a dev branch.
2. If a build IS necessary on the prod box (e.g., to verify the bundle
   compiles), output to a non-production directory or a temp path —
   don't overwrite the live `dist/`.
3. Add a CI guard or a pre-restart hook that checks
   `git status --porcelain` is empty (or matches a known revision)
   before allowing `pm2 reload` / equivalent.
4. Operationally — the right state for the prod box is "running
   committed code only." Anything else risks a stealth deploy on the
   next reload.

---

## Render-side-effect hooks fire from tRPC mutations only, not raw DB writes

**Priority:** LOW

**Source:** Tier 1 nano-banana Phase 5 hook integration on 2026-04-26.

The 5c `stores.logoUrl` bulk-pending-flip hook (and similar
render-orchestration hooks added in Step 5) fire from within tRPC
mutation handlers, not as database-level triggers. This means
application code paths correctly trigger render side effects, but
direct DB UPDATEs (admin tools, migration scripts, test scaffolding)
bypass the hooks entirely.

This is intentional architecture but worth documenting. To force
flag-pending behavior from a script: either invoke the tRPC mutation,
or perform the bulk pending-flip explicitly alongside the raw UPDATE.

---

## Render output should be per-storeProduct, not per-product (multi-tenant correctness)

**Priority:** HIGH

**Source:** Tier 1 nano-banana Step 6 storefront verification on 2026-04-26.

The current schema stores `webstoreRenderedImageUrl`,
`webstoreRenderStatus`, `webstoreRenderedAt` on the `products` table —
one render per product. This is single-tenant-correct only.

When a product is added to a second store whose client has a
different logo, the second add overwrites the first store's render
via the orchestrator's force re-render, and the first store silently
shows the second store's logo on the next page load. N=0 such
products today (verified 2026-04-26 evening), but this manifests the
moment two real distributors with different clients add the same
SanMar product.

**Required refactor:**

1. Move render columns from `products` to `storeProducts` (one render
   per store-product binding).
2. Key BullMQ jobId on `(storeId, productId)` rather than `productId`.
3. Worker writes results to `storeProducts.webstoreRendered*`.
4. `WebstoreLogoOverlay` reads from the joined `storeProducts` row
   instead of `products`. The Step 6 client wiring needs to pull
   `webstoreRenderedImageUrl` off the storeProducts join in
   `storesCrud.getBySlug`.

Estimate 3-5 hours. Schedule for next sprint immediately after
Phase 7 manual override editor (or in parallel — they touch
different layers).

---

## Yan Financial test stores have data drift across three slug variants and three clientIds

**Priority:** MEDIUM

**Source:** Tier 1 nano-banana Step 6 storefront verification on 2026-04-26.

Three Yan Financial test stores exist with overlapping but
inconsistent data:

- `storeId=2` (slug=`yan-financial`, clientId=1) — clientId=1 has the
  "Otentik test" logo on `clientLogos`.
- `storeId=3` (slug=`yan`, clientId=6) — clientId=6 has no logos at
  all.
- `storeId=4` (slug=`yanfinancial`, clientId=10) — clientId=10 has
  the actual Yan Financial logo.

The `storeId=3` case in particular is broken — products bound to it
cannot render via the orchestrator path (predicate fails on missing
logo) and have no CSS fallback either.

**Pre-launch cleanup:** consolidate to one canonical Yan Financial
test store with `clientId=10`'s logo configuration, delete the
others. Or, less aggressively: ensure `clientId=6` has a logo
configured so the storeId=3 storefront has *some* coverage during
demos.

Upgraded from LOW to MEDIUM: this drift directly impacted the Step 6
visual verification (Otentik logo appeared on a Yan storefront,
prompting a temporary multi-tenant correctness panic that turned out
to be data drift, not architecture).

---

## 5c logo-change hook should watch stores.clientId, not just stores.logoUrl

**Priority:** LOW

**Source:** Tier 1 nano-banana Step 6.5 multi-tenant correctness fix on
2026-04-27.

`server/routers/storesCrud.ts:737` fires `flagPendingForStoreLogoChange`
only when `setObj.logoUrl !== oldStore.logoUrl`. A change to
`stores.clientId` (which would also invalidate every render on that
store, since clientId resolves to a different logo through clientLogos)
does not trigger any hook.

Two reasons this is currently dormant rather than actively broken:

1. The store update mutation's input schema (storesCrud.ts:627-667)
   does not accept `clientId` at all — clientId is treated as immutable
   post-creation. There is no tRPC path through which a distributor
   could change it, so there is no place a hook could plug in.
2. Per the existing "hooks fire from tRPC mutations only, not raw DB
   writes" followup above, even the Yan cleanup `UPDATE stores SET
   clientId=10 WHERE id=3` performed manually on 2026-04-27 bypassed
   tRPC entirely. The Step 6.5 regeneration backfill was the explicit
   compensating action.

**Follow-up:** if a future product requirement adds a clientId-change
mutation (e.g., distributor reassigning a store to a different client),
the same hook coverage that watches `logoUrl` must extend to `clientId`.
At that point also revisit whether `flagPendingForStoreLogoChange`
should be renamed to `flagPendingForStoreBrandingChange` and whether it
should also fire on `clientLogos` row changes for the resolved client.

Not urgent. The 0099 multi-tenant fix's per-binding render columns mean
this hook only ever needs to scope to one store's bindings — it's no
longer a per-product fan-out concern.

---

## Vision analyzer Stage 1 times out at 15s on SanMar CDN images — needs investigation

**Priority:** MEDIUM (upgraded from yesterday's MEDIUM, now confirmed reproducible across two sessions)

**Source:** Tier 1 nano-banana Step 6.5 backfill on 2026-04-27 + Step 5 placement analysis on 2026-04-26.

The Anthropic vision call (Stage 1 of `analyzeProductImage` in
`server/services/webstore-imprint-placement.ts:139`) consistently times out
at the configured 15s `ANALYSIS_TIMEOUT_MS` when analyzing SanMar product
images served from `media.sanmarcanada.com`. Tested 2026-04-26 evening
(3 products, several timeouts) and 2026-04-27 (2 products, both timed out
at 15s on the first attempt). Bumping the timeout to 60s on a tmp script
during the 2026-04-27 backfill produced stage1 latencies of **17.8s and
18.4s** — both within the 60s window, both well above the 15s production
limit. Stage 2 latencies were 2-2.5s (Anthropic appears to cache the image
on its side after stage 1, so the second call is fast).

**Root cause hypotheses:**
1. Anthropic's server-side image fetch from `media.sanmarcanada.com` is
   slow — the API server has to download the source image before vision
   processing, and SanMar's CDN may rate-limit or be slow to first byte.
2. The 15s timeout is genuinely too tight for vision-with-external-URL
   operations, regardless of host.
3. SanMar product images may be larger or more complex than the median
   case, increasing vision processing time.

**Investigation paths:**
1. Raise `ANALYSIS_TIMEOUT_MS` to 60s and measure typical successful
   latency over a larger sample of products. If most calls finish in
   <20s, 60s is safe headroom.
2. Preprocess SanMar images via Sharp (resize / compress) before sending
   the image URL to the vision API. Smaller images mean faster
   server-side fetch and faster vision processing. Stand up a CDN
   resizer or pre-process at ingestion time.
3. Test the same products against a different image host (e.g. our own
   S3 bucket) to isolate whether the slowness is Anthropic-side or
   SanMar-CDN-side.

**Decision needed:** raise the timeout globally, implement preprocessing,
or both. Until decided, Step 5 placement analysis on freshly-ingested
SanMar products will fail intermittently and require a manual re-run
through a longer-timeout path. Phase 5 hook gating (`if status === "ok"`)
correctly suppresses spurious render jobs when this happens.

**Update 2026-04-27 (Phase H diagnostic):** root cause identified — token
generation, NOT image fetch or processing. 4-test isolation diagnostic:
SanMar URL with maxTokens=1500 took 19.2s; same URL with maxTokens=200
took 7.1s; preprocessed-base64 with maxTokens=1500 took 19.0s
(image format makes essentially no difference). Token rate is ~36
output tokens/sec for vision Sonnet, so generating 625 tokens of
5-paragraph analysis costs the full 17-18s. Fix landed: shortened
stage 1 prompt to 5 bullets (~150 token output cap), wall time drops
from ~18s to ~6.5s. See server/services/webstore-imprint-placement.ts
STAGE_1_MAX_TOKENS comment for the full justification trail.

This entry can be closed once the fix is merged. Sharp preprocessing
followup below remains open as defensive engineering.

---

## Defensive image preprocessing for analyzer Stage 1

**Priority:** LOW

**Source:** Tier 1 nano-banana Phase H diagnostic on 2026-04-27.

The Phase H diagnostic showed image preprocessing (Sharp resize to
1024px max + base64 encoding) provides essentially zero latency benefit
under the current token-bound regime — token generation dominates
wall-time, not image fetch or vision processing. Sharp preprocessing
was therefore deferred from the immediate fix.

That said, preprocessing remains useful as defensive engineering:
1. Bounds memory cost on Anthropic's side for occasional giant source
   images (some SanMar product photos exceed 4 MB / 4000px).
2. Reduces our network egress when we forward the image URL (Anthropic
   downloads the source from media.sanmarcanada.com on every call).
3. Eliminates dependence on the source CDN's availability — if SanMar
   has an outage, our analyzer still works against cached preprocessed
   copies.
4. Insulates against Anthropic's per-request image size caps (currently
   generous, but could change).

**Implementation sketch:**
- Fetch image bytes once at analysis time
- Sharp resize to fit 1024×1024 (preserve aspect, no enlargement)
- Encode as JPEG quality 85 base64
- Pass via Anthropic-native `{ type: "image", source: { type: "base64",
  media_type, data } }` shape — note this requires either an adapter
  enhancement to detect `data:` URLs or a direct-fetch path, since the
  current adapter (server/_core/anthropicAdapter.ts:148-153) only maps
  `image_url` → `source: { type: "url" }`

Implement when convenient. No urgency until a giant-image incident
forces the issue.

---

## Tier 1 nano-banana sprint — closure followups (2026-04-27)

The block below is the consolidated set of followup entries from the multi-day
Tier 1 sprint that landed Steps 1-8: per-binding render schema (0099), short-form
analyzer (Phase J), self-signup modes (0100), and the WebstoreLogoOverlay
three-iteration ghosting fix. Some entries are RESOLVED-on-arrival historical
records; others are open tasks.

### A. WebstoreLogoOverlay three-bug compounding incident (RESOLVED)

**Priority:** HIGH (resolved); HISTORICAL RECORD going forward.

The customer-facing photoreal overlay has three independent layers — base
SanMar image (Layer A), CSS-composite logo (Layer B), photoreal render (Layer
C). Three bugs surfaced sequentially during 2026-04-27 visual verification:

1. Layer B continued rendering under Layer C, bleeding through anti-aliased
   alpha edges of the photoreal. Fix: gate Layer B on `showCssLogo = showLogo &&
   !showPhotoreal`.
2. Layer A continued rendering at full opacity under Layer C, bleeding through
   aspect-ratio letterbox bands when the photoreal's aspect (e.g. 864×1231 for
   pId=64) differed from the source's (~0.88 for SanMar product photos). Fix:
   `style={{ opacity: showPhotoreal ? 0 : 1 }}` with `transition-opacity` on
   Layer A. `visibility:hidden` and `display:none` were considered; opacity
   chosen to preserve smooth crossfade and keep Layer A as the layout source-
   of-truth (the inner relative box's bounds = Layer A's bounds, so removing
   it from flow collapses the box).
3. Cached photoreal images (after a PDP visit) re-rendered into the listing
   card don't fire React's `onLoad` — the browser considers them already-loaded
   synchronously before React attaches the listener. Fix: `useRef` on the
   photoreal `<img>`, `useEffect` checks `node.complete && node.naturalWidth >
   0` after mount and on every `renderedImageUrl` change, manually flips
   `photorealLoaded=true` for cache hits.

All three resolved 2026-04-27. Future visual rendering changes to
`WebstoreLogoOverlay.tsx` must preserve all three patterns.

### B. Visual regression tests for storefront photoreal renders

**Priority:** MEDIUM.

The three-iteration overlay incident would have been caught by a screenshot-
based regression test. Each fix attempt was a blind round-trip to the user.
Recommend Percy, Chromatic, or Playwright with screenshot comparison. Cover at
minimum: storefront product card (listing context), product detail page
(PDP context), Branded/Blank toggle states, and the cache-hit scenario (visit
PDP, navigate back to listing — the canary the human had to reproduce by hand).

### C. Vision analyzer Stage 1 timeout (RESOLVED)

**Priority:** HIGH (resolved); HISTORICAL RECORD.

Stage 1 of `analyzeProductImage` consistently timed out at the configured 15s
on SanMar CDN images. Phase H diagnostic 2026-04-27 isolated the cause: token
generation, NOT image fetch or processing. Token rate is ~36 output tokens/sec
for vision Sonnet, so the prior 5-paragraph prompt (~625 tokens out) drove
wall time to ~18-20s. Phase J fix shortened the prompt to a 5-bullet form
(≤25 words each) and reduced `STAGE_1_MAX_TOKENS` from 1500 → 220. Wall time
now ~6.5-9s with ~50% headroom under the unchanged 15s timeout. Quality
verified equivalent on apparel products (left_chest / full_front placements
chosen correctly, confidences 0.88-0.92). See
`server/services/webstore-imprint-placement.ts` STAGE_1_MAX_TOKENS comment.

### D. Defensive image preprocessing for analyzer Stage 1

**Priority:** LOW.

Phase H diagnostic showed Sharp resize-to-1024 + base64 encoding provides
essentially zero latency benefit under the current token-bound regime (URL
vs base64 measured 19.0s vs 19.2s at maxTokens=1500). Deferred from the
immediate fix. Still useful as defensive engineering — bounds memory cost on
Anthropic's side for occasional giant source images, reduces network egress,
insulates against source-CDN outages. Implement when convenient; no urgency
until a giant-image incident forces it.

### E. Migration revert SQL placement convention

**Priority:** MEDIUM.

`scripts/migrate.sh` globs `drizzle/*.sql` non-recursively. If a revert SQL
file is placed in the same directory as the forward migration, both apply
alphabetically and the revert runs immediately after the forward, leaving the
schema in pre-migration state. Discovered 2026-04-27 during 0099 apply
(recovered cleanly). Convention: place revert files in `drizzle/reverts/` from
creation. Consider adding a guard in `scripts/migrate.sh` that errors if any
`*.sql` in `drizzle/` contains `revert` in its filename.

### F. Storefront default-open self-signup (RESOLVED)

**Priority:** MEDIUM (resolved); HISTORICAL RECORD.

Pre-0100, a store with `requireAuth=1` but no `storeAllowedDomains` rows and
no `allowedEmailsJson` would silently accept any email for self-signup
(`storeAuth.ts:130-132` fallback "No domain restrictions — allow all").
Resolved by 0100 `selfSignupMode` enum: NEW stores default to `'invite_only'`;
existing stores backfilled to preserve behavior (`'invite_only'` if they had
allowedEmailsJson, `'domain_whitelist'` if they had domain rows, `'open_signup'`
otherwise). The `evaluateSelfSignupAllowed` predicate in `storeAuth.ts` enforces
the four modes uniformly.

### G. 5c hook should watch stores.clientId in addition to logoUrl (RESOLVED)

**Priority:** LOW (resolved 2026-04-27 as Phase 8 Item 3); HISTORICAL RECORD.

`flagPendingForStoreLogoChange` fires from the storesCrud update mutation only
when `setObj.logoUrl !== oldStore.logoUrl`. A change to `stores.clientId`
(which would also invalidate every render on that store, since clientId
resolves to a different logo through clientLogos) triggers no hook.

Phase 8 Item 3 audit (2026-04-27) confirmed the gap is **dormant** — no
application-layer path mutates `stores.clientId` today:

| Update site | Fields set | Touches clientId? |
|---|---|---|
| `storesCrud.ts:731` (update mutation) | from zod input 631-672 | NO — clientId not in schema |
| `storesAi.ts:187, 298, 321` | aiTagline / aiDescription / aiProduct* / status | NO |
| `storesApproval.ts:64, 182` | approval-workflow fields | NO |
| `storesCatalog.ts:92` | bannerUrl | NO |
| `routes/storeApproval.ts:104, 179` | approval fields, status | NO |
| `copilotExec/webstore.ts:219` | aiDescription, aiTagline, welcomeMessage, aiOptimizedAt | NO |
| `copilotExecStores.ts:30` (Copilot updateStore) | name, welcomeMessage, primaryColor, status (explicit allowlist) | NO |

The only clientId-change paths today are raw SQL / migration scripts — those
bypass all application-layer hooks per Followup W and are explicitly out of
scope.

Resolution: rather than adding a hook for a non-existent mutation (which
would be unreachable dead code), Phase 8 Item 3 added two protective
measures:

1. **Regression test** at `server/storesCrud.clientIdImmutability.test.ts`
   (4 assertions). The load-bearing assertion inspects
   `stores.update._def.inputs[0].shape` and fails if `"clientId"` becomes
   a key. Defense-in-depth assertion verifies that even if a caller
   smuggles clientId via `as any`, zod strips it at parse time.

2. **FUTURE-EXTENSION comment** above `flagPendingForStoreLogoChange` in
   `server/services/webstore-render-orchestrator.ts`. Points the future
   developer at the call site to extend (storesCrud.ts:743) and at the
   regression test that will fire when the dormant condition becomes
   live.

The future-extension trigger is intentional: when a clientId-mutable path
is added (whether to the storesCrud zod schema, the copilotExec args type,
or any new mutation), the regression test will fail. The developer sees
the FUTURE-EXTENSION comment, extends the hook predicate to also fire on
clientId changes, and updates the test to reflect the new (now correct)
state — all in the same PR.

`copilotExecStores.executeUpdateStore` was deliberately not covered by a
runtime test — it's TS-typed (no zod), and the runtime protection is the
explicit if-list at lines 23-26. A future addition there would be
visible at the lines being modified, and the FUTURE-EXTENSION comment
plus this entry document the requirement. Trade-off accepted: the test
catches the most likely path (zod schema growth) without false-positive
maintenance burden on the Copilot args type.

### H. New-storeUser approval/audit surface for distributors

**Priority:** LOW.

Auto-created storeUsers under `open_signup` or `domain_whitelist` modes land
in the table with `role=employee` silently. Distributors don't get an alert
or pending-approval queue. Recommend an optional pending-approval workflow,
or at minimum an email digest of new self-signups per store.

### I. INVARIANT — Storefront cookies scoped per-slug

**Tested invariant.** `STORE_COOKIE_PREFIX + store.slug` produces unique
cookie names per slug. Cookies have no `domain` attribute set, so they default
to host-only. A session at `yan.mergetasks.com` does not propagate to
`yanfinancial.mergetasks.com`. Verified 2026-04-27 during Step 6.5 visual
verification. Future changes to `STORE_COOKIE_PREFIX` or cookie domain config
must preserve this invariant.

### J. INVARIANT — CSRF middleware enforced on /api/trpc/*

**Tested invariant.** `app.use("/api", csrfProtection)` (server/_core/index.ts:228)
enforces double-submit cookie on all mutating /api/* requests. A raw POST to
/api/trpc/storeAuth.requestLogin without `x-csrf-token` returns 403 with reason
"CSRF token missing". Verified 2026-04-27 during the 0100 auth-fix smoke test.
Future middleware reorderings, /api mount changes, or tRPC remounts must preserve
this enforcement on mutations.

### K. Yan Financial test stores have data drift (RESOLVED — superseded by full test data wipe)

**Priority:** MEDIUM (resolved 2026-04-27); HISTORICAL RECORD.

Three Yan Financial test stores existed with different slugs and varying
client/org assignment. The original followup framing was "consolidate to
one canonical Yan Financial test store, OR delete storeId=2." Operator
clarification during Phase 8 audit expanded the scope: ALL existing
stores, clients, clientLogos, storeUsers, storeProducts, proposals,
invoices, estimates, virtualProofs, audit_log entries, and 7 of 8 user
accounts were treated as test data with zero preservation value. Only
preserved: user 1 (info@otentikbrand.com), org 23 (Otentik Brand), the
13,858-row SanMar product catalog (operator's personal API credentials),
the SanMar supplier record, and product-collection cascade chains.

Cleanup landed via `scripts/cleanup/wipe-test-data-2026-04-27.ts` —
single transactional script with PRE/POST snapshots, worker-idle
gating, and 12-assertion preserved-state verification. RDS snapshot
taken pre-execute as rollback safety net (not needed; transaction
committed on the first clean attempt after three audit-driven
rejections).

Verified post-cleanup:
- All 12 preserved-state assertions passed (products=13858, users=1,
  organizations=1 with id=23 ownerId=1, all test tables=0)
- Operator login via info@otentikbrand.com works; dashboard loads
- yanfinancial.mergetasks.com returns "store not found" (graceful
  unknown-slug handling — no UX hygiene followup needed)
- Production processes untouched (main 646640/149, worker 651726/5)
- GET /health returns 200 with all checks green

Three durable institutional-knowledge tools landed alongside, kept in
the repo for any future destructive operation:
- `scripts/cleanup/transitive-closure-audit.ts` — walks the FK
  dependency graph from a set of delete-roots, emits depth-ordered
  cleanup list with row counts, identifies gaps and CASCADE chains
- `scripts/regression/cleanup-fk-children-audit.ts` — surfaces every
  FK that references a given parent table
- `scripts/regression/cleanup-column-existence-probe.ts` — empirical
  validation of every (table, column) reference in a destructive
  script against information_schema.COLUMNS

The script attempt history is operationally instructive — three
rollbacks, three audit-gap classes surfaced in turn:
1. **Iter 1**: FK chain depth not walked recursively in initial Phase 2
   audit — proposalVersions (14 rows referencing proposals) blocked
   Step 2.1 (DELETE FROM proposals). Fixed by adding the missing
   children + reordering steps.
2. **Iter 2**: UPDATE SET column-name typo (`nextValue` vs schema's
   `nextNumber`) — dry-run mode validates row counts and WHERE clause
   columns but NOT SET column names because dry-run only does
   SELECT COUNT. Fixed by inline rename + `cleanup-column-existence-probe.ts`
   for future operations.
3. **Iter 3**: Phase 2 audit listed users.id NO ACTION children but
   didn't probe row counts on production-data tables (aiAuditLog,
   copilot_conversations, notifications, etc. — assumed empty,
   actually 156+28+18+ rows). Fixed by adding 6 explicit DELETE
   statements + `transitive-closure-audit.ts` for systematic future
   coverage.

Each rollback was atomic via Drizzle's `tx.transaction()` contract.
Zero data lost across all attempts. The three-iteration cycle is
documented here as a real cost of incomplete pre-flight auditing.

See followups K-1 and K-3 below for two narrow open items surfaced
during the audit but deliberately deferred from the cleanup itself.

### K-1. Backfill organizationId on operator's NULL-org product

**Priority:** LOW (post-cleanup hygiene).

After the K cleanup, `products` has 13,858 rows owned by user 1. Two
of those rows have `organizationId IS NULL` (one was Yan's pre-org
historical product; the other came from the user-5 reassignment in
Step 7 of the cleanup script). For consistency with the org-scoped
products query path (`scope.products = eq(products.organizationId, ctxOrgId)`
when org is set), backfill these to organizationId=23.

One-line SQL fix:
```sql
UPDATE products SET organizationId = 23
  WHERE userId = 1 AND organizationId IS NULL;
```

Currently dormant (no leak — userId-fallback scope still finds them
for user 1, no other tenant matches them). Worth doing pre-launch so
the org-scope path returns the full catalog deterministically.

### K-3. Review proposalsCrud.ts:76 unscoped products query

**Priority:** MEDIUM (post-cleanup hygiene).

`server/routers/proposalsCrud.ts:76` loads products by ID without
applying `scope.products`:
```ts
db.select().from(products).where(inArray(products.id, allProductIds))
```

Practical leak risk is low because the `allProductIds` array comes
from already-scoped proposals (line 75 applies scope to the proposals
read), so a caller can only smuggle product IDs they're already
authorized to see via their proposals. Worth a code review + adding
`and(inArray(products.id, allProductIds), scope.products)` for
defense in depth — same pattern as line 126 of the same file.

Not urgent. File for a future PR that does a broader scope-coverage
audit of the proposals/orders/invoices read paths.

### K-2. Mock product/store data removal (RESOLVED 2026-04-28)

**Priority:** MEDIUM (resolved 2026-04-28); HISTORICAL RECORD.

Followup K's Domain 4 audit surfaced production-reachable mock product
and store data scattered across 9 locations. Operator directive: the
`products` table is the only sanctioned source of product data. K-2
swept all 9 locations.

**Removed (data + carriers):**
1. `client/src/pages/StoreManagement/StoreManagementTypes.ts` — deleted
   `mockProducts` (10 items: Nike Polo, YETI, Moleskine, …), `storesData`
   (11 stores: 4imprint, HALO, Cintas, Geiger, popups), and
   `monthlyRevenue` (6 chart points). File now exports types only.
2. `client/src/pages/StoreManagement.tsx` — removed slug-based
   `storesData[storeId]` lookup; numeric routes derive `effectiveStore`
   from `dbStore` directly; non-numeric/unknown routes hit the existing
   "Store not found" branch. The `mockProducts` fallback in
   `effectiveProducts` is now `[]`; the products tab renders an empty
   state with a "Add your first product" CTA when the list is empty.
3. `server/routers/products.ts` — removed `seedCatalog` tRPC procedure
   (~70 lines, ~30 hardcoded promotional + print product seed rows).
   Catalog is populated only via real `products.create` /
   `products.bulkCreate` flows from here on.
4. `client/src/pages/Curation.tsx` — removed orphan
   `seedCatalog.useMutation()` declaration and dead `seedAttempted`
   state.
5. `client/src/pages/webstore/WebstorePopup.tsx` — **deleted entirely**
   (208-line page, fully mock-driven `POPUP_CAMPAIGNS` with Unsplash
   image URLs). `App.tsx:162` route `/store/popup/:slug` removed
   alongside the import. No in-app navigation pointed at it; reachable
   only by direct URL. Re-introducing pop-up campaigns later requires a
   real `popup_campaigns` table and admin UI.
6. `client/src/pages/webstore/WebstorePortal/PortalProposalDetail.tsx`
   — emptied `DEFAULT_PRODUCTS` and `ADDABLE_CATALOG` arrays. The
   proposal detail now renders an explicit empty-state ("No items on
   this proposal yet — distributor needs to add items via the editor")
   and the "Add Product" control shows in a disabled "Add product
   (coming soon)" state. Real-data wiring deferred to followup K-4
   (below) — operator rejected continuing to surface fake products
   (Moleskine / Patagonia / AirTag) to portal customers.
7. `server/seed.mjs` — file deleted. Not referenced from `package.json`
   scripts; the active seed entry point is `scripts/seed.ts`.

**Tests deleted:**
- `server/clients-stores.test.ts` "products seedCatalog" describe
  block (3 tests: count, idempotency, list-returns-seeded). Tied
  exclusively to the removed procedure.

**Test fixtures deliberately preserved:**
- `server/proposalEditorIntegration.test.ts:606` — `Nike Polo`
  fixture is acceptable test-only data and not production-reachable.

**Out of K-2's explicit scope (surfaced for future cleanup):**
- `client/src/pages/StoreManagement/OverviewTab.tsx` — KPI cards still
  carry hardcoded `spark` arrays and trend percentage strings (e.g.
  `+14%`, `[62, 68, 74, …]`) inline. The Revenue Trend chart was
  replaced with an empty-state, but the KPI sparklines remain. They
  were not in operator's explicit list and would require restructuring
  the KPI shape to derive from real order/revenue aggregates. File
  this as a future cleanup task.

**Verification:** `pnpm check` clean (typecheck), `pnpm test` 836
passing / 92 skipped / 0 failures, no client console errors expected
on the smoke paths (numeric store with products, numeric store with
zero products, slug-or-unknown route, Curation page, portal proposal
with no items).

### K-4. Wire real data into PortalProposalDetail

**Priority:** MEDIUM (open — followup to K-2).

Estimated effort: 2–4 hours.

K-2 emptied the hardcoded `DEFAULT_PRODUCTS` and `ADDABLE_CATALOG`
arrays in
`client/src/pages/webstore/WebstorePortal/PortalProposalDetail.tsx`
to stop the portal from surfacing fake Moleskine / Patagonia / AirTag
items to client viewers. The component now renders an empty-state
and a disabled "Add product (coming soon)" control. Real data wiring
was deferred to keep K-2 in scope.

**Required work:**
- Replace `DEFAULT_PRODUCTS` initialization with line items loaded
  from the proposal record. Likely path:
  `trpc.storePortal.proposals.getById` (extend if needed) returning
  `{ ..., lineItems: ProductRow[] }`. Map server-side row fields
  (sku, qty, unitPrice, decoration) into the `ProductRow` shape the
  component already uses.
- Replace `ADDABLE_CATALOG` with `trpc.products.list` filtered to the
  store's catalog (likely `storeProducts` join, scoped via `scope.products`
  on the server). Re-enable the "Add Product" button when results are
  non-empty; remove the "(coming soon)" label.
- Update `handleSubmitEdits` (currently diffs against `DEFAULT_PRODUCTS`
  by index — the +1/-1 quantity logic in lines 153–162 will need to
  diff against the real `lineItems` source instead).
- Rewire the cancel-edit reset (line 533) to fall back to the real
  `lineItems` snapshot rather than the empty array.
- Manual smoke: create a test proposal with 2–3 items, view via
  portal, verify items render; enter edit mode, change quantities,
  add a new product, submit, verify backend reflects the changes.

No deadline. File when capacity allows. The current empty-state /
disabled UI is acceptable indefinitely — better than the prior
misleading mock data — so this is a quality-of-portal improvement,
not a regression fix.

### K-5. Replace OverviewTab KPI sparklines + trend percentages with real aggregates

**Priority:** MEDIUM (open — followup to K-2).

Estimated effort: 1–2 hours.

K-2 removed the `monthlyRevenue` chart fixture from
`client/src/pages/StoreManagement/OverviewTab.tsx` (replaced with an
empty-state pending real revenue aggregates). The four KPI cards on
the same tab still carry hardcoded `spark` arrays and trend percentage
strings inline — e.g.:

```ts
{ label: "Monthly GMV", ..., trend: "+14%", up: true, spark: [62, 68, 74, 71, 78, 84] },
{ label: "Monthly Orders", ..., trend: "+8%", up: true, spark: [280, 295, 310, 305, 325, 342] },
{ label: "Avg Order Value", ..., trend: "+2.3%", up: true, spark: [248, 252, 255, 258, 260, 261] },
{ label: "Conversion Rate", ..., trend: "-0.4%", up: false, spark: [15.2, 14.8, 14.6, 14.4, 14.3, 14.2] },
```

These were left in place during K-2 because they were not in the
operator's explicit scope list and folding them in would have required
restructuring the KPI shape mid-PR. The displayed sparkline shapes and
month-over-month trend percentages are decorative right now and do not
reflect the store's actual data.

**Required work:**
- Add backend tRPC aggregate procedures (likely on `stores` or a new
  `storeAnalytics` router): per-store, last-6-months series for GMV,
  order count, average order value, conversion rate; plus
  current-vs-previous trend deltas for each.
- Replace the inline `spark` and `trend` literals with values from
  the new query. Handle the empty-history case the same way the
  Revenue Trend chart now does (small empty-state, no fake numbers).
- Manual smoke: load a store with order history → real shapes; load
  a brand-new store → empty-state on the sparklines too.

Same out-of-scope reasoning as K-4 — significant work, separate review
concern, and no urgency: the empty-state on the chart already telegraphs
to operators that this view is data-derived, while the surrounding
hardcoded sparklines decay-towards-irrelevance gracefully (real numbers
just replace decorative ones).

### L. REFERENCE — Storefront auth model

Captured for future SSO-design reference (Phase 7+). The storefront uses
passwordless OTP via `storeAuth.requestLogin` → `verifyCode`. Self-signup is
gated by `selfSignupMode` ∈ {`closed`, `invite_only`, `domain_whitelist`,
`open_signup`}; default for NEW stores is `invite_only`. Auto-created users
get `role: "employee"` (lowest privilege). Active JWT sessions are not
invalidated by mode flips — `closed` blocks new authentications only. Cookies
are per-slug, host-only. CSRF double-submit enforced on /api/trpc/*. Roles:
`poc | admin | manager | employee | intern`. SSO integration (storeSso.ts)
exists for SAML + OIDC but is not the primary path; OTP is.

### M. Per-binding render storage (RESOLVED)

**Priority:** HIGH (resolved); HISTORICAL RECORD.

Render columns (`webstoreRenderedImageUrl`, `webstoreRenderedAt`,
`webstoreRenderDecoration`, `webstoreRenderStatus`, `webstoreRenderModel`)
moved from `products` to `storeProducts` in 0099. Multi-tenant correctness
verified in production via Yan storefronts: pId=64 on storeId=3 (clientId=10)
renders with the Yan Financial logo independently of the same product on any
other store. BullMQ `jobId` keying changed from `product-{id}` to
`storeproduct-{storeId}-{productId}`. Worker writes results keyed on
`(storeId, productId)`. `getBySlug` projects from the joined storeProducts
row, not the products row.

### N. Phase 7 distributor manual override editor

**Priority:** HIGH.

Design notes captured in `docs/tier1-phase7-design-notes.md`. Implementation:
1-2 weeks focused work. Drag-to-reposition, corner-handle resize, decoration
method dropdown, color picker, "Re-run AI" button, "Revert to AI" button,
hybrid customer-continuity / distributor-explicit-publish workflow. Apple
Enterprise Grade UI/UX standard. Track AI-suggested vs effective coordinates
separately so "revert to AI" is one-click. Likely extends the existing
`ImprintZoneEditor` distributor component rather than building from scratch.

### O. Decoration matrix incomplete

**Priority:** LOW.

`laser_engraving` and `deboss` decoration methods exist in the
`DecorationMethod` union and resolver (`webstore-render-orchestrator.ts:36-39`),
but have not been validated end-to-end on real products. Other six methods
(embroidery, screen_print, dtg, sublimation, heat_transfer, patch) verified
during the multi-day sprint.

### P. Cap-front embroidery oversizes consistently

**Priority:** MEDIUM.

nano-banana model bias documented during decoration matrix testing 2026-04-26:
embroidery on cap-front placements is rendered at noticeably larger scale than
the input coordinates request. Investigate whether prompt engineering (explicit
size constraints in the render prompt) or post-processing (scale-correction
on cap categories) can correct.

### Q. Worker unhandledRejection handling

**Priority:** LOW.

Current worker behavior is log-and-continue on errors. Consider whether process
crash + pm2 restart is more honest than swallowing errors — pm2's restart
counter and notification surface would catch incidents that log-only currently
hide.

### R. Worker render-status reconciliation for orphan 'rendering' rows (RESOLVED)

**Priority:** MEDIUM (resolved 2026-04-27); HISTORICAL RECORD.

If the worker dies mid-render, the storeProducts row stayed at
`webstoreRenderStatus='rendering'` indefinitely. Resolved 2026-04-27 with
a single-worker, boot-time, flip-all reconciliation: on worker boot,
`reconcileOrphanRenderingRows` (in `server/services/webstore-render-orchestrator.ts`)
flips every `storeProducts.webstoreRenderStatus='rendering'` row to
`'failed'`. The original "older than N minutes" gate from the design sketch
was dropped — the single-worker invariant means any rendering row at boot
is by definition orphaned, and a time gate would only delay recovery.

The helper performs a single-column UPDATE: `webstoreRenderedImageUrl`,
`webstoreRenderedAt`, `webstoreRenderDecoration`, and `webstoreRenderModel`
are intentionally preserved so a prior render remains a valid
customer-facing fallback while the next render is queued. Wired into
`bootstrap()` in `server/workers/webstore-render-worker-entry.ts` between
`assertEvictionPolicy` (Followup S) and `createWebstoreRenderWorker`, with
warn-and-continue on any throw so historical-cleanup failure does not
block processing of new jobs. The helper itself is NOT fire-and-forget
(unlike sibling orchestrator helpers): it propagates DB errors to the
caller so the bootstrap layer owns policy.

Verified live in production:
- Worker PID 646493 → 651338 (clean-state boot): INFO log confirmed
  `reconcileOrphanRenderingRows: no orphan 'rendering' rows found`.
- Worker PID 651338 → 651726 (orphan-state boot, after manual flip of
  storeProducts.id=2 to `'rendering'`): WARN log confirmed
  `reconcileOrphanRenderingRows: flipped 1 orphan rendering row(s) →
  failed (likely worker death during prior render)`.
- Post-reconciliation row state: `webstoreRenderStatus='failed'`,
  `webstoreRenderedImageUrl` / `_At` / `_Decoration` / `_Model` all
  preserved byte-identical to pre-orphan snapshot — single-column update
  contract verified.
- Test coverage: 4 unit tests in
  `server/services/webstore-render-orchestrator.test.ts` cover no-orphans
  INFO path, 3-orphans WARN path, predicate scoping to
  `webstoreRenderStatus='rendering'`, and DB-error propagation.

**Operational note for future verification:** `logger.warn()` routes to
stderr via `console.warn`, so `pm2 logs --out` will not show WARN lines.
Verification protocols for log-asserting changes must check both `--out`
and `--err` streams. Discovered 2026-04-27 during R Phase 6 — the WARN
line was initially "missing" before checking the error log.

Pairs with Q — together they make worker incidents observable and
recoverable without manual DB intervention. Q remains open.

### S. Redis maxmemory-policy = volatile-lru, BullMQ requires noeviction (RESOLVED)

**Priority:** HIGH (resolved 2026-04-27); HISTORICAL RECORD.

The production Redis is AWS ElastiCache (single-node, standalone, Redis 7.1.0)
at `master.mergetasks-redis-prod.1nj6ek.use1.cache.amazonaws.com:6379` over TLS,
not the local `127.0.0.1:6379` instance also present on the EC2 box (which is
unused — DBSIZE=0). The cluster was attached to `default.redis7`, which is
read-only in ElastiCache; the fix required creating a custom parameter group
`mergetasks-redis-prod-noeviction` (family redis7) with `maxmemory-policy=noeviction`,
then reassigning the cluster to it. The change is non-disruptive — applied
without failover or reboot, eventually consistent across the parameter group
within ~1 minute.

Verification post-change: `INFO memory` returns `maxmemory_policy:noeviction`
on the live node, and the BullMQ worker boot no longer emits the
"IMPORTANT! Eviction policy is volatile-lru" warning to stderr.

Defensive followup landed alongside: `server/queue/assertEvictionPolicy.ts`
reads `INFO memory` at boot (CONFIG GET is disabled by ElastiCache) and asserts
the policy. Worker entry treats failure as fatal (process.exit(1) → pm2
restart counter); main app warn-logs only. Future parameter-group drift
surfaces at the next reload rather than at the next memory-pressure incident.

### T. pm2 log rotation

**Priority:** MEDIUM.

`pm2-logrotate` not installed on the production EC2 box. `~/.pm2/logs/*.log`
will grow unbounded. Install via `pm2 install pm2-logrotate` and configure
size/retention. Cheap, addresses a known EBS-fill failure mode.

### U. Production process restart counter

**Priority:** MEDIUM.

`pm2 list` shows restart count = 148 on `mergetasks` after this sprint. Eight
of those came from the multi-day sprint's planned reloads. Assuming a baseline
of ~140 prior to the sprint, that's a high count for normal operation —
investigate whether crashes / unhandled exceptions / OOM events have
contributed. Sentry log review + `pm2 logs --err --lines 1000` analysis
recommended.

### V. Migration-apply-vs-code-reload window

**Priority:** LOW.

Between "migration applied" and "pm2 reload picks up new code bundle", the
running production process holds a stale schema bundle that may reference
columns that no longer exist (e.g. 0099 dropped `products.webstoreRendered*`
while the running code still tried to SELECT them). Mitigated tonight via
tight build-and-reload sequencing. Future improvement: blue-green deploys
where new code is deployed first behind feature flags, then schema changes
apply, then flags flip — eliminates the window entirely.

### W. Render-side-effect hooks fire from tRPC mutations only

**Priority:** LOW.

The Phase 5 hooks (orchestrator's `enqueueRenderForStoreProduct`,
`fanOutRenderForProduct`, `flagPendingForStoreLogoChange`) fire from within
tRPC mutation handlers, not as database-level triggers. Direct DB UPDATEs
(admin tools, migration scripts, raw SQL) bypass the hooks entirely. This is
intentional architecture but worth documenting. To force flag-pending behavior
from a script: either invoke the tRPC mutation, or perform the UPDATE
explicitly alongside the raw write.

### X. Stale .bak / editor-backup file purge from EC2 working copy (RESOLVED)

**Priority:** LOW (resolved 2026-04-28); HISTORICAL RECORD.

Resolves the security-audit-full.md Low-severity finding on stale `.bak`
files in the working copy. A repo scan on 2026-04-28 turned up 12 stale
local files totaling ~190KB:

- 11 `.bak` files — old code copies left over from prior edit sessions:
  - `server/_core/llm.ts.bak`, `llmConfig.ts.bak`, `vite.ts.bak`
  - `server/routers/copilot.ts.bak`, `copilot.ts.fix-all.bak`
  - `client/src/components/curation/CurationImportModal.tsx.fix-products.bak`
  - `client/src/components/curation/CurationProductsTab.tsx.bak` (+ `.fix-all`, `.fix-products`, `.product-detail` variants)
  - `client/src/pages/ProductDetail.tsx.bak`
- 1 `.env~` editor backup in repo root (54 bytes; see Followup Y)

All 12 were already covered by `.gitignore` patterns (`*.bak` line 58,
`*~` line 33) and were never tracked in git — `git ls-files` matched
none of them. The cleanup was therefore purely local-disk hygiene on
EC2: deleted with `rm`, no code change, no commit diff for the files
themselves. This doc entry is the audit trail.

The existing `*.bak` and `*~` gitignore patterns prevent any future
recurrence from leaking into the tree. No tooling change required —
operators relying on `~`/`.bak`-style editor backups can keep doing so;
they remain local-only and should be swept periodically (e.g. as part
of phase-end housekeeping).

### Y. Stripe live key rotation deferred (HARD GATE before first payment)

**Priority:** MEDIUM-deferred (logged 2026-04-28); OPEN.

Discovered during Followup X: `.env~` (an editor backup of `.env`)
contained a single line — `STRIPE_SECRET_KEY=sk_live_...` — and had
been resident on the EC2 disk since 2026-04-13, ~15 days. The file was
gitignored (`*~` pattern, line 33) and was never committed to the repo,
so there is **no GitHub or external-mirror exposure**. The exposure
window is limited to anyone with shell access to the production EC2
host during 2026-04-13 → 2026-04-28.

**Operator decision (2026-04-28):** defer rotation. No live payment
processing is currently flowing through the platform, so the practical
blast radius is zero today. Rotating now would require a coordinated
key-replacement across `.env`, any other deploy targets, and the
Stripe dashboard, which is unjustified expense for a key with no
in-flight customer activity behind it.

**HARD GATE — must rotate before:**
- The first real customer payment is processed through the platform, OR
- Any third party (contractor, support vendor, etc.) is granted shell
  access to the production EC2 box, OR
- Any production-host disk image / snapshot is shared outside the
  current operator, OR
- 2026-07-28 (90 days from discovery), whichever is earliest.

When rotating: generate a new `sk_live_` in the Stripe dashboard,
update `.env` on EC2 (and any other deploy target), restart the
relevant pm2 process (`pm2 restart mergetasks`), revoke the old key
in Stripe, and mark this entry RESOLVED with the rotation date. Also
audit `~/.bash_history`, pm2 logs, and CloudTrail/auth logs for the
2026-04-13 → rotation-date window if the threat model warrants.

The `.env~` file itself was deleted as part of Followup X. The
`*~` gitignore pattern prevents recurrence in the tree but does not
prevent re-creation on disk if an editor writes another backup —
operators should be aware that any editor configured to write `~`
backups of `.env` will reproduce this exposure pattern.

---

## Phase 8 Item 1 — Cleanup vestigial local Redis on EC2 (RESOLVED)

**Priority:** LOW (resolved 2026-04-27); HISTORICAL RECORD.

A local `redis-server.service` was running on the production EC2 box at
PID 409987 since Thu 2026-04-23 06:37:06 UTC (~4 days), bound to
127.0.0.1:6379 + [::1]:6379 (loopback only, not externally reachable).

Topology audit confirmed it was unused:
- DBSIZE = 0 (empty across the entire 4-day uptime)
- CLIENT LIST showed no connections other than ad-hoc redis-cli probes
- All 3 `.env*` REDIS_URL entries point to ElastiCache
  (`rediss://master.mergetasks-redis-prod.1nj6ek.use1.cache.amazonaws.com:6379`)
- Production process connections (`ss -tnp state established`) target only
  the ElastiCache VPC IP 172.31.44.246, never 127.0.0.1
- No code references to `127.0.0.1:6379` or `localhost:6379` in `server/`

Resolved by stopping the service and disabling auto-start:
`sudo systemctl stop redis-server && sudo systemctl disable redis-server`.
Verified post-change: `systemctl is-active` → `inactive`, `is-enabled` →
`disabled`, no listener on 6379, all production processes (main 646640,
worker 651726) still online with ElastiCache connections intact, and
`GET /health` returned `{"server":true,"database":true,"redis":true}` —
ElastiCache connectivity unaffected.

`redis-server` package itself was retained — `redis-cli` remains
available for ad-hoc ElastiCache debugging (used during Followup S).
Rollback (if ever needed): `sudo systemctl enable --now redis-server`.

This had no production impact while running — it was operational debt,
not a hazard. The cleanup eliminates the "which Redis am I connecting
to?" confusion that surfaced briefly during Followup S investigation.

---

## Phase 8 Item 2 — Install and configure pm2-logrotate (RESOLVED)

**Priority:** MEDIUM (resolved 2026-04-27); HISTORICAL RECORD.

pm2 captures process stdout/stderr to `~/.pm2/logs/` with no built-in
rotation. After ~149 main-app restarts, log directory had grown to
**~188MB** (mergetasks-error.log 116M, mergetasks-out.log 73M, worker
logs negligible at 9KB combined). Unbounded growth path with a known
EBS-fill failure mode listed in Followup T from the prior sprint.

Installed `pm2-logrotate@3.0.0` via `pm2 install pm2-logrotate` on
pm2 6.0.14. Configured:

| Key | Value | Rationale |
|---|---|---|
| `max_size` | `10M` | Files grep-able in seconds; meaningful context window |
| `retain` | `30` | ~1 month history at daily rotation; adequate for postmortems |
| `compress` | `true` | Text logs compress 8-89× (see verification below) |
| `dateFormat` | `YYYY-MM-DD_HH-mm-ss` | Sortable, human-readable filenames |
| `rotateInterval` | `0 0 * * *` | Safety-net daily rotation for low-traffic logs |
| `workerInterval` | `30` | 30s size-threshold check; sufficient at our growth rate |

Persisted via `pm2 save` so module survives `pm2 resurrect` / box reboot.

Verification post-install:
- First rotation fired at 2026-04-27 18:23:08 UTC (within 30s of install,
  triggered by `mergetasks-error.log` exceeding the 10M threshold by
  ~12×). Rotation produced
  `mergetasks-error__2026-04-27_18-23-08.log` (116M) and
  `mergetasks-out__2026-04-27_18-23-08.log` (73M).
- After gzip: 116M → 1.3M (89× ratio, error log content was highly
  redundant — repeating warning lines), 73M → 3.7M (19× ratio).
- **Total directory: 188M → 5.0M** (recovered ~183M, ~1.2% of free disk).
- Production processes untouched: main 646640 / 149 restarts, worker
  651726 / 5 restarts (both PIDs and counters identical to pre-install).
- `GET /health` returned `{"server":true,"database":true,"redis":true}`.

**Operational note for future operators — pm2-logrotate config hot-reload
quirk:** `pm2 set <module>:<key> <value>` persists config to
`~/.pm2/module_conf.json` but the running module reads config at startup
and caches in memory. Config changes require `pm2 restart <module>` to
take effect. The first rotation in this install used the install-time
default `compress=false` even though `pm2 set ...:compress true` had run
beforehand — the two rotated files came out uncompressed and had to be
gzipped manually to match steady-state behavior. Correct install order
for future: **install → set all config → restart module → save**.

Steady-state worst case: 30 retained × 10M × 2 streams × 2 processes =
1.2GB uncompressed history, ~60-150MB compressed (negligible against
16GB free disk).

Rollback: `pm2 uninstall pm2-logrotate` removes the module entirely.
Existing rotated files in `~/.pm2/logs/` would remain (uninstall does
not touch historical artifacts) — manual cleanup if wanted.

---

## Phase 8 Item 4 — Investigate production restart counter (RESOLVED — no action required)

**Priority:** investigative-only (resolved 2026-04-27); HISTORICAL RECORD.

`pm2 list` showed `restart_time=149` on the main `mergetasks` process,
prompting investigation into whether crashes / unhandled exceptions / OOM
events were silently contributing. Followup U from the prior sprint
flagged this for review.

### Findings (Phase 1 — surface the data)

`pm2 describe mergetasks` exposed the load-bearing fact:

| Metric | Value | Implication |
|---|---|---|
| `restarts` | 149 | The number under investigation |
| **`unstable_restarts`** | **0** | pm2 marks restarts "unstable" only when the process exits within ~5s of starting (the crash-loop signature). **Zero unstable means none of the 149 were rapid crash loops.** |
| `created_at` | 2026-04-27T15:40:09Z | Current uptime started at this restart |
| `max_memory_restart` | 1G | Restart-on-memory threshold |
| Live `VmRSS` / peak `VmHWM` | 204MB / 241MB | 24% of the 1G cap; nowhere near triggering |
| `dmesg` OOM events | none | No kernel-level kills |
| systemd journal pm2 events | none | pm2 runs in user mode; no external supervisor interference |

`~/.pm2/pm2.log` filtered for "Stopping app:mergetasks" showed clusters of
restart events with multi-minute gaps in evening hours on 2026-04-24 and
2026-04-25 — the timing pattern of a developer running iterative
`pnpm build && pm2 restart` cycles, not a process auto-recovering from
crashes.

### Findings (Phase 2 — Hypothesis C investigation)

The rotated error log archive (Apr 11 → Apr 27 18:23, 957k lines) contained
**16,476 occurrences** of the boxed FATAL message
`FATAL: SESSION_SECRET (or JWT_SECRET) is not set` from
`server/_core/env.ts:20`. The hypothesis was that this assertion was firing
on every healthy boot before `dotenv` resolved, polluting logs and masking
real fatals.

Timestamp bracketing rejected the hypothesis:

| Position | Line # | Adjacent timestamp |
|---|---|---|
| First boxed FATAL | 1,770 | preceded by `2026-04-12T17:11:50Z` |
| Last boxed FATAL | 166,520 | immediately followed by `2026-04-13T02:22:17Z` |
| Lines 166,521 → 957,355 (83% of archive, 14 days of operation) | — | **zero boxed FATAL occurrences** |

The 16,476 lines are a closed historical incident from the initial
production stand-up window (~36 hours). At ~02:22Z on 2026-04-13 the boot
was fixed (start-server.sh in place + .env populated) and the boxed
FATAL has not appeared in 14+ consecutive days.

### Operational architecture note (preserve this for future operators)

Production has TWO independent layers protecting against missing
SESSION_SECRET:

1. **Bash pre-flight in `start-server.sh:6-11`** — checks `SESSION_SECRET`
   and `DATABASE_URL`, exits 1 with `FATAL: Missing required env var: …`
   (different message format from the boxed one) before node ever runs.
2. **Module-evaluation-time check in `server/_core/env.ts:11-29`** —
   evaluates inside `ENV.cookieSecret` initializer (line 46) on every
   bundle load, prints the boxed FATAL and `process.exit(1)` if both
   `SESSION_SECRET` and `JWT_SECRET` are empty.

Both layers must fail simultaneously for the boxed FATAL to fire. The
April 11-13 incident likely involved pm2 bypassing start-server.sh during
initial setup (running `node dist/index.js` directly), which removed
layer 1 and allowed the bundle's layer 2 to print 16k+ lines across
~2,060 retry boots before the operator added the wrapper script.

**Future operators: do NOT run `pm2 start dist/index.js` directly. Always
use the wrapper via `pm2 start ecosystem.config.cjs`.** The
`interpreter: "/bin/bash"` + `script: "start-server.sh"` configuration is
load-bearing — bypassing it loses the .env source step.

### Attribution of the 149 restart count

| Source | Estimated share | Evidence |
|---|---|---|
| Manual dev-cycle `pm2 restart` calls (2026-04-13 → 2026-04-27) | ~85-95% | pm2.log clusters in human dev hours; ~10/day matches the timeline; this sprint alone added ~10 |
| Pre-2026-04-13 pm2 retries during initial stand-up | ~5-15% | The 16k SESSION_SECRET incident accounted for ~2,060 boot attempts; pm2 stops retrying after 10 per session, so this maps to ~10-15 visible restart events |
| Crash loops / OOM / supervision incidents | **zero** | unstable_restarts=0, no dmesg OOM, no journalctl events |

### Resolution

No remediation needed. The 149 counter is a faithful record of dev-cycle
work plus the historical Apr 11-13 stand-up incident. pm2 has no built-in
"reset accumulated dev-cycle noise" facility — `pm2 reset mergetasks`
would zero the counter but that's cosmetic and would erase the audit
trail of the historical incident. Better to leave the number and
document what it means.

If the daily restart rate accelerates meaningfully (e.g., 50+/day
sustained), revisit. Until then, this entry serves as the evidence that
the current rate is normal for a dev-on-prod single-environment workflow.

Pairs with Followup V (migration-vs-reload window) and Phase 8 Item 1
(EC2-is-also-the-dev-workstation context) — both reinforce that the
absence of a separate dev/staging environment is the underlying cause of
elevated counter noise.

## CI workflow: stacked PR force-push timing (OPEN)

GitHub Actions CI runs do not reliably gate merges on this repo when the
PR has been force-pushed. Surfaced during the 2026-04-29 ten-PR
stack-merge sprint (PRs #4, #5, #6, #14, #8, #9, #10, #11, #12, #13).

### Symptoms

- PRs #5–#13 were force-pushed after `git rebase origin/main` to drop
  already-applied stack predecessors via patch-id. Each force-push
  invalidated whatever CI runs were in-flight against the prior tip.
- Several PRs (notably #13) merged showing "0 of 2 checks passed" —
  GitHub had not yet completed runs against the new tip when the
  operator clicked merge.
- Actual validation came from local `pnpm check` + `pnpm test` (e.g.
  PR #13: 836 passed / 92 skipped / 0 failed) embedded in commit bodies,
  not from GitHub Actions status.
- Production was not affected — every deploy verified clean — but the
  CI signal provided no protection during the sprint.

### Root causes

1. CI workflow trigger config likely scoped to specific branches or
   events that don't match force-pushed feature branches.
2. No branch protection rule on `main` requiring CI checks to pass
   before merge — so "0 of 2 checks passed" was advisory rather than
   blocking.
3. Stacked-PR pattern compounds the gap: rebase + force-push is the
   normal flow when each predecessor lands, and each force-push
   restarts the CI clock.

### Proposed fix

Modify `.github/workflows/ci.yml`:

- `on: pull_request: branches: ['**']` — run on all PR target branches,
  not just `main`.
- Ensure `pull_request: types: [opened, synchronize, reopened]` so
  force-pushes (`synchronize`) re-trigger runs.
- Add a `workflow_run` trigger if downstream workflows depend on CI
  completion.

Add branch protection on `main`:

- Require status checks to pass before merging.
- Require branches to be up to date before merging (so stale CI runs
  cannot satisfy the gate).
- Mark the CI workflow's job names as required checks.

### Effort and priority

~30–45 minutes. **Priority: MEDIUM.** Not blocking — local validation
plus deploy-time verification has carried the load — but should land
before the next multi-PR merge sprint to restore CI as a real gate.
