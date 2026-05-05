/**
 * publicProposalOrderItems.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side catalog ordering routes (no authentication required):
 *
 *   POST   /api/proposals/public/:token/order-items        — add item
 *   PUT    /api/proposals/public/:token/order-items/:itemId — update item
 *   DELETE /api/proposals/public/:token/order-items/:itemId — remove item
 *   POST   /api/proposals/public/:token/order-items/bulk   — add multiple items
 *   DELETE /api/proposals/public/:token/order-items        — clear all items
 *   POST   /api/proposals/public/:token/submit-order       — submit order (creates order record)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  proposals,
  proposalProducts,
  proposalOrderItems,
  products,
  orders,
  orderItems,
  clients,
  users,
} from "../../../drizzle/schema";
import { getDb, getPool } from "../../db";
import { ENV } from "../../_core/env";
import { getLogger } from "../../utils/logger";
import { loadBrandingForProposal } from "./publicProposalHelpers";
import { onProposalAccepted } from "../../utils/agentTriggers";

const log = getLogger("publicProposalOrderItems");
export const publicProposalOrderItemsRouter = Router();

// ─── Order Item CRUD ──────────────────────────────────────────────────────────

/** POST /api/proposals/public/:token/order-items — add item to order list */
publicProposalOrderItemsRouter.post(
  "/api/proposals/public/:token/order-items",
  async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const proposalRows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.viewToken, req.params.token))
        .limit(1);
      if (proposalRows.length === 0)
        return res.status(404).json({ error: "Proposal not found" });
      const proposal = proposalRows[0];

      const {
        proposalProductId: rawPpId,
        productId,
        color,
        size,
        logoPosition,
        quantity,
        unitPrice,
        comment,
      } = req.body;

      if (!productId || !quantity) {
        return res.status(400).json({ error: "productId and quantity are required" });
      }

      // Resolve proposalProductId from productId if not provided
      let resolvedPpId = rawPpId || 0;
      if (!resolvedPpId) {
        const ppRows = await db
          .select({ id: proposalProducts.id })
          .from(proposalProducts)
          .where(
            and(
              eq(proposalProducts.proposalId, proposal.id),
              eq(proposalProducts.productId, productId)
            )
          )
          .limit(1);
        if (ppRows.length > 0) resolvedPpId = ppRows[0].id;
      }

      const result = await db.insert(proposalOrderItems).values({
        proposalId: proposal.id,
        proposalProductId: resolvedPpId,
        productId,
        color: color || null,
        size: size || null,
        logoPosition: logoPosition || null,
        quantity: parseInt(quantity),
        unitPrice: unitPrice || null,
        comment: comment || null,
      });

      const [created] = await db
        .select()
        .from(proposalOrderItems)
        .where(eq(proposalOrderItems.id, result[0].insertId))
        .limit(1);

      return res.json(created);
    } catch (err) {
      log.error("Add order item error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/** PUT /api/proposals/public/:token/order-items/:itemId — update order item */
publicProposalOrderItemsRouter.put(
  "/api/proposals/public/:token/order-items/:itemId",
  async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const itemId = parseInt(req.params.itemId);
      const proposalRows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.viewToken, req.params.token))
        .limit(1);
      if (proposalRows.length === 0)
        return res.status(404).json({ error: "Proposal not found" });
      const proposal = proposalRows[0];

      // Scope the update to this proposal's items only (prevents cross-proposal tampering)
      const [existingItem] = await db
        .select({ id: proposalOrderItems.id })
        .from(proposalOrderItems)
        .where(
          and(
            eq(proposalOrderItems.id, itemId),
            eq(proposalOrderItems.proposalId, proposal.id)
          )
        )
        .limit(1);
      if (!existingItem) return res.status(404).json({ error: "Order item not found" });

      const { color, size, logoPosition, quantity, unitPrice, comment } = req.body;
      const setObj: Record<string, unknown> = {};
      if (color !== undefined) setObj.color = color;
      if (size !== undefined) setObj.size = size;
      if (logoPosition !== undefined) setObj.logoPosition = logoPosition;
      if (quantity !== undefined) setObj.quantity = parseInt(quantity);
      if (unitPrice !== undefined) setObj.unitPrice = unitPrice;
      if (comment !== undefined) setObj.comment = comment;

      if (Object.keys(setObj).length > 0) {
        await db
          .update(proposalOrderItems)
          .set(setObj)
          .where(
            and(
              eq(proposalOrderItems.id, itemId),
              eq(proposalOrderItems.proposalId, proposal.id)
            )
          );
      }

      const [updated] = await db
        .select()
        .from(proposalOrderItems)
        .where(
          and(
            eq(proposalOrderItems.id, itemId),
            eq(proposalOrderItems.proposalId, proposal.id)
          )
        )
        .limit(1);
      return res.json(updated);
    } catch (err) {
      log.error("Update order item error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/** DELETE /api/proposals/public/:token/order-items/:itemId — remove single order item */
publicProposalOrderItemsRouter.delete(
  "/api/proposals/public/:token/order-items/:itemId",
  async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const itemId = parseInt(req.params.itemId);
      const proposalRows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.viewToken, req.params.token))
        .limit(1);
      if (proposalRows.length === 0)
        return res.status(404).json({ error: "Proposal not found" });
      const proposal = proposalRows[0];

      // Scope to this proposal's items only
      await db
        .delete(proposalOrderItems)
        .where(
          and(
            eq(proposalOrderItems.id, itemId),
            eq(proposalOrderItems.proposalId, proposal.id)
          )
        );
      return res.json({ success: true });
    } catch (err) {
      log.error("Delete order item error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/** POST /api/proposals/public/:token/order-items/bulk — add multiple items at once */
publicProposalOrderItemsRouter.post(
  "/api/proposals/public/:token/order-items/bulk",
  async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const proposalRows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.viewToken, req.params.token))
        .limit(1);
      if (proposalRows.length === 0)
        return res.status(404).json({ error: "Proposal not found" });
      const proposal = proposalRows[0];

      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items array is required" });
      }

      // Pre-load all proposalProducts to resolve productId → proposalProductId
      const ppRows = await db
        .select({ id: proposalProducts.id, productId: proposalProducts.productId })
        .from(proposalProducts)
        .where(eq(proposalProducts.proposalId, proposal.id));
      const ppMap = new Map(ppRows.map((pp) => [pp.productId, pp.id]));

      interface BulkOrderItemInput {
        proposalProductId?: number;
        productId: number;
        color?: string;
        size?: string;
        logoPosition?: string;
        quantity: string | number;
        unitPrice?: string;
        comment?: string;
      }

      const values = (items as BulkOrderItemInput[]).map((item) => ({
        proposalId: proposal.id,
        proposalProductId: item.proposalProductId || ppMap.get(item.productId) || 0,
        productId: item.productId,
        color: item.color || null,
        size: item.size || null,
        logoPosition: item.logoPosition || null,
        quantity: parseInt(String(item.quantity)),
        unitPrice: item.unitPrice || null,
        comment: item.comment || null,
      }));

      await db.insert(proposalOrderItems).values(values);

      const allItems = await db
        .select()
        .from(proposalOrderItems)
        .where(eq(proposalOrderItems.proposalId, proposal.id));

      return res.json(allItems);
    } catch (err) {
      log.error("Bulk add order items error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/** DELETE /api/proposals/public/:token/order-items — clear all order items */
publicProposalOrderItemsRouter.delete(
  "/api/proposals/public/:token/order-items",
  async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const proposalRows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.viewToken, req.params.token))
        .limit(1);
      if (proposalRows.length === 0)
        return res.status(404).json({ error: "Proposal not found" });

      await db
        .delete(proposalOrderItems)
        .where(eq(proposalOrderItems.proposalId, proposalRows[0].id));
      return res.json({ success: true });
    } catch (err) {
      log.error("Clear order items error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── Submit Order ─────────────────────────────────────────────────────────────

/** POST /api/proposals/public/:token/submit-order — submit order (creates order record) */
publicProposalOrderItemsRouter.post(
  "/api/proposals/public/:token/submit-order",
  async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });
      const pool = getPool();
      if (!pool) return res.status(500).json({ error: "Database pool unavailable" });

      const proposalRows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.viewToken, req.params.token))
        .limit(1);
      if (proposalRows.length === 0)
        return res.status(404).json({ error: "Proposal not found" });
      const proposal = proposalRows[0];

      // ── Concurrency guard (Issue 12) ──────────────────────────────────
      // Use SELECT ... FOR UPDATE inside a transaction to prevent double-submit.
      // If two concurrent requests hit this route, the second one will block
      // on the row lock until the first commits, then see status = 'accepted'
      // and bail out.
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Lock the proposal row — prevents concurrent submit-order
        const [lockedRows] = await conn.execute(
          `SELECT id, status FROM proposals WHERE id = ? FOR UPDATE`,
          [proposal.id]
        );
        const locked = (lockedRows as Array<{ id: number; status: string }>)[0];
        if (!locked) {
          await conn.rollback();
          conn.release();
          return res.status(404).json({ error: "Proposal not found" });
        }
        if (locked.status === "accepted") {
          await conn.rollback();
          conn.release();
          return res.status(409).json({ error: "Order already submitted for this proposal" });
        }

        // Release the connection — the rest uses the Drizzle ORM connection pool
        await conn.commit();
        conn.release();
      } catch (lockErr) {
        try { await conn.rollback(); } catch { /* ignore */ }
        conn.release();
        throw lockErr;
      }

      const orderItemRows = await db
        .select()
        .from(proposalOrderItems)
        .where(eq(proposalOrderItems.proposalId, proposal.id));

      if (orderItemRows.length === 0) {
        return res.status(400).json({ error: "No items in order list" });
      }

      const productIds = Array.from(
        new Set(orderItemRows.map((oi) => oi.productId))
      ) as number[];
      const productRows =
        productIds.length > 0
          ? await db.select().from(products).where(inArray(products.id, productIds))
          : [];
      const productMap = new Map(productRows.map((p) => [p.id, p]));

      const subtotal = orderItemRows.reduce((sum, oi) => {
        const price = parseFloat(oi.unitPrice?.toString() || "0");
        return sum + price * oi.quantity;
      }, 0);

      const { nanoid } = await import("nanoid");
      const orderNumber = `MT-${nanoid(8).toUpperCase()}`;

      const [orderResult] = await db
        .insert(orders)
        .values({
          userId: proposal.userId,
          organizationId: proposal.organizationId ?? null,
          clientId: proposal.clientId,
          proposalId: proposal.id,
          orderNumber,
          status: "pending",
          subtotal: subtotal.toFixed(2),
          tax: "0.00",
          shipping: "0.00",
          total: subtotal.toFixed(2),
          paymentMethod: "credit_card",
          notes: req.body.notes || null,
        })
        .$returningId();

      const orderId = orderResult.id;

      const orderItemValues = orderItemRows.map((oi) => {
        const price = parseFloat(oi.unitPrice?.toString() || "0");
        return {
          orderId,
          productId: oi.productId,
          quantity: oi.quantity,
          unitPrice: price.toFixed(2),
          totalPrice: (price * oi.quantity).toFixed(2),
          decorationType: null,
          size: oi.size || null,
          color: oi.color || null,
        };
      });

      if (orderItemValues.length > 0) {
        await db.insert(orderItems).values(orderItemValues);
      }

      await db
        .update(proposals)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(proposals.id, proposal.id));

      // Agent: draft acceptance follow-up email (fire-and-forget).
      // Wrapper dedups against its own 7-day window, so we don't need to worry
      // about the stripe webhook path firing this again after checkout completes.
      (async () => {
        try {
          const [clientRow] = await db
            .select({
              contactEmail: clients.contactEmail,
              contactName: clients.contactName,
            })
            .from(clients)
            .where(eq(clients.id, proposal.clientId))
            .limit(1);
          if (clientRow?.contactEmail) {
            await onProposalAccepted(
              proposal.id,
              proposal.organizationId ?? null,
              clientRow.contactEmail,
              clientRow.contactName,
              proposal.title,
            );
          }
        } catch (err: unknown) {
          log.warn("[trigger] onProposalAccepted (submit-order) failed:", err);
        }
      })();

      // If Stripe checkout is enabled, return early — client will redirect to checkout
      if (proposal.stripeCheckout && ENV.stripeSecretKey) {
        return res.json({
          success: true,
          orderId,
          orderNumber,
          subtotal: subtotal.toFixed(2),
          total: subtotal.toFixed(2),
          requiresCheckout: true,
          message: "Order created. Proceed to checkout.",
        });
      }

      // Notify distributor
      try {
        const [distUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, proposal.userId))
          .limit(1);
        const [client] = await db
          .select()
          .from(clients)
          .where(eq(clients.id, proposal.clientId))
          .limit(1);

        if (distUser?.email) {
          const { buildProposalAcceptedEmail } = await import(
            "../../email/proposalAcceptedEmail"
          );
          const { sendEmail } = await import("../../email/mailer");
          const emailData = buildProposalAcceptedEmail({
            distributorName: distUser.name || distUser.email,
            proposalTitle: proposal.title,
            clientName: client?.contactName || "Client",
            clientCompany: client?.companyName || "",
            clientEmail: client?.contactEmail || undefined,
            orderNumber,
            subtotal: subtotal.toFixed(2),
            itemCount: orderItemRows.length,
            items: orderItemRows.map((oi) => {
              const prod = productMap.get(oi.productId);
              return {
                name: prod?.name || "Product",
                quantity: oi.quantity,
                unitPrice: parseFloat(oi.unitPrice?.toString() || "0").toFixed(2),
                color: oi.color,
                size: oi.size,
              };
            }),
            paidViaStripe: false,
          });
          const { resolveTier2 } = await import("../../email/brandingResolver");
          const resolved = await resolveTier2({ distributorUserId: proposal.userId });
          await sendEmail(distUser.email, emailData.subject, emailData.html, resolved.fromName, resolved.replyTo);
        }
      } catch (e) {
        log.info("Could not notify distributor of new order:", e);
      }

      return res.json({
        success: true,
        orderId,
        orderNumber,
        subtotal: subtotal.toFixed(2),
        total: subtotal.toFixed(2),
        requiresCheckout: false,
        message: "Order submitted successfully",
      });
    } catch (err) {
      log.error("Submit order error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
