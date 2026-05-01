import { STRIPE_API_VERSION } from "../../stripe/stripeVersion";
/**
 * publicProposalFulfillment.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POC-side proposal mutation routes (no authentication required):
 *
 *   POST /api/proposals/public/:token/checkout            — Stripe checkout session
 *   POST /api/proposals/public/:token/edit                — POC edits product quantities
 *   POST /api/proposals/public/:token/override-fulfillment — override dept approvals
 *   POST /api/proposals/public/:token/request-fulfillment  — send for fulfillment
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  proposals,
  proposalProducts,
  departmentApprovals,
  clients,
  users,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { ENV } from "../../_core/env";
import { getLogger } from "../../utils/logger";
import { loadProposalByToken } from "./publicProposalHelpers";
import { notifyOwner } from "../../_core/notification";
import { onProposalAccepted } from "../../utils/agentTriggers";
import { resolveTier2 } from "../../email/brandingResolver";
import { getStripe } from "../../stripe/stripeClient";
import { checkRateLimit, getClientIp, PUBLIC_CHECKOUT_LIMIT, PUBLIC_PROPOSAL_MUTATION_LIMIT } from "../../utils/rateLimiter";
import type { Request, Response, NextFunction } from "express";

const log = getLogger("publicProposalFulfillment");
export const publicProposalFulfillmentRouter = Router();

/** S19: Per-endpoint rate limiter middleware for public proposal routes */
function publicRateLimit(limitConfig: typeof PUBLIC_CHECKOUT_LIMIT, label: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req as any);
    try {
      const result = await checkRateLimit(`public:${label}:${ip}`, limitConfig);
      if (!result.allowed) {
        res.setHeader("Retry-After", Math.ceil(result.resetInMs / 1000).toString());
        return res.status(429).json({ error: result.message });
      }
      next();
    } catch {
      next(); // fail-open
    }
  };
}

// ─── Stripe Checkout ──────────────────────────────────────────────────────────

/** POST /api/proposals/public/:token/checkout — create Stripe checkout session */
publicProposalFulfillmentRouter.post(
  "/api/proposals/public/:token/checkout",
  publicRateLimit(PUBLIC_CHECKOUT_LIMIT, "checkout"),
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) return res.status(404).json({ error: "Proposal not found" });

      const { proposal, client, productList, branding } = result;

      if (!proposal.stripeCheckout) {
        return res
          .status(400)
          .json({ error: "Stripe checkout is not enabled for this proposal" });
      }

      if (proposal.validDays > 0 && proposal.sentAt) {
        const expDate = new Date(proposal.sentAt);
        expDate.setDate(expDate.getDate() + proposal.validDays);
        if (new Date() > expDate) {
          return res.status(400).json({ error: "This proposal has expired" });
        }
      }

      if (!ENV.stripeSecretKey) {
        return res.status(500).json({ error: "Payment processing is not configured" });
      }

      const stripe = getStripe();

      const selectedIds: number[] =
        req.body.selectedProductIds || productList.map((p) => p.productId);
      const selectedProducts = productList.filter((p) =>
        selectedIds.includes(p.productId)
      );

      if (selectedProducts.length === 0) {
        return res.status(400).json({ error: "No products selected for checkout" });
      }

      const lineItems = selectedProducts.map((p) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: p.name,
            description: p.decorationType
              ? `Decoration: ${p.decorationType}`
              : undefined,
            images: p.proofImageUrl
              ? [p.proofImageUrl]
              : p.imageUrl
              ? [p.imageUrl]
              : undefined,
          },
          unit_amount: Math.round(parseFloat(p.unitPrice || "0") * 100),
        },
        quantity: p.quantity,
      }));

      const origin =
        req.body.origin ||
        req.headers.origin ||
        req.headers.referer?.replace(/\/[^/]*$/, "") ||
        "";
      const viewToken = req.params.token;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        success_url: `${origin}/view/proposal/${viewToken}?checkout=success`,
        cancel_url: `${origin}/view/proposal/${viewToken}?checkout=canceled`,
        allow_promotion_codes: true,
        customer_email: client?.contactEmail || undefined,
        client_reference_id: `proposal_${proposal.id}`,
        metadata: {
          proposal_id: proposal.id.toString(),
          proposal_title: proposal.title,
          client_name: client?.contactName || "",
          client_company: client?.companyName || "",
          distributor_company: branding.companyName || "Distributor",
        },
      });

      return res.json({ url: session.url });
    } catch (err: unknown) {
      // Audit fix #19: never leak internal Stripe or DB error messages to the public.
      // Log the full error server-side but return a generic message to the client.
      log.error("Checkout error:", err);
      // Surface Stripe-specific user-facing errors (e.g. card declined) but
      // suppress stack traces, API keys, and internal system details.
      const isStripeError = typeof err === "object" && err !== null && "type" in err;
      const safeMessage = isStripeError
        ? "Payment processing failed. Please try again or contact support."
        : "Failed to create checkout session. Please try again.";
      return res.status(500).json({ error: safeMessage });
    }
  }
);

