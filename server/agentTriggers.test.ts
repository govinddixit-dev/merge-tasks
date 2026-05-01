/**
 * Agent Triggers & Agent Plumbing Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the proactive-agent layer:
 *
 *   1. New email-drafting triggers (8) call runEmailAgentAction with the
 *      correct triggerType, entityId, recipient email, and a prompt that
 *      mentions the key context variables.
 *   2. Regression guard — the 3 pre-existing triggers (onStoreCreated,
 *      onStoreLowEngagement, onCustomOrderRequestCreated) still call
 *      runAgentAction with the correct triggerType.
 *   3. getAgentMemoryContext() works for non-store trigger types: returns
 *      a non-empty string when training data exists, empty otherwise.
 *   4. runEmailAgentAction deduplication: when a pending action already
 *      exists for the same (triggerType, entityId) within 7 days, no new
 *      pending action is inserted.
 *
 * The DB and the LLM are mocked. These are unit-level tests — no real
 * database or network traffic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock ENV (required before any import that touches _core/env) ────────────
vi.mock("./_core/env", () => ({
  ENV: {
    jwtSecret: "test-jwt-secret-32-chars-minimum!!",
    sessionSecret: "test-session-secret",
    databaseUrl: undefined,
    openaiApiKey: "sk-test-openai",
    stripeSecretKey: undefined,
    anthropicApiKey: "",
    geminiApiKey: "",
    appOpenAiApiKey: "sk-test-openai",
    openaiZeroDataRetention: false,
    llmProvider: "openai",
    llmApiUrl: "",
    llmApiKey: "sk-test-openai",
    llmModel: "",
    llmMaxTokens: 4096,
    llmTemperature: 0,
    llmFallbackProvider: "",
    llmFallbackApiUrl: "",
    llmFallbackApiKey: "",
    llmFallbackModel: "",
  },
}));

/* ============================================================================
 * Suite 1 + 2 — Trigger dispatch tests
 *
 * Mock agentActions so we can spy on runAgentAction / runEmailAgentAction
 * without hitting safeLLM or the DB.
 * ========================================================================== */

vi.mock("./utils/agentActions", () => ({
  runAgentAction: vi.fn(async () => undefined),
  runEmailAgentAction: vi.fn(async () => undefined),
}));

// onPredictiveOpportunityDetected fetches client industry, order history,
// and the distributor voice profile. We stub the database and memory
// modules at module level so Suite 1 tests never touch real IO. Suites
// 3/4 use vi.doMock after vi.resetModules() and override these stubs
// on a per-test basis.
vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
}));
vi.mock("./routers/copilotMemory", () => ({
  buildMemoryContext: vi.fn(async () => ({
    recentTasks: [],
    preferences: {},
    conversationSummaries: [],
    distributorProfile: "",
    catalogSummary: "",
    clientSummary: "",
  })),
  formatMemoryForPrompt: vi.fn(() => ""),
}));

import {
  onCustomOrderRequestCreated,
  onStoreCreated,
  onStoreLowEngagement,
  onProposalViewed,
  onProposalAccepted,
  onInvoiceOverdue,
  onClientDormant,
  onReorderWindowApproaching,
  onNewClientCreated,
  onOrderDelivered,
  onProposalExpiringSoon,
  onPredictiveOpportunityDetected,
} from "./utils/agentTriggers";
import { runAgentAction, runEmailAgentAction } from "./utils/agentActions";

