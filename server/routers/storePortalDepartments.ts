/**
 * Store Portal — Departments sub-router.
 *
 * POC-facing department management: list, add, update, remove.
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { storeUsers } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";

export const storePortalDepartmentsRouter = router({
  list: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      // Location scoping: non-admin / non-POC viewers only see users within
      // their assigned location. Admin and POC see everyone.
      const userConds = [eq(storeUsers.storeId, store.id)];
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        userConds.push(eq(storeUsers.locationId, storeUser.locationId));
      }
      const users = await db
        .select()
        .from(storeUsers)
        .where(and(...userConds));

      return users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        department: u.department,
        spendingLimit: u.spendingLimit?.toString() || null,
        pointsBalance: u.pointsBalance,
        status: u.status,
        lastLoginAt: u.lastLoginAt?.toISOString() || null,
        createdAt: u.createdAt?.toISOString() || null,
      }));
    }),

  add: publicProcedure
    .input(storeSlugInput.extend({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(["admin", "manager", "employee", "intern"]).default("employee"),
      department: z.string().optional(),
      spendingLimit: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins and managers can add department members" });
      }

      const [existing] = await db
        .select()
        .from(storeUsers)
        .where(and(
          eq(storeUsers.storeId, store.id),
          eq(storeUsers.email, input.email.toLowerCase()),
        ))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A user with this email already exists in this store" });
      }

      // Scope-inheritance: a location-scoped creator stamps their own
      // locationId onto the new user so they remain within the creator's
      // visibility. Global admins leave it null.
      await db.insert(storeUsers).values({
        storeId: store.id,
        email: input.email.toLowerCase(),
        name: input.name,
        role: input.role,
        department: input.department || null,
        spendingLimit: input.spendingLimit || null,
        status: "invited",
        locationId: storeUser.locationId ?? null,
      });

      const [created] = await db
        .select()
        .from(storeUsers)
        .where(and(
          eq(storeUsers.storeId, store.id),
          eq(storeUsers.email, input.email.toLowerCase()),
        ))
        .limit(1);

      return {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
        department: created.department,
        spendingLimit: created.spendingLimit?.toString() || null,
        status: created.status,
      };
    }),

  update: publicProcedure
    .input(storeSlugInput.extend({
      userId: z.number(),
      name: z.string().optional(),
      role: z.enum(["admin", "manager", "employee", "intern"]).optional(),
      department: z.string().optional(),
      spendingLimit: z.string().optional(),
      status: z.enum(["active", "invited", "suspended"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins and managers can edit department members" });
      }

      const [target] = await db
        .select()
        .from(storeUsers)
        .where(and(
          eq(storeUsers.id, input.userId),
          eq(storeUsers.storeId, store.id),
        ))
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // Cross-scope guard: a location-scoped editor cannot touch users
      // outside their location. Admin and POC skip the guard.
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        if (target.locationId !== storeUser.locationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "User is outside your location scope" });
        }
      }

      const setObj: Record<string, unknown> = {};
      if (input.name !== undefined) setObj.name = input.name;
      if (input.role !== undefined) setObj.role = input.role;
      if (input.department !== undefined) setObj.department = input.department;
      if (input.spendingLimit !== undefined) setObj.spendingLimit = input.spendingLimit;
      if (input.status !== undefined) setObj.status = input.status;

      if (Object.keys(setObj).length > 0) {
        await db.update(storeUsers).set(setObj).where(eq(storeUsers.id, input.userId));
      }

      const [updated] = await db
        .select()
        .from(storeUsers)
        .where(eq(storeUsers.id, input.userId))
        .limit(1);

      return {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        department: updated.department,
        spendingLimit: updated.spendingLimit?.toString() || null,
        status: updated.status,
      };
    }),

  remove: publicProcedure
    .input(storeSlugInput.extend({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins and managers can remove department members" });
      }

      if (input.userId === storeUser.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove yourself" });
      }

      const [target] = await db
        .select()
        .from(storeUsers)
        .where(and(
          eq(storeUsers.id, input.userId),
          eq(storeUsers.storeId, store.id),
        ))
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // Cross-scope guard: a location-scoped remover cannot delete users
      // outside their location. Admin and POC skip the guard.
      if (storeUser.locationId != null && !["admin", "poc"].includes(storeUser.role)) {
        if (target.locationId !== storeUser.locationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "User is outside your location scope" });
        }
      }

      await db.delete(storeUsers).where(eq(storeUsers.id, input.userId));
      return { success: true };
    }),
});
