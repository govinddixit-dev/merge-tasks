/**
 * Store Portal — Refunds sub-router.
 *
 * POC-facing refund request procedures: requestRefund, getStatus.
 */
import { z } from "zod";
import { eq, and, desc, count, gte } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { proposals, refundRequests, users } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getLogger } from "../utils/logger";
import { auditLog } from "../utils/auditLog";
import { buildEmailHtml } from "../email/emailTemplates";
import { sendEmail } from "../email/mailer";
import { resolveTier2 } from "../email/brandingResolver";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";

const log = getLogger("storePortal:refunds");

export const storePortalRefundsRouter = router({
  /**
   * Submit a refund request — POC provides a reason, distributor gets notified.
   */
  requestRefund: publicProcedure
    .input(storeSlugInput.extend({
      proposalId: z.number(),
      reason: z.string().min(10, "Please provide at least 10 characters explaining why"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      // Verify proposal belongs to this store's client
      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), eq(proposals.clientId, store.clientId)))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      // Check for existing pending request
      const [existing] = await db.select({ id: refundRequests.id }).from(refundRequests)
        .where(and(
          eq(refundRequests.proposalId, input.proposalId),
          eq(refundRequests.storeId, store.id),
          eq(refundRequests.status, "pending"),
        ))
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A refund request is already pending for this proposal" });
      }

      // Max 3 total requests per proposal per store (prevents denied→new→denied→new spam)
      const MAX_REQUESTS_PER_PROPOSAL = 3;
      const [totalCount] = await db.select({ total: count() }).from(refundRequests)
        .where(and(
          eq(refundRequests.proposalId, input.proposalId),
          eq(refundRequests.storeId, store.id),
        ));
      if ((totalCount?.total ?? 0) >= MAX_REQUESTS_PER_PROPOSAL) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Maximum of ${MAX_REQUESTS_PER_PROPOSAL} refund requests per proposal reached. Please contact your distributor directly.`,
        });
      }

      // 24-hour cooldown after a denied request (prevents immediate re-submission)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recentDenied] = await db.select({ id: refundRequests.id }).from(refundRequests)
        .where(and(
          eq(refundRequests.proposalId, input.proposalId),
          eq(refundRequests.storeId, store.id),
          eq(refundRequests.status, "denied"),
          gte(refundRequests.respondedAt, twentyFourHoursAgo),
        ))
        .limit(1);
      if (recentDenied) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Your previous request was recently denied. Please wait 24 hours before submitting a new request.",
        });
      }

      // Create the refund request
      await db.insert(refundRequests).values({
        organizationId: store.organizationId ?? proposal.organizationId,
        storeId: store.id,
        proposalId: input.proposalId,
        storeUserId: storeUser.id,
        distributorUserId: store.userId,
        reason: input.reason,
        status: "pending",
      });

      auditLog({
        action: "refund.requested",
        userId: null,
        resourceType: "proposal",
        resourceId: input.proposalId,
        description: `POC ${storeUser.email} requested refund for proposal #${input.proposalId}: ${input.reason.substring(0, 100)}`,
        metadata: { storeId: store.id, storeUserId: storeUser.id, proposalId: input.proposalId },
      });

      // Send branded email to distributor
      try {
        const [distributor] = await db.select().from(users)
          .where(eq(users.id, store.userId)).limit(1);
        if (distributor?.email) {
          const html = buildEmailHtml({
            badge: { text: "Refund Requested", color: "#D97706", bgColor: "#FFFBEB" },
            headline: "A Client Has Requested a Refund",
            subheadline: proposal.title,
            bodyParagraphs: [
              `<strong>${storeUser.name || storeUser.email}</strong> from <strong>${store.name}</strong> has submitted a refund request for the proposal <strong>${proposal.title}</strong>.`,
              `<strong>Reason:</strong> ${input.reason}`,
              `Please review this request and approve or deny it from your Proposals dashboard.`,
            ],
            infoCard: {
              title: proposal.title,
              subtitle: `Value: $${proposal.estimatedValue || "0.00"}`,
              meta: [
                { label: "Requested by", value: storeUser.name || storeUser.email },
                { label: "Store", value: store.name },
              ],
              accentColor: "#D97706",
              bgColor: "#FFFBEB",
            },
            cta: {
              label: "Review Request",
              url: `${process.env.APP_BASE_URL || "https://app.mergetasks.com"}/proposals/${input.proposalId}`,
            },
          });
          const resolved = await resolveTier2({ distributorUserId: store.userId });
          await sendEmail(distributor.email, `Refund Requested — ${proposal.title}`, html, resolved.fromName, resolved.replyTo);
        }
      } catch (e) { log.warn("Failed to send refund request email to distributor:", e); }

      return { success: true, message: "Refund request submitted. Your distributor will review it." };
    }),

  /**
   * Get the status of a refund request for a specific proposal.
   */
  getStatus: publicProcedure
    .input(storeSlugInput.extend({ proposalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { db, store } = await resolveStoreSession(ctx, input.storeSlug);

      const [request] = await db.select({
        id: refundRequests.id,
        status: refundRequests.status,
        reason: refundRequests.reason,
        responseNote: refundRequests.responseNote,
        respondedAt: refundRequests.respondedAt,
        createdAt: refundRequests.createdAt,
      })
        .from(refundRequests)
        .where(and(
          eq(refundRequests.proposalId, input.proposalId),
          eq(refundRequests.storeId, store.id),
        ))
        .orderBy(desc(refundRequests.createdAt))
        .limit(1);

      return request || null;
    }),
});