describe("Agent Triggers — New Email-Drafting Triggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("onProposalViewed calls runEmailAgentAction with proposal_viewed context", async () => {
    await onProposalViewed(42, 10, "client@acme.com", "Jane Doe", "Spring Merch Refresh", 5000);
    expect(runEmailAgentAction).toHaveBeenCalledTimes(1);
    const arg = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      triggerType: "proposal_viewed",
      entityId: 42,
      organizationId: 10,
      to: "client@acme.com",
    });
    expect(arg.prompt).toContain("Jane Doe");
    expect(arg.prompt).toContain("Spring Merch Refresh");
    expect(arg.prompt).toContain("$5000.00");
  });

  it("onProposalAccepted calls runEmailAgentAction with proposal_accepted context", async () => {
    await onProposalAccepted(7, null, "ops@acme.com", "Sam Lead", "Uniform Order Q2");
    expect(runEmailAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "proposal_accepted",
        entityId: 7,
        to: "ops@acme.com",
      }),
    );
    const prompt = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt;
    expect(prompt).toContain("Sam Lead");
    expect(prompt).toContain("Uniform Order Q2");
    expect(prompt).toMatch(/proof|production|next steps/i);
  });

  it("onInvoiceOverdue calls runEmailAgentAction and tone scales with daysOverdue", async () => {
    await onInvoiceOverdue(99, 10, "ap@acme.com", "Acme Inc", 1234.56, 2);
    const friendly = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(friendly.triggerType).toBe("invoice_overdue");
    expect(friendly.prompt).toContain("$1234.56");
    expect(friendly.prompt).toMatch(/friendly/i);

    vi.clearAllMocks();
    await onInvoiceOverdue(99, 10, "ap@acme.com", "Acme Inc", 1234.56, 30);
    const formal = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(formal.prompt).toMatch(/formal/i);
  });

  it("onClientDormant calls runEmailAgentAction with client_dormant context", async () => {
    await onClientDormant(
      55,
      3,
      "buyer@acme.com",
      "Acme Corp",
      120,
      "2 previous orders, most recent 120 days ago (approx $4500.00)",
    );
    expect(runEmailAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "client_dormant",
        entityId: 55,
        to: "buyer@acme.com",
      }),
    );
    const prompt = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt;
    expect(prompt).toContain("Acme Corp");
    expect(prompt).toContain("120");
    expect(prompt).toContain("2 previous orders");
  });

  it("onReorderWindowApproaching calls runEmailAgentAction with reorder_window context", async () => {
    const lastOrderDate = new Date("2025-04-15T00:00:00Z");
    await onReorderWindowApproaching(
      88,
      null,
      "purchasing@acme.com",
      "Acme Corp",
      lastOrderDate,
      "Order MT-12345",
    );
    const arg = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.triggerType).toBe("reorder_window");
    expect(arg.entityId).toBe(88);
    expect(arg.prompt).toContain("2025-04-15");
    expect(arg.prompt).toContain("Order MT-12345");
  });

  it("onNewClientCreated calls runEmailAgentAction with new_client context + industry", async () => {
    await onNewClientCreated(11, 4, "new@acme.com", "Lee Partner", "Tech SaaS");
    const arg = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.triggerType).toBe("new_client");
    expect(arg.entityId).toBe(11);
    expect(arg.organizationId).toBe(4);
    expect(arg.prompt).toContain("Lee Partner");
    expect(arg.prompt).toContain("Tech SaaS");
  });

  it("onNewClientCreated omits industry line when industry is null", async () => {
    await onNewClientCreated(12, null, "new@acme.com", "Lee Partner", null);
    const prompt = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt;
    expect(prompt).toContain("Lee Partner");
    expect(prompt).not.toContain("Industry:");
  });

  it("onOrderDelivered calls runEmailAgentAction with order_delivered context", async () => {
    await onOrderDelivered(200, null, "recv@acme.com", "Sam Receiver", "Order MT-9999");
    expect(runEmailAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "order_delivered",
        entityId: 200,
        to: "recv@acme.com",
      }),
    );
    const prompt = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt;
    expect(prompt).toContain("Sam Receiver");
    expect(prompt).toContain("Order MT-9999");
    expect(prompt).toMatch(/7 days|check-in|feedback/i);
  });

  it("onProposalExpiringSoon calls runEmailAgentAction with proposal_expiring context", async () => {
    await onProposalExpiringSoon(7, 10, "client@acme.com", "Jane Doe", "Spring Merch Refresh", 2);
    const arg = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.triggerType).toBe("proposal_expiring");
    expect(arg.entityId).toBe(7);
    expect(arg.prompt).toContain("Spring Merch Refresh");
    expect(arg.prompt).toContain("2");
  });

  it("new triggers propagate suppressNotification when called from the cron", async () => {
    await onProposalViewed(1, null, "x@y.com", "X", "P", null, { suppressNotification: true });
    await onInvoiceOverdue(1, null, "x@y.com", "X", 100, 5, { suppressNotification: true });
    for (const call of (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0].suppressNotification).toBe(true);
    }
  });

  it("onPredictiveOpportunityDetected calls runEmailAgentAction with patternSummary in the prompt", async () => {
    await onPredictiveOpportunityDetected(
      321,
      10,
      "buyer@acme.com",
      "Acme Corp",
      "Orders every ~90 days, last order March 2026, next window predicted June 2026",
      4800,
      0.87,
      /* ownerId */ 42,
    );
    expect(runEmailAgentAction).toHaveBeenCalledTimes(1);
    const arg = (runEmailAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      triggerType: "predictive_opportunity",
      entityId: 321,
      organizationId: 10,
      to: "buyer@acme.com",
    });
    expect(arg.prompt).toContain(
      "Orders every ~90 days, last order March 2026, next window predicted June 2026",
    );
    expect(arg.prompt).toContain("Acme Corp");
    expect(arg.prompt).toContain("87%");
    expect(arg.extraArgs).toMatchObject({
      patternSummary:
        "Orders every ~90 days, last order March 2026, next window predicted June 2026",
      predictedValue: 4800,
    });
  });
});

describe("Agent Triggers — Regression Guard (pre-existing triggers)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("onStoreCreated still calls runAgentAction with store_created triggerType", async () => {
    await onStoreCreated(123, 10);
    expect(runAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "store_created",
        entityId: 123,
        organizationId: 10,
      }),
    );
    expect(runEmailAgentAction).not.toHaveBeenCalled();
  });

  it("onStoreLowEngagement still calls runAgentAction with store_low_engagement triggerType", async () => {
    await onStoreLowEngagement(123, 10, 21);
    expect(runAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "store_low_engagement",
        entityId: 123,
      }),
    );
    const prompt = (runAgentAction as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt;
    expect(prompt).toContain("21");
  });

  it("onCustomOrderRequestCreated still calls runAgentAction with custom_order_request triggerType", async () => {
    await onCustomOrderRequestCreated(555, null);
    expect(runAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "custom_order_request",
        entityId: 555,
      }),
    );
  });
});

/* ============================================================================
 * Suite 3 — Agent Memory: non-store trigger types
 *
 * Use isolateModules so we can re-mock the DB per-test without the already-
 * imported trigger module re-resolving its agentActions mock.
 * ========================================================================== */

