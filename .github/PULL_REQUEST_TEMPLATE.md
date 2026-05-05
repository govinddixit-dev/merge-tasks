# Pull Request

## Summary

<!-- 1–3 bullets: what changed and why -->

## Test plan

- [ ] `pnpm test` passes
- [ ] `pnpm check` passes
- [ ] `pnpm build` passes

## Multi-tenant guardrail (required for any router or query change)

If this PR touches `server/routers/**` or any code that reads/writes
org-scoped data (clients, products, proposals, stores, orders, estimates,
invoices, copilot tables, refunds, purchase orders, etc.), confirm the
following:

- [ ] **Org scoping evidence:** every new procedure that reads/writes
  org-scoped data uses `getOrgScope(ctx)`, `orgProcedure`,
  `buildToolScope`, `resolveStoreSession`, or an explicit
  `<table>.organizationId` filter.
- [ ] **INSERTs stamped:** any new `INSERT` into an org-scoped table
  includes `...scope.stamp` (or sets both `userId` and `organizationId`
  explicitly).
- [ ] **Meta-test green:** `server/securityOrgScope.test.ts` passes; if
  this PR adds a router that legitimately cannot use any of the four
  scoping helpers, the file is added to `ALLOWLIST` with a one-line
  reason.
- [ ] **Cross-tenant test added** (only if this PR touches one of the
  critical routers — clients, proposals, invoices, estimates, products):
  a test that calls the procedure with org A's context and a row id
  belonging to org B and asserts NOT_FOUND.

If none of the above applies (UI-only, infra, docs, etc.), strike through
this section in the PR body.

## Risk

<!-- One sentence on blast radius. Examples: "no behavior change",
     "auth-path change — staged rollout via feature flag",
     "schema migration — requires backfill". -->
