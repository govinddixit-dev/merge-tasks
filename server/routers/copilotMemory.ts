/**
 * Copilot Memory Layer
 * 
 * Uses standard Drizzle ORM + MySQL.
 * When migrating, this module works as-is with any MySQL/Postgres/TiDB database.
 * 
 * The only external dependency is safeLLM() for generating conversation summaries
 * and extracting preferences — routed through the 5-layer privacy stack.
 * 
 * Three memory systems:
 * 1. Conversation History — stores past chat sessions with AI-generated summaries
 * 2. Learned Preferences — key-value store of patterns extracted from user behavior
 * 3. Task Log — record of every action the AI executed
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  copilotConversations,
  copilotMemory,
  copilotTaskLog,
  clients,
  products,
  proposals,
  stores,
  distributorProfiles,
} from "../../drizzle/schema";
import { safeLLM } from "../_core/safeLLM";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";
import { sanitizeContent } from "../_core/aiGatekeeper";

const log = getLogger("copilotMemory");

//  Types 

interface ConversationMessage {
  role: string;
  content: string;
  actions?: Array<Record<string, unknown>>;
  timestamp?: string;
}

interface TaskLogEntry {
  taskType: string;
  taskData: Record<string, unknown>;
  taskSummary: string;
  status?: "completed" | "failed";
}

interface MemoryContext {
  recentTasks: string[];
  preferences: Record<string, string>;
  conversationSummaries: string[];
  distributorProfile: string;
  catalogSummary: string;
  clientSummary: string;
}

//  Conversation History 

/**
 * Save a completed conversation session to the database.
 * Generates a compact summary using LLM for efficient future retrieval.
 */
export async function saveConversation(
  userId: number,
  messages: ConversationMessage[],
  organizationId?: number | null
): Promise<number> {
  // Don't save empty or single-message conversations
  if (messages.length <= 1) return 0;

  // Generate a compact summary of the conversation
  let summary = "";
  try {
    const summaryPrompt = messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
      .join("\n");

    const result = await safeLLM({
      messages: [
        {
          role: "system",
          content:
            "Summarize this conversation in 1-2 sentences. Focus on what the user asked for and what was accomplished. Be specific about clients, products, and actions taken.",
        },
        { role: "user", content: summaryPrompt },
      ],
      task: "bulk",
    });
    const rawContent = result.choices?.[0]?.message?.content;
    summary = typeof rawContent === "string" ? rawContent : "";
  } catch {
    // If LLM fails, create a basic summary from user messages
    const userMsgs = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content.slice(0, 100));
    summary = `User asked: ${userMsgs.join("; ")}`;
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  const [inserted] = await db.insert(copilotConversations).values({
    userId,
    organizationId: organizationId ?? null,
    messages: messages,
    summary,
    messageCount: messages.length,
  });

  return inserted.insertId;
}

/**
 * Get recent conversation summaries for context injection.
 */
export async function getRecentConversations(
  userId: number,
  limit: number = 10
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ summary: copilotConversations.summary })
    .from(copilotConversations)
    .where(eq(copilotConversations.userId, userId))
    .orderBy(desc(copilotConversations.createdAt))
    .limit(limit);

  return rows
    .map((r: { summary: string | null }) => r.summary)
    .filter((s: string | null): s is string => s !== null && s.length > 0);
}

//  Task Log 

/**
 * Log a completed task for future reference.
 */
export async function logTask(
  userId: number,
  entry: TaskLogEntry,
  organizationId?: number | null
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(copilotTaskLog).values({
    userId,
    organizationId: organizationId ?? null,
    taskType: entry.taskType,
    taskData: entry.taskData,
    taskSummary: entry.taskSummary,
    status: entry.status || "completed",
  });
}

/**
 * Get recent task history for context injection.
 */
export async function getRecentTasks(
  userId: number,
  limit: number = 20
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      taskSummary: copilotTaskLog.taskSummary,
      taskType: copilotTaskLog.taskType,
      createdAt: copilotTaskLog.createdAt,
    })
    .from(copilotTaskLog)
    .where(eq(copilotTaskLog.userId, userId))
    .orderBy(desc(copilotTaskLog.createdAt))
    .limit(limit);

  return rows.map((r: { taskSummary: string; taskType: string; createdAt: Date }) => {
    const ago = getTimeAgo(r.createdAt);
    return `[${ago}] ${r.taskSummary}`;
  });
}

//  Learned Preferences 

/**
 * Store or update a learned preference.
 * If the same key exists, increment confidence and update value.
 */