describe("Agent Memory — Non-Store Context Retrieval", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadMemoryModuleWithDb(dbRows: unknown[] | null) {
    // Build a select chain that terminates in .limit() → rows (or throws when null).
    const dbMock = dbRows === null
      ? null
      : {
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => Promise.resolve(dbRows),
                }),
              }),
            }),
          }),
          // Used inside the store-scoped branch (inArray subquery)
        };

    vi.doMock("./db", () => ({
      getDb: vi.fn(async () => dbMock),
    }));
    return await import("./utils/agentMemory");
  }

  it("returns non-empty context for non-store triggerType when training data exists", async () => {
    const now = new Date();
    const mod = await loadMemoryModuleWithDb([
      {
        entityId: 42,
        aiOutput: { summary: "Follow-up after proposal viewed" },
        wasAccepted: true,
        wasEdited: false,
        createdAt: now,
      },
      {
        entityId: 43,
        aiOutput: { summary: "Expiry reminder" },
        wasAccepted: false,
        wasEdited: true,
        createdAt: now,
      },
    ]);

    const ctx = await mod.getAgentMemoryContext(0, "proposal_viewed", 999);
    expect(ctx).not.toBe("");
    expect(ctx).toContain("Follow-up after proposal viewed");
    expect(ctx).toContain("accepted");
    expect(ctx).toContain("Expiry reminder");
    expect(ctx).toContain("(edited)");
  });

  it("returns empty string when no training data exists for non-store triggerType", async () => {
    const mod = await loadMemoryModuleWithDb([]);
    const ctx = await mod.getAgentMemoryContext(0, "invoice_overdue", 999);
    expect(ctx).toBe("");
  });

  it("returns empty string when ownerId is missing for non-store triggerType", async () => {
    const mod = await loadMemoryModuleWithDb([]);
    const ctx = await mod.getAgentMemoryContext(0, "client_dormant");
    expect(ctx).toBe("");
  });

  it("returns empty string when DB is unavailable", async () => {
    const mod = await loadMemoryModuleWithDb(null);
    const ctx = await mod.getAgentMemoryContext(0, "proposal_viewed", 999);
    expect(ctx).toBe("");
  });
});

/* ============================================================================
 * Suite 4 — Email-wrapper deduplication
 *
 * runEmailAgentAction checks copilotPendingActions for a recent row and
 * returns early (no insert) when one exists. We verify that the insert
 * was never called when the dedup query returns a row.
 * ========================================================================== */

