/**
 * sanMarBulkSync.ts — SanMar Canada Bulk Data nightly sync.
 *
 * SanMar's bulk endpoint is rate-limited to one call per day per credential.
 * Strategy: pull the catalog ONCE per run, then upsert into the products
 * table for every organization that has a SanMar supplier configured.
 *
 * Used by:
 *   - agentCron.ts   (nightly scan — one pull per day)
 *   - supplierSync   (manual trigger endpoint, scoped to one supplier)
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../db";
import { suppliers, products, organizations, orgMembers } from "../../drizzle/schema";
import { SanMarBulkService, sanMarBulkService } from "../integrations/SanMarBulkService";
import type { PSRestfulProduct } from "../integrations/PSRestfulService";
import { resolveSanMarCredentials } from "../integrations/sanMarCredentialResolver";
import { getLogger } from "../utils/logger";

const log = getLogger("sanmar-sync");

const SANMAR_NORMALIZED_NAME = "sanmar";

export interface SanMarSyncResult {
  organizationId: number | null;
  supplierId: number;
  catalogSize: number;
  imported: number;
  updated: number;
  skipped: number;
  error?: string;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

interface SanMarSupplierRow {
  id: number;
  userId: number;
  organizationId: number | null;
  normalizedName: string;
}

/**
 * Resolve the organization id for a supplier whose own row has organizationId=null.
 *
 * Mirrors how getOrgScope picks an org for protected procedures: a user belongs
 * to an org either by owning it (organizations.ownerId) or by membership
 * (orgMembers.userId). Without this, an org owner who configured the SanMar
 * supplier before the org column was backfilled gets organizationId=null on
 * the supplier row, the upsert writes products with organizationId=null, and
 * subsequent org-scoped reads (which filter by organizationId) silently miss
 * every imported row.
 *
 * Returns null only for genuine solo accounts — falls through to the legacy
 * userId-scoped insert path in that case.
 */
async function resolveSupplierOrganizationId(
  db: Db,
  supplier: SanMarSupplierRow,
): Promise<number | null> {
  if (supplier.organizationId !== null) return supplier.organizationId;

  const [owned] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerId, supplier.userId))
    .limit(1);
  if (owned) return owned.id;

  const [member] = await db
    .select({ orgId: orgMembers.organizationId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, supplier.userId))
    .limit(1);
  if (member) return member.orgId;

  return null;
}

/**
 * Upsert the supplied catalog into the products table for one
 * (org, supplier) pair. Match strategy mirrors PSRESTful importCatalog:
 * lookup by externalId within the org scope.
 */
