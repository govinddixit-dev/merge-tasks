/**
 * storePortalStats.ts — POC Portal Stats & Reporting Router
 *
 * Mock-to-Real Guide, Step 12: Real aggregation queries for PortalReportsTab.
 * Replaces fake data from portalData.ts with live DB queries.
 *
 * Mounted under storePortal.stats (e.g., trpc.storePortal.stats.overview)
 */

import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import {
  orders,
  storeDepartments,
  storeUsers,
  stores,
} from "../../drizzle/schema";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";
import { getLogger } from "../utils/logger";

const log = getLogger("storePortalStats");

export const storePortalStatsRouter = router({
  // ─── Overview stats (order count, total spend, employee count) ─────────
  overview: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        // S22: Employees see their own personal order stats
        // Orders table doesn't have storeUserId — for employees, show store-level stats
        // scoped to their client. In future, order attribution can be added.
        const myOrders = await db
          .select({ id: orders.id, total: orders.total, status: orders.status })
          .from(orders)
          .where(eq(orders.clientId, store.clientId));
        const myConfirmed = myOrders.filter((o) => o.status !== "cancelled" && o.status !== "pending");
        const mySpend = myConfirmed.reduce((s, o) => s + Math.round(parseFloat(o.total ?? "0") * 100), 0);
        return {
          orderCount: myConfirmed.length,
          totalSpendCents: mySpend,
          employeeCount: 1,
        };
      }

      // Count orders for this store's client
      const allOrders = await db
        .select({ id: orders.id, total: orders.total, status: orders.status })
        .from(orders)
        .where(eq(orders.clientId, store.clientId));

      const confirmedOrders = allOrders.filter(
        (o) => o.status !== "cancelled" && o.status !== "pending"
      );

      const totalSpendCents = confirmedOrders.reduce((sum, o) => {
        const totalVal = parseFloat(o.total ?? "0");
        return sum + Math.round(totalVal * 100);
      }, 0);

      // Count active store users
      const userRows = await db
        .select({ id: storeUsers.id })
        .from(storeUsers)
        .where(
          and(
            eq(storeUsers.storeId, store.id),
            eq(storeUsers.status, "active")
          )
        );

      return {
        orderCount: confirmedOrders.length,
        totalSpendCents,
        employeeCount: userRows.length,
      };
    }),

  // ─── Department breakdown (budget, spend, user count per dept) ─────────
  departmentBreakdown: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        return [];
      }

      const depts = await db
        .select()
        .from(storeDepartments)
        .where(
          and(
            eq(storeDepartments.storeId, store.id),
            eq(storeDepartments.isActive, true)
          )
        )
        .orderBy(storeDepartments.name);

      const userCounts = await db
        .select({ departmentId: storeUsers.departmentId, count: sql<number>`COUNT(*)` })
        .from(storeUsers)
        .where(eq(storeUsers.storeId, store.id))
        .groupBy(storeUsers.departmentId);
      const countMap = new Map(userCounts.map((r) => [r.departmentId, Number(r.count)]));

      const result = depts.map((dept) => ({
        id: dept.id,
        name: dept.name,
        budgetCents: dept.budgetCents,
        spentCents: dept.spentCents,
        remainingCents: dept.budgetCents - dept.spentCents,
        employeeCount: countMap.get(dept.id) ?? 0,
        utilizationPercent: dept.budgetCents > 0
          ? Math.round((dept.spentCents / dept.budgetCents) * 100)
          : 0,
      }));

      // If manager, filter to their department only
      if (storeUser.role === "manager" && storeUser.departmentId) {
        return result.filter((d) => d.id === storeUser.departmentId);
      }

      return result;
    }),

  // ─── Recent orders for the portal ──────────────────────────────────────
  recentOrders: publicProcedure
    .input(
      storeSlugInput.extend({
        limit: z.number().int().min(1).max(100).default(20),
        employeeEmail: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        return [];
      }

      const conditions = [eq(orders.clientId, store.clientId)];

      // Employee email filter
      if (input.employeeEmail) {
        const [targetUser] = await db.select().from(storeUsers)
          .where(and(eq(storeUsers.storeId, store.id), eq(storeUsers.email, input.employeeEmail.toLowerCase())))
          .limit(1);
        if (targetUser) {
          conditions.push(eq(orders.storeUserId, targetUser.id));
        } else {
          return [];
        }
      }

      const recentOrders = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          total: orders.total,
          createdAt: orders.createdAt,
          paymentMethod: orders.paymentMethod,
          employeeName: storeUsers.name,
          employeeEmail: storeUsers.email,
        })
        .from(orders)
        .leftJoin(storeUsers, eq(storeUsers.id, orders.storeUserId))
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt))
        .limit(input.limit);

      return recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        createdAt: o.createdAt,
        paymentMethod: o.paymentMethod,
        employeeName: o.employeeName ?? null,
        employeeEmail: o.employeeEmail ?? null,
      }));
    }),
});
