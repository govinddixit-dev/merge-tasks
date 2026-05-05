/**
 * externalProducts router
 *
 * Exposes tRPC procedures for searching and importing products from external
 * supplier APIs (ASI ESP and PromoStandards).
 *
 * Credential resolution order per user:
 *   1. User-saved credentials in api_connections table
 *   2. Platform-level environment variable credentials (shared fallback)
 *   3. No credentials → source is skipped
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { apiConnections, suppliers, supplierSyncJobs } from "../../drizzle/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  searchProducts,
  getDefaultCredentials,
  testSupplierConnection,
} from "../integrations/productSearchAdapter";
import { getLogger } from "../utils/logger";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";

const SANMAR_NORMALIZED_NAME = "sanmar";
const SANMAR_CAPABILITIES = ["Bulk catalog sync", "Live inventory"] as const;

function sanMarEnvConnected() {
  return !!process.env.SANMAR_ACCOUNT_ID && !!process.env.SANMAR_PASSWORD;
}

async function getSanMarLastSyncedAt(
  userId: number,
  organizationId: number | null,
): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;

  const supplierScope = organizationId !== null
    ? eq(suppliers.organizationId, organizationId)
    : eq(suppliers.userId, userId);

  const sanMarSuppliers = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.normalizedName, SANMAR_NORMALIZED_NAME), supplierScope));

  if (sanMarSuppliers.length === 0) return null;

  const [lastJob] = await db
    .select({ completedAt: supplierSyncJobs.completedAt, startedAt: supplierSyncJobs.startedAt })
    .from(supplierSyncJobs)
    .where(and(
      inArray(supplierSyncJobs.supplierId, sanMarSuppliers.map((s) => s.id)),
      eq(supplierSyncJobs.status, "completed"),
    ))
    .orderBy(desc(supplierSyncJobs.completedAt))
    .limit(1);

  return lastJob?.completedAt ?? lastJob?.startedAt ?? null;
}

const log = getLogger("externalProducts");

//  Credential resolution 

async function resolveCredentials(userId: number, organizationId?: number | null) {
  const db = await getDb();
  if (!db) return getDefaultCredentials();

  // Load all API connections for this user/org
  // Credentials are stored as a JSON blob: { apiKey, accountId, username, password, ... }
  const connScope = organizationId
    ? eq(apiConnections.organizationId, organizationId)
    : eq(apiConnections.userId, userId);
  const connections = await db
    .select()
    .from(apiConnections)
    .where(connScope);

  const defaults = getDefaultCredentials();

  // Helper: find a connection by name prefix and extract credentials from JSON blob
  const findCreds = (namePrefix: string) => {
    const conn = connections.find(
      (c) => c.name.toLowerCase().includes(namePrefix.toLowerCase()) && c.syncStatus !== "error"
    );
    return conn?.credentials as Record<string, string> | undefined;
  };

  const asiCreds = findCreds("asi");
  const sanmarCreds = findCreds("sanmar");
  const ssCreds = findCreds("s&s") || findCreds("ssact");
  const alphabroderCreds = findCreds("alphabroder");

  return {
    asi: asiCreds?.apiKey && asiCreds?.accountId
      ? { apiKey: asiCreds.apiKey, accountId: asiCreds.accountId }
      : defaults.asi,

    promostandards: {
      sanmar: sanmarCreds?.username && sanmarCreds?.password
        ? { username: sanmarCreds.username, password: sanmarCreds.password }
        : defaults.promostandards?.sanmar,

      ss: ssCreds?.username && ssCreds?.password
        ? { username: ssCreds.username, password: ssCreds.password }
        : defaults.promostandards?.ss,

      alphabroder: alphabroderCreds?.username && alphabroderCreds?.password
        ? { username: alphabroderCreds.username, password: alphabroderCreds.password }
        : defaults.promostandards?.alphabroder,
    },
  };
}

// Zod v4 uses z.record(keyType, valueType) — two-argument form
const credentialsSchema = z.record(z.string(), z.string());

//  Router 

export const externalProductsRouter = router({
  /**
   * Search products across ASI ESP and PromoStandards.
   * Returns normalized results with source metadata.
   */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const credentials = await resolveCredentials(ctx.user.id, ctx.organizationId);

      log.info(`User ${ctx.user.id} searching external products: "${input.query}"`);

      const result = await searchProducts({
        query: input.query,
        limit: input.limit,
        ...credentials,
      });

      log.info(
        `External search returned ${result.products.length} products ` +
        `(ASI: ${result.sources.asi.count}, PS: ${result.sources.promostandards.count})`
      );

      return result;
    }),

  /**
   * Import an external product into the user's own product catalog.
   * Converts the normalized ExternalProduct shape into a local product record.
   */
  importProduct: protectedProcedure
    .input(
      z.object({
        product: z.object({
          externalId: z.string(),
          source: z.enum(["asi", "promostandards"]),
          supplier: z.string(),
          supplierCode: z.string(),
          productNumber: z.string(),
          name: z.string(),
          description: z.string(),
          category: z.string(),
          imageUrl: z.string().nullable(),
          colors: z.array(z.string()),
          sizes: z.array(z.string()),
          minQuantity: z.number(),
          basePrice: z.number().nullable(),
          currency: z.string(),
          hasLiveInventory: z.boolean(),
          inventoryQuantity: z.number().nullable(),
          decorationMethods: z.array(z.string()),
          tags: z.array(z.string()),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const { product } = input;

      // Check if already imported (by externalId)
      const { products: productsTable } = await import("../../drizzle/schema");
      const existing = await db
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(
          and(
            scope.products,
            eq(productsTable.externalId, product.externalId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return { id: existing[0].id, alreadyExists: true };
      }

      const result = await db
        .insert(productsTable)
        .values({
          ...scope.stamp,
          name: product.name,
          description: product.description,
          category: "other" as const,
          supplier: product.supplier,
          supplierSku: product.productNumber,
          supplierCode: product.supplierCode,
          productNumber: product.productNumber,
          imageUrl: product.imageUrl,
          colors: product.colors,
          sizes: product.sizes,
          minQuantity: product.minQuantity,
          basePrice: product.basePrice ? String(product.basePrice) : null,
          currency: product.currency,
          decorationMethods: product.decorationMethods,
          source: product.source === "asi" ? "asi" as const : "promostandards" as const,
          sourceApiId: product.externalId,
          externalId: product.externalId,
          externalSource: product.source,
          hasLiveInventory: product.hasLiveInventory,
        });

      const insertId = (result[0] as unknown as import("../db/types").MysqlInsertResult).insertId;

      log.info(`User ${ctx.user.id} imported external product ${product.externalId} as local id ${insertId}`);

      return { id: insertId, alreadyExists: false };
    }),

  /**
   * Check which external products have already been imported.
   * Used to show "Already in catalog" badges in the search UI.
   */
  checkImported: protectedProcedure
    .input(z.object({ externalIds: z.array(z.string()).max(100) }))
    .query(async ({ input, ctx }) => {
      if (input.externalIds.length === 0) return {};
      const db = await getDb();
      if (!db) return {};
      const scope = getOrgScope(ctx);

      const { products: productsTable } = await import("../../drizzle/schema");
      const { inArray } = await import("drizzle-orm");

      const rows = await db
        .select({ externalId: productsTable.externalId, id: productsTable.id })
        .from(productsTable)
        .where(
          and(
            scope.products,
            inArray(productsTable.externalId, input.externalIds.filter(Boolean) as string[])
          )
        );

      const map: Record<string, number> = {};
      for (const row of rows) {
        if (row.externalId) map[row.externalId] = row.id;
      }
      return map;
    }),

  /**
   * Save supplier credentials for a specific supplier.
   * Upserts into the api_connections table keyed by supplierId.
   */
  saveCredentials: protectedProcedure
    .input(
      z.object({
        supplierId: z.enum(["asi", "sanmar", "ss", "alphabroder"]),
        credentials: credentialsSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const { supplierId, credentials } = input;

      // Supplier name map for display
      const nameMap: Record<string, string> = {
        asi: "ASI ESP",
        sanmar: "SanMar (PromoStandards)",
        ss: "S&S Activewear (PromoStandards)",
        alphabroder: "alphabroder (PromoStandards)",
      };

      // Supplier base URL map (required field in apiConnections schema)
      const baseUrlMap: Record<string, string> = {
        asi: "https://api.asicentral.com/v1",
        sanmar: "https://ws.sanmar.com:8080/promostandards",
        ss: "https://api.ssactivewear.com/v2",
        alphabroder: "https://www.alphabroder.com/promostandards",
      };

      // Check for existing connection
      const existing = await db
        .select({ id: apiConnections.id })
        .from(apiConnections)
        .where(
          and(
            scope.apiConnections,
            eq(apiConnections.name, nameMap[supplierId])
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(apiConnections)
          .set({
            credentials: credentials,
            syncStatus: "connected" as const,
            updatedAt: new Date(),
          })
          .where(eq(apiConnections.id, existing[0].id));
      } else {
        await db.insert(apiConnections).values({
          ...scope.stamp,
          name: nameMap[supplierId],
          baseUrl: baseUrlMap[supplierId],
          credentials: credentials,
          syncStatus: "connected" as const,
        });
      }

      log.info(`User ${ctx.user.id} saved credentials for ${supplierId}`);
      return { success: true };
    }),

  /**
   * Test a supplier connection with the provided credentials (without saving).
   */
  testConnection: protectedProcedure
    .input(
      z.object({
        supplierId: z.enum(["asi", "sanmar", "ss", "alphabroder"]),
        credentials: credentialsSchema,
      })
    )
    .mutation(async ({ input }) => {
      const { supplierId, credentials } = input;

      try {
        const result = await testSupplierConnection(supplierId, credentials);
        return result;
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
    }),

  /**
   * Disconnect a supplier by removing their credentials from api_connections.
   */
  disconnectSupplier: protectedProcedure
    .input(z.object({ supplierId: z.enum(["asi", "sanmar", "ss", "alphabroder"]) }))
    .mutation(async ({ input, ctx }) => {
      const nameMap: Record<string, string> = {
        asi: "ASI ESP",
        sanmar: "SanMar (PromoStandards)",
        ss: "S&S Activewear (PromoStandards)",
        alphabroder: "alphabroder (PromoStandards)",
      };

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      await db
        .delete(apiConnections)
        .where(
          and(
            scope.apiConnections,
            eq(apiConnections.name, nameMap[input.supplierId])
          )
        );

      log.info(`User ${ctx.user.id} disconnected ${input.supplierId}`);
      return { success: true };
    }),

  /**
   * Get the connection status for all external product sources.
   * Used in the Settings > Integrations panel.
   */
  connectionStatus: protectedProcedure.query(async ({ ctx }) => {
    const credentials = await resolveCredentials(ctx.user.id);
    const sanMarConnected = sanMarEnvConnected();
    const sanMarLastSyncedAt = sanMarConnected
      ? await getSanMarLastSyncedAt(ctx.user.id, ctx.organizationId)
      : null;
    return {
      asi: {
        connected: !!credentials.asi?.apiKey,
        label: "ASI ESP",
      },
      sanmar: {
        connected: sanMarConnected,
        label: "SanMar",
        capabilities: [...SANMAR_CAPABILITIES],
        lastSyncedAt: sanMarLastSyncedAt,
      },
      ss: {
        connected: !!credentials.promostandards?.ss?.username,
        label: "S&S Activewear (PromoStandards)",
      },
      alphabroder: {
        connected: !!credentials.promostandards?.alphabroder?.username,
        label: "alphabroder (PromoStandards)",
      },
    };
  }),
});
