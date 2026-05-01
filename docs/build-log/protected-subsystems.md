# Protected Subsystems — 2026 Q2 Rebuild

Subsystems listed here are **out of scope** for the webstore/pricing/imprint/supplier/curation rebuild. Do not refactor, rename, migrate, or restructure them while this rebuild is in flight. If a phase appears to require changes to anything on this list, pause and escalate to Yan before proceeding.

## Protected

1. **Auth / SSO infrastructure (Google, Microsoft OAuth)** — session correctness is load-bearing for every tenant; out-of-band changes carry unacceptable lockout risk.
2. **orgScope multi-tenancy enforcement** — the invariant that keeps tenants isolated; any regression is a security incident, not a bug.
3. **Stripe Connect billing infrastructure** — distributor-side revenue plumbing; independent lifecycle from webstore pricing.
4. **Stripe payment processing (subscriptions, Connect payouts)** — live money movement; changes require their own review track.
5. **Resend email pipeline + three-tier branding** — deliverability + sender-identity guarantees depend on this staying stable.
6. **tRPC / Drizzle / React / pm2 foundational stack** — framework/runtime upgrades are not part of this rebuild.
7. **AI copilot (existing functionality only)** — current copilot surfaces stay as-is. _Exception:_ new agentic surfaces introduced by this rebuild (pricing, curation, supplier sync) **are** in scope and should expose programmatic equivalents per the architectural principles.
8. **PDF generation pipeline** — proposals/invoices/POs render path; no changes during this rebuild.

## Resolved conditional items (historical)

Both conditional items from Phase 0 Task 5 resolution (2026-04-22) are now fully in scope for the rebuild as first-class features. They are **not** on the Protected list — they are domains the rebuild actively builds.

1. **Multi-department approval architecture** — **Resolved 2026-04-22 per Decision 37:** promoted to IN SCOPE as a first-class feature with full UX, pricing integration, approval chains, department budgets, and regression coverage. See `rebuild-2026-q2.md` Architectural Decisions entry dated 2026-04-22 (Decision 37). Integration touches Phases 1, 4, 5, 7, and 8.
2. **Multi-division webstore feature** — **Resolved 2026-04-22 per Decision 38:** promoted to IN SCOPE as a first-class feature with per-division pricing, full UX, and regression coverage. See `rebuild-2026-q2.md` Architectural Decisions entry dated 2026-04-22 (Decision 38). Integration touches Phases 1, 4, 5, 7, and 8.

### Decision-recording convention (cross-link)

Each conditional-subsystem decision is recorded in **both** files:

- **`rebuild-2026-q2.md` → Architectural Decisions** captures the reasoning: why the decision was made, tradeoffs considered, alternatives rejected.
- **`protected-subsystems.md`** (this file) captures only the final outcome: promoted to the Protected list above with a one-line reason, OR moved into scope for Phase N.

Both entries carry the **same date** and cross-reference each other by that date, e.g. "See rebuild-2026-q2.md Architectural Decisions entry dated YYYY-MM-DD" here, and "See protected-subsystems.md entry dated YYYY-MM-DD" in the build log.
