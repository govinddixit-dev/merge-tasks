/**
 * Platform Admin Router — Owner-only metrics for tracking signups, churn, and MRR.
 *
 * All procedures require `role: "admin"` (enforced by adminProcedure).
 * This is the MergeTasks platform owner's view — not the per-distributor
 * client churn signals in aiInsights.
 *
 * SECURITY POLICY (2026-04-25): Even the platform owner (Yan / Otentik
 * Brand / org 23) MUST NOT be able to read another org's row-level
 * tenant data — supplierCredentials, products, pricing, estimates,
 * proposals, invoices, clients, or orders. Aggregate counts (e.g.
 * total stores across the platform) are explicitly allowed because they
 * leak no row content.
 *
 * TODO(admin-audit): The current `overview` query selects platform-wide
 * COUNT(*) over stores/orders/proposals. That is a count-only read and
 * does not return row content, but if this endpoint is ever extended to
 * return per-row data it MUST first wire writes to `adminAuditLog`
 * (action, targetOrgId, adminUserId, timestamp) so cross-tenant access
 * is reviewable. See server/securityAdminAccess.test.ts which encodes
 * this guardrail.
 */

import { z } from "zod";
import { sql, eq, gte, lte, and, desc, count } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, organizations, stores, orders, proposals } from "../../drizzle/schema";
import { PLANS } from "../stripe/products";
import { TRPCError } from "@trpc/server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export const platformAdminRouter = router({
  /**
   * Overview — Key platform metrics at a glance.
   */
  overview: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);
    const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);
    const twentyFourHoursAgo = new Date(now.getTime() - ONE_DAY_MS);

    // Total users
    const [totalRow] = await db.select({ count: count() }).from(users);
    const totalUsers = totalRow?.count ?? 0;

    // Signups in last 24h, 7d, 30d
    const [last24h] = await db.select({ count: count() }).from(users).where(gte(users.createdAt, twentyFourHoursAgo));
    const [last7d] = await db.select({ count: count() }).from(users).where(gte(users.createdAt, sevenDaysAgo));
    const [last30d] = await db.select({ count: count() }).from(users).where(gte(users.createdAt, thirtyDaysAgo));

    // Active users (signed in within 7d, 30d)
    const [active7d] = await db.select({ count: count() }).from(users).where(gte(users.lastSignedIn, sevenDaysAgo));
    const [active30d] = await db.select({ count: count() }).from(users).where(gte(users.lastSignedIn, thirtyDaysAgo));

    // Subscription breakdown
    const tierRows = await db
      .select({
        tier: users.subscriptionTier,
        status: users.subscriptionStatus,
        count: count(),
      })
      .from(users)
      .groupBy(users.subscriptionTier, users.subscriptionStatus);

    // Calculate MRR
    let mrr = 0;
    const tierBreakdown: Record<string, { active: number; canceled: number; pastDue: number; total: number }> = {};
    for (const plan of PLANS) {
      tierBreakdown[plan.id] = { active: 0, canceled: 0, pastDue: 0, total: 0 };
    }

    for (const row of tierRows) {
      const tier = row.tier || "free";
      if (!tierBreakdown[tier]) tierBreakdown[tier] = { active: 0, canceled: 0, pastDue: 0, total: 0 };
      tierBreakdown[tier].total += row.count;

      if (row.status === "active" || row.status === "trialing") {
        tierBreakdown[tier].active += row.count;
        const plan = PLANS.find(p => p.id === tier);
        if (plan) {
          // Use monthly price for MRR (yearly subscribers = yearlyPrice / 12)
          mrr += row.count * plan.monthlyPrice;
        }
      } else if (row.status === "canceled") {
        tierBreakdown[tier].canceled += row.count;
      } else if (row.status === "past_due") {
        tierBreakdown[tier].pastDue += row.count;
      }
    }

    // Churn: users who were active 30-60 days ago but NOT in the last 30 days
    const sixtyDaysAgo = new Date(now.getTime() - SIXTY_DAYS_MS);
    const [churnedRow] = await db
      .select({ count: count() })
      .from(users)
      .where(
        and(
          gte(users.lastSignedIn, sixtyDaysAgo),
          lte(users.lastSignedIn, thirtyDaysAgo)
        )
      );
    const churned30d = churnedRow?.count ?? 0;

    // Total stores, orders, proposals
    const [storeCount] = await db.select({ count: count() }).from(stores);
    const [orderCount] = await db.select({ count: count() }).from(orders);
    const [proposalCount] = await db.select({ count: count() }).from(proposals);

    return {
      totalUsers,
      signups: {
        last24h: last24h?.count ?? 0,
        last7d: last7d?.count ?? 0,
        last30d: last30d?.count ?? 0,
      },
      activeUsers: {
        last7d: active7d?.count ?? 0,
        last30d: active30d?.count ?? 0,
      },
      churned30d,
      mrr, // in cents
      tierBreakdown,
      platformTotals: {
        stores: storeCount?.count ?? 0,
        orders: orderCount?.count ?? 0,
        proposals: proposalCount?.count ?? 0,
      },
    };
  }),

  /**
   * Signup timeline — Daily signup counts for the last N days.
   */
  signupTimeline: adminProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const startDate = new Date(Date.now() - input.days * ONE_DAY_MS);

      const rows = await db
        .select({
          date: sql<string>`DATE(${users.createdAt})`.as("date"),
          count: count(),
        })
        .from(users)
        .where(gte(users.createdAt, startDate))
        .groupBy(sql`DATE(${users.createdAt})`)
        .orderBy(sql`DATE(${users.createdAt})`);

      return rows.map(r => ({
        date: String(r.date),
        count: r.count,
      }));
    }),

  /**
   * User list — All platform users with subscription and activity info.
   * Paginated for large user bases.
   */
  userList: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(50),
        sortBy: z.enum(["createdAt", "lastSignedIn", "subscriptionTier"]).default("createdAt"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        tierFilter: z.enum(["all", "free", "pro", "enterprise"]).default("all"),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.pageSize;

      // Build where clause
      const conditions = [];
      if (input.tierFilter !== "all") {
        conditions.push(eq(users.subscriptionTier, input.tierFilter as "free" | "pro" | "enterprise"));
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [totalRow] = await db
        .select({ count: count() })
        .from(users)
        .where(whereClause);

      // Get page of users
      const sortCol =
        input.sortBy === "lastSignedIn" ? users.lastSignedIn :
        input.sortBy === "subscriptionTier" ? users.subscriptionTier :
        users.createdAt;

      const userRows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          createdAt: users.createdAt,
          lastSignedIn: users.lastSignedIn,
          subscriptionTier: users.subscriptionTier,
          subscriptionStatus: users.subscriptionStatus,
          loginMethod: users.loginMethod,
        })
        .from(users)
        .where(whereClause)
        .orderBy(input.sortOrder === "desc" ? desc(sortCol) : sortCol)
        .limit(input.pageSize)
        .offset(offset);

      return {
        users: userRows,
        total: totalRow?.count ?? 0,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil((totalRow?.count ?? 0) / input.pageSize),
      };
    }),

  /**
   * MRR timeline — Monthly recurring revenue over time.
   * Groups users by the month they started paying and calculates running MRR.
   */
  mrrTimeline: adminProcedure
    .input(z.object({ months: z.number().min(3).max(24).default(12) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get all paying users with their tier
      const payingUsers = await db
        .select({
          subscriptionTier: users.subscriptionTier,
          subscriptionStatus: users.subscriptionStatus,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(
          sql`${users.subscriptionStatus} IN ('active', 'trialing')`
        );

      // Build monthly MRR snapshots
      const now = new Date();
      const timeline: { month: string; mrr: number; subscribers: number }[] = [];

      for (let i = input.months - 1; i >= 0; i--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
        const monthLabel = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;

        // Count users who signed up before this month end and are still active
        let monthMrr = 0;
        let monthSubs = 0;
        for (const u of payingUsers) {
          if (u.createdAt <= monthEnd) {
            const plan = PLANS.find(p => p.id === u.subscriptionTier);
            if (plan && plan.monthlyPrice > 0) {
              monthMrr += plan.monthlyPrice;
              monthSubs++;
            }
          }
        }

        timeline.push({ month: monthLabel, mrr: monthMrr, subscribers: monthSubs });
      }

      return timeline;
    }),

  /**
   * Suspend a user — revokes all their sessions and marks account.
   * Uses the token blocklist for immediate session invalidation.
   */
  suspendUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [user] = await db
        .select({ openId: users.openId, email: users.email })
        .from(users)
        .where(eq(users.id, input.userId));

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // Revoke all sessions immediately
      const { revokeAllUserSessions } = await import("../utils/tokenBlocklist");
      await revokeAllUserSessions(user.openId);

      // Lock the account for 100 years (effectively permanent until manually unlocked)
      const lockedUntil = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
      await db
        .update(users)
        .set({ lockedUntil })
        .where(eq(users.id, input.userId));

      return {
        success: true,
        message: `User ${user.email || user.openId} has been suspended. All active sessions have been revoked.`,
      };
    }),

  /**
   * Unsuspend a user — clears the lockout.
   */
  unsuspendUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(users)
        .set({ lockedUntil: null, failedLoginAttempts: 0 })
        .where(eq(users.id, input.userId));

      return { success: true };
    }),
});
