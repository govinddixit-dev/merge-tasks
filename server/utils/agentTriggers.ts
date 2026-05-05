/**
 * agentTriggers.ts — Fire-and-forget hooks that translate platform events
 * into agent-evaluated proposals.
 *
 * Each trigger:
 *  1. Logs the event
 *  2. Calls runAgentAction or runEmailAgentAction (async, non-blocking)
 *  3. Never throws — wrapped by callers in try/catch anyway
 *
 * All triggers accept an optional `options.suppressNotification` flag.
 * The cron job sets it to `true` so individual per-action notifications
 * are suppressed in favour of one consolidated briefing at the end of
 * the scan. Direct real-time calls from event handlers leave it false,
 * preserving the per-event notification behaviour.
 */

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import {
  clients,
  copilotPendingActions,
  invoices,
  orderItems,
  orders,
  organizations,
  productImprintZones,
  products,
  proposalProducts,
  proposals,
  storeProducts,
  stores,
  supplierCostChangeLog,
  suppliers,
  users,
  type InsertProposal,
  type InsertProposalProduct,
} from "../../drizzle/schema";
import { getLogger } from "./logger";
import { runAgentAction, runEmailAgentAction } from "./agentActions";
import {
  buildMemoryContext,
  formatMemoryForPrompt,
} from "../routers/copilotMemory";

const log = getLogger("agentTriggers");

