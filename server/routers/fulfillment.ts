import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { proposals, invoices, estimates, clients, users } from "../../drizzle/schema";
import { getOrgScope } from "../utils/orgScope";
import { sendEmail } from "../email/mailer";
import { onFulfilled } from "../utils/agentTriggers";

export const fulfillmentRouter = router({

  markProposalFulfilled: protectedProcedure
    .input(z.object({
      proposalId: z.number().int().positive(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
      if (proposal.status !== "accepted") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only accepted proposals can be marked as fulfilled." });
      }

      await db.update(proposals)
        .set({ status: "fulfilled", fulfilledAt: new Date() })
        .where(eq(proposals.id, input.proposalId));

      await sendFulfillmentEmail({
        ctx, db, clientId: proposal.clientId,
        documentType: "Proposal", documentNumber: proposal.title,
        notes: input.notes,
      });

      void onFulfilled("proposal", proposal.id, proposal.clientId, proposal.organizationId);

      return { success: true };
    }),

  markInvoiceFulfilled: protectedProcedure
    .input(z.object({
      invoiceId: z.number().int().positive(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [invoice] = await db.select().from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), scope.invoices))
        .limit(1);
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      if (invoice.status !== "paid" && invoice.status !== "sent") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only paid or sent invoices can be marked as fulfilled." });
      }

      await db.update(invoices)
        .set({ status: "fulfilled", fulfilledAt: new Date() })
        .where(eq(invoices.id, input.invoiceId));

      await sendFulfillmentEmail({
        ctx, db, clientId: invoice.clientId,
        documentType: "Invoice", documentNumber: invoice.invoiceNumber,
        notes: input.notes,
      });

      void onFulfilled("invoice", invoice.id, invoice.clientId, invoice.organizationId);

      return { success: true };
    }),

  markEstimateFulfilled: protectedProcedure
    .input(z.object({
      estimateId: z.number().int().positive(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [estimate] = await db.select().from(estimates)
        .where(and(eq(estimates.id, input.estimateId), scope.estimates))
        .limit(1);
      if (!estimate) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });
      if (estimate.status !== "accepted") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only accepted estimates can be marked as fulfilled." });
      }

      await db.update(estimates)
        .set({ status: "fulfilled", fulfilledAt: new Date() })
        .where(eq(estimates.id, input.estimateId));

      await sendFulfillmentEmail({
        ctx, db, clientId: estimate.clientId,
        documentType: "Estimate", documentNumber: estimate.estimateNumber,
        notes: input.notes,
      });

      void onFulfilled("estimate", estimate.id, estimate.clientId, estimate.organizationId);

      return { success: true };
    }),
});

// ─── Internal helper ────────────────────────────────────────────────────────

async function sendFulfillmentEmail({
  ctx, db, clientId, documentType, documentNumber, notes,
}: {
  ctx: { user: { id: number } };
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  clientId: number;
  documentType: string;
  documentNumber: string;
  notes?: string;
}) {
  try {
    const [client] = await db.select({
      companyName: clients.companyName,
      contactEmail: clients.contactEmail,
      pocEmail: clients.pocEmail,
    }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!client) return;

    const [distributor] = await db.select({ name: users.name, email: users.email })
      .from(users).where(eq(users.id, ctx.user.id)).limit(1);

    const recipientEmail = client.pocEmail || client.contactEmail;
    if (!recipientEmail) return;

    const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #111;">Order Fulfilled ✓</h2>
          <p>Hi ${client.companyName},</p>
          <p>We're pleased to confirm that your ${documentType.toLowerCase()} <strong>${documentNumber}</strong> has been fulfilled and your branded merchandise is on its way.</p>
          ${notes ? `<p><strong>Note from your distributor:</strong> ${notes}</p>` : ""}
          <p>Thank you for your order.</p>
          <p style="color: #666; font-size: 13px;">— ${distributor?.name || "Your distributor"}</p>
        </div>
      `;

    await sendEmail(
      recipientEmail,
      `Your order has been fulfilled — ${documentType} ${documentNumber}`,
      html,
      distributor?.name ?? undefined,
      distributor?.email ?? undefined,
    );
  } catch (err) {
    console.error("Fulfillment email failed:", err);
  }
}
