import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  clientProductConfig,
  clientProductPricingTiers,
  clientProductVariantUpcharges,
  clientProductOtherCosts,
  clientProductDecorationMethod,
  products,
} from "../../drizzle/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolverInput {
  clientId: number;
  productId: number;
  quantity: number;
  variantKey?: string | null;
  decorationMethodId?: number | null;
  includeOtherCosts: boolean;
}

export interface OtherCostLine {
  label: string;
  amountCents: number;
  side: "buying" | "selling";
}

export interface ResolverOutput {
  unitPriceCents: number;
  variantUpchargeCents: number;
  setupFeeCents: number;
  setupFeeMode: "one_time" | "per_order";
  otherCosts: OtherCostLine[];
  displayMode: "itemize" | "roll_into_unit";
  resolvedAt: Date;
  fallbackUsed: boolean;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// Thrown when no price can be found at all — never silently return zero.
export class PricingNotFoundError extends Error {
  constructor(clientId: number, productId: number) {
    super(
      `No pricing found for clientId=${clientId} productId=${productId}. ` +
      `Configure client pricing or set products.basePrice.`
    );
    this.name = "PricingNotFoundError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver
// ─────────────────────────────────────────────────────────────────────────────

export async function resolvePricing(input: ResolverInput): Promise<ResolverOutput> {
  const { clientId, productId, quantity, variantKey, decorationMethodId, includeOtherCosts } = input;
  const db = await getDb();
  if (!db) {
    throw new Error("Database not initialised — pricing resolver requires a DB connection");
  }
  const resolvedAt = new Date();

  // ── Step 1: Load client product config ──────────────────────────────────
  const [config] = await db
    .select()
    .from(clientProductConfig)
    .where(
      and(
        eq(clientProductConfig.clientId, clientId),
        eq(clientProductConfig.productId, productId),
        eq(clientProductConfig.isActive, true)
      )
    )
    .limit(1);

  // ── Step 2: Resolve unit price ───────────────────────────────────────────
  let unitPriceCents: number;
  let fallbackUsed = false;

  if (config) {
    // Load pricing tiers for this config
    const tiers = await db
      .select()
      .from(clientProductPricingTiers)
      .where(eq(clientProductPricingTiers.clientProductConfigId, config.id));

    const matchedTier = tiers.find((tier) => {
      const aboveMin = quantity >= tier.minQty;
      const belowMax = tier.maxQty === null || quantity <= tier.maxQty;
      return aboveMin && belowMax;
    });

    if (matchedTier) {
      unitPriceCents = matchedTier.unitPriceCents;
    } else {
      // Config exists but no tier matches this quantity — fall back
      unitPriceCents = await getFallbackPrice(db, productId, clientId);
      fallbackUsed = true;
    }
  } else {
    // No config at all — fall back to basePrice
    unitPriceCents = await getFallbackPrice(db, productId, clientId);
    fallbackUsed = true;
  }

  // ── Step 3: Resolve variant upcharge ────────────────────────────────────
  let variantUpchargeCents = 0;

  if (config && variantKey) {
    const [upcharge] = await db
      .select()
      .from(clientProductVariantUpcharges)
      .where(
        and(
          eq(clientProductVariantUpcharges.clientProductConfigId, config.id),
          eq(clientProductVariantUpcharges.variantKey, variantKey)
        )
      )
      .limit(1);

    if (upcharge) {
      variantUpchargeCents = upcharge.upchargeCents;
    }
  }

  // ── Step 4: Resolve setup fee ────────────────────────────────────────────
  let setupFeeCents = 0;
  let setupFeeMode: "one_time" | "per_order" = "one_time";

  if (config && decorationMethodId) {
    const [decoration] = await db
      .select()
      .from(clientProductDecorationMethod)
      .where(
        and(
          eq(clientProductDecorationMethod.clientProductConfigId, config.id),
          eq(clientProductDecorationMethod.decorationMethodId, decorationMethodId),
          eq(clientProductDecorationMethod.isActive, true)
        )
      )
      .limit(1);

    if (decoration) {
      setupFeeCents = decoration.setupFeeCents;
      setupFeeMode = decoration.setupFeeMode;
    }
  }

  // ── Step 5: Resolve other costs ──────────────────────────────────────────
  let otherCosts: OtherCostLine[] = [];

  if (config && includeOtherCosts) {
    const rows = await db
      .select()
      .from(clientProductOtherCosts)
      .where(
        and(
          eq(clientProductOtherCosts.clientProductConfigId, config.id),
          eq(clientProductOtherCosts.isActive, true)
        )
      )
      .orderBy(clientProductOtherCosts.sortOrder);

    otherCosts = rows.map((row) => ({
      label: row.label,
      amountCents: row.amountCents,
      side: row.side,
    }));
  }

  // ── Step 6: Display mode ─────────────────────────────────────────────────
  const displayMode = config?.displayMode ?? "itemize";

  return {
    unitPriceCents,
    variantUpchargeCents,
    setupFeeCents,
    setupFeeMode,
    otherCosts,
    displayMode,
    resolvedAt,
    fallbackUsed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback — products.basePrice
// Throws PricingNotFoundError if no basePrice exists.
// Never silently returns zero.
// ─────────────────────────────────────────────────────────────────────────────

async function getFallbackPrice(
  db: Db,
  productId: number,
  clientId: number
): Promise<number> {
  const [product] = await db
    .select({ basePrice: products.basePrice })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product || product.basePrice === null || product.basePrice === undefined) {
    throw new PricingNotFoundError(clientId, productId);
  }

  // basePrice is stored as decimal — convert to cents
  const cents = Math.round(Number(product.basePrice) * 100);

  if (cents <= 0) {
    throw new PricingNotFoundError(clientId, productId);
  }

  return cents;
}
