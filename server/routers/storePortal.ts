/**
 * Store Portal Router — POC-authenticated procedures for the Client Portal.
 *
 * This file is a thin barrel that merges domain-specific sub-routers.
 * Each sub-router lives in its own file for single-responsibility:
 *
 *   storePortalAuth.ts         — shared session verification (resolveStoreSession)
 *   storePortalProposals.ts    — proposals.list, proposals.getById, proposals.forwardToDepartments, etc.
 *   storePortalOrders.ts       — orders.list, orders.getById
 *   storePortalDepartments.ts  — departments.list, departments.add, departments.update, departments.remove
 *   storePortalPrint.ts        — print.list, print.getById, print.submit
 *   storePortalRefunds.ts      — refunds.requestRefund, refunds.getStatus
 *
 * The only procedure that remains here is `dashboard` because it aggregates
 * data across all domains and doesn't belong to any single sub-router.
 */
import { z } from "zod";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import {
  proposals,
  departmentApprovals,
  orders,
  printRequests,
  distributorProfiles,
  customOrderRequests,
  storeUsers,
  storeDepartments,
} from "../../drizzle/schema";
import { resolveStoreSession, storeSlugInput } from "./storePortalAuth";

// Sub-routers
import { storePortalProposalsRouter } from "./storePortalProposals";
import { storePortalOrdersRouter } from "./storePortalOrders";
import { storePortalDepartmentsRouter } from "./storePortalDepartments";
import { storePortalPrintRouter } from "./storePortalPrint";
import { storePortalRefundsRouter } from "./storePortalRefunds";
import { storePortalBudgetsRouter } from "./storePortalBudgets";
import { storePortalStatsRouter } from "./storePortalStats";
import { storePortalCustomRequestsRouter } from "./storePortalCustomRequests";
import { storePortalLocationsRouter } from "./storePortalLocations";

// ── Router ─────────────────────────────────────────────────────────────

