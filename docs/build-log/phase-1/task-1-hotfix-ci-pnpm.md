# Phase 1 Hotfix — CI pnpm migration + stale lockfile removal + NODE_ENV scoping fix

**Status:** Ready for Yan review (post-push, pending GitHub Actions green)
**Date:** 2026-04-21
**Commit hash:** `c7e8adc`
**Baseline commit:** `9a09702` (Phase 1 Task 1 post-backfill)
**Scope:** Tight — CI workflow + repo-root lockfile only. No code, schema, or domain changes.

---

## Why this hotfix exists

CI was failing on `9a09702`. The `test` and `build` jobs invoke `npm ci`, which reads the tracked `/package-lock.json`. That lockfile was stale (last regenerated before the pnpm migration) and drifted further when Task 1 (`1d64bd9`) added `bullmq` and regenerated `pnpm-lock.yaml`. `package.json` declares `packageManager: pnpm@10.4.1` — the workflow had never caught up.

Task 1's completion log (`docs/build-log/phase-1/task-1-redis-bullmq.md` → "Flagged for later") already named the stale `/package-lock.json` as cleanup work; this hotfix closes that loop and fixes the CI breakage that made it urgent.

## Three issues closed

### Issue 1 — CI ran `npm ci` while the project is pnpm-native

`.github/workflows/ci.yml` had all three jobs (`typecheck`, `test`, `build`) running `npm ci --no-audit --no-fund --legacy-peer-deps` and caching `npm`, while `package.json` pins pnpm as the package manager. The `--legacy-peer-deps` flag existed only to paper over an npm-specific ERESOLVE failure on `@builder.io/vite-plugin-jsx-loc` (peer on vite 4/5 vs the project's vite 7) that pnpm tolerates natively.

**Fix:** Each job now runs:

```yaml
- uses: pnpm/action-setup@v4
  with:
    run_install: false
- uses: actions/setup-node@v4
  with:
    node-version: ${{ env.NODE_VERSION }}
    cache: pnpm
- name: Install dependencies
  run: pnpm install --frozen-lockfile
```

Script invocations migrated accordingly: `npm run db:push` → `pnpm db:push`, `npm run build` → `pnpm build`, `npx tsc/tsx/vitest` → `pnpm exec tsc/tsx/vitest`. The `--legacy-peer-deps` workaround is gone — it's a non-issue under pnpm.

### Issue 2 — Stale tracked `/package-lock.json`

File was ~625 KB and authored against an older dependency graph (pre-pnpm migration, pre-`bullmq`). Kept around only because nothing had cleaned it up.

**Fix:**

- `git rm /package-lock.json`
- Added `/package-lock.json` to `.gitignore` with an explanatory comment so nothing accidentally reintroduces it
- Verified `pnpm-lock.yaml` is **not** in `.gitignore` and remains tracked (authoritative lockfile)

### Issue 3 — `NODE_ENV=production` leak in the build job

The previous workflow set `NODE_ENV: production` at the `build` job's top-level `env:` block. That value was visible to both the install step and the build step. Under npm the previous author had to work around it with `npm ci … --include=dev` (documented in a now-removed comment) so vite / esbuild / `@vitejs/plugin-react` would actually land on disk.

**Why this mattered for the pnpm migration:** pnpm 10.x also honours `NODE_ENV=production` and skips `devDependencies`. A naïve npm→pnpm swap that kept the job-level `NODE_ENV: production` would have silently re-broken the build job — `pnpm install --frozen-lockfile` would install the prod-only graph, and the next step would fail with `sh: 1: vite: not found`.

**Fix:** Moved `NODE_ENV: production` off the job-level `env:` and onto only the `Build (vite + esbuild)` step's `env:`. The job-level `env:` now holds only `VITE_APP_TITLE`. The install step runs with `NODE_ENV` unset, so pnpm installs the full dependency graph (devDeps included) with no flag needed. Only the actual vite/esbuild invocation sees `NODE_ENV=production`, which is what they need for prod-mode output.

### Why the NODE_ENV fix was bundled with this hotfix

The agent caught this during the pre-hotfix audit. The original scope as first sketched was "npm → pnpm, delete lockfile" — but that plan would have re-broken the build job on first green run because pnpm respects `NODE_ENV=production` the same way npm does (minus the `--include=dev` escape hatch, which has no pnpm equivalent in this codebase's config). Fixing it inline is strictly better than shipping a known-broken hotfix and following up a second time. Yan approved the bundled scope before the hotfix began.

## Files changed

- `.github/workflows/ci.yml` — npm → pnpm across all three jobs; `NODE_ENV: production` scoped to the build step only; obsolete `--legacy-peer-deps` and `--include=dev` comments removed.
- `.gitignore` — added `/package-lock.json` with a comment pointing at `packageManager: pnpm@10.4.1`.
- `package-lock.json` — deleted.
- `docs/build-log/phase-1/task-1-hotfix-ci-pnpm.md` — this file.

No `.ts` / `.tsx` / `.js` / server / client / schema / migration / drizzle-config files were touched.

## Pre-commit verification performed

From the repo root on commit-to-be `9a09702` working tree:

- `pnpm install --frozen-lockfile` — PASS (`Lockfile is up to date, resolution step is skipped` → `Already up to date`, 3.3s). The `msgpackr-extract` ignored-build-scripts warning is pre-existing and unrelated to this hotfix.
- `pnpm exec tsc --noEmit` — PASS (exit 0, clean).
- `git diff .github/workflows/ci.yml` — reviewed. Confirmed: no env vars dropped (SESSION_SECRET / DATABASE_URL / CREDENTIAL_ENCRYPTION_KEY / APP_BASE_URL / OPENAI_API_KEY / RESEND_API_KEY / DB_SSL / CI all present); MySQL service container unchanged; job DAG (`needs: [typecheck, test]` / `needs: [typecheck, test, build]`) unchanged; `notify-deploy` job unchanged; concurrency block unchanged; `NODE_VERSION` env unchanged; `timeout-minutes` unchanged.

## Post-commit follow-up

Yan pushes to `origin/main` and watches GitHub Actions. Success = CI green across typecheck, test, build = Task 1b unblocked.

## Still queued for Task 1b (NOT addressed here)

Per Task 1's "Flagged for later" section, unchanged by this hotfix:

- Existing Redis consumers still use ad-hoc `new IORedis(url)` constructors in `server/utils/rateLimiter.ts`, `server/utils/tokenBlocklist.ts`, `server/utils/pkceStore.ts` — should migrate onto the shared `redisConnection` singleton from `server/queue/redisClient.ts`.
- `ALLOW_MEMORY_RATE_LIMIT` escape hatch in `rateLimiter.ts` is no longer honoured by `validateEnv` (dead in practice) — clean up alongside the consumer migration.

## Architectural Decisions impacted

None. This hotfix does not open, close, or amend any decision. 47 decisions remain locked from Phase 0 close (`69915bc`).
