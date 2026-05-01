/**
 * storeCheckout.ts
 *
 * Handles CC payment collection from end-clients (store buyers) via Stripe Connect.
 *
 * Money flow:
 *   1. End-client enters CC on Stripe's hosted checkout page
 *   2. Stripe charges the end-client's card
 *   3. The full order amount lands in the DISTRIBUTOR's Stripe Express account
 *   4. MergeTasks automatically deducts its platform fee (application_fee_amount)
 *   5. The distributor's bank account receives the net amount on their payout schedule
 *
 * The distributor's bank account is NEVER exposed to MergeTasks.
 * MergeTasks NEVER touches the end-client's payment — Stripe handles it all.
 *
 * SECURITY: All pricing is resolved SERVER-SIDE from storeProducts/products.
 * Client-submitted unitPrice is IGNORED — only storeProductId + quantity are trusted.
 */

import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { router } from "../_core/trpc";
import { publicProcedure } from "../_core/trpc";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { PUBLIC_CHECKOUT_LIMIT, PUBLIC_STORE_READ_LIMIT } from "../utils/rateLimiter";
import { getDb } from "../db";
import {
  stores,
  storeProducts,
  products,
  orders,
  orderItems,
  users,
  storeUsers,
  storeDepartments,
  customOrderRequests,
  promoCodes,
  promoCodeUsages,
  productImprintZones,
  type InsertOrder,
  type InsertOrderItem,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../stripe/stripeVersion";
import { ENV } from "../_core/env";
import { getLogger } from "../utils/logger";

const log = getLogger("storeCheckout");
import { nanoid } from "nanoid";
import { jwtVerify } from "jose";
import { PLATFORM_FEE_PERCENT } from "./stripeConnect";
import { auditLog } from "../utils/auditLog";
import { resolvePricing } from "../utils/pricingResolver";

function getStripe(): Stripe {
  if (!ENV.stripeSecretKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Payment processing is not configured.",
    });
  }
  return new Stripe(ENV.stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
}

/**
 * Audit fix #15: Validate the redirect origin against an allowlist.
 * Without this, an attacker can supply an arbitrary origin (e.g. https://evil.com)
 * as the success_url/cancel_url, causing Stripe to redirect buyers to a phishing
 * site that captures the orderId from the URL query string.
 *
 * Allowed origins:
 *   1. The server's own APP_URL (configured in .env)
 *   2. localhost / 127.0.0.1 (development only, rejected in production)
 *   3. Vercel preview deployments (*.vercel.app) — optional, controlled by env
 */
function validateRedirectOrigin(origin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid redirect origin.",
    });
  }

  // Only allow https:// (and http://localhost in dev)
  const isLocalhost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";

  if (parsed.protocol !== "https:" && !(isLocalhost && !ENV.isProduction)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Redirect origin must use HTTPS.",
    });
  }

  // Build the allowlist from environment
  const appUrl = process.env.APP_BASE_URL || "";
  const extraOrigins = (process.env.ALLOWED_REDIRECT_ORIGINS || "").split(",").filter(Boolean);
  const allowedOrigins = new Set<string>();

  if (appUrl) {
    try { allowedOrigins.add(new URL(appUrl).origin); } catch { /* ignore malformed APP_URL */ }
  }
  // Allow Vercel preview deployments if configured
  if (process.env.ALLOW_VERCEL_PREVIEWS === "true") {
    if (parsed.hostname.endsWith(".vercel.app")) return; // allowed
  }
  for (const o of extraOrigins) {
    try { allowedOrigins.add(new URL(o.trim()).origin); } catch { /* ignore */ }
  }

  // In development with no APP_URL configured, allow localhost
  if (!ENV.isProduction && isLocalhost) return;

  // If APP_URL is configured, enforce the allowlist
  if (allowedOrigins.size > 0 && !allowedOrigins.has(parsed.origin)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Redirect origin is not in the allowed list.",
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a decimal string price to integer cents.
 * All money math is done in cents to avoid floating-point errors.
 */
function priceToCents(decimalStr: string | null | undefined): number {
  if (!decimalStr) return 0;
  // Parse as float then round to avoid "24.99" → 2498 issues
  return Math.round(parseFloat(decimalStr) * 100);
}

/**
 * Convert integer cents to a decimal string for DB storage.
 */
function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Format cents as a human-readable dollar string (e.g., "$1,234.56").
 * Used in budget/spending-limit error messages.
 */
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/**
 * Decode a store JWT token to identify the buyer (storeUser).
 * Returns null if the token is missing, invalid, or expired.
 * Uses the same secret as storeAuth / storePortalAuth.
 */
async function resolveStoreUserFromToken(
  token: string | undefined
): Promise<{ storeId: number; storeUserId: number; email: string; role: string } | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret + "_store");
    const { payload } = await jwtVerify(token, secret);
    return payload as { storeId: number; storeUserId: number; email: string; role: string };
  } catch {
    return null;
  }
}

// ─── Cart item schema ─────────────────────────────────────────────────────────
// NOTE: unitPrice is accepted for display purposes only — it is NEVER used for
// charging. The canonical price is always resolved server-side.

const cartItemSchema = z.object({
  storeProductId: z.number(),
  productId: z.number(),
  quantity: z.number().min(1),
  unitPrice: z.string().optional(), // ignored server-side — kept for backward compat
  decorationType: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  // Imprint zone + decoration method — buyer-selected on the PDP. Both
  // are resolved into canonical references at order-insert time:
  // imprintZoneSlug → orderItems.imprintZoneId (FK lookup scoped by productId).
  // decorationMethod → orderItems.decorationType (the existing string column).
  imprintZoneSlug: z.string().optional(),
  decorationMethod: z.string().optional(),
});

// ─── Promo Code Validation Helper ────────────────────────────────────────────

type PromoValidationResult = {
  valid: boolean;
  discountCents: number;
  reason?: string;
  promoCode?: typeof promoCodes.$inferSelect;
};

