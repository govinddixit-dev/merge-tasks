/**
 * agentActions.ts — Core agent action runner.
 *
 * Takes a trigger context, builds a prompt with memory, calls the LLM,
 * then creates a copilotPendingAction for human review.
 *
 * Two entry points:
 *   - runAgentAction()       — generic "suggest_action" proposals (original)
 *   - runEmailAgentAction()  — pre-fills { to, subject, body } so an approved
 *                              action fires send_custom_email immediately
 *                              with no further input from the distributor.
 */

import { getDb } from "../db";
import {
  copilotPendingActions,
  aiTrainingData,
  orgMembers,
} from "../../drizzle/schema";
import { eq, and, like, gte, sql } from "drizzle-orm";
import { safeLLM } from "../_core/safeLLM";
import { notifyOwner } from "../_core/notification";
import { getLogger } from "./logger";
import { getAgentMemoryContext } from "./agentMemory";
import {
  buildMemoryContext,
  formatMemoryForPrompt,
} from "../routers/copilotMemory";

const log = getLogger("agentActions");

const DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Maximum agent-drafted emails per client recipient per 7 days. Protects
 * the distributor's sender reputation and the client's inbox even when
 * multiple triggers (proposal_viewed, proposal_expiring, order_delivered,
 * client_dormant, …) legitimately fire for the same person in the same
 * week. The wrapper short-circuits past this cap without calling the LLM.
 */
const RECIPIENT_RATE_LIMIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECIPIENT_RATE_LIMIT_MAX = 3;

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Resolve the owner (role=owner) user ID for a given organization.
 * Returns null when no org is provided or no owner exists.
 */
async function resolveOwnerId(
  db: Awaited<ReturnType<typeof getDb>>,
  organizationId: number | undefined,
): Promise<number | null> {
  if (!db || !organizationId) return null;
  const ownerRows = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.organizationId, organizationId),
        eq(orgMembers.role, "owner"),
      ),
    )
    .limit(1);
  return ownerRows[0]?.userId ?? null;
}

/**
 * Has a pending action for this (triggerType, entityId) already been created
 * within the last 7 days? Used to avoid duplicate proposals when the same
 * event fires from multiple code paths (e.g. proposal acceptance via public
 * link AND stripe webhook).
 */
