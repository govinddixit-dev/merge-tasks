## MergeTasks — Contribution Plan (Enhancements, Pending Work & Infrastructure)

### Purpose
This document summarizes what we can contribute to the current MergeTasks project: observed gaps, high‑impact enhancements, a phased delivery plan, **how server-side infrastructure should be shaped** for reliability and fault tolerance, and **what still has to be done**—including a digest of open items from [`todo.md`](../todo.md). It is written for client review and prioritization.

---

## Executive Summary
We will focus on **maintainability**, **scalability**, and **operational reliability**. The work spans product engineering and **platform design**:

- **Two deployment surfaces**: a **frontend** (static React build, CDN-ready) and a **backend** (Express + tRPC API) so each layer can scale, deploy, and fail independently within clear boundaries.
- **Structured codebase**: move from ad hoc modules to **domain-oriented boundaries** (clients, proposals, stores, orders, billing, AI) with shared types and fewer cross-cutting surprises.
- **AI service maturity**: Copilot as a **LangGraph**-style service with explicit tools, memory scopes, auditability, and provider abstraction (Anthropic / Gemini / OpenAI).
- **Payments hardening**: end-to-end **Stripe Connect** and checkout validation in test mode, including webhooks and failure cases, before any production money movement.
- **Delivery discipline**: **container images**, **CI/CD**, automated checks, and **health-based rollouts** so releases are repeatable rather than “works on my machine.”
- **Infrastructure posture**: load-balanced API instances, resilient data layers (MySQL + Redis), background work isolated from request path, observability, backups, and failure modes that **degrade gracefully** instead of taking the whole product offline.

Together, these items reduce incident frequency, shorten recovery time, and make it safe to grow traffic and team size.

---

## Key Contribution Items

### 1) Two-server architecture (frontend + backend)
- **Frontend**: serve the Vite production build from object storage + **CDN** (or a minimal static host). Versioned assets, long cache headers for hashed files, short TTL for `index.html` so deployments propagate predictably.
- **Backend**: one or more **stateless API** processes (containers) behind a load balancer. Session or auth state should not depend on “sticky” single-server memory unless explicitly designed (prefer signed cookies / centralized session store if needed).
- **Contract**: keep the **tRPC / HTTP API** stable; the UI should only talk to documented endpoints. That separation is what allows independent scaling and rolling deploys.

### 2) Unstructured code → structured code
- Consistent **folder and module conventions** per domain.
- **Shared types and validation** at boundaries (API inputs, DB shapes exposed to the client).
- **Lower coupling** between routers, services, and UI so changes are localized and testable.

### 3) AI service (Copilot on LangGraph)
- Explicit **tool contracts** and permission boundaries (per org / user).
- **Durable or checkpointed flows** where multi-step Copilot actions must not half-complete silently.
- **Provider abstraction** and observability (which model answered, rate limits, fallbacks).

### 4) Payment gateway validation (Stripe)
- **Test-mode E2E**: Connect onboarding, checkout, webhooks, idempotent handling, and explicit handling of **test vs live** keys.
- **Dashboard prerequisites** (e.g. Connect platform responsibilities) documented and verified in UI or runbooks.

### 5) Deployment: Docker + CI/CD
- **Images** built in CI from pinned bases; same artifact promoted across environments.
- **Gates**: typecheck, tests, lint, security scans as appropriate; **smoke tests** after deploy.
- **Environment separation**: dev / staging / prod with different secrets and URLs—never share OAuth redirect URIs or DB endpoints by accident.

---

## Enhancements (High Impact)

### Environment & configuration
- Separate **local / staging / production** configuration; guard rails against production URLs or keys in dev.
- **Startup validation** of required env vars for each environment tier (fail fast with a clear message).

### Architecture & modularity
- Clear **domain modules**: Clients, Proposals, Stores, Orders, Billing, AI.
- **Feature flags** for optional integrations (Stripe, LLM providers, email) so a missing key yields a controlled UX instead of opaque 500s.

### AI Copilot reliability & cost
- Short-TTL **Redis-backed caching** for hot context where safe.
- **Metrics and logs** for provider choice, latency, and errors; budget alerts where providers bill per token.

### Payments (Stripe)
- Operator **checklist** for Connect setup, webhook delivery, and mode alignment.
- **Webhook testing** and replay tooling for incident response.

### DevOps & delivery
- Compose or Helm-style definitions with **healthchecks** and **dependency ordering** (database and Redis ready before app).
- **Rollback strategy** tied to health checks and previous known-good image.

---

## Server-side infrastructure: reliability & fault tolerance