describe("Agent Actions — Email Wrapper Deduplication", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * Build a drizzle-style chainable db mock whose select().from() consumes
   * one row-set from the supplied queue. The returned chain supports every
   * shape runEmailAgentAction uses:
   *   - `await select().from().where().limit()`
   *   - `await select().from().where()`        (aggregation, no LIMIT)
   *   - `await select().from().where().orderBy().limit()`
   * Each select() call consumes exactly one entry from `selectResults`.
   */
  function makeChainableDb(selectResults: Array<Array<unknown>>, insertMock: ReturnType<typeof vi.fn>) {
    let idx = 0;
    const nextPromise = () => {
      const next = selectResults[idx] ?? [];
      idx += 1;
      return Promise.resolve(next);
    };
    // Attach chain methods directly onto the Promise so it stays natively
    // thenable. Awaiting the chain resolves to the next queued row-set,
    // while .where()/.orderBy()/.groupBy() return the same chain and
    // .limit() unwraps back to the bare promise — matching every drizzle
    // call shape runEmailAgentAction uses without needing `any` casts.
    const buildChain = () => {
      const promise = nextPromise();
      const chain = Object.assign(promise, {
        where: () => chain,
        limit: () => promise,
        orderBy: () => chain,
        groupBy: () => chain,
      });
      return chain;
    };
    return {
      select: () => ({ from: () => buildChain() }),
      insert: () => ({ values: insertMock }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    };
  }

  async function loadActionsWithDedupBehavior(options: {
    dedupRows: Array<{ id: number }>;
    recipientCountRow?: Array<{ count: number }>;
  }) {
    // runEmailAgentAction consumes select() calls in this order:
    //   1. owner lookup (orgMembers) → [{userId: 77}]
    //   2. dedup check (copilotPendingActions) → dedupRows
    //   3. if `to` present and step 2 returned empty: recipient count
    //      (copilotPendingActions, COUNT aggregate) → recipientCountRow
    const ownerRows = [{ userId: 77 }];
    const selectSequence: Array<Array<unknown>> = [
      ownerRows,
      options.dedupRows,
      options.recipientCountRow ?? [{ count: 0 }],
    ];

    const insertMock = vi.fn(async () => [{ insertId: 1 }]);
    const dbMock = makeChainableDb(selectSequence, insertMock);

    // Override the module-level vi.mock("./utils/agentActions", …) used by
    // Suites 1 + 2 so the dedup tests exercise the real wrapper.
    vi.doMock("./utils/agentActions", async () => {
      const actual = await vi.importActual<typeof import("./utils/agentActions")>(
        "./utils/agentActions",
      );
      return actual;
    });
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => dbMock) }));
    vi.doMock("./_core/safeLLM", () => ({
      safeLLM: vi.fn(async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "test summary",
                subject: "test subject",
                draft: "test body",
                toolName: "send_custom_email",
                confidence: 0.8,
              }),
            },
          },
        ],
      })),
    }));
    vi.doMock("./_core/notification", () => ({
      notifyOwner: vi.fn(async () => true),
    }));
    vi.doMock("./utils/agentMemory", () => ({
      getAgentMemoryContext: vi.fn(async () => ""),
    }));
    // V2: runEmailAgentAction pulls the distributor voice profile from the
    // shared copilot memory layer. Tests stub it with a predictable block
    // so they can assert on the injected `## Distributor Context` heading
    // without exercising copilotMemory's own DB reads.
    vi.doMock("./routers/copilotMemory", () => ({
      buildMemoryContext: vi.fn(async () => ({
        recentTasks: [],
        preferences: {},
        conversationSummaries: [],
        distributorProfile: "Acme Merch Co — branded apparel distributor",
        catalogSummary: "",
        clientSummary: "",
      })),
      formatMemoryForPrompt: vi.fn(
        () => "## Your Distributor\nAcme Merch Co — branded apparel distributor",
      ),
    }));

    const mod = await import("./utils/agentActions");
    return { mod, insertMock };
  }

  it("skips insert when a recent pending action already exists (7-day dedup)", async () => {
    const { mod, insertMock } = await loadActionsWithDedupBehavior({
      dedupRows: [{ id: 999 }],
    });
    await mod.runEmailAgentAction({
      triggerType: "proposal_viewed",
      entityId: 42,
      organizationId: 10,
      prompt: "dummy prompt",
      to: "x@y.com",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts a pending action when no recent duplicate exists", async () => {
    const { mod, insertMock } = await loadActionsWithDedupBehavior({
      dedupRows: [],
    });
    await mod.runEmailAgentAction({
      triggerType: "proposal_viewed",
      entityId: 42,
      organizationId: 10,
      prompt: "dummy prompt",
      to: "x@y.com",
    });
    // insertMock is called twice: once for copilotPendingActions, once for aiTrainingData.
    expect(insertMock).toHaveBeenCalled();
    const firstInsertArg = insertMock.mock.calls[0][0];
    expect(firstInsertArg).toMatchObject({
      toolName: "send_custom_email",
      source: "agent",
      status: "pending",
    });
    const args = JSON.parse(firstInsertArg.serializedArgs);
    expect(args).toMatchObject({
      to: "x@y.com",
      subject: "test subject",
      body: "test body",
      triggerType: "proposal_viewed",
      entityId: 42,
    });
  });

  it("does not insert when the LLM response is missing required fields", async () => {
    vi.resetModules();
    // Same chainable mock as the other dedup tests: owner lookup → no-dedup
    // → zero recent recipient actions. The LLM response is missing `subject`,
    // so the wrapper must bail after the safeLLM call without inserting.
    const insertMock = vi.fn(async () => [{ insertId: 1 }]);
    const dbMock = makeChainableDb(
      [[{ userId: 77 }], [], [{ count: 0 }]],
      insertMock,
    );

    vi.doMock("./utils/agentActions", async () => {
      const actual = await vi.importActual<typeof import("./utils/agentActions")>(
        "./utils/agentActions",
      );
      return actual;
    });
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => dbMock) }));
    vi.doMock("./_core/safeLLM", () => ({
      safeLLM: vi.fn(async () => ({
        choices: [{ message: { content: '{"summary":"x","draft":"y"}' } }],
      })),
    }));
    vi.doMock("./_core/notification", () => ({ notifyOwner: vi.fn(async () => true) }));
    vi.doMock("./utils/agentMemory", () => ({ getAgentMemoryContext: vi.fn(async () => "") }));
    vi.doMock("./routers/copilotMemory", () => ({
      buildMemoryContext: vi.fn(async () => ({
        recentTasks: [],
        preferences: {},
        conversationSummaries: [],
        distributorProfile: "",
        catalogSummary: "",
        clientSummary: "",
      })),
      formatMemoryForPrompt: vi.fn(() => ""),
    }));

    const mod = await import("./utils/agentActions");
    await mod.runEmailAgentAction({
      triggerType: "proposal_viewed",
      entityId: 42,
      organizationId: 10,
      prompt: "dummy prompt",
      to: "x@y.com",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });
});

/* ============================================================================
 * Suite 4 — V2 additions
 *
 * Covers the three observable changes V2 layered onto runEmailAgentAction:
 *   • distributor voice profile injection under a `## Distributor Context`
 *     heading on the user prompt,
 *   • confidence carried through to copilotPendingActions.serializedArgs,
 *   • confidence defaulting to 0.75 when the LLM omits it.
 * ========================================================================== */