export async function learnPreference(
  userId: number,
  category: string,
  key: string,
  value: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Check if this preference already exists
  const existing = await db
    .select()
    .from(copilotMemory)
    .where(
      and(
        eq(copilotMemory.userId, userId),
        eq(copilotMemory.category, category),
        eq(copilotMemory.memoryKey, key)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing preference and boost confidence
    await db
      .update(copilotMemory)
      .set({
        memoryValue: value,
        confidence: sql`${copilotMemory.confidence} + 1`,
      })
      .where(eq(copilotMemory.id, existing[0].id));
  } else {
    // Insert new preference
    await db.insert(copilotMemory).values({
      userId,
      category,
      memoryKey: key,
      memoryValue: value,
      confidence: 1,
    });
  }
}

/**
 * Get all learned preferences for a user, grouped by category.
 */
export async function getPreferences(
  userId: number
): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({
      category: copilotMemory.category,
      key: copilotMemory.memoryKey,
      value: copilotMemory.memoryValue,
      confidence: copilotMemory.confidence,
    })
    .from(copilotMemory)
    .where(eq(copilotMemory.userId, userId))
    .orderBy(desc(copilotMemory.confidence));

  const prefs: Record<string, string> = {};
  for (const row of rows) {
    prefs[`${row.category}:${row.key}`] = row.value;
  }
  return prefs;
}

/**
 * Extract preferences from a completed task and store them.
 * Called automatically after each successful task execution.
 */
export async function extractPreferencesFromTask(
  userId: number,
  taskType: string,
  taskData: Record<string, any>
): Promise<void> {
  try {
    // Learn client preferences
    if (taskData.clientName) {
      await learnPreference(
        userId,
        "client_usage",
        taskData.clientName,
        JSON.stringify({
          lastUsed: new Date().toISOString(),
          clientId: taskData.clientId,
        })
      );
    }

    // Learn product preferences
    if (taskData.products && Array.isArray(taskData.products)) {
      for (const product of taskData.products) {
        if (product.name) {
          await learnPreference(
            userId,
            "product_usage",
            product.name,
            JSON.stringify({
              lastQuantity: product.quantity,
              lastPrice: product.price,
              productId: product.productId,
            })
          );
        }
      }
    }

    // Learn workflow preferences
    if (taskType === "proposal_created" && taskData.multiDepartment) {
      await learnPreference(
        userId,
        "workflow",
        "uses_multi_department",
        "true"
      );
    }

    if (taskType === "webstore_created" && taskData.slug) {
      await learnPreference(
        userId,
        "workflow",
        "last_store_slug_pattern",
        taskData.slug
      );
    }
  } catch (err) {
    // Don't let preference extraction failures break the main flow
    log.error("Failed to extract preferences:", err);
  }
}

//  Context Builder 

/**
 * Build a complete memory context for the copilot system prompt.
 * This is the main entry point — call this before each LLM invocation.
 */
export async function buildMemoryContext(
  userId: number,
  organizationId?: number | null
): Promise<MemoryContext> {
  const [recentTasks, preferences, conversationSummaries, distributorProfile, catalogSummary, clientSummary] =
    await Promise.all([
      getRecentTasks(userId, 15),
      getPreferences(userId),
      getRecentConversations(userId, 5),
      getDistributorProfile(userId, organizationId ?? null),
      getCatalogSummary(userId, organizationId ?? null),
      getClientSummary(userId, organizationId ?? null),
    ]);

  return {
    recentTasks,
    preferences,
    conversationSummaries,
    distributorProfile,
    catalogSummary,
    clientSummary,
  };
}

/**
 * Format the memory context into a string block for the system prompt.
 */
