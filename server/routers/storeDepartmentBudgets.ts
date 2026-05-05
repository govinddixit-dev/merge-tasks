/**
 * storeDepartmentBudgets.ts — Department Budget Management Router
 *
 * Mock-to-Real Guide, Step 8: Full CRUD for distributor-side department budget management.
 * Also includes `getMyBudget` for store portal users (used by checkout page).
 *
 * Three access patterns:
 *   1. Distributor (protectedProcedure) — full CRUD, fiscal reset, user assignment
 *   2. POC Admin (publicProcedure + store JWT) — read + limited update via storePortalBudgets
 *   3. Store User (publicProcedure + store JWT) — read-only via getMyBudget
 *
 * All budget math is in integer cents to avoid floating-point errors.
 */

import { z } from "zod";
import { eq, and, sql, type SQL } from "drizzle-orm";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  storeDepartments,
  storeUsers,
  stores,
  storeLocations,
  type InsertStoreDepartment,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getLogger } from "../utils/logger";
import { jwtVerify } from "jose";
import { ENV } from "../_core/env";

const log = getLogger("storeDepartmentBudgets");

// ── JWT helper (same secret as storeAuth / storePortalAuth) ────────────
async function resolveStoreUserFromToken(
  token: string | undefined
): Promise<{ storeId: number; storeUserId: number; email: string; role: string } | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret + "_store");
    const { payload } = await jwtVerify(token, secret);
    return payload as { storeId: number; storeUserId: number; email: string; role: string };
  } catch {
    return null;
  }
}

