/**
 * actionApproval.ts — Copilot Pending Action Approval Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides the tRPC procedures that the client calls when a user clicks
 * Approve or Deny on a copilot approval card.
 *
 * Flow:
 *   1. copilot.ts detects a CONFIRM-tier tool call
 *   2. Serialises the tool call into copilotPendingActions (status = "pending")
 *   3. Returns { awaitingApproval: true, pendingActionId } to the client
 *   4. Client renders an approval card
 *   5. User clicks Approve → approvePendingAction() → executes the tool
 *      User clicks Deny   → denyPendingAction()    → marks as denied
 *   6. Client receives the final tool result and updates the chat
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { copilotPendingActions, aiTrainingData, organizations } from "../../drizzle/schema";
import { executeTool } from "./copilotExec";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";
import { resolveActionDetails } from "../utils/agentActionDetails";

const log = getLogger("actionApproval");

/**
 * Record a predictive_opportunity accept/dismiss outcome under its own
 * entityType so future iterations can tune confidence thresholds from a
 * clean, pattern-specific signal. No-op for actions of any other trigger
 * type. Never throws — feedback logging must not break the approval path.
 */
async function logPredictivePatternFeedback(args: {
  effectiveSerializedArgs: string;
  userId: number;
  wasAccepted: boolean;
  wasEdited: boolean;
}): Promise<void> {
  try {
    const parsed = JSON.parse(args.effectiveSerializedArgs) as Record<string, unknown>;
    if (parsed.triggerType !== "predictive_opportunity") return;

    const db = await getDb();
    if (!db) return;

    const entityIdRaw = parsed.entityId;
    const entityId = typeof entityIdRaw === "number"
      ? entityIdRaw
      : typeof entityIdRaw === "string"
        ? Number.parseInt(entityIdRaw, 10)
        : NaN;
    if (!Number.isFinite(entityId)) return;

    const patternSummary = typeof parsed.patternSummary === "string"
      ? parsed.patternSummary
      : null;
    const confidence = typeof parsed.confidence === "number"
      ? parsed.confidence
      : null;
    const predictedValue = typeof parsed.predictedValue === "number"
      ? parsed.predictedValue
      : null;

    await db.insert(aiTrainingData).values({
      entityType: "predictive_pattern",
      entityId,
      userId: args.userId,
      inputContext: {
        triggerType: "predictive_opportunity",
        clientId: entityId,
        patternSummary,
        confidence,
        predictedValue,
      },
      aiOutput: {
        patternSummary,
        confidence,
        predictedValue,
        subject: typeof parsed.subject === "string" ? parsed.subject : null,
        body: typeof parsed.body === "string" ? parsed.body : null,
      },
      modelId: "predictive-pattern-v1",
      wasAccepted: args.wasAccepted,
      wasEdited: args.wasEdited,
    });
  } catch (err: unknown) {
    log.warn("Failed to log predictive-pattern feedback:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

export const actionApprovalRouter = router({
  /**
   * List all pending actions for the current user.
   * The client polls this (or uses it on page load) to restore any
   * approval cards that were not yet acted on.
   */
  listPending: protectedProcedure
    .input(z.object({ source: z.enum(["user", "agent"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    // CR4 fix: handle solo users (no organizationId) by filtering on userId only
    const orgId = ctx.organizationId;
    const ownerCondition = orgId != null
      ? and(eq(copilotPendingActions.userId, ctx.user.id), eq(copilotPendingActions.organizationId, orgId))
      : eq(copilotPendingActions.userId, ctx.user.id);
    const rows = await db
      .select()
      .from(copilotPendingActions)
      .where(
        and(
          ownerCondition,
          eq(copilotPendingActions.status, "pending"),
          ...(input?.source ? [eq(copilotPendingActions.source, input.source)] : []),
        )
      )
      .orderBy(copilotPendingActions.createdAt);

    return rows.map((r) => ({
      id: r.id,
      toolName: r.toolName,
      summary: r.summary,
      source: r.source ?? null,
      args: (() => { try { return JSON.parse(r.serializedArgs); } catch { return {}; } })(),
      createdAt: r.createdAt,
    }));
  }),

  /**
   * Approve a pending action.
   * Executes the tool call and returns the result so the client can
   * append it to the conversation.
   */
  approve: protectedProcedure
    .input(
      z.object({
        pendingActionId: z.number(),
        /**
         * Optional edits the user made in the Agent Inbox drawer before
         * approving. When provided, overwrites serializedArgs on the
         * pending action and flags the linked aiTrainingData row as
         * wasEdited=true. Omit for plain "Approve" with no edits.
         */
        editedArgs: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Load and validate ownership — CR4 fix: handle solo users
      const approveOrgId = ctx.organizationId;
      const approveOwnerCond = approveOrgId != null
        ? and(eq(copilotPendingActions.userId, ctx.user.id), eq(copilotPendingActions.organizationId, approveOrgId))
        : eq(copilotPendingActions.userId, ctx.user.id);
      const [row] = await db
        .select()
        .from(copilotPendingActions)
        .where(
          and(
            eq(copilotPendingActions.id, input.pendingActionId),
            approveOwnerCond,
            eq(copilotPendingActions.status, "pending")
          )
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pending action not found or already resolved" });
      }

      // If the user edited the draft in the drawer, persist the edited args
      // on the pending action before executing. This keeps the audit trail
      // accurate (serializedArgs reflects what actually ran) and prevents
      // the tool from executing against the stale LLM-drafted version.
      const wasEdited = !!input.editedArgs;
      const effectiveSerializedArgs = wasEdited
        ? JSON.stringify(input.editedArgs)
        : row.serializedArgs;
      if (wasEdited) {
        await db
          .update(copilotPendingActions)
          .set({ serializedArgs: effectiveSerializedArgs })
          .where(eq(copilotPendingActions.id, row.id));
      }

      // Mark as approved before execution (idempotency guard)
      await db
        .update(copilotPendingActions)
        .set({ status: "approved", resolvedAt: new Date() })
        .where(eq(copilotPendingActions.id, row.id));

      // Reconstruct the ToolCall shape expected by executeTool
      const toolCall = {
        id: row.toolCallId,
        type: "function" as const,
        function: {
          name: row.toolName,
          arguments: effectiveSerializedArgs,
        },
      };

      try {
        // Use the organizationId stored when the action was created, NOT the
        // current session's ctx.organizationId. The user may have switched orgs
        // between creating and approving the pending action, and executeTool
        // must run in the original org context to access the correct data.
        const execOrgId = row.organizationId ?? ctx.organizationId;
        const { result, action } = await executeTool(
          ctx.user.id,
          execOrgId,
          toolCall
        );

        log.info("Approved pending action executed", {
          pendingActionId: row.id,
          toolName: row.toolName,
          userId: ctx.user.id,
        });

        // Update training data outcome for reinforcement learning.
        // Also flag wasEdited so the model can learn from edits, not just acceptances.
        try {
          const trainingUpdate: { wasAccepted: boolean; wasEdited?: boolean } = {
            wasAccepted: true,
          };
          if (wasEdited) trainingUpdate.wasEdited = true;
          await db.update(aiTrainingData)
            .set(trainingUpdate)
            .where(and(
              eq(aiTrainingData.entityType, `agent_${row.toolName}`),
              eq(aiTrainingData.userId, ctx.user.id),
              sql`JSON_EXTRACT(${aiTrainingData.aiOutput}, '$.summary') = ${row.summary}`,
            ));
        } catch (outcomeErr: unknown) {
          log.warn("Failed to update training outcome on approve:", outcomeErr);
        }

        // Predictive-pattern feedback loop — a distinct aiTrainingData row
        // keyed on entityType="predictive_pattern" so future iterations can
        // tune pattern-confidence thresholds from accept/dismiss outcomes
        // without scanning the generic agent_* training rows.
        await logPredictivePatternFeedback({
          effectiveSerializedArgs,
          userId: ctx.user.id,
          wasAccepted: true,
          wasEdited,
        });

        return {
          success: true,
          toolName: row.toolName,
          result,
          action: action ?? null,
        };
      } catch (err: unknown) {
        // If execution fails, revert status so the user can retry
        await db!
          .update(copilotPendingActions)
          .set({ status: "pending", resolvedAt: null })
          .where(eq(copilotPendingActions.id, row.id));

        const errMsg = err instanceof Error ? err.message : String(err);
        log.error("Approved pending action failed during execution", {
          pendingActionId: row.id,
          toolName: row.toolName,
          error: errMsg,
        });

        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Action execution failed: ${errMsg}` });
      }
    }),

  /**
   * Deny a pending action.
   * Marks the action as denied without executing it.
   */
  deny: protectedProcedure
    .input(
      z.object({
        pendingActionId: z.number(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // CR4 fix: handle solo users
      const denyOrgId = ctx.organizationId;
      const denyOwnerCond = denyOrgId != null
        ? and(eq(copilotPendingActions.userId, ctx.user.id), eq(copilotPendingActions.organizationId, denyOrgId))
        : eq(copilotPendingActions.userId, ctx.user.id);
      const [row] = await db
        .select()
        .from(copilotPendingActions)
        .where(
          and(
            eq(copilotPendingActions.id, input.pendingActionId),
            denyOwnerCond,
            eq(copilotPendingActions.status, "pending")
          )
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pending action not found or already resolved" });
      }

      await db
        .update(copilotPendingActions)
        .set({
          status: "denied",
          resolvedAt: new Date(),
          denyReason: input.reason ?? null,
        })
        .where(eq(copilotPendingActions.id, row.id));

      log.info("Pending action denied by user", {
        pendingActionId: row.id,
        toolName: row.toolName,
        userId: ctx.user.id,
        reason: input.reason,
      });

      // Update training data outcome for reinforcement learning
      try {
        await db.update(aiTrainingData)
          .set({ wasAccepted: false })
          .where(and(
            eq(aiTrainingData.entityType, `agent_${row.toolName}`),
            eq(aiTrainingData.userId, row.userId),
            sql`JSON_EXTRACT(${aiTrainingData.aiOutput}, '$.summary') = ${row.summary}`,
          ));
      } catch (outcomeErr: unknown) {
        log.warn("Failed to update training outcome on deny:", outcomeErr);
      }

      // Predictive-pattern feedback — dismissal signal mirrors the
      // acceptance path in the approve mutation so both outcomes are
      // captured under entityType="predictive_pattern".
      await logPredictivePatternFeedback({
        effectiveSerializedArgs: row.serializedArgs,
        userId: row.userId,
        wasAccepted: false,
        wasEdited: false,
      });

      return { success: true, toolName: row.toolName };
    }),

  /**
   * Detail view for a single pending action.
   *
   * Returns everything the Agent Inbox detail dialog needs to explain WHY
   * the agent flagged the action and which records the user should review:
   *   • the original copilotPendingActions row (id, summary, args, status…)
   *   • a human-readable explanation
   *   • affectedRecords[] with deep-link hrefs when a UI route exists
   *   • recommendedActions[] (approve / dismiss / navigate / edit-email)
   *
   * The trigger-type-specific resolvers live in agentActionDetails.ts; this
   * procedure is the org-scoped gateway that loads + dispatches.
   */
  getDetails: protectedProcedure
    .input(z.object({ pendingActionId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const orgId = ctx.organizationId;
      const ownerCondition = orgId != null
        ? and(eq(copilotPendingActions.userId, ctx.user.id), eq(copilotPendingActions.organizationId, orgId))
        : eq(copilotPendingActions.userId, ctx.user.id);

      const [row] = await db
        .select()
        .from(copilotPendingActions)
        .where(and(eq(copilotPendingActions.id, input.pendingActionId), ownerCondition))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pending action not found" });
      }

      const parsedArgs: Record<string, unknown> = (() => {
        try { return JSON.parse(row.serializedArgs); } catch { return {}; }
      })();
      const triggerType = typeof parsedArgs.triggerType === "string" ? parsedArgs.triggerType : "unknown";

      const scope = getOrgScope(ctx);
      const resolved = await resolveActionDetails({
        scope,
        toolName: row.toolName,
        summary: row.summary,
        triggerType,
        parsedArgs,
      });

      return {
        pendingActionId: row.id,
        toolName: row.toolName,
        summary: row.summary,
        source: row.source ?? null,
        status: row.status,
        createdAt: row.createdAt,
        triggerType,
        args: parsedArgs,
        explanation: resolved.explanation,
        affectedRecords: resolved.affectedRecords,
        recommendedActions: resolved.recommendedActions,
      };
    }),

  /**
   * Agent status for the Agent Inbox empty state.
   *
   * Preferred source: organizations.lastAgentScanAt — stamped by the cron
   * and the manual triggerScan endpoint every time a scan completes.
   * Fallback: max(createdAt) across agent-source pending actions for the
   * current tenant (used by solo accounts that have no organization row
   * to stamp).
   */
  agentStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { lastAgentActivityAt: null as Date | null };

    const orgId = ctx.organizationId;

    if (orgId != null) {
      const [orgRow] = await db
        .select({ lastAgentScanAt: organizations.lastAgentScanAt })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (orgRow?.lastAgentScanAt) {
        return { lastAgentActivityAt: orgRow.lastAgentScanAt };
      }
      // org exists but no scan has run yet — fall through to activity fallback
    }

    const ownerCondition = orgId != null
      ? and(
          eq(copilotPendingActions.userId, ctx.user.id),
          eq(copilotPendingActions.organizationId, orgId),
        )
      : eq(copilotPendingActions.userId, ctx.user.id);

    const [row] = await db
      .select({ createdAt: copilotPendingActions.createdAt })
      .from(copilotPendingActions)
      .where(
        and(
          ownerCondition,
          eq(copilotPendingActions.source, "agent"),
        ),
      )
      .orderBy(desc(copilotPendingActions.createdAt))
      .limit(1);

    return { lastAgentActivityAt: row?.createdAt ?? null };
  }),
});