async function validateAndApplyPromo(
  db: Awaited<ReturnType<typeof getDb>> & {},
  storeId: number,
  code: string,
  subtotalCents: number,
  storeUserId: number | null,
): Promise<PromoValidationResult> {
  const [promo] = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.storeId, storeId),
        eq(promoCodes.isActive, true),
      )
    )
    .then(rows => rows.filter(r => r.code.toLowerCase() === code.toLowerCase()));

  if (!promo) {
    return { valid: false, discountCents: 0, reason: "Invalid promo code." };
  }

  // Check active
  if (!promo.isActive) {
    return { valid: false, discountCents: 0, reason: "This promo code is no longer active." };
  }

  // Check dates
  const now = new Date();
  if (promo.startsAt && now < promo.startsAt) {
    return { valid: false, discountCents: 0, reason: "This promo code is not yet active." };
  }
  if (promo.expiresAt && now > promo.expiresAt) {
    return { valid: false, discountCents: 0, reason: "This promo code has expired." };
  }

  // Check global usage limit
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    return { valid: false, discountCents: 0, reason: "This promo code has reached its usage limit." };
  }

  // Check minimum order amount
  if (promo.minOrderAmount) {
    const minCents = priceToCents(promo.minOrderAmount);
    if (subtotalCents < minCents) {
      return {
        valid: false,
        discountCents: 0,
        reason: `Minimum order amount of ${formatCents(minCents)} required.`,
      };
    }
  }

  // Check per-user usage
  if (storeUserId && promo.maxUsesPerUser !== null) {
    const userUsages = await db
      .select()
      .from(promoCodeUsages)
      .where(
        and(
          eq(promoCodeUsages.promoCodeId, promo.id),
          eq(promoCodeUsages.storeUserId, storeUserId),
        )
      );
    if (userUsages.length >= promo.maxUsesPerUser) {
      return { valid: false, discountCents: 0, reason: "You've already used this promo code." };
    }
  }

  // Calculate discount
  let discountCents = 0;
  if (promo.discountType === "percentage") {
    const pct = parseFloat(promo.discountValue);
    discountCents = Math.round(subtotalCents * (pct / 100));
    // Cap at maxDiscountAmount
    if (promo.maxDiscountAmount) {
      const maxCents = priceToCents(promo.maxDiscountAmount);
      if (discountCents > maxCents) discountCents = maxCents;
    }
  } else {
    discountCents = priceToCents(promo.discountValue);
  }

  // Don't discount more than the subtotal
  if (discountCents > subtotalCents) discountCents = subtotalCents;

  return { valid: true, discountCents, promoCode: promo };
}

