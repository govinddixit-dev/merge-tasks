/**
 * Refunds Router — distributor-side refund procedures.
 *
 * Procedures:
 *   issueRefund            — distributor issues a refund (Stripe + DB + email)
 *   denyRequest            — distributor denies a POC refund request
 *   listRequests           — list refund requests for the org
 *   getRequestForProposal  — get the latest refund request for a proposal
 *   getHistory             — get refund history for an entity
 */
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  proposals, orders, invoices, refundHistory, refundRequests,
  stores, storeUsers, users, distributorProfiles,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";
import { processStripeRefund } from "../utils/refundService";
import { auditLog } from "../utils/auditLog";
import { buildEmailHtml } from "../email/emailTemplates";
import { sendEmail } from "../email/mailer";
import { getLogger } from "../utils/logger";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { REFUND_ISSUE_LIMIT } from "../utils/rateLimiter";

const log = getLogger("refunds");

export const refundsRouter = router({
  /**
   * Issue a refund — distributor-initiated, hits Stripe directly.
   * Works for proposals, orders, and invoices.
   */
  issueRefund: protectedProcedure
    .use(rateLimited("refunds.issueRefund", REFUND_ISSUE_LIMIT))
    .input(z.object({
      entityType: z.enum(["order", "invoice", "proposal"]),
      entityId: z.number(),
      amount: z.number().min(0), // cents, 0 = full refund
      reason: z.string().min(1, "Reason is required"),
      requestId: z.number().optional(), // if approving a POC request
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Audit fix #14: Wrap the entire validation → Stripe → DB-update sequence in a
      // single transaction with SELECT ... FOR UPDATE row locking to prevent the TOCTOU
      // race condition where two concurrent requests both pass the "remaining refundable"
      // check and both succeed at Stripe, causing an over-refund.
      //
      // Pattern: open transaction → lock row → validate → call Stripe → update row.
      // The row lock is held for the duration of the Stripe API call; concurrent
      // requests for the same entity will block until the first one commits.
      let refundResult: { success: boolean; refundId?: string; amount?: number; error?: string } = { success: false };

      await db.transaction(async (tx) => {
        // ── Step 1: Lock the entity row ──────────────────────────────────────
        // Raw SQL SELECT FOR UPDATE — Drizzle does not expose a .forUpdate() API.
        let remainingRefundableCents = Infinity;

        if (input.entityType === "proposal") {
          const rows = await tx.execute(
            sql`SELECT id, estimatedValue, refundedAmount FROM proposals
                WHERE id = ${input.entityId} FOR UPDATE`
          ) as unknown as Array<{ id: number; estimatedValue: string | null; refundedAmount: number | null }>;
          const prop = rows[0];
          if (!prop) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
          // Verify org scope after locking (can't use Drizzle scope inside raw SQL)
          const [scopeCheck] = await tx.select({ id: proposals.id }).from(proposals)
            .where(and(eq(proposals.id, input.entityId), scope.proposals)).limit(1);
          if (!scopeCheck) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
          const totalCents = Math.round(parseFloat(prop.estimatedValue?.toString() || "0") * 100);
          remainingRefundableCents = Math.max(0, totalCents - (prop.refundedAmount || 0));
        } else if (input.entityType === "order") {
          const rows = await tx.execute(
            sql`SELECT id, total, refundedAmount FROM orders
                WHERE id = ${input.entityId} FOR UPDATE`
          ) as unknown as Array<{ id: number; total: string | null; refundedAmount: number | null }>;
          const ord = rows[0];
          if (!ord) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
          const [scopeCheck] = await tx.select({ id: orders.id }).from(orders)
            .where(and(eq(orders.id, input.entityId), scope.orders)).limit(1);
          if (!scopeCheck) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
          const totalCents = Math.round(parseFloat(ord.total?.toString() || "0") * 100);
          remainingRefundableCents = Math.max(0, totalCents - (ord.refundedAmount || 0));
        } else if (input.entityType === "invoice") {
          const rows = await tx.execute(
            sql`SELECT id, total, refundedAmount FROM invoices
                WHERE id = ${input.entityId} FOR UPDATE`
          ) as unknown as Array<{ id: number; total: string | null; refundedAmount: number | null }>;
          const inv = rows[0];
          if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
          const [scopeCheck] = await tx.select({ id: invoices.id }).from(invoices)
            .where(and(eq(invoices.id, input.entityId), scope.invoices)).limit(1);
          if (!scopeCheck) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
          const totalCents = Math.round(parseFloat(inv.total?.toString() || "0") * 100);
          remainingRefundableCents = Math.max(0, totalCents - (inv.refundedAmount || 0));
        }

        // ── Step 2: Validate amount while holding the lock ───────────────────
        if (input.amount > 0 && input.amount > remainingRefundableCents) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Refund amount ($${(input.amount / 100).toFixed(2)}) exceeds remaining refundable amount ($${(remainingRefundableCents / 100).toFixed(2)}).`,
          });
        }

        // ── Step 3: Call Stripe (while row is locked) ────────────────────────
        // Note: Stripe calls inside DB transactions are acceptable here because
        // the lock window is short and the alternative (TOCTOU over-refund) is worse.
        refundResult = await processStripeRefund({
          organizationId: scope.organizationId!,
          entityType: input.entityType,
          entityId: input.entityId,
          amount: input.amount,
          reason: input.reason,
          processedBy: ctx.user.id,
        });

        if (!refundResult.success) {
          // Throwing inside the transaction rolls it back and releases the lock.
          throw new TRPCError({ code: "BAD_REQUEST", message: refundResult.error || "Refund failed" });
        }

        // ── Step 4: Update entity tracking columns (same transaction) ────────
        const refundedCents = refundResult.amount || input.amount;

        if (input.entityType === "proposal") {
          const [prop] = await tx.select().from(proposals).where(eq(proposals.id, input.entityId)).limit(1);
          const totalRefunded = (prop?.refundedAmount || 0) + refundedCents;
          await tx.update(proposals).set({
            paymentRefunded: true,
            refundedAmount: totalRefunded,
            refundedAt: new Date(),
            stripeRefundId: refundResult.refundId ?? null,
          }).where(eq(proposals.id, input.entityId));
        } else if (input.entityType === "order") {
          const [ord] = await tx.select().from(orders).where(eq(orders.id, input.entityId)).limit(1);
          const totalRefunded = (ord?.refundedAmount || 0) + refundedCents;
          const orderTotalCents = Math.round(parseFloat(ord?.total?.toString() || "0") * 100);
          const newStatus = totalRefunded >= orderTotalCents ? "refunded" : "partially_refunded";
          await tx.update(orders).set({
            refundedAmount: totalRefunded,
            refundedAt: new Date(),
            stripeRefundId: refundResult.refundId ?? null,
            status: newStatus as "refunded" | "partially_refunded",
          }).where(eq(orders.id, input.entityId));
        } else if (input.entityType === "invoice") {
          const [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.entityId)).limit(1);
          const totalRefunded = (inv?.refundedAmount || 0) + refundedCents;
          const invoiceTotalCents = Math.round(parseFloat(inv?.total?.toString() || "0") * 100);
          const newStatus = totalRefunded >= invoiceTotalCents ? "refunded" : "partially_refunded";
          await tx.update(invoices).set({
            refundedAmount: totalRefunded,
            refundedAt: new Date(),
            stripeRefundId: refundResult.refundId ?? null,
            status: newStatus as "refunded" | "partially_refunded",
          }).where(eq(invoices.id, input.entityId));
        }
      });

      const refundedCents = refundResult.amount || input.amount;

      // If this was approving a POC request, update the request + send email
      if (input.requestId) {
        await db.update(refundRequests).set({
          status: "approved",
          responseNote: `Refund of $${(refundedCents / 100).toFixed(2)} processed.`,
          respondedAt: new Date(),
        }).where(eq(refundRequests.id, input.requestId));

        auditLog({
          action: "refund.approved",
          userId: ctx.user.id,
          resourceType: "refund_request",
          resourceId: input.requestId,
          description: `Approved refund request #${input.requestId} — ${refundedCents} cents`,
          metadata: { requestId: input.requestId, amount: refundedCents },
        });

        try {
          await sendRefundResponseEmail(db, input.requestId, "approved", refundedCents);
        } catch (e) { log.warn("Failed to send refund approval email:", e); }
      }

      return { success: true, refundId: refundResult.refundId, amount: refundResult.amount };
    }),

  /**
   * Deny a POC refund request — no Stripe action, just updates status and notifies POC.
   */
  denyRequest: protectedProcedure
    .input(z.object({
      requestId: z.number(),
      responseNote: z.string().min(1, "Please provide a reason for denying"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Audit fix #12: use scope.refundRequests so solo users are scoped by distributorUserId
      const [request] = await db.select().from(refundRequests)
        .where(and(
          eq(refundRequests.id, input.requestId),
          scope.refundRequests,
        ))
        .limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Refund request not found" });
      if (request.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Request already resolved" });

      await db.update(refundRequests).set({
        status: "denied",
        responseNote: input.responseNote,
        respondedAt: new Date(),
      }).where(eq(refundRequests.id, input.requestId));

      auditLog({
        action: "refund.denied",
        userId: ctx.user.id,
        resourceType: "refund_request",
        resourceId: input.requestId,
        description: `Denied refund request #${input.requestId}: ${input.responseNote}`,
        metadata: { requestId: input.requestId, reason: input.responseNote },
      });

      // Send denial email to POC
      try {
        await sendRefundResponseEmail(db, input.requestId, "denied", 0, input.responseNote);
      } catch (e) { log.warn("Failed to send refund denial email:", e); }

      return { success: true };
    }),

  /**
   * List pending refund requests for the distributor's org.
   */
  listRequests: protectedProcedure
    .input(z.object({
      status: z.enum(["pending", "approved", "denied"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Audit fix #12: use scope.refundRequests so solo users are scoped by distributorUserId
      const conditions = [scope.refundRequests];
      if (input?.status) conditions.push(eq(refundRequests.status, input.status));

      const requests = await db.select({
        id: refundRequests.id,
        proposalId: refundRequests.proposalId,
        storeId: refundRequests.storeId,
        reason: refundRequests.reason,
        status: refundRequests.status,
        responseNote: refundRequests.responseNote,
        respondedAt: refundRequests.respondedAt,
        createdAt: refundRequests.createdAt,
        pocName: storeUsers.name,
        pocEmail: storeUsers.email,
        proposalTitle: proposals.title,
        proposalValue: proposals.estimatedValue,
        storeName: stores.name,
      })
        .from(refundRequests)
        .leftJoin(storeUsers, eq(storeUsers.id, refundRequests.storeUserId))
        .leftJoin(proposals, eq(proposals.id, refundRequests.proposalId))
        .leftJoin(stores, eq(stores.id, refundRequests.storeId))
        .where(and(...conditions))
        .orderBy(desc(refundRequests.createdAt))
        .limit(100);

      return requests;
    }),

  /**
   * Get refund request for a specific proposal (used in ProposalDetail banner).
   */
  getRequestForProposal: protectedProcedure
    .input(z.object({ proposalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [request] = await db.select({
        id: refundRequests.id,
        reason: refundRequests.reason,
        status: refundRequests.status,
        responseNote: refundRequests.responseNote,
        respondedAt: refundRequests.respondedAt,
        createdAt: refundRequests.createdAt,
        pocName: storeUsers.name,
        pocEmail: storeUsers.email,
      })
        .from(refundRequests)
        .leftJoin(storeUsers, eq(storeUsers.id, refundRequests.storeUserId))
        // Audit fix #12: use scope.refundRequests so solo users are scoped by distributorUserId
        .where(and(
          eq(refundRequests.proposalId, input.proposalId),
          scope.refundRequests,
        ))
        .orderBy(desc(refundRequests.createdAt))
        .limit(1);

      return request || null;
    }),

  /**
   * Get refund history for an entity.
   */
  getHistory: protectedProcedure
    .input(z.object({
      entityType: z.enum(["order", "invoice", "proposal"]),
      entityId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Audit fix #12: use scope.refundHistory so solo users are scoped by processedBy
      const history = await db.select().from(refundHistory)
        .where(and(
          eq(refundHistory.entityType, input.entityType),
          eq(refundHistory.entityId, input.entityId),
          scope.refundHistory,
        ))
        .orderBy(desc(refundHistory.createdAt));

      return history;
    }),
});

/**
 * Send a branded email to the POC when their refund request is approved or denied.
 */
async function sendRefundResponseEmail(
  // Drizzle DB instance type is complex and project-specific
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  requestId: number,
  action: "approved" | "denied",
  refundedAmount: number,
  responseNote?: string,
) {
  const [request] = await db.select().from(refundRequests)
    .where(eq(refundRequests.id, requestId)).limit(1);
  if (!request) return;

  const [pocUser] = await db.select().from(storeUsers)
    .where(eq(storeUsers.id, request.storeUserId)).limit(1);
  if (!pocUser?.email) return;

  const [proposal] = await db.select().from(proposals)
    .where(eq(proposals.id, request.proposalId)).limit(1);

  const [distributor] = await db.select().from(users)
    .where(eq(users.id, request.distributorUserId)).limit(1);

  const [distProfile] = await db.select().from(distributorProfiles)
    .where(eq(distributorProfiles.userId, request.distributorUserId)).limit(1);

  const branding = distProfile ? {
    companyName: distProfile.brandCompanyName || distProfile.companyName || undefined,
    primaryColor: distProfile.brandPrimaryColor || undefined,
    logoUrl: distProfile.brandLogoUrl || undefined,
    lane: "distributor" as const,
  } : undefined;

  const isApproved = action === "approved";
  const amountStr = refundedAmount > 0 ? `$${(refundedAmount / 100).toFixed(2)}` : "";

  const html = buildEmailHtml({
    branding,
    badge: {
      text: isApproved ? "Refund Approved" : "Refund Request Denied",
      color: isApproved ? "#16A34A" : "#DC2626",
      bgColor: isApproved ? "#F0FDF4" : "#FEF2F2",
    },
    headline: isApproved ? "Your Refund Has Been Approved" : "Refund Request Update",
    subheadline: proposal?.title || "Proposal",
    bodyParagraphs: isApproved
      ? [
          `Great news — your refund request for <strong>${proposal?.title || "your proposal"}</strong> has been approved.`,
          amountStr ? `A refund of <strong>${amountStr}</strong> will be returned to your original payment method within 5–10 business days.` : "The refund will be returned to your original payment method within 5–10 business days.",
        ]
      : [
          `Your refund request for <strong>${proposal?.title || "your proposal"}</strong> has been reviewed.`,
          `<strong>Decision:</strong> The request has been denied.`,
          ...(responseNote ? [`<strong>Reason:</strong> ${responseNote}`] : []),
          "If you have questions, please contact your distributor directly.",
        ],
    infoCard: {
      title: proposal?.title || "Proposal",
      subtitle: isApproved ? `Refund: ${amountStr}` : "Request denied",
      accentColor: isApproved ? "#16A34A" : "#DC2626",
      bgColor: isApproved ? "#F0FDF4" : "#FEF2F2",
    },
  });

  const subject = isApproved
    ? `Refund Approved — ${proposal?.title || "Your Proposal"}`
    : `Refund Request Update — ${proposal?.title || "Your Proposal"}`;

  await sendEmail(
    pocUser.email,
    subject,
    html,
    branding?.companyName || "MergeTasks",
    distributor?.email,
  );
}
