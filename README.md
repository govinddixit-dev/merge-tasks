# MergeTasks

MergeTasks is a multi-tenant B2B platform for promotional-products distributors.
Distributors manage clients, build proposals, spin up branded employee
webstores, route purchase orders to suppliers, and let client-side buyers
self-serve under department-level budgets and SSO — with an AI Copilot
layered across the surface for quote assembly, PO consolidation, and
analytics. This repository holds the full stack: client, server, database
schema, migrations, and documentation.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Frontend | React 19, Vite, TailwindCSS, Radix UI, wouter, TanStack Query |
| API | tRPC v11 over Express |
| Server | Node.js (ESM), esbuild-bundled |
| Database | MySQL, accessed through Drizzle ORM |
| Background / email | Resend (transactional email) |
| File storage | AWS S3 (presigned uploads) |
| Payments | Stripe + Stripe Connect |
| Auth | JWT cookies (session + refresh), SAML / OIDC SSO for stores, social login |
| AI | Anthropic + OpenAI (Copilot, proofing, voice) |
| Observability | Sentry |
| Process manager | pm2 |

## Key capabilities

- **Multi-tenant core.** Every query is scoped by organization; stores and
  storefronts are isolated per distributor.
- **SSO for enterprise stores.** SAML and OIDC with JIT provisioning,
  group-to-division mapping, and division-specific subdomain routing.
- **Multi-division stores.** Employees see the catalog, budgets, and
  approvals attached to their division; POC approvals cascade.
- **Branded webstores.** Theme-aware storefront with cart, checkout,
  print-on-demand products, media sharing, and a client portal.
- **Proposals.** Rich HTML proposals with virtual proofing, department
  approvals, signed approval-link expiry, and PDF delivery.
- **Purchase orders.** Aggregation across proposals, supplier routing,
  QuickBooks sync, and a `declined` state for vendor rejections.
- **AI Copilot.** Natural-language branding updates, PO aggregation,
  branded outbound email, predictive reorders, churn signals, and store
  recommendations — all rate-limited.
- **Print store.** Dedicated storefront tab for print-on-demand products
  with per-variant pricing tiers and supplier API hooks.
- **Media sharing.** File library shared between distributor and client
  POC, with role-scoped delete permissions.
- **Department budgets.** Per-division spending caps enforced server-side
  at checkout, with live remaining-balance indicators.
- **Session security.** 2-hour distributor / 30-minute store inactivity
  timeouts with a cross-tab warning modal, visible logout notice, and
  RFC 8058 List-Unsubscribe compliance for commercial email.

## Project structure

```
/client     — React SPA (Vite). Pages, components, hooks, theme.
/server     — Express + tRPC API, routers, utilities, email, SSO, Stripe.
/drizzle    — Database schema, migrations (0000_..0065), meta snapshots.
/shared     — Constants and types shared between client and server.
/docs       — Onboarding packets, audit reports, workflow docs.
/public     — Static assets served by Vite.
/scripts    — One-shot tooling (seeds, admin utilities).
```

## Setup

1. **Install dependencies** (requires Node.js 20+). The repo uses **pnpm**
   (`package.json` / `pnpm-lock.yaml`). Use `corepack enable` if pnpm is not
   installed. `npm install` often fails on a strict peer-deps conflict between
   Vite 7 and `@builder.io/vite-plugin-jsx-loc`; use `pnpm install`, or
   `npm install --legacy-peer-deps` if you must use npm.
   ```
   pnpm install
   ```
2. **Configure environment.** Copy `.env.example` to `.env` and fill in
   every required variable. `server/utils/validateEnv.ts` enforces the
   required set at boot; missing values cause the server to refuse to
   start in any non-local environment.
3. **Run migrations.** Drizzle manages schema with numbered SQL files
   under `/drizzle`:
   ```
   pnpm run db:push
   ```
4. **Seed (optional):**
   ```
   pnpm run seed
   ```

## Running locally

```
pnpm dev             # tsx watch — API + Vite HMR
pnpm run check       # tsc --noEmit (strict type check)
pnpm test            # vitest run
pnpm run e2e         # playwright (headless)
```

### Docker (MySQL + Redis + app + worker)

From the repo root, with Docker Engine installed:

```
docker compose up --build
```

Then open **http://localhost:3080**. The stack runs `NODE_ENV=production`
with a production build; MySQL and Redis are **not** published on the host
(only the app is, on **3080**), so this avoids common port clashes with
`:3306`, `:6379`, and `:3000`. Migrations run automatically on app startup.
Stripe is left unset in the default compose file because `validateEnv`
rejects `sk_test_...` keys when `NODE_ENV=production`; add real keys via
`docker compose --env-file ...` or compose overrides when you need billing.

The Vite dev server proxies `/api/*` to the Express server so a single
`localhost` origin serves both.

## Running in production

Production runs a single Node process via pm2 (`ecosystem.config.cjs`).
The build step bundles the client with Vite and the server with esbuild.