export const storePortalRouter = router({
  // ── Dashboard (cross-domain aggregate) ───────────────────────────────
  dashboard: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser, client } = await resolveStoreSession(ctx, input.storeSlug);

      // CR11 fix: Use SQL COUNT/SUM instead of loading all rows into memory

      // Proposal counts (aggregated in SQL)
      const [proposalStats] = await db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`SUM(CASE WHEN ${proposals.status} IN ('sent','viewed') THEN 1 ELSE 0 END)`,
          accepted: sql<number>`SUM(CASE WHEN ${proposals.status} = 'accepted' THEN 1 ELSE 0 END)`,
        })
        .from(proposals)
        .where(eq(proposals.clientId, store.clientId));

      // Department approval counts — use a subquery on proposalIds for this client
      const [approvalStats] = await db
        .select({
          total: sql<number>`count(*)`,
          pending: sql<number>`SUM(CASE WHEN ${departmentApprovals.status} = 'pending' THEN 1 ELSE 0 END)`,
        })
        .from(departmentApprovals)
        .where(sql`${departmentApprovals.proposalId} IN (SELECT ${proposals.id} FROM ${proposals} WHERE ${proposals.clientId} = ${store.clientId})`);

      // Order counts + total spent (aggregated in SQL)
      const [orderStats] = await db
        .select({
          total: sql<number>`count(*)`,
          pending: sql<number>`SUM(CASE WHEN ${orders.status} IN ('pending','processing') THEN 1 ELSE 0 END)`,
          totalSpent: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} != 'cancelled' THEN ${orders.total} ELSE 0 END), '0')`,
        })
        .from(orders)
        .where(eq(orders.clientId, store.clientId));

      // Print request count (active only)
      const [printStats] = await db
        .select({
          active: sql<number>`SUM(CASE WHEN ${printRequests.status} NOT IN ('completed','rejected') THEN 1 ELSE 0 END)`,
        })
        .from(printRequests)
        .where(eq(printRequests.storeId, store.id));

      // Recent proposals (last 5, fetched with LIMIT)
      const recentProposalRows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.clientId, store.clientId))
        .orderBy(desc(proposals.createdAt))
        .limit(5);

      const recentProposals = recentProposalRows.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        estimatedValue: p.estimatedValue?.toString() || "0",
        createdAt: p.createdAt?.toISOString() || null,
        sentAt: p.sentAt?.toISOString() || null,
        multiDepartment: p.multiDepartment,
        fulfillmentRequestedAt: p.fulfillmentRequestedAt?.toISOString() || null,
      }));

      // Recent orders (last 5, fetched with LIMIT)
      const recentOrderRows = await db
        .select()
        .from(orders)
        .where(eq(orders.clientId, store.clientId))
        .orderBy(desc(orders.createdAt))
        .limit(5);

      const recentOrders = recentOrderRows.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total?.toString() || "0",
        createdAt: o.createdAt?.toISOString() || null,
      }));

      // Load distributor branding
      let distributorName = "Your Distributor";
      try {
        const [profile] = await db
          .select()
          .from(distributorProfiles)
          .where(eq(distributorProfiles.userId, store.userId))
          .limit(1);
        if (profile) {
          distributorName = profile.brandCompanyName || profile.companyName || "Your Distributor";
        }
      } catch (e) { /* ignore */ }

      return {
        user: {
          id: storeUser.id,
          name: storeUser.name,
          email: storeUser.email,
          role: storeUser.role,
          department: storeUser.department,
          spendingLimit: storeUser.spendingLimit?.toString() || null,
          pointsBalance: storeUser.pointsBalance,
        },
        store: {
          id: store.id,
          name: store.name,
          slug: store.slug,
          logoUrl: store.logoUrl,
          primaryColor: store.primaryColor,
          taxRate: store.taxRate ? parseFloat(store.taxRate) : null, // null = tax-exempt
          multiLocationEnabled: store.multiLocationEnabled ?? false,
        },
        client: client ? {
          id: client.id,
          companyName: client.companyName,
          industry: client.industry,
        } : null,
        distributorName,
        stats: {
          activeProposals: Number(proposalStats?.active ?? 0),
          acceptedProposals: Number(proposalStats?.accepted ?? 0),
          pendingApprovals: Number(approvalStats?.pending ?? 0),
          totalApprovals: Number(approvalStats?.total ?? 0),
          pendingOrders: Number(orderStats?.pending ?? 0),
          totalOrders: Number(orderStats?.total ?? 0),
          totalSpent: parseFloat(String(orderStats?.totalSpent ?? "0")).toFixed(2),
          activePrintRequests: Number(printStats?.active ?? 0),
        },
        recentProposals,
        recentOrders,
      };
    }),

  pendingApprovals: publicProcedure
    .input(storeSlugInput)
    .query(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      if (!["poc", "admin"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only POC or admin can view pending approvals" });
      }

      const rows = await db
        .select({
          id: customOrderRequests.id,
          title: customOrderRequests.title,
          description: customOrderRequests.description,
          quantity: customOrderRequests.quantity,
          status: customOrderRequests.status,
          createdAt: customOrderRequests.createdAt,
          employeeName: storeUsers.name,
          employeeEmail: storeUsers.email,
          departmentName: storeDepartments.name,
        })
        .from(customOrderRequests)
        .leftJoin(storeUsers, eq(storeUsers.id, customOrderRequests.storeUserId))
        .leftJoin(storeDepartments, eq(storeDepartments.id, storeUsers.departmentId))
        .where(and(
          eq(customOrderRequests.storeId, store.id),
          inArray(customOrderRequests.status, ["pending", "reviewed"]),
        ))
        .orderBy(desc(customOrderRequests.createdAt))
        .limit(50);

      return rows.map(r => ({
        id: String(r.id),
        employee: r.employeeName ?? r.employeeEmail ?? "Unknown",
        dept: r.departmentName ?? "No department",
        items: [r.title],
        total: r.quantity ? `Qty: ${r.quantity}` : "—",
        reason: r.description ?? "",
        date: r.createdAt?.toISOString() ?? "",
        status: r.status,
      }));
    }),

  approveOrder: publicProcedure
    .input(z.object({ storeSlug: z.string(), orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      if (!["poc", "admin"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only POC or admin can approve orders" });
      }
      await db.update(customOrderRequests)
        .set({ status: "approved" })
        .where(and(eq(customOrderRequests.id, Number(input.orderId)), eq(customOrderRequests.storeId, store.id)));
      return { success: true };
    }),

  denyOrder: publicProcedure
    .input(z.object({ storeSlug: z.string(), orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      if (!["poc", "admin"].includes(storeUser.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only POC or admin can deny orders" });
      }
      await db.update(customOrderRequests)
        .set({ status: "declined" })
        .where(and(eq(customOrderRequests.id, Number(input.orderId)), eq(customOrderRequests.storeId, store.id)));
      return { success: true };
    }),

  // ── Domain sub-routers ───────────────────────────────────────────────
  proposals: storePortalProposalsRouter,
  orders: storePortalOrdersRouter,
  departments: storePortalDepartmentsRouter,
  print: storePortalPrintRouter,
  refunds: storePortalRefundsRouter,
  budgets: storePortalBudgetsRouter,
  stats: storePortalStatsRouter,
  customRequests: storePortalCustomRequestsRouter,
  locations: storePortalLocationsRouter,
});
