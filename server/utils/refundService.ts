import Stripe from "stripe"; // still needed for type references (Stripe.RefundCreateParams, etc.)
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { refundHistory, orders, invoices, proposals } from "../../drizzle/schema";
import { auditLog } from "./auditLog";
// Audit fix #13: use centralized getStripe() factory instead of module-level instantiation.
// This ensures ENV validation runs first and prevents silent key bypass in test environments.
import { getStripe } from "../stripe/stripeClient";

interface RefundParams {
  organizationId: number;
  entityType: "order" | "invoice" | "proposal";
  entityId: number;
  amount: number; // cents — 0 means full refund
  reason?: string;
  processedBy: number; // userId
  stripePaymentIntentId?: string;
  stripeConnectAccountId?: string; // for Connect refunds (store orders)
}

interface RefundResult {
  success: boolean;
  refundId?: string;
  amount?: number;
  error?: string;
}

/**
 * Central refund service — handles Stripe refund + audit log + refund history record.
 * QuickBooks credit memo sync is called by the consumer (router) after this returns.
 */
export async function processStripeRefund(params: RefundParams): Promise<RefundResult> {
  const {
    organizationId, entityType, entityId,
    amount, reason, processedBy,
    stripePaymentIntentId, stripeConnectAccountId,
  } = params;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Resolve the payment intent if not provided
  let piId = stripePaymentIntentId;
  if (!piId) {
    if (entityType === "order") {
      const [order] = await db.select({ pi: orders.stripePaymentIntentId })
        .from(orders).where(eq(orders.id, entityId)).limit(1);
      piId = order?.pi ?? undefined;
    } else if (entityType === "invoice") {
      const [inv] = await db.select({ pi: invoices.stripePaymentIntentId })
        .from(invoices).where(eq(invoices.id, entityId)).limit(1);
      piId = inv?.pi ?? undefined;
    } else if (entityType === "proposal") {
      const [prop] = await db.select({ pi: proposals.stripePaymentIntentId })
        .from(proposals).where(eq(proposals.id, entityId)).limit(1);
      piId = prop?.pi ?? undefined;
    }
  }

  if (!piId) {
    return { success: false, error: "No Stripe payment found for this entity" };
  }

  try {
    // Build refund params
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: piId,
      reason: "requested_by_customer",
    };

    // amount = 0 means full refund (Stripe default)
    if (amount > 0) {
      refundParams.amount = amount;
    }

    if (reason) {
      refundParams.metadata = { reason };
    }

    // If this is a Connect refund (store orders), use the connected account
    const stripeOptions: Stripe.RequestOptions = {};
    if (stripeConnectAccountId) {
      stripeOptions.stripeAccount = stripeConnectAccountId;
    }

    const refund = await getStripe().refunds.create(refundParams, stripeOptions);

    // Record in refund_history
    const refundAmount = refund.amount;
    const isFullRefund = amount === 0;

    await db.insert(refundHistory).values({
      organizationId,
      entityType,
      entityId,
      amount: refundAmount,
      currency: refund.currency.toUpperCase(),
      type: isFullRefund ? "full" : "partial",
      reason: reason ?? null,
      stripeRefundId: refund.id,
      stripePaymentIntentId: piId,
      status: refund.status === "succeeded" ? "succeeded" : "pending",
      processedBy,
    });

    // Audit log
    auditLog({
      action: "refund.issued",
      userId: processedBy,
      resourceType: entityType,
      resourceId: entityId,
      description: `${isFullRefund ? "Full" : "Partial"} refund of ${refundAmount} cents on ${entityType} #${entityId}`,
      metadata: {
        amount: refundAmount,
        stripeRefundId: refund.id,
        type: isFullRefund ? "full" : "partial",
        reason,
        organizationId,
      },
    });

    return {
      success: true,
      refundId: refund.id,
      amount: refundAmount,
    };
  } catch (err: unknown) {
    // Record failed attempt
    await db.insert(refundHistory).values({
      organizationId,
      entityType,
      entityId,
      amount: amount || 0,
      currency: "USD",
      type: amount === 0 ? "full" : "partial",
      reason: reason ?? null,
      stripePaymentIntentId: piId,
      status: "failed",
      processedBy,
    });

    return {
      success: false,
      error: err instanceof Error ? err.message : "Stripe refund failed",
    };
  }
}