This section describes **how we should set up the server side** so MergeTasks stays available, recoverable, and predictable under failure. It applies whether you run on a single cloud region or expand later; the principles stay the same.

### 1) Logical topology
A production-shaped deployment should separate concerns as follows:

| Layer | Role | Fault-tolerance notes |
|--------|------|------------------------|
| **Edge / CDN** | Serves static frontend assets, TLS termination optional at edge | CDN absorbs traffic spikes; origin shielding reduces load on app origins. |
| **Load balancer** | Distributes traffic to API replicas | Health checks remove bad instances; supports zero-downtime rolling updates. |
| **API (stateless)** | Express + tRPC, horizontal scale | No required local disk; scale out N instances; configure **graceful shutdown** so in-flight requests finish on SIGTERM. |
| **Worker(s)** | Bull/queue consumers, cron-like jobs | Isolates heavy or slow work from user-facing latency; can be scaled independently; failures retry with backoff. |
| **MySQL** | Primary transactional store | Backups + restore drills; consider managed DB with automatic failover for production. |
| **Redis** | Cache, queues, sessions if used | Treat as **ephemeral** unless persistence is configured; for HA use managed Redis or Sentinel/Cluster patterns. |

The **frontend does not call MySQL directly**; only the **backend** (and workers) hold database credentials. That boundary is critical for security and for scaling each tier independently.

### 2) High availability for application processes
- Run **at least two API replicas** behind a load balancer in production. A single container is a single point of failure.
- Expose **liveness** and **readiness** separately where possible: *liveness* (“process up”) vs *readiness* (“can serve traffic”—DB and Redis reachable). The stack already supports a readiness-style path (`/ready` in Compose); the same idea should gate traffic in orchestrators (Kubernetes readiness probes, or LB health checks).
- Configure **timeouts** at the load balancer and **keep-alive** to the upstream so idle connections do not wedge the pool.
- Use **graceful shutdown**: on deploy, stop sending new requests to an instance, wait for in-flight work up to a bounded time, then exit. This avoids cutting off uploads or long tRPC calls.

### 3) Data layer: MySQL
- Use a **managed relational database** in production when feasible (automated patching, storage growth, failover). If self-managed, plan **primary + standby** and rehearsed **failover**.
- **Automated backups**: daily (or more frequent) snapshots plus **point-in-time recovery** where the provider supports it. **Test restores** quarterly; an untested backup is not a backup.
- **Connection pooling** at the app (or PgBouncer-style proxy if introduced later): cap connections per instance so N replicas do not exhaust `max_connections`.
- **Migrations**: run schema changes in a **controlled window** or with backward-compatible steps so old and new API versions can coexist during rolling deploys (expand/contract pattern for risky changes).

### 4) Redis (cache & queues)
- Decide whether Redis is **cache-only** or **durable queue** metadata: if queues must survive Redis restart, enable **AOF/RDB** or use a managed tier with persistence SLAs.
- For **high availability**, prefer managed Redis with replication; for self-hosted, plan **Sentinel** or clustered topology—never a lone instance for production-critical queues without accepting data loss on failure.
- Set **memory policies** explicitly (`noeviction` for queues is common; cache tiers may use `allkeys-lru`). Misaligned policy causes subtle job loss or OOM kills.

### 5) Background work & Stripe webhooks
- **Webhooks** (Stripe and others) should be **idempotent**: store event IDs and ack duplicates safely.
- Process webhooks in **workers** when possible so the HTTP handler returns quickly and retries are handled by the queue.
- **Dead-letter queues** or failed-job visibility for operations to replay or fix data without silent loss.

### 6) External dependencies (LLM, email, OAuth)
- **Timeouts and circuit breakers** on outbound HTTP to Anthropic, Gemini, Resend, etc., so a slow provider does not hold threads indefinitely.
- **Fallbacks** only where product-safe; otherwise return a clear **degraded** message (“Copilot temporarily unavailable”) instead of cascading failures.
- **Rate limiting** at the edge or API for expensive routes (AI, exports) to protect cost and stability.

### 7) Observability & operations
- **Structured logging** (JSON) with **request IDs** propagated from the load balancer through tRPC handlers.
- **Metrics**: request rate, error rate, latency percentiles, queue depth, DB connection pool usage, Redis memory.
- **Alerting** on SLOs: e.g. error rate > threshold, readiness failures, disk or replication lag on MySQL.
- **Tracing** (optional but valuable) for diagnosing slow multi-hop requests, especially when AI tools call the DB.

