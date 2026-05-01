/**
 * Store Portal — Custom Order Requests sub-router.
 *
 * POC-facing procedures: list, getById, updateStatus.
 */
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { customOrderRequests, storeUsers } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";
import { getLogger } from "../utils/logger";

const log = getLogger("storePortalCustomRequests");

export const storePortalCustomRequestsRouter = router({
  list: publicProcedure
    .input(storeSlugInput.extend({
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      // Build where conditions
      const conditions = [eq(customOrderRequests.storeId, store.id)];

      // Non-admin/manager users can only see their own requests
      if (!["poc", "admin", "manager"].includes(storeUser.role)) {
        conditions.push(eq(customOrderRequests.storeUserId, storeUser.id));
      }

      if (input.status) {
        conditions.push(eq(customOrderRequests.status, input.status as "pending" | "reviewed" | "approved" | "declined" | "fulfilled"));
      }

      const rows = await db
        .select({
          id: customOrderRequests.id,
          storeId: customOrderRequests.storeId,
          storeUserId: customOrderRequests.storeUserId,
          title: customOrderRequests.title,
          description: customOrderRequests.description,
          quantity: customOrderRequests.quantity,
          targetDate: customOrderRequests.targetDate,
          status: customOrderRequests.status,
          pocNotes: customOrderRequests.pocNotes,
          reviewedAt: customOrderRequests.reviewedAt,
          createdAt: customOrderRequests.createdAt,
          updatedAt: customOrderRequests.updatedAt,
          employeeName: storeUsers.name,
          employeeEmail: storeUsers.email,
        })
        .from(customOrderRequests)
        .leftJoin(storeUsers, eq(storeUsers.id, customOrderRequests.storeUserId))
        .where(and(...conditions))
        .orderBy(desc(customOrderRequests.createdAt))
        .limit(100);

      return rows.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        quantity: r.quantity,
        targetDate: r.targetDate?.toISOString() ?? null,
        status: r.status,
        pocNotes: r.pocNotes,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        createdAt: r.createdAt?.toISOString() ?? null,
        employeeName: r.employeeName ?? null,
        employeeEmail: r.employeeEmail ?? null,
      }));
    }),

  getById: publicProcedure
    .input(storeSlugInput.extend({ requestId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      const [request] = await db
        .select({
          id: customOrderRequests.id,
          storeId: customOrderRequests.storeId,
          storeUserId: customOrderRequests.storeUserId,
          title: customOrderRequests.title,
          description: customOrderRequests.description,
          quantity: customOrderRequests.quantity,
          targetDate: customOrderRequests.targetDate,
          attachmentUrls: customOrderRequests.attachmentUrls,
          status: customOrderRequests.status,
          pocNotes: customOrderRequests.pocNotes,
          reviewedAt: customOrderRequests.reviewedAt,
          createdAt: customOrderRequests.createdAt,
          updatedAt: customOrderRequests.updatedAt,
          employeeName: storeUsers.name,
          employeeEmail: storeUsers.email,
        })
        .from(customOrderRequests)
        .leftJoin(storeUsers, eq(storeUsers.id, customOrderRequests.storeUserId))
        .where(
          and(
            eq(customOrderRequests.id, input.requestId),
            eq(customOrderRequests.storeId, store.id),
          )
        )
        .limit(1);

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      }

      // Non-admin/manager can only view their own
      if (!["poc", "admin", "manager"].includes(storeUser.role) && request.storeUserId !== storeUser.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return {
        id: request.id,
        title: request.title,
        description: request.description,
        quantity: request.quantity,
        targetDate: request.targetDate?.toISOString() ?? null,
        attachmentUrls: request.attachmentUrls ?? [],
        status: request.status,
        pocNotes: request.pocNotes,
        reviewedAt: request.reviewedAt?.toISOString() ?? null,
        createdAt: request.createdAt?.toISOString() ?? null,
        employeeName: request.employeeName ?? null,
        employeeEmail: request.employeeEmail ?? null,
      };
    }),

  updateStatus: publicProcedure
    .input(storeSlugInput.extend({
      requestId: z.number(),
      status: z.enum(["pending", "reviewed", "approved", "declined", "fulfilled"]),
      pocNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      // Only POC/admin/manager can update status
      if (!["poc", "admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only POC, admins, or managers can update request status." });
      }

      const [existing] = await db
        .select()
        .from(customOrderRequests)
        .where(
          and(
            eq(customOrderRequests.id, input.requestId),
            eq(customOrderRequests.storeId, store.id),
          )
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      }

      await db.update(customOrderRequests)
        .set({
          status: input.status,
          pocNotes: input.pocNotes ?? existing.pocNotes,
          reviewedAt: new Date(),
        })
        .where(eq(customOrderRequests.id, input.requestId));

      // Manager rejection — email the employee who placed the request, with
      // the manager's reason. Fires independently of any distributor-side
      // notification so both parties learn of the decision.
      if (input.status === "declined" && existing.status !== "declined") {
        try {
          const [employee] = await db
            .select({ name: storeUsers.name, email: storeUsers.email })
            .from(storeUsers)
            .where(eq(storeUsers.id, existing.storeUserId))
            .limit(1);
          if (employee?.email) {
            const { resolveTier3 } = await import("../email/brandingResolver");
            const { buildCustomRequestRejectedEmail } = await import("../email/emailTemplates");
            const { sendEmail } = await import("../email/mailer");
            const resolved = await resolveTier3({ storeId: store.id });
            const { subject, html } = buildCustomRequestRejectedEmail({
              employeeName: employee.name || "there",
              requestTitle: existing.title,
              storeName: resolved.branding.companyName || "Your Store",
              managerName: storeUser.name || undefined,
              reason: input.pocNotes ?? existing.pocNotes ?? undefined,
              branding: resolved.branding,
            });
            const emailResult = await sendEmail(
              employee.email,
              subject,
              html,
              resolved.fromName,
              resolved.replyTo,
            );
            if (!emailResult.sent) {
              log.error(
                `Custom-request rejection email to ${employee.email} (request ${input.requestId}) failed: ${emailResult.error}`,
              );
            }
          }
        } catch (emailErr) {
          // Email is best-effort — never block the status update, but never
          // swallow the failure silently either.
          log.error(
            `Exception sending custom-request rejection email for request ${input.requestId}:`,
            emailErr,
          );
        }
      }

      return { success: true };
    }),

  pendingCount: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store } = await resolveStoreSession(ctx, input.storeSlug);

      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(customOrderRequests)
        .where(
          and(
            eq(customOrderRequests.storeId, store.id),
            eq(customOrderRequests.status, "pending"),
          )
        );

      return { count: Number(result?.count ?? 0) };
    }),
});
