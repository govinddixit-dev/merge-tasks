/**
 * storeApproval.ts
 * 
 * Token-gated REST routes for the client store approval flow.
 * No authentication required — all endpoints are gated by a unique token
 * that is embedded in the approval email link.
 *
 * GET  /api/store-approval/:token                  — load store preview data
 * POST /api/store-approval/:token                  — client approves the store
 * POST /api/store-approval/:token/request-changes  — client requests revisions
 */
import { Router } from "express";
import { getDb } from "../db";
import { stores, distributorProfiles, clients, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { getLogger } from "../utils/logger";

const log = getLogger("storeApproval");
export const storeApprovalRouter = Router();

// 
// GET /api/store-approval/:token
// Returns store + branding data for the client-facing approval page.
// 
storeApprovalRouter.get("/api/store-approval/:token", async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 10) return res.status(400).json({ error: "Invalid token" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    const [store] = await db.select().from(stores)
      .where(eq(stores.approvalToken!, token)).limit(1);
    if (!store) return res.status(404).json({ error: "Approval link not found" });
    if (store.approvalExpiresAt && store.approvalExpiresAt < new Date()) {
      return res.status(410).json({ error: "This approval link has expired" });
    }

    const [profile] = await db.select().from(distributorProfiles)
      .where(eq(distributorProfiles.userId, store.userId)).limit(1);
    const [client] = await db.select().from(clients)
      .where(eq(clients.id, store.clientId)).limit(1);

    return res.json({
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
        welcomeMessage: store.welcomeMessage,
        approvalClientName: store.approvalClientName,
        approvalApprovedAt: store.approvalApprovedAt
          ? new Date(store.approvalApprovedAt).toISOString() : null,
        approvalNotes: store.approvalNotes,
        approvalExpiresAt: store.approvalExpiresAt
          ? new Date(store.approvalExpiresAt).toISOString() : null,
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
    });
  } catch (err) {
    log.error("Store approval GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 
// POST /api/store-approval/:token
// Client approves the store design (with optional name + notes).
// 
storeApprovalRouter.post("/api/store-approval/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { approverName, notes } = req.body as { approverName?: string; notes?: string };
    if (!token || token.length < 10) return res.status(400).json({ error: "Invalid token" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    const [store] = await db.select().from(stores)
      .where(eq(stores.approvalToken!, token)).limit(1);
    if (!store) return res.status(404).json({ error: "Approval link not found" });
    if (store.approvalExpiresAt && store.approvalExpiresAt < new Date()) {
      return res.status(410).json({ error: "This approval link has expired" });
    }
    if (store.approvalApprovedAt) {
      return res.json({ success: true, alreadyApproved: true });
    }

    const now = new Date();
    await db.update(stores).set({ approvalApprovedAt: now, approvalNotes: notes || null })
      .where(eq(stores.id, store.id));

    const [client] = await db.select().from(clients)
      .where(eq(clients.id, store.clientId)).limit(1);
    const [distUser] = await db.select().from(users)
      .where(eq(users.id, store.userId)).limit(1);
    const clientCompany = client?.companyName || store.name;
    const storeName = store.name;
    const displayApproverName = approverName || store.approvalClientName || "Your client";
    const origin = (req.headers.origin as string) || "";

    // In-app notification for distributor
    await notifyOwner({
      userId: store.userId,
      organizationId: store.organizationId || undefined,
      type: "approval_granted",
      title: `${clientCompany}'s store has been approved`,
      content: `${displayApproverName} has approved the "${storeName}" store design. It's ready to launch whenever you are.`,
      actionPath: `/store-preview/${store.id}`,
      actionLabel: "Launch Store",
      entityId: store.id,
      entityType: "store",
    });

    // Tier 2 — Distributor → Client (approval notification to distributor, distributor-branded)
    if (distUser?.email) {
      const { sendEmail } = await import("../email/mailer");
      const { buildStoreApprovedEmail } = await import("../email/emailTemplates");
      const { resolveTier2 } = await import("../email/brandingResolver");
      const tier2 = await resolveTier2({ distributorUserId: store.userId, organizationId: store.organizationId });
      const launchUrl = origin ? `${origin}/store-preview/${store.id}` : null;
      const { subject: distSubject, html: distHtml } = buildStoreApprovedEmail({
        distributorName: distUser.name || "there",
        clientCompany,
        storeName,
        approverName: displayApproverName,
        clientNotes: notes || null,
        launchUrl,
        branding: tier2.branding,
      });
      await sendEmail(distUser.email, distSubject, distHtml, tier2.fromName, tier2.replyTo);
    }

    return res.json({ success: true, alreadyApproved: false, approvedAt: now.toISOString() });
  } catch (err) {
    log.error("Store approval POST error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 
// POST /api/store-approval/:token/request-changes
// Client requests revisions — sets status to revision_requested.
// 
storeApprovalRouter.post("/api/store-approval/:token/request-changes", async (req, res) => {
  try {
    const { token } = req.params;
    const { approverName, notes } = req.body as { approverName?: string; notes?: string };
    if (!token || token.length < 10) return res.status(400).json({ error: "Invalid token" });
    if (!notes || !notes.trim()) return res.status(400).json({ error: "Please describe the changes you'd like made." });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    const [store] = await db.select().from(stores)
      .where(eq(stores.approvalToken!, token)).limit(1);
    if (!store) return res.status(404).json({ error: "Approval link not found" });
    if (store.approvalExpiresAt && store.approvalExpiresAt < new Date()) {
      return res.status(410).json({ error: "This approval link has expired" });
    }
    if (store.approvalApprovedAt) {
      return res.status(409).json({ error: "This store has already been approved and cannot be revised." });
    }

    // Set status to revision_requested and store the client's notes
    await db.update(stores).set({
      status: "revision_requested" as const,
      approvalNotes: notes.trim(),
    }).where(eq(stores.id, store.id));

    // Fetch distributor info for notification
    const [distUser] = await db.select().from(users)
      .where(eq(users.id, store.userId)).limit(1);
    const [client] = await db.select().from(clients)
      .where(eq(clients.id, store.clientId)).limit(1);
    const clientCompany = client?.companyName || store.name;
    const storeName = store.name;
    const displayApproverName = approverName || store.approvalClientName || "Your client";
    const origin = (req.headers.origin as string) || "";

    // In-app notification
    await notifyOwner({
      userId: store.userId,
      organizationId: store.organizationId || undefined,
      type: "approval_denied",
      title: `${clientCompany} requested changes to their store`,
      content: `${displayApproverName} has reviewed the "${storeName}" store and requested changes: "${notes.trim().slice(0, 120)}${notes.trim().length > 120 ? "…" : ""}"`,
      actionPath: `/store-preview/${store.id}`,
      actionLabel: "View Store",
      entityId: store.id,
      entityType: "store",
    });

    // Tier 2 — Distributor → Client (revision request notification, distributor-branded)
    if (distUser?.email) {
      const { sendEmail } = await import("../email/mailer");
      const { buildStoreChangesRequestedEmail } = await import("../email/emailTemplates");
      const { resolveTier2 } = await import("../email/brandingResolver");
      const tier2 = await resolveTier2({ distributorUserId: store.userId, organizationId: store.organizationId });
      const editUrl = origin ? `${origin}/store-preview/${store.id}` : null;
      const { subject: distSubject, html: distHtml } = buildStoreChangesRequestedEmail({
        distributorName: distUser.name || "there",
        clientCompany,
        storeName,
        approverName: displayApproverName,
        notes: notes.trim(),
        editUrl,
        branding: tier2.branding,
      });
      await sendEmail(distUser.email, distSubject, distHtml, tier2.fromName, tier2.replyTo);
    }

    return res.json({ success: true, requestedAt: new Date().toISOString() });
  } catch (err) {
    log.error("Store revision request POST error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