async function hasRecentPendingAction(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  triggerType: string,
  entityId: number,
  organizationId: number | undefined,
): Promise<boolean> {
  const conditions = [
    like(copilotPendingActions.toolCallId, `agent_${triggerType}_${entityId}_%`),
    gte(copilotPendingActions.createdAt, new Date(Date.now() - DEDUP_WINDOW_MS)),
  ];
  if (organizationId != null) {
    conditions.push(eq(copilotPendingActions.organizationId, organizationId));
  }
  const rows = await db
    .select({ id: copilotPendingActions.id })
    .from(copilotPendingActions)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

/**
 * Build the `## Distributor Context` block injected into every trigger's
 * user prompt. Pulls the distributor's voice profile (company name,
 * catalog summary, client summary, recent task history, learned
 * preferences) from the shared copilotMemory layer — the same context
 * the reactive copilot uses — so emails the agent drafts sound like
 * the distributor, not a generic template.
 *
 * Returns an empty string when memory has nothing to say so the prompt
 * doesn't carry a dangling header.
 */
async function buildDistributorVoiceBlock(
  ownerId: number,
  organizationId: number | undefined,
): Promise<string> {
  try {
    const memCtx = await buildMemoryContext(ownerId, organizationId ?? null);
    const formatted = formatMemoryForPrompt(memCtx).trim();
    if (!formatted) return "";
    return `## Distributor Context\n${formatted}`;
  } catch (err: unknown) {
    // Memory is opportunistic; a failure must never block the draft.
    log.warn("[agentAction] Failed to build distributor voice context:", err);
    return "";
  }
}

/**
 * Count agent-drafted pending actions (any trigger type) already addressed
 * to `recipientEmail` within the rate-limit window. The `to` address lives
 * inside the serializedArgs JSON column, so we match via JSON_EXTRACT.
 *
 * Scoped to the caller's organization (or the caller's records for solo
 * users) so two distributors who both email the same client aren't
 * cross-throttled.
 */
async function countRecentRecipientActions(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  recipientEmail: string,
  organizationId: number | undefined,
): Promise<number> {
  const since = new Date(Date.now() - RECIPIENT_RATE_LIMIT_WINDOW_MS);
  const conditions = [
    eq(copilotPendingActions.source, "agent"),
    eq(copilotPendingActions.toolName, "send_custom_email"),
    gte(copilotPendingActions.createdAt, since),
    sql`JSON_UNQUOTE(JSON_EXTRACT(${copilotPendingActions.serializedArgs}, '$.to')) = ${recipientEmail}`,
  ];
  if (organizationId != null) {
    conditions.push(eq(copilotPendingActions.organizationId, organizationId));
  }
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(copilotPendingActions)
    .where(and(...conditions));
  return Number(row?.count ?? 0);
}

/* ------------------------------------------------------------------ */
/*  runAgentAction — generic "suggest_action" pending action          */
/* ------------------------------------------------------------------ */

export interface AgentActionInput {
  triggerType: string;
  entityId: number;
  organizationId?: number;
  prompt: string;
  /**
   * When true, skip the per-action in-app notification. The cron job sets
   * this so it can send one consolidated briefing after a scan instead
   * of spamming the bell for every prepared action.
   */
  suppressNotification?: boolean;
}

/**
 * Run an agent action: call LLM with context + memory, create a pending
 * action for human approval, and log training data.
 *
 * Never throws — errors are logged and swallowed.
 */
export async function runAgentAction(input: AgentActionInput): Promise<void> {
  const { triggerType, entityId, organizationId, prompt, suppressNotification } = input;

  try {
    const db = await getDb();
    if (!db) {
      log.warn("[agentAction] Database unavailable, skipping.");
      return;
    }

    const ownerId = await resolveOwnerId(db, organizationId);
    if (!ownerId) {
      log.warn(`[agentAction] No owner found for org=${organizationId}, skipping.`);
      return;
    }

    // Build memory context for richer LLM prompts
    const memoryContext = await getAgentMemoryContext(organizationId ?? 0, triggerType, ownerId);
    const distributorContext = await buildDistributorVoiceBlock(ownerId, organizationId);

    const systemPrompt = `You are an AI agent for MergeTasks, a branded merchandise SaaS platform. ` +
      `You help distributors manage their stores by proactively identifying opportunities and suggesting actions. ` +
      `Always provide a concise summary (1-2 sentences) of what you propose, followed by a detailed draft of the proposed action.\n\n` +
      `Respond with valid JSON only:\n` +
      `{\n` +
      `  "summary": "Brief human-readable summary of the proposed action",\n` +
      `  "draft": "Detailed draft content (email text, config changes, etc.)",\n` +
      `  "toolName": "suggest_action",\n` +
      `  "confidence": 0.0-1.0\n` +
      `}\n\n` +
      (memoryContext ? `== HISTORICAL CONTEXT ==\n${memoryContext}\n\n` : "");

    // Inject the distributor's voice profile into the USER prompt (not
    // the system prompt) so the concrete business details land next to
    // the trigger's specific context, not buried in instructions.
    const userPrompt = distributorContext
      ? `${distributorContext}\n\n${prompt}`
      : prompt;

    const result = await safeLLM(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" as const },
      },
      { organizationId, userId: ownerId },
    );

    const rawContent = result.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : "{}";
    let parsed: { summary?: string; draft?: string; toolName?: string; confidence?: number };
    try {
      parsed = JSON.parse(content);
    } catch {
      log.warn("[agentAction] Failed to parse LLM response:", content);
      return;
    }

    const summary = parsed.summary ?? "AI agent proposal";
    const draft = parsed.draft ?? "";
    const toolName = parsed.toolName ?? "suggest_action";

    // Create the pending action for human review
    const insertResult = await db.insert(copilotPendingActions).values({
      userId: ownerId,
      organizationId: organizationId ?? null,
      toolCallId: `agent_${triggerType}_${entityId}_${Date.now()}`,
      toolName,
      summary,
      serializedArgs: JSON.stringify({
        triggerType,
        entityId,
        draft,
        confidence: parsed.confidence ?? 0.75,
      }),
      status: "pending",
      source: "agent",
    });

    const pendingActionId = insertResult[0].insertId;

    // Log training data for reinforcement learning loop
    try {
      await db.insert(aiTrainingData).values({
        entityType: `agent_${triggerType}`,
        entityId,
        userId: ownerId,
        inputContext: { triggerType, entityId, organizationId, prompt: userPrompt },
        systemPrompt,
        aiOutput: { summary, draft, toolName, confidence: parsed.confidence ?? 0.75 },
        modelId: "gpt-4.1-mini",
        wasAccepted: false,
        wasEdited: false,
      });
    } catch (trainErr: unknown) {
      log.warn("[agentAction] Failed to log training data:", trainErr);
    }

    // Notify the distributor (skipped when the cron is preparing a consolidated briefing)
    if (!suppressNotification) {
      try {
        await notifyOwner({
          userId: ownerId,
          organizationId,
          type: "ai_insight",
          title: "AI Agent Proposal",
          content: summary,
          actionPath: "/agent-inbox",
          actionLabel: "Review Proposal",
          entityId: pendingActionId,
          entityType: "agent_proposal",
        });
      } catch (notifErr: unknown) {
        log.warn("[agentAction] Notification failed:", notifErr);
      }
    }

    log.info(`[agentAction] Created pending action ${pendingActionId} for trigger=${triggerType}, entity=${entityId}`);
  } catch (err: unknown) {
    log.error("[agentAction] Unhandled error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  runEmailAgentAction — pre-filled send_custom_email pending action */
/* ------------------------------------------------------------------ */

export interface EmailAgentActionInput {
  triggerType: string;
  entityId: number;
  organizationId?: number;
  prompt: string;
  /** Recipient email address — pre-filled into serializedArgs.to */
  to: string;
  /** See AgentActionInput.suppressNotification */
  suppressNotification?: boolean;
  /**
   * Additional fields merged into serializedArgs alongside the default
   * { to, subject, body, triggerType, entityId, confidence } payload.
   * Used by triggers that need to surface extra context in the Agent
   * Inbox UI (e.g. predictive_opportunity carries a patternSummary).
   * Reserved keys are not overwritten by callers.
   */
  extraArgs?: Record<string, unknown>;
}

/**
 * Run an email-drafting agent action. The LLM is asked to return a full
 * email (summary + subject + body), and the resulting pending action has
 * `serializedArgs = { to, subject, body, triggerType, entityId }` so that
 * when the distributor approves, executeSendCustomEmail fires immediately
 * with no further input.
 *
 * Never throws — errors are logged and swallowed. If the LLM response
 * cannot be parsed as JSON or is missing required fields (summary, draft,
 * subject), a warning is logged and no pending action is created.
 */
export async function runEmailAgentAction(input: EmailAgentActionInput): Promise<void> {
  const { triggerType, entityId, organizationId, prompt, to, suppressNotification, extraArgs } = input;

  try {
    const db = await getDb();
    if (!db) {
      log.warn("[emailAgent] Database unavailable, skipping.");
      return;
    }

    const ownerId = await resolveOwnerId(db, organizationId);
    if (!ownerId) {
      log.warn(`[emailAgent] No owner found for org=${organizationId}, skipping.`);
      return;
    }

    // Dedup: the same event (proposal accepted, invoice overdue, etc.) can
    // fire from multiple code paths (public link, stripe webhook, etc.).
    // Only create one pending action per (triggerType, entityId) per week.
    if (await hasRecentPendingAction(db, triggerType, entityId, organizationId)) {
      log.info(`[emailAgent] Skipping ${triggerType}/${entityId} — recent pending action already exists.`);
      return;
    }

    // Per-recipient rate limit: no client should receive more than
    // RECIPIENT_RATE_LIMIT_MAX AI-drafted emails in any 7-day window.
    // Checked before the LLM call so we don't burn tokens drafting an email
    // that will be throttled anyway.
    if (to) {
      const recentCount = await countRecentRecipientActions(db, to, organizationId);
      if (recentCount >= RECIPIENT_RATE_LIMIT_MAX) {
        log.warn(
          `[emailAgent] Skipping ${triggerType}/${entityId} — recipient ${to} already has ${recentCount} agent emails in the last 7 days (cap=${RECIPIENT_RATE_LIMIT_MAX}).`,
        );
        return;
      }
    }

    const memoryContext = await getAgentMemoryContext(organizationId ?? 0, triggerType, ownerId);
    const distributorContext = await buildDistributorVoiceBlock(ownerId, organizationId);

    const systemPrompt = `You are an AI agent for MergeTasks, a branded merchandise SaaS platform. ` +
      `You draft professional outbound client emails on behalf of the distributor. ` +
      `Write in a warm, human tone — no marketing jargon, no placeholder brackets like "[Client Name]". ` +
      `Use the actual names and details provided. When the Distributor Context below includes a company name, ` +
      `catalog highlights, or recent task history, let those details shape the voice and sign-off so the email ` +
      `reads as the distributor themselves — not a generic platform.\n\n` +
      `Respond with valid JSON only:\n` +
      `{\n` +
      `  "summary": "One-sentence description of what this email does",\n` +
      `  "subject": "Email subject line (concise, no emoji)",\n` +
      `  "draft": "Full email body text — greeting, message, sign-off",\n` +
      `  "toolName": "send_custom_email",\n` +
      `  "confidence": 0.0-1.0\n` +
      `}\n\n` +
      (memoryContext ? `== HISTORICAL CONTEXT ==\n${memoryContext}\n\n` : "");

    // Distributor voice lives in the USER prompt so the real business
    // details (company name, catalog highlights, prior tasks) sit
    // alongside the trigger-specific facts the LLM needs to ground the
    // draft. Empty when memory has nothing to contribute yet.
    const userPrompt = distributorContext
      ? `${distributorContext}\n\n${prompt}`
      : prompt;

    const result = await safeLLM(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        response_format: { type: "json_object" as const },
      },
      { organizationId, userId: ownerId },
    );

    const rawContent = result.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : "{}";
    let parsed: {
      summary?: string;
      draft?: string;
      subject?: string;
      toolName?: string;
      confidence?: number;
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      log.warn("[emailAgent] Failed to parse LLM response:", content);
      return;
    }

    // Required-field validation — never create a pending action we can't send.
    if (!parsed.summary?.trim() || !parsed.draft?.trim() || !parsed.subject?.trim()) {
      log.warn(`[emailAgent] LLM response missing required fields (triggerType=${triggerType}, entityId=${entityId})`);
      return;
    }

    const summary = parsed.summary.trim();
    const subject = parsed.subject.trim();
    const body = parsed.draft.trim();
    // Default to 0.75 when the LLM omits confidence — matches the
    // threshold the Agent Inbox uses to surface a "high confidence"
    // badge (>= 0.8), so an omitted value sits just below and won't
    // mislead the distributor into auto-trusting a draft.
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.75;

    const insertResult = await db.insert(copilotPendingActions).values({
      userId: ownerId,
      organizationId: organizationId ?? null,
      toolCallId: `agent_${triggerType}_${entityId}_${Date.now()}`,
      toolName: "send_custom_email",
      summary,
      // Shape matches the args expected by executeSendCustomEmail, plus
      // triggerType/entityId/confidence for the Agent Inbox UI — the
      // confidence field drives the "high confidence" badge without
      // requiring a second read from aiTrainingData. Any additional
      // context supplied by the caller via extraArgs (e.g. patternSummary
      // for predictive_opportunity cards) rides alongside; reserved keys
      // are preserved regardless of what the caller passes in.
      serializedArgs: JSON.stringify({
        ...(extraArgs ?? {}),
        to,
        subject,
        body,
        triggerType,
        entityId,
        confidence,
      }),
      status: "pending",
      source: "agent",
    });

    const pendingActionId = insertResult[0].insertId;

    try {
      await db.insert(aiTrainingData).values({
        entityType: `agent_${triggerType}`,
        entityId,
        userId: ownerId,
        inputContext: { triggerType, entityId, organizationId, prompt: userPrompt, to },
        systemPrompt,
        aiOutput: { summary, subject, draft: body, toolName: "send_custom_email", confidence },
        modelId: "gpt-4.1-mini",
        wasAccepted: false,
        wasEdited: false,
      });
    } catch (trainErr: unknown) {
      log.warn("[emailAgent] Failed to log training data:", trainErr);
    }

    if (!suppressNotification) {
      try {
        await notifyOwner({
          userId: ownerId,
          organizationId,
          type: "ai_insight",
          title: "AI drafted an email for your review",
          content: summary,
          actionPath: "/agent-inbox",
          actionLabel: "Review Email",
          entityId: pendingActionId,
          entityType: "agent_email",
        });
      } catch (notifErr: unknown) {
        log.warn("[emailAgent] Notification failed:", notifErr);
      }
    }

    log.info(`[emailAgent] Created pending email action ${pendingActionId} for trigger=${triggerType}, entity=${entityId}`);
  } catch (err: unknown) {
    log.error("[emailAgent] Unhandled error:", err);
  }
}
