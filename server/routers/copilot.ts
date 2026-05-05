/**
 * copilot.ts — MergeTasks AI Copilot Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin barrel: only the two tRPC procedures (`chat`, `quickAction`).
 * All heavy logic lives in dedicated modules:
 *
 *   copilotSystemPrompt.ts    — SYSTEM_PROMPT constant + buildTaskSummary()
 *   copilotInlineTools.ts     — INLINE_TOOLS array (8 core tool definitions)
 *   copilotInlineExecutors.ts — buildToolScope() + 6 core executors + executeTool()
 *   copilotTools.ts           — EXTENDED_TOOLS + executeExtendedTool() barrel
 *   copilotMemory.ts          — memory context builder + conversation logger
 *
 * Public API (unchanged):
 *   trpc.copilot.chat
 *   trpc.copilot.quickAction
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { safeLLM } from "../_core/safeLLM";
import type { Message } from "../_core/llm";
import { SYSTEM_PROMPT, buildTaskSummary } from "./copilotSystemPrompt";
import { INLINE_TOOLS } from "./copilotInlineTools";
import { executeTool } from "./copilotExec";
import { EXTENDED_TOOLS } from "./copilotTools";
import { classifyAction } from "./actionClassifier";
import { getDb } from "../db";
import { copilotPendingActions, organizations, users } from "../../drizzle/schema";
import { eq, and, desc, gte, inArray } from "drizzle-orm";
import type { AiApprovalLevel } from "../../drizzle/schema";
import {
  buildMemoryContext,
  formatMemoryForPrompt,
  logTask,
  saveConversation,
  extractPreferencesFromTask,
} from "./copilotMemory";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";
import { cleanupExpiredCaches } from "../utils/contextSanitizer";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { COPILOT_CHAT_LIMIT } from "../utils/rateLimiter";
import {
  proposals as proposalsTable,
  orders as ordersTable,
  virtualProofs as virtualProofsTable,
  notifications as notificationsTable,
  clients as clientsTable,
} from "../../drizzle/schema";

const log = getLogger("copilot");

// ─── Router ───────────────────────────────────────────────────────────────────

export const copilotRouter = router({
  /**
   * chat — multi-step agentic conversation with tool execution loop.
   *
   * The LLM can call up to 5 rounds of tools before generating a final reply.
   * All tool calls are executed server-side; results are fed back into the
   * conversation so the model can chain actions (e.g. search client → search
   * products → create proposal → send proposal).
   */
  chat: protectedProcedure
    .use(rateLimited("copilot.chat", COPILOT_CHAT_LIMIT))
    .input(
      z.object({
        message: z.string().min(1),
        conversationHistory: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .optional(),
        context: z
          .object({
            page: z.string().optional(),
            clientId: z.number().optional(),
            storeId: z.number().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Prune stale sanitizer caches at request start (prevents memory leak)
      cleanupExpiredCaches();

      // Build memory-powered context
      let memoryBlock = "";
      try {
        const memoryCtx = await buildMemoryContext(ctx.user.id, ctx.organizationId);
        memoryBlock = formatMemoryForPrompt(memoryCtx);
      } catch {
        // Continue without memory context
      }

      // Assemble message history with memory-enriched system prompt
      const messages: Message[] = [
        {
          role: "system",
          content:
            SYSTEM_PROMPT +
            memoryBlock +
            `\n\nUser ID: ${ctx.user.id} (role: distributor)\nCurrent page: ${input.context?.page || "dashboard"}`,
        },
      ];

      if (input.conversationHistory) {
        for (const msg of input.conversationHistory.slice(-10)) {
          // conversationHistory is validated to be "user" | "assistant"
          // at the input boundary; no tool role to filter here.
          const content = typeof msg.content === "string" ? msg.content : "";
          messages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content,
          });
        }
      }

      messages.push({ role: "user", content: input.message });

      // ── Resolve AI approval level ───────────────────────────────────────────
      // Determines how much autonomy the AI has:
      //   all_auto    — execute everything immediately
      //   review_auto — SAFE executes, CONFIRM queues for approval (default)
      //   all_review  — every tool call queues for approval
      // Org-level setting wins when the request has a resolved organizationId;
      // solo users (no org) fall back to their user-level column.
      let aiApprovalLevel: AiApprovalLevel = "review_auto";
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        if (ctx.organizationId) {
          const [org] = await db
            .select({ aiApprovalLevel: organizations.aiApprovalLevel })
            .from(organizations)
            .where(eq(organizations.id, ctx.organizationId))
            .limit(1);
          if (org?.aiApprovalLevel) {
            aiApprovalLevel = org.aiApprovalLevel as AiApprovalLevel;
          }
        } else {
          const [u] = await db
            .select({ aiApprovalLevel: users.aiApprovalLevel })
            .from(users)
            .where(eq(users.id, ctx.user.id))
            .limit(1);
          if (u?.aiApprovalLevel) {
            aiApprovalLevel = u.aiApprovalLevel as AiApprovalLevel;
          }
        }
      } catch {
        // Non-fatal — fall back to review_auto
      }

      // ── Multi-step tool execution loop ────────────────────────────────────
      // The LLM can call multiple tools in sequence (up to 5 iterations).
      const allActions: Array<{ type: string; data: unknown }> = [];
      const allAttachments: Array<{ type: string; payload: unknown }> = [];
      const executionLog: string[] = [];
      let maxIterations = 5;

      while (maxIterations > 0) {
        maxIterations--;

        let result;
        try {
          result = await safeLLM(
            {
              messages,
              tools: [...INLINE_TOOLS, ...EXTENDED_TOOLS],
              tool_choice: "auto",
              task: "copilot",
            },
            {
              organizationId: getOrgScope(ctx).organizationId,
              userId: ctx.user.id,
            }
          );
        } catch (llmErr: unknown) {
          const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
          log.error("LLM invocation failed:", errMsg);
          if (
            errMsg.includes("usage exhausted") ||
            errMsg.includes("quota") ||
            errMsg.includes("rate limit")
          ) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AI usage quota exhausted. Please try again later." });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI service error: ${errMsg}` });
        }

        const choice = result.choices?.[0];
        if (!choice) break;

        const toolCalls = choice.message?.tool_calls;

        // No tool calls → final response
        if (!toolCalls || toolCalls.length === 0) {
          const reply = choice.message?.content;
          const text =
            typeof reply === "string"
              ? reply
              : Array.isArray(reply)
              ? reply.map((p) => ("text" in p ? p.text : "")).join("")
              : "Done.";

          // Persist conversation to memory (async, non-blocking)
          saveConversation(ctx.user.id, [
            {
              role: "user",
              content: input.message,
              timestamp: new Date().toISOString(),
            },
            {
              role: "assistant",
              content: text,
              actions: allActions,
              timestamp: new Date().toISOString(),
            },
          ], ctx.organizationId).catch(() => {});

          return { reply: text, actions: allActions, executionLog, attachment: allAttachments[0] ?? null };
        }

        // The assistant message MUST include tool_calls for OpenAI API compliance.
        // Without this, subsequent tool result messages are rejected.
        messages.push({
          role: "assistant",
          content: typeof choice.message?.content === "string" ? choice.message.content : "",
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });

        // ── Human Approval Gate (Layer 2) ─────────────────────────────────
        // Classify every tool call. SAFE calls execute immediately.
        // CONFIRM calls are persisted and returned to the client for approval.
        //
        // IMPORTANT: SAFE and CONFIRM calls can appear in the same LLM response.
        // We execute ALL SAFE calls first and collect their tool-result messages
        // so the conversation state is preserved. Only then do we return the
        // awaitingApproval response — with the SAFE results already in `messages`.
        // This prevents SAFE tool results from being silently dropped.
        const pendingApprovals: Array<{ id: number; toolName: string; summary: string }> = [];
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        for (const toolCall of toolCalls) {
          let callArgs: Record<string, any> = {};
          try { callArgs = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
          const classification = classifyAction(toolCall.function.name, callArgs);

          // Apply per-org approval level:
          //   all_auto    — treat every call as SAFE (skip approval gate)
          //   review_auto — use classifyAction result as-is (default)
          //   all_review  — treat every call as CONFIRM (maximum control)
          const effectiveRisk =
            aiApprovalLevel === "all_auto"
              ? "SAFE"
              : aiApprovalLevel === "all_review"
              ? "CONFIRM"
              : classification.risk;

          if (effectiveRisk === "CONFIRM") {
            // Persist CONFIRM-tier call — do NOT execute yet
            const [inserted] = await db
              .insert(copilotPendingActions)
              .values({
                userId: ctx.user.id,
                organizationId: ctx.organizationId,
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                summary: classification.summary ?? `Confirm: ${toolCall.function.name}`,
                serializedArgs: toolCall.function.arguments,
                status: "pending",
              })
              .$returningId();
            pendingApprovals.push({
              id: inserted.id,
              toolName: toolCall.function.name,
              summary: classification.summary ?? `Confirm: ${toolCall.function.name}`,
            });
            // Push a placeholder tool result so the conversation stays valid.
            // The real result will be provided after the user approves.
            messages.push({
              role: "tool" as const,
              content: JSON.stringify({ status: "awaiting_approval", pendingActionId: inserted.id }),
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
          } else {
            // SAFE (or all_auto override) — execute immediately and collect the result
            const { result: toolResult, action, attachment } = await executeTool(
              ctx.user.id,
              ctx.organizationId,
              toolCall
            );

            if (attachment) allAttachments.push(attachment);

            if (action) {
              allActions.push(action);
              // Log task and extract preferences for future memory context
              try {
                await logTask(ctx.user.id, {
                  taskType: action?.type ?? "unknown",
                  taskData: (action.data || {}) as Record<string, unknown>,
                  taskSummary: buildTaskSummary(action),
                }, ctx.organizationId);
                await extractPreferencesFromTask(
                  ctx.user.id,
                  action?.type ?? "unknown",
                  action.data || {}
                );
              } catch {
                // Memory failures must never break the main flow
              }
            }

            executionLog.push(`✓ ${toolCall.function.name.replace(/_/g, " ")}`);

            messages.push({
              role: "tool" as const,
              content: toolResult,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            });
          }
        }

        // If any CONFIRM-tier calls are pending, pause and ask the user to confirm.
        // SAFE tool results are already in `messages` above — they are not lost.
        if (pendingApprovals.length > 0) {
          const summaries = pendingApprovals.map((p) => `• ${p.summary}`).join("\n");
          return {
            reply: `I need your approval before continuing. The following action${pendingApprovals.length > 1 ? "s require" : " requires"} confirmation:\n\n${summaries}\n\nPlease approve or deny each action to proceed.`,
            actions: allActions,
            executionLog,
            awaitingApproval: true,
            pendingApprovals,
            attachment: allAttachments[0] ?? null,
          };
        }
      }

      // Iterations exhausted — ask for a final summary
      messages.push({
        role: "user",
        content:
          "Summarize what you accomplished based on the tool results above. Be brief and specific.",
      });

      let finalResult;
      try {
        finalResult = await safeLLM(
          { messages, task: "copilot" },
          {
            organizationId: getOrgScope(ctx).organizationId,
            userId: ctx.user.id,
          }
        );
      } catch (llmErr: unknown) {
        const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
        log.error("Final summary LLM call failed:", errMsg);
        return {
          reply: "I've completed the requested actions. Check your dashboard for updates.",
          actions: allActions,
          executionLog,
          attachment: allAttachments[0] ?? null,
        };
      }

      const finalReply = finalResult.choices?.[0]?.message?.content;
      const finalText =
        typeof finalReply === "string"
          ? finalReply
          : "I've completed the requested actions. Check your dashboard for updates.";

      saveConversation(ctx.user.id, [
        {
          role: "user",
          content: input.message,
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant",
          content: finalText,
          actions: allActions,
          timestamp: new Date().toISOString(),
        },
      ], ctx.organizationId).catch(() => {});

      return { reply: finalText, actions: allActions, executionLog, attachment: allAttachments[0] ?? null };
    }),

  /**
   * quickAction — pre-built prompts for common distributor tasks.
   *
   * Provides one-click access to frequently used AI workflows without
   * requiring the user to type a full prompt.
   */
  quickAction: protectedProcedure
    .use(rateLimited("copilot.quickAction", COPILOT_CHAT_LIMIT))
    .input(
      z.object({
        action: z.enum([
          "recommend_products",
          "draft_proposal",
          "reorder_alert",
          "trending_products",
          "campaign_ideas",
        ]),
        params: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const prompts: Record<string, string> = {
        recommend_products: `Based on current promotional product trends, recommend 5 products for ${
          input.params?.industry || "a corporate"
        } client with a budget of ${
          input.params?.budget || "$5,000"
        }. Include product names, estimated prices, and decoration methods.`,
        draft_proposal: `Help me draft a proposal for ${
          input.params?.client || "a new client"
        } for ${
          input.params?.event || "an employee appreciation event"
        }. Suggest a product mix with quantities and pricing.`,
        reorder_alert: `Analyze typical reorder patterns for promotional products and suggest which clients might need reorders this month based on common 90-day reorder cycles.`,
        trending_products: `What are the top trending promotional products for ${
          input.params?.season || "Q2 2026"
        }? Include eco-friendly options and tech accessories.`,
        campaign_ideas: `Suggest 3 creative pop-up store campaign ideas for ${
          input.params?.industry || "a tech company"
        } targeting ${input.params?.audience || "employees"}.`,
      };

      const message =
        prompts[input.action] || "Help me with my promotional products business.";

      let memoryBlock = "";
      try {
        const memoryCtx = await buildMemoryContext(ctx.user.id, ctx.organizationId);
        memoryBlock = formatMemoryForPrompt(memoryCtx);
      } catch {
        // Continue without memory context
      }

      let result;
      try {
        result = await safeLLM(
          {
            messages: [
              {
                role: "system",
                content:
                  SYSTEM_PROMPT +
                  memoryBlock +
                  `\n\nUser ID: ${ctx.user.id} (role: distributor)`,
              },
              { role: "user", content: message },
            ],
            task: "copilot",
          },
          { userId: ctx.user.id }
        );
      } catch (llmErr: unknown) {
        const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
        log.error("quickAction LLM failed:", errMsg);
        if (errMsg.includes("usage exhausted") || errMsg.includes("quota")) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AI usage quota exhausted. Please try again later." });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI service error: ${errMsg}` });
      }

      const reply = result.choices?.[0]?.message?.content;
      const text =
        typeof reply === "string"
          ? reply
          : Array.isArray(reply)
          ? reply.map((p) => ("text" in p ? p.text : "")).join("")
          : "I'm sorry, I couldn't process that request.";

      return { reply: text, action: input.action };
    }),

  /**
   * dailyBriefing — aggregates the user's pending work and turns it into a
   * short, conversational morning rundown. Designed to be read aloud via
   * the browser's SpeechSynthesis API, so the output is plain prose
   * (no markdown, no bullet characters).
   */
  dailyBriefing: protectedProcedure
    .use(rateLimited("copilot.dailyBriefing", COPILOT_CHAT_LIMIT))
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [
        draftProposals,
        sentProposals,
        proofsAwaiting,
        ordersInProduction,
        unreadNotifs,
      ] = await Promise.all([
        db.select({ id: proposalsTable.id, title: proposalsTable.title, clientId: proposalsTable.clientId, updatedAt: proposalsTable.updatedAt })
          .from(proposalsTable)
          .where(and(scope.proposals, eq(proposalsTable.status, "draft")))
          .orderBy(desc(proposalsTable.updatedAt))
          .limit(10),
        db.select({ id: proposalsTable.id, title: proposalsTable.title, clientId: proposalsTable.clientId, sentAt: proposalsTable.sentAt })
          .from(proposalsTable)
          .where(and(scope.proposals, inArray(proposalsTable.status, ["sent", "viewed"])))
          .orderBy(desc(proposalsTable.sentAt))
          .limit(10),
        db.select({ id: virtualProofsTable.id, productName: virtualProofsTable.productName, clientId: virtualProofsTable.clientId, status: virtualProofsTable.status })
          .from(virtualProofsTable)
          .where(and(scope.virtualProofs, inArray(virtualProofsTable.status, ["ready", "revision_requested"])))
          .orderBy(desc(virtualProofsTable.createdAt))
          .limit(10),
        db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status, clientId: ordersTable.clientId, createdAt: ordersTable.createdAt })
          .from(ordersTable)
          .where(and(scope.orders, inArray(ordersTable.status, ["processing", "production"])))
          .orderBy(desc(ordersTable.createdAt))
          .limit(10),
        db.select({ id: notificationsTable.id, title: notificationsTable.title, type: notificationsTable.type, createdAt: notificationsTable.createdAt })
          .from(notificationsTable)
          .where(and(scope.notifications, eq(notificationsTable.read, false), gte(notificationsTable.createdAt, sevenDaysAgo)))
          .orderBy(desc(notificationsTable.createdAt))
          .limit(15),
      ]);

      // Resolve client names in one query for any referenced clientIds
      const clientIds = Array.from(new Set([
        ...draftProposals.map((p) => p.clientId),
        ...sentProposals.map((p) => p.clientId),
        ...proofsAwaiting.map((p) => p.clientId).filter((id): id is number => id != null),
        ...ordersInProduction.map((o) => o.clientId),
      ]));
      const clientNameById = new Map<number, string>();
      if (clientIds.length > 0) {
        const clientRows = await db
          .select({ id: clientsTable.id, companyName: clientsTable.companyName })
          .from(clientsTable)
          .where(and(scope.clients, inArray(clientsTable.id, clientIds)));
        for (const c of clientRows) clientNameById.set(c.id, c.companyName);
      }

      const facts = {
        date: startOfToday.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
        draftProposals: draftProposals.slice(0, 5).map((p) => ({
          title: p.title,
          client: clientNameById.get(p.clientId) ?? "a client",
        })),
        draftProposalsTotal: draftProposals.length,
        sentProposalsAwaiting: sentProposals.slice(0, 5).map((p) => ({
          title: p.title,
          client: clientNameById.get(p.clientId) ?? "a client",
        })),
        sentProposalsTotal: sentProposals.length,
        proofsAwaitingFeedback: proofsAwaiting.slice(0, 5).map((p) => ({
          product: p.productName,
          client: p.clientId ? clientNameById.get(p.clientId) ?? "a client" : "a client",
          status: p.status,
        })),
        proofsAwaitingTotal: proofsAwaiting.length,
        ordersInProduction: ordersInProduction.slice(0, 5).map((o) => ({
          number: o.orderNumber,
          client: clientNameById.get(o.clientId) ?? "a client",
          status: o.status,
        })),
        ordersInProductionTotal: ordersInProduction.length,
        unreadNotifications: unreadNotifs.slice(0, 5).map((n) => ({ title: n.title, type: n.type })),
        unreadNotificationsTotal: unreadNotifs.length,
      };

      const everythingEmpty =
        facts.draftProposalsTotal === 0 &&
        facts.sentProposalsTotal === 0 &&
        facts.proofsAwaitingTotal === 0 &&
        facts.ordersInProductionTotal === 0 &&
        facts.unreadNotificationsTotal === 0;

      if (everythingEmpty) {
        return {
          summary: `Good morning. It's ${facts.date}. Your inbox is clear — no pending proposals, proofs, or orders need attention today. A great time to reach out to a new client or plan your next campaign.`,
          facts,
        };
      }

      const briefingSystem = `You are MergeTasks, a calm, concise business assistant giving a distributor a spoken morning briefing. Write 4–7 short sentences of plain prose. No markdown, no bullets, no lists, no headings. Speak naturally in the second person ("you have…"). Lead with the most important item. Group related items. Round numbers when mentioning totals. End with a single clear priority for the morning.`;

      const userMessage = `Today is ${facts.date}. Here is the data:\n\n` + JSON.stringify(facts, null, 2);

      let result;
      try {
        result = await safeLLM(
          {
            messages: [
              { role: "system", content: briefingSystem },
              { role: "user", content: userMessage },
            ],
            task: "briefing",
          },
          { userId: ctx.user.id }
        );
      } catch (llmErr: unknown) {
        const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
        log.error("dailyBriefing LLM failed:", errMsg);
        if (errMsg.includes("usage exhausted") || errMsg.includes("quota")) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AI usage quota exhausted. Please try again later." });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI service error: ${errMsg}` });
      }

      const raw = result.choices?.[0]?.message?.content;
      const summary =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
          ? raw.map((p) => ("text" in p ? p.text : "")).join("")
          : "";

      return { summary: summary.trim(), facts };
    }),
});
