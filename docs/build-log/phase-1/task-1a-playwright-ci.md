# Phase 1 Task 1a — Playwright in CI + Redis service container + `.env.test`

- **Status:** Complete — CI green end-to-end at `976dce1`
- **Date:** 2026-04-21
- **Commit hash series:** `06a0bf7` (main) → `16ca99d` → `16330cc` → `e053cff` → `1b79351` → `976dce1` (close)
- **Baseline commit:** `91c7876` (Phase 1 Task 1b post-hotfix)
- **Scope:** CI workflow + Playwright smoke spec + committed `.env.test`. No domain code, schema, or agent tooling.

---

## Decision references

- **Decision 41 (Task 6 §9.1):** Playwright added to CI starting Phase 1 as a new `e2e` job in `.github/workflows/ci.yml`, depends on `test`, reuses the MySQL 8.0 service container, 10-minute timeout, artifact upload on failure, PR-merge-blocking.
- **Decision 42 (Task 6 §9.2):** Containerized MySQL 8.0 per CI job stays the standing approach — the new `e2e` job provisions its own MySQL container rather than sharing the `test` job's.
- **Decision 45 (Task 6 §9.5):** `.env.test` committed with test-only values. Real secrets remain in GitHub Actions secrets / gitignored `.env*` files.
- **Task 1b (`ba00830`) fallout:** consumer migration made the shared `server/queue/redisClient.ts` singleton module-load fail-fast on missing `REDIS_URL`. CI's `test` job had no Redis, so every test file that transitively imported `rateLimiter` / `tokenBlocklist` / `pkceStore` crashed at import — 87 test failures observed on the Task 1b push. This task adds the Redis service container that unblocks them.

---

## Three things that changed

### 1. Redis service container added to the `test` job

`.github/workflows/ci.yml` — `test` job now runs `redis:7-alpine` alongside `mysql:8.0`, with a `--health-cmd="redis-cli ping"` check and a `Wait for Redis` step. `REDIS_URL=redis://127.0.0.1:6379` is set in the job's `env` block so the singleton at `server/queue/redisClient.ts:18-25` succeeds at module load. Plain `redis://` (no TLS) is fine here — only the managed ElastiCache endpoint needs `rediss://`.

### 2. New `e2e` job + CI smoke spec

New job:

- **Depends on:** `[typecheck, test]`. Per Decision 41, unit tests gate the e2e work — no point burning browser-boot minutes if Vitest is red.
- **Service containers:** fresh `mysql:8.0` + `redis:7-alpine` (each GitHub Actions job provisions its own, per Decision 42).
- **Env:** same test-shaped values as the `test` job, plus `PORT=5000` (the pre-existing `playwright.config.ts` baseURL is `http://localhost:5000`; the server otherwise defaults to PORT=3000).
- **Steps:** pnpm install → `pnpm exec playwright install --with-deps chromium` → wait-for-mysql → wait-for-redis → `pnpm db:push` → `pnpm exec playwright test e2e/ci-smoke.spec.ts --project=chromium`.
- **Timeout:** 10 minutes.
- **Artifacts on failure:** `playwright-report/` + `test-results/` uploaded for 7 days.

CI smoke spec (`e2e/ci-smoke.spec.ts`, new file): loads `/sign-in` and asserts the email field, password field, and "Sign In" button are visible. Uses the plain `@playwright/test` `test` / `expect` imports — **not** the `authedPage` fixture from `e2e/helpers.ts`, because the smoke spec must not depend on a seeded demo user.

The existing `e2e/*.spec.ts` files (`auth`, `clients`, `dashboard`, `products`, `proposals`, `reports`, `settings`, `smoke`, `webstores`) are left on disk but **not** executed by the CI job — they depend on `demo@mergetasks.com / demo1234` + richer fixtures that Task 1a does not wire. Reviving them is explicit follow-up work.

`notify-deploy` updated from `needs: [typecheck, test, build]` to `needs: [typecheck, test, e2e, build]` so the deploy-notification gate only fires after e2e is green.

### 3. `.env.test` committed

New file at repo root. Values mirror the CI `test` / `e2e` job envs so `pnpm exec vitest run` and `pnpm exec playwright test` behave identically locally (given MySQL on :3306 and Redis on :6379) and in CI:

- `DATABASE_URL=mysql://mergetasks:mergetasks_pass@127.0.0.1:3306/mergetasks_test?ssl=false`
- `REDIS_URL=redis://127.0.0.1:6379`
- `SESSION_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `APP_BASE_URL` (port 5000)
- `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_test_...`, `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`
- `OPENAI_API_KEY` + `RESEND_API_KEY`: test-only sentinel strings (no test makes real network calls to these providers).

`.gitignore` got a leading comment making the convention explicit — `.env.test` is NOT ignored (committed), `.env.test.local` remains ignored for per-machine overrides.

## Files touched

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Redis service container + wait step + `REDIS_URL` env in `test` job; new `e2e` job (MySQL + Redis services, Playwright install, chromium smoke); `notify-deploy` now also `needs: [e2e]`. Jobs renumbered in comments. |
| `e2e/ci-smoke.spec.ts` | New. Loads `/sign-in`, asserts email / password / submit visible. Plain `@playwright/test` — no auth fixtures. |
| `.env.test` | New. Test-only values per Decision 45. |
| `.gitignore` | Added leading comment above the env-vars block explaining why `.env.test` is intentionally absent from the ignore list. |

No `.ts` / `.tsx` server or client files were touched. No schema, migration, or drizzle-config changes. No new dependencies (`@playwright/test ^1.59.1` already in devDependencies from pre-rebuild).

## Verification performed (local)

1. **`pnpm exec tsc --noEmit`** — exit 0, clean.
2. **Singleton fail-fast paths:**
   - With `REDIS_URL=redis://127.0.0.1:6379` → `await isRedisHealthy()` returns `true` (PING → PONG).
   - With `REDIS_URL` unset → `server/queue/redisClient.ts` throws the expected `"REDIS_URL is not set. Phase 1+ requires …"` at module load.
3. **Redis-importing test runs end-to-end** — `server/security.test.ts` (imports `rateLimiter` → singleton) executed under the CI-shaped env produced **45 / 45 passing** with the log line `Rate limiter using Redis store (persists across deploys)`. This is the canonical signal that the "87 failures after Task 1b" blocker is gone: every test file that transitively imported a Redis consumer now loads its dependency graph successfully.
4. **Playwright dry-run deferred to CI.** Running the smoke locally would require a fully-booted dev server + migrated schema and adds no signal beyond what the CI e2e job will produce on push. The existing `playwright.config.ts` is unchanged and known-good.

## Journey coverage

Per `phase-0/task-6-regression-protocol.md` §3.2, the Phase 1 gate requires Playwright to be wired and J3 / J4 / J5 / J7 / J10 journeys pass-required. Task 1a's `ci-smoke.spec.ts` is **not** any of J1–J11 — it's infrastructure proof, not a journey spec. J-series specs land in subsequent tasks alongside the pricing engine and test-harness work.

## Out of scope (deferred)

- `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` devDeps and `jsdom`-environment vitest config for `.test.tsx` files (Task 6 §4.2). First component test (distributor pricing view, J5) lands with the pricing work.
- `scripts/seed.ts` extensions — multi-division / multi-department / approval-chain / PO-payment-method fixtures per Decisions 37 / 38 / 44 (Task 6 §4.3).
- `server/pricing.test.ts` baseline (Task 6 Appendix items 9, 11).
- `drizzle/migrations.test.ts` migration-integrity harness (Task 6 §4.5).
- `docs/build-log/regression-manual-checklist.md` (Task 6 §4.4, §4.7).
- `scripts/regression-report.ts` (Task 6 §4.7).
- `docs/build-log/design-partner-sessions.md` (Task 6 §4.3, Decision 46).
- Reviving the pre-existing `e2e/{auth,clients,dashboard,products,proposals,reports,settings,smoke,webstores}.spec.ts` files — they need seed + storageState auth fixtures that don't exist in CI yet.
- Journey specs J1–J11.
- Schema migrations, pricing engine, agent-tool implementations.

## Flagged for later

- The existing `e2e/smoke.spec.ts` exercises nine authenticated routes via the `authedPage` fixture. Those will come online once the multi-division / multi-department seed lands (Task 6 §4.3 work). Until then, `ci-smoke.spec.ts` is the single CI-executed spec.
- Pre-existing `.env` on the working EC2 points `DATABASE_URL` at production RDS and `REDIS_URL` at production ElastiCache. Any future CI/local scripting that does `dotenv/config` without pre-setting env vars risks test-traffic landing on prod infra. Not introduced by this task; worth a follow-up hardening pass (e.g. `validateEnv` refusing a `rediss://`-scheme `REDIS_URL` under `NODE_ENV=test`).

## Fix series — what it took to make CI green

The initial Task 1a commit `06a0bf7` landed as planned, but the e2e smoke test failed. What started as an assumed selector-config fix revealed a chain of compounding issues. This section captures the actual commit trail for the record.

### Commit ladder

