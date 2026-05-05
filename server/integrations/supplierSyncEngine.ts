/**
 * supplierSyncEngine.ts — Orchestrates supplier catalog sync.
 *
 * Pulls product data from PSRESTful via PSRestfulService, writes to:
 *   - masterProductPricing (pricing tiers)
 *   - productVariants (variant dimensions)
 *   - productImprintZones + productImprintZoneDecorations (decoration locations)
 *   - supplierSyncJobs (audit trail)
 *   - supplierCostChangeLog (price change history)
 *   - notifications (supplier_cost_change bell notification)
 *
 * Called by:
 *   - Manual sync trigger (distributor clicks "Sync Now")
 *   - Scheduled cron job (server/jobs/supplierSyncCron.ts)
 */

import { getLogger } from "../utils/logger";
import { getDb } from "../db";
import { psRestfulService } from "./PSRestfulService";
import {
  suppliers,
  products,
  masterProductPricing,
  productVariants,
  productImprintZones,
  productImprintZoneDecorations,
  decorationMethods,
  supplierSyncJobs,
  supplierCostChangeLog,
  notifications,
} from "../../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getLogger as log } from "../utils/logger";

const logger = getLogger("supplier-sync");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncContext {
  supplierId: number;
  organizationId: number;
  userId: number; // distributor user — for notifications
  trigger: "manual" | "scheduled" | "webhook";
  clientId?: number; // for sub-account context
  productIds?: number[]; // if set, targeted sync
}

