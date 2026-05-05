/**
 * Store Portal — Proposals sub-router.
 *
 * POC-facing proposal procedures: list, getById, forwardToDepartments,
 * requestFulfillment, overrideFulfillment, editProducts, decline.
 */
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import {
  proposals,
  proposalProducts,
  products,
  departmentApprovals,
  distributorProfiles,
  virtualProofs,
  users,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getLogger } from "../utils/logger";
import { notifyOwner } from "../_core/notification";
import { onProposalAccepted } from "../utils/agentTriggers";
import { buildFulfillmentApprovedEmail, buildEmailHtml } from "../email/emailTemplates";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";

const log = getLogger("storePortal:proposals");

export const storePortalProposalsRouter = router({
  list: publicProcedure
    .input(storeSlugInput.extend({
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { db, store } = await resolveStoreSession(ctx, input.storeSlug);

      let allProposals = await db
        .select()
        .from(proposals)
        .where(eq(proposals.clientId, store.clientId));

      if (input.status) {
        allProposals = allProposals.filter(p => p.status === input.status);
      }

      // Enrich with department approval counts
      const proposalIds = allProposals.map(p => p.id);
      let deptMap = new Map<number, { total: number; approved: number; rejected: number; pending: number }>();

      if (proposalIds.length > 0) {
        const deptRows = await db
          .select()
          .from(departmentApprovals)
          .where(sql`${departmentApprovals.proposalId} IN (${sql.join(proposalIds.map(id => sql`${id}`), sql`, `)})`);

        for (const d of deptRows) {
          const existing = deptMap.get(d.proposalId) || { total: 0, approved: 0, rejected: 0, pending: 0 };
          existing.total++;
          if (d.status === "approved") existing.approved++;
          else if (d.status === "rejected") existing.rejected++;
          else existing.pending++;
          deptMap.set(d.proposalId, existing);
        }
      }

      // Get product counts per proposal
      const ppRows = proposalIds.length > 0
        ? await db
            .select()
            .from(proposalProducts)
            .where(sql`${proposalProducts.proposalId} IN (${sql.join(proposalIds.map(id => sql`${id}`), sql`, `)})`)
        : [];
      const productCountMap = new Map<number, number>();
      for (const pp of ppRows) {
        productCountMap.set(pp.proposalId, (productCountMap.get(pp.proposalId) || 0) + 1);
      }

      return allProposals
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
        .map(p => ({
          id: p.id,
          title: p.title,
          status: p.status,
          proposalType: p.proposalType,
          estimatedValue: p.estimatedValue?.toString() || "0",
          multiDepartment: p.multiDepartment,
          approvalRouting: p.approvalRouting,
          stripeCheckout: p.stripeCheckout,
          viewToken: p.viewToken,
          notes: p.notes,
          validDays: p.validDays,
          sentAt: p.sentAt?.toISOString() || null,
          viewedAt: p.viewedAt?.toISOString() || null,
          respondedAt: p.respondedAt?.toISOString() || null,
          fulfillmentRequestedAt: p.fulfillmentRequestedAt?.toISOString() || null,
          createdAt: p.createdAt?.toISOString() || null,
          productCount: productCountMap.get(p.id) || 0,
          departmentStatus: deptMap.get(p.id) || null,
        }));
    }),

  getById: publicProcedure
    .input(storeSlugInput.extend({ proposalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { db, store } = await resolveStoreSession(ctx, input.storeSlug);

      const [proposal] = await db
        .select()
        .from(proposals)
        .where(and(
          eq(proposals.id, input.proposalId),
          eq(proposals.clientId, store.clientId),
        ))
        .limit(1);

      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
      }

      // Get proposal products with full product details
      const ppRows = await db
        .select()
        .from(proposalProducts)
        .where(eq(proposalProducts.proposalId, proposal.id));

      const productIds = ppRows.map(pp => pp.productId);
      const productRows = productIds.length > 0
        ? await db
            .select()
            .from(products)
            .where(sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`)
        : [];
      const productMap = new Map(productRows.map(p => [p.id, p]));

      // Get virtual proofs
      const proofRows = await db
        .select()
        .from(virtualProofs)
        .where(eq(virtualProofs.proposalId, proposal.id));
      const proofByProduct = new Map(proofRows.map(p => [p.productId, p]));

      const productList = ppRows.map(pp => {
        const prod = productMap.get(pp.productId);
        const proof = proofByProduct.get(pp.productId);
        return {
          id: pp.id,
          productId: pp.productId,
          name: prod?.name || "Product",
          description: prod?.description || null,
          category: prod?.category || "other",
          sku: prod?.sku || null,
          quantity: pp.quantity ?? 1,
          unitPrice: pp.unitPrice?.toString() || prod?.basePrice?.toString() || null,
          decorationType: pp.decorationType || proof?.decorationMethod || null,
          decorationNotes: pp.decorationNotes || null,
          imageUrl: prod?.imageUrl || null,
          additionalImages: prod?.additionalImages || [],
          proofImageUrl: proof?.proofImageUrl || null,
          proofStatus: proof?.status || null,
        };
      });

      // Get department approvals
      const deptRows = await db
        .select()
        .from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, proposal.id));

      const departments = deptRows
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(d => ({
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
          sortOrder: d.sortOrder,
        }));

      // Load distributor branding
      let branding = {
        logoUrl: null as string | null,
        primaryColor: "#654BF9",
        companyName: "Your Distributor",
      };
      try {
        const [profile] = await db
          .select()
          .from(distributorProfiles)
          .where(eq(distributorProfiles.userId, store.userId))
          .limit(1);
        if (profile) {
          branding = {
            logoUrl: profile.brandLogoUrl || null,
            primaryColor: profile.brandPrimaryColor || "#654BF9",
            companyName: profile.brandCompanyName || profile.companyName || "Your Distributor",
          };
        }
      } catch (e) { /* ignore */ }

      // Check expiration
      let isExpired = false;
      let expiresAt: string | null = null;
      if (proposal.validDays > 0 && proposal.sentAt) {
        const expDate = new Date(proposal.sentAt);
        expDate.setDate(expDate.getDate() + proposal.validDays);
        expiresAt = expDate.toISOString();
        isExpired = new Date() > expDate;
      }

      return {
        id: proposal.id,
        title: proposal.title,
        status: proposal.status,
        proposalType: proposal.proposalType,
        estimatedValue: proposal.estimatedValue?.toString() || "0",
        multiDepartment: proposal.multiDepartment,
        approvalRouting: proposal.approvalRouting,
        stripeCheckout: proposal.stripeCheckout,
        virtualProofs: proposal.virtualProofs,
        viewToken: proposal.viewToken,
        notes: proposal.notes,
        validDays: proposal.validDays,
        sentAt: proposal.sentAt?.toISOString() || null,
        viewedAt: proposal.viewedAt?.toISOString() || null,
        respondedAt: proposal.respondedAt?.toISOString() || null,
        fulfillmentRequestedAt: proposal.fulfillmentRequestedAt?.toISOString() || null,
        expiresAt,
        isExpired,
        createdAt: proposal.createdAt?.toISOString() || null,
        products: productList,
        departments,
        branding,
      };
    }),

  // ── Proposal Actions (write back to distributor) ─────────────────────

  /** Forward proposal to department heads for approval */
  forwardToDepartments: publicProcedure
    .input(storeSlugInput.extend({
      proposalId: z.number(),
      departments: z.array(z.object({
        name: z.string(),
        contactName: z.string().optional(),
        contactEmail: z.string().email(),
        description: z.string().optional(),
      })).min(1),
      origin: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
      }

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), eq(proposals.clientId, store.clientId)))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const existing = await db.select().from(departmentApprovals)
        .where(eq(departmentApprovals.proposalId, proposal.id));
      const maxSort = existing.reduce((max, d) => Math.max(max, d.sortOrder), -1);

      const { nanoid } = await import("nanoid");
      const { sendEmail } = await import("../email/mailer");
      const { buildDepartmentApprovalEmail } = await import("./departmentApprovals");

      // Load distributor branding + store sender settings
      const [profile] = await db.select().from(distributorProfiles)
        .where(eq(distributorProfiles.userId, proposal.userId)).limit(1);
      const [distUser] = await db.select().from(users).where(eq(users.id, proposal.userId)).limit(1);
      const brandingFwd = {
        companyName: profile?.brandCompanyName || profile?.companyName || "Your Distributor",
        primaryColor: profile?.brandPrimaryColor || "#654BF9",
        logoUrl: profile?.brandLogoUrl || null,
      };
      const storeSenderName = store.senderName || brandingFwd.companyName;
      const storeSenderReplyTo = store.senderEmail || distUser?.email || undefined;

      let sentCount = 0;
      for (let i = 0; i < input.departments.length; i++) {
        const dept = input.departments[i];
        const alreadyExists = existing.find(
          e => e.contactEmail?.toLowerCase() === dept.contactEmail.toLowerCase()
        );
        if (alreadyExists) continue;

        const approvalToken = nanoid(32);
        await db.insert(departmentApprovals).values({
          proposalId: proposal.id,
          departmentName: dept.name,
          contactName: dept.contactName || null,
          contactEmail: dept.contactEmail,
          description: dept.description || null,
          approvalToken,
          sortOrder: maxSort + 1 + i,
          addedBy: "poc",
        });

        const approvalUrl = `${input.origin}/approve/${approvalToken}`;
        const { subject, html } = buildDepartmentApprovalEmail({
          departmentName: dept.name,
          contactName: dept.contactName,
          proposalTitle: proposal.title,
          approvalUrl,
          branding: { logoUrl: brandingFwd.logoUrl, primaryColor: brandingFwd.primaryColor, companyName: brandingFwd.companyName },
        });
        const emailResult = await sendEmail(dept.contactEmail, subject, html, storeSenderName, storeSenderReplyTo);
        if (emailResult.sent) {
          sentCount++;
          const [inserted] = await db.select().from(departmentApprovals)
            .where(eq(departmentApprovals.approvalToken, approvalToken)).limit(1);
          if (inserted) {
            await db.update(departmentApprovals).set({ emailSentAt: new Date() })
              .where(eq(departmentApprovals.id, inserted.id));
          }
        }
      }

      // Enable multi-department on proposal if not already
      if (!proposal.multiDepartment) {
        await db.update(proposals).set({ multiDepartment: true }).where(eq(proposals.id, proposal.id));
      }

      return { success: true, sentCount };
    }),

  /** POC approves and requests fulfillment (all depts approved) */
  requestFulfillment: publicProcedure
    .input(storeSlugInput.extend({
      proposalId: z.number(),
      pocNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser, client } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
      }

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), eq(proposals.clientId, store.clientId)))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
      if (proposal.fulfillmentRequestedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Fulfillment already requested" });

      // Check all departments approved
      if (proposal.multiDepartment) {
        const depts = await db.select().from(departmentApprovals)
          .where(eq(departmentApprovals.proposalId, proposal.id));
        if (depts.length > 0) {
          const allApproved = depts.every(d => d.status === "approved");
          if (!allApproved) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Not all departments have approved. Use override to proceed." });
          }
        }
      }

      const clientComment = (input.pocNotes ?? "").trim() || null;
      await db.update(proposals).set({
        status: "accepted",
        fulfillmentRequestedAt: new Date(),
        respondedAt: new Date(),
        acceptanceComment: clientComment,
        notes: (proposal.notes || "") + `\n[Fulfillment Requested ${new Date().toISOString()}]: ${storeUser.name || client?.contactName || "POC"} approved and sent for fulfillment. ${input.pocNotes || ""}`,
      }).where(eq(proposals.id, proposal.id));

      // Agent: draft acceptance follow-up email (fire-and-forget, deduped).
      if (client?.contactEmail) {
        onProposalAccepted(
          proposal.id,
          proposal.organizationId ?? null,
          client.contactEmail,
          client.contactName,
          proposal.title,
        ).catch((err: unknown) => {
          log.warn("[trigger] onProposalAccepted (storePortal request) failed:", err);
        });
      }

      // Notify distributor via email + in-app notification
      try {
        const [distributor] = await db.select().from(users).where(eq(users.id, proposal.userId)).limit(1);
        const [distProfile] = await db.select().from(distributorProfiles).where(eq(distributorProfiles.userId, proposal.userId)).limit(1);
        const branding = distProfile ? {
          companyName: distProfile.brandCompanyName || distProfile.companyName || undefined,
          primaryColor: distProfile.brandPrimaryColor || undefined,
          logoUrl: distProfile.brandLogoUrl || undefined,
        } : undefined;

        if (distributor?.email) {
          const { sendEmail } = await import("../email/mailer");
          const { subject, html } = buildFulfillmentApprovedEmail({
            distributorName: branding?.companyName,
            pocName: storeUser.name || client?.contactName || "Client",
            clientCompany: client?.companyName || "N/A",
            proposalTitle: proposal.title,
            pocNotes: input.pocNotes,
            dashboardUrl: `https://app.mergetasks.com/proposals/${proposal.id}`,
            branding,
          });
          await sendEmail(distributor.email, subject, html, branding?.companyName || "MergeTasks", distributor.email);
        }

        const acceptedBy = storeUser.name || client?.contactName || client?.companyName || "Client";
        await notifyOwner({
          userId: proposal.userId,
          type: "proposal_approved",
          title: `${acceptedBy} accepted ${proposal.title}`,
          content: clientComment
            ? `Comment: ${clientComment}`
            : `${acceptedBy} approved the proposal and requested fulfillment.`,
          actionPath: `/proposals/${proposal.id}`,
          actionLabel: "Begin Fulfillment",
          entityId: proposal.id,
          entityType: "proposal",
        });
      } catch (e) { log.info("Could not notify distributor:", e); }

      return { success: true };
    }),

  /** POC overrides department approvals and sends directly to distributor */
  overrideFulfillment: publicProcedure
    .input(storeSlugInput.extend({
      proposalId: z.number(),
      overrideNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser, client } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
      }

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), eq(proposals.clientId, store.clientId)))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const overrideComment = (input.overrideNotes ?? "").trim() || null;
      await db.update(proposals).set({
        status: "accepted",
        fulfillmentRequestedAt: new Date(),
        respondedAt: new Date(),
        acceptanceComment: overrideComment,
        notes: (proposal.notes || "") + `\n[POC Override ${new Date().toISOString()}]: ${storeUser.name || "POC"} overrode department approvals. ${input.overrideNotes || ""}`,
      }).where(eq(proposals.id, proposal.id));

      // Agent: draft acceptance follow-up email (fire-and-forget, deduped).
      if (client?.contactEmail) {
        onProposalAccepted(
          proposal.id,
          proposal.organizationId ?? null,
          client.contactEmail,
          client.contactName,
          proposal.title,
        ).catch((err: unknown) => {
          log.warn("[trigger] onProposalAccepted (storePortal override) failed:", err);
        });
      }

      // Bell notification for the distributor — the override path previously
      // only sent an email, leaving nothing in the in-app notification tray.
      const overrideAcceptedBy = storeUser.name || client?.contactName || client?.companyName || "Client";
      await notifyOwner({
        userId: proposal.userId,
        type: "proposal_approved",
        title: `${overrideAcceptedBy} accepted ${proposal.title} (override)`,
        content: overrideComment
          ? `Comment: ${overrideComment}`
          : `${overrideAcceptedBy} overrode department approvals and requested fulfillment.`,
        actionPath: `/proposals/${proposal.id}`,
        actionLabel: "Begin Fulfillment",
        entityId: proposal.id,
        entityType: "proposal",
      });

      // Notify distributor via email + in-app notification
      try {
        const [distributor] = await db.select().from(users).where(eq(users.id, proposal.userId)).limit(1);
        const [distProfile] = await db.select().from(distributorProfiles).where(eq(distributorProfiles.userId, proposal.userId)).limit(1);
        const branding2 = distProfile ? {
          companyName: distProfile.brandCompanyName || distProfile.companyName || undefined,
          primaryColor: distProfile.brandPrimaryColor || undefined,
          logoUrl: distProfile.brandLogoUrl || undefined,
        } : undefined;
        if (distributor?.email) {
          const { sendEmail } = await import("../email/mailer");
          const depts = await db.select().from(departmentApprovals).where(eq(departmentApprovals.proposalId, proposal.id));
          const approved = depts.filter(d => d.status === "approved").length;
          const pending = depts.filter(d => d.status === "pending").length;
          const rejected = depts.filter(d => d.status === "rejected").length;
          const overrideHtml = buildEmailHtml({
            branding: branding2,
            badge: { text: "POC Override", color: "#D97706", bgColor: "#FFFBEB" },
            headline: "Fulfillment Request — Override",
            subheadline: `${storeUser.name || client?.contactName || "Client"} overrode department approvals`,
            bodyParagraphs: [
              `<strong>${storeUser.name || client?.contactName || "Client"}</strong> overrode department approvals for <strong>${proposal.title}</strong>.`,
              `Department status: ${approved} approved, ${pending} pending, ${rejected} rejected.`,
              ...(input.overrideNotes ? [`<strong>Override notes:</strong> ${input.overrideNotes}`] : []),
            ],
            infoCard: { title: proposal.title, subtitle: "Fulfillment override requested", accentColor: "#D97706", bgColor: "#FFFBEB" },
            cta: { label: "Review & Begin Fulfillment →", url: `https://app.mergetasks.com/proposals/${proposal.id}`, color: "#D97706" },
            alertBox: { text: "This override bypassed pending department approvals. Review the details before processing.", type: "warning" },
          });
          await sendEmail(
            distributor.email,
            `Fulfillment Request (Override) — ${proposal.title}`,
            overrideHtml,
            branding2?.companyName || "MergeTasks",
            distributor.email
          );
        }
      } catch (e) { log.info("Could not notify distributor of override:", e); }

      return { success: true };
    }),

  /** POC edits product quantities on a proposal */
  editProducts: publicProcedure
    .input(storeSlugInput.extend({
      proposalId: z.number(),
      edits: z.array(z.object({
        proposalProductId: z.number(),
        quantity: z.number().optional(),
        removed: z.boolean().optional(),
      })).min(1),
      editNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser, client } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
      }

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), eq(proposals.clientId, store.clientId)))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      let editCount = 0;
      for (const edit of input.edits) {
        const [existing] = await db.select({ id: proposalProducts.id }).from(proposalProducts)
          .where(and(eq(proposalProducts.id, edit.proposalProductId), eq(proposalProducts.proposalId, proposal.id)))
          .limit(1);
        if (!existing) continue;

        if (edit.removed) {
          await db.delete(proposalProducts).where(eq(proposalProducts.id, existing.id));
          editCount++;
        } else if (edit.quantity !== undefined && edit.quantity > 0) {
          await db.update(proposalProducts).set({ quantity: edit.quantity }).where(eq(proposalProducts.id, existing.id));
          editCount++;
        }
      }

      await db.update(proposals).set({
        notes: (proposal.notes || "") + `\n[POC Edit ${new Date().toISOString()}]: ${input.editNotes || "Product quantities updated"} (${editCount} changes)`,
      }).where(eq(proposals.id, proposal.id));

      // Notify distributor
      try {
        const [distributor] = await db.select().from(users).where(eq(users.id, proposal.userId)).limit(1);
        const [distProfileEdit] = await db.select().from(distributorProfiles).where(eq(distributorProfiles.userId, proposal.userId)).limit(1);
        const brandingEdit = distProfileEdit ? {
          companyName: distProfileEdit.brandCompanyName || distProfileEdit.companyName || undefined,
          primaryColor: distProfileEdit.brandPrimaryColor || undefined,
          logoUrl: distProfileEdit.brandLogoUrl || undefined,
        } : undefined;
        if (distributor?.email) {
          const { sendEmail } = await import("../email/mailer");
          const editHtml = buildEmailHtml({
            branding: brandingEdit,
            badge: { text: "Proposal Updated" },
            headline: "Proposal Edited by Client",
            subheadline: `${storeUser.name || client?.contactName || "Client"} made ${editCount} change(s)`,
            bodyParagraphs: [
              `<strong>${storeUser.name || client?.contactName || "Client"}</strong> from <strong>${client?.companyName || "N/A"}</strong> made ${editCount} change(s) to <strong>${proposal.title}</strong>.`,
              ...(input.editNotes ? [`<strong>Notes:</strong> ${input.editNotes}`] : []),
            ],
            infoCard: { title: proposal.title, subtitle: `${editCount} product change(s) made` },
            cta: { label: "Review Changes →", url: `https://app.mergetasks.com/proposals/${proposal.id}` },
          });
          await sendEmail(distributor.email, `Proposal Edited by Client — ${proposal.title}`, editHtml, brandingEdit?.companyName || "MergeTasks", distributor.email);
        }
        await notifyOwner({
          userId: proposal.userId,
          type: "proposal_viewed",
          title: `Proposal edited — ${proposal.title}`,
          content: `${storeUser.name || client?.contactName || "Client"} from ${client?.companyName || "N/A"} made ${editCount} change(s).${input.editNotes ? ` Notes: ${input.editNotes}` : ""}`,
          actionPath: `/proposals/${proposal.id}`,
          actionLabel: "Review Changes",
          entityId: proposal.id,
          entityType: "proposal",
        });
      } catch (e) { log.info("Could not notify distributor of edit:", e); }

      return { success: true, editCount };
    }),

  /** POC declines a proposal */
  decline: publicProcedure
    .input(storeSlugInput.extend({
      proposalId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser, client } = await resolveStoreSession(ctx, input.storeSlug);

      if (!["admin", "manager"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
      }

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.proposalId), eq(proposals.clientId, store.clientId)))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      await db.update(proposals).set({
        status: "declined",
        respondedAt: new Date(),
        notes: (proposal.notes || "") + `\n[Declined ${new Date().toISOString()}]: ${storeUser.name || "POC"} declined. ${input.reason || ""}`,
      }).where(eq(proposals.id, proposal.id));

      // Notify distributor
      try {
        const [distributor] = await db.select().from(users).where(eq(users.id, proposal.userId)).limit(1);
        const [distProfileDecline] = await db.select().from(distributorProfiles).where(eq(distributorProfiles.userId, proposal.userId)).limit(1);
        const brandingDecline = distProfileDecline ? {
          companyName: distProfileDecline.brandCompanyName || distProfileDecline.companyName || undefined,
          primaryColor: distProfileDecline.brandPrimaryColor || undefined,
          logoUrl: distProfileDecline.brandLogoUrl || undefined,
        } : undefined;
        if (distributor?.email) {
          const { sendEmail } = await import("../email/mailer");
          const declineHtml = buildEmailHtml({
            branding: brandingDecline,
            badge: { text: "Proposal Declined", color: "#DC2626", bgColor: "#FEF2F2" },
            headline: "Proposal Declined",
            subheadline: `${storeUser.name || client?.contactName || "Client"} from ${client?.companyName || "N/A"}`,
            bodyParagraphs: [
              `<strong>${storeUser.name || client?.contactName || "Client"}</strong> from <strong>${client?.companyName || "N/A"}</strong> has declined <strong>${proposal.title}</strong>.`,
              ...(input.reason ? [`<strong>Reason:</strong> ${input.reason}`] : []),
            ],
            infoCard: { title: proposal.title, subtitle: "Proposal declined", accentColor: "#DC2626", bgColor: "#FEF2F2" },
            cta: { label: "View Proposal →", url: `https://app.mergetasks.com/proposals/${proposal.id}`, color: "#DC2626" },
            alertBox: { text: "Consider following up with the client to understand their concerns and revise the proposal.", type: "info" },
          });
          await sendEmail(distributor.email, `Proposal Declined — ${proposal.title}`, declineHtml, brandingDecline?.companyName || "MergeTasks", distributor.email);
        }
        await notifyOwner({
          userId: proposal.userId,
          type: "proposal_declined",
          title: `Proposal declined — ${proposal.title}`,
          content: `${storeUser.name || client?.contactName || "Client"} from ${client?.companyName || "N/A"} declined the proposal.${input.reason ? ` Reason: ${input.reason}` : ""}`,
          actionPath: `/proposals/${proposal.id}`,
          actionLabel: "View Proposal",
          entityId: proposal.id,
          entityType: "proposal",
        });
      } catch (e) { log.info("Could not notify distributor of decline:", e); }

      return { success: true };
    }),
});