```
npm run build        # vite build + esbuild server/_core/index.ts
pm2 start ecosystem.config.cjs  # first time only
pm2 logs mergetasks
pm2 reload mergetasks --update-env
```

Process is expected to report `online` with steady memory (~160 MB RSS
at rest).

## Deployment

The server has an end-to-end deploy pipeline in `deploy.sh`. You have
two ways to trigger it: push a commit to `origin/main`, or run
`./deploy.sh` directly.

### What deploy.sh does (in order)

1. `git fetch` + `git reset --hard origin/main`
2. `npm ci` — only when `package-lock.json` or `package.json` changed
3. `mysqldump --no-data` schema snapshot → `.deploy-backups/schema-<id>.sql`
4. `npm run db:push` — our idempotent migrator (see below). On failure,
   deploy aborts **before** the build step; pm2 keeps serving the
   previous release.
5. Snapshots the current `dist/` to `.deploy-backups/dist-prev-<id>.tar.gz`
6. `npm run build` — Vite + esbuild
7. `pm2 reload mergetasks --update-env` — zero-downtime reload
8. Polls `http://127.0.0.1:3000/health` for up to 30 s
9. If steps 7 or 8 fail: restores the `dist/` tarball, `git reset`s to
   the pre-deploy commit, reloads pm2 on the restored build, and prints
   `DEPLOY FAILED — rolled back to previous build`

Every step is timestamped and tee'd to `deploy.log`. The last 10 schema
snapshots are kept; older ones are pruned automatically.

### Trigger a deploy

```
# From your laptop
git push origin main
# On the server, the GitHub webhook at /api/deploy/webhook triggers deploy.sh

# Or, manually on the server
./deploy.sh
```

### GitHub webhook setup

1. Pick a strong secret and set it on the server:
   ```
   echo "DEPLOY_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env
   pm2 reload mergetasks --update-env
   ```
2. GitHub repo → **Settings → Webhooks → Add webhook**:
   - Payload URL: `https://<your-host>/api/deploy/webhook`
   - Content type: `application/json`
   - Secret: the same value you put in `.env`
   - Events: **Just the push event**
3. GitHub will send a `ping` — the endpoint responds `200 {"pong":true}`.
4. Subsequent pushes to `refs/heads/main` are verified (HMAC-SHA256
   against the raw body) and spawn `deploy.sh` detached.

When `DEPLOY_WEBHOOK_SECRET` is unset, the endpoint returns `503` and
auto-deploy is disabled (fail-closed).

### Check deploy status

```
tail -f ~/mergetasks/deploy.log        # live log of every deploy
pm2 status                              # online / ↺ restart count
pm2 logs mergetasks --lines 100         # tail runtime logs
curl http://127.0.0.1:3000/health       # server + db + redis status
```

A healthy response looks like:

```
{"status":"healthy","timestamp":"...","checks":{"server":true,"database":true,"redis":true}}
```

### Roll back manually

If something goes wrong after a deploy has already completed (rare —
the health check usually catches it), roll back with:

```
# 1. Point the working tree at the last known-good commit
git log --oneline -20                   # find the SHA you want
git reset --hard <sha>

# 2. Restore the previous dist (deploy.sh keeps tarballs)
ls -lt .deploy-backups/dist-prev-*.tar.gz | head -5
rm -rf dist
tar -xzf .deploy-backups/dist-prev-<id>.tar.gz

# 3. Reload pm2 on the restored build
pm2 reload mergetasks --update-env
curl http://127.0.0.1:3000/health
```

A schema rollback is almost never the right move (migrations are
additive by convention); if you're sure, the `.deploy-backups/schema-<id>.sql`
snapshots are raw `mysqldump --no-data` output that you can diff against
`SHOW CREATE TABLE` to plan a corrective ALTER.

### The migrator

`npm run db:push` runs `scripts/migrate.sh`, which tracks applied
migrations in `_schema_migrations(filename, appliedAt)`. On first run it
seeds the tracker with every `drizzle/NNNN_*.sql` file already on disk.
On subsequent runs it applies only files not yet in the tracker, in
lexical order, aborting on the first failure.

We deliberately don't use `drizzle-kit generate && drizzle-kit migrate`
because our `drizzle/meta/_journal.json` doesn't track the hand-written
migrations `0050_*`–`006N_*`, so `generate` produces spurious
auto-diff migrations that collide with the real ones.

## Documentation

`/docs` holds onboarding packets (distributor, IT), workflow guides,
and cross-sprint audit reports. Notable entries:

- `docs/distributor-onboarding-guide.md` — customer-facing setup.
- `docs/it-onboarding-packet.md` — SSO / multi-division enablement.
- `docs/resend-audit-report.md` — transactional email audit.
- `docs/master-audit-report.md` — latest cross-sprint audit.

## License

Proprietary. See [LICENSE](./LICENSE). All rights reserved.
