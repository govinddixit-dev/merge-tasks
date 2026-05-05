/**
 * publicInvoice.ts — unauthenticated invoice access for client payment.
 * ─────────────────────────────────────────────────────────────────────
 * Endpoints (mounted unprotected — no session required):
 *
 *   GET  /api/invoices/public/:token         — load the invoice for display
 *   POST /api/invoices/public/:token/checkout — (re)create a Stripe Checkout
 *                                               Session and return its URL
 *
 * Security model
 * ──────────────
 * The token is a 32-byte random opaque value stored on the invoice row
 * (invPublicToken). It is minted only when the distributor clicks Send,
 * so drafts never carry one — a client can never load a draft invoice.
 *
 * Rate-limiting follows the same pattern as publicProposal — per-IP,
 * keyed to the route, with a fail-open bypass if the limiter itself
 * errors (so a storage outage doesn't lock legitimate clients out of
 * paying).
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { invoices, clients, users, distributorProfiles } from "../../drizzle/schema";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import { getStripe } from "../stripe/stripeClient";
import { getLogger } from "../utils/logger";
import {
  checkRateLimit,
  getClientIp,
  PUBLIC_CHECKOUT_LIMIT,
  PUBLIC_PROPOSAL_MUTATION_LIMIT,
} from "../utils/rateLimiter";

const log = getLogger("publicInvoice");
export const publicInvoiceRouter = Router();

function publicRateLimit(limitConfig: typeof PUBLIC_CHECKOUT_LIMIT, label: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    try {
      const result = await checkRateLimit(`public_invoice:${label}:${ip}`, limitConfig);
      if (!result.allowed) {
        res.setHeader("Retry-After", Math.ceil(result.resetInMs / 1000).toString());
        return res.status(429).json({ error: result.message });
      }
      next();
    } catch {
      next();
    }
  };
}

function isValidTokenShape(token: string | undefined): boolean {
  return typeof token === "string" && token.length >= 32 && /^[a-f0-9]+$/i.test(token);
}

/**
 * GET /api/invoices/public/:token
 * Returns the invoice snapshot + distributor branding so the client-facing
 * React page can render the document. Never includes anything that isn't
 * safe to show the paying client (we explicitly pick the fields instead of
 * spreading the row to avoid leaking internal columns).
 */
publicInvoiceRouter.get(
  "/api/invoices/public/:token",
  publicRateLimit(PUBLIC_PROPOSAL_MUTATION_LIMIT, "view"),
  async (req, res) => {
    try {
      const token = req.params.token;
      if (!isValidTokenShape(token)) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const [inv] = await db.select().from(invoices)
        .where(eq(invoices.publicToken, token)).limit(1);
      if (!inv || inv.status === "draft") {
        return res.status(404).json({ error: "Invoice not found" });
      }

      const [client] = await db.select().from(clients).where(eq(clients.id, inv.clientId)).limit(1);
      const [profile] = await db.select().from(distributorProfiles)
        .where(eq(distributorProfiles.userId, inv.userId)).limit(1);
      const [distributor] = await db.select({
        stripeConnectChargesEnabled: users.stripeConnectChargesEnabled,
        stripeConnectPayoutsEnabled: users.stripeConnectPayoutsEnabled,
      }).from(users).where(eq(users.id, inv.userId)).limit(1);

      const cardEligible = Boolean(
        distributor?.stripeConnectChargesEnabled &&
        distributor?.stripeConnectPayoutsEnabled &&
        ENV.stripeSecretKey,
      );

      return res.json({
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        createdAt: inv.createdAt,
        dueDate: inv.dueDate,
        paidAt: inv.paidAt,
        paymentTerms: inv.paymentTerms,
        notes: inv.notes,
        subtotal: inv.subtotal,
        tax: inv.tax,
        shipping: inv.shipping,
        total: inv.total,
        lineItems: inv.lineItems ?? [],
        client: client
          ? {
              companyName: client.companyName,
              contactName: client.contactName,
              contactEmail: client.contactEmail,
              address: client.address ?? null,
            }
          : null,
        distributor: {
          companyName: profile?.brandCompanyName || profile?.companyName || "Your Distributor",
          primaryColor: profile?.brandPrimaryColor || "#654BF9",
          logoUrl: profile?.brandLogoUrl || null,
          address: profile?.companyAddress || null,
          phone: profile?.companyPhone || null,
          email: profile?.companyEmail || null,
          website: profile?.companyWebsite || null,
        },
        payment: {
          cardEligible,
          /** Whether the stored Checkout Session is available (may be stale). */
          hasCheckoutUrl: Boolean(inv.stripeCheckoutUrl),
        },
      });
    } catch (err) {
      log.error("Invoice view error:", err);
      return res.status(500).json({ error: "Failed to load invoice" });
    }
  },
);

