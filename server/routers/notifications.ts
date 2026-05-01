/**
 * Notifications Router
 * Provides list, markRead, markAllRead, and delete for the in-app notification center.
 */
import { z } from "zod/v4";
import { desc, eq, and, lt } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notifications } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";

export const notificationsRouter = router({
  /** List the most recent 50 notifications for the current user */
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const limit = input?.limit ?? 50;
      const rows = await db
        .select()
        .from(notifications)
        .where(scope.notifications)
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
      return rows;
    }),

  /** Mark a single notification as read */
  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      await db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.id, input.id), scope.notifications));
      return { success: true };
    }),

  /** Mark all notifications as read for the current user */
  markAllRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      await db
        .update(notifications)
        .set({ read: true })
        .where(and(scope.notifications, eq(notifications.read, false)));
      return { success: true };
    }),

  /** Delete a single notification */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      await db
        .delete(notifications)
        .where(and(eq(notifications.id, input.id), scope.notifications));
      return { success: true };
    }),

  /** Clear all read notifications older than 30 days */
  clearOld: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await db
        .delete(notifications)
        .where(
          and(
            scope.notifications,
            eq(notifications.read, true),
            lt(notifications.createdAt, thirtyDaysAgo)
          )
        );
      return { success: true };
    }),
});