export interface SyncResult {
  jobId: number;
  productsScanned: number;
  productsUpdated: number;
  priceChanges: number;
  status: "completed" | "failed";
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Currency conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert supplier native currency to distributor home currency.
 * Currently uses a simple rate lookup — Phase 4 can wire to a live FX API.
 */
function convertToHomeCurrency(
  nativeCents: number,
  nativeCurrency: string,
  homeCurrency: string
): number {
  if (nativeCurrency.toUpperCase() === homeCurrency.toUpperCase()) {
    return nativeCents;
  }
  // Hardcoded rates for Phase 3 — replace with live FX in Phase 4
  const rates: Record<string, number> = {
    "USD_CAD": 1.36,
    "CAD_USD": 0.74,
    "USD_GBP": 0.79,
    "GBP_USD": 1.27,
  };
  const key = `${nativeCurrency.toUpperCase()}_${homeCurrency.toUpperCase()}`;
  const rate = rates[key] ?? 1.0;
  return Math.round(nativeCents * rate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main sync function
// ─────────────────────────────────────────────────────────────────────────────

export async function runSupplierSync(context: SyncContext): Promise<SyncResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Create sync job record
  const jobResult = await db.insert(supplierSyncJobs).values({
    supplierId: context.supplierId,
    organizationId: context.organizationId,
    status: "running",
    trigger: context.trigger,
    syncScope: context.productIds ?? null,
    startedAt: new Date(),
  });
  const jobId = jobResult[0].insertId;

  let productsScanned = 0;
  let productsUpdated = 0;
  let priceChanges = 0;

  try {
    // Load supplier
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, context.supplierId))
      .limit(1);

    if (!supplier?.psRestfulCode) {
      throw new Error(`Supplier ${context.supplierId} has no psRestfulCode configured`);
    }

    const psContext = { clientId: context.clientId, organizationId: context.organizationId };

    // Determine home currency (default CAD for Canadian distributors)
    const homeCurrency = process.env.DEFAULT_CURRENCY ?? "CAD";

    // Get products to sync
    let productsToSync: number[] = [];
    if (context.productIds && context.productIds.length > 0) {
      productsToSync = context.productIds;
    } else {
      // Full sync — get all products linked to this supplier
      const linkedProducts = await db
        .select({ id: products.id, externalId: products.externalId })
        .from(products)
        .where(eq(products.supplierCode, supplier.normalizedName));
      productsToSync = linkedProducts.map(p => p.id);
    }

    productsScanned = productsToSync.length;

    // PSRESTful's pricing endpoint requires an explicit fob_id (no default).
    // FOB resolution uses the module-level 24h cache in PSRestfulService —
    // which negative-caches empty responses too, so a supplier whose
    // fob-points endpoint returns nothing won't trigger the per-product
    // retry loop that disabled our keys on 2026-05-04.
    let loggedEmptyFob = false;

    // Sync each product
    for (const productId of productsToSync) {
      try {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .limit(1);

        if (!product?.externalId) continue;

        const fobs = await psRestfulService.getFobPointsCached(
          supplier.psRestfulCode,
          product.externalId,
          psContext,
        );
        if (fobs.length === 0) {
          if (!loggedEmptyFob) {
            logger.warn(`${supplier.psRestfulCode} FOB points unavailable — skipping pricing for all products this run`);
            loggedEmptyFob = true;
          }
          continue;
        }
        // PromoStandards convention: first entry is the supplier's primary warehouse.
        const fobId = fobs[0].fobId;

        // Fetch pricing from PSRESTful. Request USD and let convertToHomeCurrency
        // normalize — not every supplier supports every currency natively.
        const priceTiers = await psRestfulService.getProductPricing(
          supplier.psRestfulCode,
          product.externalId,
          { currency: "USD", fobId, priceType: "Net" },
          psContext,
        );

        if (priceTiers.length === 0) continue;

        // Check existing prices for change detection
        const existingPrices = await db
          .select()
          .from(masterProductPricing)
          .where(and(
            eq(masterProductPricing.productId, productId),
            eq(masterProductPricing.supplierId, context.supplierId),
          ));

        const existingMap = new Map(
          existingPrices.map(p => [`${p.minQty}_${p.variantKey ?? ""}`, p])
        );

        let productUpdated = false;
        const costChangesToLog: typeof supplierCostChangeLog.$inferInsert[] = [];

        // Upsert price tiers
        for (const tier of priceTiers) {
          const nativeCents = Math.round(tier.price * 100);
          const convertedCents = convertToHomeCurrency(nativeCents, tier.currency, homeCurrency);
          const key = `${tier.minQty}_`;
          const existing = existingMap.get(key);

          if (existing) {
            // Check for price change
            if (existing.nativeCostCents !== nativeCents) {
              costChangesToLog.push({
                supplierId: context.supplierId,
                productId,
                variantKey: null,
                previousCostCents: existing.nativeCostCents,
                newCostCents: nativeCents,
                currency: tier.currency,
                syncJobId: jobId,
                notificationSent: false,
              });
              priceChanges++;
            }

            await db.update(masterProductPricing)
              .set({
                nativeCostCents: nativeCents,
                nativeCurrency: tier.currency,
                unitCostCents: convertedCents,
                currency: homeCurrency,
                syncedAt: new Date(),
                isActive: true,
              })
              .where(eq(masterProductPricing.id, existing.id));
          } else {
            await db.insert(masterProductPricing).values({
              productId,
              supplierId: context.supplierId,
              variantKey: null,
              minQty: tier.minQty,
              maxQty: tier.maxQty,
              nativeCostCents: nativeCents,
              nativeCurrency: tier.currency,
              unitCostCents: convertedCents,
              currency: homeCurrency,
              syncedAt: new Date(),
              isActive: true,
            });
            productUpdated = true;
          }
        }

        // Log cost changes
        if (costChangesToLog.length > 0) {
          await db.insert(supplierCostChangeLog).values(costChangesToLog);
          productUpdated = true;
        }

        // Sync variants
        const locations = await psRestfulService.getProductLocations(
          supplier.psRestfulCode,
          product.externalId,
          psContext
        );

        // Upsert imprint zones from supplier locations
        for (const loc of locations) {
          const slug = loc.locationId.toLowerCase().replace(/\s+/g, "-");
          const existing = await db
            .select()
            .from(productImprintZones)
            .where(and(
              eq(productImprintZones.productId, productId),
              eq(productImprintZones.slug, slug),
            ))
            .limit(1);

          if (existing.length === 0) {
            // Insert new zone — use sensible defaults for position
            const zoneResult = await db.insert(productImprintZones).values({
              productId,
              label: loc.locationName,
              slug,
              x: "28.00",
              y: "22.00",
              w: "44.00",
              h: "40.00",
              isDefault: false,
              isActive: true,
            });

            const zoneId = zoneResult[0].insertId;

            // Link decoration methods
            if (loc.decorationMethods && loc.decorationMethods.length > 0) {
              const dmRows = await db
                .select({ id: decorationMethods.id, slug: decorationMethods.slug })
                .from(decorationMethods)
                .where(inArray(decorationMethods.slug, loc.decorationMethods.map(m => m.toLowerCase().replace(/\s+/g, "_"))));

              for (const dm of dmRows) {
                await db.insert(productImprintZoneDecorations).values({
                  imprintZoneId: zoneId,
                  decorationMethodId: dm.id,
                  isDefault: false,
                }).onDuplicateKeyUpdate({ set: { isDefault: false } });
              }
            }
          }
        }

        if (productUpdated) productsUpdated++;

      } catch (productErr) {
        logger.warn(`Failed to sync product ${productId}:`, productErr);
      }
    }

    // Fire notifications for price changes
    if (priceChanges > 0) {
      await db.insert(notifications).values({
        userId: context.userId,
        organizationId: context.organizationId,
        type: "supplier_cost_change",
        title: "Supplier costs updated",
        message: `${priceChanges} product${priceChanges !== 1 ? "s" : ""} from ${supplier.name} have new pricing. Review your client markups.`,
        read: false,
        actionPath: `/suppliers/${context.supplierId}`,
      });
    }

    // Mark job complete
    await db.update(supplierSyncJobs)
      .set({
        status: "completed",
        productsScanned,
        productsUpdated,
        priceChanges,
        completedAt: new Date(),
      })
      .where(eq(supplierSyncJobs.id, jobId));

    return { jobId, productsScanned, productsUpdated, priceChanges, status: "completed" };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error(`Supplier sync failed for supplier ${context.supplierId}:`, err);

    await db.update(supplierSyncJobs)
      .set({
        status: "failed",
        productsScanned,
        productsUpdated,
        priceChanges,
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(supplierSyncJobs.id, jobId));

    return { jobId, productsScanned, productsUpdated, priceChanges, status: "failed", error: errorMessage };
  }
}
