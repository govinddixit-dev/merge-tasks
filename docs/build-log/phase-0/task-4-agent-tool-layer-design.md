# Phase 0 Task 4 — Agentic Tool / Action-Layer Pattern Design

**Status:** Draft for Yan review
**Author:** Phase 0 Task 4
**Date:** 2026-04-21
**Scope:** Design only — no code, no migrations, no package installs. The deliverable is this document.
**Implemented by:** Phase 8 (AI Features & Agentic Workflows) — plus every tool declared by Phases 2, 3, 4, 5, and 8 conforms to this pattern.
**Depends on:** Task 2 §4.4 (`pricing.calculate`) and Task 3 §5 (`zones.*`) — worked examples for §8.1.

---

## Section 1 — Design Overview

### 1.1 Locked decisions (restated for reference)

Four decisions are locked by Yan and govern this design.

1. **Decision 23 — Dual-protocol support.** Internal tool calls go through the native Anthropic `tool_use` / function-calling pattern (consumed by our own agents inside the MergeTasks tRPC process). External tool calls are exposed through a Model Context Protocol (MCP) server. Both surfaces invoke the same underlying implementations — the tool registry is the single source of truth; native and MCP are two adapters over it.
2. **Decision 24 — Tenant-scoped agent memory with 90-day rolling retention.** Memory is keyed by `(orgId, tenantContextKey)` where `tenantContextKey` is typically `storeId` (customer-facing agents) or `distributorUserId` (distributor-facing agents). Entries older than 90 days auto-expire. Distributors can view / edit / delete any memory entry via a Phase 8 dashboard surface. No cross-tenant leakage — `orgScope` applies to memory reads and writes. Memory lives in a new `agentMemory` table.
3. **Decision 25 — Sync/async invocation with per-tool declaration.** Every tool declares `invocation: "sync" | "async"`. Sync tools return inline (platform-default timeout applies). Async tools return a `jobId` immediately; a background worker runs the handler; results deliver via existing notification infrastructure. Async tools must declare `estimatedDurationMs` and `timeoutMs`. Default is sync; async requires per-tool justification.
4. **Decision 26 — Hybrid autonomy via per-tool risk tiers.** Every tool declares `riskTier: "autonomous" | "logged" | "approval_required"`. Autonomous tools run freely, audit-logged only. Logged tools run freely but surface a dashboard notification for user review (with a reversal action when available). Approval-required tools do not execute until a human in the same org explicitly approves via the Phase 8 dashboard. Risk tier is declared at tool-definition time and cannot be escalated at invocation.

### 1.2 What this design enables

Every domain phase (2, 3, 4, 5, 8) implements tools that conform to a single pattern: one tool interface, one registry, one execution pipeline, one memory contract, one audit log. Pricing (`pricing.calculate`), zones (`zones.*`), supplier sync, curation, webstore, and the four Phase 8 agents all share this plumbing. Protocol differences (native vs MCP) are handled by adapters, not by forking the implementation. Every phase inherits `orgScope` enforcement, risk-tier gating, approval semantics, audit trail, and memory — the phase only writes the domain-specific handler.

### 1.3 What this design does NOT do

- Does **not** build any specific agent. The four Phase 8 agents (Catalog-Change, Curation Assistant, Pricing-Draft, Customer-Service) and any copilot upgrades are out of scope for Task 4 — they are Phase 8 deliverables.
- Does **not** build the distributor-facing agent dashboard UI. That is Phase 8 (surfacing approvals, notifications, memory review, audit queries).
- Does **not** define what specific tools exist beyond what Tasks 2 and 3 have already specified. Each phase adds its own tool list when it opens.
- Does **not** redesign the existing AI copilot framework (`server/utils/agentTriggers.ts`, `agentActions.ts`, `agentCron.ts`, `copilotExec/`). The existing copilot is a protected subsystem through Phase 7 per Architectural Decision 3; Phase 8 upgrades it onto this registry. Interop rules: §8.2.
- Does **not** define the agent conversation framework — that is §7 (stub only) and Phase 8.

### 1.4 North star

**One registry. One execution pipeline. One memory contract. One audit log. MCP and native tool-use are adapters, not separate systems.**

If any future phase finds itself forking the execution pipeline for a "special case," that is a design failure — the pattern is either wrong for the case and must be extended, or the case must change. Principle #5 (every domain action has an agent-accessible programmatic equivalent) and Principle #3 (no parallel code paths) bind equally here.

---

## Section 2 — Tool Registry & Declaration

### 2.1 Tool declaration interface

Every tool in the registry implements this interface. Lives at `shared/agents/toolTypes.ts` so both the server (registry + executor) and any shared type consumers see the same shape.

```ts
// shared/agents/toolTypes.ts — Phase 8

import type { z } from "zod";

export type RiskTier = "autonomous" | "logged" | "approval_required";
export type Invocation = "sync" | "async";

export interface ToolExecutionContext {
  /** orgScope identifier — injected from the authenticated session. Never
   *  trusted from tool input; never overridable by the agent. */
  orgId: number;

  /** Tenant subcontext: storeId for customer-facing agents, distributorUserId
   *  for distributor-facing agents. Stable per conversation; used as the
   *  memory partition key and the approval-routing key. */
  tenantContextKey: string;

  /** Identifier of the agent (or copilot) invoking the tool. Free-form
   *  string in Phase 8, validated against an agent-registry enum once
   *  Phase 8 lands (§9 open question). */
  agentId: string;

  /** Stable conversation identifier (nullable for ad-hoc invocations
   *  outside a conversation, e.g., cron-fired agent actions). Present
   *  in audit-log rows but not constraining. */
  conversationId: string | null;

  /** Which adapter is invoking — "native" or "mcp". Used by the audit
   *  log to distinguish internal vs external callers and by any
   *  adapter-specific response shaping. */
  adapter: "native" | "mcp";

  /** The authenticated principal. For native: the tRPC session user.
   *  For MCP: the org-bound API token holder. Tools rarely read this
   *  directly (orgScope covers the common case), but approval-tier tools
   *  use it to attribute the proposal. */
  principal: { kind: "user"; userId: number } | { kind: "apiToken"; tokenId: number };
}

export interface AgentTool<TInput, TOutput> {
  /** Stable tool name, dotted "domain.verb". Unique across the entire
   *  registry. Registering a duplicate throws at startup. */
  name: string;

  /** One-line description for the agent's context. Shown to the LLM at
   *  every tool_use call; keep under 200 characters. */
  description: string;

  /** Longer description with examples and edge cases. Surfaced via MCP
   *  tool listing; optionally inlined by the native adapter when the
   *  agent requests tool help. */
  longDescription?: string;

  /** Zod schema — canonical source for both runtime validation and
   *  (via zod-to-json-schema) the JSON Schema the MCP adapter emits. */
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;

  /** Sync or async — determines execution path (§3). */
  invocation: Invocation;

  /** Estimated duration for async tools (ms). Omit for sync. Consumed by
   *  the Phase 8 dashboard to show a countdown and by the executor to
   *  compute the default timeout. */
  estimatedDurationMs?: number;

  /** Hard timeout for async tools. Omit for sync — sync uses a shorter
   *  platform default (5000 ms). */
  timeoutMs?: number;

  /** Risk tier — governs autonomy (§3.3). */
  riskTier: RiskTier;

  /** One-line justification for the tier, read during code review. A
   *  mis-tiered tool (e.g., "send email" marked autonomous) must be
   *  caught in PR, not production. */
  riskTierJustification: string;

  /** Attestation that the tool author has explicitly verified the handler
   *  enforces orgScope. Must be the literal `true` — no boolean flag from
   *  a runtime expression, no false. Tools with `orgScopeReviewed: false`
   *  (or missing) cannot register. TypeScript `true` literal catches most
   *  regressions at compile time. */
  orgScopeReviewed: true;

  /** Opt in to full-input retention in the audit log. Default false (only
   *  inputHash is stored, per Decision 28). When true, the validated input
   *  payload is additionally written to `agentAuditLogInputs` (§5.1.1) with
   *  a 90-day retention window. Opt-in tools MUST document the reason in a
   *  leading code comment — e.g. "pricing.calculate: retained 90 days for
   *  billing-dispute reconciliation." Reviewers challenge mis-tagged
   *  retention at code review. */
  auditRetainFullInput?: boolean;

  /** Per-tool approval expiry for `riskTier: "approval_required"` tools,
   *  in milliseconds. Default 24h (86_400_000). Hard max 7 days
   *  (604_800_000) enforced at registration — tools exceeding this throw
   *  `InvalidApprovalExpiry` at startup (Decision 33). Ignored for tools
   *  whose tier is not approval_required. */
  approvalExpiryMs?: number;

  /** Declares the tool has NO side effects (no writes, no external calls,
   *  no mutations). Consumed by the MCP adapter (Decision 29): read-scope
   *  API tokens may invoke only tools with `readOnly: true` AND
   *  `riskTier: "autonomous"`. Defaults to false (conservative). Does NOT
   *  replace riskTier — a read-only autonomous tool (e.g., pricing.calculate)
   *  is `readOnly: true, riskTier: "autonomous"`. A write tool is
   *  `readOnly: false` regardless of tier. */
  readOnly?: boolean;

  /** The actual implementation. Receives already-validated input and a
   *  resolved context. Throws `OrgScopeViolation` or domain-specific
   *  subclasses of `ToolError` on failure. */
  handler: (input: TInput, ctx: ToolExecutionContext) => Promise<TOutput>;
}
```

