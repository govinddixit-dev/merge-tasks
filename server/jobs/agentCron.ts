/**
 * agentCron.ts — Periodic agent job that scans the platform for
 * work the distributor should consider and fires the appropriate
 * triggers. Each scan deduplicates against copilotPendingActions so a
 * distributor isn't shown the same suggestion twice within a week.
 *
 * Scheduled via setInterval (24 hours) in server/_core/index.ts.
 *
 * Scans (in order):
 *   1. Low-engagement stores           (onStoreLowEngagement)
 *   2. Overdue invoices                (onInvoiceOverdue)
 *   3. Dormant clients (>90d no order) (onClientDormant)
 *   4. Reorder window (~11 months)     (onReorderWindowApproaching)
 *   5. Expiring proposals (<3d left)   (onProposalExpiringSoon)
 *   6. Stale viewed proposals (>48h)   (onProposalViewed)
 *   7. Predictive opportunities        (onPredictiveOpportunityDetected)
 *
 * After all scans finish, counts how many new pending actions were
 * written during this run (source=agent) and sends a single "Your AI
 * briefing is ready" notification per affected organization owner.
 */

import { getDb } from "../db";
import {
  stores,
  storeProducts,
  copilotPendingActions,
  invoices,
  clients,
  orders,
  proposals,
  orgMembers,
  organizations,
} from "../../drizzle/schema";
import {
  eq,
  and,
  sql,
  lt,
  lte,
  gt,
  gte,
  like,
  inArray,
  notInArray,
  isNotNull,
} from "drizzle-orm";
import {
  onStoreLowEngagement,
  onInvoiceOverdue,
  onClientDormant,
  onReorderWindowApproaching,
  onProposalExpiringSoon,
  onProposalViewed,
  onPredictiveOpportunityDetected,
  scanSupplierCostChanges,
  scanStoreZoneHealth,
  scanSeasonalStoreOpportunities,
} from "../utils/agentTriggers";
import { detectReorderPatterns } from "../utils/patternDetection";
import { notifyOwner } from "../_core/notification";
import { getLogger } from "../utils/logger";
import { runSanMarBulkSyncAllOrgs } from "./sanMarBulkSync";

const log = getLogger("agentCron");

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 7 * TWENTY_FOUR_HOURS_MS;
const LOW_ENGAGEMENT_DAYS = 14;
const DORMANT_CLIENT_DAYS = 90;
const REORDER_WINDOW_MIN_DAYS = 330;
const REORDER_WINDOW_MAX_DAYS = 380;
const PROPOSAL_EXPIRY_DAYS_AHEAD = 3;
const STALE_VIEWED_HOURS = 48;
const MAX_ROWS_PER_SCAN = 50;
const LOW_PRODUCT_THRESHOLD = 3;
const INITIAL_DELAY_MS = 60_000;
const PREDICTIVE_MIN_CONFIDENCE = 0.6;
const PREDICTIVE_WINDOW_MAX_DAYS_AHEAD = 45;
const ACTIVE_PROPOSAL_STATUSES = ["draft", "sent", "viewed"] as const;
const PENDING_ORDER_STATUSES = ["pending", "processing"] as const;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/* ------------------------------------------------------------------ */
/*  Dedup helper                                                       */
/* ------------------------------------------------------------------ */

/**
 * Has a pending action already been created for this dedup key within
 * the past 7 days? Callers pass a key of the form
 *   agent_<triggerType>_<entityId>
 * matching the toolCallId prefix written by runAgentAction/runEmailAgentAction.
 */
async function isDuplicatePendingAction(
  db: Db,
  toolCallPrefix: string,
  organizationId: number | null,
): Promise<boolean> {
  const conditions = [
    like(copilotPendingActions.toolCallId, `${toolCallPrefix}_%`),
    gte(copilotPendingActions.createdAt, new Date(Date.now() - DEDUP_WINDOW_MS)),
  ];
  if (organizationId != null) {
    conditions.push(eq(copilotPendingActions.organizationId, organizationId));
  }
  const existing = await db
    .select({ id: copilotPendingActions.id })
    .from(copilotPendingActions)
    .where(and(...conditions))
    .limit(1);
  return existing.length > 0;
}