describe("Agent Actions — V2 Email Wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function makeChainableDb(selectResults: Array<Array<unknown>>, insertMock: ReturnType<typeof vi.fn>) {
    let idx = 0;
    const nextPromise = () => {
      const next = selectResults[idx] ?? [];
      idx += 1;
      return Promise.resolve(next);
    };
    const buildChain = () => {
      const promise = nextPromise();
      const chain = Object.assign(promise, {
        where: () => chain,
        limit: () => promise,
        orderBy: () => chain,
        groupBy: () => chain,
      });
      return chain;
    };
    return {
      select: () => ({ from: () => buildChain() }),
      insert: () => ({ values: insertMock }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    };
  }

  /**
   * Boot runEmailAgentAction with a happy-path DB, a caller-specified
   * LLM response JSON, and a caller-specified distributor voice block.
   * Returns the stubbed safeLLM so tests can assert on what the LLM saw.
   */
  async function loadWithVoice(options: {
    voiceBlock: string;
    llmResponse: Record<string, unknown>;
  }) {
    const insertMock = vi.fn(async () => [{ insertId: 1 }]);
    const dbMock = makeChainableDb(
      [[{ userId: 77 }], [], [{ count: 0 }]],
      insertMock,
    );
    const safeLLMSpy = vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify(options.llmResponse) } }],
    }));

    vi.doMock("./utils/agentActions", async () => {
      const actual = await vi.importActual<typeof import("./utils/agentActions")>(
        "./utils/agentActions",
      );
      return actual;
    });
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => dbMock) }));
    vi.doMock("./_core/safeLLM", () => ({ safeLLM: safeLLMSpy }));
    vi.doMock("./_core/notification", () => ({ notifyOwner: vi.fn(async () => true) }));
    vi.doMock("./utils/agentMemory", () => ({ getAgentMemoryContext: vi.fn(async () => "") }));
    vi.doMock("./routers/copilotMemory", () => ({
      buildMemoryContext: vi.fn(async () => ({
        recentTasks: [],
        preferences: {},
        conversationSummaries: [],
        distributorProfile: options.voiceBlock ? "stub" : "",
        catalogSummary: "",
        clientSummary: "",
      })),
      formatMemoryForPrompt: vi.fn(() => options.voiceBlock),
    }));

    const mod = await import("./utils/agentActions");
    return { mod, insertMock, safeLLMSpy };
  }

  it("injects the distributor voice profile under a ## Distributor Context heading", async () => {
    const { mod, safeLLMSpy } = await loadWithVoice({
      voiceBlock: "## Your Distributor\nAcme Merch Co — branded apparel distributor",
      llmResponse: {
        summary: "Follow-up for viewed proposal",
        subject: "Quick follow-up",
        draft: "Hi there, just checking in…",
        toolName: "send_custom_email",
        confidence: 0.82,
      },
    });

    await mod.runEmailAgentAction({
      triggerType: "proposal_viewed",
      entityId: 42,
      organizationId: 10,
      prompt: "Client Alice Smith just viewed proposal #42.",
      to: "alice@example.com",
    });

    expect(safeLLMSpy).toHaveBeenCalled();
    const callArg = safeLLMSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = callArg.messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain("## Distributor Context");
    expect(userMessage?.content).toContain("Acme Merch Co");
    // Trigger-specific context must still ride along after the voice block.
    expect(userMessage?.content).toContain("Alice Smith just viewed proposal");
  });

  it("omits the ## Distributor Context heading when memory returns nothing", async () => {
    const { mod, safeLLMSpy } = await loadWithVoice({
      voiceBlock: "",
      llmResponse: {
        summary: "Welcome email",
        subject: "Welcome",
        draft: "Hi there…",
        toolName: "send_custom_email",
        confidence: 0.9,
      },
    });

    await mod.runEmailAgentAction({
      triggerType: "new_client",
      entityId: 7,
      organizationId: 10,
      prompt: "New client introduction prompt.",
      to: "new@example.com",
    });

    const callArg = safeLLMSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = callArg.messages.find((m) => m.role === "user");
    expect(userMessage?.content).not.toContain("## Distributor Context");
    expect(userMessage?.content).toContain("New client introduction prompt");
  });

  it("persists confidence from the LLM response into serializedArgs", async () => {
    const { mod, insertMock } = await loadWithVoice({
      voiceBlock: "",
      llmResponse: {
        summary: "Reorder nudge",
        subject: "It's been a year",
        draft: "Hi friend…",
        toolName: "send_custom_email",
        confidence: 0.92,
      },
    });

    await mod.runEmailAgentAction({
      triggerType: "reorder_window",
      entityId: 55,
      organizationId: 10,
      prompt: "Reorder-window prompt.",
      to: "reorder@example.com",
    });

    const firstInsertArg = insertMock.mock.calls[0][0] as { serializedArgs: string };
    const args = JSON.parse(firstInsertArg.serializedArgs) as {
      confidence: number;
      to: string;
      subject: string;
      body: string;
    };
    expect(args.confidence).toBeCloseTo(0.92);
    expect(args.to).toBe("reorder@example.com");
    expect(args.subject).toBe("It's been a year");
    expect(args.body).toBe("Hi friend…");
  });

  it("defaults confidence to 0.75 when the LLM response omits it", async () => {
    const { mod, insertMock } = await loadWithVoice({
      voiceBlock: "",
      llmResponse: {
        summary: "Overdue invoice nudge",
        subject: "Quick reminder",
        draft: "Hi there…",
        toolName: "send_custom_email",
        // No `confidence` key — wrapper must default to 0.75.
      },
    });

    await mod.runEmailAgentAction({
      triggerType: "invoice_overdue",
      entityId: 88,
      organizationId: 10,
      prompt: "Invoice overdue prompt.",
      to: "pastdue@example.com",
    });

    const firstInsertArg = insertMock.mock.calls[0][0] as { serializedArgs: string };
    const args = JSON.parse(firstInsertArg.serializedArgs) as { confidence: number };
    expect(args.confidence).toBeCloseTo(0.75);
  });
});

/* ============================================================================
 * Suite 5 — Pattern Detection Engine
 *
 * detectReorderPatterns() reads the client's order history from the DB and
 * returns a forecast (or null). The DB is mocked with a chainable promise
 * that resolves to the supplied order rows.
 * ========================================================================== */

