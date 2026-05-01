import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { departmentApprovals, proposals } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";
import { notifyOwner } from "../_core/notification";
import { buildDeptApprovalRequestEmail } from "../email/emailTemplates";
import { loadClientBrandingForProposal } from "../routes/publicProposal/publicProposalHelpers";

const log = getLogger("departmentApprovals");

export const departmentApprovalsRouter = router({
  /**
   * List all department approvals for a given proposal.
   * Used on the distributor's ProposalDetail page to show approval status.
   */
  listByProposal: protectedProcedure
    .input(z.object({ proposalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify proposal ownership
      const [proposal] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const rows = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, input.proposalId));

      return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    }),

  /**
   * Create department approvals for a proposal (batch).
   * Called when the distributor sends a proposal with multi-department enabled.
   */
  createBatch: protectedProcedure
    .input(
      z.object({
        proposalId: z.number(),
        departments: z.array(
          z.object({
            name: z.string().min(1),
            contactName: z.string().optional(),
            contactEmail: z.string().email().optional().or(z.literal("")),
            description: z.string().optional(),
            sortOrder: z.number().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify proposal ownership
      const [proposal] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      // Insert new department approvals with unique tokens
      const tokenExpiresAt = proposal.approvalLinkExpiryEnabled
        ? new Date(Date.now() + 72 * 60 * 60 * 1000)
        : null;
      const values = input.departments.map((dept, idx) => ({
        proposalId: input.proposalId,
        departmentName: dept.name,
        contactName: dept.contactName || null,
        contactEmail: dept.contactEmail || null,
        description: dept.description || null,
        approvalToken: nanoid(32),
        tokenExpiresAt,
        sortOrder: dept.sortOrder ?? idx,
        addedBy: "distributor" as const,
      }));

      const rows = await db.transaction(async (tx) => {
        // Delete existing approvals for this proposal (fresh start)
        await tx
          .delete(departmentApprovals)
          .where(eq(departmentApprovals.proposalId, input.proposalId));

        if (input.departments.length === 0) return [];

        // Insert new department approvals with unique tokens
        await tx.insert(departmentApprovals).values(values);

        // Return the created rows
        const created = await tx
          .select()
          .from(departmentApprovals)
          .where(eq(departmentApprovals.proposalId, input.proposalId));

        return created.sort((a, b) => a.sortOrder - b.sortOrder);
      });
      return rows;
    }),

  /**
   * Send approval emails to all departments that have email addresses.
   * Called after proposal is sent, or when distributor wants to (re)send department invites.
   */
  sendEmails: protectedProcedure
    .input(
      z.object({
        proposalId: z.number(),
        origin: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify proposal ownership
      const [proposal] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      // Tier 3 — these emails go to end-user approvers on the client side.
      const clientBranding = await loadClientBrandingForProposal(proposal.id);

      const rows = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, input.proposalId));

      const withEmail = rows.filter(r => r.contactEmail);
      let sentCount = 0;

      // Lazy import to avoid circular deps
      const { sendEmail } = await import("../email/mailer");

      for (const dept of withEmail) {
        // When the proposal has expiry enabled, a resend issues a fresh 72h
        // link — otherwise the recipient could receive a new email containing
        // an already-expired token. When expiry is off, reuse the existing
        // token so previously-shared links keep working.
        let approvalToken = dept.approvalToken;
        let tokenExpiresAt: Date | null = dept.tokenExpiresAt ?? null;
        if (proposal.approvalLinkExpiryEnabled) {
          approvalToken = nanoid(32);
          tokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
          await db
            .update(departmentApprovals)
            .set({ approvalToken, tokenExpiresAt })
            .where(eq(departmentApprovals.id, dept.id));
        }
        const approvalUrl = `${input.origin}/approve/${approvalToken}`;
        const declineUrl = `${input.origin}/approve/${approvalToken}?action=decline`;
        const { subject, html } = buildDeptApprovalRequestEmail({
          approverName: dept.contactName || dept.departmentName,
          departmentName: dept.departmentName,
          clientCompany: proposal.title,
          proposalTitle: proposal.title,
          approveUrl: approvalUrl,
          declineUrl,
          branding: {
            companyName: clientBranding.companyName,
            primaryColor: clientBranding.primaryColor,
            logoUrl: clientBranding.logoUrl || undefined,
          },
        });

        const result = await sendEmail(dept.contactEmail!, subject, html, clientBranding.fromName, clientBranding.replyTo);
        if (result.sent) {
          sentCount++;
          await db
            .update(departmentApprovals)
            .set({ emailSentAt: new Date() })
            .where(eq(departmentApprovals.id, dept.id));
        }
      }

      // Notify the distributor that approval emails were sent
      if (sentCount > 0) {
        await notifyOwner({
          userId: ctx.user.id,
          organizationId: ctx.organizationId ?? undefined,
          type: "approval_requested",
          title: "Department Approvals Sent",
          content: `Approval requests sent to ${sentCount} department${sentCount !== 1 ? "s" : ""} for "${proposal.title}".`,
          actionPath: `/proposals/${proposal.id}`,
          actionLabel: "View Proposal",
          entityId: proposal.id,
          entityType: "proposal",
        });
      }

      return { sentCount, totalWithEmail: withEmail.length };
    }),

  /**
   * Update a single department approval (distributor can edit name/email/contact).
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        departmentName: z.string().optional(),
        contactName: z.string().optional(),
        contactEmail: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Get the approval and verify ownership via proposal
      const [approval] = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.id, input.id))
        .limit(1);
      if (!approval) throw new TRPCError({ code: "NOT_FOUND", message: "Department approval not found" });

      const [proposal] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, approval.proposalId), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const setObj: Record<string, unknown> = {};
      if (input.departmentName !== undefined) setObj.departmentName = input.departmentName;
      if (input.contactName !== undefined) setObj.contactName = input.contactName;
      if (input.contactEmail !== undefined) setObj.contactEmail = input.contactEmail || null;
      if (input.description !== undefined) setObj.description = input.description;

      if (Object.keys(setObj).length > 0) {
        await db.update(departmentApprovals).set(setObj).where(eq(departmentApprovals.id, input.id));
      }

      const [updated] = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.id, input.id))
        .limit(1);
      return updated;
    }),

  /**
   * Delete a department approval entry.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [approval] = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.id, input.id))
        .limit(1);
      if (!approval) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [proposal] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, approval.proposalId), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      await db.delete(departmentApprovals).where(eq(departmentApprovals.id, input.id));
      return { success: true };
    }),
});

/**
 * @deprecated Use buildDeptApprovalRequestEmail from emailTemplates.ts instead.
 * Kept for backward compatibility with any external callers.
 */
function buildDepartmentApprovalEmail(data: {
  departmentName: string;
  contactName?: string;
  proposalTitle: string;
  approvalUrl: string;
  reminder?: boolean;
  branding?: {
    logoUrl?: string | null;
    primaryColor?: string;
    companyName?: string | null;
  };
}): { subject: string; html: string } {
  const greeting = data.contactName ? `Hi ${data.contactName},` : "Hello,";
  const brandName = data.branding?.companyName || "Your Distributor";
  const primaryColor = data.branding?.primaryColor || "#654BF9";
  const logoUrl = data.branding?.logoUrl || null;
  const subject = data.reminder
    ? `Reminder: Your approval is still needed — ${data.proposalTitle}`
    : `Action Required: Review & Approve — ${data.proposalTitle}`;

  // If distributor has a logo, show it; otherwise show company name as text
  const headerContent = logoUrl
    ? `<img src="${logoUrl}" alt="${brandName}" width="200" height="40" style="display:block; margin:0 auto; max-width:180px; height:auto;" border="0" />`
    : `<p style="color:#FFFFFF; font-size:22px; font-weight:700; margin:0; letter-spacing:0.5px;">${brandName}</p>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#F3F4F6; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6; padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:${primaryColor}; padding:36px 32px; text-align:center;">
            ${headerContent}
            <p style="color:rgba(255,255,255,0.85); font-size:14px; margin:12px 0 0 0; font-weight:400;">Department Approval Request</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px 32px;">
            <p style="font-size:15px; line-height:1.7; color:#374151; margin:0 0 16px 0;">${greeting}</p>
            <p style="font-size:15px; line-height:1.7; color:#374151; margin:0 0 24px 0;">
              Your review is needed for the <strong>${data.departmentName}</strong> department on the following proposal:
            </p>
            <div style="background:#F5F3FF; border-radius:12px; padding:20px 24px; margin:0 0 24px 0;">
              <p style="margin:0; font-size:16px; font-weight:600; color:${primaryColor};">${data.proposalTitle}</p>
              <p style="margin:8px 0 0 0; font-size:13px; color:#6B7280;">Department: ${data.departmentName}</p>
            </div>
            <p style="font-size:14px; line-height:1.7; color:#374151; margin:0 0 24px 0;">
              Please review the proposal details and submit your approval or feedback using the button below.
            </p>
            <!-- CTA Button -->
            <div style="text-align:center; margin:24px 0;">
              <a href="${data.approvalUrl}" style="display:inline-block; background:${primaryColor}; color:#FFFFFF; font-size:15px; font-weight:600; padding:14px 36px; border-radius:10px; text-decoration:none;">
                Review &amp; Approve
              </a>
            </div>
            <p style="font-size:12px; color:#9CA3AF; text-align:center; margin:16px 0 0 0;">
              Or copy this link: <a href="${data.approvalUrl}" style="color:${primaryColor}; word-break:break-all;">${data.approvalUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px; border-top:1px solid #F3F4F6; text-align:center;">
            <p style="font-size:12px; color:#9CA3AF; margin:0;">
              &copy; ${new Date().getFullYear()} ${brandName}
            </p>
            <p style="font-size:11px; color:#D1D5DB; margin:6px 0 0 0;">
              This email was sent because your approval was requested for a proposal.
            </p>
            <p style="font-size:11px; color:#9CA3AF; margin:8px 0 0 0;">
              Powered by <a href="https://mergetasks.com" style="color:#6B7280;text-decoration:none;font-weight:500;">MergeTasks</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

// Export for testing and use in public routes
export { buildDepartmentApprovalEmail };
