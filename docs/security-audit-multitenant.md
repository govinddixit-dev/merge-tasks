# Multi-Tenant Security Audit

**Scope:** all tRPC procedures (`server/routers/*.ts`) and Express
routes (`server/routes/*.ts`) that read or write org-scoped data.

**Auditor:** automated review; 81 router files, 143 `organizationId`
usage sites across 15+ router files.

**Date:** 2026-04-14 (re-audit after multi-division, voice, and SSO
changes — no new critical/high findings)

## Threat model

1. **IDOR** — a logged-in user of Org A passes an `id` belonging to
   Org B and retrieves it.
2. **Missing filter** — a DB query forgets `WHERE organizationId = …`
   and returns rows from every tenant.
3. **Header spoofing** — a user sets `x-org-id` to an org they don't
   belong to.
4. **Cross-tenant write** — a mutation updates a row the caller
   doesn't own.

## Foundation (already in place)

- `server/_core/context.ts` resolves `ctx.organizationId` from the
  `x-org-id` header **only after verifying membership** via
  `orgMembers`. Spoofed headers fail closed.
- `protectedProcedure` requires an authenticated user.
- Every multi-tenant table carries an `organizationId` column; 19 of
  the core tables in `drizzle/schema.ts` reference
  `organizations.id` directly (grep confirmed: 19 FK rows).
- Query-level filtering happens in routers: 143 `organizationId`
  occurrences across routers, almost all in `WHERE` clauses or
  `INSERT ... values({ organizationId: ctx.organizationId, ... })`.

## Hardening applied in this pass

Added `orgProcedure` (`server/_core/trpc.ts`) — a middleware-wrapped
procedure that asserts `ctx.organizationId` is non-null and narrows the
type accordingly. This provides a single place to enforce the invariant
for new procedures and makes audits mechanical:

```ts
// before
someQuery: protectedProcedure.query(({ ctx }) => {
  if (!ctx.organizationId) throw ... ;  // easy to forget
  return db.select().from(X).where(eq(X.organizationId, ctx.organizationId));
});

// after
someQuery: orgProcedure.query(({ ctx }) => {
  // ctx.organizationId is typed as `number`, not `number | null`
  return db.select().from(X).where(eq(X.organizationId, ctx.organizationId));
});
```

## Findings

### No critical/high findings

Every sampled router enforces `organizationId` in its `WHERE` clauses.
Spot checks on:
- `server/routers/proposals.ts` — every query/mutation filters on
  `proposals.organizationId = ctx.organizationId`.
- `server/routers/stores.ts` / `storesCrud.ts` — stores are scoped by
  `organizationId`; `storeCheckout.ts` validates the store belongs to
  the org before any write.
- `server/routers/clients.ts`, `clientsCrud.ts`, `clientsAssets.ts` —
  all filter or explicitly join through the org.
- `server/routers/purchaseOrders.ts` — 14 `organizationId` refs; creates
  set the field from `ctx`, reads filter by it.
- `server/routers/copilotExec*.ts` — the AI tool executors use an
  explicit `copilotExecScope.ts` helper that rejects any targetId not
  visible to the current org.

### Low findings (hardening opportunities)

1. **Not using `orgProcedure` yet** — 15+ routers still use
   `protectedProcedure` with a manual `if (!ctx.organizationId)` check.
   Functionally equivalent to `orgProcedure` but easier to drift.
   *Remediation:* migrate progressively. No correctness gap today.

2. **Public store endpoints** (`server/routers/storePortal*.ts`,
   `storeCheckout.ts`) intentionally use `publicProcedure` because
   end-customers are authenticated via a separate `mt_store_<slug>`
   cookie, not the org session. These enforce scoping via the store
   slug in the URL and the store-scoped JWT — not `ctx.organizationId`.
   Verified the JWT is validated on every request and the store id is
   taken from the validated token, not user input.

3. **x-org-id fallback behavior** — when the header is missing,
   `createContext` falls back to the user's *owned* organization. A
   user who is a member (not owner) of Org B but owner of Org A will
   implicitly scope to Org A. This is safe (they're still inside an
   org they own) but could surprise UX if the client forgets to set
   the header after an org switch. *Remediation:* consider removing
   the fallback and returning FORBIDDEN — the web client already sets
   the header on every request post-login.

### Cross-tenant data leakage

No routes were found that leak cross-tenant data. Reviewed:
- Notification queries filter by `userId` (and user belongs to org)
- AI insights filter by `organizationId`
- Audit log queries filter by `organizationId` or by `userId` (user is
  already scoped)
- Export / data-export endpoints filter by `organizationId`

### IDOR surface

Procedures that accept an `id` as input (proposals, clients, stores,
orders, POs) universally pattern-match:

```ts
const [row] = await db.select()
  .from(X)
  .where(and(eq(X.id, input.id), eq(X.organizationId, ctx.organizationId)));
if (!row) throw new TRPCError({ code: "NOT_FOUND" });
```

This defeats IDOR — the row simply doesn't exist from the caller's
perspective.

### 2026-04-14 delta review

New/changed surfaces since 2026-04-13:

- **Divisions router** (`server/routers/divisions.ts`) — every
  procedure calls `assertOrgMember(db, input.organizationId,
  ctx.user.id)` before any read or write. Mutations additionally call
  `assertEnterpriseTier`. The `organizationId` is always supplied in
  the `WHERE` clause. Soft-delete via `isActive` preserves the FK
  invariant on departments.
- **Voice router** (`server/routers/voice.ts`) — uses
  `protectedProcedure`; does not read or write org-scoped tables.
  Uploaded audio is keyed under `voice/<userId>/...`, so one user
  cannot read another's audio via key guessing (S3 keys are also
  `nanoid`-randomized).
- **SSO resolver** (`server/utils/ssoUserResolver.ts`) — now enforces
  `idp.domain` match; this closes a documented-but-unenforced gap and
  does not affect org scoping.

## Residual risk

- File download endpoints in `server/routes/files.ts` validate the org
  on each request. Confirmed.
- Copilot tool execution (`copilotExecutors.ts` +
  `copilotExecScope.ts`) — the scope helper is the single source of
  truth for whether an AI-invoked operation may touch a given entity.
  Any new tool must route through it; otherwise an AI prompt-injection
  attack could attempt cross-tenant writes.

## Recommended follow-ups

1. Migrate remaining `protectedProcedure` + manual-check pairs to
   `orgProcedure` over time.
2. Consider making the `x-org-id` header required (remove the
   owned-org fallback) once the web client is guaranteed to send it.
3. Add a CI lint rule that flags `db.select().from(X).where(...)` on
   tables with `organizationId` where the predicate does not mention
   `organizationId` or does not go through a helper.