describe("Pattern Detection — detectReorderPatterns", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * Build a drizzle-style DB mock whose `select().from().where().orderBy()`
   * chain resolves to `orderRows`. Every terminal (await on the chain,
   * .orderBy(), .limit()) resolves to the same single result — fine for
   * patternDetection, which only makes one query.
   */
  function makeOrdersDb(orderRows: Array<{ createdAt: Date; total: string | number }>) {
    const promise = Promise.resolve(orderRows);
    const chain = Object.assign(promise, {
      where: () => chain,
      orderBy: () => chain,
      limit: () => promise,
    });
    return { select: () => ({ from: () => chain }) };
  }

  async function loadDetector(orderRows: Array<{ createdAt: Date; total: string | number }>) {
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => makeOrdersDb(orderRows)) }));
    return await import("./utils/patternDetection");
  }

  it("returns null for a client with fewer than 2 orders", async () => {
    const mod = await loadDetector([
      { createdAt: new Date("2026-01-01"), total: "500.00" },
    ]);
    const result = await mod.detectReorderPatterns(42, 10);
    expect(result).toBeNull();
  });

  it("returns null when the DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => null) }));
    const mod = await import("./utils/patternDetection");
    const result = await mod.detectReorderPatterns(42, 10);
    expect(result).toBeNull();
  });

  it("identifies a 90-day interval pattern from evenly-spaced orders", async () => {
    // Four orders at ~90-day intervals → near-zero variance → confidence ≈ 1.
    const start = new Date("2025-06-01T00:00:00Z").getTime();
    const DAY = 24 * 60 * 60 * 1000;
    const rows = [0, 90, 180, 270].map((d, i) => ({
      createdAt: new Date(start + d * DAY),
      total: String(1000 + i * 100),
    }));
    const mod = await loadDetector(rows);
    const result = await mod.detectReorderPatterns(42, 10);
    expect(result).not.toBeNull();
    expect(result!.patternSummary).toMatch(/~90 days/);
    expect(result!.confidence).toBeGreaterThan(0.9);
    // Predicted window centers around last + 90d.
    const lastOrderMs = rows[rows.length - 1].createdAt.getTime();
    expect(result!.predictedWindowStart.getTime()).toBeGreaterThan(lastOrderMs);
    // Estimated value = mean of totals.
    expect(result!.estimatedValue).toBeCloseTo((1000 + 1100 + 1200 + 1300) / 4);
  });

  it("identifies a seasonal pattern when orders cluster in the same month across years", async () => {
    // June 2023, July 2023, June 2024, June 2025 → dominant month is June
    // with 3 orders spanning 3 distinct years → seasonal confidence 3/4.
    // Interval gaps are 30, 334, 365 days — high variance, low interval
    // confidence → seasonal wins.
    const rows = [
      { createdAt: new Date("2023-06-15T00:00:00Z"), total: "2000.00" },
      { createdAt: new Date("2023-07-15T00:00:00Z"), total: "2100.00" },
      { createdAt: new Date("2024-06-15T00:00:00Z"), total: "2200.00" },
      { createdAt: new Date("2025-06-15T00:00:00Z"), total: "2300.00" },
    ];
    const mod = await loadDetector(rows);
    const result = await mod.detectReorderPatterns(42, 10);
    expect(result).not.toBeNull();
    expect(result!.patternSummary).toMatch(/June/);
    expect(result!.patternSummary).toMatch(/typically in June/i);
    expect(result!.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result!.predictedWindowStart.getUTCMonth()).toBe(5); // June
  });
});

/* ============================================================================
 * Suite 6 — Predictive Cron Scan Deduplication
 *
 * scanPredictiveOpportunities() must not fire more than one prediction per
 * client per calendar month. We verify that when a predictive action row
 * already exists this month, the trigger is skipped entirely.
 * ========================================================================== */