### 8) Security & secrets (foundation of reliability)
- **Secrets** in a vault or cloud secret manager—not only environment variables checked into compose files in prod.
- **TLS** end-to-end for public endpoints; rotate **session** and **encryption** keys on a documented schedule.
- **Least privilege** DB users for app vs migration jobs.

---

## What still has to be done

Granular tasks with checkboxes live in **[`todo.md`](../todo.md)** at the repository root. That file is the **authoritative backlog**; the lists below summarize **open `[ ]` items** and handoff priorities so this plan stays readable. When in doubt, reconcile against `todo.md`.

### Immediate environment & go-live checks
These align with “close before handoff” even when feature code exists:
- Stripe payment gateway **E2E testing** (keys, webhooks, Connect platform requirements, test vs live mode).
- **OAuth redirect URIs** for the real public base URL (Google / Microsoft); distributor **Microsoft app registration** secrets where still outstanding in the backlog.
- **AI providers**: valid keys, quotas, and model availability per environment.
- **Email**: verified sending domain (e.g. Resend) for production-style delivery; **Gmail / Outlook** “send via connected account” paths remain **credential-dependent** in `todo.md` (Google Cloud Console, Azure AD).

### Billing & subscriptions (blocked on live Stripe / policy)
- **Gate premium features** behind subscription tier (blocked: live Stripe setup in backlog).
- **Payment processing** for proposal sends or store creation (same blocker in backlog).

### Email security & provider completion (deferred in backlog)
- **Gmail API** and **Outlook Graph** send using stored OAuth tokens (blocked on user/provider console setup).
- **AES encryption** for email tokens at rest (noted as production hardening / deferred).
- **Gmail/Outlook connection** UX: redirect code ready; needs `GMAIL_*` / `OUTLOOK_*` secrets where not yet supplied.

### Product catalog & curation (open catalog-quality work)
- **Delete / dedupe / enrich** catalog items (duplicate demo rows, duplicate SKUs, full descriptions, `basePrice`, real images on CDN, **3–5 complete products per category** across apparel, drinkware, tech, bags, office, wellness, outdoor, print/other—as tracked in the backlog).

### White-label, IT readiness, storefront branding
- **IT Readiness Packet**: white-label to distributor (logo/name vs MergeTasks branding); settings surface for distributor identity where still open.
- **Store footer**: “Powered by [Distributor Name]” instead of MergeTasks (backlog).
- **Live storefront**: further polish so it reads as a **professionally designed e-commerce** experience “out of the box” (explicit open item in backlog).

### Client portal, Create Store wizard, print roadmap
- **Create Store wizard**: access-control step (allowed domains/emails); **RBAC** configuration (roles and spending limits per role)—still open in backlog.
- **Print portal**: print-on-demand product type and fields; catalog/store UX; **client artwork upload**; **proofing/approval flow** for print orders through production (large unchecked block in `todo.md` §81–82).

### AI storefront copy automation (backend + UX)
- **`stores.aiOptimize`** (or equivalent) procedure, schema fields if missing, auto-trigger on create, manual **“AI Optimize”** on store management, and surfacing generated **tagline / descriptions** on the live storefront and category cards (open checklist in backlog §61).

### Clients, proposals, search, 3D
- **Clients page**: **virtual proofs** tab/section in client detail slide-over; **server-side search** (and pagination/debounce) for clients—and the same pattern for products and orders in backlog §72, §85.
- **3D product viewer**: move toward **Three.js** (or equivalent) with zoom, reset, artwork on model (backlog §73, §84).
- **Proposal workflow**: proof status refresh when returning from proofing studio; **Preview step** prominence polish (backlog §74).

### Auth & reliability bugs
- **2FA on distributor sign-in**: investigate/fix verification loop or failure (`todo.md` §78—still open).

### Marketing & content (non-product)
- **New Instagram Reel** (Gemini-style montage) — creative deliverable, still unchecked in backlog.

### Platform / engineering follow-ups (from audits, not all in `todo.md`)
These are **codebase or architecture** items worth tracking beside `todo.md`:
- **BullMQ**: connection exists; **real queues/workers** registration still marked for a later phase (`TODO(Phase 8)` in queue bootstrap).
- **Redis**: optional **caching** for hot dashboard/insights queries called out in server code.
- **Drizzle `relations.ts`**: still empty; joins remain manual.
- **Estimates**: legacy JSON line-item path; **estimate-builder** migration called out in router comments.

---

## Why These Gaps Matter (Impact)

**Mixed environments** invite OAuth redirect mismatches, wrong databases, and Stripe mode confusion—bugs that look “random” and burn hours of support time.

**Optional integrations without gating** turn configuration mistakes into **500 errors** and block onboarding; feature flags and clear UI states fix that class of incident.