export const storeDepartmentBudgetsRouter = router({
  // ─── Distributor-side: List all departments for a store ────────────────
  list: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify the store belongs to this distributor (org-aware)
      const storeOwnerConds: SQL[] = [eq(stores.id, input.storeId)];
      if (ctx.organizationId != null) {
        storeOwnerConds.push(eq(stores.organizationId, ctx.organizationId));
      } else {
        storeOwnerConds.push(eq(stores.userId, ctx.user.id));
      }
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(...storeOwnerConds))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const depts = await db
        .select()
        .from(storeDepartments)
        .where(and(
          eq(storeDepartments.storeId, input.storeId),
          eq(storeDepartments.isActive, true)
        ))
        .orderBy(storeDepartments.name);

      // For each department, count assigned users
      const result = await Promise.all(
        depts.map(async (dept) => {
          const users = await db
            .select({
              id: storeUsers.id,
              email: storeUsers.email,
              name: storeUsers.name,
              role: storeUsers.role,
            })
            .from(storeUsers)
            .where(eq(storeUsers.departmentId, dept.id));

          return {
            ...dept,
            users,
            remainingCents: dept.budgetCents - dept.spentCents,
            utilizationPercent: dept.budgetCents > 0
              ? Math.round((dept.spentCents / dept.budgetCents) * 100)
              : 0,
          };
        })
      );

      return result;
    }),

  // ─── Distributor-side: Location breakdown ──────────────────────────────
  // Returns departments grouped by location, plus a bucket for any
  // departments that haven't been assigned to a location yet. Replaces the
  // legacy `divisionBreakdown` procedure that was dropped with migration 0082.
  locationBreakdown: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify store ownership
      const storeOwnerConds: SQL[] = [eq(stores.id, input.storeId)];
      if (ctx.organizationId != null) {
        storeOwnerConds.push(eq(stores.organizationId, ctx.organizationId));
      } else {
        storeOwnerConds.push(eq(stores.userId, ctx.user.id));
      }
      const [store] = await db.select({ id: stores.id }).from(stores).where(and(...storeOwnerConds)).limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      // Get all active locations for this store
      const locations = await db
        .select()
        .from(storeLocations)
        .where(and(eq(storeLocations.storeId, input.storeId), eq(storeLocations.isActive, true)))
        .orderBy(storeLocations.sortOrder);

      // Get all departments for this store
      const depts = await db
        .select()
        .from(storeDepartments)
        .where(and(eq(storeDepartments.storeId, input.storeId), eq(storeDepartments.isActive, true)));

      // Group departments by locationId
      const deptsByLocation = new Map<number | null, typeof depts>();
      for (const dept of depts) {
        const key = dept.locationId ?? null;
        if (!deptsByLocation.has(key)) deptsByLocation.set(key, []);
        deptsByLocation.get(key)!.push(dept);
      }

      // Build result — one entry per location + one for unassigned
      const result = [
        ...locations.map(loc => ({
          locationId: loc.id,
          locationName: loc.name,
          locationSlug: loc.slug,
          departments: (deptsByLocation.get(loc.id) ?? []).map(d => ({
            id: d.id,
            name: d.name,
            budgetCents: d.budgetCents,
            spentCents: d.spentCents,
            remainingCents: d.budgetCents - d.spentCents,
            utilizationPercent: d.budgetCents > 0 ? Math.round((d.spentCents / d.budgetCents) * 100) : 0,
          })),
        })),
        // Unassigned departments (no locationId)
        ...(deptsByLocation.get(null)?.length ? [{
          locationId: null,
          locationName: "Unassigned",
          locationSlug: null,
          departments: (deptsByLocation.get(null) ?? []).map(d => ({
            id: d.id,
            name: d.name,
            budgetCents: d.budgetCents,
            spentCents: d.spentCents,
            remainingCents: d.budgetCents - d.spentCents,
            utilizationPercent: d.budgetCents > 0 ? Math.round((d.spentCents / d.budgetCents) * 100) : 0,
          })),
        }] : []),
      ];

      return result;
    }),

  // ─── Distributor-side: Create a new department ─────────────────────────
  create: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      name: z.string().min(1).max(100),
      budgetCents: z.number().int().min(0),
      maxPerOrderCents: z.number().int().min(0).optional(),
      fiscalPeriodStart: z.string(), // ISO date string
      fiscalPeriodEnd: z.string(),   // ISO date string
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify store ownership (org-aware)
      const storeOwnerConds: SQL[] = [eq(stores.id, input.storeId)];
      if (ctx.organizationId != null) {
        storeOwnerConds.push(eq(stores.organizationId, ctx.organizationId));
      } else {
        storeOwnerConds.push(eq(stores.userId, ctx.user.id));
      }
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(...storeOwnerConds))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const values: InsertStoreDepartment = {
        storeId: input.storeId,
        name: input.name,
        budgetCents: input.budgetCents,
        maxPerOrderCents: input.maxPerOrderCents ?? null,
        fiscalPeriodStart: new Date(input.fiscalPeriodStart),
        fiscalPeriodEnd: new Date(input.fiscalPeriodEnd),
        createdBy: "distributor",
      };

      const result = await db.insert(storeDepartments).values(values);
      const deptId = result[0].insertId;

      log.info(`Created department "${input.name}" (id=${deptId}) for store ${input.storeId}`);

      return { id: deptId, ...input };
    }),

  // ─── Distributor-side: Update a department ─────────────────────────────
  update: protectedProcedure
    .input(z.object({
      departmentId: z.number(),
      name: z.string().min(1).max(100).optional(),
      budgetCents: z.number().int().min(0).optional(),
      maxPerOrderCents: z.number().int().min(0).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership via store
      const [dept] = await db
        .select()
        .from(storeDepartments)
        .where(eq(storeDepartments.id, input.departmentId))
        .limit(1);
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });

      const updateOwnerConds: SQL[] = [eq(stores.id, dept.storeId)];
      if (ctx.organizationId != null) {
        updateOwnerConds.push(eq(stores.organizationId, ctx.organizationId));
      } else {
        updateOwnerConds.push(eq(stores.userId, ctx.user.id));
      }
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(...updateOwnerConds))
        .limit(1);
      if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const updates: Record<string, any> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.budgetCents !== undefined) updates.budgetCents = input.budgetCents;
      if (input.maxPerOrderCents !== undefined) updates.maxPerOrderCents = input.maxPerOrderCents;

      if (Object.keys(updates).length > 0) {
        await db
          .update(storeDepartments)
          .set(updates)
          .where(eq(storeDepartments.id, input.departmentId));
      }

      log.info(`Updated department ${input.departmentId}: ${JSON.stringify(updates)}`);
      return { success: true };
    }),

  // ─── Distributor-side: Soft-delete a department ────────────────────────
  delete: protectedProcedure
    .input(z.object({ departmentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [dept] = await db
        .select()
        .from(storeDepartments)
        .where(eq(storeDepartments.id, input.departmentId))
        .limit(1);
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });

      const deleteOwnerConds: SQL[] = [eq(stores.id, dept.storeId)];
      if (ctx.organizationId != null) {
        deleteOwnerConds.push(eq(stores.organizationId, ctx.organizationId));
      } else {
        deleteOwnerConds.push(eq(stores.userId, ctx.user.id));
      }
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(...deleteOwnerConds))
        .limit(1);
      if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      // Soft delete: set isActive = false
      await db
        .update(storeDepartments)
        .set({ isActive: false })
        .where(eq(storeDepartments.id, input.departmentId));

      // Unassign users from this department
      await db
        .update(storeUsers)
        .set({ departmentId: null })
        .where(eq(storeUsers.departmentId, input.departmentId));

      log.info(`Soft-deleted department ${input.departmentId}, unassigned users`);
      return { success: true };
    }),

  // ─── Distributor-side: Reset fiscal period ─────────────────────────────
  resetFiscalPeriod: protectedProcedure
    .input(z.object({
      departmentId: z.number(),
      newBudgetCents: z.number().int().min(0).optional(),
      fiscalPeriodStart: z.string().optional(),
      fiscalPeriodEnd: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [dept] = await db
        .select()
        .from(storeDepartments)
        .where(eq(storeDepartments.id, input.departmentId))
        .limit(1);
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });

      const resetOwnerConds: SQL[] = [eq(stores.id, dept.storeId)];
      if (ctx.organizationId != null) {
        resetOwnerConds.push(eq(stores.organizationId, ctx.organizationId));
      } else {
        resetOwnerConds.push(eq(stores.userId, ctx.user.id));
      }
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(...resetOwnerConds))
        .limit(1);
      if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const updates: Partial<InsertStoreDepartment> & { spentCents?: number } = { spentCents: 0 };
      if (input.newBudgetCents !== undefined) updates.budgetCents = input.newBudgetCents;
      if (input.fiscalPeriodStart) updates.fiscalPeriodStart = new Date(input.fiscalPeriodStart);
      if (input.fiscalPeriodEnd) updates.fiscalPeriodEnd = new Date(input.fiscalPeriodEnd);

      await db
        .update(storeDepartments)
        .set(updates)
        .where(eq(storeDepartments.id, input.departmentId));

      log.info(`Reset fiscal period for department ${input.departmentId}`);
      return { success: true };
    }),

  // ─── Distributor-side: Assign users to a department ────────────────────
  // PO-12: Added store ownership verification for both the department and
  // the target user IDs. Without this, any authenticated distributor could
  // reassign any store's users to any department.
  assignUsers: protectedProcedure
    .input(z.object({
      departmentId: z.number().nullable(),
      userIds: z.array(z.number()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      let targetStoreId: number;

      if (input.departmentId !== null) {
        // Verify the department exists and belongs to a store owned by this user
        const [dept] = await db
          .select({ storeId: storeDepartments.storeId })
          .from(storeDepartments)
          .where(and(
            eq(storeDepartments.id, input.departmentId),
            eq(storeDepartments.isActive, true),
          ))
          .limit(1);
        if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });

        const ownershipConds = ctx.organizationId != null
          ? and(eq(stores.id, dept.storeId), eq(stores.organizationId, ctx.organizationId))
          : and(eq(stores.id, dept.storeId), eq(stores.userId, ctx.user.id));

        const [store] = await db
          .select({ id: stores.id })
          .from(stores)
          .where(ownershipConds)
          .limit(1);
        if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

        targetStoreId = dept.storeId;
      } else {
        // When un-assigning (departmentId=null), we still need to verify the
        // users belong to a store owned by this distributor. We'll check each
        // user's storeId below.
        targetStoreId = 0; // placeholder — verified per-user below
      }

      // Verify each user belongs to the target store (or to a store this distributor owns)
      for (const uid of input.userIds) {
        const [su] = await db
          .select({ id: storeUsers.id, storeId: storeUsers.storeId })
          .from(storeUsers)
          .where(eq(storeUsers.id, uid))
          .limit(1);

        if (!su) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Store user ${uid} not found` });
        }

        if (input.departmentId !== null && su.storeId !== targetStoreId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `User ${uid} does not belong to the same store as the target department`,
          });
        }

        // For un-assign case, verify store ownership per user
        if (input.departmentId === null) {
          const ownershipConds = ctx.organizationId != null
            ? and(eq(stores.id, su.storeId), eq(stores.organizationId, ctx.organizationId))
            : and(eq(stores.id, su.storeId), eq(stores.userId, ctx.user.id));

          const [store] = await db
            .select({ id: stores.id })
            .from(stores)
            .where(ownershipConds)
            .limit(1);
          if (!store) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this user's store" });
          }
        }

        await db
          .update(storeUsers)
          .set({ departmentId: input.departmentId })
          .where(eq(storeUsers.id, uid));
      }

      log.info(`Assigned ${input.userIds.length} users to department ${input.departmentId}`);
      return { success: true };
    }),

  // ─── Store User: Get my department budget (for checkout page) ──────────
  // This is a publicProcedure because store users authenticate via JWT token,
  // not via the distributor session.
  getMyBudget: publicProcedure
    .input(z.object({
      storeId: z.number(),
      storeToken: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Try JWT from input, fall back to cookie
      let payload = await resolveStoreUserFromToken(input.storeToken);

      // If no token in input, try cookie-based auth
      if (!payload) {
        // ctx.req is typed as Express.Request via TrpcContext — safe to access headers directly
        const cookieHeader = ctx.req?.headers?.cookie || "";
        const { parse: parseCookieHeader } = await import("cookie");
        const cookies = parseCookieHeader(cookieHeader);

        // Find the store slug to build the cookie name
        const [store] = await db
          .select({ slug: stores.slug })
          .from(stores)
          .where(eq(stores.id, input.storeId))
          .limit(1);

        if (store) {
          const token = cookies[`mt_store_${store.slug}`];
          payload = await resolveStoreUserFromToken(token);
        }
      }

      if (!payload) {
        return null; // Not logged in — no budget info
      }

      // Load the store user
      const [su] = await db
        .select({
          departmentId: storeUsers.departmentId,
          spendingLimit: storeUsers.spendingLimit,
          pointsBalance: storeUsers.pointsBalance,
        })
        .from(storeUsers)
        .where(
          and(
            eq(storeUsers.id, payload.storeUserId),
            eq(storeUsers.storeId, input.storeId)
          )
        )
        .limit(1);

      if (!su || !su.departmentId) {
        return {
          hasDepartment: false,
          spendingLimit: su?.spendingLimit ?? null,
          pointsBalance: su?.pointsBalance ?? 0,
          department: null,
        };
      }

      // Load the department budget
      const [dept] = await db
        .select()
        .from(storeDepartments)
        .where(
          and(
            eq(storeDepartments.id, su.departmentId),
            eq(storeDepartments.isActive, true)
          )
        )
        .limit(1);

      if (!dept) {
        return {
          hasDepartment: false,
          spendingLimit: su.spendingLimit ?? null,
          pointsBalance: su.pointsBalance ?? 0,
          department: null,
        };
      }

      return {
        hasDepartment: true,
        spendingLimit: su.spendingLimit ?? null,
        pointsBalance: su.pointsBalance ?? 0,
        department: {
          id: dept.id,
          name: dept.name,
          budgetCents: dept.budgetCents,
          spentCents: dept.spentCents,
          remainingCents: dept.budgetCents - dept.spentCents,
          maxPerOrderCents: dept.maxPerOrderCents,
          fiscalPeriodStart: dept.fiscalPeriodStart,
          fiscalPeriodEnd: dept.fiscalPeriodEnd,
          warnThresholdPct: dept.warnThresholdPct,
          utilizationPercent: dept.budgetCents > 0
            ? Math.round((dept.spentCents / dept.budgetCents) * 100)
            : 0,
        },
      };
    }),

  // ─── Distributor-side: Aggregate budget for a single location ─────────
  // Replaces the legacy `getMyDivisionBudget` procedure (divisions table
  // dropped in migration 0082). Returns the per-department rows that live
  // inside a location plus a rolled-up budget/spend total so the
  // distributor dashboard can show location-level utilization at a glance.
  getLocationBudget: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      locationId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify store ownership (org-aware)
      const storeOwnerConds: SQL[] = [eq(stores.id, input.storeId)];
      if (ctx.organizationId != null) {
        storeOwnerConds.push(eq(stores.organizationId, ctx.organizationId));
      } else {
        storeOwnerConds.push(eq(stores.userId, ctx.user.id));
      }
      const [store] = await db.select({ id: stores.id }).from(stores).where(and(...storeOwnerConds)).limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const [location] = await db
        .select()
        .from(storeLocations)
        .where(and(eq(storeLocations.id, input.locationId), eq(storeLocations.storeId, input.storeId)))
        .limit(1);
      if (!location) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });

      const depts = await db
        .select()
        .from(storeDepartments)
        .where(and(
          eq(storeDepartments.storeId, input.storeId),
          eq(storeDepartments.locationId, input.locationId),
          eq(storeDepartments.isActive, true),
        ))
        .orderBy(storeDepartments.name);

      const totalBudgetCents = depts.reduce((s, d) => s + d.budgetCents, 0);
      const totalSpentCents = depts.reduce((s, d) => s + d.spentCents, 0);

      return {
        location: {
          id: location.id,
          name: location.name,
          slug: location.slug,
        },
        departments: depts.map(d => ({
          id: d.id,
          name: d.name,
          budgetCents: d.budgetCents,
          spentCents: d.spentCents,
          remainingCents: d.budgetCents - d.spentCents,
          utilizationPercent: d.budgetCents > 0
            ? Math.round((d.spentCents / d.budgetCents) * 100)
            : 0,
        })),
        totals: {
          budgetCents: totalBudgetCents,
          spentCents: totalSpentCents,
          remainingCents: totalBudgetCents - totalSpentCents,
          utilizationPercent: totalBudgetCents > 0
            ? Math.round((totalSpentCents / totalBudgetCents) * 100)
            : 0,
        },
      };
    }),
});