describe("Agent Cron — scanPredictiveOpportunities dedup", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function makeChainableDb(selectResults: Array<Array<unknown>>) {
    let idx = 0;
    const nextPromise = () => {
      const next = selectResults[idx] ?? [];
      idx += 1;
      return Promise.resolve(next);
    };
    const buildChain = () => {
      const promise = nextPromise();
      const chain = Object.assign(promise, {
        where: () => chain,
        limit: () => promise,
        orderBy: () => chain,
        groupBy: () => chain,
      });
      return chain;
    };
    return { select: () => ({ from: () => buildChain() }) };
  }

  it("skips a client when a predictive action already exists this month", async () => {
    const triggerSpy = vi.fn(async () => undefined);

    // Pattern hits both the confidence floor and the 45-day window so the
    // scan reaches the dedup gate; otherwise it would short-circuit earlier.
    const DAY = 24 * 60 * 60 * 1000;
    vi.doMock("./utils/patternDetection", () => ({
      detectReorderPatterns: vi.fn(async () => ({
        predictedWindowStart: new Date(Date.now() + 14 * DAY),
        predictedWindowEnd: new Date(Date.now() + 28 * DAY),
        confidence: 0.85,
        patternSummary: "Orders every ~90 days",
        estimatedValue: 3000,
      })),
    }));

    // Stub every trigger imported by agentCron; only the predictive one
    // matters for assertions, the rest stand in for module-shape.
    vi.doMock("./utils/agentTriggers", () => ({
      onStoreLowEngagement: vi.fn(async () => undefined),
      onInvoiceOverdue: vi.fn(async () => undefined),
      onClientDormant: vi.fn(async () => undefined),
      onReorderWindowApproaching: vi.fn(async () => undefined),
      onProposalExpiringSoon: vi.fn(async () => undefined),
      onProposalViewed: vi.fn(async () => undefined),
      onPredictiveOpportunityDetected: triggerSpy,
    }));

    vi.doMock("./_core/notification", () => ({
      notifyOwner: vi.fn(async () => true),
    }));

    // Queue matches the scan's DB call order: client list → active
    // proposals (none) → pending orders (none) → dedup hit (non-empty).
    // The dedup hit means owner resolution never runs.
    const clientRow = {
      id: 77,
      organizationId: 10,
      userId: 5,
      contactEmail: "buyer@acme.com",
      contactName: "Acme Corp",
    };
    const dbMock = makeChainableDb([
      [clientRow],
      [],
      [],
      [{ id: 999 }],
    ]);
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => dbMock) }));

    const cron = await import("./jobs/agentCron");
    const pending: Promise<void>[] = [];
    await cron.scanPredictiveOpportunities(dbMock as never, pending);
    await Promise.allSettled(pending);

    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("fires the trigger when no dedup row exists for the current month", async () => {
    const triggerSpy = vi.fn(async () => undefined);
    const DAY = 24 * 60 * 60 * 1000;
    vi.doMock("./utils/patternDetection", () => ({
      detectReorderPatterns: vi.fn(async () => ({
        predictedWindowStart: new Date(Date.now() + 14 * DAY),
        predictedWindowEnd: new Date(Date.now() + 28 * DAY),
        confidence: 0.85,
        patternSummary: "Orders every ~90 days",
        estimatedValue: 3000,
      })),
    }));
    vi.doMock("./utils/agentTriggers", () => ({
      onStoreLowEngagement: vi.fn(async () => undefined),
      onInvoiceOverdue: vi.fn(async () => undefined),
      onClientDormant: vi.fn(async () => undefined),
      onReorderWindowApproaching: vi.fn(async () => undefined),
      onProposalExpiringSoon: vi.fn(async () => undefined),
      onProposalViewed: vi.fn(async () => undefined),
      onPredictiveOpportunityDetected: triggerSpy,
    }));
    vi.doMock("./_core/notification", () => ({
      notifyOwner: vi.fn(async () => true),
    }));

    const clientRow = {
      id: 77,
      organizationId: 10,
      userId: 5,
      contactEmail: "buyer@acme.com",
      contactName: "Acme Corp",
    };
    // Queue: clients → proposals (empty) → orders (empty) → dedup (empty)
    //   → orgMembers owner lookup → [{ userId: 42 }]
    const dbMock = makeChainableDb([
      [clientRow],
      [],
      [],
      [],
      [{ userId: 42 }],
    ]);
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => dbMock) }));

    const cron = await import("./jobs/agentCron");
    const pending: Promise<void>[] = [];
    await cron.scanPredictiveOpportunities(dbMock as never, pending);
    await Promise.allSettled(pending);

    expect(triggerSpy).toHaveBeenCalledTimes(1);
    const triggerArgs = triggerSpy.mock.calls[0];
    expect(triggerArgs[0]).toBe(77); // clientId
    expect(triggerArgs[1]).toBe(10); // organizationId
    expect(triggerArgs[2]).toBe("buyer@acme.com"); // clientEmail
    expect(triggerArgs[3]).toBe("Acme Corp"); // clientName
    expect(triggerArgs[4]).toBe("Orders every ~90 days"); // patternSummary
    expect(triggerArgs[5]).toBe(3000); // predictedValue
    expect(triggerArgs[6]).toBeCloseTo(0.85); // confidence
    expect(triggerArgs[7]).toBe(42); // ownerId
  });
});

/* ============================================================================
 * Suite 7 — Predictive proposal draft creation
 *
 * onPredictiveOpportunityDetected now does two things in parallel: drafts
 * an outreach email (covered above) and creates a ready-to-review proposal
 * draft seeded from the client's most recent order. These tests verify the
 * proposal-draft side-effect without mocking the function directly.
 * ========================================================================== */