**Why each field is required:**

- **`name`** — stable identifier across adapters, audit log, approval records, memory references. Dotted convention makes domain grouping discoverable (§2.3).
- **`description` / `longDescription`** — the LLM's view of what the tool does. Short description is part of the main context; longer description is fetched on demand.
- **`inputSchema` / `outputSchema`** — Zod chosen as the canonical source because (a) Drizzle and tRPC elsewhere in the codebase already use Zod, (b) `zod-to-json-schema` produces the exact JSON Schema MCP needs, (c) runtime validation is the first gate in the executor pipeline.
- **`invocation`** — the executor's branch point (§3.1 vs §3.2). Making it explicit in the declaration prevents accidental long-running handlers masquerading as sync.
- **`estimatedDurationMs` / `timeoutMs`** — UX information for the dashboard and a correctness gate for the executor. An async tool with no timeout is rejected at registration.
- **`riskTier` / `riskTierJustification`** — the hybrid-autonomy contract (Decision 26). Justification forces the tool author to articulate *why* they chose the tier; code review verifies.
- **`orgScopeReviewed`** — a TypeScript-level attestation that the handler has been reviewed for multi-tenant safety. The literal-`true` type rules out boolean expressions that could evaluate false in production. Protected-subsystem #2 (orgScope) is load-bearing; this is a belt for the suspenders.
- **`auditRetainFullInput`** — per Decision 28, per-tool opt-in for full-input audit retention. Default false keeps the audit path lean and PII-safe.
- **`approvalExpiryMs`** — per Decision 33, per-tool configurable approval TTL with 7-day hard max enforced at `registry.register()` time.
- **`readOnly`** — per Decision 29, required for MCP read-scope token access. Conservative default of false means new tools have to explicitly declare themselves read-only.
- **`handler`** — the implementation. Receives validated input and a resolved context; never sees raw user input and never constructs `orgId` itself.

**Startup validation (enforced in `registry.register`):**

- `approvalExpiryMs > 7 * 24 * 60 * 60 * 1000` → throws `InvalidApprovalExpiry` (Decision 33).
- `auditRetainFullInput === true` AND handler module lacks a leading comment mentioning "retain" → CI lint warning (Decision 28).
- `readOnly === true` AND `riskTier !== "autonomous"` → throws `InvalidReadOnlyTier` (Decision 29 — read-only must be autonomous by construction).
- `invocation === "async"` AND `timeoutMs` missing → throws `AsyncToolMissingTimeout`.

### 2.2 Registry structure

- **Location:** `server/agents/toolRegistry.ts` is the central registry file.
- **Registration pattern:** each phase's tools live at `server/<domain>/agentTools.ts` and export `export const tools: AgentTool<any, any>[] = [...]`. The central registry imports from each known domain module at startup and aggregates into a single `Map<string, AgentTool>`.
- **Duplicate-name enforcement:** `registry.register(tool)` throws `DuplicateToolName` if the name already exists. The server startup sequence runs all registrations synchronously before accepting traffic — a duplicate is an immediate crash at boot, not a runtime 500.
- **Discoverability API:**

  ```ts
  registry.listTools(opts?: {
    includeAutonomousOnly?: boolean;
    includeLoggedOnly?: boolean;
    includeApprovalRequired?: boolean;
    includeForTenantContextKind?: "store" | "distributor";
    orgId: number; // always required — orgScope filter
  }): AgentTool<any, any>[];
  ```

  MCP adapter calls `listTools({ orgId })` when serving `tools/list`. Native adapter calls it with the current agent's expected tier profile. Some tools may conditionally exclude themselves (e.g., a distributor-only tool is hidden from customer agents) — the registry exposes a `visibleTo(ctx): boolean` predicate per tool (optional; defaults to "visible to everyone in the org").

- **No runtime mutation:** registry is frozen after startup (`Object.freeze` on the internal map). New tools require a redeploy. This matches the code-constants philosophy from Tasks 2 and 3 (category defaults, normalizer, compatibility table).

**Agent identifier lint (Decision 31):** `agentId` values referenced by tools, context, and table rows are free-form `varchar(64)` strings. The registry does not enforce the agent ID set — CI lint at `server/agents/agentIdentifiers.ts` does. Every `agentId` literal in the codebase must match a constant in that file; unknown values fail CI. Schema-level flexibility preserves "no migration to add an agent"; compile-time/lint checks preserve type safety where it's cheap.

### 2.3 Namespacing and versioning