**Copilot without structured state** risks inconsistent tools, weak audit trails, and expensive repeated database work; LangGraph-style flows narrow that risk.

**Untested payments** mean go-live surprises despite a polished UI; webhooks and Connect settings must be proven in test mode.

**Weak deploy and infra discipline** produces non-reproducible releases and long outages; containers, CI/CD, health checks, and the data-layer practices above directly address that.

---

## Known Bugs & Loopholes (Full Codebase Audit)

The items below were found through a systematic read-only audit of the entire server and client codebase. They are grouped by severity.

### Critical — fix before production

| # | Bug | Location |
|---|-----|----------|
| 1 | **Open redirect in password-reset emails** — `origin` parameter is user-controlled with no allowlist; an attacker can craft reset/invite links pointing to a malicious domain, stealing password-set tokens. | `storeUserProvisioningAuth.ts` ~313–366, `storeUserProvisioningHelpers.ts` ~208–209 |
| 2 | **Public order double-submit race condition** — transaction commits and releases the `FOR UPDATE` lock *before* inserting the order and setting the proposal to `accepted`; two concurrent submits can both pass the "not accepted" check and create duplicate orders. | `publicProposalOrderItems.ts` ~332–434 |
| 3 | **Client-supplied `unitPrice` trusted on public order routes** — no server-side recomputation from catalog pricing; buyers can manipulate prices on POST/PUT/bulk paths. | `publicProposalOrderItems.ts` ~55–96, ~143–150 |
| 4 | **`clientPricing` mutations have no org/tenant scope** — any authenticated user can read/write pricing for arbitrary `clientId`/`productId` across tenants (cross-tenant data breach). | `clientPricing.ts` ~68–119, ~126–137, ~222–228, ~560–582 |
| 5 | **Stripe webhook idempotency is fragile** — uses a ~2 s time-window heuristic; on idempotency-insert failure it logs a warning and falls through, explicitly allowing duplicate processing of the same event. | `webhook.ts` ~74–102 |

### High severity

| # | Bug | Location |
|---|-----|----------|
| 6 | **`viewToken` leaked to all POC sessions** — `storePortalProposals.list` returns bearer-equivalent proposal view tokens to every POC login, giving broad secret exposure if a POC account is compromised. | `storePortalProposals.ts` ~77–98 |
| 7 | **Proposal status transitions unguarded** — webhook and public submit set status to `accepted` without checking prior state; a `draft`, `declined`, or `expired` proposal can jump directly to accepted. | `webhook.ts` ~139–144, ~584–638; `publicProposalOrderItems.ts` ~431 |
| 8 | **`orders.create` trusts client-supplied financial values** — `subtotal`, `total`, per-line `unitPrice` and `totalPrice` all accepted from caller without server-side recomputation. | `orders.ts` ~99–171 |
| 9 | **Invoice can be marked fulfilled without payment** — allows `status === "sent"` (unpaid) invoices to be fulfilled alongside `paid` ones. | `fulfillment.ts` ~60–66 |
| 10 | **HTML injection in email and PDF templates** — product names, client fields, notes, logo URLs interpolated into HTML without escaping across multiple templates (proposal accepted email, fulfillment email, proposal version PDF). | `proposalAcceptedEmail.ts` ~47–61, `fulfillment.ts` ~139–147, `proposalsVersions.ts` ~100–204 |
| 11 | **File upload: no content-type allowlist** — `storeMedia.upload` accepts any `fileType` from the caller and passes it to S3; executable or polyglot files can be stored and served. | `storeMedia.ts` ~90–102 |
| 12 | **`clientPricing.saveConfig` not transactional** — performs delete-then-reinsert of tiers/upcharges/decoration across separate awaits without `db.transaction`; mid-flight failure leaves partial pricing data. | `clientPricing.ts` ~126–217 |

### Medium severity