async function upsertCatalogForSupplier(
  db: Db,
  catalog: PSRestfulProduct[],
  supplier: SanMarSupplierRow,
): Promise<SanMarSyncResult> {
  // Promote the supplier's organizationId from a backfilled lookup before
  // we use it for matching/inserts — otherwise every product written under a
  // null orgId is invisible to org-scoped queries.
  const resolvedOrgId = await resolveSupplierOrganizationId(db, supplier);
  if (resolvedOrgId !== supplier.organizationId) {
    log.info(`SanMar upsert: resolved organizationId=${resolvedOrgId} for supplier=${supplier.id} (was null)`);
    supplier = { ...supplier, organizationId: resolvedOrgId };
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  log.info(`SanMar upsert: entering loop with catalog.length=${catalog.length} for supplier=${supplier.id} org=${supplier.organizationId}`);

  for (let i = 0; i < catalog.length; i++) {
    const p = catalog[i];
    log.info(`SanMar upsert: catalog[${i}] = ${JSON.stringify(p)}`);
    if (!p.productId) {
      skipped++;
      log.warn(`SanMar upsert: skipping catalog[${i}] — missing productId: ${JSON.stringify(p)}`);
      continue;
    }

    // Org-scoped lookup. Solo accounts have organizationId=null; in that
    // case we narrow by userId so catalogs don't bleed across solo seats.
    const where = supplier.organizationId != null
      ? and(eq(products.externalId, p.productId), eq(products.organizationId, supplier.organizationId))
      : and(eq(products.externalId, p.productId), eq(products.userId, supplier.userId), sql`${products.organizationId} IS NULL`);

    try {
      const [existing] = await db
        .select({ id: products.id })
        .from(products)
        .where(where)
        .limit(1);

      if (existing) {
        await db.update(products)
          .set({
            name: p.productName,
            description: p.description ?? null,
            imageUrl: p.imageUrl ?? null,
            supplierCode: supplier.normalizedName,
            externalSource: "promostandards",
          })
          .where(eq(products.id, existing.id));
        updated++;
      } else {
        // ── DO NOT add webstore-imprint-placement vision calls here. ──
        // SanMar's bulk catalog moves the entire supplier inventory
        // (~50k SKUs) per nightly run. A vision call per insert would
        // generate ~50k Claude requests every night per org with a
        // SanMar supplier configured — the cost and rate-limit blast
        // radius is multiple orders of magnitude beyond what
        // ingestion-time hooks support. Phase 8 backfill picks these
        // up on its own throttled schedule. See the SCOPE BOUNDARY
        // block at the top of server/services/webstore-imprint-placement.ts.
        const values: typeof products.$inferInsert = {
          userId: supplier.userId,
          organizationId: supplier.organizationId,
          name: p.productName,
          description: p.description ?? null,
          sku: p.productId,
          externalId: p.productId,
          externalSource: "promostandards",
          supplierCode: supplier.normalizedName,
          imageUrl: p.imageUrl ?? null,
          basePrice: "0.00",
          source: "promostandards",
        };
        log.info(`SanMar upsert: INSERT payload for ${p.productId}: ${JSON.stringify(values)} (raw: ${JSON.stringify(p)})`);
        await db.insert(products).values(values);
        imported++;
      }
    } catch (err) {
      skipped++;
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? `\n${err.stack}` : "";
      log.error(
        `SanMar upsert: product ${p.productId} failed for supplier=${supplier.id} org=${supplier.organizationId}: ${msg}${stack}\n  product payload: ${JSON.stringify(p)}`,
      );
    }
  }

  return {
    organizationId: supplier.organizationId,
    supplierId: supplier.id,
    catalogSize: catalog.length,
    imported,
    updated,
    skipped,
  };
}

/**
 * Fetch the SanMar bulk catalog per-organization and upsert into each org
 * that has a SanMar supplier row configured.
 *
 * Each org now authenticates with its own SanMar credentials (looked up in
 * supplierCredentials, falling back to platform env vars when no DB row
 * exists — preserves Otentik Brand). SanMar's once-per-day rate limit is
 * enforced per credential, so each org's daily run is independent.
 *
 * Never throws — per-supplier errors are captured in `result.error` so a
 * single bad org can't halt the rest.
 */
export async function runSanMarBulkSyncAllOrgs(): Promise<{
  catalogSize: number;
  perSupplier: SanMarSyncResult[];
}> {
  const db = await getDb();
  if (!db) {
    log.warn("SanMar bulk sync: database unavailable, skipping");
    return { catalogSize: 0, perSupplier: [] };
  }

  const sanMarSuppliers = await db
    .select({
      id: suppliers.id,
      userId: suppliers.userId,
      organizationId: suppliers.organizationId,
      normalizedName: suppliers.normalizedName,
    })
    .from(suppliers)
    .where(eq(suppliers.normalizedName, SANMAR_NORMALIZED_NAME));

  if (sanMarSuppliers.length === 0) {
    log.info("SanMar bulk sync: no SanMar suppliers configured — skipping API call");
    return { catalogSize: 0, perSupplier: [] };
  }

  log.info(
    `SanMar bulk sync: ${sanMarSuppliers.length} supplier rows across orgs — fetching catalog per-org with that org's credentials`,
  );

  const perSupplier: SanMarSyncResult[] = [];
  let totalCatalogSize = 0;

  for (const s of sanMarSuppliers) {
    // Resolve the org's SanMar credentials. The supplier row's effective
    // organizationId may be backfilled from the owner; mirror that here so
    // a backfilled row still finds its DB credentials.
    const effectiveOrgId = await resolveSupplierOrganizationId(db, s);
    const creds = await resolveSanMarCredentials(effectiveOrgId, { db });
    if (!creds) {
      const msg =
        "No SanMar credentials configured (neither supplierCredentials row nor SANMAR_ACCOUNT_ID/SANMAR_PASSWORD env vars)";
      log.warn(
        `SanMar bulk sync: skipping supplier=${s.id} org=${effectiveOrgId} — ${msg}`,
      );
      perSupplier.push({
        organizationId: effectiveOrgId,
        supplierId: s.id,
        catalogSize: 0,
        imported: 0,
        updated: 0,
        skipped: 0,
        error: msg,
      });
      continue;
    }

    log.info(
      `SanMar bulk sync: supplier=${s.id} org=${effectiveOrgId} credentialSource=${creds.source}`,
    );

    let catalog: PSRestfulProduct[] = [];
    try {
      const service = new SanMarBulkService({
        accountId: creds.accountId,
        password: creds.password,
      });
      catalog = await service.getProducts();
      totalCatalogSize = Math.max(totalCatalogSize, catalog.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(
        `SanMar bulk fetch failed for supplier=${s.id} org=${effectiveOrgId} (source=${creds.source}): ${msg}`,
      );
      perSupplier.push({
        organizationId: effectiveOrgId,
        supplierId: s.id,
        catalogSize: 0,
        imported: 0,
        updated: 0,
        skipped: 0,
        error: msg,
      });
      continue;
    }

    try {
      const r = await upsertCatalogForSupplier(db, catalog, s);
      log.info(
        `SanMar upsert org=${effectiveOrgId} supplier=${s.id}: imported=${r.imported} updated=${r.updated} skipped=${r.skipped}`,
      );
      perSupplier.push(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`SanMar upsert failed for supplier ${s.id} (org=${effectiveOrgId}): ${msg}`);
      perSupplier.push({
        organizationId: effectiveOrgId,
        supplierId: s.id,
        catalogSize: catalog.length,
        imported: 0,
        updated: 0,
        skipped: 0,
        error: msg,
      });
    }
  }

  return { catalogSize: totalCatalogSize, perSupplier };
}

/**
 * Run the SanMar bulk sync for a single supplier (manual-trigger path).
 * Caller is expected to have already verified the supplier belongs to
 * the user's organization.
 *
 * Reads the org's SanMar credentials from supplierCredentials, falling back
 * to env vars; never logs the credential values.
 */
export async function runSanMarBulkSyncForSupplier(
  supplier: SanMarSupplierRow,
): Promise<SanMarSyncResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const effectiveOrgId = await resolveSupplierOrganizationId(db, supplier);
  const creds = await resolveSanMarCredentials(effectiveOrgId, { db });
  if (!creds) {
    throw new Error(
      "No SanMar credentials configured for this org (set them in Settings → Integrations or set the SANMAR_ACCOUNT_ID / SANMAR_PASSWORD env vars).",
    );
  }
  log.info(
    `SanMar bulk sync (manual): supplier=${supplier.id} org=${effectiveOrgId} credentialSource=${creds.source}`,
  );
  // Singleton kept for callers that haven't migrated; manual trigger path
  // builds a fresh service so per-org credentials are used.
  void sanMarBulkService;
  const service = new SanMarBulkService({
    accountId: creds.accountId,
    password: creds.password,
  });
  const catalog = await service.getProducts();
  return upsertCatalogForSupplier(db, catalog, supplier);
}
