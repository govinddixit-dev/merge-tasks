/**
 * printRequestsCrud router — distributor-side management of print requests
 * submitted by POC users through the client portal.
 *
 * GAP 2 FIX: Previously there was no protected procedure for distributors to
 * list, view, or update print requests. This router closes that gap.
 *
 * Surfaces:
 *   - Distributor Store Management → Print Requests tab (list + updateStatus + quote)
 *   - Distributor Notifications → deep-link to /store-management/:id?tab=print-requests
 */
import { z } from "zod";
import { and, eq, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { printRequests, stores } from "../../drizzle/schema";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";

const log = getLogger("printRequestsCrud");

/** Verify the distributor owns the store before accessing its print requests. */
async function verifyStoreOwnership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  storeId: number,
  scope: ReturnType<typeof getOrgScope>,
) {
  const [row] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, storeId), scope.stores))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Store not found or not authorized" });
  }
}

export const printRequestsCrudRouter = router({
  /**
   * List all print requests for a given store, newest first.
   * Optionally filter by status.
   */
  list: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      status: z.enum(["submitted", "reviewed", "quoted", "approved", "in_production", "completed", "rejected"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await verifyStoreOwnership(db, input.storeId, getOrgScope(ctx));

      const conditions = [eq(printRequests.storeId, input.storeId)];
      if (input.status) {
        conditions.push(eq(printRequests.status, input.status));
      }

      const rows = await db
        .select()
        .from(printRequests)
        .where(and(...conditions))
        .orderBy(desc(printRequests.createdAt));

      return rows.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        clientId: r.clientId,
        requestedBy: r.requestedBy,
        requestedByName: r.requestedByName,
        category: r.category,
        title: r.title,
        description: r.description,
        quantity: r.quantity,
        attachments: (r.attachments as string[]) || [],
        status: r.status,
        quotedPrice: r.quotedPrice?.toString() || null,
        distributorNotes: r.distributorNotes,
        estimatedDelivery: r.estimatedDelivery?.toISOString() || null,
        reviewedAt: r.reviewedAt?.toISOString() || null,
        completedAt: r.completedAt?.toISOString() || null,
        createdAt: r.createdAt?.toISOString() || null,
        updatedAt: r.updatedAt?.toISOString() || null,
      }));
    }),

  /** Get a single print request by ID (must belong to a store the distributor owns). */
  getById: protectedProcedure
    .input(z.object({ id: z.number(), storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await verifyStoreOwnership(db, input.storeId, getOrgScope(ctx));

      const [r] = await db
        .select()
        .from(printRequests)
        .where(and(eq(printRequests.id, input.id), eq(printRequests.storeId, input.storeId)))
        .limit(1);

      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Print request not found" });

      return {
        id: r.id,
        storeId: r.storeId,
        clientId: r.clientId,
        requestedBy: r.requestedBy,
        requestedByName: r.requestedByName,
        category: r.category,
        title: r.title,
        description: r.description,
        quantity: r.quantity,
        attachments: (r.attachments as string[]) || [],
        status: r.status,
        quotedPrice: r.quotedPrice?.toString() || null,
        distributorNotes: r.distributorNotes,
        estimatedDelivery: r.estimatedDelivery?.toISOString() || null,
        reviewedAt: r.reviewedAt?.toISOString() || null,
        completedAt: r.completedAt?.toISOString() || null,
        createdAt: r.createdAt?.toISOString() || null,
        updatedAt: r.updatedAt?.toISOString() || null,
      };
    }),

  /**
   * Update the status, quote, notes, and estimated delivery of a print request.
   * This is the primary distributor action — review → quote → approve → in_production → complete.
   */
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      storeId: z.number(),
      status: z.enum(["submitted", "reviewed", "quoted", "approved", "in_production", "completed", "rejected"]),
      quotedPrice: z.string().optional(),
      distributorNotes: z.string().optional(),
      estimatedDelivery: z.string().optional(), // ISO date string
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await verifyStoreOwnership(db, input.storeId, getOrgScope(ctx));

      const [existing] = await db
        .select()
        .from(printRequests)
        .where(and(eq(printRequests.id, input.id), eq(printRequests.storeId, input.storeId)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Print request not found" });

      const now = new Date();
      const updates: Partial<typeof printRequests.$inferInsert> = {
        status: input.status,
        updatedAt: now,
      };

      if (input.quotedPrice !== undefined) {
        updates.quotedPrice = input.quotedPrice;
      }
      if (input.distributorNotes !== undefined) {
        updates.distributorNotes = input.distributorNotes;
      }
      if (input.estimatedDelivery !== undefined) {
        updates.estimatedDelivery = new Date(input.estimatedDelivery);
      }
      if (input.status === "reviewed" && !existing.reviewedAt) {
        updates.reviewedAt = now;
      }
      if (input.status === "completed" && !existing.completedAt) {
        updates.completedAt = now;
      }

      await db
        .update(printRequests)
        .set(updates)
        .where(eq(printRequests.id, input.id));

      log.info(`[printRequests] #${input.id} → ${input.status} by user ${ctx.user.id}`);

      return { success: true };
    }),

  /** Count of pending (submitted + reviewed) print requests for a store — used for badge. */
  pendingCount: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { count: 0 };

      await verifyStoreOwnership(db, input.storeId, getOrgScope(ctx));

      const rows = await db
        .select({ id: printRequests.id })
        .from(printRequests)
        .where(and(
          eq(printRequests.storeId, input.storeId),
          inArray(printRequests.status, ["submitted", "reviewed"]),
        ));

      return { count: rows.length };
    }),
});
