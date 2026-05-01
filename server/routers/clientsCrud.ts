/**
 * clientsCrud.ts — Client CRUD Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Procedures: list, getById, stats, create, update, delete
 *
 * Asset procedures (listAssets, uploadAsset, deleteAsset) live in clientsAssets.ts.
 * Both routers are merged in clients.ts which is the public API entry point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { eq, and, desc, sql, count, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  clients,
  clientContacts,
  proposals,
  proposalProducts,
  departmentApprovals,
  orders,
  orderItems,
  stores,
  storeProducts,
  clientLogos,
  clientAssets,
  virtualProofs,
  products,
  clientProductConfig,
  type InsertClient,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { generateClientExternalId } from "../utils/externalCustomerId";
import { getOrgScope } from "../utils/orgScope";
import { checkClientLimit } from "../utils/planLimits";
import { withTransaction } from "../utils/transaction";
import { onNewClientCreated } from "../utils/agentTriggers";
import { getLogger } from "../utils/logger";

const log = getLogger("clientsCrud");

export const clientsCrudRouter = router({
  /**
   * List all clients for the current user with enriched summary counts.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          status: z.enum(["active", "inactive", "prospect"]).optional(),
          sortBy: z.enum(["name", "created", "updated", "status"]).optional(),
          sortOrder: z.enum(["asc", "desc"]).optional(),
          /** Pagination: max items to return (default 50, max 200) */
          limit: z.number().min(1).max(200).optional().default(50),
          /** Pagination: offset for page-based navigation */
          offset: z.number().min(0).optional().default(0),
          /**
           * When true, populate `storeCount` on each item by running an extra
           * GROUP BY on `stores`. Off by default to keep the common list view
           * from paying for an aggregate the table doesn't render — only the
           * client-detail drawer uses the count today. Callers that need it
           * should opt in.
           */
          includeStores: z.boolean().optional().default(false),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      const scope = getOrgScope(ctx);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      /*  Build WHERE once so the LIMIT applies after search/status match —
          filtering in-memory after LIMIT silently hides results that live
          past the first page.  */
      const filters = [scope.clients];
      if (input?.status) {
        filters.push(eq(clients.status, input.status));
      }
      if (input?.search) {
        const like = `%${input.search.toLowerCase()}%`;
        filters.push(
          sql`(LOWER(${clients.companyName}) LIKE ${like}
            OR LOWER(${clients.contactName}) LIKE ${like}
            OR LOWER(${clients.contactEmail}) LIKE ${like}
            OR LOWER(COALESCE(${clients.industry}, '')) LIKE ${like})`
        );
      }
      const whereExpr = filters.length === 1 ? filters[0] : and(...filters);

      // Get total count for proper pagination (respects current filters).
      const [{ cnt: totalCount }] = await db
        .select({ cnt: count() })
        .from(clients)
        .where(whereExpr);

      const rows = await db
        .select()
        .from(clients)
        .where(whereExpr)
        .orderBy(desc(clients.updatedAt))
        .limit(limit + 1) // fetch one extra to determine hasMore
        .offset(offset);

      let filtered = rows;

      // Sort
      if (input?.sortBy) {
        const dir = input.sortOrder === "asc" ? 1 : -1;
        filtered = [...filtered].sort((a, b) => {
          switch (input.sortBy) {
            case "name":
              return dir * a.companyName.localeCompare(b.companyName);
            case "status":
              return dir * (a.status || "").localeCompare(b.status || "");
            case "created":
              return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            case "updated":
            default:
              return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
          }
        });
      }

      // Enrich with counts for each client
      const clientIds = filtered.map((c) => c.id);
      if (clientIds.length === 0) return { items: [], total: Number(totalCount), hasMore: false, nextOffset: null };

      // Batch fetch counts — storeCounts query is skipped unless the caller
      // opted in via `includeStores`. Keeps the common list view one DB
      // roundtrip cheaper.
      const includeStores = input?.includeStores ?? false;
      const [proposalCounts, orderCounts, storeCounts, logoCounts] = await Promise.all([
        db
          .select({ clientId: proposals.clientId, cnt: count() })
          .from(proposals)
          .where(sql`${proposals.clientId} IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})`)
          .groupBy(proposals.clientId),
        db
          .select({ clientId: orders.clientId, cnt: count() })
          .from(orders)
          .where(sql`${orders.clientId} IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})`)
          .groupBy(orders.clientId),
        includeStores
          ? db
              .select({ clientId: stores.clientId, cnt: count() })
              .from(stores)
              .where(sql`${stores.clientId} IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})`)
              .groupBy(stores.clientId)
          : Promise.resolve([] as Array<{ clientId: number; cnt: number }>),
        db
          .select({ clientId: clientLogos.clientId, cnt: count() })
          .from(clientLogos)
          .where(sql`${clientLogos.clientId} IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})`)
          .groupBy(clientLogos.clientId),
      ]);

      const pMap = new Map(proposalCounts.map((r) => [r.clientId, Number(r.cnt)]));
      const oMap = new Map(orderCounts.map((r) => [r.clientId, Number(r.cnt)]));
      const sMap = new Map(storeCounts.map((r) => [r.clientId, Number(r.cnt)]));
      const lMap = new Map(logoCounts.map((r) => [r.clientId, Number(r.cnt)]));

      // Determine if there are more results
      const hasMore = filtered.length > limit;
      const page = hasMore ? filtered.slice(0, limit) : filtered;

      const items = page.map((c) => ({
        ...c,
        proposalCount: pMap.get(c.id) || 0,
        orderCount: oMap.get(c.id) || 0,
        storeCount: sMap.get(c.id) || 0,
        logoCount: lMap.get(c.id) || 0,
      }));

      return {
        items,
        total: Number(totalCount),
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      };
    }),

  /**
   * Get a single client with full related data.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      const scope = getOrgScope(ctx);

      const rows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, input.id), scope.clients))
        .limit(1);

      if (rows.length === 0)
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      const client = rows[0];

      // Fetch all related data in parallel
      const [clientProposals, clientOrders, clientStores, clientLogosArr, clientProofs, clientAssetsArr] =
        await Promise.all([
          db
            .select()
            .from(proposals)
            .where(and(eq(proposals.clientId, client.id), scope.proposals))
            .orderBy(desc(proposals.updatedAt))
            .limit(500),
          db
            .select()
            .from(orders)
            .where(and(eq(orders.clientId, client.id), scope.orders))
            .orderBy(desc(orders.createdAt))
            .limit(500),
          db
            .select()
            .from(stores)
            .where(and(eq(stores.clientId, client.id), scope.stores))
            .orderBy(desc(stores.createdAt))
            .limit(500),
          db
            .select()
            .from(clientLogos)
            .where(eq(clientLogos.clientId, client.id))
            .orderBy(desc(clientLogos.createdAt))
            .limit(500),
          db
            .select()
            .from(virtualProofs)
            .where(and(eq(virtualProofs.clientId, client.id), scope.virtualProofs))
            .orderBy(desc(virtualProofs.createdAt))
            .limit(10),
          db
            .select()
            .from(clientAssets)
            .where(and(eq(clientAssets.clientId, client.id), scope.clientAssets))
            .orderBy(desc(clientAssets.createdAt))
            .limit(500),
        ]);

      // Calculate total revenue from orders
      const totalRevenue = clientOrders.reduce(
        (sum, o) => sum + parseFloat(String(o.total || "0")),
        0
      );

      return {
        ...client,
        proposals: clientProposals,
        orders: clientOrders,
        stores: clientStores,
        logos: clientLogosArr,
        proofs: clientProofs,
        assets: clientAssetsArr,
        totalRevenue,
        proposalCount: clientProposals.length,
        orderCount: clientOrders.length,
        storeCount: clientStores.length,
        logoCount: clientLogosArr.length,
        assetCount: clientAssetsArr.length,
      };
    }),

  /**
   * Aggregate stats across all clients for the current user.
   */
  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database unavailable",
      });
    const scope = getOrgScope(ctx);

    const [clientStats] = await db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${clients.status} = 'active' then 1 else 0 end)`,
        prospects: sql<number>`sum(case when ${clients.status} = 'prospect' then 1 else 0 end)`,
        inactive: sql<number>`sum(case when ${clients.status} = 'inactive' then 1 else 0 end)`,
      })
      .from(clients)
      .where(scope.clients);

    const [revenueStats] = await db
      .select({
        totalRevenue: sql<number>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .where(scope.orders);

    return {
      total: Number(clientStats?.total ?? 0),
      active: Number(clientStats?.active ?? 0),
      prospects: Number(clientStats?.prospects ?? 0),
      inactive: Number(clientStats?.inactive ?? 0),
      totalRevenue: Number(revenueStats?.totalRevenue ?? 0),
    };
  }),

  /**
   * List all products available across a client's stores, with a flag
   * indicating whether client-specific pricing has been configured.
   */
  listClientProducts: protectedProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Get all stores for this client
      const clientStores = await db
        .select({ id: stores.id })
        .from(stores)
        .where(and(eq(stores.clientId, input.clientId), scope.stores));

      if (clientStores.length === 0) return [];

      const storeIds = clientStores.map(s => s.id);

      // Get all store products with their master product data
      const rows = await db
        .select({
          storeProductId: storeProducts.id,
          productId: products.id,
          name: products.name,
          sku: products.sku,
          category: products.category,
          imageUrl: products.imageUrl,
          basePrice: products.basePrice,
          hasClientPricing: clientProductConfig.id,
          defaultImprintZoneId: clientProductConfig.defaultImprintZoneId,
        })
        .from(storeProducts)
        .innerJoin(products, eq(products.id, storeProducts.productId))
        .leftJoin(clientProductConfig, and(
          eq(clientProductConfig.productId, products.id),
          eq(clientProductConfig.clientId, input.clientId),
        ))
        .where(inArray(storeProducts.storeId, storeIds))
        .orderBy(products.name);

      // Deduplicate by productId
      const seen = new Set<number>();
      return rows.filter(r => {
        if (seen.has(r.productId)) return false;
        seen.add(r.productId);
        return true;
      }).map(r => ({
        ...r,
        hasClientPricing: !!r.hasClientPricing,
      }));
    }),

  /**
   * Create a new client.
   */
  create: protectedProcedure
    .input(
      z.object({
        companyName: z.string().min(1),
        industry: z.string().optional(),
        companySize: z.string().optional(),
        website: z.string().optional(),
        address: z.string().optional(),
        contactName: z.string().min(1),
        contactTitle: z.string().optional(),
        contactEmail: z.string().email(),
        contactPhone: z.string().optional(),
        pocEmail: z.string().email().optional(),
        hasWebstore: z.boolean().optional(),
        status: z.enum(["active", "inactive", "prospect"]).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });

      const scope = getOrgScope(ctx);
      // Enforce plan client limit INSIDE a transaction to prevent TOCTOU race conditions.
      // MySQL InnoDB holds a shared lock on the count until the transaction commits,
      // so concurrent requests cannot both pass the limit check and both insert.
      const values: InsertClient = {
        ...scope.stamp,
        companyName: input.companyName,
        industry: input.industry ?? null,
        companySize: input.companySize ?? null,
        website: input.website ?? null,
        address: input.address ?? null,
        contactName: input.contactName,
        contactTitle: input.contactTitle ?? null,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone ?? null,
        hasWebstore: input.hasWebstore ?? false,
        status: input.status ?? "prospect",
        notes: input.notes ?? null,
        pocEmail: input.pocEmail ?? null,
      };
      let insertId!: number;
      await db.transaction(async (tx) => {
        await checkClientLimit(tx, scope, ctx.user.subscriptionTier);
        const result = await tx.insert(clients).values(values);
        insertId = result[0].insertId;

        // Mirror the primary contact into clientContacts so the multi-contact
        // UI always has at least one row to show. Split contactName on the
        // first space into firstName/lastName using the same heuristic as the
        // backfill migration.
        const rawName = input.contactName.trim();
        const spaceIdx = rawName.indexOf(" ");
        const firstName = spaceIdx === -1 ? rawName : rawName.slice(0, spaceIdx).trim();
        const lastName = spaceIdx === -1 ? null : rawName.slice(spaceIdx + 1).trim() || null;
        await tx.insert(clientContacts).values({
          clientId: insertId,
          firstName: firstName || null,
          lastName,
          email: input.contactEmail,
          phone: input.contactPhone ?? null,
          title: input.contactTitle ?? null,
          isPrimary: true,
        });

        // Auto-populate externalCustomerId for PSRESTful Sub-Accounts routing.
        await tx.update(clients)
          .set({ externalCustomerId: generateClientExternalId(insertId) })
          .where(eq(clients.id, insertId));
      });

      const created = await db.select().from(clients).where(eq(clients.id, insertId)).limit(1);

      // Agent: draft a welcome/introduction email (fire-and-forget, deduped).
      if (input.contactEmail) {
        onNewClientCreated(
          insertId,
          scope.stamp.organizationId ?? null,
          input.contactEmail,
          input.contactName,
          input.industry ?? null,
        ).catch((err: unknown) => {
          log.warn("[trigger] onNewClientCreated failed:", err);
        });
      }

      return created[0];
    }),

  /**
   * Update an existing client.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        companyName: z.string().min(1).optional(),
        industry: z.string().nullable().optional(),
        companySize: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        contactName: z.string().min(1).optional(),
        contactTitle: z.string().nullable().optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().nullable().optional(),
        hasWebstore: z.boolean().optional(),
        status: z.enum(["active", "inactive", "prospect"]).optional(),
        notes: z.string().nullable().optional(),
        pocEmail: z.string().email().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      const scope = getOrgScope(ctx);

      const { id, ...updateData } = input;

      // Verify ownership
      const existing = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, id), scope.clients))
        .limit(1);
      if (existing.length === 0)
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      const setObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (value !== undefined) setObj[key] = value;
      }

      if (Object.keys(setObj).length > 0) {
        await db.update(clients).set(setObj).where(and(eq(clients.id, id), scope.clients));
      }

      const updated = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
      return updated[0];
    }),

  /**
   * Delete a client. Checks for related records and warns.
   */
  delete: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        force: z.boolean().optional(), // force delete even with related records
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      const scope = getOrgScope(ctx);

      // Verify ownership
      const existing = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, input.id), scope.clients))
        .limit(1);
      if (existing.length === 0)
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      // Check for related records
      const [relProposals, relOrders, relStores] = await Promise.all([
        db.select({ cnt: count() }).from(proposals).where(eq(proposals.clientId, input.id)),
        db.select({ cnt: count() }).from(orders).where(eq(orders.clientId, input.id)),
        db.select({ cnt: count() }).from(stores).where(eq(stores.clientId, input.id)),
      ]);

      const proposalCount = Number(relProposals[0]?.cnt || 0);
      const orderCount = Number(relOrders[0]?.cnt || 0);
      const storeCount = Number(relStores[0]?.cnt || 0);
      const hasRelated = proposalCount > 0 || orderCount > 0 || storeCount > 0;

      if (hasRelated && !input.force) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Client has ${proposalCount} proposal(s), ${orderCount} order(s), and ${storeCount} store(s). Use force delete to remove anyway.`,
        });
      }

      // ── Cascade delete all related records inside a transaction ──────────────
      return await withTransaction(async (txDb) => {
        // 1. Get all proposal IDs for this client (needed for child tables)
        const clientProposals = await txDb
          .select({ id: proposals.id })
          .from(proposals)
          .where(eq(proposals.clientId, input.id));
        const proposalIds = clientProposals.map((p) => p.id);

        // 2. Delete department approvals and proposal products for each proposal
        if (proposalIds.length > 0) {
          await txDb
            .delete(departmentApprovals)
            .where(sql`${departmentApprovals.proposalId} IN (${sql.join(proposalIds.map((id) => sql`${id}`), sql`, `)})`);
          await txDb
            .delete(proposalProducts)
            .where(sql`${proposalProducts.proposalId} IN (${sql.join(proposalIds.map((id) => sql`${id}`), sql`, `)})`);
        }

        // 3. Delete proposals
        await txDb.delete(proposals).where(eq(proposals.clientId, input.id));

        // 4. Get all order IDs for this client (needed for order items)
        const clientOrders = await txDb
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.clientId, input.id));
        const orderIds = clientOrders.map((o) => o.id);

        // 5. Delete order items then orders
        if (orderIds.length > 0) {
          await txDb
            .delete(orderItems)
            .where(sql`${orderItems.orderId} IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)})`);
        }
        await txDb.delete(orders).where(eq(orders.clientId, input.id));

        // 6. Get all store IDs for this client (needed for store products)
        const clientStores = await txDb
          .select({ id: stores.id })
          .from(stores)
          .where(eq(stores.clientId, input.id));
        const storeIds = clientStores.map((s) => s.id);

        // 7. Delete store products then stores
        if (storeIds.length > 0) {
          await txDb
            .delete(storeProducts)
            .where(sql`${storeProducts.storeId} IN (${sql.join(storeIds.map((id) => sql`${id}`), sql`, `)})`);
        }
        await txDb.delete(stores).where(eq(stores.clientId, input.id));

        // 8. Delete virtual proofs
        await txDb.delete(virtualProofs).where(eq(virtualProofs.clientId, input.id));

        // 9. Delete logos, assets, and contacts
        await txDb.delete(clientLogos).where(eq(clientLogos.clientId, input.id));
        await txDb.delete(clientAssets).where(eq(clientAssets.clientId, input.id));
        await txDb.delete(clientContacts).where(eq(clientContacts.clientId, input.id));

        // 10. Delete the client
        await txDb.delete(clients).where(eq(clients.id, input.id));

        return {
          success: true,
          deletedRelated: {
            proposals: proposalIds.length,
            orders: orderIds.length,
            stores: storeIds.length,
            virtualProofs: true,
            logos: true,
            assets: true,
          },
        };
      });
    }),
});
