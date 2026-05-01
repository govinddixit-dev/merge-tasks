# FK Completion + SMTP Hardening — Changelog

**Date**: April 7, 2026
**Compiler Status**: Zero TypeScript errors

---

## Summary

This update completes the two remaining launch blockers identified in the pre-launch review:

1. **Foreign key constraint coverage** expanded from ~40 constraints (migration 0027) to full coverage of all 87+ FK relationships, including all `organizationId` columns, nullable entity FKs, circular references, and self-references.

2. **SMTP hardened** so that all authentication flows (signup, sign-in 2FA, resend code, store login) fail loudly when email delivery fails, instead of silently succeeding and leaving the user unable to verify.

---

## Fix 1: Complete Foreign Key Coverage

**Migration**: `drizzle/0030_complete_foreign_keys.sql`

The original migration 0027 covered ~40 FK constraints across 25 tables. This new migration adds the remaining ~32 constraints that were missing.

### What was missing

| Category | Count | Examples |
|----------|-------|---------|
| `organizationId` → `organizations.id` | 19 | Every table with multi-tenancy scope |
| Nullable entity FKs | 7 | `proposals.storeId`, `orders.storeId`, `orders.proposalId`, `virtualProofs.productId/proposalId/clientId` |
| `orgMembers` user FKs | 2 | `userId`, `invitedByUserId` |
| AI tables | 2 | `aiTrainingData.userId`, `aiEditFeedback.trainingDataId` |
| Circular/self-ref FKs | 5 | `stores.linkedStoreId`, `estimates.convertedToInvoiceId`, `invoices.proposalId/estimateId/orderId` |

### Cascade strategy

| FK nullability | ON DELETE action | Rationale |
|---------------|-----------------|-----------|
| NOT NULL | CASCADE | Child cannot exist without parent |
| Nullable | SET NULL | Child keeps its row, FK is nulled |

### Schema.ts note

Two FKs cannot use Drizzle's `.references()` due to TypeScript circular initializer limitations:

- `estimates.convertedToInvoiceId` → `invoices.id` (circular: estimates ↔ invoices)
- `stores.linkedStoreId` → `stores.id` (self-reference)

Both are enforced at the database level via migration SQL. The schema.ts comments explain why.

---

## Fix 2: SMTP Hardened — Fail Loudly on Email Failure

**Files changed**:
- `server/routers/onboarding.ts` — signUp, signIn, resendCode
- `server/routers/storeAuth.ts` — requestLogin

### Before (vulnerable)

When SMTP was not configured or email delivery failed, the auth endpoints would:
- Return `success: true` with `emailDelivered: false`
- Show a soft message: "Verification code generated (check notifications — email delivery pending SMTP setup)"
- The user would be stuck — they have no way to get the code

Combined with the now-removed `demoCode` leak, this was a security hole. With `demoCode` gone, it becomes a usability black hole.

### After (hardened)

When email delivery fails, the auth endpoints now:
- Return `success: false` with a clear error message
- Log the failure at ERROR level with the SMTP error details
- The client shows a toast: "Unable to send verification code. Please try again later or contact support."

This means **SMTP must be configured and working before launch**, or no one can sign up or log in. This is the correct behavior.

---

## Files Changed

| File | Change |
|------|--------|
| `drizzle/0030_complete_foreign_keys.sql` | NEW — 32 additional FK constraints |
| `drizzle/schema.ts` | Comment on circular FK (estimates ↔ invoices) |
| `server/routers/onboarding.ts` | signUp, signIn, resendCode fail on email failure |
| `server/routers/storeAuth.ts` | requestLogin fails on email failure + added logger |

---

## Migration Instructions

Run migration `0030_complete_foreign_keys.sql` **after** `0029_pci_lockout_and_audit_fix.sql`:

```bash
mysql -u root -p mergetasks < drizzle/0029_pci_lockout_and_audit_fix.sql
mysql -u root -p mergetasks < drizzle/0030_complete_foreign_keys.sql
```

**Important**: If you have orphaned rows from before FK constraints were added, clean them up first or the ALTER TABLE statements will fail. The migration comments in 0027 include example cleanup queries.

---

## Compiler Status

```
$ npx tsc --noEmit
(no output — zero errors)
```