// ─── POC Edit ─────────────────────────────────────────────────────────────────

/** POST /api/proposals/public/:token/edit — POC edits product quantities/selections */
publicProposalFulfillmentRouter.post(
  "/api/proposals/public/:token/edit",
  publicRateLimit(PUBLIC_PROPOSAL_MUTATION_LIMIT, "edit"),
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) return res.status(404).json({ error: "Proposal not found" });

      const { proposal } = result;
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const { edits, editNotes } = req.body as {
        edits: Array<{
          proposalProductId: number;
          quantity?: number;
          removed?: boolean;
        }>;
        editNotes?: string;
      };

      if (!edits || !Array.isArray(edits) || edits.length === 0) {
        return res.status(400).json({ error: "No edits provided" });
      }

      let editCount = 0;
      for (const edit of edits) {
        // Verify the proposalProduct belongs to this proposal before mutating
        const [existing] = await db
          .select({ id: proposalProducts.id })
          .from(proposalProducts)
          .where(
            and(
              eq(proposalProducts.id, edit.proposalProductId),
              eq(proposalProducts.proposalId, proposal.id)
            )
          )
          .limit(1);

        if (!existing) continue;

        if (edit.removed) {
          await db
            .delete(proposalProducts)
            .where(eq(proposalProducts.id, existing.id));
          editCount++;
        } else if (edit.quantity !== undefined && edit.quantity > 0) {
          await db
            .update(proposalProducts)
            .set({ quantity: edit.quantity })
            .where(eq(proposalProducts.id, existing.id));
          editCount++;
        }
      }

      // Append edit history to proposal notes
      const editTimestamp = new Date().toISOString();
      const existingNotes = proposal.notes || "";
      const editEntry = `\n[POC Edit ${editTimestamp}]: ${
        editNotes || "Product quantities/selections updated"
      } (${editCount} changes)`;
      await db
        .update(proposals)
        .set({ notes: existingNotes + editEntry })
        .where(eq(proposals.id, proposal.id));

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
          const { sendEmail } = await import("../../email/mailer");
          const resolved = await resolveTier2({ distributorUserId: proposal.userId });
          const primaryColor = resolved.branding.primaryColor || "#654BF9";
          await sendEmail(
            distributor.email,
            `Proposal Edited by Client — ${proposal.title}`,
            `<div style="font-family:sans-serif;padding:20px;">
              <h2 style="color:${primaryColor};">Proposal Edited by Client</h2>
              <p><strong>${client?.contactName || "Client"}</strong> from <strong>${
              client?.companyName || "N/A"
            }</strong> has made changes to:</p>
              <div style="background:#F5F3FF;padding:16px;border-radius:8px;margin:16px 0;">
                <p style="margin:0;font-weight:600;color:${primaryColor};">${
              proposal.title
            }</p>
                <p style="margin:8px 0 0;font-size:13px;color:#6B7280;">${editCount} product change(s)</p>
                ${
                  editNotes
                    ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">Notes: ${editNotes}</p>`
                    : ""
                }
              </div>
              <p style="font-size:13px;color:#6B7280;">Log in to your dashboard to review the changes.</p>
              <div style="text-align:center;padding:20px 0 10px;border-top:1px solid #e5e7eb;margin-top:30px;">
                <span style="color:#9ca3af;font-size:12px;">Powered by <a href="https://mergetasks.com" style="color:#6b7280;text-decoration:none;font-weight:500;">MergeTasks</a></span>
              </div>
            </div>`,
            resolved.fromName,
            resolved.replyTo
          );
        }
      } catch (e) {
        log.info("Could not notify distributor of edit:", e);
      }

      const updatedResult = await loadProposalByToken(req.params.token);
      return res.json({
        success: true,
        editCount,
        products: updatedResult?.productList || [],
      });
    } catch (err) {
      log.error("Edit error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── Override Fulfillment ─────────────────────────────────────────────────────

/** POST /api/proposals/public/:token/override-fulfillment — POC overrides dept approvals */
publicProposalFulfillmentRouter.post(
  "/api/proposals/public/:token/override-fulfillment",
  publicRateLimit(PUBLIC_PROPOSAL_MUTATION_LIMIT, "override"),
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) return res.status(404).json({ error: "Proposal not found" });

      const { proposal, client } = result;
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const { overrideNotes, pocName } = req.body as {
        overrideNotes?: string;
        pocName?: string;
      };

      const overrideClientComment = (overrideNotes ?? "").trim() || null;
      await db
        .update(proposals)
        .set({
          status: "accepted",
          fulfillmentRequestedAt: new Date(),
          respondedAt: new Date(),
          acceptanceComment: overrideClientComment,
          notes:
            (proposal.notes || "") +
            `\n[POC Override ${new Date().toISOString()}]: ${
              pocName || client?.contactName || "POC"
            } overrode department approvals. ${overrideNotes || "No notes provided."}`,
        })
        .where(eq(proposals.id, proposal.id));

      // Agent: draft acceptance follow-up email (fire-and-forget, deduped).
      if (client?.contactEmail) {
        onProposalAccepted(
          proposal.id,
          proposal.organizationId ?? null,
          client.contactEmail,
          client.contactName,
          proposal.title,
        ).catch((err: unknown) => {
          log.warn("[trigger] onProposalAccepted (override) failed:", err);
        });
      }

      // Bell notification for the distributor — mirrors the email body so a
      // distributor who misses the email still sees the acceptance and any
      // comment in-app.
      const overrideAcceptedBy =
        pocName || client?.contactName || client?.companyName || "Client";
      await notifyOwner({
        userId: proposal.userId,
        organizationId: proposal.organizationId ?? undefined,
        type: "proposal_approved",
        title: `${overrideAcceptedBy} accepted ${proposal.title} (override)`,
        content: overrideClientComment
          ? `Comment: ${overrideClientComment}`
          : `${overrideAcceptedBy} overrode department approvals and requested fulfillment.`,
        actionPath: `/proposals/${proposal.id}`,
        actionLabel: "View Proposal",
        entityId: proposal.id,
        entityType: "proposal",
      });

      // Notify distributor
      try {
        const [distributor] = await db
          .select()
          .from(users)
          .where(eq(users.id, proposal.userId))
          .limit(1);
        if (distributor?.email) {
          const { sendEmail } = await import("../../email/mailer");
          const resolved = await resolveTier2({ distributorUserId: proposal.userId });
          const primaryColor = resolved.branding.primaryColor || "#654BF9";

          const depts = await db
            .select()
            .from(departmentApprovals)
            .where(eq(departmentApprovals.proposalId, proposal.id));
          const approved = depts.filter((d) => d.status === "approved").length;
          const pending = depts.filter((d) => d.status === "pending").length;
          const rejected = depts.filter((d) => d.status === "rejected").length;

          await sendEmail(
            distributor.email,
            `Fulfillment Request (Override) — ${proposal.title}`,
            `<div style="font-family:sans-serif;padding:20px;">
              <h2 style="color:${primaryColor};">Fulfillment Request — Override</h2>
              <p><strong>${pocName || client?.contactName || "Client"}</strong> from <strong>${
              client?.companyName || "N/A"
            }</strong> has overridden department approvals and is requesting fulfillment for:</p>
              <div style="background:#FEF3C7;padding:16px;border-radius:8px;margin:16px 0;border-left:4px solid #F59E0B;">
                <p style="margin:0;font-weight:600;color:#92400E;">Override — Not all departments approved</p>
                <p style="margin:8px 0 0;font-size:13px;color:#78350F;">Approved: ${approved} | Pending: ${pending} | Rejected: ${rejected}</p>
              </div>
              <div style="background:#F5F3FF;padding:16px;border-radius:8px;margin:16px 0;">
                <p style="margin:0;font-weight:600;color:${primaryColor};">${
              proposal.title
            }</p>
                ${
                  overrideNotes
                    ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">Override notes: ${overrideNotes}</p>`
                    : ""
                }
              </div>
              <p style="font-size:13px;color:#6B7280;">Log in to your dashboard to review and begin fulfillment.</p>
              <div style="text-align:center;padding:20px 0 10px;border-top:1px solid #e5e7eb;margin-top:30px;">
                <span style="color:#9ca3af;font-size:12px;">Powered by <a href="https://mergetasks.com" style="color:#6b7280;text-decoration:none;font-weight:500;">MergeTasks</a></span>
              </div>
            </div>`,
            resolved.fromName,
            resolved.replyTo
          );
        }
      } catch (e) {
        log.info("Could not notify distributor of override:", e);
      }

      return res.json({
        success: true,
        message: "Fulfillment request sent to distributor (override)",
        fulfillmentRequestedAt: new Date().toISOString(),
      });
    } catch (err) {
      log.error("Override fulfillment error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── Request Fulfillment ──────────────────────────────────────────────────────

/** POST /api/proposals/public/:token/request-fulfillment — POC sends for fulfillment */
publicProposalFulfillmentRouter.post(
  "/api/proposals/public/:token/request-fulfillment",
  publicRateLimit(PUBLIC_PROPOSAL_MUTATION_LIMIT, "fulfillment"),
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) return res.status(404).json({ error: "Proposal not found" });

      const { proposal, client } = result;
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      if (proposal.fulfillmentRequestedAt) {
        return res.status(400).json({
          error: "Fulfillment has already been requested for this proposal",
        });
      }

      const { pocName, pocNotes } = req.body as {
        pocName?: string;
        pocNotes?: string;
      };

      // Verify all departments have approved (when multi-department is enabled)
      if (proposal.multiDepartment) {
        const depts = await db
          .select()
          .from(departmentApprovals)
          .where(eq(departmentApprovals.proposalId, proposal.id));

        if (depts.length > 0) {
          const allApproved = depts.every((d) => d.status === "approved");
          if (!allApproved) {
            const pending = depts.filter((d) => d.status === "pending");
            const rejected = depts.filter((d) => d.status === "rejected");
            // Distinguish rejected from pending so the POC sees the right
            // corrective action — rejection needs rework or re-approval,
            // not just waiting.
            const parts: string[] = [];
            if (rejected.length > 0) {
              parts.push(
                `${rejected.length} department${rejected.length === 1 ? "" : "s"} rejected (${rejected.map((d) => d.departmentName).join(", ")})`,
              );
            }
            if (pending.length > 0) {
              parts.push(
                `${pending.length} pending (${pending.map((d) => d.departmentName).join(", ")})`,
              );
            }
            return res.status(400).json({
              error: `Cannot submit for fulfillment — ${parts.join("; ")}. Use override if you want to proceed anyway.`,
              pendingDepartments: pending.map((d) => d.departmentName),
              rejectedDepartments: rejected.map((d) => d.departmentName),
            });
          }
        }
      }

      const clientComment = (pocNotes ?? "").trim() || null;
      await db
        .update(proposals)
        .set({
          status: "accepted",
          fulfillmentRequestedAt: new Date(),
          respondedAt: new Date(),
          acceptanceComment: clientComment,
          notes:
            (proposal.notes || "") +
            `\n[Fulfillment Requested ${new Date().toISOString()}]: ${
              pocName || client?.contactName || "POC"
            } approved and sent for fulfillment. ${pocNotes || ""}`,
        })
        .where(eq(proposals.id, proposal.id));

      // Agent: draft acceptance follow-up email (fire-and-forget, deduped).
      if (client?.contactEmail) {
        onProposalAccepted(
          proposal.id,
          proposal.organizationId ?? null,
          client.contactEmail,
          client.contactName,
          proposal.title,
        ).catch((err: unknown) => {
          log.warn("[trigger] onProposalAccepted (request-fulfillment) failed:", err);
        });
      }

      // Bell notification for the distributor — surfaces the acceptance and
      // the client's comment (if any) in the in-app notification tray.
      const acceptedBy =
        pocName || client?.contactName || client?.companyName || "Client";
      await notifyOwner({
        userId: proposal.userId,
        organizationId: proposal.organizationId ?? undefined,
        type: "proposal_approved",
        title: `${acceptedBy} accepted ${proposal.title}`,
        content: clientComment
          ? `Comment: ${clientComment}`
          : `${acceptedBy} approved the proposal and requested fulfillment.`,
        actionPath: `/proposals/${proposal.id}`,
        actionLabel: "View Proposal",
        entityId: proposal.id,
        entityType: "proposal",
      });

      // Notify distributor
      try {
        const [distributor] = await db
          .select()
          .from(users)
          .where(eq(users.id, proposal.userId))
          .limit(1);
        if (distributor?.email) {
          const { sendEmail } = await import("../../email/mailer");
          const resolved = await resolveTier2({ distributorUserId: proposal.userId });
          await sendEmail(
            distributor.email,
            `Fulfillment Approved — ${proposal.title}`,
            `<div style="font-family:sans-serif;padding:20px;">
              <h2 style="color:#059669;">Proposal Approved for Fulfillment</h2>
              <p><strong>${pocName || client?.contactName || "Client"}</strong> from <strong>${
              client?.companyName || "N/A"
            }</strong> has approved the proposal and is requesting fulfillment:</p>
              <div style="background:#ECFDF5;padding:16px;border-radius:8px;margin:16px 0;border-left:4px solid #059669;">
                <p style="margin:0;font-weight:600;color:#065F46;">${proposal.title}</p>
                <p style="margin:8px 0 0;font-size:13px;color:#047857;">All department approvals received</p>
                ${
                  pocNotes
                    ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">Notes: ${pocNotes}</p>`
                    : ""
                }
              </div>
              <p style="font-size:13px;color:#6B7280;">Log in to your dashboard to begin fulfillment.</p>
              <div style="text-align:center;padding:20px 0 10px;border-top:1px solid #e5e7eb;margin-top:30px;">
                <span style="color:#9ca3af;font-size:12px;">Powered by <a href="https://mergetasks.com" style="color:#6b7280;text-decoration:none;font-weight:500;">MergeTasks</a></span>
              </div>
            </div>`,
            resolved.fromName,
            resolved.replyTo
          );
        }
      } catch (e) {
        log.info("Could not notify distributor of fulfillment:", e);
      }

      return res.json({
        success: true,
        message: "Fulfillment request sent to distributor",
        fulfillmentRequestedAt: new Date().toISOString(),
      });
    } catch (err) {
      log.error("Fulfillment request error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