/* ------------------------------------------------------------------ */
/*  Scan 1 — Low-engagement stores (existing behaviour preserved)      */
/* ------------------------------------------------------------------ */

async function scanLowEngagementStores(db: Db, pending: Promise<void>[]): Promise<void> {
  try {
    const cutoffDate = new Date(Date.now() - LOW_ENGAGEMENT_DAYS * TWENTY_FOUR_HOURS_MS);

    const staleStores = await db
      .select({
        id: stores.id,
        organizationId: stores.organizationId,
        createdAt: stores.createdAt,
      })
      .from(stores)
      .where(
        and(
          eq(stores.status, "active"),
          lt(stores.createdAt, cutoffDate),
        ),
      )
      .limit(MAX_ROWS_PER_SCAN);

    for (const store of staleStores) {
      const [productCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(storeProducts)
        .where(eq(storeProducts.storeId, store.id));
      const count = productCount?.count ?? 0;
      if (count > LOW_PRODUCT_THRESHOLD) continue;

      if (await isDuplicatePendingAction(
        db,
        `agent_store_low_engagement_${store.id}`,
        store.organizationId,
      )) continue;

      const daysSinceLaunch = Math.floor(
        (Date.now() - new Date(store.createdAt).getTime()) / TWENTY_FOUR_HOURS_MS,
      );
      pending.push(
        onStoreLowEngagement(store.id, store.organizationId, daysSinceLaunch, {
          suppressNotification: true,
        }).catch((err: unknown) => {
          log.error(`[agentCron] store trigger failed for store ${store.id}:`, err);
        }),
      );
    }
    log.info(`[agentCron] Low-engagement scan: evaluated ${staleStores.length} stores.`);
  } catch (err: unknown) {
    log.error("[agentCron] Low-engagement scan error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Scan 2 — Overdue invoices                                          */
/* ------------------------------------------------------------------ */

async function scanOverdueInvoices(db: Db, pending: Promise<void>[]): Promise<void> {
  try {
    const overdueRows = await db
      .select({
        id: invoices.id,
        organizationId: invoices.organizationId,
        clientId: invoices.clientId,
        total: invoices.total,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .where(
        and(
          isNotNull(invoices.dueDate),
          lt(invoices.dueDate, new Date()),
          notInArray(invoices.status, ["paid", "void", "cancelled", "refunded", "credit_issued"]),
        ),
      )
      .limit(MAX_ROWS_PER_SCAN);

    for (const inv of overdueRows) {
      if (await isDuplicatePendingAction(
        db,
        `agent_invoice_overdue_${inv.id}`,
        inv.organizationId,
      )) continue;

      const [client] = await db
        .select({
          contactEmail: clients.contactEmail,
          contactName: clients.contactName,
        })
        .from(clients)
        .where(eq(clients.id, inv.clientId))
        .limit(1);
      if (!client?.contactEmail || !inv.dueDate) continue;

      const daysOverdue = Math.floor(
        (Date.now() - new Date(inv.dueDate).getTime()) / TWENTY_FOUR_HOURS_MS,
      );
      if (daysOverdue <= 0) continue;

      pending.push(
        onInvoiceOverdue(
          inv.id,
          inv.organizationId,
          client.contactEmail,
          client.contactName,
          Number(inv.total),
          daysOverdue,
          { suppressNotification: true },
        ).catch((err: unknown) => {
          log.error(`[agentCron] invoice trigger failed for invoice ${inv.id}:`, err);
        }),
      );
    }
    log.info(`[agentCron] Overdue-invoice scan: evaluated ${overdueRows.length} invoices.`);
  } catch (err: unknown) {
    log.error("[agentCron] Overdue-invoice scan error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Scan 3 — Dormant clients (>90d since last order)                   */
/* ------------------------------------------------------------------ */

async function scanDormantClients(db: Db, pending: Promise<void>[]): Promise<void> {
  try {
    // Group orders by clientId → most recent createdAt. Filter to rows
    // whose latest order is older than DORMANT_CLIENT_DAYS. Join back to
    // the client record for contact info + org scope.
    const dormantCutoff = new Date(Date.now() - DORMANT_CLIENT_DAYS * TWENTY_FOUR_HOURS_MS);
    type DormantRow = {
      clientId: number;
      organizationId: number | null;
      contactEmail: string;
      contactName: string;
      lastOrderAt: Date;
      orderCount: number;
      lastTotal: string | null;
    };
    const raw = await db.execute(sql`
      SELECT
        c.id AS clientId,
        c.organizationId AS organizationId,
        c.contactEmail AS contactEmail,
        c.contactName AS contactName,
        agg.lastOrderAt AS lastOrderAt,
        agg.orderCount AS orderCount,
        agg.lastTotal AS lastTotal
      FROM (
        SELECT
          o.clientId AS clientId,
          MAX(o.createdAt) AS lastOrderAt,
          COUNT(*) AS orderCount,
          SUBSTRING_INDEX(GROUP_CONCAT(o.total ORDER BY o.createdAt DESC), ',', 1) AS lastTotal
        FROM orders o
        GROUP BY o.clientId
      ) AS agg
      JOIN clients c ON c.id = agg.clientId
      WHERE agg.lastOrderAt < ${dormantCutoff}
        AND c.contactEmail IS NOT NULL AND c.contactEmail <> ''
      LIMIT ${MAX_ROWS_PER_SCAN}
    `);
    // drizzle-orm mysql2 returns [rows, fields] for raw SELECTs; some driver
    // versions return rows directly. Accept either shape.
    const list: DormantRow[] = Array.isArray(raw) && Array.isArray(raw[0])
      ? (raw[0] as DormantRow[])
      : (raw as unknown as DormantRow[]);

    for (const r of list) {
      if (await isDuplicatePendingAction(
        db,
        `agent_client_dormant_${r.clientId}`,
        r.organizationId,
      )) continue;

      const daysSince = Math.floor(
        (Date.now() - new Date(r.lastOrderAt).getTime()) / TWENTY_FOUR_HOURS_MS,
      );
      const totalLine = r.lastTotal
        ? ` (approx $${Number(r.lastTotal).toFixed(2)})`
        : "";
      const lastOrderSummary = `${r.orderCount} previous order${r.orderCount === 1 ? "" : "s"}, most recent ${daysSince} days ago${totalLine}`;

      pending.push(
        onClientDormant(
          r.clientId,
          r.organizationId,
          r.contactEmail,
          r.contactName,
          daysSince,
          lastOrderSummary,
          { suppressNotification: true },
        ).catch((err: unknown) => {
          log.error(`[agentCron] dormant-client trigger failed for client ${r.clientId}:`, err);
        }),
      );
    }
    log.info(`[agentCron] Dormant-client scan: evaluated ${list.length} clients.`);
  } catch (err: unknown) {
    log.error("[agentCron] Dormant-client scan error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Scan 4 — Reorder window (~11 months since last order)              */
/* ------------------------------------------------------------------ */

async function scanReorderWindow(db: Db, pending: Promise<void>[]): Promise<void> {
  try {
    const windowStart = new Date(Date.now() - REORDER_WINDOW_MAX_DAYS * TWENTY_FOUR_HOURS_MS);
    const windowEnd = new Date(Date.now() - REORDER_WINDOW_MIN_DAYS * TWENTY_FOUR_HOURS_MS);

    type ReorderRow = {
      clientId: number;
      organizationId: number | null;
      contactEmail: string;
      contactName: string;
      lastOrderAt: Date;
      lastOrderNumber: string | null;
    };
    const raw = await db.execute(sql`
      SELECT
        c.id AS clientId,
        c.organizationId AS organizationId,
        c.contactEmail AS contactEmail,
        c.contactName AS contactName,
        agg.lastOrderAt AS lastOrderAt,
        agg.lastOrderNumber AS lastOrderNumber
      FROM (
        SELECT
          o.clientId AS clientId,
          MAX(o.createdAt) AS lastOrderAt,
          SUBSTRING_INDEX(GROUP_CONCAT(o.orderNumber ORDER BY o.createdAt DESC), ',', 1) AS lastOrderNumber
        FROM orders o
        GROUP BY o.clientId
      ) AS agg
      JOIN clients c ON c.id = agg.clientId
      WHERE agg.lastOrderAt BETWEEN ${windowStart} AND ${windowEnd}
        AND c.contactEmail IS NOT NULL AND c.contactEmail <> ''
      LIMIT ${MAX_ROWS_PER_SCAN}
    `);
    const list: ReorderRow[] = Array.isArray(raw) && Array.isArray(raw[0])
      ? (raw[0] as ReorderRow[])
      : (raw as unknown as ReorderRow[]);

    for (const r of list) {
      if (await isDuplicatePendingAction(
        db,
        `agent_reorder_${r.clientId}`,
        r.organizationId,
      )) continue;

      const productSummary = r.lastOrderNumber
        ? `Order ${r.lastOrderNumber}`
        : "prior order";
      pending.push(
        onReorderWindowApproaching(
          r.clientId,
          r.organizationId,
          r.contactEmail,
          r.contactName,
          new Date(r.lastOrderAt),
          productSummary,
          { suppressNotification: true },
        ).catch((err: unknown) => {
          log.error(`[agentCron] reorder trigger failed for client ${r.clientId}:`, err);
        }),
      );
    }
    log.info(`[agentCron] Reorder-window scan: evaluated ${list.length} clients.`);
  } catch (err: unknown) {
    log.error("[agentCron] Reorder-window scan error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Scan 5 — Expiring proposals (<3d until sentAt + validDays)         */
/* ------------------------------------------------------------------ */

async function scanExpiringProposals(db: Db, pending: Promise<void>[]): Promise<void> {
  try {
    // sentAt + validDays days < now + 3d  AND  sentAt + validDays days > now
    const expiringRows = await db
      .select({
        id: proposals.id,
        organizationId: proposals.organizationId,
        clientId: proposals.clientId,
        title: proposals.title,
        sentAt: proposals.sentAt,
        validDays: proposals.validDays,
      })
      .from(proposals)
      .where(
        and(
          eq(proposals.status, "sent"),
          isNotNull(proposals.sentAt),
          gt(proposals.validDays, 0),
          // expiry = sentAt + validDays; select rows whose expiry is in (now, now+3d]
          sql`DATE_ADD(${proposals.sentAt}, INTERVAL ${proposals.validDays} DAY) > NOW()`,
          sql`DATE_ADD(${proposals.sentAt}, INTERVAL ${proposals.validDays} DAY) <= DATE_ADD(NOW(), INTERVAL ${PROPOSAL_EXPIRY_DAYS_AHEAD} DAY)`,
        ),
      )
      .limit(MAX_ROWS_PER_SCAN);

    for (const p of expiringRows) {
      if (await isDuplicatePendingAction(
        db,
        `agent_proposal_expiring_${p.id}`,
        p.organizationId,
      )) continue;

      const [client] = await db
        .select({
          contactEmail: clients.contactEmail,
          contactName: clients.contactName,
        })
        .from(clients)
        .where(eq(clients.id, p.clientId))
        .limit(1);
      if (!client?.contactEmail || !p.sentAt) continue;

      const expiryMs = new Date(p.sentAt).getTime() + p.validDays * TWENTY_FOUR_HOURS_MS;
      const daysUntilExpiry = Math.max(
        0,
        Math.ceil((expiryMs - Date.now()) / TWENTY_FOUR_HOURS_MS),
      );
      pending.push(
        onProposalExpiringSoon(
          p.id,
          p.organizationId,
          client.contactEmail,
          client.contactName,
          p.title,
          daysUntilExpiry,
          { suppressNotification: true },
        ).catch((err: unknown) => {
          log.error(`[agentCron] expiring-proposal trigger failed for proposal ${p.id}:`, err);
        }),
      );
    }
    log.info(`[agentCron] Expiring-proposal scan: evaluated ${expiringRows.length} proposals.`);
  } catch (err: unknown) {
    log.error("[agentCron] Expiring-proposal scan error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Scan 6 — Stale viewed proposals (>48h since viewed, still "viewed")*/
/* ------------------------------------------------------------------ */

async function scanStaleViewedProposals(db: Db, pending: Promise<void>[]): Promise<void> {
  try {
    const staleCutoff = new Date(Date.now() - STALE_VIEWED_HOURS * 60 * 60 * 1000);
    const staleRows = await db
      .select({
        id: proposals.id,
        organizationId: proposals.organizationId,
        clientId: proposals.clientId,
        title: proposals.title,
        estimatedValue: proposals.estimatedValue,
        viewedAt: proposals.viewedAt,
      })
      .from(proposals)
      .where(
        and(
          eq(proposals.status, "viewed"),
          isNotNull(proposals.viewedAt),
          lte(proposals.viewedAt, staleCutoff),
        ),
      )
      .limit(MAX_ROWS_PER_SCAN);

    for (const p of staleRows) {
      if (await isDuplicatePendingAction(
        db,
        `agent_proposal_followup_${p.id}`,
        p.organizationId,
      )) continue;

      const [client] = await db
        .select({
          contactEmail: clients.contactEmail,
          contactName: clients.contactName,
        })
        .from(clients)
        .where(eq(clients.id, p.clientId))
        .limit(1);
      if (!client?.contactEmail) continue;

      pending.push(
        onProposalViewed(
          p.id,
          p.organizationId,
          client.contactEmail,
          client.contactName,
          p.title,
          p.estimatedValue != null ? Number(p.estimatedValue) : null,
          { suppressNotification: true },
        ).catch((err: unknown) => {
          log.error(`[agentCron] stale-viewed trigger failed for proposal ${p.id}:`, err);
        }),
      );
    }
    log.info(`[agentCron] Stale-viewed scan: evaluated ${staleRows.length} proposals.`);
  } catch (err: unknown) {
    log.error("[agentCron] Stale-viewed scan error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Scan 7 — Predictive opportunities (pattern-based reorder forecast) */
/* ------------------------------------------------------------------ */

/**
 * Resolve the owner userId for an organization. Returns null when the
 * org has no member with role=owner (shouldn't happen in practice, but
 * the scan falls back to skipping the client rather than crashing).
 */
async function resolvePredictiveOwnerId(
  db: Db,
  organizationId: number,
): Promise<number | null> {
  const rows = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.organizationId, organizationId),
        eq(orgMembers.role, "owner"),
      ),
    )
    .limit(1);
  return rows[0]?.userId ?? null;
}

/**
 * Scan active clients for pattern-based reorder opportunities. Every
 * client with at least two orders is evaluated by detectReorderPatterns;
 * a trigger fires only when:
 *   • confidence is >= PREDICTIVE_MIN_CONFIDENCE (0.6),
 *   • predicted window starts within the next 45 days,
 *   • no active proposal (draft/sent/viewed) exists for the client,
 *   • no pending/processing order exists for the client,
 *   • no predictive_opportunity action has already been created for the
 *     client during the current calendar month (one prediction/month cap).
 *
 * Exported for test coverage of the dedup path.
 */
export async function scanPredictiveOpportunities(
  db: Db,
  pending: Promise<void>[],
): Promise<void> {
  try {
    const clientRows = await db
      .select({
        id: clients.id,
        organizationId: clients.organizationId,
        userId: clients.userId,
        contactEmail: clients.contactEmail,
        contactName: clients.contactName,
      })
      .from(clients)
      .where(
        and(
          eq(clients.status, "active"),
          isNotNull(clients.contactEmail),
        ),
      )
      .limit(MAX_ROWS_PER_SCAN);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const predictionCutoff = new Date(
      now.getTime() + PREDICTIVE_WINDOW_MAX_DAYS_AHEAD * TWENTY_FOUR_HOURS_MS,
    );

    let evaluated = 0;
    for (const c of clientRows) {
      evaluated += 1;
      if (!c.contactEmail) continue;

      try {
        const pattern = await detectReorderPatterns(c.id, c.organizationId);
        if (!pattern) continue;
        if (pattern.confidence < PREDICTIVE_MIN_CONFIDENCE) continue;
        const windowStartMs = pattern.predictedWindowStart.getTime();
        if (windowStartMs < now.getTime()) continue;
        if (windowStartMs > predictionCutoff.getTime()) continue;

        // No active proposal for this client.
        const activeProposalRows = await db
          .select({ id: proposals.id })
          .from(proposals)
          .where(
            and(
              eq(proposals.clientId, c.id),
              inArray(proposals.status, [...ACTIVE_PROPOSAL_STATUSES]),
            ),
          )
          .limit(1);
        if (activeProposalRows.length > 0) continue;

        // No pending/processing order for this client.
        const pendingOrderRows = await db
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.clientId, c.id),
              inArray(orders.status, [...PENDING_ORDER_STATUSES]),
            ),
          )
          .limit(1);
        if (pendingOrderRows.length > 0) continue;

        // One prediction per client per calendar month — the cron's
        // stronger-than-7-day dedup for this trigger type specifically.
        const orgScopedDedup = c.organizationId != null
          ? [eq(copilotPendingActions.organizationId, c.organizationId)]
          : [];
        const dedupRows = await db
          .select({ id: copilotPendingActions.id })
          .from(copilotPendingActions)
          .where(
            and(
              like(
                copilotPendingActions.toolCallId,
                `agent_predictive_opportunity_${c.id}_%`,
              ),
              gte(copilotPendingActions.createdAt, monthStart),
              ...orgScopedDedup,
            ),
          )
          .limit(1);
        if (dedupRows.length > 0) continue;

        // runEmailAgentAction requires an organizationId to resolve the
        // owner; solo accounts without an org can't receive agent
        // emails in the current architecture, so we skip them cleanly.
        if (c.organizationId == null) continue;
        const ownerId = await resolvePredictiveOwnerId(db, c.organizationId);
        if (!ownerId) continue;

        pending.push(
          onPredictiveOpportunityDetected(
            c.id,
            c.organizationId,
            c.contactEmail,
            c.contactName,
            pattern.patternSummary,
            pattern.estimatedValue,
            pattern.confidence,
            ownerId,
            { suppressNotification: true },
          ).catch((err: unknown) => {
            log.error(
              `[agentCron] predictive trigger failed for client ${c.id}:`,
              err,
            );
          }),
        );
      } catch (err: unknown) {
        log.error(`[agentCron] predictive scan error for client ${c.id}:`, err);
      }
    }
    log.info(`[agentCron] Predictive-opportunity scan: evaluated ${evaluated} clients.`);
  } catch (err: unknown) {
    log.error("[agentCron] Predictive-opportunity scan error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  SanMar Canada Bulk Data sync (one pull per day per credential)     */
/* ------------------------------------------------------------------ */

/**
 * Pull SanMar's bulk catalog once per nightly run and upsert into every
 * org that has a SanMar supplier configured. SanMar enforces a
 * one-call-per-day rate limit, which lines up exactly with the agent
 * cron's 24h cadence — no extra scheduling needed.
 *
 * Skips the API call when no SanMar supplier rows exist anywhere, so a
 * platform that doesn't use SanMar never burns the daily quota.
 */
async function runSanMarBulkSyncDaily(): Promise<void> {
  try {
    const result = await runSanMarBulkSyncAllOrgs();
    const ok = result.perSupplier.filter((r) => !r.error).length;
    const failed = result.perSupplier.length - ok;
    log.info(
      `[agentCron] SanMar bulk sync: catalog=${result.catalogSize} orgs_ok=${ok} orgs_failed=${failed}`,
    );
  } catch (err: unknown) {
    log.error("[agentCron] SanMar bulk sync error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Consolidated briefing notification                                  */
/* ------------------------------------------------------------------ */

async function sendConsolidatedBriefings(
  db: Db,
  scanStartedAt: Date,
): Promise<void> {
  try {
    // How many agent-source pending actions were created during this scan, per org?
    const rows = await db
      .select({
        organizationId: copilotPendingActions.organizationId,
        userId: copilotPendingActions.userId,
        count: sql<number>`COUNT(*)`,
      })
      .from(copilotPendingActions)
      .where(
        and(
          eq(copilotPendingActions.source, "agent"),
          gte(copilotPendingActions.createdAt, scanStartedAt),
        ),
      )
      .groupBy(copilotPendingActions.organizationId, copilotPendingActions.userId);

    // One briefing per organization (not per action). When an org is present,
    // resolve to the owner explicitly so the notification is addressed to the
    // right seat even if a given action was created under a different userId.
    const perOrg = new Map<string, { userId: number; organizationId: number | null; count: number }>();
    for (const r of rows) {
      const key = r.organizationId != null ? `org:${r.organizationId}` : `user:${r.userId}`;
      const existing = perOrg.get(key);
      if (existing) {
        existing.count += Number(r.count);
      } else {
        perOrg.set(key, {
          userId: r.userId,
          organizationId: r.organizationId,
          count: Number(r.count),
        });
      }
    }

    for (const entry of Array.from(perOrg.values())) {
      if (entry.count <= 0) continue;

      let recipientUserId = entry.userId;
      if (entry.organizationId != null) {
        const ownerRow = await db
          .select({ userId: orgMembers.userId })
          .from(orgMembers)
          .where(
            and(
              eq(orgMembers.organizationId, entry.organizationId),
              eq(orgMembers.role, "owner"),
            ),
          )
          .limit(1);
        if (ownerRow[0]?.userId) recipientUserId = ownerRow[0].userId;
      }

      try {
        await notifyOwner({
          userId: recipientUserId,
          organizationId: entry.organizationId ?? undefined,
          type: "ai_insight",
          title: "Your AI briefing is ready",
          content: `I've prepared ${entry.count} action${entry.count === 1 ? "" : "s"} for your review.`,
          actionPath: "/agent-inbox",
          actionLabel: "Open Agent Inbox",
        });
      } catch (notifErr: unknown) {
        log.warn("[agentCron] briefing notification failed:", notifErr);
      }
    }
  } catch (err: unknown) {
    log.error("[agentCron] Briefing aggregation error:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Run one pass of every scan + the consolidated briefing notification,
 * then stamp `organizations.lastAgentScanAt` so the Agent Inbox empty
 * state can show "Last scanned: X minutes ago".
 *
 * Exported so the manual `agent.triggerScan` endpoint can reuse the
 * exact same code path as the 24-hour cron — no divergence possible.
 * Never throws: every scan and the post-scan stamp are wrapped
 * individually.
 */
export async function runAgentCronScan(): Promise<void> {
  log.info("[agentCron] Starting scan...");

  const db = await getDb();
  if (!db) {
    log.warn("[agentCron] Database unavailable, skipping scan.");
    return;
  }

  const scanStartedAt = new Date();
  const pending: Promise<void>[] = [];

  // Each scan is wrapped in its own try/catch internally so one failure
  // does not halt the others. Running sequentially keeps DB load predictable.
  await scanLowEngagementStores(db, pending);
  await scanOverdueInvoices(db, pending);
  await scanDormantClients(db, pending);
  await scanReorderWindow(db, pending);
  await scanExpiringProposals(db, pending);
  await scanStaleViewedProposals(db, pending);
  await scanPredictiveOpportunities(db, pending);
  await scanSupplierCostChanges(db, pending);
  await scanStoreZoneHealth(db, pending);
  await scanSeasonalStoreOpportunities(db, pending);
  await runSanMarBulkSyncDaily();

  // Wait for all trigger LLM calls to settle so the consolidated count
  // reflects actual DB inserts. Each trigger already handles its own errors.
  await Promise.allSettled(pending);

  await sendConsolidatedBriefings(db, scanStartedAt);

  // Stamp lastAgentScanAt on every org so the Agent Inbox empty state
  // shows an accurate "last scanned" value. Bare UPDATE (no WHERE) is
  // fine at current tenant counts and keeps the semantics simple: a
  // completed scan means every tenant was evaluated.
  try {
    await db.update(organizations).set({ lastAgentScanAt: scanStartedAt });
  } catch (err: unknown) {
    log.warn("[agentCron] Failed to stamp lastAgentScanAt:", err);
  }

  log.info("[agentCron] Scan complete.");
}

/**
 * Schedule the agent cron job to run every 24 hours.
 * First run triggers 60 seconds after server start.
 */
export function scheduleAgentCron(): void {
  log.info("[agentCron] Scheduling agent cron (24h interval).");

  setTimeout(() => {
    runAgentCronScan().catch((err: unknown) => {
      log.error("[agentCron] Initial scan error:", err);
    });
  }, INITIAL_DELAY_MS);

  const interval = setInterval(() => {
    runAgentCronScan().catch((err: unknown) => {
      log.error("[agentCron] Scheduled scan error:", err);
    });
  }, TWENTY_FOUR_HOURS_MS);

  interval.unref();
}