| # | Bug | Location |
|---|-----|----------|
| 13 | **`approveOrder`/`denyOrder` succeed on zero rows** — input uses `z.string()` then `Number(input.orderId)`; invalid IDs yield `NaN`, update matches nothing, but handler still returns `{ success: true }`. | `storePortal.ts` ~222–246 |
| 14 | **Order status allows any transition** — no state machine enforcement; `pending` can jump straight to `delivered` in a single call. | `orders.ts` ~196–219 |
| 15 | **Proposal `create` can set `status: "sent"` directly** — bypasses send workflow (email dispatch, viewToken generation, department approval setup). | `proposalsCrud.ts` ~207–297 |
| 16 | **Org invite token returns data after acceptance** — `getInviteByToken` does not check `inviteAcceptedAt`; an accepted token can keep returning org name, email, and role (information disclosure). | `organizations.ts` ~501–524 |
| 17 | **`quantity` parsed with `parseInt` without NaN/min check** — invalid values can write `NaN` into the database. | `publicProposalOrderItems.ts` |
| 18 | **Stripe checkout amount not compared to server totals** — payment amount is not validated against the server-calculated proposal/order total; under-payment could still trigger acceptance if metadata matches. | `webhook.ts` ~139–200 |
| 19 | **Proposal delete orphans orders** — FK is `ON DELETE SET NULL`; orders lose their proposal link silently instead of being cleaned up or blocked. | `proposalsCrud.ts` ~446–503 |
| 20 | **Global AI assistant messages persist across logouts** — module-level `persistedMessages` is not cleared on logout; next user on the same tab sees the previous user's AI thread. | `GlobalAIAssistant.tsx` ~65–66 |
| 21 | **TanStack Query cache not cleared on logout** — stale data from the previous session can flash briefly for the next user before refetch/errors occur. | `useAuth.ts` ~21–41 |

### Low / UX / Performance

| # | Bug | Location |
|---|-----|----------|
| 22 | **Uncleared `setInterval` on unmount** — intervals created for AI animation, curation sync/mockup, deploy animation, and import sync are never cleared if the user navigates away mid-flow (memory leak, stale state updates). | `Proposals.tsx` ~231–238, `Curation.tsx` ~161–170 & ~346–351, `CreateWebstore.tsx` ~371–382, `CurationImportModal.tsx` ~659 |
| 23 | **Google Maps instance not disposed on unmount** — `Map.tsx` creates the instance without cleanup; leak risk when leaving the route. | `Map.tsx` ~162–164 |
| 24 | **StoreCheckoutPage branch default runs once** — if branch data arrives after mount, the default shipping branch stays wrong. | `StoreCheckoutPage.tsx` ~89–95 |
| 25 | **LiveStore cart listener re-registered on every cart change** — effect depends on `[cart]` instead of a stable ref; performance churn. | `LiveStore.tsx` ~199–230 |
| 26 | **No list virtualization** — large catalogs, client tables, and agent inbox render the full DOM; will degrade with data growth. | Multiple pages |
| 27 | **Artificial 400ms skeleton delay** — store products page adds fake loading time even when data is already available. | `StoreProductsPage.tsx` ~72–76 |
| 28 | **`(trpc as any)` in QuickBooksPanel** — bypasses typed router contracts; runtime drift hidden by optional chaining. | `QuickBooksPanel.tsx` ~34, ~69, ~84 |
| 29 | **Missing `aria-label` on icon-only buttons** — AI launcher button, mobile sidebar close button, and various icon controls have no accessible name. | `GlobalAIAssistant.tsx`, `Sidebar.tsx` |
| 30 | **Empty `alt=""` on meaningful images** — proposal product thumbnails, store logos, and order line-item images across public views carry meaning but have blank alt text. | `ProposalDetail.tsx`, `OrderSummary.tsx`, `EditModePanel.tsx`, `ProductDetail.tsx`, `StripeCheckout.tsx`, `StoreFooter.tsx` |
| 31 | **`CartContext.tsx` is dead code** — `CartProvider` / `useCart` are defined but never imported anywhere; live store uses its own cart via `LiveStore` + localStorage. | `contexts/CartContext.tsx` |
| 32 | **Rate limiting skipped for localhost** — fine for dev but must not apply in production if traffic routes through a reverse proxy that appears as `127.0.0.1`. | `rateLimitMiddleware.ts` ~25–28 |
| 33 | **`demoSkip2FA` bypasses all 2FA** — full session issued without verification when flag is on; dangerous if enabled outside local development. | `onboarding.ts` ~232–241 |

---

## Proposed Delivery Plan (Phased)
1. **Stabilize dev and baseline ops**: environment separation, containerized local/staging parity, `/ready` and logging conventions, basic dashboards.
2. **Payments validation**: Stripe Connect, checkout, webhooks, idempotency, and failure drills in test mode.
3. **AI service hardening**: LangGraph-oriented Copilot, tool contracts, observability, cost guards.
4. **Scale-out readiness**: multiple API replicas behind LB, production MySQL/Redis posture (managed or HA), worker isolation, runbooks and backup restore tests.
5. **Service extraction (optional)**: define boundaries and extract the first independently deployable service (e.g. AI or billing) **behind stable HTTP APIs** when traffic or team boundaries justify it—without blocking earlier reliability work.

---

