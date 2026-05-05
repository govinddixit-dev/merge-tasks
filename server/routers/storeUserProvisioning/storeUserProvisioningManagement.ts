/**
 * storeUserProvisioningManagement.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Protected distributor-facing procedures for managing store users:
 *   - provisionUsers  — bulk create/update users and send invitations
 *   - resendInvite    — resend set-password email for a specific user
 *   - listUsers       — list all users in a store
 *   - updateUser      — update role, department, spending limit, or status
 *   - removeUser      — delete a user from a store
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { stores, storeUsers, storeLocations } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../../utils/orgScope";
import { provisionStoreUser } from "./storeUserProvisioningHelpers";

const DEFAULT_SPENDING_LIMIT = "5000.00";

export const storeUserProvisioningManagementRouter = router({
  /**
   * Distributor: Provision initial users during store creation.
   * Accepts a list of users with name, email, role and sends set-password
   * emails to each.
   */
  provisionUsers: protectedProcedure
    .input(
      z.object({
        storeId: z.number(),
        origin: z.string(),
        users: z
          .array(
            z.object({
              name: z.string().min(1),
              email: z.string().email(),
              role: z.enum(["poc", "admin", "manager", "employee", "intern"]),
              department: z.string().optional(),
              locationId: z.number().int().positive().nullable().optional(),
              locationSlug: z.string().nullable().optional(),
            })
          )
          .min(1)
          .max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);

      if (!store) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to manage this store" });
      }

      const results: Array<{
        email: string;
        name: string;
        role: string;
        created: boolean;
        emailSent: boolean;
        error?: string;
      }> = [];

      for (const u of input.users) {
        try {
          let resolvedLocationId: number | null = u.locationId ?? null;
          if (u.locationSlug && !resolvedLocationId) {
            const [loc] = await db
              .select({ id: storeLocations.id })
              .from(storeLocations)
              .where(and(
                eq(storeLocations.storeId, store.id),
                eq(storeLocations.slug, u.locationSlug.toLowerCase()),
              ))
              .limit(1);
            resolvedLocationId = loc?.id ?? null;
          }

          const [existing] = await db
            .select()
            .from(storeUsers)
            .where(
              and(
                eq(storeUsers.storeId, store.id),
                eq(storeUsers.email, u.email.toLowerCase())
              )
            )
            .limit(1);

          let storeUserId: number;

          if (existing) {
            storeUserId = existing.id;
            if (existing.role !== u.role || existing.name !== u.name) {
              await db
                .update(storeUsers)
                .set({
                  role: u.role,
                  name: u.name,
                  department: u.department || existing.department,
                  locationId: resolvedLocationId ?? existing.locationId,
                })
                .where(eq(storeUsers.id, existing.id));
            }
          } else {
            const spendingLimit =
              u.role === "poc" || u.role === "admin"
                ? null
                : u.role === "manager"
                ? DEFAULT_SPENDING_LIMIT
                : u.role === "employee"
                ? "500.00"
                : "100.00";

            const [result] = await db.insert(storeUsers).values({
              storeId: store.id,
              email: u.email.toLowerCase(),
              name: u.name,
              role: u.role,
              department: u.department || null,
              locationId: resolvedLocationId,
              spendingLimit,
              status: "invited",
            });
            storeUserId = result.insertId;
          }

          const provResult = await provisionStoreUser({
            storeId: store.id,
            storeUserId,
            email: u.email.toLowerCase(),
            name: u.name,
            role: u.role,
            storeName: store.name,
            storeSlug: store.slug,
            distributorUserId: ctx.user.id,
            origin: input.origin,
          });

          results.push({
            email: u.email,
            name: u.name,
            role: u.role,
            created: !existing,
            emailSent: provResult.emailSent,
          });
        } catch (err: unknown) {
          results.push({
            email: u.email,
            name: u.name,
            role: u.role,
            created: false,
            emailSent: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return {
        total: results.length,
        successful: results.filter((r) => !r.error).length,
        emailsSent: results.filter((r) => r.emailSent).length,
        results,
      };
    }),

  /**
   * Distributor: Resend set-password email for a specific store user.
   */
  resendInvite: protectedProcedure
    .input(z.object({ storeUserId: z.number(), origin: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [user] = await db
        .select()
        .from(storeUsers)
        .where(eq(storeUsers.id, input.storeUserId))
        .limit(1);

      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, user.storeId), scope.stores))
        .limit(1);

      if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const result = await provisionStoreUser({
        storeId: store.id,
        storeUserId: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role,
        storeName: store.name,
        storeSlug: store.slug,
        distributorUserId: ctx.user.id,
        origin: input.origin,
      });

      return { success: true, emailSent: result.emailSent };
    }),

  /**
   * Distributor: List all users in a store.
   */
  listUsers: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const users = await db
        .select()
        .from(storeUsers)
        .where(and(
          eq(storeUsers.storeId, input.storeId),
          isNull(storeUsers.deletedAt),
        ))
        .orderBy(storeUsers.createdAt);

      return users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        department: u.department,
        spendingLimit: u.spendingLimit,
        pointsBalance: u.pointsBalance,
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        hasPassword: !!u.passwordHash,
      }));
    }),

  /**
   * Distributor: Update a store user's role, department, or spending limit.
   */
  updateUser: protectedProcedure
    .input(
      z.object({
        storeUserId: z.number(),
        name: z.string().optional(),
        role: z.enum(["admin", "manager", "employee", "intern"]).optional(),
        department: z.string().optional(),
        spendingLimit: z.string().nullable().optional(),
        status: z.enum(["active", "invited", "suspended"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [user] = await db
        .select()
        .from(storeUsers)
        .where(eq(storeUsers.id, input.storeUserId))
        .limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, user.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const { storeUserId, ...updates } = input;
      const setObj: Record<string, unknown> = {};
      if (updates.name !== undefined) setObj.name = updates.name;
      if (updates.role !== undefined) setObj.role = updates.role;
      if (updates.department !== undefined) setObj.department = updates.department;
      if (updates.spendingLimit !== undefined) setObj.spendingLimit = updates.spendingLimit;
      if (updates.status !== undefined) setObj.status = updates.status;

      if (Object.keys(setObj).length > 0) {
        await db.update(storeUsers).set(setObj).where(eq(storeUsers.id, input.storeUserId));
      }

      const [updated] = await db
        .select()
        .from(storeUsers)
        .where(eq(storeUsers.id, input.storeUserId))
        .limit(1);
      return updated;
    }),

  /**
   * Distributor: Remove a user from a store.
   */
  removeUser: protectedProcedure
    .input(z.object({ storeUserId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [user] = await db
        .select()
        .from(storeUsers)
        .where(eq(storeUsers.id, input.storeUserId))
        .limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, user.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      // Soft delete: preserve historical records (orders, approvals, spend
      // history) while preventing login and removing the user from active
      // lists. Hard delete would cascade-break these joins.
      await db
        .update(storeUsers)
        .set({ deletedAt: new Date(), status: "suspended" })
        .where(eq(storeUsers.id, input.storeUserId));
      return { success: true };
    }),
});
