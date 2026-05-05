# PCI Gaps Audit — Changelog

**Date**: April 7, 2026
**Audit Cycle**: 5 of 5 (Final)
**Compiler Status**: Zero TypeScript errors

---

## Summary

This audit addressed 7 PCI DSS v4.0 compliance gaps identified during the PCI Gaps review. All 7 items have been resolved. The codebase now compiles cleanly with zero TypeScript errors.

---

## Fixes Applied

### 1. Remove `demoCode` Leak from API Response
**PCI Ref**: Req 8.2 — No authentication bypass mechanisms
**Files Changed**: `server/routers/storeAuth.ts`
**What**: The `requestLogin` endpoint previously returned a `demoCode` field in the API response for demo/POC mode. This leaked the OTP code to the client, bypassing the need to check email. Removed the `demoCode` field from all API responses.

### 2. Delete `pocLogin` Authentication Bypass Endpoint
**PCI Ref**: Req 8.2 — No authentication bypass mechanisms
**Files Changed**: `server/routers/storeAuth.ts`, `client/src/pages/webstore/StoreLoginPage.tsx`
**What**: The `pocLogin` tRPC endpoint allowed anyone to create a fully authenticated store session with any email and any role, with zero verification. This was a complete authentication bypass. Deleted the endpoint from the server and removed all client-side references (POC/Demo tab, role selector, demo code display, handlePocLogin function).

### 3. Password Minimum 12 Characters + Complexity
**PCI Ref**: Req 8.3.6 — Minimum password complexity
**Files Changed**:
- `server/utils/passwordPolicy.ts` (NEW) — Shared validation utility
- `server/routers/onboarding.ts` — Platform signUp now requires 12+ chars with complexity
- `server/routers/storeUserProvisioning.ts` — Store setPassword now requires 12+ chars with complexity
- `client/src/pages/SignUp.tsx` — Updated strength meter, validation, placeholder text
- `client/src/pages/webstore/SetPasswordPage.tsx` — Updated validation, placeholder, disabled state

**Policy**: Minimum 12 characters, must include at least one uppercase letter, one lowercase letter, one digit, and one special character.

### 4. Per-Account Lockout After 10 Failed Attempts
**PCI Ref**: Req 8.1.6 — Account lockout after repeated failures
**Files Changed**:
- `server/utils/accountLockout.ts` (NEW) — Shared lockout constants and helpers
- `drizzle/schema.ts` — Added `failedLoginAttempts` (INT) and `lockedUntil` (TIMESTAMP) columns to both `users` and `storeUsers` tables
- `drizzle/0029_pci_lockout_and_audit_fix.sql` (NEW) — Migration for new columns
- `server/routers/onboarding.ts` — Platform signIn checks lockout, increments on failure, resets on success
- `server/routers/storeUserProvisioning.ts` — Store passwordLogin checks lockout, increments on failure, resets on success

**Behavior**: After 10 consecutive failed password attempts, the account is locked for 30 minutes. Successful login resets the counter. Locked accounts receive a clear error message with the lockout duration.

### 5. Hash OTP Codes with SHA-256 Before Storing
**PCI Ref**: Req 8.3.2 — Authentication factors stored securely
**Files Changed**:
- `server/utils/otpHash.ts` (NEW) — SHA-256 hashing utility for OTP codes
- `drizzle/schema.ts` — Widened `code` columns from VARCHAR(6) to VARCHAR(64) for SHA-256 hex hashes
- `drizzle/0029_pci_lockout_and_audit_fix.sql` — Migration to widen columns
- `server/routers/onboarding.ts` — signUp, signIn, resendCode store hashed codes; verify2FA compares hashes
- `server/routers/storeAuth.ts` — requestLogin stores hashed code; verifyCode compares hashes

**Behavior**: The plaintext 6-digit code is sent via email. Only the SHA-256 hash is stored in the database. On verification, the submitted code is hashed and compared to the stored hash.

### 6. Fix `audit_log` Timestamp from VARCHAR to DATETIME(3)
**PCI Ref**: Req 10.2 — Proper temporal audit trail
**Files Changed**:
- `drizzle/0029_pci_lockout_and_audit_fix.sql` — Migration converts VARCHAR(30) → DATETIME(3) with data migration
- `server/utils/auditLog.ts` — Updated `persistToDb` to pass `Date` object instead of ISO string

**Behavior**: The `audit_log.timestamp` column is now a proper MySQL DATETIME(3) with millisecond precision, enabling temporal queries, range scans, and proper indexing. Existing VARCHAR data is migrated via STR_TO_DATE.

### 7. Wire Data Retention Cleanup into Server Startup
**PCI Ref**: Data minimization / Req 10.7 retention compliance
**Files Changed**:
- `server/jobs/dataRetentionCleanup.ts` — Refactored from standalone script to exportable module with `scheduleDataRetentionCleanup()` function
- `server/_core/index.ts` — Imports and calls `scheduleDataRetentionCleanup()` after server starts listening

**Behavior**: Cleanup runs automatically every 6 hours (first run 30 seconds after startup). Removes expired verification codes, expired store verification codes, expired password tokens, read notifications older than 90 days, unread notifications older than 365 days, and expired approval tokens. Also fixed SQL table/column names to match actual Drizzle schema (`storeVerificationCodes` not `storeAuthCodes`, `notifRead`/`notifCreatedAt` not `read`/`notifCreatedAt`).

---

## New Files Created

| File | Purpose |
|------|---------|
| `server/utils/passwordPolicy.ts` | Shared 12-char + complexity password validation |
| `server/utils/accountLockout.ts` | Shared lockout constants and helpers (10 attempts, 30 min) |
| `server/utils/otpHash.ts` | SHA-256 OTP hashing utility |
| `drizzle/0029_pci_lockout_and_audit_fix.sql` | Migration: lockout columns, OTP column widening, audit_log timestamp fix |

---

## Migration Instructions

Run migration `0029_pci_lockout_and_audit_fix.sql` against the production database before deploying this version:

```bash
mysql -u root -p mergetasks < drizzle/0029_pci_lockout_and_audit_fix.sql
```

This migration:
1. Adds `failedLoginAttempts` and `lockedUntil` columns to `users` and `storeUsers`
2. Widens `verificationCodes.code` and `storeVerificationCodes.code` from VARCHAR(6) to VARCHAR(64)
3. Converts `audit_log.timestamp` from VARCHAR(30) to DATETIME(3) with data migration

---

## Cumulative Audit Summary (All 5 Cycles)

| Audit Cycle | Fixes | Key Areas |
|-------------|-------|-----------|
| Senior Code Review | 13 | AES-256-GCM encryption, FK constraints, CSRF, JWT rotation, rate limiting |
| PCI/SSL Audit | 7 | CSP nonces, MySQL TLS, HTTPS TLS 1.2+, audit logging, Redis rate limiter |
| Production Readiness | 8 | False badge removal, plan limits, account deletion, data export, store features |
| Developer Punch List | 15 | CSRF race fix, Redis enforcement, SQL filtering, trust proxy, DB health checks |
| **PCI Gaps (this)** | **7** | **Auth bypass removal, password complexity, lockout, OTP hashing, audit fix, data retention** |
| **Total** | **50** | |

---

## Compiler Status

```
$ npx tsc --noEmit
(no output — zero errors)
```
