/**
 * publicProposalApprovals.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Department approval routes (no authentication required):
 *
 *   GET  /api/proposals/public/:token/departments          — list dept statuses
 *   POST /api/proposals/public/:token/departments/forward  — POC forwards to depts
 *   GET  /api/approve/:token                               — dept approval page data
 *   POST /api/approve/:token                               — submit approval/rejection
 *   POST /api/proposals/public/:token/request-reapproval  — POC requests re-approval
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  proposals,
  proposalProducts,
  products,
  clients,
  distributorProfiles,
  departmentApprovals,
  users,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { notifyOwner } from "../../_core/notification";
import { getLogger } from "../../utils/logger";
import { auditLog } from "../../utils/auditLog";
import { loadProposalByToken, loadBrandingForProposal, loadClientBrandingForProposal } from "./publicProposalHelpers";

const log = getLogger("publicProposalApprovals");
export const publicProposalApprovalsRouter = Router();

// ─── GET departments ──────────────────────────────────────────────────────────

/** GET /api/proposals/public/:token/departments — list department approval statuses */
publicProposalApprovalsRouter.get(
  "/api/proposals/public/:token/departments",
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) return res.status(404).json({ error: "Proposal not found" });

      const { proposal } = result;
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const rows = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, proposal.id));

      // Hide approval tokens from POC — they only see status
      const departments = rows
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((d) => ({
          id: d.id,
          departmentName: d.departmentName,
          contactName: d.contactName,
          contactEmail: d.contactEmail,
          description: d.description,
          status: d.status,
          addedBy: d.addedBy,
          approvedAt: d.approvedAt?.toISOString() || null,
          approverName: d.approverName,
          approverNotes: d.approverNotes,
          emailSentAt: d.emailSentAt?.toISOString() || null,
        }));

      return res.json({
        departments,
        multiDepartment: proposal.multiDepartment,
        approvalRouting: proposal.approvalRouting,
      });
    } catch (err) {
      log.error("Departments error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── Forward to departments ───────────────────────────────────────────────────

/** POST /api/proposals/public/:token/departments/forward — POC adds & sends to dept contacts */
publicProposalApprovalsRouter.post(
  "/api/proposals/public/:token/departments/forward",
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) return res.status(404).json({ error: "Proposal not found" });

      const { proposal } = result;
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const { departments, origin } = req.body as {
        departments: Array<{
          name: string;
          contactName?: string;
          contactEmail: string;
          description?: string;
        }>;
        origin: string;
      };

      if (!departments || !Array.isArray(departments) || departments.length === 0) {
        return res.status(400).json({ error: "At least one department is required" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const dept of departments) {
        if (!dept?.name || typeof dept.name !== "string" || !dept.name.trim()) {
          return res.status(400).json({ error: "Department name is required" });
        }
        if (!dept?.contactEmail || !emailRegex.test(dept.contactEmail)) {
          return res.status(400).json({
            error: `Invalid email address for department "${dept.name}"`,
          });
        }
      }

      const existing = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, proposal.id));
      const maxSort = existing.reduce((max, d) => Math.max(max, d.sortOrder), -1);

      const { nanoid } = await import("nanoid");
      const { sendEmail } = await import("../../email/mailer");
      const { buildDepartmentApprovalEmail } = await import(
        "../../routers/departmentApprovals"
      );

      // Tier 3 — dept approval emails go to end users on the client side,
      // so they must be branded with the client's workstore / company.
      const forwardBranding = await loadClientBrandingForProposal(proposal.id);
      let sentCount = 0;

      for (let i = 0; i < departments.length; i++) {
        const dept = departments[i];
        if (!dept.contactEmail) continue;

        // Skip if this email already has an entry for this proposal
        const alreadyExists = existing.find(
          (e) => e.contactEmail?.toLowerCase() === dept.contactEmail.toLowerCase()
        );
        if (alreadyExists) continue;

        const approvalToken = nanoid(32);
        const tokenExpiresAt = proposal.approvalLinkExpiryEnabled
          ? new Date(Date.now() + 72 * 60 * 60 * 1000)
          : null;
        await db.insert(departmentApprovals).values({
          proposalId: proposal.id,
          departmentName: dept.name,
          contactName: dept.contactName || null,
          contactEmail: dept.contactEmail,
          description: dept.description || null,
          approvalToken,
          tokenExpiresAt,
          sortOrder: maxSort + 1 + i,
          addedBy: "poc",
        });

        const approvalUrl = `${origin}/approve/${approvalToken}`;
        const { subject, html } = buildDepartmentApprovalEmail({
          departmentName: dept.name,
          contactName: dept.contactName,
          proposalTitle: proposal.title,
          approvalUrl,
          branding: {
            logoUrl: forwardBranding.logoUrl,
            primaryColor: forwardBranding.primaryColor,
            companyName: forwardBranding.companyName,
          },
        });

        const emailResult = await sendEmail(
          dept.contactEmail,
          subject,
          html,
          forwardBranding.fromName,
          forwardBranding.replyTo
        );
        if (emailResult.sent) {
          sentCount++;
          const [inserted] = await db
            .select()
            .from(departmentApprovals)
            .where(eq(departmentApprovals.approvalToken, approvalToken))
            .limit(1);
          if (inserted) {
            await db
              .update(departmentApprovals)
              .set({ emailSentAt: new Date() })
              .where(eq(departmentApprovals.id, inserted.id));
          }
        }
      }

      const updatedRows = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, proposal.id));

      return res.json({
        success: true,
        sentCount,
        departments: updatedRows
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((d) => ({
            id: d.id,
            departmentName: d.departmentName,
            contactName: d.contactName,
            contactEmail: d.contactEmail,
            description: d.description,
            status: d.status,
            addedBy: d.addedBy,
            approvedAt: d.approvedAt?.toISOString() || null,
            approverName: d.approverName,
            emailSentAt: d.emailSentAt?.toISOString() || null,
          })),
      });
    } catch (err) {
      log.error("Forward error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── POST /api/proposals/public/:token/departments/remind ───────────────────
// POC resends the approval email to pending department approvers.
// Accepts optional `departmentId` to target a single row, or omits it to
// remind every pending row on the proposal.
publicProposalApprovalsRouter.post(
  "/api/proposals/public/:token/departments/remind",
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) return res.status(404).json({ error: "Proposal not found" });

      const { proposal } = result;
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const { departmentId, origin } = req.body as { departmentId?: number; origin: string };
      if (!origin) return res.status(400).json({ error: "origin is required" });

      const rows = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, proposal.id));

      const targets = rows.filter(
        (r) => r.status === "pending" && (!departmentId || r.id === departmentId)
      );
      if (targets.length === 0) {
        return res.json({ sent: 0, message: "No pending approvers to remind." });
      }

      const { sendEmail } = await import("../../email/mailer");
      const { buildDepartmentApprovalEmail } = await import(
        "../../routers/departmentApprovals"
      );
      const { nanoid } = await import("nanoid");
      // Tier 3 — reminders go to the same end-user approvers; use client branding.
      const branding = await loadClientBrandingForProposal(proposal.id);

      let sent = 0;
      for (const row of targets) {
        if (!row.contactEmail || !row.approvalToken) continue;
        // If the proposal has expiry enabled, refresh the token + expiry on
        // every remind so the recipient never opens a brand-new email that
        // points at an already-expired link.
        let tokenForUrl = row.approvalToken;
        if (proposal.approvalLinkExpiryEnabled) {
          tokenForUrl = nanoid(32);
          await db
            .update(departmentApprovals)
            .set({
              approvalToken: tokenForUrl,
              tokenExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
            })
            .where(eq(departmentApprovals.id, row.id));
        }
        const approvalUrl = `${origin}/approve/${tokenForUrl}`;
        const { subject, html } = buildDepartmentApprovalEmail({
          departmentName: row.departmentName,
          contactName: row.contactName ?? undefined,
          proposalTitle: proposal.title,
          approvalUrl,
          branding: {
            logoUrl: branding.logoUrl,
            primaryColor: branding.primaryColor,
            companyName: branding.companyName,
          },
          reminder: true,
        });
        const r = await sendEmail(row.contactEmail, subject, html, branding.fromName, branding.replyTo);
        if (r.sent) {
          sent++;
          await db
            .update(departmentApprovals)
            .set({ emailSentAt: new Date() })
            .where(eq(departmentApprovals.id, row.id));
        }
      }

      log.info(`Reminder sent to ${sent} pending approver(s) on proposal ${proposal.id}`);
      return res.json({ sent });
    } catch (err) {
      log.error("Reminder error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── Department approval page ─────────────────────────────────────────────────

/** GET /api/approve/:token — load department approval page data */
publicProposalApprovalsRouter.get("/api/approve/:token", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database unavailable" });

    const [approval] = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.approvalToken, req.params.token))
      .limit(1);

    if (!approval) {
      return res.status(404).json({ error: "Approval link not found" });
    }

    if (approval.tokenExpiresAt && approval.tokenExpiresAt.getTime() < Date.now()) {
      return res.status(410).json({
        error: "This approval link has expired. Please contact your distributor to resend.",
        expired: true,
      });
    }

    if (!approval.emailViewedAt) {
      await db
        .update(departmentApprovals)
        .set({ emailViewedAt: new Date() })
        .where(eq(departmentApprovals.id, approval.id));
    }

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, approval.proposalId))
      .limit(1);

    if (!proposal) return res.status(404).json({ error: "Proposal not found" });

    const ppRows = await db
      .select()
      .from(proposalProducts)
      .where(eq(proposalProducts.proposalId, proposal.id));

    const productRows =
      ppRows.length > 0
        ? await db.select().from(products).where(eq(products.userId, proposal.userId))
        : [];
    const productMap = new Map(productRows.map((p) => [p.id, p]));

    const productList = ppRows.map((pp) => {
      const prod = productMap.get(pp.productId);
      return {
        name: prod?.name || "Product",
        category: prod?.category || "other",
        quantity: pp.quantity ?? 1,
        unitPrice: pp.unitPrice?.toString() || prod?.basePrice?.toString() || null,
        imageUrl: prod?.imageUrl || null,
        decorationType: pp.decorationType || null,
      };
    });

    let branding = {
      logoUrl: null as string | null,
      primaryColor: "#654BF9",
      companyName: "Your Distributor",
    };
    try {
      const profileRows = await db
        .select()
        .from(distributorProfiles)
        .where(eq(distributorProfiles.userId, proposal.userId))
        .limit(1);
      if (profileRows.length > 0) {
        const profile = profileRows[0];
        branding = {
          logoUrl: profile.brandLogoUrl || null,
          primaryColor: profile.brandPrimaryColor || "#654BF9",
          companyName:
            profile.brandCompanyName || profile.companyName || "Your Distributor",
        };
      }
    } catch {
      /* ignore */
    }

    const allDepts = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposal.id));

    return res.json({
      approval: {
        id: approval.id,
        departmentName: approval.departmentName,
        contactName: approval.contactName,
        contactEmail: approval.contactEmail,
        description: approval.description,
        status: approval.status,
        approvedAt: approval.approvedAt?.toISOString() || null,
        approverName: approval.approverName,
        approverNotes: approval.approverNotes,
      },
      proposal: {
        title: proposal.title,
        proposalType: proposal.proposalType,
        estimatedValue: proposal.estimatedValue?.toString() || "0",
        notes: proposal.notes,
      },
      products: productList,
      branding,
      allDepartments: allDepts
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((d) => ({
          departmentName: d.departmentName,
          status: d.status,
          approvedAt: d.approvedAt?.toISOString() || null,
        })),
    });
  } catch (err) {
    log.error("Approval load error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/approve/:token — submit department approval or rejection */
publicProposalApprovalsRouter.post("/api/approve/:token", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database unavailable" });

    const [approval] = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.approvalToken, req.params.token))
      .limit(1);

    if (!approval) return res.status(404).json({ error: "Approval link not found" });

    if (approval.tokenExpiresAt && approval.tokenExpiresAt.getTime() < Date.now()) {
      return res.status(410).json({
        error: "This approval link has expired. Please contact your distributor to resend.",
        expired: true,
      });
    }

    if (approval.status !== "pending") {
      return res.status(400).json({
        error: "This department has already responded",
        currentStatus: approval.status,
      });
    }

    const { action, approverName, notes } = req.body as {
      action: "approved" | "rejected";
      approverName?: string;
      notes?: string;
    };

    if (!action || !["approved", "rejected"].includes(action)) {
      return res
        .status(400)
        .json({ error: "Invalid action. Must be 'approved' or 'rejected'" });
    }

    // Rejections must include a reason so the requester has actionable
    // feedback to rework the proposal. Approvals keep notes optional.
    if (action === "rejected" && (!notes || notes.trim().length === 0)) {
      return res.status(400).json({
        error: "A reason is required when rejecting. Please explain what needs to change.",
      });
    }

    await db
      .update(departmentApprovals)
      .set({
        status: action,
        approvedAt: new Date(),
        approverName: approverName || approval.contactName || null,
        approverNotes: notes || null,
      })
      .where(eq(departmentApprovals.id, approval.id));

    const [updated] = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.id, approval.id))
      .limit(1);

    // Audit: immutable record of the approval decision. Approver is not a
    // platform user — userId is null, actorEmail comes from the dept record.
    auditLog({
      action: action === "approved" ? "proposal.approval.approved" : "proposal.approval.rejected",
      userId: null,
      actorEmail: approval.contactEmail ?? undefined,
      ip: req.ip,
      resourceType: "proposal",
      resourceId: approval.proposalId,
      description: `${updated.departmentName} ${action} proposal #${approval.proposalId}`,
      metadata: {
        departmentApprovalId: updated.id,
        departmentName: updated.departmentName,
        approverName: updated.approverName,
        hasNotes: !!updated.approverNotes,
      },
    });

    // Notify the distributor of the department decision
    try {
      const [proposalRow] = await db
        .select({ id: proposals.id, title: proposals.title, userId: proposals.userId })
        .from(proposals)
        .where(eq(proposals.id, approval.proposalId))
        .limit(1);
      if (proposalRow) {
        const deptName = updated.departmentName || "A department";
        const responder = updated.approverName || "Someone";
        await notifyOwner({
          userId: proposalRow.userId,
          type: action === "approved" ? "approval_granted" : "approval_denied",
          title:
            action === "approved"
              ? `${deptName} approved your proposal`
              : `${deptName} declined your proposal`,
          content: `${responder} ${
            action === "approved" ? "approved" : "rejected"
          } the "${deptName}" section of proposal "${proposalRow.title}".`,
          actionPath: `/proposals/${proposalRow.id}`,
          actionLabel: "View Proposal",
          entityId: proposalRow.id,
          entityType: "proposal",
        });
      }
    } catch {
      /* non-critical */
    }

    return res.json({
      success: true,
      approval: {
        id: updated.id,
        departmentName: updated.departmentName,
        status: updated.status,
        approvedAt: updated.approvedAt?.toISOString() || null,
        approverName: updated.approverName,
        approverNotes: updated.approverNotes,
      },
    });
  } catch (err) {
    log.error("Approval submit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Re-approval ──────────────────────────────────────────────────────────────

/** POST /api/proposals/public/:token/request-reapproval — POC requests re-approval */
publicProposalApprovalsRouter.post(
  "/api/proposals/public/:token/request-reapproval",
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) return res.status(404).json({ error: "Proposal not found" });

      const { proposal } = result;
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const { departmentIds, changeNotes, origin } = req.body as {
        departmentIds: number[];
        changeNotes?: string;
        origin: string;
      };

      if (
        !departmentIds ||
        !Array.isArray(departmentIds) ||
        departmentIds.length === 0
      ) {
        return res
          .status(400)
          .json({ error: "At least one department must be selected" });
      }

      const deptRows = await db
        .select()
        .from(departmentApprovals)
        .where(
          and(
            eq(departmentApprovals.proposalId, proposal.id),
            inArray(departmentApprovals.id, departmentIds)
          )
        );

      if (deptRows.length === 0) {
        return res.status(404).json({ error: "No matching departments found" });
      }

      const { nanoid } = await import("nanoid");
      const { sendEmail } = await import("../../email/mailer");
      const { buildDepartmentApprovalEmail } = await import(
        "../../routers/departmentApprovals"
      );

      // Tier 3 — re-approval emails go to the same end-user approvers.
      const reapprovalBranding = await loadClientBrandingForProposal(proposal.id);
      let sentCount = 0;

      for (const dept of deptRows) {
        const newToken = nanoid(32);
        await db
          .update(departmentApprovals)
          .set({
            status: "pending",
            approvalToken: newToken,
            approvedAt: null,
            approverName: null,
            approverNotes: null,
            emailViewedAt: null,
          })
          .where(eq(departmentApprovals.id, dept.id));

        auditLog({
          action: "proposal.approval.reapproval_requested",
          userId: null,
          actorEmail: dept.contactEmail ?? undefined,
          ip: req.ip,
          resourceType: "proposal",
          resourceId: proposal.id,
          description: `Re-approval requested for ${dept.departmentName} on proposal #${proposal.id}`,
          metadata: {
            departmentApprovalId: dept.id,
            departmentName: dept.departmentName,
            changeNotes: changeNotes ?? null,
            previousStatus: dept.status,
          },
        });

        if (dept.contactEmail) {
          const approvalUrl = `${origin}/approve/${newToken}`;
          const { subject, html } = buildDepartmentApprovalEmail({
            departmentName: dept.departmentName,
            contactName: dept.contactName || undefined,
            proposalTitle:
              proposal.title + (changeNotes ? ` (Updated: ${changeNotes})` : " (Updated)"),
            approvalUrl,
            branding: {
              logoUrl: reapprovalBranding.logoUrl,
              primaryColor: reapprovalBranding.primaryColor,
              companyName: reapprovalBranding.companyName,
            },
          });

          const emailResult = await sendEmail(
            dept.contactEmail,
            subject,
            html,
            reapprovalBranding.fromName,
            reapprovalBranding.replyTo
          );
          if (emailResult.sent) {
            sentCount++;
            await db
              .update(departmentApprovals)
              .set({ emailSentAt: new Date() })
              .where(eq(departmentApprovals.id, dept.id));
          }
        }
      }

      // Notify distributor
      try {
        const [distributor] = await db
          .select()
          .from(users)
          .where(eq(users.id, proposal.userId))
          .limit(1);
        const [client] = await db
          .select()
          .from(clients)
          .where(eq(clients.id, proposal.clientId))
          .limit(1);
        if (distributor?.email) {
          const { sendEmail: sendNotif } = await import("../../email/mailer");
          const notifBranding = await loadBrandingForProposal(proposal.userId);
          await sendNotif(
            distributor.email,
            `Re-Approval Requested — ${proposal.title}`,
            `<div style="font-family:sans-serif;padding:20px;">
              <h2 style="color:${notifBranding.primaryColor};">Re-Approval Requested</h2>
              <p><strong>${client?.contactName || "Client"}</strong> has requested re-approval from ${deptRows.length} department(s) on:</p>
              <div style="background:#F5F3FF;padding:16px;border-radius:8px;margin:16px 0;">
                <p style="margin:0;font-weight:600;color:${notifBranding.primaryColor};">${proposal.title}</p>
                <p style="margin:8px 0 0;font-size:13px;color:#6B7280;">Departments: ${deptRows.map((d) => d.departmentName).join(", ")}</p>
                ${changeNotes ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">Change notes: ${changeNotes}</p>` : ""}
              </div>
              <p style="font-size:13px;color:#6B7280;">The selected departments have been reset to pending and notified.</p>
            </div>`,
            notifBranding.companyName
          );
        }
      } catch (e) {
        log.info("Could not notify distributor of re-approval:", e);
      }

      const updatedDepts = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, proposal.id));

      return res.json({
        success: true,
        sentCount,
        resetCount: deptRows.length,
        departments: updatedDepts
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((d) => ({
            id: d.id,
            departmentName: d.departmentName,
            contactName: d.contactName,
            contactEmail: d.contactEmail,
            description: d.description,
            status: d.status,
            addedBy: d.addedBy,
            approvedAt: d.approvedAt?.toISOString() || null,
            approverName: d.approverName,
            approverNotes: d.approverNotes,
            emailSentAt: d.emailSentAt?.toISOString() || null,
          })),
      });
    } catch (err) {
      log.error("Re-approval error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
