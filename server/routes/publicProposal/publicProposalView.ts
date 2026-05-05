/**
 * publicProposalView.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only public proposal view routes (no authentication required):
 *
 *   GET /api/proposals/public/:token            — full proposal data
 *   GET /api/proposals/public/:token/product/:productId — single product detail
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { getLogger } from "../../utils/logger";
import { loadProposalByToken } from "./publicProposalHelpers";

const log = getLogger("publicProposalView");
export const publicProposalViewRouter = Router();

/** GET /api/proposals/public/:token — fetch full proposal data */
publicProposalViewRouter.get("/api/proposals/public/:token", async (req, res) => {
  try {
    const result = await loadProposalByToken(req.params.token);
    if (!result) {
      return res.status(404).json({ error: "Proposal not found or link has expired" });
    }

    const { proposal, client, productList, branding, orderItems } = result;

    // Expiration check
    let isExpired = false;
    let expiresAt: string | null = null;
    if (proposal.validDays > 0 && proposal.sentAt) {
      const expDate = new Date(proposal.sentAt);
      expDate.setDate(expDate.getDate() + proposal.validDays);
      expiresAt = expDate.toISOString();
      isExpired = new Date() > expDate;
    }

    return res.json({
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      proposalType: proposal.proposalType,
      estimatedValue: proposal.estimatedValue?.toString() || "0",
      validDays: proposal.validDays,
      sentAt: proposal.sentAt?.toISOString() || null,
      expiresAt,
      isExpired,
      notes: proposal.notes,
      // Feature flags
      stripeCheckout: proposal.stripeCheckout,
      multiDepartment: proposal.multiDepartment,
      approvalRouting: proposal.approvalRouting,
      virtualProofs: proposal.virtualProofs,
      deliveryMethod: proposal.deliveryMethod,
      fulfillmentRequestedAt: proposal.fulfillmentRequestedAt?.toISOString() || null,
      client: {
        companyName: client?.companyName || "Client",
        contactName: client?.contactName || "",
        contactEmail: client?.contactEmail || "",
        contactPhone: client?.contactPhone || "",
        address: client?.address || "",
      },
      products: productList,
      orderItems,
      branding,
    });
  } catch (err) {
    log.error("Proposal view error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/proposals/public/:token/product/:productId — single product detail */
publicProposalViewRouter.get(
  "/api/proposals/public/:token/product/:productId",
  async (req, res) => {
    try {
      const result = await loadProposalByToken(req.params.token);
      if (!result) {
        return res.status(404).json({ error: "Proposal not found or link has expired" });
      }

      const { proposal, productList, branding } = result;
      const productId = parseInt(req.params.productId, 10);

      const product = productList.find(
        (p) => p.productId === productId || p.id === productId
      );
      if (!product) {
        return res.status(404).json({ error: "Product not found in this proposal" });
      }

      let isExpired = false;
      if (proposal.validDays > 0 && proposal.sentAt) {
        const expDate = new Date(proposal.sentAt);
        expDate.setDate(expDate.getDate() + proposal.validDays);
        isExpired = new Date() > expDate;
      }

      return res.json({
        proposalTitle: proposal.title,
        proposalType: proposal.proposalType,
        isExpired,
        branding,
        product: {
          ...product,
          relatedProducts: productList
            .filter((p) => p.productId !== product.productId)
            .map((p) => ({
              productId: p.productId,
              name: p.name,
              category: p.category,
              imageUrl: p.imageUrl,
              unitPrice: p.unitPrice,
              quantity: p.quantity,
            })),
        },
      });
    } catch (err) {
      log.error("Product detail error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
