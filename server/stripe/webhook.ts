import { Request, Response } from "express";
import Stripe from "stripe";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { users, proposals, proposalOrderItems, products, clients, orders, orderItems, orderItems as orderItemsTable, refundHistory, storeProducts, orgMembers, stripeWebhookEvents, invoices as invoicesTable } from "../../drizzle/schema";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { auditLog } from "../utils/auditLog";
import { eq, inArray, and } from "drizzle-orm";
import { postOrderBudgetHooks } from "../routers/storeCheckout";
import { getLogger } from "../utils/logger";
import { onProposalAccepted } from "../utils/agentTriggers";
import { resolvePricing } from "../utils/pricingResolver";
import { STRIPE_API_VERSION } from "./stripeVersion";

const log = getLogger("webhook");

/**
 * Single source of truth for the Stripe Dashboard webhook endpoint configuration.
 * Every event the switch below handles must be listed here so ops can reconcile the
 * dashboard against the handler. Add to this list when you add a new `case` above,
 * and enable the same events on the endpoint in the Stripe Dashboard.
 */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "account.updated",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  // Connect payout/dispute/deauthorization alerts — surface to distributor as "payment" notifications.
  "transfer.reversed",
  "payout.failed",
  "account.application.deauthorized",
  "charge.dispute.created",
  "charge.dispute.funds_withdrawn",
] as const;