export const storeCheckoutRouter = router({
  /**
   * Create a Stripe Checkout Session for a store order.
   *
   * Called when an end-client clicks "Pay by Credit Card" at checkout.
   * Returns a Stripe-hosted checkout URL.
   *
   * The payment goes DIRECTLY to the distributor's connected Stripe account.
   * MergeTasks takes its platform fee automatically.
   */
  createSession: publicProcedure
    .use(rateLimited("storeCheckoutCreate", PUBLIC_CHECKOUT_LIMIT))
    .input(
      z.object({
        storeSlug: z.string(),
        items: z.array(cartItemSchema).min(1),
        shippingName: z.string().optional(),
        shippingAddress: z.string().optional(),
        buyerEmail: z.string().email().optional(),
        /** Frontend origin for redirect URLs */
        origin: z.string(),
        /** JWT token from storeAuth (identifies the buyer) */
        storeToken: z.string().optional(),
        /** Optional promo code to apply */
        promoCode: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Audit fix #15: validate the redirect origin BEFORE any DB work so an
      // attacker cannot use an invalid origin to redirect buyers to a phishing site.
      validateRedirectOrigin(input.origin);

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const stripe = getStripe();

      // ── 1. Load the store and verify it exists and is active ──────────────
      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.slug, input.storeSlug), eq(stores.status, "active")))
        .limit(1);

      if (!store) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found or not active." });
      }

      // Per-store currency — read from stores.currency (defaults to "usd").
      const currency = (store.currency || "usd").toLowerCase();

      // ── 2. Load the distributor's Stripe Connect account ──────────────────
      const [distributor] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          stripeConnectAccountId: users.stripeConnectAccountId,
          stripeConnectChargesEnabled: users.stripeConnectChargesEnabled,
          stripeConnectPayoutsEnabled: users.stripeConnectPayoutsEnabled,
        })
        .from(users)
        .where(eq(users.id, store.userId))
        .limit(1);

      if (!distributor) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store owner not found." });
      }

      // ── 3. Verify the distributor has completed Stripe Connect onboarding ─
      // Return a friendly "payment setup coming soon" signal instead of hard-failing
      // so the storefront can render a helpful message without crashing.
      if (!distributor.stripeConnectAccountId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Payment setup coming soon — this store isn't ready to accept online payments yet. Please check back later or contact the store.",
        });
      }

      if (!distributor.stripeConnectChargesEnabled || !distributor.stripeConnectPayoutsEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Payment setup coming soon — the store is finishing payment setup. Please check back soon.",
        });
      }

      // ── 4. SERVER-SIDE PRICE LOOKUP (Critical Fix #1 + #5) ────────────────
      // Load all storeProducts and products in a SINGLE query each (no N+1).
      // Client-submitted unitPrice is IGNORED — canonical price is authoritative.

      const storeProductIds = input.items.map((i) => i.storeProductId);
      const productIds = Array.from(new Set(input.items.map((i) => i.productId)));

      const [spRows, productRows] = await Promise.all([
        db
          .select()
          .from(storeProducts)
          .where(
            and(
              inArray(storeProducts.id, storeProductIds),
              eq(storeProducts.storeId, store.id)
            )
          ),
        db
          .select()
          .from(products)
          .where(inArray(products.id, productIds)),
      ]);

      const spMap = new Map(spRows.map((sp) => [sp.id, sp]));
      const productMap = new Map(productRows.map((p) => [p.id, p]));

      // ── 5. Build Stripe line items with SERVER-SIDE pricing ───────────────
      type LineItem = {
        price_data: {
          currency: string;
          product_data: { name: string; description?: string; images?: string[] };
          unit_amount: number;
        };
        quantity: number;
      };

      const lineItems: LineItem[] = [];
      let subtotalCents = 0;

      // Resolved items for order record (with server-side prices)
      const resolvedItems: Array<{
        productId: number;
        quantity: number;
        unitPriceCents: number;
        decorationType: string | null;
        size: string | null;
        color: string | null;
        productName: string;
        imprintZoneSlug: string | null;
        decorationMethod: string | null;
      }> = [];

      for (const item of input.items) {
        const sp = spMap.get(item.storeProductId);
        const product = productMap.get(item.productId);

        if (!sp || !product) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Product #${item.productId} (store product #${item.storeProductId}) is not available in this store.`,
          });
        }

        // Canonical price: storeProducts.customPrice > products.basePrice
        // NEVER use client-submitted unitPrice
        let canonicalPriceCents: number;
        try {
          const resolved = await resolvePricing({
            clientId: store.clientId,
            productId: item.productId,
            quantity: item.quantity,
            variantKey: item.color ? `color:${item.color}` : (item.size ? `size:${item.size}` : null),
            decorationMethodId: null,
            includeOtherCosts: false,
          });
          canonicalPriceCents = resolved.unitPriceCents + resolved.variantUpchargeCents;
        } catch {
          // PricingNotFoundError — no client pricing and no basePrice configured
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Product "${product.name}" has no valid price configured.`,
          });
        }

        if (canonicalPriceCents <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Product "${product.name}" has no valid price configured.`,
          });
        }

        const lineTotalCents = canonicalPriceCents * item.quantity;
        subtotalCents += lineTotalCents;

        lineItems.push({
          price_data: {
            currency,
            product_data: {
              name: product.name ?? `Product #${item.productId}`,
              description: item.decorationType ? `Decoration: ${item.decorationType}` : undefined,
              images: product.imageUrl ? [product.imageUrl] : undefined,
            },
            unit_amount: canonicalPriceCents,
          },
          quantity: item.quantity,
        });

        resolvedItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPriceCents: canonicalPriceCents,
          decorationType: item.decorationType ?? null,
          size: item.size ?? null,
          color: item.color ?? null,
          productName: product.name ?? `Product #${item.productId}`,
          imprintZoneSlug: item.imprintZoneSlug ?? null,
          decorationMethod: item.decorationMethod ?? null,
        });
      }

      // ── 5b. BUDGET & SPENDING-LIMIT ENFORCEMENT (Mock-to-Real Guide, Step 6) ──
      // All enforcement is server-side — the client cannot bypass any of these.
      // Decode the buyer's JWT to load their storeUser record.
      const buyerPayload = await resolveStoreUserFromToken(input.storeToken);
      let buyerStoreUser: typeof storeUsers.$inferSelect | null = null;

      if (buyerPayload) {
        const [su] = await db
          .select()
          .from(storeUsers)
          .where(
            and(
              eq(storeUsers.id, buyerPayload.storeUserId),
              eq(storeUsers.storeId, store.id)
            )
          )
          .limit(1);
        buyerStoreUser = su ?? null;
      }

      if (store.requireAuth && !buyerPayload) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in to place an order." });
      }

      if (buyerStoreUser) {
        // 1. Per-user spending limit (from storeUsers.spendingLimit)
        if (buyerStoreUser.spendingLimit !== null) {
          const limitCents = priceToCents(buyerStoreUser.spendingLimit);
          if (limitCents > 0 && subtotalCents > limitCents) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `SPENDING_LIMIT: Order total (${formatCents(subtotalCents)}) exceeds your per-order spending limit of ${formatCents(limitCents)}.`,
            });
          }
        }

        // 2. Department budget check (from storeDepartments)
        if (buyerStoreUser.departmentId) {
          const [dept] = await db
            .select()
            .from(storeDepartments)
            .where(
              and(
                eq(storeDepartments.id, buyerStoreUser.departmentId),
                eq(storeDepartments.isActive, true)
              )
            )
            .limit(1);

          if (dept && dept.budgetCents > 0) {
            const remaining = dept.budgetCents - dept.spentCents;
            if (subtotalCents > remaining) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `BUDGET_EXCEEDED: Order total (${formatCents(subtotalCents)}) exceeds remaining department budget of ${formatCents(remaining)}.`,
              });
            }
            // 2b. Department per-order cap
            if (dept.maxPerOrderCents !== null && subtotalCents > dept.maxPerOrderCents) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `BUDGET_EXCEEDED: Order total (${formatCents(subtotalCents)}) exceeds department per-order cap of ${formatCents(dept.maxPerOrderCents)}.`,
              });
            }
          }
        }

        log.info(
          `Budget checks passed for storeUser ${buyerStoreUser.id} ` +
          `(dept=${buyerStoreUser.departmentId ?? "none"}, limit=${buyerStoreUser.spendingLimit ?? "none"}, ` +
          `subtotal=${formatCents(subtotalCents)})`
        );
      }

      // ── 5c. PROMO CODE VALIDATION ────────────────────────────────────────
      let promoDiscountCents = 0;
      let appliedPromoCode: typeof promoCodes.$inferSelect | null = null;

      if (input.promoCode) {
        const promoResult = await validateAndApplyPromo(
          db, store.id, input.promoCode, subtotalCents, buyerStoreUser?.id ?? null
        );
        if (!promoResult.valid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: promoResult.reason! });
        }
        promoDiscountCents = promoResult.discountCents;
        appliedPromoCode = promoResult.promoCode!;
      }

      const finalSubtotalCents = subtotalCents - promoDiscountCents;

      // ── 6. Calculate platform fee (all in integer cents) ──────────────────
      const platformFeeCents = Math.round(finalSubtotalCents * PLATFORM_FEE_PERCENT);

      // ── 7. Create a pending order record ──────────────────────────────────
      const orderNumber = `MT-${nanoid(8).toUpperCase()}`;

      const orderValues: InsertOrder = {
        userId: store.userId,
        clientId: store.clientId,
        storeId: store.id,
        storeUserId: buyerStoreUser?.id ?? null,
        orderNumber,
        status: "pending",
        subtotal: centsToDecimal(subtotalCents),
        tax: "0.00",
        shipping: "0.00",
        total: centsToDecimal(finalSubtotalCents),
        shippingName: input.shippingName ?? null,
        shippingAddress: input.shippingAddress ?? null,
        paymentMethod: "credit_card",
        paymentReference: null,
        stripeConnectAccountId: distributor.stripeConnectAccountId,
        platformFeeAmount: centsToDecimal(platformFeeCents),
        promoCodeId: appliedPromoCode?.id ?? null,
        discountAmount: promoDiscountCents > 0 ? centsToDecimal(promoDiscountCents) : null,
        organizationId: store.organizationId,
      };
      // Resolve imprintZoneSlug → imprintZoneId for all items that carry a
      // zone selection. One batched query (not N+1) keyed by (productId, slug).
      // The map uses `${productId}:${slug}` because the same slug may exist
      // on multiple products (e.g. two products both have "left-chest"), and
      // only the zone whose productId matches the cart row is the right one.
      const zoneMap = new Map<string, number>();
      const zoneLookupSlugs = resolvedItems
        .filter(i => i.imprintZoneSlug)
        .map(i => ({ productId: i.productId, slug: i.imprintZoneSlug! }));
      if (zoneLookupSlugs.length > 0) {
        const zoneRows = await db
          .select({
            id: productImprintZones.id,
            productId: productImprintZones.productId,
            slug: productImprintZones.slug,
          })
          .from(productImprintZones)
          .where(and(
            inArray(productImprintZones.productId, zoneLookupSlugs.map(k => k.productId)),
            inArray(productImprintZones.slug, zoneLookupSlugs.map(k => k.slug)),
          ));
        for (const z of zoneRows) {
          zoneMap.set(`${z.productId}:${z.slug}`, z.id);
        }
      }

      const { orderId } = await db.transaction(async (tx) => {
        const orderResult = await tx.insert(orders).values(orderValues);
        const newOrderId = orderResult[0].insertId;

        // Insert order items with SERVER-SIDE prices (integer math)
        const itemValues: InsertOrderItem[] = resolvedItems.map((item) => ({
          orderId: newOrderId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: centsToDecimal(item.unitPriceCents),
          totalPrice: centsToDecimal(item.unitPriceCents * item.quantity),
          // decorationMethod (new PDP field) and decorationType (legacy) both
          // land in orderItems.decorationType. Prefer the new field when set.
          decorationType: item.decorationMethod ?? item.decorationType,
          size: item.size,
          color: item.color,
          imprintZoneId: item.imprintZoneSlug
            ? zoneMap.get(`${item.productId}:${item.imprintZoneSlug}`) ?? null
            : null,
        }));

        if (itemValues.length > 0) {
          await tx.insert(orderItems).values(itemValues);
        }
        return { orderId: newOrderId };
      });

      // ── 8. Create the Stripe Checkout Session ─────────────────────────────
      // If a promo code discount exists, create a one-time Stripe coupon
      let stripeDiscounts: Array<{ coupon: string }> = [];
      if (promoDiscountCents > 0 && appliedPromoCode) {
        const coupon = await stripe.coupons.create(
          {
            amount_off: promoDiscountCents,
            currency,
            duration: "once",
            name: `Promo: ${appliedPromoCode.code}`,
          },
          { stripeAccount: distributor.stripeConnectAccountId }
        );
        stripeDiscounts = [{ coupon: coupon.id }];
      }

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: lineItems,
          ...(stripeDiscounts.length > 0 ? { discounts: stripeDiscounts } : {}),
          // Critical Fix #2: Enable Stripe Tax for automatic tax calculation.
          // Requires Stripe Tax to be enabled on the connected account.
          // If not enabled, Stripe will skip tax calculation gracefully.
          automatic_tax: { enabled: true },
          payment_intent_data: {
            application_fee_amount: platformFeeCents,
            metadata: {
              mergetasks_order_id: orderId.toString(),
              mergetasks_order_number: orderNumber,
              store_id: store.id.toString(),
              store_slug: store.slug,
              distributor_user_id: store.userId.toString(),
              // Budget tracking: store user ID for post-order hooks (Step 7)
              store_user_id: buyerStoreUser?.id?.toString() ?? "",
            },
          },
          customer_email: input.buyerEmail ?? undefined,
          client_reference_id: `store_order_${orderId}`,
          // Audit fix #15: origin is validated above before use in redirect URLs
          success_url: `${input.origin}/store/${input.storeSlug}/order-confirmation?orderId=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${input.origin}/store/${input.storeSlug}/cart?canceled=1`,
          metadata: {
            mergetasks_order_id: orderId.toString(),
            mergetasks_order_number: orderNumber,
            store_id: store.id.toString(),
            store_slug: store.slug,
            distributor_user_id: store.userId.toString(),
            store_user_id: buyerStoreUser?.id?.toString() ?? "",
          },
        },
        {
          stripeAccount: distributor.stripeConnectAccountId,
        }
      );

      // Save the Stripe session ID to the order for tracking
      await db
        .update(orders)
        .set({ stripePaymentIntentId: session.id })
        .where(eq(orders.id, orderId));

      // Track promo code usage
      if (appliedPromoCode && buyerStoreUser) {
        await db.update(promoCodes)
          .set({ usedCount: (appliedPromoCode.usedCount ?? 0) + 1 })
          .where(eq(promoCodes.id, appliedPromoCode.id));
        await db.insert(promoCodeUsages).values({
          promoCodeId: appliedPromoCode.id,
          storeUserId: buyerStoreUser.id,
          orderId,
          discountApplied: centsToDecimal(promoDiscountCents),
        });
      }

      // ── 8b. INVENTORY DECREMENT (CR8 fix: moved AFTER Stripe session) ───
      // Stripe session is created first (external call, no local mutation).
      // If inventory check fails, the pending order is deleted and the
      // Stripe session simply expires — no money is captured.
      const inventoryTrackedItems = resolvedItems.filter((item) => {
        const sp = spMap.get(
          input.items.find((i) => i.productId === item.productId)?.storeProductId ?? 0
        );
        return sp?.trackInventory;
      });

      if (inventoryTrackedItems.length > 0) {
        const { getPool } = await import("../db");
        const pool = getPool();
        if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB pool unavailable" });
        const conn = await pool.getConnection();

        const SP_TABLE = storeProducts._.name ?? "storeProducts";

        try {
          await conn.beginTransaction();

          for (const item of inventoryTrackedItems) {
            const spId = input.items.find((i) => i.productId === item.productId)?.storeProductId;
            if (!spId) continue;

            const [rows] = await conn.execute(
              `SELECT stockQuantity FROM \`${SP_TABLE}\` WHERE id = ? FOR UPDATE`,
              [spId]
            );
            const row = (rows as Array<{ stockQuantity: number | null }>)[0];
            if (!row || row.stockQuantity === null) continue;

            if (row.stockQuantity < item.quantity) {
              await conn.rollback();
              // CR8: Clean up the pending order since inventory is insufficient
              await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
              await db.delete(orders).where(eq(orders.id, orderId));
              throw new TRPCError({
                code: "CONFLICT",
                message: `"${item.productName}" only has ${row.stockQuantity} unit(s) in stock (requested ${item.quantity}).`,
              });
            }

            await conn.execute(
              `UPDATE \`${SP_TABLE}\` SET stockQuantity = stockQuantity - ? WHERE id = ?`,
              [item.quantity, spId]
            );
          }

          await conn.commit();
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          await conn.rollback();
          // CR8: Clean up the pending order on unexpected inventory errors
          await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
          await db.delete(orders).where(eq(orders.id, orderId));
          throw err;
        } finally {
          conn.release();
        }
      }

      log.info(
        `Created store checkout session ${session.id} for order ${orderNumber} ` +
          `→ distributor account ${distributor.stripeConnectAccountId} ` +
          `(subtotal: ${centsToDecimal(subtotalCents)} ${currency.toUpperCase()}, ` +
          `platform fee: ${centsToDecimal(platformFeeCents)})`
      );
      auditLog({
        action: "stripe.checkout.created",
        userId: null,
        resourceType: "order",
        resourceId: orderNumber,
        description: `Checkout session ${session.id} for order ${orderNumber} → distributor ${distributor.stripeConnectAccountId}`,
        metadata: {
          sessionId: session.id,
          connectedAccount: distributor.stripeConnectAccountId,
          platformFeeCents,
          subtotalCents,
          currency: currency.toUpperCase(),
        },
      });

      // Auto-generate purchase orders in background (non-blocking)
      // Delegates to shared utility — handles idempotency, AI grouping, supplier directory.
      setImmediate(async () => {
        try {
          const { generatePOsForOrder } = await import("../utils/generatePOsForOrder");
          const { notifyOwner } = await import("../_core/notification");
          const result = await generatePOsForOrder(store.userId, store.organizationId, orderId);
          if (result && result.totalPOs > 0) {
            await notifyOwner({
              userId: store.userId,
              organizationId: store.organizationId ?? undefined,
              type: "po_created",
              title: `${result.totalPOs} PO${result.totalPOs > 1 ? "s" : ""} Auto-Generated`,
              content: `Store order #${orderNumber} — ${result.totalPOs} purchase orders ready for review`,
              actionPath: `/purchase-orders?orderId=${orderId}`,
              actionLabel: "View POs",
              entityId: orderId, entityType: "order",
            });
          }
        } catch (err) {
          log.warn(`Auto-PO generation failed for order ${orderNumber}:`, err);
        }
      });

      return {
        url: session.url,
        orderId,
        orderNumber,
        sessionId: session.id,
      };
    }),

  /**
   * Verify a completed checkout session and confirm the order.
   * Called from the success page after Stripe redirects back.
   */
  verifySession: publicProcedure
    .use(rateLimited("storeCheckoutVerify", PUBLIC_STORE_READ_LIMIT))
    .input(
      z.object({
        storeSlug: z.string(),
        orderId: z.number(),
        sessionId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Audit fix #20: verify the storeSlug matches the order's store BEFORE
      // returning any order data. Without this check, an attacker who knows any
      // orderId can call verifySession with their own storeSlug and see another
      // store's order details (cross-store data leakage).
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(eq(stores.slug, input.storeSlug), eq(stores.status, "active")))
        .limit(1);

      if (!store) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
      }

      // Load the order, scoped to the verified store
      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.storeId, store.id)))
        .limit(1);

      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
      }

      // Verify the session ID matches
      if (order.stripePaymentIntentId !== input.sessionId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Session mismatch." });
      }

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total?.toString() ?? "0",
        paymentConfirmed: order.status !== "pending",
      };
    }),

  /**
   * Get branch locations for a store (public — used by checkout page).
   */
  getBranchLocations: publicProcedure
    .use(rateLimited("storeGetBranchLocations", PUBLIC_STORE_READ_LIMIT))
    .input(z.object({ storeSlug: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [store] = await db
        .select({ branchLocations: stores.branchLocations })
        .from(stores)
        .where(and(eq(stores.slug, input.storeSlug), eq(stores.status, "active")))
        .limit(1);

      if (!store) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found or not active." });
      }

      return (store.branchLocations as Array<{ id: string; name: string; address: string; isDefault?: boolean }>) ?? [];
    }),

  /**
   * Create a direct order (PO / GL Code / Company Points) — no Stripe involved.
   *
   * Replicates the same server-side price resolution, budget enforcement,
   * inventory decrement, and post-order hooks from createSession.
   */
  createDirectOrder: publicProcedure
    .use(rateLimited("storeCheckoutDirect", PUBLIC_CHECKOUT_LIMIT))
    .input(
      z.object({
        storeSlug: z.string(),
        items: z.array(cartItemSchema).min(1),
        paymentMethod: z.enum(["po_number", "gl_code", "company_points"]),
        // PO fields
        poNumber: z.string().optional(),
        glCode: z.string().optional(),
        branchAllocation: z.array(z.object({
          branchId: z.string(),
          percentage: z.number().min(0).max(100),
        })).optional(),
        // Addresses
        billingAddress: z.string().optional(),
        shippingBranchId: z.string().optional(),
        shippingName: z.string().optional(),
        shippingAddress: z.string().optional(),
        // Auth
        storeToken: z.string().optional(),
        buyerEmail: z.string().email().optional(),
        /** Optional promo code to apply */
        promoCode: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // ── 1. Validate PO/GL fields ─────────────────────────────────────────
      if (input.paymentMethod === "po_number" && !input.poNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "PO number is required for purchase order payments." });
      }
      if (input.paymentMethod === "gl_code" && !input.glCode) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "GL code is required for GL code payments." });
      }

      // ── 2. Load the store and verify it exists and is active ─────────────
      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.slug, input.storeSlug), eq(stores.status, "active")))
        .limit(1);

      if (!store) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found or not active." });
      }

      // ── 3. Load the distributor (store owner) ────────────────────────────
      const [distributor] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, store.userId))
        .limit(1);

      if (!distributor) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store owner not found." });
      }

      // ── 4. SERVER-SIDE PRICE RESOLUTION ──────────────────────────────────
      const storeProductIds = input.items.map((i) => i.storeProductId);
      const productIds = Array.from(new Set(input.items.map((i) => i.productId)));

      const [spRows, productRows] = await Promise.all([
        db
          .select()
          .from(storeProducts)
          .where(
            and(
              inArray(storeProducts.id, storeProductIds),
              eq(storeProducts.storeId, store.id)
            )
          ),
        db
          .select()
          .from(products)
          .where(inArray(products.id, productIds)),
      ]);

      const spMap = new Map(spRows.map((sp) => [sp.id, sp]));
      const productMap = new Map(productRows.map((p) => [p.id, p]));

      let subtotalCents = 0;
      const resolvedItems: Array<{
        productId: number;
        quantity: number;
        unitPriceCents: number;
        decorationType: string | null;
        size: string | null;
        color: string | null;
        productName: string;
        imprintZoneSlug: string | null;
        decorationMethod: string | null;
      }> = [];

      for (const item of input.items) {
        const sp = spMap.get(item.storeProductId);
        const product = productMap.get(item.productId);

        if (!sp || !product) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Product #${item.productId} (store product #${item.storeProductId}) is not available in this store.`,
          });
        }

        let canonicalPriceCents: number;
        try {
          const resolved = await resolvePricing({
            clientId: store.clientId,
            productId: item.productId,
            quantity: item.quantity,
            variantKey: item.color ? `color:${item.color}` : (item.size ? `size:${item.size}` : null),
            decorationMethodId: null,
            includeOtherCosts: false,
          });
          canonicalPriceCents = resolved.unitPriceCents + resolved.variantUpchargeCents;
        } catch {
          // PricingNotFoundError — no client pricing and no basePrice configured
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Product "${product.name}" has no valid price configured.`,
          });
        }

        if (canonicalPriceCents <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Product "${product.name}" has no valid price configured.`,
          });
        }

        subtotalCents += canonicalPriceCents * item.quantity;

        resolvedItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPriceCents: canonicalPriceCents,
          decorationType: item.decorationType ?? null,
          size: item.size ?? null,
          color: item.color ?? null,
          productName: product.name ?? `Product #${item.productId}`,
          imprintZoneSlug: item.imprintZoneSlug ?? null,
          decorationMethod: item.decorationMethod ?? null,
        });
      }

      // ── 5. BUDGET & SPENDING-LIMIT ENFORCEMENT ───────────────────────────
      const buyerPayload = await resolveStoreUserFromToken(input.storeToken);
      let buyerStoreUser: typeof storeUsers.$inferSelect | null = null;

      if (buyerPayload) {
        const [su] = await db
          .select()
          .from(storeUsers)
          .where(
            and(
              eq(storeUsers.id, buyerPayload.storeUserId),
              eq(storeUsers.storeId, store.id)
            )
          )
          .limit(1);
        buyerStoreUser = su ?? null;
      }

      if (buyerStoreUser) {
        // Per-user spending limit
        if (buyerStoreUser.spendingLimit !== null) {
          const limitCents = priceToCents(buyerStoreUser.spendingLimit);
          if (limitCents > 0 && subtotalCents > limitCents) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `SPENDING_LIMIT: Order total (${formatCents(subtotalCents)}) exceeds your per-order spending limit of ${formatCents(limitCents)}.`,
            });
          }
        }

        // Department budget check
        if (buyerStoreUser.departmentId) {
          const [dept] = await db
            .select()
            .from(storeDepartments)
            .where(
              and(
                eq(storeDepartments.id, buyerStoreUser.departmentId),
                eq(storeDepartments.isActive, true)
              )
            )
            .limit(1);

          if (dept && dept.budgetCents > 0) {
            const remaining = dept.budgetCents - dept.spentCents;
            if (subtotalCents > remaining) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `BUDGET_EXCEEDED: Order total (${formatCents(subtotalCents)}) exceeds remaining department budget of ${formatCents(remaining)}.`,
              });
            }
            if (dept.maxPerOrderCents !== null && subtotalCents > dept.maxPerOrderCents) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `BUDGET_EXCEEDED: Order total (${formatCents(subtotalCents)}) exceeds department per-order cap of ${formatCents(dept.maxPerOrderCents)}.`,
              });
            }
          }
        }

        // Points balance check
        if (input.paymentMethod === "company_points") {
          if ((buyerStoreUser.pointsBalance ?? 0) < subtotalCents) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `INSUFFICIENT_POINTS: Your points balance (${buyerStoreUser.pointsBalance ?? 0}) is insufficient for this order (${subtotalCents} points required).`,
            });
          }

          // Deduct points atomically
          const { getPool } = await import("../db");
          const pool = getPool();
          if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB pool unavailable" });
          await pool.execute(
            `UPDATE storeUsers SET pointsBalance = pointsBalance - ? WHERE id = ? AND pointsBalance >= ?`,
            [subtotalCents, buyerStoreUser.id, subtotalCents]
          );
        }

        log.info(
          `Budget checks passed for storeUser ${buyerStoreUser.id} ` +
          `(dept=${buyerStoreUser.departmentId ?? "none"}, limit=${buyerStoreUser.spendingLimit ?? "none"}, ` +
          `subtotal=${formatCents(subtotalCents)})`
        );
      }

      // ── 5b. PROMO CODE VALIDATION ──────────────────────────────────────
      let promoDiscountCents = 0;
      let appliedPromoCode: typeof promoCodes.$inferSelect | null = null;

      if (input.promoCode) {
        const promoResult = await validateAndApplyPromo(
          db, store.id, input.promoCode, subtotalCents, buyerStoreUser?.id ?? null
        );
        if (!promoResult.valid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: promoResult.reason! });
        }
        promoDiscountCents = promoResult.discountCents;
        appliedPromoCode = promoResult.promoCode!;
      }

      const finalSubtotalCents = subtotalCents - promoDiscountCents;

      // ── 6. Validate branch location ──────────────────────────────────────
      let resolvedShippingAddress = input.shippingAddress ?? null;
      let resolvedShippingName = input.shippingName ?? null;
      if (input.shippingBranchId && store.branchLocations) {
        const branches = store.branchLocations as Array<{ id: string; name: string; address: string; isDefault?: boolean }>;
        const branch = branches.find((b) => b.id === input.shippingBranchId);
        if (!branch) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Selected shipping location is not valid for this store." });
        }
        resolvedShippingAddress = branch.address;
        resolvedShippingName = branch.name;
      }

      // ── 7. Determine payment reference ───────────────────────────────────
      const paymentReference =
        input.paymentMethod === "po_number" ? input.poNumber ?? null :
        input.paymentMethod === "gl_code" ? input.glCode ?? null :
        input.paymentMethod === "company_points" ? `${subtotalCents} points` :
        null;

      // ── 8. Create order ──────────────────────────────────────────────────
      const orderNumber = `MT-${nanoid(8).toUpperCase()}`;

      const orderValues: InsertOrder = {
        userId: store.userId,
        clientId: store.clientId,
        storeId: store.id,
        storeUserId: buyerStoreUser?.id ?? null,
        orderNumber,
        status: "processing",
        subtotal: centsToDecimal(subtotalCents),
        tax: "0.00",
        shipping: "0.00",
        total: centsToDecimal(finalSubtotalCents),
        shippingName: resolvedShippingName,
        shippingAddress: resolvedShippingAddress,
        billingAddress: input.billingAddress ?? null,
        branchLocationId: input.shippingBranchId ?? null,
        glCode: input.glCode ?? null,
        branchAllocation: input.branchAllocation ?? null,
        paymentMethod: input.paymentMethod,
        paymentReference,
        stripeConnectAccountId: null,
        platformFeeAmount: null,
        promoCodeId: appliedPromoCode?.id ?? null,
        discountAmount: promoDiscountCents > 0 ? centsToDecimal(promoDiscountCents) : null,
        organizationId: store.organizationId,
      };

      // Resolve imprintZoneSlug → imprintZoneId (see createSession for the
      // rationale on batching + the `${productId}:${slug}` map key).
      const zoneMap = new Map<string, number>();
      const zoneLookupSlugs = resolvedItems
        .filter(i => i.imprintZoneSlug)
        .map(i => ({ productId: i.productId, slug: i.imprintZoneSlug! }));
      if (zoneLookupSlugs.length > 0) {
        const zoneRows = await db
          .select({
            id: productImprintZones.id,
            productId: productImprintZones.productId,
            slug: productImprintZones.slug,
          })
          .from(productImprintZones)
          .where(and(
            inArray(productImprintZones.productId, zoneLookupSlugs.map(k => k.productId)),
            inArray(productImprintZones.slug, zoneLookupSlugs.map(k => k.slug)),
          ));
        for (const z of zoneRows) {
          zoneMap.set(`${z.productId}:${z.slug}`, z.id);
        }
      }

      const { orderId } = await db.transaction(async (tx) => {
        const orderResult = await tx.insert(orders).values(orderValues);
        const newOrderId = orderResult[0].insertId;

        // ── 9. Insert order items ────────────────────────────────────────────
        const itemValues: InsertOrderItem[] = resolvedItems.map((item) => ({
          orderId: newOrderId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: centsToDecimal(item.unitPriceCents),
          totalPrice: centsToDecimal(item.unitPriceCents * item.quantity),
          decorationType: item.decorationMethod ?? item.decorationType,
          size: item.size,
          color: item.color,
          imprintZoneId: item.imprintZoneSlug
            ? zoneMap.get(`${item.productId}:${item.imprintZoneSlug}`) ?? null
            : null,
        }));

        if (itemValues.length > 0) {
          await tx.insert(orderItems).values(itemValues);
        }
        return { orderId: newOrderId };
      });

      // ── 10. INVENTORY DECREMENT ──────────────────────────────────────────
      const inventoryTrackedItems = resolvedItems.filter((item) => {
        const sp = spMap.get(
          input.items.find((i) => i.productId === item.productId)?.storeProductId ?? 0
        );
        return sp?.trackInventory;
      });

      if (inventoryTrackedItems.length > 0) {
        const { getPool } = await import("../db");
        const pool = getPool();
        if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB pool unavailable" });
        const conn = await pool.getConnection();

        const SP_TABLE = storeProducts._.name ?? "storeProducts";

        try {
          await conn.beginTransaction();

          for (const item of inventoryTrackedItems) {
            const spId = input.items.find((i) => i.productId === item.productId)?.storeProductId;
            if (!spId) continue;

            const [rows] = await conn.execute(
              `SELECT stockQuantity FROM \`${SP_TABLE}\` WHERE id = ? FOR UPDATE`,
              [spId]
            );
            const row = (rows as Array<{ stockQuantity: number | null }>)[0];
            if (!row || row.stockQuantity === null) continue;

            if (row.stockQuantity < item.quantity) {
              await conn.rollback();
              // Clean up the order since inventory is insufficient
              await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
              await db.delete(orders).where(eq(orders.id, orderId));
              throw new TRPCError({
                code: "CONFLICT",
                message: `"${item.productName}" only has ${row.stockQuantity} unit(s) in stock (requested ${item.quantity}).`,
              });
            }

            await conn.execute(
              `UPDATE \`${SP_TABLE}\` SET stockQuantity = stockQuantity - ? WHERE id = ?`,
              [item.quantity, spId]
            );
          }

          await conn.commit();
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          await conn.rollback();
          await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
          await db.delete(orders).where(eq(orders.id, orderId));
          throw err;
        } finally {
          conn.release();
        }
      }

      // ── 10b. Track promo code usage ─────────────────────────────────────
      if (appliedPromoCode && buyerStoreUser) {
        await db.update(promoCodes)
          .set({ usedCount: (appliedPromoCode.usedCount ?? 0) + 1 })
          .where(eq(promoCodes.id, appliedPromoCode.id));
        await db.insert(promoCodeUsages).values({
          promoCodeId: appliedPromoCode.id,
          storeUserId: buyerStoreUser.id,
          orderId,
          discountApplied: centsToDecimal(promoDiscountCents),
        });
      }

      // ── 11. Post-order budget hooks ──────────────────────────────────────
      await postOrderBudgetHooks(orderId, buyerStoreUser?.id ?? null);

      // ── 12. Notification ─────────────────────────────────────────────────
      const paymentMethodLabel =
        input.paymentMethod === "po_number" ? "Purchase Order" :
        input.paymentMethod === "gl_code" ? "GL Code" :
        "Company Points";

      try {
        const { notifyOwner } = await import("../_core/notification");
        await notifyOwner({
          userId: store.userId,
          organizationId: store.organizationId ?? undefined,
          type: "store_order",
          title: `New ${input.paymentMethod === "po_number" ? "PO" : input.paymentMethod === "gl_code" ? "GL" : "Points"} Order`,
          content: `Order #${orderNumber} placed via ${paymentMethodLabel} — ${formatCents(subtotalCents)}`,
          actionPath: `/store-management/${store.id}?tab=orders`,
          actionLabel: "View Order",
          entityId: orderId,
          entityType: "order",
        });
      } catch (err) {
        log.warn(`Notification failed for direct order ${orderNumber}:`, err);
      }

      // ── 13. Auto-generate POs (non-blocking) ────────────────────────────
      setImmediate(async () => {
        try {
          const { generatePOsForOrder } = await import("../utils/generatePOsForOrder");
          const { notifyOwner } = await import("../_core/notification");
          const result = await generatePOsForOrder(store.userId, store.organizationId, orderId);
          if (result && result.totalPOs > 0) {
            await notifyOwner({
              userId: store.userId,
              organizationId: store.organizationId ?? undefined,
              type: "po_created",
              title: `${result.totalPOs} PO${result.totalPOs > 1 ? "s" : ""} Auto-Generated`,
              content: `Store order #${orderNumber} — ${result.totalPOs} purchase orders ready for review`,
              actionPath: `/purchase-orders?orderId=${orderId}`,
              actionLabel: "View POs",
              entityId: orderId, entityType: "order",
            });
          }
        } catch (err) {
          log.warn(`Auto-PO generation failed for order ${orderNumber}:`, err);
        }
      });

      // ── 14. Audit log ────────────────────────────────────────────────────
      auditLog({
        action: "store.direct_order.created",
        userId: null,
        resourceType: "order",
        resourceId: orderNumber,
        description: `Direct order ${orderNumber} via ${paymentMethodLabel} for store ${store.slug}`,
        metadata: {
          paymentMethod: input.paymentMethod,
          subtotalCents,
          storeId: store.id,
          storeSlug: store.slug,
          buyerStoreUserId: buyerStoreUser?.id ?? null,
        },
      });

      log.info(
        `Created direct order ${orderNumber} via ${paymentMethodLabel} ` +
        `(subtotal: ${centsToDecimal(subtotalCents)} USD)`
      );

      return {
        orderId,
        orderNumber,
        status: "processing" as const,
      };
    }),

  /**
   * Validate a promo code without applying it.
   * Called from the checkout page "Apply" button.
   */
  validatePromoCode: publicProcedure
    .use(rateLimited("storePromoValidate", PUBLIC_STORE_READ_LIMIT))
    .input(
      z.object({
        storeSlug: z.string(),
        code: z.string().min(1),
        subtotal: z.number().min(0),
        storeToken: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.slug, input.storeSlug), eq(stores.status, "active")))
        .limit(1);

      if (!store) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
      }

      const subtotalCents = Math.round(input.subtotal * 100);
      const buyerPayload = await resolveStoreUserFromToken(input.storeToken);

      const result = await validateAndApplyPromo(
        db, store.id, input.code, subtotalCents, buyerPayload?.storeUserId ?? null
      );

      if (!result.valid) {
        return { valid: false as const, reason: result.reason ?? "Invalid code" };
      }

      return {
        valid: true as const,
        discountAmount: centsToDecimal(result.discountCents),
        description: result.promoCode?.description ?? null,
        code: result.promoCode?.code ?? input.code,
      };
    }),

  /**
   * Submit a custom order request from an employee.
   */
  submitCustomRequest: publicProcedure
    .use(rateLimited("storeCustomRequest", PUBLIC_CHECKOUT_LIMIT))
    .input(
      z.object({
        storeSlug: z.string(),
        storeToken: z.string(),
        title: z.string().min(1).max(255),
        description: z.string().min(1),
        quantity: z.number().int().min(1).optional(),
        targetDate: z.string().optional(),
        attachmentUrls: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Resolve store and user from token
      const [store] = await db
        .select()
        .from(stores)
        .where(and(eq(stores.slug, input.storeSlug), eq(stores.status, "active")))
        .limit(1);

      if (!store) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
      }

      const buyerPayload = await resolveStoreUserFromToken(input.storeToken);
      if (!buyerPayload) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in to submit a request." });
      }

      const [storeUser] = await db
        .select()
        .from(storeUsers)
        .where(
          and(
            eq(storeUsers.id, buyerPayload.storeUserId),
            eq(storeUsers.storeId, store.id)
          )
        )
        .limit(1);

      if (!storeUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found for this store." });
      }

      // Insert custom order request
      const result = await db.insert(customOrderRequests).values({
        storeId: store.id,
        storeUserId: storeUser.id,
        title: input.title.trim(),
        description: input.description.trim(),
        quantity: input.quantity ?? null,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
        attachmentUrls: input.attachmentUrls ?? null,
        status: "pending",
      });

      // Notify the store owner (distributor)
      try {
        const { notifyOwner } = await import("../_core/notification");
        await notifyOwner({
          userId: store.userId,
          organizationId: store.organizationId ?? undefined,
          type: "custom_order_request",
          title: "New Custom Order Request",
          content: `${storeUser.name || storeUser.email} submitted a custom request: "${input.title}"`,
          actionPath: `/store-management/${store.id}?tab=orders`,
          actionLabel: "View Request",
          entityId: result[0].insertId,
          entityType: "custom_order_request",
        });
      } catch (err) {
        log.warn(`Notification failed for custom order request:`, err);
      }

      // Agent trigger — propose next steps for the distributor
      try {
        const { onCustomOrderRequestCreated } = await import("../utils/agentTriggers");
        void onCustomOrderRequestCreated(result[0].insertId, store.organizationId);
      } catch (triggerErr: unknown) {
        log.warn("[trigger] onCustomOrderRequestCreated failed:", triggerErr);
      }

      return {
        id: result[0].insertId,
        success: true,
      };
    }),
});

