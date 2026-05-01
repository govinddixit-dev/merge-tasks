/**
 * supplierSyncCron.ts — Scheduled supplier sync job.
 *
 * Runs on a configurable schedule (default: every 24 hours).
 * Syncs all suppliers that have a psRestfulCode configured.
 * Called from server startup via registerCronJobs().
 */

import { getLogger } from "../utils/logger";
import { getDb } from "../db";
import { suppliers, organizations } from "../../drizzle/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { runSupplierSync } from "../integrations/supplierSyncEngine";

const log = getLogger("supplier-sync-cron");

export async function runScheduledSupplierSync(): Promise<void> {
  const db = await getDb();
  if (!db) {
    log.error("Scheduled supplier sync: database unavailable");
    return;
  }

  log.info("Scheduled supplier sync starting");

  // Find all suppliers with psRestfulCode configured
  const syncableSuppliers = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      organizationId: suppliers.organizationId,
      userId: suppliers.userId,
    })
    .from(suppliers)
    .where(isNotNull(suppliers.psRestfulCode));

  log.info(`Found ${syncableSuppliers.length} suppliers to sync`);

  for (const supplier of syncableSuppliers) {
    if (!supplier.organizationId) continue;

    try {
      log.info(`Syncing supplier: ${supplier.name} (id=${supplier.id})`);
      const result = await runSupplierSync({
        supplierId: supplier.id,
        organizationId: supplier.organizationId,
        userId: supplier.userId,
        trigger: "scheduled",
      });
      log.info(`Supplier ${supplier.name} sync complete: ${result.productsScanned} scanned, ${result.priceChanges} price changes`);
    } catch (err) {
      log.error(`Scheduled sync failed for supplier ${supplier.name}:`, err);
    }
  }

  log.info("Scheduled supplier sync complete");
}

/**
 * Register the supplier sync on the server event loop.
 * Runs every 24 hours, with an initial run 5 minutes after startup
 * so the server has time to finish warmup before the first sync.
 */
export function scheduleSupplierSyncCron(): void {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const INITIAL_DELAY_MS = 5 * 60 * 1000;

  setTimeout(() => {
    runScheduledSupplierSync().catch((err: unknown) =>
      log.error("Initial supplier sync failed:", err)
    );
  }, INITIAL_DELAY_MS).unref();

  setInterval(() => {
    runScheduledSupplierSync().catch((err: unknown) =>
      log.error("Scheduled supplier sync failed:", err)
    );
  }, DAY_MS).unref();

  log.info("Supplier sync cron registered (24h interval, 5min initial delay)");
}