- **Naming:** `<domain>.<verb>`. Domains are nouns from the data model (`pricing`, `zones`, `suppliers`, `store`, `products`, `memory`, `approvals`, `audit`). Verbs are imperative present-tense (`calculate`, `list`, `create`, `update`, `delete`, `approve`, `recall`, `remember`).
- **Versioning:** tools are not explicitly versioned in Phase 1. Breaking changes retire the old tool and introduce a new name (e.g., `pricing.calculateV2`). Old name is removed in the same PR (Principle #3 — no parallel code paths).
- **Revisit note for Phase 8:** if Phase 8 agent evaluation shows frequent schema evolution, add a semver suffix to the tool interface (`"version": "1.0.0"` inside the declaration, advertised via MCP `annotations`). Flagged in §9 Open Question 5.

---

## Section 3 — Execution Pipeline

### 3.1 Sync invocation flow

```
Agent → adapter (native | mcp) → executor → registry → handler → result
```

Step-by-step, with owning module in parentheses:

1. **Adapter receives invocation.** Native adapter (`server/agents/adapters/nativeAdapter.ts`) receives a `tool_use` block from the Claude API response loop. MCP adapter (`server/agents/adapters/mcpAdapter.ts`) receives a `tools/call` request. Both produce a common `ToolInvocation { name, rawInput, ctx }` and hand it to the executor.
2. **Executor receives invocation** (`server/agents/executor.ts`). Looks up the tool in the registry by name. Throws `ToolNotFound` if missing → adapter translates to a structured `tool_result` / MCP error.
3. **Input validation.** `tool.inputSchema.safeParse(rawInput)`. On failure: returns `ToolError("ValidationFailed", { issues })` without invoking the handler. Adapter renders to the protocol-appropriate error.
4. **Context resolution.** Executor constructs `ToolExecutionContext` from the session: `orgId`, `tenantContextKey`, `agentId`, `conversationId`, `adapter`, `principal`. `orgId` is always read from the authenticated session — never from input. Any `orgId`-shaped field present in input is ignored at this stage (Zod schemas must not declare `orgId` as a user-supplied field, or CI rejects the tool).
5. **Risk-tier gate.** If `tool.riskTier === "approval_required"`, the executor does **not** invoke the handler. It writes an `agentApprovalRequests` row and returns `ApprovalRequiredResponse { requestId, summary, expiresAt }` to the adapter. Audit log records `outcome: "approval_pending"`.
6. **Handler execution.** If `autonomous` or `logged`, `handler(validatedInput, ctx)` runs. Wrapped in a timeout (`Promise.race` against the sync default 5000 ms or `tool.timeoutMs`). Wrapped in a try/catch.
7. **Output validation.** `tool.outputSchema.safeParse(result)`. On failure: surfaces as `ToolError("OutputInvalid")` and returns a synthetic error to the agent — the handler is considered to have corrupted its contract. Audit log records `outcome: "output_invalid"`.
8. **Audit log write** (§5). Every invocation writes one row regardless of outcome — success, validation failure, orgScope violation, handler throw, output invalid, approval pending, timeout.
9. **Logged-tier side effect.** If `tool.riskTier === "logged"` and the handler succeeded, executor enqueues a dashboard notification (§3.3) after the audit row is written.
10. **Result return.** Executor returns the validated output. Adapter serializes to the protocol shape (`tool_result` for native; `tools/call` response for MCP).

**Error branches (executor return shapes):**

| Outcome | Branch | What reaches the agent |
|---|---|---|
| `success` | Handler returned valid output | Output (serialized) |
| `validation_failed` | Step 3 failed | `{ error: "ValidationFailed", issues: [...] }` |
| `orgscope_violation` | Step 4 or 6 (handler) surfaced `OrgScopeViolation` | `{ error: "OrgScopeViolation" }` — no detail leak |
| `handler_error` | Step 6 threw a `ToolError` or unexpected exception | `{ error: toolError.code, message }` or generic `{ error: "InternalError" }` for unexpected |
| `output_invalid` | Step 7 failed | `{ error: "OutputInvalid" }` — handler must be fixed |
| `approval_pending` | Tier = approval_required | `ApprovalRequiredResponse { requestId, summary, expiresAt }` |
| `approval_denied` | Re-invocation after user rejected | `{ error: "ApprovalDenied" }` |
| `timeout` | Step 6 exceeded timeout | `{ error: "Timeout" }` |

### 3.2 Async invocation flow

Key differences from sync:

1. Steps 1–5 run identically, except step 5 (risk-tier gate) also applies — approval-required async tools surface the approval response before any enqueue.
2. **Instead of awaiting the handler**, the executor writes a row to `agentJobs` (§3.2's schema) with `status = "pending"` and the validated input payload. Immediately returns `JobCreatedResponse { jobId, estimatedDurationMs }` to the adapter.
3. **Background worker** (§3.4) polls `agentJobs WHERE status = "pending"` in FIFO order (by `createdAt`). Claims a row by transitioning to `status = "running"` atomically. Runs steps 6–9 of §3.1 against the stored input.
4. **Job completion** updates the row to `status = "completed"` with the result payload or `status = "failed"` / `"timeout"` with error details. Writes the audit row at this point (async audit timing matches the handler execution, not the enqueue).
5. **Notification of result.** The notifying agent context polls `agentJobs.status` via a `jobs.status({jobId})` tool (also in the registry — autonomous tier), or the agent framework subscribes to a push channel added in Phase 8. For initial Phase 8, polling is sufficient; flag for revisit (§9 Open Question 6).
6. **Lifecycle states:** `pending → running → completed | failed | timeout`. Terminal states never transition again; replays are new jobs.

**`agentJobs` table schema:**

```ts
// drizzle/schema.ts — Phase 8

export const agentJobs = mysqlTable("agentJobs", {
  id: int("id").autoincrement().primaryKey(),

  /** orgScope. Always written; queries filter on this first. */
  orgId: int("orgId").notNull(),

  /** Memory + approval partition key. See ToolExecutionContext. */
  tenantContextKey: varchar("tenantContextKey", { length: 128 }).notNull(),

  /** Agent that enqueued the job. */
  agentId: varchar("agentId", { length: 64 }).notNull(),

  /** Source conversation (nullable for cron-fired jobs). */
  conversationId: varchar("conversationId", { length: 128 }),

  /** Tool name — FK-like but stored as text because registry is code-based. */
  toolName: varchar("toolName", { length: 128 }).notNull(),

  /** Validated input, JSON-serialized. PII may live here — sensitive async
   *  tools must accept an opt-in to include input in agentApprovalRequests
   *  instead (§5.1). */
  inputPayload: json("inputPayload").notNull(),

  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "timeout"]).notNull().default("pending"),

  /** Handler result, JSON-serialized. Null until terminal state. */
  result: json("result"),

  /** Structured error: { code, message, stack? }. Null on success. */
  error: json("error"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),

  /** Hard deadline. If the worker sees a row in `running` past `timeoutAt`,
   *  it transitions to `timeout`. Computed as createdAt + tool.timeoutMs
   *  at enqueue time (not as a DB-side expression — MySQL portability). */
  timeoutAt: timestamp("timeoutAt").notNull(),
}, (t) => ({
  orgStatusIdx: index("agentJobs_orgStatus_idx").on(t.orgId, t.status),
  statusCreatedIdx: index("agentJobs_statusCreated_idx").on(t.status, t.createdAt),
  tenantIdx: index("agentJobs_tenant_idx").on(t.orgId, t.tenantContextKey),
  timeoutIdx: index("agentJobs_timeout_idx").on(t.status, t.timeoutAt),
}));
```

**Retention:** completed / failed / timeout rows retained 30 days, then purged by the daily retention job (§4.3 runs the same sweep). Audit log (§5) preserves the permanent record; `agentJobs` is operational state.

### 3.3 Risk-tier enforcement

**Risk tier is STATIC per tool (Decision 34).** A tool has exactly one `riskTier` declared at registration; it is immutable at runtime. The executor cannot upgrade or downgrade the tier based on input shape, caller identity, or runtime state. If a single conceptual action needs different tiers for different inputs (e.g., metadata edit vs price edit on a product), the implementation splits into two tools (`products.updateMetadata` = logged; `products.updatePricing` = approval_required). Static tiers produce predictable audit trails and predictable agent behavior — the agent knows at tool-declaration inspection time whether a call will execute immediately or require approval.

**autonomous** — handler runs immediately. Audit row written. Nothing else. Example: `pricing.calculate`, `zones.list`, `memory.recall`.

**logged** — handler runs immediately. Audit row written. After the audit row commits, executor enqueues a dashboard notification. Notification payload:

```ts
interface LoggedToolNotification {
  toolName: string;
  orgId: number;
  tenantContextKey: string;
  agentId: string;
  conversationId: string | null;

  /** One-sentence summary, produced by the handler via an optional
   *  `summarizeSideEffect(input, output)` callback on the tool. Default
   *  summary: "<toolName> completed." */
  summary: string;

  performedAt: Date;

  /** Optional reversal — the tool *may* declare a `reversalToolName`
   *  and the executor writes a `reversalInvocation` payload the dashboard
   *  can re-invoke. Example: zones.create has reversalToolName =
   *  "zones.delete" with { zoneId: createdId, force: true }. Some
   *  logged tools have no reversal (e.g., "note.draft") — reversalAction
   *  is omitted. */
  reversalAction?: {
    toolName: string;
    input: unknown;
    humanReadableLabel: string;
  };
}
```

Notification surfaces in the distributor dashboard (Phase 8). Reversal is not automatic — the user clicks "Undo" and the dashboard invokes the reversal tool. The reversal itself is a normal registry call with its own tier (typically `approval_required` for destructive reversals, so "undo" of a destructive action still requires approval).

**approval_required** — handler does NOT run at first invocation. Executor writes an `agentApprovalRequests` row and returns `ApprovalRequiredResponse { requestId, summary, expiresAt }`. The adapter hands this back to the agent's tool_use loop, which **pauses** and surfaces a waiting state to the user in its next assistant turn (Decision 35 — no agent-side polling; no agent tokens spent waiting).

Expiry is per-tool via `AgentTool.approvalExpiryMs` (default 24h, hard max 7 days per Decision 33 — tools above the cap throw `InvalidApprovalExpiry` at registration).

```ts
// drizzle/schema.ts — Phase 8

export const agentApprovalRequests = mysqlTable("agentApprovalRequests", {
  id: int("id").autoincrement().primaryKey(),
  orgId: int("orgId").notNull(),
  tenantContextKey: varchar("tenantContextKey", { length: 128 }).notNull(),
  agentId: varchar("agentId", { length: 64 }).notNull(),
  conversationId: varchar("conversationId", { length: 128 }),
  toolName: varchar("toolName", { length: 128 }).notNull(),

  /** Full validated input — approvals render the proposed action verbatim
   *  to the user. PII-containing inputs live here intentionally; the
   *  approval UI is the consent point. */
  inputPayload: json("inputPayload").notNull(),

  /** Human-readable summary produced by the tool's optional
   *  `summarizeProposal(input)` callback. Default: `"<toolName> proposed."` */
  summary: text("summary").notNull(),

  /** Identifier of the agent / copilot that proposed the action. */
  proposedBy: varchar("proposedBy", { length: 64 }).notNull(),

  status: mysqlEnum("status", ["pending", "approved", "rejected", "expired", "executed"]).notNull().default("pending"),

  /** When status transitions to approved/rejected, who did it and when.
   *  approvedBy is a userId (never an agent — agents cannot self-approve). */
  approvedBy: int("approvedBy"),
  approvedAt: timestamp("approvedAt"),

  /** Per-tool configurable via `AgentTool.approvalExpiryMs` (Decision 33);
   *  default 24h, hard max 7 days. */
  expiresAt: timestamp("expiresAt").notNull(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  orgStatusIdx: index("agentApprovalRequests_orgStatus_idx").on(t.orgId, t.status),
  tenantStatusIdx: index("agentApprovalRequests_tenantStatus_idx").on(t.orgId, t.tenantContextKey, t.status),
  expiresIdx: index("agentApprovalRequests_expires_idx").on(t.status, t.expiresAt),
}));
```

**Approval flow (Decision 35 — human-initiated resumption):**

1. User sees the pending request in the Phase 8 dashboard (or is notified via chat).
2. User clicks "Approve" or "Reject" — a tRPC procedure (`approvals.decide`) runs inside their authenticated session and updates the row.
3. `approvals.decide` validates: (a) the approver's session orgId matches the approval's orgId (orgScope), (b) the approver is a human user (not another agent), (c) status is still `pending`, (d) now < expiresAt.
4. On approval, `approvals.decide` re-invokes the tool's handler via the executor with the stored input and the approval's context. Outcome `success` — the row transitions to `executed`. This is the only code path that executes an approval-required tool's handler.
5. On rejection, row transitions to `rejected`; no handler runs.
6. Expired rows are swept by the daily retention job (§4.3 retention sweep does double duty); `status → expired`.

**Agent resumption (Decision 35).** The agent does NOT poll for approval status. Instead, the system emits a `toolApprovalResolved` event when `approvals.decide` transitions a row to `approved` or `rejected`. The event triggers the next conversation turn on the agent's pending conversation, surfacing the resolved outcome as a synthetic `tool_result` in the agent's context so its next turn can continue the thread. If approval expires without action, no resumption event fires; on the next user-initiated turn the agent sees the expired approval (surfaced by the conversation framework) and decides whether to retry or move on per its prompt.

Agents cannot self-approve, nor can they batch-approve. Every approval is one human action inside an authenticated session. No agent tokens are spent in a waiting state.

### 3.4 Background queue infrastructure

**RESOLVED 2026-04-21 per Decision 27: Redis + BullMQ.** See `rebuild-2026-q2.md` Decision 27.

**Infrastructure dependency:** AWS ElastiCache Redis, `cache.t4g.small` (≈ $25/month, ≈ $300/year), provisioned in the same VPC as the EC2 app in Phase 1 infra setup. This is the single authoritative Redis for the rebuild — existing consumers (`rateLimiter`, `pkceStore`, `tokenBlocklist`) migrate off REDIS_URL-optional behavior onto the same instance.

**New npm dependencies:** `bullmq` (queue primitives, retries, DLQ, cron), `ioredis` (already present at `^5.10.1` — used as BullMQ's Redis client).

**Why BullMQ over DB-backed polling:**

- Dead-letter queues, retry-with-backoff, job-level timeouts, and delayed-job primitives are provided, not reinvented.
- Observability: BullMQ ships with a dashboard (Arena / Bull Board) — becomes a protected internal tool in Phase 8 (ops-only, behind admin auth, orgScope-filtered view).
- Future async work (supplier sync in Phase 3, bulk imports in Phase 4, Phase 8 agent workflows) all share one queue subsystem — no second migration ever.
- Cost is trivial (≈ $300/year) vs the avoided operational cost of rolling our own retry-with-backoff and DLQ semantics later.

**Queue mapping:** `agentJobs` table remains the durable catalog-of-record for every async tool invocation (audit, retention, approval linkage all key off it). BullMQ holds the execution-state queue (pending / active / completed / failed / delayed). The worker:

1. Executor enqueues a BullMQ job whose payload is `{ agentJobsId }` after inserting the `agentJobs` row.
2. BullMQ worker picks up the job, loads the `agentJobs` row, runs steps 6–9 of §3.1.
3. Worker updates `agentJobs.status` + `result` / `error` at each transition (`pending → running → completed | failed | timeout`).
4. BullMQ handles retries, backoff, DLQ; the `agentJobs` row records the final outcome for audit.

This split preserves "one source of durable truth for audit" while delegating execution orchestration to BullMQ.

**Worker implementation sketch (for Phase 8):**

```ts
// server/agents/worker.ts — Phase 8
import { Worker } from "bullmq";

export function startAgentWorker(connection: RedisConnection) {
  return new Worker("agentJobs", async (job) => {
    const { agentJobsId } = job.data;
    const row = await loadAgentJob(agentJobsId);
    return runAgentJobHandler(row);
  }, {
    connection,
    concurrency: 4,
    // retries, backoff, timeout from tool declaration
  });
}
```

**Phase 1 infra checklist** (lands in rebuild-2026-q2.md Phase 1 scope):
1. Provision `cache.t4g.small` ElastiCache Redis in same VPC as the EC2 app.
2. Add `REDIS_URL` / `REDIS_PORT` / auth-token env vars; update `validateEnv.ts`.
3. `pnpm add bullmq`; verify `ioredis` major version compatibility.
4. Migrate existing Redis consumers (`rateLimiter`, `pkceStore`, `tokenBlocklist`) to the managed instance (no code change — connection URL only).

**Open risk:** if the ElastiCache instance goes down, async tool invocation halts (jobs pile up in the DB as `pending` but never execute). Mitigation: ElastiCache in ≥ 2 AZ replication, BullMQ worker's Redis reconnection logic, Phase 6 monitoring alert on `agentJobs` backlog > N.

---

## Section 4 — Agent Memory

### 4.1 `agentMemory` table schema

Per Decision 24. Full Drizzle shape:

```ts
// drizzle/schema.ts — Phase 8

export const agentMemory = mysqlTable("agentMemory", {
  id: int("id").autoincrement().primaryKey(),

  /** orgScope. Always filtered first; cross-org queries return empty. */
  orgId: int("orgId").notNull().references(() => organizations.id),

  /** Memory partition: storeId for customer agents, distributorUserId
   *  for distributor agents. Stored as a string so future partition kinds
   *  don't require a schema migration. Convention: `store:<id>` /
   *  `user:<id>` prefixes. */
  tenantContextKey: varchar("tenantContextKey", { length: 128 }).notNull(),

  /** Which agent owns this memory. Multiple agents may share a tenant
   *  context (e.g., a distributor may have both Catalog-Change and
   *  Curation Assistant remembering things about the same store);
   *  memory is partitioned by agentId within the tenant. */
  agentId: varchar("agentId", { length: 64 }).notNull(),

  /** User-meaningful key. Often dotted ("preferences.tone",
   *  "knownProducts.42"). Unique per (orgId, tenantContextKey, agentId, key). */
  memoryKey: varchar("memoryKey", { length: 256 }).notNull(),

  /** Arbitrary JSON value. Per Decision 36, write-time validation rejects
   *  serialized payloads > 16 KB with `ValueTooLarge`. Callers needing
   *  larger storage (generated proposals, embeddings, structured
   *  documents) use the separate `agentBlobStorage` subsystem — designed
   *  in Phase 8, not here. This keeps agentMemory narrow and fast. */
  memoryValue: json("memoryValue").notNull(),

  /** Nullable — links the memory to the conversation that produced it,
   *  useful for "why does the agent think this?" audits. */
  sourceConversationId: varchar("sourceConversationId", { length: 128 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),

  /** Updated on every recall so hot memory survives the retention sweep
   *  (see §4.3). */
  lastAccessedAt: timestamp("lastAccessedAt").defaultNow().notNull(),

  /** Hard expiry. Default at write: createdAt + 90 days. Capped at 90 days
   *  even when the caller passes a longer ttl (enforced in
   *  memory.remember). Updated to max(expiresAt, lastAccessedAt + 90d)
   *  on recall to give active memory a full rolling window. */
  expiresAt: timestamp("expiresAt").notNull(),
}, (t) => ({
  /** Hot path: recall by (org, tenant, agent, key). */
  recallIdx: uniqueIndex("agentMemory_recall_uniq").on(
    t.orgId, t.tenantContextKey, t.agentId, t.memoryKey,
  ),

  /** Prefix scans. memoryKey as the right-most column so a range scan
   *  on prefix works under the left-anchored (org, tenant, agent) guard. */
  prefixIdx: index("agentMemory_prefix_idx").on(
    t.orgId, t.tenantContextKey, t.agentId, t.memoryKey,
  ),

  /** Retention sweep — delete WHERE expiresAt < NOW(). */
  expiryIdx: index("agentMemory_expiry_idx").on(t.expiresAt),
}));
```

**Index rationale:** the `recallIdx` unique index is both the hot-path lookup and the integrity guarantee (one row per key). The `expiryIdx` serves the daily sweep. The `prefixIdx` overlaps with `recallIdx` on MySQL but is listed for clarity — the `memoryKey` LIKE 'prefix%' range scan uses the same column ordering.

### 4.2 Memory API (agent-facing tools)

All memory tools are `invocation: "sync"`, `riskTier: "autonomous"` — the agent manages its own memory without user-facing side effects. `orgScope` and `tenantContextKey` are always resolved from ctx, never from input (exactly like every other tool).

```ts
// server/agents/memory/tools.ts — Phase 8

// memory.recall — single key fetch
{
  name: "memory.recall",
  description: "Fetch a single memory entry by key. Returns null if absent or expired.",
  inputSchema: z.object({ key: z.string().max(256) }),
  outputSchema: z.object({ value: z.unknown().nullable(), lastAccessedAt: z.string().nullable() }),
  invocation: "sync",
  riskTier: "autonomous",
  riskTierJustification: "Read-only self-management, scoped to agent's own memory.",
  orgScopeReviewed: true,
  handler: async ({ key }, ctx) => { /* SELECT + UPDATE lastAccessedAt on hit */ },
}

// memory.recallPrefix — prefix scan
{
  name: "memory.recallPrefix",
  inputSchema: z.object({ prefix: z.string().min(1).max(256), limit: z.number().int().min(1).max(100).default(50) }),
  outputSchema: z.object({ entries: z.array(z.object({ key: z.string(), value: z.unknown() })) }),
  /* ... */
}

// memory.remember — write with optional TTL
{
  name: "memory.remember",
  inputSchema: z.object({
    key: z.string().max(256),
    value: z.unknown(),
    ttlDays: z.number().int().min(1).max(90).optional(),
  }),
  outputSchema: z.object({ writtenAt: z.string(), expiresAt: z.string() }),
  invocation: "sync",
  riskTier: "autonomous",
  riskTierJustification: "Agent self-management; 90-day cap enforced; value-size soft cap enforced.",
  orgScopeReviewed: true,
  /* Handler enforces value size (soft cap 16 KB; reject above with ValueTooLarge),
     caps ttlDays at 90, upserts on (orgId, tenantContextKey, agentId, memoryKey). */
}

// memory.forget — single delete
{ name: "memory.forget", inputSchema: z.object({ key: z.string().max(256) }), /* ... */ }

// memory.forgetPrefix — bulk delete
{ name: "memory.forgetPrefix", inputSchema: z.object({ prefix: z.string().min(1).max(256) }), /* ... */ }
```

All tools enforce `orgId` and `tenantContextKey` from ctx in the WHERE clause of every query. A memory.recall with a prefix matching another tenant's keys returns empty — not because the key is missing, but because the WHERE filter excludes the row before the prefix match runs.

### 4.3 Retention sweep

Daily job registered at server startup via the same `setInterval` pattern as `agentCron` (Decision 25 § 3.4 recommends staying on DB-backed, `setInterval`-scheduled background work).

```ts
// server/agents/memory/retentionSweep.ts — Phase 8
// Fires once every 24h, off-peak (02:00 UTC by default).
// 1. DELETE FROM agentMemory WHERE expiresAt < NOW();
// 2. Log { deletedCount, oldestDeletedCreatedAt } at INFO.
// 3. Emit a structured log event "agentMemoryRetentionSweepCompleted" for ops.
```

**Phase 6 cross-check:** Phase 6 cleanup sweep independently verifies:
- No `agentMemory` rows survive a tenant deletion (orphan memory rows post-tenant-delete are a data-integrity bug).
- No `agentMemory` rows exist with `expiresAt < NOW() - 48h` (means the daily sweep hasn't run in two days — operational alert).

### 4.4 User-controlled clear (distributor-facing)

Not agent tools. Plain tRPC procedures that run inside the distributor's authenticated session, for the Phase 8 dashboard "What my agents remember" surface.

```ts
// server/routers/agentMemory.ts — Phase 8

agentMemory.list          // GET equivalent: list entries for caller's org,
                          //   optionally filtered by tenantContextKey, agentId
agentMemory.deleteOne     // DELETE single row by id (orgScope-enforced)
agentMemory.deletePrefix  // DELETE WHERE memoryKey LIKE prefix || '%'
```

These procedures are `input`-scoped tRPC (Zod-validated) and call into the same queries that the agent tools use — the difference is the caller is a distributor in their session, not an agent impersonating one. `protectedProcedure` gating is the standard tRPC middleware; no bypass. UI in Phase 8.

### 4.5 PII and compliance notes

- **Memory is PII-equivalent for compliance.** Treat `memoryValue` JSON as containing personal data by default, even when it might not.
- **Tenant deletion cascade:** on tenant deletion (GDPR / PIPEDA right-to-erasure), `agentMemory` rows for that tenant are deleted in the same transaction as the tenant record. Phase 8 wires this into the existing tenant-deletion flow.
- **Backup retention:** memory is excluded from long-term backup retention beyond 90 days — the rolling window is promise and constraint. Flagged for Phase 8 ops work (backup policy update).
- **Transparency surface:** Phase 8 dashboard should expose "What <AgentName> remembers about you" as a user-visible page per agent, populated by `agentMemory.list`. Treat as a product requirement, not just a compliance checkbox — transparency is a trust feature.

---

## Section 5 — Audit Log

### 5.1 `agentAuditLog` table

Every tool invocation writes exactly one row, regardless of tier or outcome. The row is written after step 7 of §3.1 (sync) or at handler completion (async). Write failures on the audit row do **not** fail the tool invocation — they emit a structured error log and a Sentry event, but the tool's result still returns. (Losing an audit row is bad; losing a tool result because audit failed is worse.)

**Default is inputHash-only (Decision 28).** Tools may opt into full-input retention by declaring `auditRetainFullInput: true` on the `AgentTool` declaration (§2.1). When opted in, the full validated input is stored in a sidecar `agentAuditLogInputs` table (§5.1.1) with its own 90-day retention window — separate from the main 18-month audit retention so the PII-bearing payloads roll off faster. Opt-in tools MUST document the reason in a leading code comment.

```ts
// drizzle/schema.ts — Phase 8

export const agentAuditLog = mysqlTable("agentAuditLog", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),

  orgId: int("orgId").notNull(),
  tenantContextKey: varchar("tenantContextKey", { length: 128 }),
  agentId: varchar("agentId", { length: 64 }).notNull(),
  conversationId: varchar("conversationId", { length: 128 }),

  /** The tool name. Not FK — registry is code-based. */
  toolName: varchar("toolName", { length: 128 }).notNull(),

  /** Snapshot of the tool's declared tier and invocation kind at the time
   *  of the call. Lets the audit log remain correct if a tool's tier is
   *  later changed in a new deploy. */
  riskTier: mysqlEnum("riskTier", ["autonomous", "logged", "approval_required"]).notNull(),
  invocation: mysqlEnum("invocation", ["sync", "async"]).notNull(),
  adapter: mysqlEnum("adapter", ["native", "mcp"]).notNull(),

  /** SHA-256 hex hash of the canonical JSON of the validated input. Null
   *  when invocation failed at input-validation step (no canonical input
   *  to hash). Rationale: audit "did this happen, by whom, to what
   *  target" without creating a second PII store. Full input for
   *  approval-required tools is in agentApprovalRequests; full input for
   *  async jobs is in agentJobs. Sync autonomous/logged tools keep hash
   *  only — the conversation transcript (Phase 8) holds the raw prompt. */
  inputHash: varchar("inputHash", { length: 64 }),

  outcome: mysqlEnum("outcome", [
    "success",
    "validation_failed",
    "orgscope_violation",
    "handler_error",
    "output_invalid",
    "approval_pending",
    "approval_denied",
    "timeout",
    "tool_not_found",
  ]).notNull(),

  /** Wall-clock handler duration in ms. Null on outcomes where no handler
   *  ran (validation_failed, orgscope_violation caught pre-handler, etc.). */
  durationMs: int("durationMs"),

  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: text("errorMessage"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  orgCreatedIdx: index("agentAuditLog_orgCreated_idx").on(t.orgId, t.createdAt),
  orgToolIdx: index("agentAuditLog_orgTool_idx").on(t.orgId, t.toolName, t.createdAt),
  orgOutcomeIdx: index("agentAuditLog_orgOutcome_idx").on(t.orgId, t.outcome, t.createdAt),
}));
```

**Hash-only for sync autonomous/logged:** the design intent is that audit answers "did this invocation happen, by whom, when, with what outcome, against what target (hash binds to the input shape)." Forensic reconstruction of the exact input uses the conversation transcript (Phase 8) or the opt-in `agentAuditLogInputs` sidecar. Hash-only avoids creating a second PII store purely for audit.

### 5.1.1 `agentAuditLogInputs` table (opt-in full-input sidecar, Decision 28)

```ts
// drizzle/schema.ts — Phase 8

export const agentAuditLogInputs = mysqlTable("agentAuditLogInputs", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),

  /** FK to the audit row this input belongs to. onDelete cascade: when the
   *  main audit row is purged at 18 months, the sidecar row goes with it
   *  (the sidecar would normally be purged earlier at 90 days via its own
   *  sweep, but this guards against any edge case). */
  auditLogId: bigint("auditLogId", { mode: "number" })
    .notNull()
    .references(() => agentAuditLog.id, { onDelete: "cascade" }),

  /** Full validated input, JSON-serialized. PII may live here by design —
   *  the tool has explicitly opted in via auditRetainFullInput. */
  inputPayload: json("inputPayload").notNull(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  auditIdx: index("agentAuditLogInputs_auditLogId_idx").on(t.auditLogId),
  createdIdx: index("agentAuditLogInputs_created_idx").on(t.createdAt),
}));
```

**Retention:** 90 days via a dedicated daily sweep (runs alongside §4.3). The main `agentAuditLog` row retains the hash and metadata for the full 18-month window even after the sidecar payload expires — `inputHash` remains queryable for "did this invocation happen" questions; the payload itself rolls off at 90 days.

**Write path:** after the executor writes the main audit row, if `tool.auditRetainFullInput === true` it additionally inserts the validated input into `agentAuditLogInputs` with the freshly-assigned `auditLogId`. Failure to write the sidecar row logs a Sentry event but does not fail the tool invocation (same policy as the main audit row).

### 5.2 Audit query API

tRPC procedures for the Phase 8 distributor dashboard:

```ts
// server/routers/agentAudit.ts — Phase 8

agentAudit.query    // paged list filtered by agentId, toolName, outcome,
                    //   tenantContextKey, dateRange — orgScope-enforced
agentAudit.countByTier    // counts(autonomous/logged/approval_required) over time
                          //   for the agent-health dashboard
agentAudit.countByOutcome // success/failure ratios for agent health
```

All `protectedProcedure`. Non-privileged distributor users see their own tenant's rows only (tenantContextKey filter); distributor admins see the full org. Principal-role gating piggybacks on the existing tRPC role middleware (protected subsystem — not redesigned here).

### 5.3 Retention

**18 months default.** Justification vs memory's 90 days: memory is active-context — stale memory is noise and a privacy risk. Audit log is compliance / forensics / dispute resolution — longer retention buys you the ability to answer "what did this agent do nine months ago against a customer who is now disputing an invoice." 18 months also spans two tax years for most acquirer-DD scenarios.

**Sweep:** the same daily retention job (§4.3) extends to `agentAuditLog WHERE createdAt < NOW() - INTERVAL 18 MONTH`. Count logged. Phase 6 cross-check: no rows older than 18 months survive; sweep has run within 48h.

---

## Section 6 — Protocol Adapters

### 6.1 Native `tool_use` adapter (internal)

**Module:** `server/agents/adapters/nativeAdapter.ts`

**Responsibilities:**

1. Translate `tool_use` blocks from the Anthropic API response into `ToolInvocation { name, rawInput, ctx }` and hand to the executor.
2. Translate the executor's return (success or `ToolError`) into a `tool_result` block for the next Claude API request.
3. Inject the calling session's orgId and principal into `ToolExecutionContext` — never sourced from the model's tool_use input.
4. Surface `ApprovalRequiredResponse` to the calling agent loop so the agent can inform the user in natural language ("I've proposed this; please approve in your dashboard").

**Relationship to the existing copilot:** the current copilot (`server/utils/agentActions.ts`, `copilotExec/`) has its own ad-hoc tool plumbing and is protected through Phase 7. Phase 8 migrates the copilot to use the nativeAdapter + registry. Phase 8 upgrade is out of Task 4 scope — Task 4 only defines the target.

### 6.2 MCP adapter (external)

**Module:** `server/agents/adapters/mcpAdapter.ts`

**Responsibilities:**

1. Stand up an MCP server (reference: [MCP spec](https://modelcontextprotocol.io)) that exposes the registry's tools under the MCP `tools/list` and `tools/call` primitives. (URL deferred to `modelcontextprotocol.io` canonical link; verified by Phase 8 before implementation.)
2. Convert each tool's Zod `inputSchema` / `outputSchema` to JSON Schema via `zod-to-json-schema` (or equivalent) at startup. MCP clients see strict, validated schemas.
3. **Authenticate callers via `externalApiTokens` with scoped access (Decision 29).** Each token maps to a specific `orgId` and declares `scope ∈ {"read", "write"}`. Read-scope tokens may invoke tools that declare both `readOnly: true` AND `riskTier: "autonomous"` — the executor rejects any other invocation with `AccessDenied`. Write-scope tokens may invoke any tool the caller's org permits (subject to the normal risk-tier gate). Tokens are opaque, rotated per standard security practice, revocable. Per-tool fine-grained scopes are deferred — revisit if customer demand surfaces.

   ```ts
   // drizzle/schema.ts — Phase 8 subtask (schema flagged for Phase 8)
   externalApiTokens: {
     id, orgId,
     tokenHash,                          // SHA-256 hash of the token secret
     scope mysqlEnum("read" | "write"),  // Decision 29
     label,                              // human-readable identifier
     expiresAt,                          // optional
     createdBy, createdAt,
     lastUsedAt,
     revokedAt
   }
   ```

4. Map executor outcomes to MCP error shapes (MCP uses JSON-RPC 2.0-style error codes; `validation_failed` → `InvalidParams`, `orgscope_violation` → `AccessDenied`, etc. — mapping table drafted in Phase 8).
5. **Enforce rate limits at two tiers (Decision 30).** Per-token AND per-org, both via the existing `server/utils/rateLimiter.ts` (Redis-backed — consolidates on the same ElastiCache instance provisioned per Decision 27). Phase 1 defaults: **60 requests/minute per token**, **300 requests/minute per org**. Per-org ceiling is admin-configurable through the Phase 8 UI. Per-token exceeding its limit returns `429 TooManyRequests`; per-org ceiling exceeding returns `429` regardless of which token triggered it.

**Out of Task 4 scope:** the exact MCP transport (HTTP? SSE? stdio?), token-issuance UX, and the admin UI for rate-limit tuning. These are Phase 8 subtasks; Task 4 commits to the interface (registry exposes tools; adapter converts schemas; token scope gates access; dual-tier rate limits via rateLimiter.ts) but not the implementation details.

### 6.3 Adapter parity testing

Every tool in the registry is exercised through **both** adapters during CI via a shared harness:

```
// test/agents/adapterParity.test.ts — Phase 8
for (const tool of registry.listAll()) {
  for (const fixture of tool.testFixtures ?? []) {
    const nativeResult = await runThroughNativeAdapter(tool, fixture.input, fixture.ctx);
    const mcpResult    = await runThroughMcpAdapter(tool, fixture.input, fixture.ctx);
    expect(normalize(nativeResult)).toEqual(normalize(mcpResult));
  }
}
```

`testFixtures` is an optional field on `AgentTool` holding (input, context, expected) triples. CI requires every tool to declare at least one fixture — or to explicitly waive with `testFixturesWaived: "<reason>"`. Waivers are a code-review signal, not an escape hatch. This is additive to Phase 6's regression harness and is introduced in Phase 8 as part of the tool-registry infrastructure.

---

## Section 7 — Agent Conversation Framework (stub)

**DEFERRED to Phase 8 per Decision 32.** Conversation transcript storage (`agentConversations` / `agentMessages` tables), retention policy, multimodal-content handling, token-cost accounting, and transcript UI are Phase 8 deliverables. Task 4's responsibility ends at the tool-invocation layer; the conversation framework consumes Task 4's registry + executor + memory + audit but is not designed here.

Rationale for deferral: transcript design requires decisions about multimodal content, token-cost accounting, and UX surfacing that belong with the specific agents Phase 8 will ship (Catalog-Change, Curation Assistant, Pricing-Draft, Customer-Service). Committing to a transcript schema in Phase 0 risks over-fitting to assumptions that those four agents may revise.

**Task 4 commits for conversations (interface-level only; implementation is Phase 8):**

- Conversations are identified by `(orgId, tenantContextKey, conversationId)`. `conversationId` is a client-supplied opaque string (Phase 8 may issue ULIDs); every tool invocation inside a conversation writes the same `conversationId` to audit / job / approval rows so Phase 8 can reconstruct per-conversation timelines from Task 4 tables alone.
- Conversation persistence is separate from memory. Transcripts (raw `user` / `assistant` / `tool_use` / `tool_result` blocks, full fidelity) live in Phase 8-designed tables. Memory (§4) holds *summarized* facts extracted from conversations, not the conversation itself.

**Flagged for Phase 8:** conversation framework design (transcript table shape, turn ordering, model selection per turn, tool-loop budget, truncation strategy, summarization triggers, token-cost accounting).

---

## Section 8 — Dependencies & Interactions

### 8.1 How this design satisfies Task 2 and Task 3 tool contracts

**`pricing.calculate` (Task 2 §4.4) — worked example.**

```ts
// server/pricing/agentTools.ts — Phase 1 implementation uses this pattern

export const tools: AgentTool<any, any>[] = [
  {
    name: "pricing.calculate",
    description: "Calculate the unified price breakdown for a product in a store for a given quantity.",
    longDescription: "Respects per-store markup, per-product decoration rates, store-product overrides, size/variant/finishing-option context. orgScope-enforced; returns permissionDenied when the caller's org does not own the product or the store.",
    inputSchema: PriceCalculateInput,  // Zod; matches Task 2's input
    outputSchema: PriceBreakdownSchema, // Zod; mirrors Task 2 §2's PriceBreakdown
    invocation: "sync",                 // <2s typical; no queue needed
    riskTier: "autonomous",             // read-only, side-effect-free
    riskTierJustification: "Read-only calculation; no database writes; customer-facing context safe to invoke freely.",
    orgScopeReviewed: true,             // loader enforces orgScope (Task 2 §4.1)
    handler: async (input, ctx) => {
      // Call into Task 2's calculatePrice(input, ctx) — the same function
      // the tRPC procedure uses. Tool and tRPC share the same handler.
      return calculatePrice(input.productId, input.quantity, { orgId: ctx.orgId, /* ... */ });
    },
    testFixtures: [ /* (input, ctx, expected) triples for adapter parity */ ],
  },
];
```

**`zones.create` (Task 3 §5.2) — worked example with a different tier.**

```ts
// server/zones/agentTools.ts — Phase 2 implementation uses this pattern

export const tools: AgentTool<any, any>[] = [
  {
    name: "zones.create",
    description: "Create a new imprint zone on a product. orgScope-enforced; unique (productId, zoneKey); primary flag enforced at app level.",
    inputSchema: ZoneCreateInput,       // Zod; matches Task 3 §5.2
    outputSchema: ProductImprintZoneSchema,
    invocation: "sync",                 // write path; <2s
    riskTier: "logged",                 // writes are reversible; user sees dashboard notification
    riskTierJustification: "Catalog write with a reversible counterpart (zones.delete). Distributor sees the creation in the dashboard and can undo with one click. Not approval_required because the common case — supplier-fed or distributor-initiated zone creation — is high-volume and low-risk.",
    orgScopeReviewed: true,
    handler: async (input, ctx) => {
      // Enforce orgScope, uniqueness, isPrimary demotion (Decision 17),
      // method-zone compatibility (Decision 18) — see Task 3 §2.1.
      return createZone(input, ctx);
    },
    summarizeSideEffect: (input, output) =>
      `Created imprint zone "${output.zoneLabel}" on product #${input.productId}.`,
    reversalToolName: "zones.delete",
    reversalInputMapper: (output) => ({ zoneId: output.id, force: true }),
    testFixtures: [ /* ... */ ],
  },
];
```

**`zones.delete` — contrast (approval_required).**

Same shape, `riskTier: "approval_required"`, `riskTierJustification: "Deletes a catalog row; onDelete cascades set productDecorationRates.imprintZoneId and storeProducts.chosenImprintZoneId to NULL — reversing after customer impact is costly. Approval surfaces the side-effect count (via zones.delete's force=true output) to the distributor before execution."`

The pattern holds across Tasks 2 / 3 without special cases. Every new tool in Phases 2–5 follows the same shape; Phase 8 agents consume them by name.

### 8.2 Interaction with protected subsystems

- **Auth / SSO (#1):** tools execute inside authenticated tRPC sessions (native) or authenticated MCP token contexts (external). No bypass. The `principal` field in `ToolExecutionContext` is the existing session's user or the token's bound identity.
- **orgScope (#2):** the executor injects `orgId` from the session / token, never from input. Every tool declares `orgScopeReviewed: true` as a compile-time attestation; handlers call into the existing `orgScope` utility (`server/utils/orgScope.ts`) for their queries. Protected subsystem is consumed, not modified.
- **Stripe (#3, #4):** pricing-related tools produce cents; they do not invoke Stripe directly. Checkout remains a sync tRPC path — not wrapped as an agent tool (intentional: the actual payment-money-movement path belongs to the protected subsystem, not the agentic layer). If a future phase needs agents to *initiate* a Stripe action (e.g., "refund this invoice"), it goes through the Stripe-owning tRPC procedure with `approval_required` tier.
- **Resend (#5):** email-sending tools (e.g., `notifications.sendEmail`, `proposals.send`) are `approval_required`. Resend integration stays unchanged — the tool's handler calls into the existing Resend wrapper inside a distributor-approved execution.
- **tRPC / Drizzle / React / pm2 (#6):** registry / executor / adapters all live inside the existing tRPC process. Drizzle is the DB layer. No stack changes.
- **Existing AI copilot (#7):** through Phase 7 the copilot stays untouched. Phase 8 migrates it onto this registry — the copilot's existing tools (`copilotExec/*`, `agentActions.ts`) are rewritten as `AgentTool` declarations in the new pattern and the old ad-hoc plumbing is deleted in the same PR (Principle #2). Phase 8 upgrade is out of Task 4 scope; Task 4 defines the target.
- **PDF generation (#8):** out of scope; agents do not render PDFs directly. If an agent needs to produce a proposal PDF, it calls `proposals.generatePdf` (approval_required), which invokes the existing PDF pipeline.

### 8.3 Phase implementation hooks (CHECKLIST — design review at phase open)

The tiers below are recommended; every phase confirms at phase-open design review.

- **Phase 1 (Unified Pricing Engine) — infrastructure work items (Decision 27):**
  - Provision AWS ElastiCache Redis (`cache.t4g.small`) in the same VPC as the EC2 app.
  - Add `REDIS_URL` / `REDIS_PORT` / auth-token env vars; update `server/utils/validateEnv.ts`.
  - `pnpm add bullmq`; confirm `ioredis ^5.10.1` major-version compatibility.
  - Migrate existing Redis consumers (`rateLimiter`, `pkceStore`, `tokenBlocklist`) from REDIS_URL-optional to the managed ElastiCache instance (connection string only, no code changes).
  - Document the Phase 1 infra checklist item in `rebuild-2026-q2.md` under Phase 1 scope when Phase 1 opens.
- **Phase 2 (Imprint Zones):**
  - `zones.list` — autonomous
  - `zones.create` — logged (reversal: `zones.delete` with force)
  - `zones.update` — logged (reversal: `zones.update` with previous state)
  - `zones.delete` — approval_required (cascade impact surfaces in approval summary)
- **Phase 3 (Supplier Sync + Generic Adapter):**
  - `suppliers.listChanges` — autonomous
  - `suppliers.approveChange` — approval_required (writes catalog state)
  - `suppliers.rejectChange` — autonomous (rejection is a no-op on catalog state)
  - `suppliers.runSync` — async, approval_required (long-running; batched catalog changes)
- **Phase 4 (Distributor Curation UX):**
  - `products.addToStore` — logged
  - `products.configureZone` — logged (reversal: revert zone selection)
  - `products.setPricing` — approval_required if changing published price; logged if changing draft
  - `products.bulkImport` — async, approval_required
- **Phase 5 (Customer Webstore):**
  - `store.listProducts` — autonomous (customer-facing; tenantContextKey = storeId)
  - `store.addToCart` — autonomous (customer's own cart, scoped)
  - `store.submitCustomOrderRequest` — logged (distributor sees it in dashboard; existing trigger hooks into `onCustomOrderRequestCreated`)
- **Phase 8 (AI Features & Agentic Workflows):**
  - Implements the four agents (Catalog-Change, Curation Assistant, Pricing-Draft, Customer-Service) on top of this registry.
  - Implements the copilot upgrade: migrates existing copilot tools into registry declarations; deletes the old ad-hoc plumbing (Principle #2).
  - Implements the Phase 8 dashboard surfaces: approvals queue, notifications feed, memory viewer, audit search, agent-health dashboard, BullMQ queue dashboard (behind admin auth, orgScope-filtered view).
  - **Tables to implement in Phase 8:**
    - `agentJobs` (§3.2) — async tool execution state.
    - `agentApprovalRequests` (§3.3) — approval queue.
    - `agentMemory` (§4.1) — tenant-scoped memory, 90-day rolling.
    - `agentAuditLog` (§5.1) — hash-only audit, 18-month retention.
    - `agentAuditLogInputs` (§5.1.1) — opt-in full-input sidecar, 90-day retention (Decision 28).
    - `externalApiTokens` — scoped token auth for MCP (Decision 29).
    - `agentBlobStorage` (flagged) — large-artifact storage for agents that exceed the 16 KB memory cap (Decision 36).
    - `agentConversations` / `agentMessages` (flagged) — conversation transcripts (Decision 32 — full schema designed when Phase 8 opens).
  - Implements the MCP adapter, scoped-token auth, and dual-tier rate limits (Decisions 29, 30).
  - Implements the conversation framework (§7 DEFERRED stub; Decision 32 full design).
  - Implements the AI evaluation harness and cost/latency observability (Decision 3 scope).
  - Implements the CI lint for agent identifiers per Decision 31 (`server/agents/agentIdentifiers.ts` constants file).

Each phase's task list begins by adopting the relevant row above and confirming the tier choices during design review. If a phase needs a tier different from the recommendation, it documents the deviation as a phase-specific architectural decision.

---

## Section 9 — Open Questions for Yan

**All 10 questions RESOLVED 2026-04-21.** Each subsection carries a RESOLVED banner with the Decision number. Full Decision records (context, options, rationale, implications) live in `rebuild-2026-q2.md` as Decisions 27–36.

### 9.1 Queue infrastructure for async tools

**RESOLVED 2026-04-21 — Decision 27:** Redis + BullMQ (overrides the original DB-backed-polling recommendation). Provision AWS ElastiCache Redis (`cache.t4g.small`, ≈$25/month) in Phase 1 infra setup; add `bullmq` npm dependency. Rationale: DD-grade queue infrastructure (retries, DLQ, scheduling, observability) from Phase 1; trivial cost vs avoided future migration; single queue subsystem powers all async work across phases. See §3.4 for full plumbing.

### 9.2 Full input retention in audit log

**RESOLVED 2026-04-21 — Decision 28:** per-tool opt-in. Default is hash-only. Tools declare `auditRetainFullInput: true` to opt into full-input retention in a sidecar `agentAuditLogInputs` table (§5.1.1) with a separate 90-day retention window. The main audit log retains 18 months. Opt-in tools must document the reason in a leading code comment. Revisit at Phase 8 close — the set of opt-in tools informs whether an org-wide knob is worth adding.

### 9.3 MCP authentication — bearer token vs scoped tokens

**RESOLVED 2026-04-21 — Decision 29:** scoped tokens with `scope ∈ {"read", "write"}`. Read-scope tokens may invoke only tools where `readOnly: true` AND `riskTier: "autonomous"`. Write-scope tokens may invoke any tool the caller's org permits. The `AgentTool` interface gains a `readOnly?: boolean` field (§2.1); `externalApiTokens.scope` gates invocation. Granular per-tool permissions deferred to a future phase if customer demand surfaces.

### 9.4 Rate limiting for MCP

**RESOLVED 2026-04-21 — Decision 30:** both per-token AND per-org, enforced via the existing `server/utils/rateLimiter.ts` (Redis-backed — consolidates on the same ElastiCache instance from Decision 27). Phase 1 defaults: **60 requests/minute per token**, **300 requests/minute per org**. Per-org ceiling is admin-configurable through Phase 8 UI.

### 9.5 Agent identifier registry

**RESOLVED 2026-04-21 — Decision 31:** free-form `varchar(64)` across all agent-related tables. CI lint (at `server/agents/agentIdentifiers.ts`) enforces that every `agentId` literal in the codebase matches a declared constant. Trade-off: flexible schema (no migration to add an agent) with type safety enforced by lint rather than DB constraint.

### 9.6 Conversation transcripts — storage venue

**RESOLVED 2026-04-21 — Decision 32:** deferred entirely to Phase 8. Task 4 commits only to the ID shape (`(orgId, tenantContextKey, conversationId)`) and that transcripts are separate from memory (§7). Phase 8 designs and ships `agentConversations` + `agentMessages` tables, transcript retention, and transcript UI. Rationale: transcript design requires decisions about multimodal content, token-cost accounting, and UX surfacing that belong with the specific agents — premature here.

### 9.7 Approval expiry — 24h default configurable?

**RESOLVED 2026-04-21 — Decision 33:** per-tool configurable via optional `AgentTool.approvalExpiryMs` (default 24h / 86_400_000 ms). Hard maximum of 7 days (604_800_000 ms) enforced at `registry.register()` — tools exceeding the cap throw `InvalidApprovalExpiry` at startup. Expired approvals auto-transition `agentApprovalRequests.status → "expired"` via the daily cleanup sweep. No distributor-level override in Phase 8.

### 9.8 Risk-tier dynamic escalation

**RESOLVED 2026-04-21 — Decision 34:** static. A tool has exactly one `riskTier` declared at registration; it is immutable at runtime. Where different behaviors are needed for different inputs (e.g., metadata edit vs price edit), implementations split into separate tools (`products.updateMetadata` vs `products.updatePricing`). Rationale: static tiers produce clean audit trails and predictable agent behavior; dynamic tiering introduces a "why did this execute?" class of bug that is expensive to diagnose.

### 9.9 Native adapter response for approval-required tools

**RESOLVED 2026-04-21 — Decision 35:** human-initiated resumption only; no agent polling. When a tool returns `ApprovalRequiredResponse`, the agent's tool_use loop pauses and surfaces a waiting state to the user. When the user approves (via dashboard action or explicit chat), the system emits a `toolApprovalResolved` event; the agent's next conversation turn is triggered with the approval resolution surfaced as tool_result. No agent-side polling; no agent tokens spent waiting. If approval expires without action, no resumption event fires; the agent's next user-initiated turn decides whether to retry or move on per its prompt.

### 9.10 Memory value size cap

**RESOLVED 2026-04-21 — Decision 36:** reject at 16 KB with `ValueTooLarge` at write time. Agents that need to store larger artifacts (generated proposals, embeddings, structured documents) use a separate `agentBlobStorage` subsystem designed in Phase 8, not here. The `agentMemory` table stays narrow and fast; Phase 8 adds the blob-storage subsystem when a concrete agent need surfaces.

---

## Section 10 — Dependencies on Other Phase 0 Tasks

### 10.1 Task 5 (Conditional subsystems)

**RESOLVED 2026-04-22 per Decisions 37 and 38:** both conditional items promoted to **IN SCOPE as first-class features**. The agent tool layer gains new tool categories for Phase 8 implementation and extends `ToolExecutionContext`:

- **Approval workflow tools (Decision 37):** `approvals.list`, `approvals.approve`, `approvals.reject` — `approval_required` risk tier by default (per Decision 26 — these tools themselves are gated, since they modify approval-chain state and transitively authorize arbitrary downstream tools). Tool contracts and schemas designed when Phase 8 opens.
- **Department-scoped queries (Decision 37):** tools consuming department context (e.g., `departments.listBudgets`, `pricing.calculate` with `departmentId`). Read-scoped variants declared `readOnly: true` to satisfy MCP read-token access (Decision 29).
- **Division-scoped queries (Decision 38):** tools consuming division context (e.g., `store.listProducts` with `divisionId`, `pricing.calculate` with `divisionId`).
- **`ToolExecutionContext` extension:** add optional `departmentId?: number` and `divisionId?: number` fields. `orgId` remains mandatory and primary; `departmentId` / `divisionId` are injected from the session / token context, never from tool input (consistent with the §2.1 orgScope-injection pattern).
- **Audit implication:** `agentAuditLog` and `agentApprovalRequests` already carry `tenantContextKey`; the Phase 8 schema for these tables is extended with optional `departmentId` / `divisionId` columns so the audit dashboard can filter per-department / per-division activity.

Historical flags retained for context: "If multi-department moves in-scope, agents may need a `departmentId` field in `ToolExecutionContext` to route approvals to the correct department approver" and "If multi-division webstore moves in-scope, customer-facing agent tools may need `divisionId` in tenant context" — both now concrete Phase 8 scope items per the RESOLVED banner above.

### 10.2 Task 6 (Regression baseline)

- Phase 8 needs an **agent-tool regression harness** that Task 6 does not currently scope:
  - Adapter parity tests (§6.3) must run in CI.
  - A tool-registry linter: verifies every registered tool declares required fields, passes Zod-to-JSON-Schema conversion cleanly, has at least one test fixture or an explicit waiver.
  - A risk-tier drift detector: compares declared tiers against a committed baseline; accidental downgrades (approval_required → logged) surface as CI warnings for reviewer attention.
- Flag for Task 6 to extend the regression protocol to include the above.

---

## Appendix — Summary for Yan (read this if nothing else)

**Status (2026-04-21):** all 10 open questions from §9 resolved. Decisions 27–36 recorded in `rebuild-2026-q2.md`. Task 4 closed; Phase 0 remaining scope is Tasks 5 and 6.

**Shipping in Phase 8 (infrastructure; specific agents also Phase 8):**

- **Tool interface** `AgentTool<TInput, TOutput>` at `shared/agents/toolTypes.ts` — name, description, Zod schemas, invocation, tier, tier justification, `orgScopeReviewed: true` compile-time attestation, `auditRetainFullInput?` (Decision 28), `approvalExpiryMs?` (Decision 33, 7-day hard max), `readOnly?` (Decision 29), handler.
- **Central registry** `server/agents/toolRegistry.ts` — duplicate-name enforcement at startup, org-aware `listTools()`, frozen after boot, startup validation (approval expiry cap, readOnly↔autonomous coupling, async timeout required).
- **Executor** `server/agents/executor.ts` — input validation, orgScope resolution, static risk-tier gate (Decision 34), handler invocation (sync via direct call or async via BullMQ enqueue), output validation, audit-log write, logged-tier notification, approval-required path with `toolApprovalResolved` event for human-initiated resumption (Decision 35).
- **Seven tables (all Phase 8):**
  - `agentJobs` — async execution state (catalog-of-record; BullMQ handles queue).
  - `agentApprovalRequests` — approval queue.
  - `agentMemory` — tenant-scoped, 90-day rolling, 16 KB payload cap (Decision 36).
  - `agentAuditLog` — hash-only metadata, 18-month retention.
  - `agentAuditLogInputs` (NEW §5.1.1) — opt-in full-input sidecar, 90-day retention, cascade-deleted with the parent audit row (Decision 28).
  - `externalApiTokens` (flagged) — scoped token auth for MCP (`scope ∈ {"read","write"}`, Decision 29).
  - `agentBlobStorage` (flagged) — large-artifact storage deferred to Phase 8 (Decision 36).
- **Two adapters:** native (`nativeAdapter.ts`) for internal Claude agents; MCP (`mcpAdapter.ts`) for external integrations, authenticated via scoped `externalApiTokens` (Decision 29) and rate-limited at both per-token and per-org tiers via the existing Redis-backed `rateLimiter.ts` (Decision 30). Both invoke the same registry + executor — no forked code paths.
- **Memory tools** `memory.recall` / `recallPrefix` / `remember` / `forget` / `forgetPrefix` — all autonomous tier; orgScope + tenant-partition enforced; 16 KB payload cap (Decision 36).
- **Distributor-facing tRPC procedures** for `agentMemory.*` and `agentAudit.*` — dashboard-only (Phase 8 UI).
- **Queue infrastructure:** Redis + BullMQ on AWS ElastiCache (`cache.t4g.small`, ≈$25/month) — provisioned in Phase 1 infra setup (Decision 27). `bullmq` npm dependency added.
- **Conversation framework DEFERRED** entirely to Phase 8 (Decision 32) — Task 4 commits only to the conversation ID shape and transcript-vs-memory separation.

**Worked examples from Tasks 2 and 3 (§8.1):** `pricing.calculate` (sync, autonomous, opts in to `auditRetainFullInput: true` for billing-dispute reproducibility), `zones.create` (sync, logged, reversal to `zones.delete`), `zones.delete` (sync, approval_required). The pattern covers both cleanly without special cases.

**Resolved open questions (§9):**

| # | Topic | Resolution | Decision |
|---|---|---|---|
| 9.1 | Queue infrastructure | AWS ElastiCache Redis + BullMQ | **27** |
| 9.2 | Audit full-input retention | Per-tool `auditRetainFullInput` opt-in, 90-day sidecar | **28** |
| 9.3 | MCP token scopes | `scope ∈ {"read","write"}`; readOnly+autonomous for read | **29** |
| 9.4 | MCP rate limiting | Per-token (60/min) + per-org (300/min) via rateLimiter.ts | **30** |
| 9.5 | Agent ID format | Free-form `varchar(64)` + CI lint against constants file | **31** |
| 9.6 | Conversation transcripts | Deferred entirely to Phase 8 | **32** |
| 9.7 | Approval expiry | Per-tool `approvalExpiryMs`, 24h default, 7-day hard max | **33** |
| 9.8 | Risk-tier dynamic escalation | Static; split tools when needed | **34** |
| 9.9 | Native-adapter approval resumption | Human-initiated only; `toolApprovalResolved` event | **35** |
| 9.10 | Memory value size cap | Reject at 16 KB; `agentBlobStorage` deferred to Phase 8 | **36** |

**Phase 2 unblock status:** Task 4 provides the agent-tool pattern that Task 3 §5 assumed. Phase 2 can proceed to declare `zones.*` tools against this pattern without waiting for Phase 8 implementation — the declarations are inert until Phase 8 builds the registry and executor, but the shape is locked today.

**Phase 1 infra impact:** Phase 1 scope gains the ElastiCache Redis provisioning and BullMQ dependency per Decision 27. See §8.3 Phase 1 checklist.

**Phase 8 unblock status:** Phase 8 implementation begins after Phase 7 closes its gate. All 10 §9 open questions are now resolved; no Task 4 items block Phase 8 open.