export interface TriggerOptions {
  /** Suppress the per-action in-app notification (used by the cron job). */
  suppressNotification?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Existing triggers (unchanged behaviour when called without options) */
/* ------------------------------------------------------------------ */

/**
 * Trigger: A store buyer submitted a custom order request.
 * The agent evaluates the request and proposes next steps for the distributor.
 */
export async function onCustomOrderRequestCreated(
  requestId: number,
  organizationId: number | null,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onCustomOrderRequestCreated — request=${requestId}, org=${organizationId}`);
  try {
    await runAgentAction({
      triggerType: "custom_order_request",
      entityId: requestId,
      organizationId: organizationId ?? undefined,
      suppressNotification: options?.suppressNotification,
      prompt: `A new custom order request (ID ${requestId}) has been submitted. ` +
        `Analyze the request details and propose a response for the distributor. ` +
        `Consider: pricing estimate, timeline feasibility, and whether the request ` +
        `can be fulfilled with existing catalog products or requires sourcing.`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onCustomOrderRequestCreated failed:", err);
  }
}

/**
 * Trigger: A new store was created.
 * The agent proposes initial setup actions for the distributor.
 */
export async function onStoreCreated(
  storeId: number,
  organizationId: number | null,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onStoreCreated — store=${storeId}, org=${organizationId}`);
  try {
    await runAgentAction({
      triggerType: "store_created",
      entityId: storeId,
      organizationId: organizationId ?? undefined,
      suppressNotification: options?.suppressNotification,
      prompt: `A new store (ID ${storeId}) has just been created. ` +
        `Propose initial setup actions for the distributor: ` +
        `AI optimization of store branding, suggested product catalog structure, ` +
        `and recommended launch checklist items.`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onStoreCreated failed:", err);
  }
}

/**
 * Trigger: Cron-detected store with low engagement after launch.
 * The agent suggests re-engagement strategies.
 */
export async function onStoreLowEngagement(
  storeId: number,
  organizationId: number | null,
  daysSinceLaunch: number,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onStoreLowEngagement — store=${storeId}, days=${daysSinceLaunch}`);
  try {
    await runAgentAction({
      triggerType: "store_low_engagement",
      entityId: storeId,
      organizationId: organizationId ?? undefined,
      suppressNotification: options?.suppressNotification,
      prompt: `Store (ID ${storeId}) has been active for ${daysSinceLaunch} days ` +
        `but shows low engagement. Propose re-engagement strategies: ` +
        `promotional campaigns, product refresh suggestions, ` +
        `or outreach messaging to the client contact.`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onStoreLowEngagement failed:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  New email-drafting triggers                                        */
/* ------------------------------------------------------------------ */

/**
 * Trigger: A sent proposal's status changed to "viewed".
 * The agent drafts a warm follow-up email acknowledging the view,
 * addressing common hesitations, and inviting questions or a call.
 */
export async function onProposalViewed(
  proposalId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  proposalTitle: string,
  estimatedValue: number | null,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onProposalViewed — proposal=${proposalId}, org=${organizationId}`);
  try {
    const valueLine = estimatedValue != null && !Number.isNaN(estimatedValue)
      ? `Estimated value: $${Number(estimatedValue).toFixed(2)}\n`
      : "";
    await runEmailAgentAction({
      triggerType: "proposal_viewed",
      entityId: proposalId,
      organizationId: organizationId ?? undefined,
      to: clientEmail,
      suppressNotification: options?.suppressNotification,
      prompt: `A client has just viewed your proposal.

Client: ${clientName}
Proposal: "${proposalTitle}"
${valueLine}
Draft a warm, professional follow-up email that:
- Thanks them for taking the time to review the proposal
- Briefly anticipates common hesitations (pricing, timeline, approvals) and addresses them
- Invites questions or a short call to discuss
- Keeps the tone conversational — no pushiness, no hard-sell language
- Ends with a single clear call to action`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onProposalViewed failed:", err);
  }
}

/**
 * Trigger: A proposal was accepted by the client.
 * The agent drafts a confirmation email outlining next steps.
 */
export async function onProposalAccepted(
  proposalId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  proposalTitle: string,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onProposalAccepted — proposal=${proposalId}, org=${organizationId}`);
  try {
    await runEmailAgentAction({
      triggerType: "proposal_accepted",
      entityId: proposalId,
      organizationId: organizationId ?? undefined,
      to: clientEmail,
      suppressNotification: options?.suppressNotification,
      prompt: `Your proposal was just accepted. Draft a confirmation email to the client.

Client: ${clientName}
Proposal: "${proposalTitle}"

The email should:
- Thank them warmly for approving the proposal
- Outline the next steps in plain language: proof review, production timeline, invoice to follow
- Set clear expectations for when they'll hear from you next
- Offer a direct point of contact for any questions
- Keep the tone confident and professional — this is a kickoff, not a sell`,
    });

    // Auto-draft invoice from accepted proposal
    try {
      const db = await getDb();
      if (db) {
        const [proposal] = await db.select().from(proposals)
          .where(eq(proposals.id, proposalId)).limit(1);
        if (proposal) {
          const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
          await db.insert(invoices).values({
            userId: proposal.userId,
            organizationId: proposal.organizationId ?? null,
            clientId: proposal.clientId,
            proposalId: proposal.id,
            invoiceNumber,
            status: "draft",
            lineItems: null,
            subtotal: proposal.estimatedValue ?? "0.00",
            total: proposal.estimatedValue ?? "0.00",
            tax: "0.00",
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          });
          log.info(`[trigger] onProposalAccepted — auto-drafted invoice ${invoiceNumber} for proposal ${proposalId}`);
        }
      }
    } catch (invoiceErr) {
      log.warn("[trigger] onProposalAccepted — auto-draft invoice failed:", invoiceErr);
    }
  } catch (err: unknown) {
    log.error("[trigger] onProposalAccepted failed:", err);
  }
}

/**
 * Trigger: An invoice is past its due date.
 * Tone scales with severity: friendly for 1–7 days, firm for 8–21 days,
 * formal for 22+ days.
 */
export async function onInvoiceOverdue(
  invoiceId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  invoiceTotal: number,
  daysOverdue: number,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onInvoiceOverdue — invoice=${invoiceId}, days=${daysOverdue}`);
  try {
    const tone =
      daysOverdue <= 7
        ? "friendly, assume the invoice was simply missed; offer to resend"
        : daysOverdue <= 21
          ? "firm but polite; reference the original due date and ask for a payment update"
          : "formal; reference the significant delay, request immediate payment or a concrete timeline, and mention next steps if it remains unresolved";
    await runEmailAgentAction({
      triggerType: "invoice_overdue",
      entityId: invoiceId,
      organizationId: organizationId ?? undefined,
      to: clientEmail,
      suppressNotification: options?.suppressNotification,
      prompt: `An invoice is overdue. Draft a collection email.

Client: ${clientName}
Invoice ID: ${invoiceId}
Amount: $${Number(invoiceTotal).toFixed(2)}
Days overdue: ${daysOverdue}

Tone guidance: ${tone}.

The email should:
- State the overdue amount and original due date clearly
- Provide a single, specific call to action (pay now / confirm payment timeline)
- Avoid legalese unless 22+ days overdue
- End with a direct human sign-off`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onInvoiceOverdue failed:", err);
  }
}

/**
 * Trigger: A client has had no orders for 90+ days.
 * The agent drafts a re-engagement email referencing their last order.
 */
export async function onClientDormant(
  clientId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  daysSinceLastOrder: number,
  lastOrderSummary: string,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onClientDormant — client=${clientId}, days=${daysSinceLastOrder}`);
  try {
    await runEmailAgentAction({
      triggerType: "client_dormant",
      entityId: clientId,
      organizationId: organizationId ?? undefined,
      to: clientEmail,
      suppressNotification: options?.suppressNotification,
      prompt: `A client hasn't ordered in a while. Draft a re-engagement email.

Client: ${clientName}
Days since last order: ${daysSinceLastOrder}
Last order summary: ${lastOrderSummary}

The email should:
- Open warmly, acknowledging it's been a while
- Reference the last order specifically (show we remember them)
- Suggest 1–2 reasons they might want to reconnect (new products, seasonal needs, upcoming events)
- Ask a simple, low-friction question rather than pushing a sale
- Keep it short — no more than 4 sentences in the body`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onClientDormant failed:", err);
  }
}

/**
 * Trigger: A client's most recent order was ~11 months ago.
 * The agent drafts a proactive outreach email offering to prepare a new proposal.
 */
export async function onReorderWindowApproaching(
  clientId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  lastOrderDate: Date,
  productSummary: string,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onReorderWindowApproaching — client=${clientId}`);
  try {
    const isoDate = new Date(lastOrderDate).toISOString().split("T")[0];
    await runEmailAgentAction({
      triggerType: "reorder_window",
      entityId: clientId,
      organizationId: organizationId ?? undefined,
      to: clientEmail,
      suppressNotification: options?.suppressNotification,
      prompt: `A client is approaching the one-year anniversary of their last order.
This is a natural re-order moment for branded merchandise (annual swag, uniform refreshes, event giveaways).

Client: ${clientName}
Last order date: ${isoDate}
Products on that order: ${productSummary}

The email should:
- Acknowledge the anniversary naturally ("it's been about a year since…")
- Reference what they ordered last time
- Offer to prepare a refreshed proposal based on their previous selections
- Suggest any obvious new angle (updated designs, new product options, volume pricing)
- Make it easy to say yes — end with a single concrete next step`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onReorderWindowApproaching failed:", err);
  }
}

/**
 * Trigger: A new client record was created.
 * The agent drafts a professional welcome email introducing the distributor's services.
 */
export async function onNewClientCreated(
  clientId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  industry: string | null,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onNewClientCreated — client=${clientId}, org=${organizationId}`);
  try {
    const industryLine = industry ? `Industry: ${industry}\n` : "";
    await runEmailAgentAction({
      triggerType: "new_client",
      entityId: clientId,
      organizationId: organizationId ?? undefined,
      to: clientEmail,
      suppressNotification: options?.suppressNotification,
      prompt: `A new client was just added to the distributor's book of business. Draft a welcome/introduction email.

Client: ${clientName}
${industryLine}
The email should:
- Introduce the distributor's services briefly and concretely (branded merchandise, promotional products, proposal-based sourcing)
- Reference something relevant to the client's industry when one is provided
- Invite a short intro call or a quick exchange of needs
- End with a clear, friendly next step
- Keep the tone professional but human — no boilerplate "we are excited to partner with you" phrasing`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onNewClientCreated failed:", err);
  }
}

/**
 * Trigger: An order has been shipped or delivered.
 * The agent drafts a post-delivery check-in email for send ~7 days after delivery,
 * asking for feedback and planting the seed for the next order.
 */
export async function onOrderDelivered(
  orderId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  productSummary: string,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onOrderDelivered — order=${orderId}`);
  try {
    await runEmailAgentAction({
      triggerType: "order_delivered",
      entityId: orderId,
      organizationId: organizationId ?? undefined,
      to: clientEmail,
      suppressNotification: options?.suppressNotification,
      prompt: `An order was recently shipped/delivered. Draft a check-in email intended to send about 7 days after delivery.

Client: ${clientName}
Order contents: ${productSummary}

The email should:
- Ask genuinely how the items landed with the team / recipients
- Invite a quick reply with any feedback (quality, fit, print)
- Softly open the door to a next order — reorders, complementary items, or an upcoming event
- Keep it brief — 3–4 short sentences
- Sound like a check-in from a partner, not a survey request`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onOrderDelivered failed:", err);
  }
}

/**
 * Trigger: Pattern detection has found a recurring reorder pattern for
 * a client with their predicted reorder window approaching. The agent
 * drafts a warm, pattern-aware outreach email so the distributor can
 * surface a fresh proposal before the competitor does.
 *
 * ownerId is supplied by the cron (resolved from orgMembers.role=owner)
 * so this trigger can pull the distributor's voice profile via
 * copilotMemory without a second owner-resolution round-trip.
 *
 * The full voice block is still prepended by runEmailAgentAction's
 * built-in `## Distributor Context` hook — this trigger layers in the
 * trigger-specific context (pattern summary, client industry, order
 * history) alongside it.
 */
export async function onPredictiveOpportunityDetected(
  clientId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  patternSummary: string,
  predictedValue: number,
  confidence: number,
  ownerId: number,
  options?: TriggerOptions,
): Promise<void> {
  log.info(
    `[trigger] onPredictiveOpportunityDetected — client=${clientId}, org=${organizationId}, ` +
      `confidence=${confidence.toFixed(2)}`,
  );
  try {
    const { industry, historySummary } = await loadPredictiveClientContext(
      clientId,
      organizationId,
    );
    // Voice profile — per spec, fetched here via buildMemoryContext +
    // formatMemoryForPrompt. The result seeds the `voiceHasProfile`
    // hint that shapes the prompt's sign-off guidance; the block itself
    // is injected by runEmailAgentAction so we do not re-prepend it.
    const voiceBlock = await loadDistributorVoiceBlock(ownerId, organizationId);

    const industryLine = industry ? `Industry: ${industry}\n` : "";
    const valueLine =
      Number.isFinite(predictedValue) && predictedValue > 0
        ? `Average prior order value: $${predictedValue.toFixed(2)}\n`
        : "";
    const signOffLine = voiceBlock
      ? `- Sign off in the distributor's documented voice (see Distributor Context above)`
      : `- Sign off warmly in a first-person voice — no boilerplate`;

    // Email draft + proposal draft are independent — run them in parallel
    // so a DB hiccup on one never blocks the other. Each path has its own
    // internal error handling; Promise.allSettled keeps both outcomes.
    await Promise.allSettled([
      runEmailAgentAction({
        triggerType: "predictive_opportunity",
        entityId: clientId,
        organizationId: organizationId ?? undefined,
        to: clientEmail,
        suppressNotification: options?.suppressNotification,
        extraArgs: {
          patternSummary,
          predictedValue,
        },
        prompt: `A recurring ordering pattern has been detected for this client. Draft a proactive outreach email.

Client: ${clientName}
${industryLine}Detected pattern: ${patternSummary}
Confidence: ${(confidence * 100).toFixed(0)}%
${valueLine}Order history: ${historySummary}

The email should:
- Reference the client's ordering pattern naturally (e.g. "we noticed you typically stock up around this time of year")
- Suggest preparing a fresh proposal based on their history
- Mention 1–2 relevant product angles drawn from their past orders and industry
- Feel like a thoughtful heads-up from a trusted partner, not a sales push
- Keep it to 4–5 sentences in the body
${signOffLine}`,
      }),
      createPredictiveProposalDraft({
        clientId,
        organizationId,
        clientName,
        predictedValue,
        ownerId,
      }),
    ]);
  } catch (err: unknown) {
    log.error("[trigger] onPredictiveOpportunityDetected failed:", err);
  }
}

/**
 * Create a ready-for-review proposal draft for a detected predictive
 * opportunity. Pre-fills:
 *   • client + distributor ownership,
 *   • products copied from the client's most recent order,
 *   • estimatedValue from the order-history average (predictedValue),
 *   • a dated "Reorder — [Client] — [Month Year]" title.
 *
 * Returns silently on any failure so the paired email-draft path is
 * never blocked by a proposal-insertion hiccup.
 */
async function createPredictiveProposalDraft(args: {
  clientId: number;
  organizationId: number | null;
  clientName: string;
  predictedValue: number;
  ownerId: number;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const ordersScope = args.organizationId != null
      ? and(eq(orders.clientId, args.clientId), eq(orders.organizationId, args.organizationId))
      : eq(orders.clientId, args.clientId);
    const [lastOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(ordersScope)
      .orderBy(desc(orders.createdAt))
      .limit(1);
    if (!lastOrder) return;

    const lastItems = await db
      .select({
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        decorationType: orderItems.decorationType,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, lastOrder.id));
    if (lastItems.length === 0) return;

    const now = new Date();
    const monthYear = `${MONTH_NAMES[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
    const title = `Reorder — ${args.clientName} — ${monthYear}`;
    const estimatedValue =
      Number.isFinite(args.predictedValue) && args.predictedValue > 0
        ? args.predictedValue.toFixed(2)
        : "0.00";

    const values: InsertProposal = {
      userId: args.ownerId,
      organizationId: args.organizationId,
      clientId: args.clientId,
      title,
      proposalType: "promo",
      status: "draft",
      estimatedValue,
      deliveryMethod: "email",
      viewToken: nanoid(24),
    };
    const result = await db.insert(proposals).values(values);
    const proposalId = result[0]?.insertId;
    if (!proposalId) return;

    const ppValues: InsertProposalProduct[] = lastItems.map((li) => ({
      proposalId,
      productId: li.productId,
      quantity: li.quantity,
      unitPrice: li.unitPrice ?? null,
      decorationType: li.decorationType ?? null,
    }));
    await db.insert(proposalProducts).values(ppValues);

    // Surface the draft in the Agent Inbox so the distributor lands on it
    // in the morning briefing alongside the outreach email. toolName is
    // `review_proposal_draft` — a navigation-only action; approve/deny
    // doesn't fire a server-side tool, the UI routes to the editor.
    const formattedValue = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(estimatedValue));
    await db.insert(copilotPendingActions).values({
      userId: args.ownerId,
      organizationId: args.organizationId,
      toolCallId: `agent_predictive_proposal_draft_${proposalId}_${Date.now()}`,
      toolName: "review_proposal_draft",
      summary: `Proposal draft ready to review — ${args.clientName} — ${formattedValue}`,
      serializedArgs: JSON.stringify({
        proposalId,
        clientName: args.clientName,
        proposalTitle: title,
        estimatedValue,
        triggerType: "predictive_proposal_draft",
      }),
      status: "pending",
      source: "agent",
    });

    log.info(
      `[trigger] createPredictiveProposalDraft — proposal=${proposalId}, ` +
        `client=${args.clientId}, items=${ppValues.length}`,
    );
  } catch (err: unknown) {
    log.warn("[trigger] createPredictiveProposalDraft failed:", err);
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Load the client-scoped context the predictive-opportunity trigger needs
 * to ground its prompt: industry (for product-angle suggestions) and a
 * short order-history summary (for "we noticed you ordered X last time"
 * style language). Never throws — returns safe defaults on any failure.
 */
async function loadPredictiveClientContext(
  clientId: number,
  organizationId: number | null,
): Promise<{ industry: string | null; historySummary: string }> {
  try {
    const db = await getDb();
    if (!db) return { industry: null, historySummary: "no history available" };

    const clientScope = organizationId != null
      ? and(eq(clients.id, clientId), eq(clients.organizationId, organizationId))
      : eq(clients.id, clientId);
    const [client] = await db
      .select({ industry: clients.industry })
      .from(clients)
      .where(clientScope)
      .limit(1);

    const ordersScope = organizationId != null
      ? and(eq(orders.clientId, clientId), eq(orders.organizationId, organizationId))
      : eq(orders.clientId, clientId);
    const orderRows = await db
      .select({ id: orders.id, createdAt: orders.createdAt })
      .from(orders)
      .where(ordersScope)
      .orderBy(asc(orders.createdAt));

    if (orderRows.length === 0) {
      return {
        industry: client?.industry ?? null,
        historySummary: "no prior orders on record",
      };
    }

    const first = new Date(orderRows[0].createdAt);
    const last = new Date(orderRows[orderRows.length - 1].createdAt);
    const spanMonths = Math.max(
      1,
      Math.round((last.getTime() - first.getTime()) / (30 * 24 * 60 * 60 * 1000)),
    );

    const topProducts = await db
      .select({
        name: products.name,
        qty: sql<number>`SUM(${orderItems.quantity})`,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(ordersScope)
      .groupBy(products.name)
      .orderBy(desc(sql`SUM(${orderItems.quantity})`))
      .limit(3);

    const productsLine = topProducts.length > 0
      ? `top items ${topProducts
          .map((t) => t.name)
          .filter((n): n is string => typeof n === "string" && n.length > 0)
          .join(", ")}`
      : "";

    const countPart = `${orderRows.length} order${orderRows.length === 1 ? "" : "s"} over ~${spanMonths} month${spanMonths === 1 ? "" : "s"}`;
    const historySummary = productsLine ? `${countPart}; ${productsLine}` : countPart;

    return { industry: client?.industry ?? null, historySummary };
  } catch (err: unknown) {
    log.warn("[trigger] loadPredictiveClientContext failed:", err);
    return { industry: null, historySummary: "no history available" };
  }
}

/**
 * Pull the distributor's voice profile block. Returns an empty string on
 * any failure so the trigger can degrade gracefully; runEmailAgentAction
 * will still inject the same block independently.
 */
async function loadDistributorVoiceBlock(
  ownerId: number,
  organizationId: number | null,
): Promise<string> {
  try {
    const mem = await buildMemoryContext(ownerId, organizationId ?? null);
    return formatMemoryForPrompt(mem).trim();
  } catch (err: unknown) {
    log.warn("[trigger] loadDistributorVoiceBlock failed:", err);
    return "";
  }
}

/**
 * Trigger: A sent proposal is within 3 days of its validity period expiring
 * and has not yet been accepted.
 */
export async function onProposalExpiringSoon(
  proposalId: number,
  organizationId: number | null,
  clientEmail: string,
  clientName: string,
  proposalTitle: string,
  daysUntilExpiry: number,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onProposalExpiringSoon — proposal=${proposalId}, days=${daysUntilExpiry}`);
  try {
    await runEmailAgentAction({
      triggerType: "proposal_expiring",
      entityId: proposalId,
      organizationId: organizationId ?? undefined,
      to: clientEmail,
      suppressNotification: options?.suppressNotification,
      prompt: `A sent proposal is about to expire. Draft a gentle-urgency email.

Client: ${clientName}
Proposal: "${proposalTitle}"
Days until expiry: ${daysUntilExpiry}

The email should:
- Note the upcoming expiry without being alarmist
- Remind them of the specific proposal
- Offer to extend, revise, or answer any remaining questions
- Provide a single easy next step (reply with yes / schedule a call)
- Keep the tone friendly — expiry is a prompt, not a threat`,
    });
  } catch (err: unknown) {
    log.error("[trigger] onProposalExpiringSoon failed:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Phase 8 — new scans + triggers                                     */
/* ------------------------------------------------------------------ */

export async function scanSupplierCostChanges(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  pending: Promise<void>[],
): Promise<void> {
  try {
    // Find unnotified cost changes grouped by org
    const changes = await db
      .select({
        organizationId: suppliers.organizationId,
        userId: suppliers.userId,
        supplierName: suppliers.name,
        supplierId: supplierCostChangeLog.supplierId,
        productId: supplierCostChangeLog.productId,
        previousCostCents: supplierCostChangeLog.previousCostCents,
        newCostCents: supplierCostChangeLog.newCostCents,
        currency: supplierCostChangeLog.currency,
        changeId: supplierCostChangeLog.id,
      })
      .from(supplierCostChangeLog)
      .innerJoin(suppliers, eq(suppliers.id, supplierCostChangeLog.supplierId))
      .where(eq(supplierCostChangeLog.notificationSent, false))
      .limit(100);

    if (changes.length === 0) return;

    // Group by organizationId
    type CostChangeRow = typeof changes[number];
    const byOrg = new Map<number | null, CostChangeRow[]>();
    for (const c of changes) {
      const key = c.organizationId ?? null;
      if (!byOrg.has(key)) byOrg.set(key, []);
      byOrg.get(key)!.push(c);
    }

    for (const [organizationId, orgChanges] of Array.from(byOrg.entries())) {
      const userId = orgChanges[0].userId;
      const supplierName = orgChanges[0].supplierName;
      const increaseCount = orgChanges.filter(c => c.newCostCents > (c.previousCostCents ?? 0)).length;
      const decreaseCount = orgChanges.length - increaseCount;

      // Insert agent inbox action
      const summary = `${supplierName} updated pricing: ${increaseCount} price increase${increaseCount !== 1 ? "s" : ""}, ${decreaseCount} decrease${decreaseCount !== 1 ? "s" : ""}. Review affected client margins.`;

      await db.insert(copilotPendingActions).values({
        userId,
        organizationId: organizationId ?? undefined,
        toolCallId: `agent_supplier_cost_${orgChanges[0].supplierId}_${Date.now()}`,
        toolName: "review_supplier_cost_changes",
        summary,
        serializedArgs: JSON.stringify({
          supplierId: orgChanges[0].supplierId,
          supplierName,
          changeCount: orgChanges.length,
          increaseCount,
          decreaseCount,
          triggerType: "supplier_cost_change",
        }),
        status: "pending",
        source: "agent",
      });

      // Mark changes as notified
      const changeIds = orgChanges.map(c => Number(c.changeId));
      await db.update(supplierCostChangeLog)
        .set({ notificationSent: true })
        .where(inArray(supplierCostChangeLog.id, changeIds));
    }
  } catch (err) {
    log.warn("[agentCron] scanSupplierCostChanges failed:", err);
  }
}

export async function scanStoreZoneHealth(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  pending: Promise<void>[],
): Promise<void> {
  try {
    // Find active stores that have products with no imprint zones configured
    const storesWithIssues = await db
      .select({
        storeId: stores.id,
        storeName: stores.name,
        userId: stores.userId,
        organizationId: stores.organizationId,
        unzonedCount: sql<number>`COUNT(DISTINCT ${storeProducts.productId})`,
      })
      .from(stores)
      .innerJoin(storeProducts, eq(storeProducts.storeId, stores.id))
      .leftJoin(
        productImprintZones,
        eq(productImprintZones.productId, storeProducts.productId)
      )
      .where(and(
        eq(stores.status, "active"),
        isNull(productImprintZones.id),
      ))
      .groupBy(stores.id, stores.name, stores.userId, stores.organizationId)
      .having(sql`COUNT(DISTINCT ${storeProducts.productId}) > 0`)
      .limit(20);

    for (const store of storesWithIssues) {
      await db.insert(copilotPendingActions).values({
        userId: store.userId,
        organizationId: store.organizationId ?? undefined,
        toolCallId: `agent_zone_health_${store.storeId}_${Date.now()}`,
        toolName: "fix_store_zone_health",
        summary: `${store.storeName} has ${store.unzonedCount} product${store.unzonedCount !== 1 ? "s" : ""} with no imprint zones configured — customers see unbranded gear.`,
        serializedArgs: JSON.stringify({
          storeId: store.storeId,
          storeName: store.storeName,
          unzonedCount: store.unzonedCount,
          triggerType: "store_zone_health",
        }),
        status: "pending",
        source: "agent",
      });
    }
  } catch (err) {
    log.warn("[agentCron] scanStoreZoneHealth failed:", err);
  }
}

/**
 * Trigger: An order was just fulfilled. Draft a post-delivery retention
 * email asking about satisfaction and seeding the next reorder.
 */
export async function onFulfilled(
  entityType: "proposal" | "invoice" | "estimate",
  entityId: number,
  clientId: number,
  organizationId: number | null,
  options?: TriggerOptions,
): Promise<void> {
  log.info(`[trigger] onFulfilled — ${entityType}=${entityId}, org=${organizationId}`);
  try {
    const db = await getDb();
    if (!db) return;

    const [client] = await db.select({ companyName: clients.companyName, contactEmail: clients.contactEmail, pocEmail: clients.pocEmail })
      .from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!client) return;

    const [user] = await db.select({ id: users.id })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, organizationId!))
      .limit(1);

    await runEmailAgentAction({
      triggerType: "order_delivered",
      entityId,
      organizationId: organizationId ?? undefined,
      to: client.pocEmail || client.contactEmail || "",
      suppressNotification: options?.suppressNotification,
      prompt: `An order has just been fulfilled and delivered to the client. Draft a follow-up email.
Client: ${client.companyName}
The email should:
- Confirm the order was delivered successfully
- Ask if they're happy with the branded merchandise
- Mention that reorder time typically takes X weeks so they can plan ahead
- Suggest checking the webstore for new seasonal products
- Keep it warm and relationship-focused — this is a retention touchpoint`,
    });
  } catch (err) {
    log.error("[trigger] onFulfilled failed:", err);
  }
}

export async function scanSeasonalStoreOpportunities(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  pending: Promise<void>[],
): Promise<void> {
  try {
    const currentMonth = new Date().getMonth() + 1; // 1-12

    // Seasonal product categories by month range
    const seasonalHints: Record<number, string> = {
      1: "New Year promotions, winter clearance",
      2: "Valentine's Day branded gifts",
      3: "Spring launch merchandise",
      4: "Spring trade show season",
      5: "Employee appreciation week",
      6: "Summer gear, outdoor events",
      7: "Mid-year refresh, summer campaigns",
      8: "Back to school, fall preparation",
      9: "Fall trade shows, Q4 planning",
      10: "Holiday gift planning season",
      11: "Holiday branded merchandise",
      12: "Year-end gifts, holiday rush",
    };

    const seasonHint = seasonalHints[currentMonth] ?? "seasonal promotions";

    // Find active stores that haven't had a webstore order in 45+ days
    const staleStores = await db
      .select({
        storeId: stores.id,
        storeName: stores.name,
        userId: stores.userId,
        organizationId: stores.organizationId,
        clientId: stores.clientId,
        lastOrderAt: sql<string>`MAX(${orders.createdAt})`,
      })
      .from(stores)
      .leftJoin(orders, eq(orders.storeId, stores.id))
      .where(and(
        eq(stores.status, "active"),
        isNotNull(stores.clientId),
      ))
      .groupBy(stores.id, stores.name, stores.userId, stores.organizationId, stores.clientId)
      .having(sql`MAX(${orders.createdAt}) < DATE_SUB(NOW(), INTERVAL 45 DAY) OR MAX(${orders.createdAt}) IS NULL`)
      .limit(10);

    for (const store of staleStores) {
      if (!store.clientId) continue;

      const [client] = await db.select({ companyName: clients.companyName })
        .from(clients).where(eq(clients.id, store.clientId)).limit(1);
      if (!client) continue;

      await db.insert(copilotPendingActions).values({
        userId: store.userId,
        organizationId: store.organizationId ?? undefined,
        toolCallId: `agent_seasonal_${store.storeId}_${currentMonth}_${Date.now()}`,
        toolName: "review_seasonal_opportunity",
        summary: `${client.companyName}'s store hasn't had an order in 45+ days. It's ${seasonHint} season — consider updating their catalog or sending a promotional email.`,
        serializedArgs: JSON.stringify({
          storeId: store.storeId,
          storeName: store.storeName,
          clientId: store.clientId,
          clientName: client.companyName,
          seasonHint,
          currentMonth,
          triggerType: "seasonal_store_opportunity",
        }),
        status: "pending",
        source: "agent",
      });
    }
  } catch (err) {
    log.warn("[agentCron] scanSeasonalStoreOpportunities failed:", err);
  }
}