export function formatMemoryForPrompt(ctx: MemoryContext): string {
  const sections: string[] = [];

  // Distributor profile
  if (ctx.distributorProfile) {
    sections.push(`## Your Distributor\n${ctx.distributorProfile}`);
  }

  // Catalog summary
  if (ctx.catalogSummary) {
    sections.push(`## Product Catalog\n${ctx.catalogSummary}`);
  }

  // Client summary
  if (ctx.clientSummary) {
    sections.push(`## Clients\n${ctx.clientSummary}`);
  }

  // Recent tasks
  if (ctx.recentTasks.length > 0) {
    sections.push(
      `## Recent Task History\nHere's what you've done recently for this distributor:\n${ctx.recentTasks.map((t) => `- ${t}`).join("\n")}`
    );
  }

  // Learned preferences
  const prefEntries = Object.entries(ctx.preferences);
  if (prefEntries.length > 0) {
    const prefLines = prefEntries.map(([key, value]) => {
      const [category, name] = key.split(":");
      if (category === "client_usage") {
        return `- Frequently works with client: ${name}`;
      }
      if (category === "product_usage") {
        const data = JSON.parse(value);
        return `- Often uses product: ${name} (last qty: ${data.lastQuantity}, price: $${data.lastPrice})`;
      }
      if (category === "workflow") {
        return `- Workflow preference: ${name} = ${value}`;
      }
      return `- ${name}: ${value}`;
    });
    sections.push(
      `## Learned Preferences\nBased on past usage patterns:\n${prefLines.join("\n")}`
    );
  }

  // Past conversation context
  if (ctx.conversationSummaries.length > 0) {
    sections.push(
      `## Recent Conversations\n${ctx.conversationSummaries.map((s) => `- ${s}`).join("\n")}`
    );
  }

  // Determine if this user has any meaningful interaction history
  const hasInteractionHistory = ctx.recentTasks.length > 0 ||
    Object.keys(ctx.preferences).length > 0 ||
    ctx.conversationSummaries.length > 0;

  if (!hasInteractionHistory) {
    // Still include catalog/client/profile info, but add the new user note
    if (sections.length === 0) {
      return "\n## Memory\nThis is a new user — no past interactions yet. Be helpful and learn their preferences as you work together.\n";
    }
    sections.push("## Memory\nThis is a new user — no past interactions yet. Be helpful and learn their preferences as you work together.");
  }

  return "\n" + sections.join("\n\n") + "\n";
}

//  Data Helpers 

async function getDistributorProfile(userId: number, organizationId: number | null): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return "";
    const profileScope = organizationId !== null
      ? eq(distributorProfiles.organizationId, organizationId)
      : eq(distributorProfiles.userId, userId);
    const rows = await db
      .select()
      .from(distributorProfiles)
      .where(profileScope)
      .limit(1);

    if (rows.length === 0) return "";

    const p = rows[0];
    const parts = [
      `Company: ${p.companyName || "Not set"}`,
      p.companySize ? `Size: ${p.companySize}` : null,
      p.primaryGoal ? `Goal: ${p.primaryGoal}` : null,
      p.brandCompanyName ? `Brand: ${p.brandCompanyName}` : null,
    ].filter(Boolean);

    return parts.join(" | ");
  } catch {
    return "";
  }
}

async function getCatalogSummary(userId: number, organizationId: number | null): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return "";
    const productScope = organizationId !== null
      ? eq(products.organizationId, organizationId)
      : eq(products.userId, userId);
    const allProducts = await db
      .select({
        name: products.name,
        category: products.category,
        basePrice: products.basePrice,
      })
      .from(products)
      .where(productScope)
      .limit(100);

    if (allProducts.length === 0) return "No products in catalog yet.";

    // Group by category
    const categories: Record<string, { count: number; examples: string[] }> = {};
    for (const p of allProducts) {
      const cat = p.category || "Uncategorized";
      if (!categories[cat]) categories[cat] = { count: 0, examples: [] };
      categories[cat].count++;
      if (categories[cat].examples.length < 3) {
        categories[cat].examples.push(
          `${p.name} ($${p.basePrice})`
        );
      }
    }

    const lines = Object.entries(categories).map(
      ([cat, data]) =>
        `${cat} (${data.count}): ${data.examples.join(", ")}`
    );

    return `${allProducts.length} products total:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

async function getClientSummary(userId: number, organizationId: number | null): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return "";
    const clientScope = organizationId !== null
      ? eq(clients.organizationId, organizationId)
      : eq(clients.userId, userId);
    const allClients = await db
      .select({
        company: clients.companyName,
        contactName: clients.contactName,
        email: clients.contactEmail,
      })
      .from(clients)
      .where(clientScope)
      .limit(50);

    if (allClients.length === 0) return "No clients yet.";

    // Layer 3: Sanitize PII from client data before injecting into LLM prompt
    const sanitizedClients = await Promise.all(
      allClients.slice(0, 15).map(async (c: { company: string; contactName: string; email: string }) => {
        const company = await sanitizeContent(c.company);
        const name = await sanitizeContent(c.contactName);
        // Intentionally omit email from prompt — AI doesn't need it
        return `${company} (contact: ${name})`;
      })
    );
    const clientList = sanitizedClients.join("; ");

    return `${allClients.length} clients: ${clientList}${allClients.length > 15 ? ` ...and ${allClients.length - 15} more` : ""}`;
  } catch {
    return "";
  }
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}