| Commit | Purpose | Result |
|---|---|---|
| `06a0bf7` | Initial Task 1a — Redis container + new e2e job + smoke spec | test job ✅, e2e ❌ (selectors timed out) |
| `16ca99d` | Fix attempt 1: `getByLabel` → `getByPlaceholder` | e2e ❌ (same blank page) |
| `16330cc` | Fix attempt 2: `pnpm dev` → `pnpm build && pnpm start` in `playwright.config.ts` `webServer` for CI | e2e ❌ (blank page, but now with correct hashed CSS → build was working) |
| `e053cff` | Diagnostic: temporary `[DIAG]` logging in `serveStatic()` | e2e ❌ (but CI WebServer stdout captured the real error in the job log) |
| `1b79351` | Fix attempt 3 (actual root cause): `ALLOWED_ORIGINS=http://localhost:5000` in e2e CI env | e2e ✅ |
| `976dce1` | Cleanup: revert diagnostic logging per Principle 2 | all ✅ |

### Root cause (what CI's stdout revealed)

The e2e CI job runs `pnpm start`, which sets `NODE_ENV=production`. In production mode, the CORS middleware at `server/_core/index.ts:163-181` only allows origins matching either `ALLOWED_ORIGINS` (env var) or `/^https:\/\/[a-z0-9-]+\.mergetasks\.com$/`. Playwright navigates from `http://localhost:5000`. That origin matched neither rule, so every request (including the root HTML for `/sign-in`) was rejected with `Error: CORS: origin http://localhost:5000 not allowed`. The browser received a CORS-rejection response instead of the HTML bundle — producing a blank page in the smoke test screenshot.

The built `dist/public/index.html` and JS bundle were fine on disk all along. No code bug — just a config mismatch between the production-mode CORS policy and the test harness's localhost origin.

### Fix

Set `ALLOWED_ORIGINS: http://localhost:5000` in the e2e CI job's `env:` block. The CORS middleware already reads `ALLOWED_ORIGINS` as its override mechanism — the fix uses the existing contract rather than weakening production security or special-casing `CI=true` in application code.

### Why it took several passes

Each fix attempt was a correct fix for the symptom it addressed. The chain only became visible once the diagnostic commit produced WebServer stdout in the CI logs:

1. `getByLabel` → `getByPlaceholder` was correct — the page's `<Input>` component doesn't forward `id` to the underlying `<input>`, breaking label association. Unrelated to the blank page, but still a real selector-robustness fix worth keeping.
2. `pnpm build && pnpm start` was correct — `pnpm dev` doesn't build the client, so `serveStatic` had nothing to serve. Unrelated to CORS but necessary for the production-mode code path to exercise.
3. `ALLOWED_ORIGINS` was the actual root cause. Without the prior two fixes in place, the CORS error would still have been masked by the earlier failures.

### Side effects of the investigation (kept, not reverted)

- `getByPlaceholder` selectors in `e2e/ci-smoke.spec.ts` — kept. More robust than `getByLabel` for components with broken label-to-input association.
- `playwright.config.ts` `webServer.command` conditional on `process.env.CI` — kept. The CI code path must exercise the real production serving behaviour, not the dev server.
- `.gitignore` comment and `.env.test` structure — kept.

### Flagged for later (discovered during fix series)

- **`<Input>` component doesn't forward `id` to the underlying `<input>` element** (`client/src/components/ui/input.tsx` or similar). Breaks `<label htmlFor="…">` association for Playwright's accessible-name computation and for screen readers. Client-side accessibility improvement, not blocking. Worth a standalone task.
- **The inverted ternary in `serveStatic()` at `server/_core/vite.ts:85-87`** — inside the function body, `process.env.NODE_ENV === "development"` resolves to `dist/public`, otherwise `__dirname/public`. Given the caller at `server/_core/index.ts:322` already branches so `serveStatic()` is never invoked in development, the inner `development` branch is dead. Cleanup candidate per Principle 2. Not touched in this task — the outer branch that actually executes (`__dirname/public`) happened to resolve correctly after bundling, so the dead logic wasn't the cause.

## Sign-off

- **Reviewer:** Yan
- **CI state at close:** All jobs green at `976dce1` — Type Check ✅ Tests ✅ E2E (Playwright) ✅ Build ✅ Notify Deploy ✅.
- **Next phase unblock:** Task 2 (Phase 1 schema design finalization) can begin. Task 1b-follow-on (component test harness + seed fixtures + regression tooling) is independent and parallelizable.

## Architectural Decisions impacted

None open or amended. 47 decisions remain locked from Phase 0 close (`69915bc`). Task 1a implements pre-locked Decisions 41, 42, 45 directly.
