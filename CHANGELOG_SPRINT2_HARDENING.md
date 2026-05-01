# Sprint 2 — Operational Hardening Changelog

**Date**: April 7, 2026
**Compiler Status**: Zero TypeScript errors

---

## Summary

Four operational improvements built while waiting for OVH deployment. None were launch blockers, but all reduce risk and improve incident response capability for a production system.

---

## 1. JWT Session Revocation (Token Blocklist)

**Problem**: JWTs are stateless. If a distributor's account is compromised, there was no way to force-invalidate their active sessions. Access tokens lived for 15 minutes regardless, refresh tokens for 7 days.

**Solution**: A pluggable token blocklist that supports both single-token revocation and per-user bulk revocation ("logout all devices").

### Architecture

| Component | File | Purpose |
|-----------|------|---------|
| Blocklist backend | `server/utils/tokenBlocklist.ts` | Redis or in-memory store for revoked token JTIs and per-user revocation timestamps |
| Token creation | `server/_core/sdk.ts` | Every JWT now includes a `jti` (JWT ID) claim and `iat` (issued-at) for revocation checks |
| Auth middleware | `server/_core/sdk.ts` | `authenticateRequest()` checks the blocklist before accepting any token |
| Logout all | `server/routers.ts` | New `auth.logoutAll` mutation revokes all sessions for the current user |

### How it works

Every token now carries a unique `jti` claim. On each authenticated request, the auth middleware checks two things:

1. **Individual JTI check** — is this specific token in the blocklist? (single-session revocation)
2. **Per-user timestamp check** — was this token issued before the user's "revoked-before" timestamp? (bulk revocation)

If either check fails, the request is rejected with "Session has been revoked."

### Failure mode

If the blocklist backend (Redis) is unreachable, the check is skipped and the request is allowed through. This prevents a Redis outage from causing a total auth outage. The failure is logged at ERROR level for alerting.

### New API

```typescript
// Client-side: logout all devices
const result = await trpc.auth.logoutAll.mutate();
// → { success: true, message: "All sessions have been revoked..." }
```

### Redis keys

| Key pattern | TTL | Purpose |
|-------------|-----|---------|
| `bl:tok:{jti}` | Token's remaining lifetime | Single-token revocation |
| `bl:user:{openId}` | 7 days (max token lifetime) | Per-user bulk revocation |

---

## 2. Comprehensive `.env.example`

**Problem**: The existing `.env.example` was missing several variables (`REDIS_URL` was commented out, `ALLOW_MEMORY_RATE_LIMIT` absent, `VITE_SENTRY_DSN` absent, `ASI_API_KEY` absent, S3 variables absent), and had no indication of which variables were required vs. optional.

**Solution**: Updated `.env.example` with every variable the system uses, clearly marked as `[REQUIRED]`, `[REQUIRED IN PROD]`, or `[OPTIONAL]`. Added explicit warning that SMTP must work before launch (login is hard-blocked on email failure).

### Variables added

| Variable | Status | Purpose |
|----------|--------|---------|
| `REDIS_URL` | Required in prod | Session revocation + persistent rate limiting |
| `ALLOW_MEMORY_RATE_LIMIT` | Optional | Temporary escape hatch for initial setup |
| `VITE_SENTRY_DSN` | Optional | Client-side error tracking |
| `ASI_API_KEY` | Optional | ASI product search |
| `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Optional | File storage |

---

## 3. Health Check Endpoint

**Problem**: No way to detect a server that's running but can't reach MySQL or Redis. PM2 restarts crashes but can't detect degraded state.

**Solution**: Express `/health` endpoint (outside tRPC, no auth, no CSRF) that pings the database and Redis and returns 200 or 503.

### Response format

```json
// 200 OK
{
  "status": "healthy",
  "timestamp": "2026-04-07T17:30:00.000Z",
  "checks": {
    "server": true,
    "database": true,
    "redis": true
  }
}

// 503 Service Unavailable
{
  "status": "degraded",
  "timestamp": "2026-04-07T17:30:00.000Z",
  "checks": {
    "server": true,
    "database": false,
    "redis": true
  }
}
```

### Monitoring setup

Point any uptime monitor (UptimeRobot, Pingdom, or a simple cron curl) at `https://app.yourdomain.com/health`. Alert on non-200 responses.

---

## 4. Rate Limiting on Public Store Routes

**Problem**: The public storefront endpoints (`getBySlug`, product listings, checkout) had no rate limiting. A bot or competitor could hammer these aggressively, causing cost and availability issues.

**Solution**: Applied the existing `rateLimited` middleware to all public store-facing tRPC procedures.

### Rate limits applied

| Endpoint | Limit | Window | Rationale |
|----------|-------|--------|-----------|
| `stores.getBySlug` | 60 req | 1 min | Product browsing — generous for real users, blocks scrapers |
| `storeCheckout.createSession` | 10 req | 15 min | Checkout creation — prevents cart-bombing |
| `storeCheckout.verifySession` | 60 req | 1 min | Post-payment verification — same as browsing |

All limits are per-IP and use the same Redis/in-memory backend as the existing auth rate limiters.

---

## Files Changed

| File | Change |
|------|--------|
| `server/utils/tokenBlocklist.ts` | NEW — Redis/in-memory token blocklist |
| `server/_core/sdk.ts` | Added JTI to tokens, blocklist check on every auth request |
| `server/routers.ts` | Added `auth.logoutAll` mutation |
| `.env.example` | Comprehensive update with all variables documented |
| `server/_core/index.ts` | Added `/health` Express endpoint |
| `server/utils/rateLimiter.ts` | Added `PUBLIC_STORE_READ_LIMIT` and `PUBLIC_CHECKOUT_LIMIT` configs |
| `server/routers/stores.ts` | Rate limited `getBySlug` |
| `server/routers/storeCheckout.ts` | Rate limited `createSession` and `verifySession` |

---

## Compiler Status

```
$ npx tsc --noEmit
(no output — zero errors)
```