export async function handleStripeWebhook(req: Request, res: Response) {
  if (!ENV.stripeSecretKey || !ENV.stripeWebhookSecret) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const stripe = new Stripe(ENV.stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, ENV.stripeWebhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Signature verification failed:", msg);
    return res.status(400).json({ error: `Webhook Error: ${msg}` });
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    log.info("Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  log.info(`Received event: ${event.type} (${event.id})`);

  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Database not available" });
    }

    // ── QA v2: Persistent idempotency ────────────────────────────────────────
    // Stripe guarantees at-least-once delivery, so the same event.id can arrive
    // twice (e.g., on a network timeout or retry). We record each event ID the
    // first time we see it and short-circuit on duplicates. INSERT IGNORE relies
    // on the PRIMARY KEY to race-safely reject the second insert.
    try {
      const insertResult = (await db.insert(stripeWebhookEvents)
        .values({ id: event.id, type: event.type })
        .onDuplicateKeyUpdate({ set: { id: event.id } })) as unknown as [{ affectedRows: number }];
      // MySQL semantics: on duplicate, affectedRows is 2 for UPDATE; 1 for fresh INSERT; 0 if nothing changed.
      // We can't cleanly distinguish "first-time" vs "duplicate" from affectedRows alone
      // (onDuplicateKeyUpdate with same value returns 0), so do an explicit prior-seen lookup.
      const [seen] = await db.select({ id: stripeWebhookEvents.id, receivedAt: stripeWebhookEvents.receivedAt })
        .from(stripeWebhookEvents).where(eq(stripeWebhookEvents.id, event.id)).limit(1);
      if (seen) {
        const firstSeenMs = new Date(seen.receivedAt).getTime();
        const ageMs = Date.now() - firstSeenMs;
        // If this row is older than ~2s, it was inserted by a prior delivery
        // (not the INSERT we just ran). Short-circuit.
        if (ageMs > 2000) {
          log.info(`Idempotent skip: event ${event.id} (${event.type}) already processed`);
          return res.json({ received: true, duplicate: true });
        }
      }
      void insertResult;
    } catch (idemErr) {
      log.warn(`Idempotency bookkeeping failed for ${event.id}:`, idemErr);
      // Fall through — a failed idempotency write should not block a real event.
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = parseInt(session.metadata?.user_id || session.client_reference_id || "0");
        const planId = session.metadata?.plan_id;
        const proposalId = session.metadata?.proposal_id ? parseInt(session.metadata.proposal_id) : null;

        // ── Handle subscription checkout (idempotent) ─────────────────────
        if (userId && planId && session.subscription) {
          // FIX (QA v2): Validate planId against the known enum before writing.
          // Metadata is attacker-controllable if they could hit the checkout
          // route directly; we only accept the three valid tiers.
          const safeTier: "free" | "pro" | "enterprise" | null =
            planId === "free" || planId === "pro" || planId === "enterprise" ? planId : null;
          if (!safeTier) {
            log.warn(`checkout.session.completed: unknown plan_id '${planId}' — skipping tier write`);
          } else {
            const [existingUser] = await db.select({ stripeSubscriptionId: users.stripeSubscriptionId })
              .from(users).where(eq(users.id, userId)).limit(1);
            if (existingUser?.stripeSubscriptionId === session.subscription) {
              log.info(`Idempotent skip: user ${userId} already has subscription ${session.subscription}`);
            } else {
              await db
                .update(users)
                .set({
                  stripeSubscriptionId: session.subscription as string,
                  subscriptionTier: safeTier,
                  subscriptionStatus: "active",
                })
                .where(eq(users.id, userId));
              log.info(`User ${userId} subscribed to ${safeTier} plan`);
            }
          }
        }

        // ── Handle proposal checkout payment ──────────────────────────────
        if (proposalId && session.client_reference_id?.startsWith("proposal_")) {
          try {
            await db.update(proposals)
              .set({ status: "accepted", respondedAt: new Date() })
              .where(eq(proposals.id, proposalId));

            const [proposal] = await db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
            if (proposal) {
              const [distUser] = await db.select().from(users).where(eq(users.id, proposal.userId)).limit(1);
              const [client] = await db.select().from(clients).where(eq(clients.id, proposal.clientId)).limit(1);

              // Agent: draft acceptance follow-up email (fire-and-forget, deduped).
              if (client?.contactEmail) {
                onProposalAccepted(
                  proposal.id,
                  proposal.organizationId ?? null,
                  client.contactEmail,
                  client.contactName,
                  proposal.title,
                ).catch((err: unknown) => {
                  log.warn("[trigger] onProposalAccepted (stripe checkout) failed:", err);
                });
              }

              const orderItemRows = await db.select().from(proposalOrderItems)
                .where(eq(proposalOrderItems.proposalId, proposalId));

              const productIds = Array.from(new Set(orderItemRows.map(oi => oi.productId))) as number[];
              const productRows = productIds.length > 0
                ? await db.select().from(products).where(inArray(products.id, productIds))
                : [];
              const productMap = new Map(productRows.map(p => [p.id, p]));

              // ── Billing integrity fix (Divergence 3) ──────────────────────
              // Re-validate each line item price against the resolver at
              // webhook time. If resolver returns a different price than what
              // was stamped on the proposal, log the discrepancy.
              // The stamped unitPrice is used for the actual charge (it was
              // agreed to at proposal creation time) but the discrepancy is
              // logged so the distributor can act on it.
              let subtotal = 0;
              for (const oi of orderItemRows) {
                const stampedPriceCents = Math.round(parseFloat(oi.unitPrice?.toString() || "0") * 100);
                subtotal += stampedPriceCents * oi.quantity / 100;

                if (oi.productId && proposal.clientId) {
                  try {
                    const resolved = await resolvePricing({
                      clientId: proposal.clientId,
                      productId: oi.productId,
                      quantity: oi.quantity,
                      variantKey: null,
                      decorationMethodId: null,
                      includeOtherCosts: false,
                    });
                    const resolvedCents = resolved.unitPriceCents + resolved.variantUpchargeCents;
                    if (resolvedCents !== stampedPriceCents) {
                      log.warn(
                        `[billing-integrity] proposalId=${proposalId} productId=${oi.productId} ` +
                        `stamped=${stampedPriceCents}¢ resolver=${resolvedCents}¢ — discrepancy logged`
                      );
                    }
                  } catch {
                    // PricingNotFoundError — no client pricing configured, skip validation
                    log.warn(`[billing-integrity] proposalId=${proposalId} productId=${oi.productId} — no resolver pricing found, skipping validation`);
                  }
                }
              }

              const [existingOrder] = await db.select().from(orders)
                .where(eq(orders.proposalId, proposalId)).limit(1);
              const orderNumber = existingOrder?.orderNumber || `MT-${Date.now()}`;

              // Bell notification for the distributor. Stripe checkouts do not
              // collect a free-text comment from the client, so content is a
              // plain status line rather than echoing an unavailable message.
              const { notifyOwner: notifyProposalAccepted } = await import("../_core/notification");
              await notifyProposalAccepted({
                userId: proposal.userId,
                organizationId: proposal.organizationId ?? undefined,
                type: "proposal_approved",
                title: `${client?.companyName || client?.contactName || "Client"} accepted ${proposal.title}`,
                content: `Payment confirmed via Stripe — order ${orderNumber}.`,
                actionPath: `/proposals/${proposal.id}`,
                actionLabel: "View Proposal",
                entityId: proposal.id,
                entityType: "proposal",
              });

              if (distUser?.email) {
                const { buildProposalAcceptedEmail } = await import("../email/proposalAcceptedEmail");
                const { sendEmail } = await import("../email/mailer");
                const emailData = buildProposalAcceptedEmail({
                  distributorName: distUser.name || distUser.email,
                  proposalTitle: proposal.title,
                  clientName: client?.contactName || "Client",
                  clientCompany: client?.companyName || "",
                  clientEmail: client?.contactEmail || undefined,
                  orderNumber,
                  subtotal: subtotal.toFixed(2),
                  itemCount: orderItemRows.length,
                  items: orderItemRows.map(oi => {
                    const prod = productMap.get(oi.productId);
                    return {
                      name: prod?.name || "Product",
                      quantity: oi.quantity,
                      unitPrice: parseFloat(oi.unitPrice?.toString() || "0").toFixed(2),
                      color: oi.color,
                      size: oi.size,
                    };
                  }),
                  paidViaStripe: true,
                });
                const { resolveTier2 } = await import("../email/brandingResolver");
                const resolved = await resolveTier2({ distributorUserId: proposal.userId });
                await sendEmail(distUser.email, emailData.subject, emailData.html, resolved.fromName, resolved.replyTo);
                log.info(`Sent proposal accepted email to ${distUser.email} for proposal ${proposalId}`);
              }
            }
          } catch (proposalErr) {
            log.error(`Error processing proposal checkout for proposal ${proposalId}:`, proposalErr);
          }
        }

        // ── CRITICAL FIX #4: Handle store order checkout (belt-and-suspenders) ──
        // This catches store orders even if payment_intent.succeeded is missed/delayed.
        if (session.client_reference_id?.startsWith("store_order_")) {
          const storeOrderId = parseInt(session.client_reference_id.replace("store_order_", ""));
          if (storeOrderId && !isNaN(storeOrderId)) {
            try {
              // Extract tax from the Stripe session (if Stripe Tax was enabled)
              const taxAmountCents = session.total_details?.amount_tax ?? 0;
              const totalAmountCents = session.amount_total ?? 0;

              // Idempotent: only update if still "pending"
              const updateData: Record<string, any> = {
                status: "processing",
              };

              // Sync Stripe-calculated tax back to our order record
              if (taxAmountCents > 0) {
                updateData.tax = (taxAmountCents / 100).toFixed(2);
                updateData.total = (totalAmountCents / 100).toFixed(2);
              }

              // If the PaymentIntent ID is available on the session, store it
              if (session.payment_intent) {
                updateData.paymentReference = session.payment_intent;
                updateData.stripePaymentIntentId = session.payment_intent;
              }

              const result = await db
                .update(orders)
                .set(updateData)
                .where(and(eq(orders.id, storeOrderId), eq(orders.status, "pending")));

              type MysqlUpdateResult = [{ affectedRows: number }];
              const rowsAffected = (result as unknown as MysqlUpdateResult)[0]?.affectedRows ?? 0;
              if (rowsAffected > 0) {
                log.info(
                  `Store order ${storeOrderId} confirmed via checkout.session.completed ` +
                  `(tax: ${(taxAmountCents / 100).toFixed(2)}, total: ${(totalAmountCents / 100).toFixed(2)})`
                );

                // ── IMPORTANT FIX: Send buyer email receipt ──────────────────
                await sendBuyerReceipt(db, storeOrderId, session.customer_email || session.customer_details?.email);

                // ── Post-order budget hooks (Mock-to-Real Guide, Step 7) ────
                // Atomically increment department spend for the buyer's department.
                const storeUserId = parseInt(session.metadata?.store_user_id || "0");
                if (storeUserId > 0) {
                  await postOrderBudgetHooks(storeOrderId, storeUserId);
                }
              } else {
                log.info(`Store order ${storeOrderId} already processed (idempotent skip via checkout.session.completed)`);
              }

              auditLog({
                action: "stripe.webhook.received",
                userId: null,
                resourceType: "order",
                resourceId: storeOrderId,
                description: `Store checkout session completed for order ${storeOrderId}`,
                metadata: {
                  sessionId: session.id,
                  paymentIntent: session.payment_intent,
                  taxCents: taxAmountCents,
                  totalCents: totalAmountCents,
                },
              });
            } catch (storeOrderErr) {
              log.error(`Error processing store order checkout for order ${storeOrderId}:`, storeOrderErr);
            }
          }
        }

        // ── Session-2: Handle invoice payment completion ───────────────────
        // The distributor's send-invoice flow stamps `invoice_<id>` on the
        // Checkout Session's client_reference_id. Public clients paying via
        // /invoices/pay/:token create sessions with the same prefix, so both
        // paths converge here.
        //
        // Idempotent: only flips pending → paid. Also fires a distributor-
        // branded confirmation email to the client (best-effort; delivery
        // failures must not block the status update, since the webhook
        // won't retry).
        if (session.client_reference_id?.startsWith("invoice_")) {
          const invoiceId = parseInt(session.client_reference_id.replace("invoice_", ""));
          if (invoiceId && !isNaN(invoiceId)) {
            try {
              const paymentIntentId = typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id ?? null;

              const updateResult = await db.update(invoicesTable).set({
                status: "paid",
                paidAt: new Date(),
                paymentMethod: "credit_card",
                paymentReference: paymentIntentId ?? session.id,
                stripePaymentIntentId: paymentIntentId ?? null,
              }).where(and(
                eq(invoicesTable.id, invoiceId),
                eq(invoicesTable.status, "sent"),
              ));

              type MysqlUpdateResult = [{ affectedRows: number }];
              const rowsAffected = (updateResult as unknown as MysqlUpdateResult)[0]?.affectedRows ?? 0;

              if (rowsAffected > 0) {
                log.info(`Invoice ${invoiceId} marked paid via checkout.session.completed (PI: ${paymentIntentId})`);

                const [paidInvoice] = await db.select().from(invoicesTable)
                  .where(eq(invoicesTable.id, invoiceId)).limit(1);
                if (paidInvoice) {
                  const [payingClient] = await db.select().from(clients)
                    .where(eq(clients.id, paidInvoice.clientId)).limit(1);
                  const clientEmail = payingClient?.contactEmail
                    || session.customer_email
                    || session.customer_details?.email
                    || null;

                  if (clientEmail) {
                    try {
                      const { resolveTier2 } = await import("../email/brandingResolver");
                      const { buildEmailHtml, formatCurrency } = await import("../email/emailTemplates/emailTemplateBase");
                      const { sendEmail } = await import("../email/mailer");

                      const resolved = await resolveTier2({
                        distributorUserId: paidInvoice.userId,
                        organizationId: paidInvoice.organizationId ?? null,
                      });
                      const amountPaid = parseFloat(paidInvoice.total || "0");
                      const html = buildEmailHtml({
                        branding: {
                          lane: "distributor",
                          companyName: resolved.branding.companyName,
                          primaryColor: resolved.branding.primaryColor,
                          logoUrl: resolved.branding.logoUrl,
                        },
                        badge: { text: "Payment Received", color: "#065F46", bgColor: "#ECFDF5" },
                        headline: "Thank you — payment received",
                        subheadline: `Invoice ${paidInvoice.invoiceNumber} is marked paid.`,
                        bodyParagraphs: [
                          `We've received your payment of ${formatCurrency(amountPaid)} for invoice ${paidInvoice.invoiceNumber}.`,
                          "A card receipt is available from your card issuer. Keep this email for your records.",
                        ],
                        infoCard: {
                          title: `Invoice ${paidInvoice.invoiceNumber}`,
                          subtitle: `Paid in full: ${formatCurrency(amountPaid)}`,
                          meta: [
                            { label: "Paid", value: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) },
                          ],
                        },
                      });
                      await sendEmail(
                        clientEmail,
                        `${resolved.branding.companyName || "Invoice"} — Payment received for ${paidInvoice.invoiceNumber}`,
                        html,
                        resolved.fromName,
                        resolved.replyTo,
                      );
                      log.info(`Sent invoice-paid confirmation to ${clientEmail} for invoice ${invoiceId}`);
                    } catch (mailErr) {
                      log.warn(`Invoice paid confirmation email failed for invoice ${invoiceId}:`, mailErr);
                    }
                  }
                }

                auditLog({
                  action: "invoice.paid",
                  userId: null,
                  resourceType: "invoice",
                  resourceId: invoiceId,
                  description: `Invoice ${invoiceId} paid via Stripe Checkout`,
                  metadata: {
                    sessionId: session.id,
                    paymentIntent: paymentIntentId,
                    amount: session.amount_total,
                  },
                });
              } else {
                log.info(`Invoice ${invoiceId} already paid or not in 'sent' state (idempotent skip)`);
              }
            } catch (invErr) {
              log.error(`Error processing invoice checkout for invoice ${invoiceId}:`, invErr);
            }
          }
        }
        break;
      }

      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
        const [user] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeCustomerId, customerId))
          .limit(1);
        if (user) {
          // FIX (QA v2): Plan tier is resolved from the lookup_key on the Price
          // (set by billing.createCheckout as "mergetasks_<planId>_<interval>"), or from
          // the Price's product metadata plan_id. Both paths are kept in sync with
          // the DB enum ("free" | "pro" | "enterprise"). The previous code wrote values
          // ("starter" | "growth") that would fail the DB CHECK and never persisted.
          const priceObj = subscription.items.data[0]?.price;
          const lookupKey = (priceObj as unknown as { lookup_key?: string | null })?.lookup_key ?? null;
          const productMetaPlanId = typeof priceObj?.product === "object"
            ? ((priceObj.product as { metadata?: { plan_id?: string } })?.metadata?.plan_id ?? null)
            : null;
          let tier: "free" | "pro" | "enterprise" = "pro";
          const keyMatch = lookupKey?.match(/^mergetasks_(free|pro|enterprise)_/);
          if (keyMatch) {
            tier = keyMatch[1] as typeof tier;
          } else if (productMetaPlanId === "free" || productMetaPlanId === "pro" || productMetaPlanId === "enterprise") {
            tier = productMetaPlanId;
          }
          await db.update(users).set({
            stripeSubscriptionId: subscription.id,
            subscriptionTier: tier,
            subscriptionStatus: subscription.status === "active" ? "active" : subscription.status === "trialing" ? "trialing" : "none",
          }).where(eq(users.id, user.id));
          log.info(`Subscription created for user ${user.id}: tier=${tier}`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        // subscription.customer can be a string ID or an expanded Customer object
        const customerId = typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

        const [user] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeCustomerId, customerId))
          .limit(1);

        if (user) {
          const status = subscription.status;
          type SubStatus = "active" | "past_due" | "canceled" | "trialing" | "none";
          // FIX (QA v2): cancel_at_period_end means "scheduled to cancel" — the
          // subscription is STILL active until the period end. Don't downgrade
          // the user's access yet. Keep the live Stripe status; the UI reads
          // cancel_at_period_end separately via billing.getSubscription.
          const mappedStatus: SubStatus = (status === "active" ? "active" :
            status === "past_due" ? "past_due" :
            status === "canceled" ? "canceled" :
            status === "trialing" ? "trialing" : "none");
          const updateData: { subscriptionStatus: SubStatus } = {
            subscriptionStatus: mappedStatus,
          };

          await db.update(users).set(updateData).where(eq(users.id, user.id));
          log.info(`Updated subscription for user ${user.id}: ${status} (cancel_at_period_end=${subscription.cancel_at_period_end})`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

        const [user] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeCustomerId, customerId))
          .limit(1);

        if (user) {
          await db
            .update(users)
            .set({
              subscriptionTier: "free",
              subscriptionStatus: "none",
              stripeSubscriptionId: null,
            })
            .where(eq(users.id, user.id));
          log.info(`Subscription deleted for user ${user.id}`);
        }
        break;
      }

      case "invoice.paid": {
        // PO-2: Actually process invoice payments — activate/renew subscriptions
        // and mark related orders as paid.
        const paidInvoice = event.data.object as Stripe.Invoice;
        const paidCustomerId = typeof paidInvoice.customer === "string"
          ? paidInvoice.customer
          : (paidInvoice.customer as { id?: string } | null)?.id ?? null;

        const paidSubscriptionId = (paidInvoice as any).subscription as string | null;
        log.info(`Invoice paid: ${paidInvoice.id} (customer: ${paidCustomerId}, subscription: ${paidSubscriptionId})`);

        if (paidCustomerId) {
          const [invoiceUserRow] = await db
            .select({ id: users.id, subscriptionStatus: users.subscriptionStatus })
            .from(users)
            .where(eq(users.stripeCustomerId, paidCustomerId))
            .limit(1);
          // Users table has no organizationId — look it up from orgMembers
          let invoiceUser: { id: number; subscriptionStatus: string; organizationId: number | null } | undefined;
          if (invoiceUserRow) {
            const [membership] = await db.select({ organizationId: orgMembers.organizationId })
              .from(orgMembers).where(eq(orgMembers.userId, invoiceUserRow.id)).limit(1);
            invoiceUser = { ...invoiceUserRow, organizationId: membership?.organizationId ?? null };
          }

          if (invoiceUser) {
            // If subscription was past_due or trialing, move to active
            if (invoiceUser.subscriptionStatus !== "active" && paidSubscriptionId) {
              await db
                .update(users)
                .set({ subscriptionStatus: "active" })
                .where(eq(users.id, invoiceUser.id));
              log.info(`Subscription activated for user ${invoiceUser.id} via invoice.paid`);
            }

            // If the invoice has metadata linking it to a proposal/order, mark order as paid
            const linkedProposalId = paidInvoice.metadata?.proposal_id
              ? parseInt(paidInvoice.metadata.proposal_id)
              : null;

            if (linkedProposalId) {
              await db
                .update(proposals)
                .set({ status: "accepted", respondedAt: new Date() })
                .where(eq(proposals.id, linkedProposalId));

              // Agent: draft acceptance follow-up email (fire-and-forget, deduped).
              try {
                const [acceptedProposal] = await db
                  .select()
                  .from(proposals)
                  .where(eq(proposals.id, linkedProposalId))
                  .limit(1);
                if (acceptedProposal) {
                  const [acceptedClient] = await db
                    .select({
                      contactEmail: clients.contactEmail,
                      contactName: clients.contactName,
                    })
                    .from(clients)
                    .where(eq(clients.id, acceptedProposal.clientId))
                    .limit(1);
                  if (acceptedClient?.contactEmail) {
                    onProposalAccepted(
                      acceptedProposal.id,
                      acceptedProposal.organizationId ?? null,
                      acceptedClient.contactEmail,
                      acceptedClient.contactName,
                      acceptedProposal.title,
                    ).catch((err: unknown) => {
                      log.warn("[trigger] onProposalAccepted (invoice.paid) failed:", err);
                    });
                  }
                }
              } catch (err: unknown) {
                log.warn("[trigger] onProposalAccepted (invoice.paid) lookup failed:", err);
              }

              // Also update any linked orders to "processing"
              const [linkedOrder] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(eq(orders.proposalId, linkedProposalId))
                .limit(1);

              if (linkedOrder) {
                await db
                  .update(orders)
                  .set({ status: "processing" })
                  .where(eq(orders.id, linkedOrder.id));
                log.info(`Order ${linkedOrder.id} marked as processing via invoice.paid`);

                // Auto-generate POs for the paid order (non-blocking)
                // Delegates to shared utility — handles idempotency, AI grouping, supplier directory.
                setImmediate(async () => {
                  try {
                    const { generatePOsForOrder } = await import("../utils/generatePOsForOrder");
                    const { notifyOwner } = await import("../_core/notification");
                    const result = await generatePOsForOrder(
                      invoiceUser.id,
                      invoiceUser.organizationId ?? null,
                      linkedOrder.id,
                    );
                    if (result && result.totalPOs > 0) {
                      await notifyOwner({
                        userId: invoiceUser.id,
                        organizationId: invoiceUser.organizationId ?? undefined,
                        type: "po_created",
                        title: `${result.totalPOs} PO${result.totalPOs > 1 ? "s" : ""} Auto-Generated`,
                        content: `Invoice paid — ${result.totalPOs} purchase orders ready for review`,
                        actionPath: `/purchase-orders?orderId=${linkedOrder.id}`,
                        actionLabel: "View POs",
                        entityId: linkedOrder.id,
                        entityType: "order",
                      });
                    }
                  } catch (err) {
                    log.warn(`Auto-PO generation failed from invoice.paid:`, err);
                  }
                });
              }
            }

            auditLog({
              action: "invoice.paid",
              userId: invoiceUser.id,
              description: `Invoice ${paidInvoice.id} paid ($${((paidInvoice.amount_paid ?? 0) / 100).toFixed(2)})`,
              metadata: {
                invoiceId: paidInvoice.id,
                amountPaid: paidInvoice.amount_paid,
                proposalId: linkedProposalId,
              },
            });
          }
        }
        break;
      }

       case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string"
          ? invoice.customer
          : (invoice.customer as { id?: string } | null)?.id ?? null;
        if (customerId) {
          const [user] = await db
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(eq(users.stripeCustomerId, customerId))
            .limit(1);
          if (user) {
            await db
              .update(users)
              .set({ subscriptionStatus: "past_due" })
              .where(eq(users.id, user.id));
            log.info(`Payment failed for user ${user.id}`);

            if (user.email) {
              try {
                const { sendEmail } = await import("../email/mailer");
                const amount = ((invoice.amount_due ?? 0) / 100).toFixed(2);
                const currency = (invoice.currency ?? "cad").toUpperCase();
                const updateUrl = `${process.env.APP_BASE_URL ?? "https://app.mergetasks.com"}/settings?tab=billing`;
                await sendEmail(
                  user.email,
                  "Action required: payment failed on your MergeTasks subscription",
                  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1a1a1a">
                    <div style="background:#654BF9;color:#fff;padding:20px;border-radius:8px 8px 0 0;">
                      <h1 style="margin:0;font-size:20px;font-weight:600">MergeTasks</h1>
                    </div>
                    <div style="border:1px solid #eee;border-top:0;padding:28px;border-radius:0 0 8px 8px;">
                      <h2 style="margin-top:0;font-size:18px">Payment failed</h2>
                      <p>Hi ${user.name ?? "there"},</p>
                      <p>We weren't able to charge your payment method for your MergeTasks subscription (${currency} $${amount}). Your account is now marked as <strong>past due</strong>.</p>
                      <p>To keep your workspace active, please update your billing details:</p>
                      <p><a href="${updateUrl}" style="display:inline-block;background:#654BF9;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Update payment method</a></p>
                      <p style="color:#666;font-size:13px;margin-top:28px">If you have questions, reply to this email and our team will help.</p>
                    </div>
                  </div>`,
                );
              } catch (mailErr) {
                log.warn("Failed to send payment_failed email:", mailErr);
              }
            }
          }
        }
        break;
      }

      /**
       * STRIPE CONNECT — account.updated
       * Fired when a distributor's connected account changes status.
       * We sync their onboarding / payout / charges status to our DB.
       */
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const connectAccountId = account.id as string;
        const [connectedUser] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeConnectAccountId, connectAccountId))
          .limit(1);
        if (connectedUser) {
          await db
            .update(users)
            .set({
              stripeConnectOnboardingComplete: account.details_submitted ?? false,
              stripeConnectPayoutsEnabled: account.payouts_enabled ?? false,
              stripeConnectChargesEnabled: account.charges_enabled ?? false,
            })
            .where(eq(users.id, connectedUser.id));
          log.info(
            `Connect account ${connectAccountId} updated for user ${connectedUser.id}: ` +
            `charges=${account.charges_enabled}, payouts=${account.payouts_enabled}`
          );
        }
        break;
      }

      /**
       * STRIPE CONNECT — transfer.reversed
       * Fired when a platform→connected-account transfer is reversed (e.g. Stripe
       * clawback, dispute). Notify the distributor so they can reconcile.
       */
      case "transfer.reversed": {
        const transfer = event.data.object as Stripe.Transfer;
        const connectAccountId = event.account;
        if (!connectAccountId) {
          log.warn(`transfer.reversed: event.account missing on ${event.id}`);
          break;
        }
        const [distributor] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeConnectAccountId, connectAccountId))
          .limit(1);
        if (distributor) {
          const { notifyOwner } = await import("../_core/notification");
          await notifyOwner({
            userId: distributor.id,
            type: "payment",
            title: "Payout Reversed",
            content: "A transfer to your account was reversed by Stripe. Please check your Stripe dashboard.",
          });
        }
        log.warn(
          `transfer.reversed: account=${connectAccountId} transfer=${transfer.id} distributor=${distributor?.id ?? "unknown"}`
        );
        break;
      }

      /**
       * STRIPE CONNECT — payout.failed
       * Fired when a payout to the distributor's bank account fails (usually due
       * to stale bank details). Notify them to update their Stripe dashboard.
       */
      case "payout.failed": {
        const payout = event.data.object as Stripe.Payout;
        const connectAccountId = event.account;
        if (!connectAccountId) {
          log.warn(`payout.failed: event.account missing on ${event.id}`);
          break;
        }
        const [distributor] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeConnectAccountId, connectAccountId))
          .limit(1);
        if (distributor) {
          const { notifyOwner } = await import("../_core/notification");
          await notifyOwner({
            userId: distributor.id,
            type: "payment",
            title: "Payout Failed",
            content: "A payout to your bank account failed. Please update your bank details in Stripe.",
          });
        }
        log.warn(
          `payout.failed: account=${connectAccountId} payout=${payout.id} reason=${payout.failure_message ?? payout.failure_code ?? "unknown"} distributor=${distributor?.id ?? "unknown"}`
        );
        break;
      }

      /**
       * STRIPE CONNECT — account.application.deauthorized
       * Fired when the distributor revokes our platform access from the Stripe
       * dashboard. Clear the connect account link and all derived flags so the UI
       * treats them as not-connected; they can reconnect at any time.
       */
      case "account.application.deauthorized": {
        const connectAccountId = event.account;
        if (!connectAccountId) {
          log.warn(`account.application.deauthorized: event.account missing on ${event.id}`);
          break;
        }
        const [distributor] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeConnectAccountId, connectAccountId))
          .limit(1);
        if (distributor) {
          await db
            .update(users)
            .set({
              stripeConnectAccountId: null,
              stripeConnectOnboardingComplete: false,
              stripeConnectPayoutsEnabled: false,
              stripeConnectChargesEnabled: false,
            })
            .where(eq(users.id, distributor.id));
          const { notifyOwner } = await import("../_core/notification");
          await notifyOwner({
            userId: distributor.id,
            type: "payment",
            title: "Stripe Account Disconnected",
            content: "Your Stripe Connect account has been disconnected. Reconnect to continue accepting payments.",
          });
        }
        log.warn(
          `account.application.deauthorized: account=${connectAccountId} distributor=${distributor?.id ?? "unknown"}`
        );
        break;
      }

      /**
       * STRIPE CONNECT — charge.dispute.created
       * Fired when an end-client files a chargeback on a Connect charge. The
       * distributor has ~7 days to submit evidence in their Stripe dashboard,
       * so surface this with urgency.
       */
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? "unknown";
        const connectAccountId = event.account;
        if (!connectAccountId) {
          log.warn(`dispute.created: event.account missing on ${event.id}`);
          break;
        }
        const [distributor] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeConnectAccountId, connectAccountId))
          .limit(1);
        if (distributor) {
          const { notifyOwner } = await import("../_core/notification");
          await notifyOwner({
            userId: distributor.id,
            type: "payment",
            title: "Dispute Filed",
            content: `A customer has filed a dispute on order ${chargeId}. You have 7 days to submit evidence in your Stripe dashboard.`,
          });
        }
        log.warn(
          `charge.dispute.created: account=${connectAccountId} dispute=${dispute.id} charge=${chargeId} ` +
          `amount=${dispute.amount} reason=${dispute.reason} — 7-day evidence window, distributor=${distributor?.id ?? "unknown"}`
        );
        break;
      }

      /**
       * STRIPE CONNECT — charge.dispute.funds_withdrawn
       * Fired when Stripe removes the disputed funds from the connected account
       * balance while the dispute is pending. Notify the distributor of the debit.
       */
      case "charge.dispute.funds_withdrawn": {
        const dispute = event.data.object as Stripe.Dispute;
        const connectAccountId = event.account;
        if (!connectAccountId) {
          log.warn(`charge.dispute.funds_withdrawn: event.account missing on ${event.id}`);
          break;
        }
        const [distributor] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.stripeConnectAccountId, connectAccountId))
          .limit(1);
        if (distributor) {
          const { notifyOwner } = await import("../_core/notification");
          await notifyOwner({
            userId: distributor.id,
            type: "payment",
            title: "Dispute Funds Withdrawn",
            content: "Stripe has withdrawn funds from your account for a dispute. Review your Stripe dashboard.",
          });
        }
        log.warn(
          `charge.dispute.funds_withdrawn: account=${connectAccountId} dispute=${dispute.id} amount=${dispute.amount} distributor=${distributor?.id ?? "unknown"}`
        );
        break;
      }

      /**
       * STRIPE CONNECT — payment_intent.succeeded (on connected account)
       * Fired when an end-client's CC payment succeeds on a distributor's account.
       * We mark the corresponding store order as "processing" and record the payment reference.
       *
       * NOTE: checkout.session.completed also handles store orders as a belt-and-suspenders
       * confirmation path. Both handlers are idempotent — whichever fires first wins.
       */
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const storeOrderId = paymentIntent.metadata?.mergetasks_order_id
          ? parseInt(paymentIntent.metadata.mergetasks_order_id)
          : null;
        if (storeOrderId) {
          const result = await db
            .update(orders)
            .set({
              status: "processing",
              paymentReference: paymentIntent.id,
              stripePaymentIntentId: paymentIntent.id,
            })
            .where(and(eq(orders.id, storeOrderId), eq(orders.status, "pending")));

          type MysqlUpdateResult2 = [{ affectedRows: number }];
          const rowsAffected = (result as unknown as MysqlUpdateResult2)[0]?.affectedRows ?? 0;
          if (rowsAffected > 0) {
            log.info(`Store order ${storeOrderId} confirmed via PaymentIntent ${paymentIntent.id}`);

            // Send buyer receipt if checkout.session.completed hasn't already done it
            const buyerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.buyer_email;
            if (buyerEmail) {
              await sendBuyerReceipt(db, storeOrderId, buyerEmail);
            }

            // Post-order budget hooks (Mock-to-Real Guide, Step 7) — belt-and-suspenders
            const piStoreUserId = parseInt(paymentIntent.metadata?.store_user_id || "0");
            if (piStoreUserId > 0) {
              await postOrderBudgetHooks(storeOrderId, piStoreUserId);
            }
          } else {
            log.info(`Store order ${storeOrderId} already processed (idempotent skip) for PaymentIntent ${paymentIntent.id}`);
          }
        }
        break;
      }

      /**
       * STRIPE CONNECT — payment_intent.payment_failed (on connected account)
       * Fired when an end-client's CC payment is declined or fails on a distributor's
       * account. We mark the corresponding store order as "payment_failed" and notify
       * both the distributor (in-app) and the buyer (email) so they can retry.
       *
       * Note: invoice.payment_failed (subscription billing) is handled separately above.
       */
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const storeOrderId = paymentIntent.metadata?.mergetasks_order_id
          ? parseInt(paymentIntent.metadata.mergetasks_order_id)
          : null;
        if (storeOrderId) {
          // Only flip pending → payment_failed; never overwrite an already-confirmed order
          const result = await db
            .update(orders)
            .set({
              status: "payment_failed",
              stripePaymentIntentId: paymentIntent.id,
            })
            .where(and(eq(orders.id, storeOrderId), eq(orders.status, "pending")));

          type MysqlUpdateResult3 = [{ affectedRows: number }];
          const rowsAffected = (result as unknown as MysqlUpdateResult3)[0]?.affectedRows ?? 0;
          if (rowsAffected > 0) {
            const failureMsg =
              paymentIntent.last_payment_error?.message ||
              "The card was declined or the payment could not be completed.";
            log.info(`Store order ${storeOrderId} marked payment_failed via PaymentIntent ${paymentIntent.id}: ${failureMsg}`);

            // Load order for distributor + buyer notifications
            const [order] = await db
              .select()
              .from(orders)
              .where(eq(orders.id, storeOrderId))
              .limit(1);

            if (order) {
              // Audit
              auditLog({
                action: "order.payment_failed",
                userId: order.userId,
                resourceType: "order",
                resourceId: order.id,
                description: `Order ${order.orderNumber} payment failed: ${failureMsg}`,
                metadata: { paymentIntentId: paymentIntent.id, orderId: order.id, organizationId: order.organizationId, message: failureMsg },
              });

              // Notify distributor in-app
              const { notifyOwner } = await import("../_core/notification");
              await notifyOwner({
                userId: order.userId,
                organizationId: order.organizationId ?? undefined,
                type: "system",
                title: `Payment failed for order ${order.orderNumber}`,
                content: `Order ${order.orderNumber} could not be charged: ${failureMsg}. The buyer has been asked to retry.`,
                actionPath: `/store-management/${order.storeId ?? ""}`.replace(/\/$/, ""),
                actionLabel: "View Order",
                entityId: order.id,
                entityType: "order",
              });

              // Notify buyer by email so they can retry checkout
              const buyerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.buyer_email;
              if (buyerEmail) {
                try {
                  const { resolveTier3 } = await import("../email/brandingResolver");
                  const { buildEmailHtml } = await import("../email/emailTemplates/emailTemplateBase");
                  const tier3 = order.storeId
                    ? await resolveTier3({ storeId: order.storeId })
                    : { branding: { lane: "store" as const }, fromName: "MergeTasks", replyTo: undefined };
                  const html = buildEmailHtml({
                    branding: tier3.branding,
                    badge: { text: "Payment Failed", color: "#B91C1C", bgColor: "#FEF2F2" },
                    headline: `We couldn't process your payment for order ${order.orderNumber}`,
                    subheadline: failureMsg,
                    bodyParagraphs: [
                      "Your order has not been placed. Please return to checkout and try again with a different card or payment method.",
                      "If the problem persists, contact your account team for help.",
                    ],
                  });
                  const { sendEmail } = await import("../email/mailer");
                  await sendEmail(
                    buyerEmail,
                    `Payment failed — order ${order.orderNumber}`,
                    html,
                    tier3.fromName,
                    tier3.replyTo,
                  );
                } catch (emailErr) {
                  log.error(`Failed to send payment-failed email for order ${storeOrderId}:`, emailErr);
                }
              }
            }
          } else {
            log.info(`payment_intent.payment_failed: order ${storeOrderId} not in pending state, skipping`);
          }
        }
        break;
      }

      /**
       * CHARGE.REFUNDED — auto-records refunds initiated from the Stripe Dashboard.
       * This ensures that refunds made outside MergeTasks are still tracked in the
       * refund_history table and the entity's refundedAmount is updated.
       */
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId = charge.payment_intent as string | null;

        if (!piId) {
          log.info("charge.refunded: no payment_intent, skipping");
          break;
        }

        const refundsData = charge.refunds?.data || [];
        const latestRefund = refundsData[refundsData.length - 1] || null;
        const refundId: string | null = latestRefund?.id || null;
        const incrementalAmount: number = latestRefund?.amount || 0;
        const cumulativeRefunded: number = charge.amount_refunded || 0;
        const isFullRefund: boolean = charge.refunded === true;

        // Idempotency: check if we already recorded this specific refund
        if (refundId) {
          const [existing] = await db.select({ id: refundHistory.id }).from(refundHistory)
            .where(eq(refundHistory.stripeRefundId, refundId)).limit(1);
          if (existing) {
            log.info(`charge.refunded: refund ${refundId} already recorded (idempotent skip)`);
            break;
          }
        }

        // Try to match against proposals, orders, or invoices by stripePaymentIntentId
        let entityType: "proposal" | "order" | "invoice" | null = null;
        let entityId: number | null = null;
        let orgId: number | null = null;

        const [matchedProposal] = await db.select({ id: proposals.id, organizationId: proposals.organizationId })
          .from(proposals).where(eq(proposals.stripePaymentIntentId, piId)).limit(1);
        if (matchedProposal) {
          entityType = "proposal";
          entityId = matchedProposal.id;
          orgId = matchedProposal.organizationId;
        }

        if (!entityType) {
          const [matchedOrder] = await db.select({ id: orders.id, organizationId: orders.organizationId })
            .from(orders).where(eq(orders.stripePaymentIntentId, piId)).limit(1);
          if (matchedOrder) {
            entityType = "order";
            entityId = matchedOrder.id;
            orgId = matchedOrder.organizationId;
          }
        }

        if (!entityType) {
          const { invoices: invoicesTable } = await import("../../drizzle/schema");
          const [matchedInvoice] = await db.select({ id: invoicesTable.id, organizationId: invoicesTable.organizationId })
            .from(invoicesTable).where(eq(invoicesTable.stripePaymentIntentId, piId)).limit(1);
          if (matchedInvoice) {
            entityType = "invoice";
            entityId = matchedInvoice.id;
            orgId = matchedInvoice.organizationId;
          }
        }

        if (entityType && entityId) {
          await db.insert(refundHistory).values({
            organizationId: orgId,
            entityType,
            entityId,
            amount: incrementalAmount,
            currency: (charge.currency || "usd").toUpperCase(),
            type: isFullRefund ? "full" : "partial",
            reason: "Refund via Stripe Dashboard",
            stripeRefundId: refundId,
            stripePaymentIntentId: piId,
            status: "succeeded",
            processedBy: null,
          });

          if (entityType === "proposal") {
            await db.update(proposals).set({
              paymentRefunded: true,
              refundedAmount: cumulativeRefunded,
              refundedAt: new Date(),
              stripeRefundId: refundId,
            }).where(eq(proposals.id, entityId));
          } else if (entityType === "order") {
            const [ord] = await db.select({ total: orders.total }).from(orders).where(eq(orders.id, entityId)).limit(1);
            const orderTotalCents = Math.round(parseFloat(ord?.total?.toString() || "0") * 100);
            await db.update(orders).set({
              refundedAmount: cumulativeRefunded,
              refundedAt: new Date(),
              stripeRefundId: refundId,
              status: cumulativeRefunded >= orderTotalCents ? "refunded" : "partially_refunded",
            }).where(eq(orders.id, entityId));
          } else if (entityType === "invoice") {
            const { invoices: invoicesTable } = await import("../../drizzle/schema");
            const [inv] = await db.select({ total: invoicesTable.total }).from(invoicesTable).where(eq(invoicesTable.id, entityId)).limit(1);
            const invoiceTotalCents = Math.round(parseFloat(inv?.total?.toString() || "0") * 100);
            await db.update(invoicesTable).set({
              refundedAmount: cumulativeRefunded,
              refundedAt: new Date(),
              stripeRefundId: refundId,
              status: cumulativeRefunded >= invoiceTotalCents ? "refunded" : "partially_refunded",
            }).where(eq(invoicesTable.id, entityId));
          }

          auditLog({
            action: "refund.webhook.received",
            userId: null,
            resourceType: entityType,
            resourceId: entityId,
            description: `Stripe Dashboard refund of ${incrementalAmount} cents (cumulative: ${cumulativeRefunded}) on ${entityType} #${entityId}`,
            metadata: { stripeRefundId: refundId, incrementalAmount, cumulativeRefunded, piId },
          });

          log.info(`charge.refunded: recorded ${incrementalAmount} cents (cumulative: ${cumulativeRefunded}) on ${entityType} #${entityId}`);
        } else {
          log.info(`charge.refunded: no matching entity for PI ${piId}`);
        }
        break;
      }

      /**
       * Audit fix #18: CHECKOUT.SESSION.EXPIRED
       * When a Stripe Checkout session expires (default 24 h), restore inventory
       * for any store order that was created but never paid, and cancel the order.
       *
       * Without this handler, a buyer who abandons checkout permanently reduces the
       * available stock for other buyers because the inventory decrement in
       * createSession is never reversed.
       */
      case "checkout.session.expired": {
        const expiredSession = event.data.object as Stripe.Checkout.Session;
        const rawOrderId = expiredSession.metadata?.mergetasks_order_id;
        if (!rawOrderId) {
          log.info("checkout.session.expired: no mergetasks_order_id in metadata, skipping");
          break;
        }

        const expiredOrderId = parseInt(rawOrderId, 10);
        if (!expiredOrderId) break;

        // Only act on orders that are still "pending" (not yet paid or already cancelled)
        const [expiredOrder] = await db.select({ id: orders.id, status: orders.status, storeId: orders.storeId })
          .from(orders).where(eq(orders.id, expiredOrderId)).limit(1);

        if (!expiredOrder) {
          log.info(`checkout.session.expired: order ${expiredOrderId} not found`);
          break;
        }

        if (expiredOrder.status !== "pending") {
          log.info(`checkout.session.expired: order ${expiredOrderId} already in status '${expiredOrder.status}', skipping inventory restore`);
          break;
        }

        // ── Restore inventory for each line item ─────────────────────────────
        const expiredItems = await db.select({
          productId: orderItemsTable.productId,
          quantity: orderItemsTable.quantity,
        }).from(orderItemsTable).where(eq(orderItemsTable.orderId, expiredOrderId));

        for (const item of expiredItems) {
          // Only restore if the storeProduct has inventory tracking enabled
          const [sp] = await db.select({ id: storeProducts.id, trackInventory: storeProducts.trackInventory, stockQuantity: storeProducts.stockQuantity })
            .from(storeProducts)
            .where(and(eq(storeProducts.storeId, expiredOrder.storeId!), eq(storeProducts.productId, item.productId)))
            .limit(1);

          if (sp?.trackInventory && sp.stockQuantity !== null) {
            await db.update(storeProducts)
              .set({ stockQuantity: sp.stockQuantity + item.quantity })
              .where(eq(storeProducts.id, sp.id));
            log.info(`checkout.session.expired: restored ${item.quantity} units of product ${item.productId} for order ${expiredOrderId}`);
          }
        }

        // ── Cancel the order ──────────────────────────────────────────────────
        await db.update(orders)
          .set({ status: "cancelled" })
          .where(and(eq(orders.id, expiredOrderId), eq(orders.status, "pending")));

        auditLog({
          action: "order.expired",
          userId: null,
          resourceType: "order",
          resourceId: expiredOrderId,
          description: `Store order ${expiredOrderId} cancelled after Stripe checkout session expired`,
          metadata: { stripeSessionId: expiredSession.id, itemCount: expiredItems.length },
        });

        log.info(`checkout.session.expired: cancelled order ${expiredOrderId} and restored ${expiredItems.length} item type(s)`);
        break;
      }

      default:
        log.info(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    log.error("Error processing event:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }

  return res.json({ received: true });
}

// ─── Buyer Email Receipt ──────────────────────────────────────────────────────
// Sends a simple order confirmation email to the end-client after payment.
// This is a MergeTasks-branded receipt — Stripe may also send its own receipt
// if enabled on the connected account.

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendBuyerReceipt(db: MySql2Database, orderId: number, buyerEmail: string | null | undefined) {
  if (!buyerEmail) return;

  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return;

    // Load order items with product names
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const productIds = Array.from(new Set(items.map(i => i.productId)));
    const productRows = productIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const productMap = new Map(productRows.map(p => [p.id, p]));

    // Build a simple HTML receipt
    const itemRows = items.map(item => {
      const prod = productMap.get(item.productId);
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(prod?.name || `Product #${item.productId}`)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${item.unitPrice}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${item.totalPrice}</td>
      </tr>`;
    }).join("");

    // Read the store's configured currency (default USD if not configured or
    // if the order isn't tied to a store).
    let currency = "USD";
    if (order.storeId) {
      const { stores: storesTable } = await import("../../drizzle/schema");
      const [storeRow] = await db
        .select({ currency: storesTable.currency })
        .from(storesTable)
        .where(eq(storesTable.id, order.storeId))
        .limit(1);
      if (storeRow?.currency) currency = storeRow.currency.toUpperCase();
    }

    // Tier 3 branding — store/workstore → end-user. Never MergeTasks-branded.
    const { resolveTier3 } = await import("../email/brandingResolver");
    const { buildEmailHtml } = await import("../email/emailTemplates/emailTemplateBase");
    const tier3 = order.storeId
      ? await resolveTier3({ storeId: order.storeId })
      : { branding: { lane: "store" as const }, fromName: "MergeTasks", replyTo: undefined };

    const html = buildEmailHtml({
      branding: tier3.branding,
      badge: { text: "Order Confirmed" },
      headline: `Order ${order.orderNumber} received`,
      subheadline: "Thanks for your order — we'll be in touch as it progresses.",
      bodyParagraphs: [
        `Your order is being processed. You'll receive shipping updates when it's on the way.`,
      ],
      infoCard: {
        title: `Order #${order.orderNumber}`,
        meta: [
          { label: "Subtotal", value: `$${order.subtotal} ${currency}` },
          ...(parseFloat(order.tax || "0") > 0 ? [{ label: "Tax", value: `$${order.tax} ${currency}` }] : []),
          { label: "Total", value: `$${order.total} ${currency}` },
        ],
      },
      products: items.map((item) => {
        const prod = productMap.get(item.productId);
        return {
          name: escapeHtml(prod?.name || `Product #${item.productId}`),
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice),
        };
      }),
    });

    const { sendEmail } = await import("../email/mailer");
    await sendEmail(
      buyerEmail,
      `Order Confirmation — ${order.orderNumber}`,
      html,
      tier3.fromName,
      tier3.replyTo,
    );
    log.info(`Sent buyer receipt to ${buyerEmail} for order ${order.orderNumber}`);
  } catch (err) {
    // Non-blocking — don't fail the webhook if the email fails
    log.error(`Failed to send buyer receipt for order ${orderId}:`, err);
  }
}