/**
 * POST /api/invoices/public/:token/checkout
 * (Re)creates a Stripe Checkout Session for the invoice and returns its
 * hosted URL. We always create a fresh session rather than reusing the one
 * stamped at send-time, which avoids the "session expired" class of bug:
 * Stripe Checkout sessions default to a 24 h lifetime and a client who
 * comes back a week later would otherwise hit a dead link.
 */
publicInvoiceRouter.post(
  "/api/invoices/public/:token/checkout",
  publicRateLimit(PUBLIC_CHECKOUT_LIMIT, "checkout"),
  async (req, res) => {
    try {
      const token = req.params.token;
      if (!isValidTokenShape(token)) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      if (!ENV.stripeSecretKey) {
        return res.status(500).json({ error: "Payment processing is not configured" });
      }

      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database unavailable" });

      const [inv] = await db.select().from(invoices)
        .where(eq(invoices.publicToken, token)).limit(1);
      if (!inv || inv.status === "draft") {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (inv.status === "paid") {
        return res.status(400).json({ error: "This invoice has already been paid." });
      }
      if (inv.status === "cancelled" || inv.status === "void") {
        return res.status(400).json({ error: "This invoice is no longer payable." });
      }

      // Gate on the distributor's Connect status — if they disconnected
      // Stripe between send and pay-click, surface a clear error rather
      // than creating a session that routes nowhere useful.
      const [distributor] = await db.select({
        stripeConnectChargesEnabled: users.stripeConnectChargesEnabled,
        stripeConnectPayoutsEnabled: users.stripeConnectPayoutsEnabled,
      }).from(users).where(eq(users.id, inv.userId)).limit(1);
      const cardEligible = Boolean(
        distributor?.stripeConnectChargesEnabled &&
        distributor?.stripeConnectPayoutsEnabled,
      );
      if (!cardEligible) {
        return res.status(400).json({ error: "Card payments are not enabled for this invoice." });
      }

      const [client] = await db.select({ contactEmail: clients.contactEmail, companyName: clients.companyName })
        .from(clients).where(eq(clients.id, inv.clientId)).limit(1);

      const amountCents = Math.round(parseFloat(inv.total || "0") * 100);
      if (amountCents <= 0) {
        return res.status(400).json({ error: "Invoice total must be greater than zero." });
      }

      const origin =
        (typeof req.body?.origin === "string" ? req.body.origin : undefined) ||
        req.headers.origin ||
        (req.headers.referer ? req.headers.referer.replace(/\/[^/]*$/, "") : undefined) ||
        process.env.APP_BASE_URL ||
        "https://app.mergetasks.com";
      const payUrl = `${String(origin).replace(/\/$/, "")}/invoices/pay/${token}`;

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Invoice ${inv.invoiceNumber}`,
              description: client?.companyName ? `For ${client.companyName}` : undefined,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        }],
        success_url: `${payUrl}?checkout=success`,
        cancel_url: `${payUrl}?checkout=canceled`,
        customer_email: client?.contactEmail || undefined,
        client_reference_id: `invoice_${inv.id}`,
        metadata: {
          invoice_id: inv.id.toString(),
          invoice_number: inv.invoiceNumber,
          distributor_user_id: inv.userId.toString(),
        },
      });

      await db.update(invoices).set({
        stripeCheckoutSessionId: session.id,
        stripeCheckoutUrl: session.url ?? null,
      }).where(eq(invoices.id, inv.id));

      return res.json({ url: session.url });
    } catch (err) {
      log.error("Invoice checkout error:", err);
      const isStripeError = typeof err === "object" && err !== null && "type" in err;
      const safeMessage = isStripeError
        ? "Payment processing failed. Please try again or contact the sender."
        : "Failed to start checkout. Please try again.";
      return res.status(500).json({ error: safeMessage });
    }
  },
);
