#!/usr/bin/env node
/**
 * Creates/reuses MergeTasks subscription Products + Prices on Stripe (live).
 * Idempotent via lookup_keys; prints env-ready output.
 */
import "dotenv/config";
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY missing from .env");
  process.exit(1);
}
const stripe = new Stripe(key, { apiVersion: "2024-06-20" });

const TIERS = [
  { id: "starter", name: "MergeTasks Starter", monthly: 4900, annual: 47000 },
  { id: "growth", name: "MergeTasks Growth", monthly: 9900, annual: 95000 },
  { id: "enterprise", name: "MergeTasks Enterprise", monthly: 19900, annual: 191000 },
];

async function getOrCreateProduct(tier) {
  const lookup = `mt_plan_${tier.id}`;
  const existing = await stripe.products.search({ query: `metadata['plan_key']:'${lookup}'` });
  if (existing.data.length) return existing.data[0];
  return stripe.products.create({
    name: tier.name,
    metadata: { plan_key: lookup, tier: tier.id },
  });
}

async function getOrCreatePrice(product, tier, interval, amount) {
  const lookupKey = `mt_${tier.id}_${interval === "month" ? "monthly" : "annual"}_cad`;
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existing.data.length) return existing.data[0];
  return stripe.prices.create({
    product: product.id,
    currency: "cad",
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: { tier: tier.id, interval },
  });
}

const out = {};
for (const tier of TIERS) {
  const product = await getOrCreateProduct(tier);
  const monthly = await getOrCreatePrice(product, tier, "month", tier.monthly);
  const annual = await getOrCreatePrice(product, tier, "year", tier.annual);
  out[`STRIPE_PRICE_${tier.id.toUpperCase()}_MONTHLY`] = monthly.id;
  out[`STRIPE_PRICE_${tier.id.toUpperCase()}_ANNUAL`] = annual.id;
  console.error(`✓ ${tier.name}: ${monthly.id} / ${annual.id}`);
}

// emit pure env to stdout
for (const [k, v] of Object.entries(out)) {
  console.log(`${k}=${v}`);
}
