/**
 * Store Portal — Print Requests sub-router.
 *
 * POC-facing print request procedures: list, getById, submit.
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { printRequests } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";
import { onCustomOrderRequestCreated } from "../utils/agentTriggers";

export const storePortalPrintRouter = router({
  list: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store } = await resolveStoreSession(ctx, input.storeSlug);

      const allRequests = await db
        .select()
        .from(printRequests)
        .where(eq(printRequests.storeId, store.id));

      return allRequests
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
        .map(r => ({
          id: r.id,
          category: r.category,
          title: r.title,
          description: r.description,
          quantity: r.quantity,
          status: r.status,
          quotedPrice: r.quotedPrice?.toString() || null,
          distributorNotes: r.distributorNotes,
          estimatedDelivery: r.estimatedDelivery?.toISOString() || null,
          requestedBy: r.requestedBy,
          requestedByName: r.requestedByName,
          createdAt: r.createdAt?.toISOString() || null,
          updatedAt: r.updatedAt?.toISOString() || null,
        }));
    }),

  getById: publicProcedure
    .input(storeSlugInput.extend({ requestId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { db, store } = await resolveStoreSession(ctx, input.storeSlug);

      const [request] = await db
        .select()
        .from(printRequests)
        .where(and(
          eq(printRequests.id, input.requestId),
          eq(printRequests.storeId, store.id),
        ))
        .limit(1);

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Print request not found" });
      }

      return {
        id: request.id,
        category: request.category,
        title: request.title,
        description: request.description,
        quantity: request.quantity,
        attachments: request.attachments || [],
        status: request.status,
        quotedPrice: request.quotedPrice?.toString() || null,
        distributorNotes: request.distributorNotes,
        estimatedDelivery: request.estimatedDelivery?.toISOString() || null,
        reviewedAt: request.reviewedAt?.toISOString() || null,
        completedAt: request.completedAt?.toISOString() || null,
        requestedBy: request.requestedBy,
        requestedByName: request.requestedByName,
        createdAt: request.createdAt?.toISOString() || null,
        updatedAt: request.updatedAt?.toISOString() || null,
      };
    }),

  submit: publicProcedure
    .input(storeSlugInput.extend({
      category: z.enum(["business_cards", "envelopes", "letterhead", "brochures", "flyers", "banners", "signage", "promotional", "packaging", "other"]),
      title: z.string().min(1),
      description: z.string().optional(),
      quantity: z.number().min(1).default(1),
      attachments: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      // Stamp the submitter's locationId (null for global admin / POC) so
      // distributor-side filters can scope by location. The legacy
      // divisionId column is intentionally left unset on new rows.
      const result = await db.insert(printRequests).values({
        storeId: store.id,
        clientId: store.clientId,
        userId: store.userId,
        organizationId: store.organizationId,
        locationId: storeUser.locationId ?? null,
        requestedBy: storeUser.email,
        requestedByName: storeUser.name || storeUser.email,
        category: input.category,
        title: input.title,
        description: input.description || null,
        quantity: input.quantity,
        attachments: input.attachments || null,
        status: "submitted",
      });

      // GAP 1 FIX: Notify the distributor and trigger the AI copilot
      const insertedId = result[0]?.insertId;

      // In-app notification for the distributor
      try {
        const { notifyOwner } = await import("../_core/notification");
        await notifyOwner({
          userId: store.userId,
          organizationId: store.organizationId ?? undefined,
          type: "print_request",
          title: "New Print Request",
          content: `${storeUser.name || storeUser.email} submitted a print request: "${input.title}" (qty ${input.quantity})`,
          actionPath: `/store-management/${store.id}?tab=print-requests`,
          actionLabel: "View Request",
          entityId: insertedId,
          entityType: "print_request",
        });
      } catch (notifyErr) {
        // Never let notification failure break the submit
        const { getLogger } = await import("../utils/logger");
        getLogger("storePortalPrint").warn("[notify] print request notification failed:", notifyErr);
      }

      // Fire-and-forget agent trigger — never block the response on it.
      if (insertedId) {
        void onCustomOrderRequestCreated(insertedId, store.organizationId ?? null).catch(() => {});
      }

      return { success: true, message: "Print request submitted successfully" };
    }),
});
