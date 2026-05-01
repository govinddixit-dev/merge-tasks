/**
 * storesApproval — Client-facing store approval workflow.
 *
 * Procedures: sendForApproval, getByApprovalToken, approveByToken
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { stores, clients, distributorProfiles, users } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { notifyOwner } from "../_core/notification";
import { sendEmail } from "../email/mailer";
import { buildStoreApprovalRequestEmail, buildStoreApprovedEmail } from "../email/emailTemplates";
import { getOrgScope } from "../utils/orgScope";
import { getLogger } from "../utils/logger";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { STORE_APPROVAL_SEND_LIMIT } from "../utils/rateLimiter";

const log = getLogger("stores:approval");

const APPROVAL_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

export const storesApprovalRouter = router({
  /**
   * Send a store for client approval.
   * Generates a unique token, sets status to pending_approval, and emails the client
   * a branded (distributor) approval link.
   */
  sendForApproval: protectedProcedure
    .use(rateLimited("stores.sendForApproval", STORE_APPROVAL_SEND_LIMIT))
    .input(z.object({
      storeId: z.number(),
      clientEmail: z.string().email(),
      clientName: z.string().optional(),
      origin: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Enforce org-scope: distributor can only send approval for their own stores
      const [store] = await db.select().from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores)).limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const [profile] = await db.select().from(distributorProfiles)
        .where(eq(distributorProfiles.userId, ctx.user.id)).limit(1);
      const branding = {
        companyName: profile?.brandCompanyName || profile?.companyName || "Your Distributor",
        primaryColor: profile?.brandPrimaryColor || "#654BF9",
        logoUrl: profile?.brandLogoUrl || null,
      };

      const [client] = await db.select().from(clients)
        .where(eq(clients.id, store.clientId)).limit(1);
      const clientName = input.clientName || client?.contactName || "there";

      const token = nanoid(48);
      const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_MS);

      await db.update(stores).set({
        status: "pending_approval" as const,
        approvalToken: token,
        approvalClientEmail: input.clientEmail,
        approvalClientName: clientName,
        approvalSentAt: new Date(),
        approvalExpiresAt: expiresAt,
        approvalApprovedAt: null,
        approvalNotes: null,
      }).where(eq(stores.id, input.storeId));

      const approvalUrl = `${input.origin}/store-approval/${token}`;
      const storeName = store.name || client?.companyName || "Your Store";

      const { subject: clientSubject, html: clientHtml } = buildStoreApprovalRequestEmail({
        clientName,
        storeName,
        distributorName: branding.companyName,
        approvalUrl,
        branding,
      });

      const emailResult = await sendEmail(
        input.clientEmail,
        clientSubject,
        clientHtml,
        branding.companyName,
      );

      log.info(`Store approval email sent to ${input.clientEmail} for store ${input.storeId} — delivered: ${emailResult.sent}`);

      return {
        success: true,
        approvalUrl,
        emailDelivered: emailResult.sent,
        token,
        expiresAt: expiresAt.toISOString(),
      };
    }),

  /**
   * Get store data by approval token (public — no auth, token-gated).
   * Used by the client-facing approval page.
   */
  getByApprovalToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [store] = await db.select().from(stores)
        .where(eq(stores.approvalToken!, input.token)).limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Approval link not found or expired" });

      if (store.approvalExpiresAt && store.approvalExpiresAt < new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This approval link has expired" });
      }

      const [profile] = await db.select().from(distributorProfiles)
        .where(eq(distributorProfiles.userId, store.userId)).limit(1);
      const [client] = await db.select().from(clients)
        .where(eq(clients.id, store.clientId)).limit(1);

      return {
        store: {
          id: store.id,
          name: store.name,
          status: store.status,
          template: store.template,
          primaryColor: store.primaryColor,
          logoUrl: store.logoUrl,
          bannerUrl: store.bannerUrl,
          aiHeroHeadline: store.aiHeroHeadline,
          aiHeroSubtitle: store.aiHeroSubtitle,
          aiTagline: store.aiTagline,
          approvalClientName: store.approvalClientName,
          approvalApprovedAt: store.approvalApprovedAt?.toISOString() || null,
          approvalNotes: store.approvalNotes,
          approvalExpiresAt: store.approvalExpiresAt?.toISOString() || null,
        },
        branding: {
          companyName: profile?.brandCompanyName || profile?.companyName || "Your Distributor",
          primaryColor: profile?.brandPrimaryColor || "#654BF9",
          logoUrl: profile?.brandLogoUrl || null,
        },
        client: {
          companyName: client?.companyName || store.name,
          contactName: client?.contactName || null,
        },
      };
    }),

  /**
   * Client approves the store (public — token-gated, no auth).
   * Sets approvalApprovedAt, notifies the distributor in-app and via email.
   */
  approveByToken: publicProcedure
    .input(z.object({
      token: z.string(),
      approverName: z.string().optional(),
      notes: z.string().optional(),
      origin: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [store] = await db.select().from(stores)
        .where(eq(stores.approvalToken!, input.token)).limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Approval link not found" });
      if (store.approvalExpiresAt && store.approvalExpiresAt < new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This approval link has expired" });
      }
      if (store.approvalApprovedAt) {
        return { success: true, alreadyApproved: true };
      }

      const now = new Date();
      await db.update(stores).set({
        approvalApprovedAt: now,
        approvalNotes: input.notes || null,
      }).where(eq(stores.id, store.id));

      const [profile] = await db.select().from(distributorProfiles)
        .where(eq(distributorProfiles.userId, store.userId)).limit(1);
      const [client] = await db.select().from(clients)
        .where(eq(clients.id, store.clientId)).limit(1);
      const [distUser] = await db.select().from(users)
        .where(eq(users.id, store.userId)).limit(1);

      const clientCompany = client?.companyName || store.name;
      const storeName = store.name;
      const approverName = input.approverName || store.approvalClientName || "Your client";

      await notifyOwner({
        userId: store.userId,
        organizationId: store.organizationId || undefined,
        type: "approval_granted",
        title: `${clientCompany}'s store has been approved`,
        content: `${approverName} has approved the "${storeName}" store design. It's ready to launch whenever you are.`,
        actionPath: `/store-preview/${store.id}`,
        actionLabel: "Launch Store",
        entityId: store.id,
        entityType: "store",
      });

      if (distUser?.email) {
        const launchUrl = input.origin ? `${input.origin}/store-preview/${store.id}` : null;
        const { subject: distSubject, html: distHtml } = buildStoreApprovedEmail({
          distributorName: distUser.name || "there",
          clientCompany,
          storeName,
          approverName,
          clientNotes: input.notes || null,
          launchUrl,
        });
        await sendEmail(distUser.email, distSubject, distHtml, "MergeTasks");
      }

      return { success: true, alreadyApproved: false, approvedAt: now.toISOString() };
    }),
});