describe("Agent Triggers — Predictive proposal draft creation", () => {
  beforeEach(() => {
    vi.resetModules();
    // Suite 6 installs a vi.doMock("./utils/agentTriggers", …) that persists
    // across suites until explicitly undone. Drop it here so the dynamic
    // import below resolves to the real trigger module under test.
    vi.doUnmock("./utils/agentTriggers");
    vi.doUnmock("./utils/patternDetection");
  });

  function makeChainableDb(
    selectResults: Array<Array<unknown>>,
    insertMock: ReturnType<typeof vi.fn>,
  ) {
    let idx = 0;
    const nextPromise = () => {
      const next = selectResults[idx] ?? [];
      idx += 1;
      return Promise.resolve(next);
    };
    const buildChain = () => {
      const promise = nextPromise();
      const chain = Object.assign(promise, {
        where: () => chain,
        limit: () => promise,
        orderBy: () => chain,
        groupBy: () => chain,
        innerJoin: () => chain,
      });
      return chain;
    };
    return {
      select: () => ({ from: () => buildChain() }),
      insert: () => ({ values: insertMock }),
    };
  }

  function stubSharedMocks(dbMock: unknown) {
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => dbMock) }));
    vi.doMock("./utils/agentActions", () => ({
      runAgentAction: vi.fn(async () => undefined),
      runEmailAgentAction: vi.fn(async () => undefined),
    }));
    vi.doMock("./routers/copilotMemory", () => ({
      buildMemoryContext: vi.fn(async () => ({
        recentTasks: [],
        preferences: {},
        conversationSummaries: [],
        distributorProfile: "",
        catalogSummary: "",
        clientSummary: "",
      })),
      formatMemoryForPrompt: vi.fn(() => ""),
    }));
  }

  it("creates a draft proposal seeded from the client's last order", async () => {
    const insertMock = vi.fn(async () => [{ insertId: 777 }]);
    // Select queue (in call order):
    //   1–2: loadPredictiveClientContext — clients, orders (both empty so
    //        it returns safe defaults without ever running the
    //        inner-joined top-products query).
    //   3:   createPredictiveProposalDraft — most recent order lookup.
    //   4:   createPredictiveProposalDraft — orderItems for that order.
    const dbMock = makeChainableDb(
      [
        [],
        [],
        [{ id: 99 }],
        [
          { productId: 10, quantity: 25, unitPrice: "12.50", decorationType: "embroidery" },
          { productId: 11, quantity: 10, unitPrice: "9.00", decorationType: null },
        ],
      ],
      insertMock,
    );
    stubSharedMocks(dbMock);

    const mod = await import("./utils/agentTriggers");
    await mod.onPredictiveOpportunityDetected(
      321,
      10,
      "buyer@acme.com",
      "Acme Corp",
      "Orders every ~90 days",
      4800,
      0.87,
      /* ownerId */ 42,
    );

    // Three inserts: proposals row + proposalProducts rows + agent-inbox
    // pending action row so the distributor sees the draft in their briefing.
    expect(insertMock).toHaveBeenCalledTimes(3);

    const proposalValues = insertMock.mock.calls[0][0] as {
      userId: number;
      organizationId: number | null;
      clientId: number;
      title: string;
      status: string;
      estimatedValue: string;
      deliveryMethod: string;
      proposalType: string;
      viewToken: string;
    };
    expect(proposalValues).toMatchObject({
      userId: 42,
      organizationId: 10,
      clientId: 321,
      status: "draft",
      estimatedValue: "4800.00",
      deliveryMethod: "email",
      proposalType: "promo",
    });
    expect(proposalValues.title).toContain("Reorder");
    expect(proposalValues.title).toContain("Acme Corp");
    const MONTHS = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const now = new Date();
    expect(proposalValues.title).toContain(
      `${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`,
    );
    expect(typeof proposalValues.viewToken).toBe("string");
    expect(proposalValues.viewToken.length).toBeGreaterThan(0);

    const productRows = insertMock.mock.calls[1][0] as Array<{
      proposalId: number;
      productId: number;
      quantity: number;
      unitPrice: string | null;
      decorationType: string | null;
    }>;
    expect(productRows).toHaveLength(2);
    expect(productRows[0]).toMatchObject({
      proposalId: 777,
      productId: 10,
      quantity: 25,
      unitPrice: "12.50",
      decorationType: "embroidery",
    });
    expect(productRows[1]).toMatchObject({
      proposalId: 777,
      productId: 11,
      quantity: 10,
      unitPrice: "9.00",
    });

    const pendingActionValues = insertMock.mock.calls[2][0] as {
      userId: number;
      organizationId: number | null;
      toolCallId: string;
      toolName: string;
      summary: string;
      serializedArgs: string;
      status: string;
      source: string;
    };
    expect(pendingActionValues).toMatchObject({
      userId: 42,
      organizationId: 10,
      toolName: "review_proposal_draft",
      status: "pending",
      source: "agent",
    });
    expect(pendingActionValues.toolCallId).toContain(
      "agent_predictive_proposal_draft_777_",
    );
    expect(pendingActionValues.summary).toContain("Proposal draft ready to review");
    expect(pendingActionValues.summary).toContain("Acme Corp");
    expect(pendingActionValues.summary).toContain("$4,800.00");

    const parsed = JSON.parse(pendingActionValues.serializedArgs) as {
      proposalId: number;
      clientName: string;
      proposalTitle: string;
      estimatedValue: string;
      triggerType: string;
    };
    expect(parsed).toMatchObject({
      proposalId: 777,
      clientName: "Acme Corp",
      estimatedValue: "4800.00",
      triggerType: "predictive_proposal_draft",
    });
    expect(parsed.proposalTitle).toContain("Reorder");
    expect(parsed.proposalTitle).toContain("Acme Corp");
  });

  it("skips proposal creation when the client has no prior orders", async () => {
    const insertMock = vi.fn(async () => [{ insertId: 1 }]);
    // Queue: client → empty; orders → empty; last-order lookup → empty.
    const dbMock = makeChainableDb([[], [], []], insertMock);
    stubSharedMocks(dbMock);

    const mod = await import("./utils/agentTriggers");
    await mod.onPredictiveOpportunityDetected(
      321, 10, "buyer@acme.com", "Acme Corp", "pattern", 1000, 0.8, 42,
    );

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("skips proposal creation when DB is unavailable", async () => {
    const insertMock = vi.fn(async () => [{ insertId: 1 }]);
    stubSharedMocks(null);
    // Override insert wiring — we still assert it was never called.
    vi.doMock("./db", () => ({ getDb: vi.fn(async () => null) }));

    const mod = await import("./utils/agentTriggers");
    await mod.onPredictiveOpportunityDetected(
      321, 10, "buyer@acme.com", "Acme Corp", "pattern", 1000, 0.8, 42,
    );

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("falls back to 0.00 estimatedValue when predictedValue is invalid", async () => {
    const insertMock = vi.fn(async () => [{ insertId: 555 }]);
    const dbMock = makeChainableDb(
      [
        [],
        [],
        [{ id: 50 }],
        [{ productId: 1, quantity: 1, unitPrice: null, decorationType: null }],
      ],
      insertMock,
    );
    stubSharedMocks(dbMock);

    const mod = await import("./utils/agentTriggers");
    await mod.onPredictiveOpportunityDetected(
      321, 10, "buyer@acme.com", "Acme Corp", "pattern", Number.NaN, 0.8, 42,
    );

    const proposalValues = insertMock.mock.calls[0][0] as { estimatedValue: string };
    expect(proposalValues.estimatedValue).toBe("0.00");
  });
});