// ─── Post-Order Hooks (Mock-to-Real Guide, Step 7) ──────────────────────────
/**
 * Atomically increment department spend after an order is confirmed.
 * Called from:
 *   1. Stripe webhook (checkout.session.completed / payment_intent.succeeded)
 *   2. Direct order creation (PO/GL code path in orders.ts)
 *
 * Uses raw SQL UPDATE with atomic increment to prevent race conditions
 * when multiple orders are confirmed simultaneously.
 *
 * @param orderId - The confirmed order's ID
 * @param storeUserId - The store user who placed the order (from JWT metadata)
 */
export async function postOrderBudgetHooks(
  orderId: number,
  storeUserId: number | null
): Promise<void> {
  if (!storeUserId) return;

  const db = await getDb();
  if (!db) {
    log.error(`postOrderBudgetHooks: DB unavailable for order ${orderId}`);
    return;
  }

  try {
    // Load the order total
    const [order] = await db
      .select({ total: orders.total })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order || !order.total) {
      log.warn(`postOrderBudgetHooks: Order ${orderId} not found or has no total`);
      return;
    }

    const totalCents = priceToCents(order.total);
    if (totalCents <= 0) return;

    // Load the store user to get their departmentId
    const [su] = await db
      .select({ departmentId: storeUsers.departmentId })
      .from(storeUsers)
      .where(eq(storeUsers.id, storeUserId))
      .limit(1);

    if (!su?.departmentId) {
      log.info(`postOrderBudgetHooks: storeUser ${storeUserId} has no department — skipping spend increment`);
      return;
    }

    // Atomic increment of department spentCents
    // Uses raw SQL to guarantee atomicity under concurrent order confirmations.
    const { getPool } = await import("../db");
    const pool = getPool();
    if (!pool) {
      log.error(`postOrderBudgetHooks: DB pool unavailable for order ${orderId}`);
      return;
    }

    await pool.execute(
      `UPDATE storeDepartments
       SET spentCents = spentCents + ?,
           updatedAt  = NOW()
       WHERE id = ?`,
      [totalCents, su.departmentId]
    );

    log.info(
      `postOrderBudgetHooks: Incremented dept ${su.departmentId} spend by ${formatCents(totalCents)} ` +
      `for order ${orderId} (storeUser ${storeUserId})`
    );
  } catch (err) {
    // Budget hooks must never crash the order confirmation flow.
    // Log the error and let the order proceed.
    log.error(`postOrderBudgetHooks: Error for order ${orderId}:`, err);
  }
}
