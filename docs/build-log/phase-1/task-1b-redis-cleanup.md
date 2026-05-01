# Phase 1 Task 1b — Redis consumer migration + dead code removal

- **Date:** 2026-04-22
- **Commit hash:** `ba00830`
- **Status:** closes 2 of 3 Task 1 follow-up flags

## Context

Task 1 (commit `1d64bd9`) wired the shared Redis + BullMQ singleton at
`server/queue/redisClient.ts` but deliberately kept scope narrow: it did not
migrate existing Redis consumers, and it did not remove the in-memory rate
limiter fallback. Task 1's post-commit audit flagged three follow-ups:

1. Migrate existing Redis consumers (`rateLimiter`, `tokenBlocklist`,
   `pkceStore`) to the shared singleton.
2. Remove the `ALLOW_MEMORY_RATE_LIMIT` escape hatch (unreachable since
   Task 1's hotfix `c7e8adc` made `REDIS_URL` unconditionally required).
3. Remove the stale `package-lock.json` after the pnpm migration.

Flag (3) was closed by hotfix `c7e8adc`. This task closes flags (1) and (2).

## Files modified

| File | Change |
|---|---|
| `server/utils/rateLimiter.ts` | Swapped ad-hoc `new IORedis(...)` for the shared `redisConnection` singleton. Removed the `InMemoryStore` class, the Redis-vs-memory selector in `getStore()`, the `_usingMemoryInProd` / `_memoryWarningCount` production-warning machinery, and the "ioredis is not installed" try/catch. The store is now Redis-only. |
| `server/utils/tokenBlocklist.ts` | Swapped ad-hoc `new IORedis(...)` for the shared singleton. Removed the per-consumer `connect().then(…).catch(…)` lifecycle — the singleton's global handlers cover it. `InMemoryBlocklist` is preserved per narrow-scope instruction. |
| `server/utils/pkceStore.ts` | Swapped ad-hoc `new IORedis(...)` for the shared singleton. Removed the lazy `getRedis()` helper and `redisAvailable` gate — the singleton connects eagerly at module load and queues commands during reconnect, so the gate is obsolete. The in-memory `Map` fallback on command-level error is preserved. |
| `server/utils/validateEnv.ts` | No change — `ALLOW_MEMORY_RATE_LIMIT` was never referenced here; the flag's unreachability comes from `REDIS_URL` already being unconditionally required (added in Task 1's original commit). |
| `.env.example` | Removed the commented-out `ALLOW_MEMORY_RATE_LIMIT=1` block. |

## Before / after IORedis instance count

- **Before:** 4 `new IORedis(…)` sites (1 shared singleton + 3 ad-hoc consumers).
- **After:** 1 `new IORedis(…)` site — the singleton at `server/queue/redisClient.ts:45`.

All consumers now share the singleton's connection and inherit its retry /
reconnect policy (`maxRetriesPerRequest: null`, `enableReadyCheck: false`,
exponential backoff to 10s, `READONLY`-triggered reconnect).

### Behavior shift to note

Consumers previously used `maxRetriesPerRequest: 2–3` and `lazyConnect: true`,
so a Redis outage would make commands error-out quickly. Under the singleton,
commands queue indefinitely while ioredis retries. For rate limiting and token
blocklist this is a strict improvement: no false "not rate limited" or "token
not blocklisted" decisions on transient failures. For PKCE, the in-memory
fallback on command-level error is preserved but becomes harder to reach —
the singleton rarely errors at the command level since it queues through
reconnects.

## Dead code removed (Principle #2: no dead code at merge)

- `ALLOW_MEMORY_RATE_LIMIT` env var: unreachable since `REDIS_URL` became
  unconditionally required in Task 1. Removed from `.env.example` and from all
  rateLimiter warning text. No code path read it (the references were
  documentation-only, embedded in log strings inside the now-removed fallback).
- `InMemoryStore` class in `rateLimiter.ts`: unreachable for the same reason.
  Removed entirely.
- `_usingMemoryInProd` / `_memoryWarningCount` / `MEMORY_WARNING_INTERVAL`:
  only fired when `InMemoryStore` was active. Removed.

## Developer workflow note — READ THIS

Local development now requires Redis running locally. The in-memory rate
limiter fallback is gone — if Redis is unreachable, the app will fail at
startup (`validateEnv` rejects missing `REDIS_URL`) or block on the first
rate-limited request.

**For new contributors:**

```bash
docker run -d --name redis-local -p 6379:6379 redis:7-alpine
# then in your .env:
REDIS_URL=redis://localhost:6379
```

Alternatively, connect to the dev ElastiCache instance via SSH tunnel.

**For existing contributors:** if you had `ALLOW_MEMORY_RATE_LIMIT=1` set in
your local `.env`, remove it — it is ignored. Ensure Redis is running.

## Verification steps performed

- `rg "new IORedis\b" server/ --type ts` → exactly one match, at
  `server/queue/redisClient.ts:45` (the shared singleton). ✅
- `rg "ALLOW_MEMORY_RATE_LIMIT" --type ts` → zero matches. ✅
- `rg "InMemoryStore" --type ts` → zero matches. ✅
- `rg "from ['\"]ioredis['\"]" server/ --type ts` → exactly one match, at
  `server/queue/redisClient.ts:11`. ✅
- `pnpm exec tsc --noEmit` → clean. ✅

## Outstanding Task 1 follow-ups

None. All three flags closed:

1. ✅ Consumer migration to shared singleton (this task).
2. ✅ `ALLOW_MEMORY_RATE_LIMIT` dead code removal (this task).
3. ✅ Stale `package-lock.json` (hotfix `c7e8adc`).

## What Task 1a will add next

- Playwright end-to-end test infrastructure.
- CI integration: GitHub Actions workflow that runs Playwright against a
  Redis service container (since in-memory fallback is gone, CI must provide
  Redis).
- Test fixtures.

## Out of scope for this task (intentionally untouched)

- CI workflows (closed by hotfix `c7e8adc`).
- Schema, migrations, drizzle config.
- Pricing engine.
- Any routers under `server/routers/`.
- Any client code.
- Agent tool implementations.
- The `InMemoryBlocklist` class in `tokenBlocklist.ts` and the `memoryStore`
  `Map` in `pkceStore.ts` — preserved per the task's "only the connection
  acquisition changes" instruction. They are effectively unreachable under the
  shared singleton's queue-through-reconnect semantics, but removing them is a
  separate scope call for a future task.
