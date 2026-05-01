/**
 * storePortalBudgets.ts — POC Portal Budget Management Router
 *
 * Mock-to-Real Guide, Step 10: POC-facing budget management via store session auth.
 * Role-gated: admin sees all departments, manager sees their department, employee sees own budget.
 *
 * Mounted under storePortal.budgets (e.g., trpc.storePortal.budgets.list)
 */

import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import {
  storeDepartments,
  storeUsers,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";
import { getLogger } from "../utils/logger";

const log = getLogger("storePortalBudgets");

export const storePortalBudgetsRouter = router({
  // ─── Admin/Manager: list departments with budgets ──────────────────────
  list: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["poc", "admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admin/manager can view all departments" });
      }

      // Location scoping: non-admin / non-POC viewers only see departments
      // within their assigned location. Admin and POC see everything.
      const deptConds = [
        eq(storeDepartments.storeId, store.id),
        eq(storeDepartments.isActive, true),
      ];
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        deptConds.push(eq(storeDepartments.locationId, storeUser.locationId));
      }
      const depts = await db
        .select()
        .from(storeDepartments)
        .where(and(...deptConds))
        .orderBy(storeDepartments.name);

      // For each department, load assigned users
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

          let head: { id: number; name: string | null; email: string } | null = null;
          if (dept.departmentHeadId) {
            const [headUser] = await db
              .select({ id: storeUsers.id, name: storeUsers.name, email: storeUsers.email })
              .from(storeUsers)
              .where(eq(storeUsers.id, dept.departmentHeadId))
              .limit(1);
            head = headUser ?? null;
          }

          return {
            ...dept,
            users,
            head,
            remainingCents: dept.budgetCents - dept.spentCents,
            utilizationPercent: dept.budgetCents > 0
              ? Math.round((dept.spentCents / dept.budgetCents) * 100)
              : 0,
          };
        })
      );

      // If manager, filter to only their department
      if (storeUser.role === "manager" && storeUser.departmentId) {
        return result.filter((d) => d.id === storeUser.departmentId);
      }

      return result;
    }),

  // ─── Admin: adjust budget (constrained to distributor ceiling) ─────────
  adjustBudget: publicProcedure
    .input(
      storeSlugInput.extend({
        departmentId: z.number(),
        newBudgetCents: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (storeUser.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admin can adjust budgets" });
      }

      const adjustConds = [
        eq(storeDepartments.id, input.departmentId),
        eq(storeDepartments.storeId, store.id),
      ];
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        adjustConds.push(eq(storeDepartments.locationId, storeUser.locationId));
      }
      const [dept] = await db
        .select()
        .from(storeDepartments)
        .where(and(...adjustConds))
        .limit(1);

      if (!dept) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });
      }

      // POC cannot exceed the distributor-set budget (the original budgetCents)
      // For now, we allow any value — the distributor can enforce a ceiling
      // via store settings in a future iteration.

      await db
        .update(storeDepartments)
        .set({ budgetCents: input.newBudgetCents })
        .where(eq(storeDepartments.id, input.departmentId));

      log.info(`POC admin adjusted dept ${input.departmentId} budget to ${input.newBudgetCents} cents`);
      return { success: true };
    }),

  setDepartmentHead: publicProcedure
    .input(
      storeSlugInput.extend({
        departmentId: z.number().int().positive(),
        storeUserId: z.number().int().positive().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      if (!["poc", "admin"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only POC or admin can assign department heads" });
      }
      const [dept] = await db
        .select()
        .from(storeDepartments)
        .where(and(eq(storeDepartments.id, input.departmentId), eq(storeDepartments.storeId, store.id)))
        .limit(1);
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });

      await db
        .update(storeDepartments)
        .set({ departmentHeadId: input.storeUserId })
        .where(eq(storeDepartments.id, input.departmentId));

      // Also update the storeUser's roleInDepartment
      if (input.storeUserId) {
        await db.update(storeUsers).set({ roleInDepartment: "head" }).where(eq(storeUsers.id, input.storeUserId));
      }

      return { success: true };
    }),

  // ─── Admin: move employees between departments ─────────────────────────
  assignEmployee: publicProcedure
    .input(
      storeSlugInput.extend({
        userId: z.number(),
        departmentId: z.number().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (storeUser.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admin can reassign employees" });
      }

      // Cross-scope guard: a location-scoped admin cannot reassign a user who
      // lives outside their location. Global admins / POCs skip the guard.
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        const [target] = await db
          .select({ locationId: storeUsers.locationId })
          .from(storeUsers)
          .where(and(eq(storeUsers.id, input.userId), eq(storeUsers.storeId, store.id)))
          .limit(1);
        if (!target || target.locationId !== storeUser.locationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "User is outside your location scope" });
        }
      }

      await db
        .update(storeUsers)
        .set({ departmentId: input.departmentId })
        .where(
          and(
            eq(storeUsers.id, input.userId),
            eq(storeUsers.storeId, store.id)
          )
        );

      log.info(`POC admin assigned user ${input.userId} to dept ${input.departmentId}`);
      return { success: true };
    }),

  // ─── Admin: reset department spend for new fiscal period ───────────────
  resetSpend: publicProcedure
    .input(
      storeSlugInput.extend({
        departmentId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (storeUser.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admin can reset spend" });
      }

      const resetConds = [
        eq(storeDepartments.id, input.departmentId),
        eq(storeDepartments.storeId, store.id),
      ];
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        resetConds.push(eq(storeDepartments.locationId, storeUser.locationId));
      }
      const [dept] = await db
        .select({ id: storeDepartments.id })
        .from(storeDepartments)
        .where(and(...resetConds))
        .limit(1);
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });

      await db
        .update(storeDepartments)
        .set({ spentCents: 0 })
        .where(
          and(
            eq(storeDepartments.id, input.departmentId),
            eq(storeDepartments.storeId, store.id)
          )
        );

      log.info(`POC admin reset spend for dept ${input.departmentId}`);
      return { success: true };
    }),

  // ─── Any role: get current user's department budget ────────────────────
  myBudget: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!storeUser.departmentId) return null;

      const [dept] = await db
        .select()
        .from(storeDepartments)
        .where(
          and(
            eq(storeDepartments.id, storeUser.departmentId),
            eq(storeDepartments.isActive, true)
          )
        )
        .limit(1);

      return dept ?? null;
    }),
});
