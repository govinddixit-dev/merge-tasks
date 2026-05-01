import { COOKIE_NAME, REFRESH_COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { clientsRouter } from "./routers/clients";
import { clientContactsRouter } from "./routers/clientContacts";
import { clientPricingRouter } from "./routers/clientPricing";
import { productsRouter } from "./routers/products";
import { proposalsRouter } from "./routers/proposals";
import { storesRouter } from "./routers/stores";
import { ordersRouter } from "./routers/orders";
import { apiConnectionsRouter } from "./routers/apiConnections";
import { copilotRouter } from "./routers/copilot";
import { proofingRouter } from "./routers/proofing";
import { billingRouter } from "./routers/billing";
import { emailRouter } from "./routers/email";
import { onboardingRouter } from "./routers/onboarding";
import { waitlistRouter } from "./routers/waitlist";
import { storeAuthRouter } from "./routers/storeAuth";
import { socialAuthRouter } from "./routers/socialAuth";
import { voiceRouter } from "./routers/voice";
import { brandingRouter } from "./routers/branding";
import { departmentApprovalsRouter } from "./routers/departmentApprovals";
import { aiInsightsRouter } from "./routers/aiInsights";
import { storePortalRouter } from "./routers/storePortal";
import { storeUserProvisioningRouter } from "./routers/storeUserProvisioning";
import { estimatesInvoicesRouter } from "./routers/estimatesInvoices";
import { organizationsRouter } from "./routers/organizations";
import { externalProductsRouter } from "./routers/externalProducts";
import { notificationsRouter } from "./routers/notifications";
import { stripeConnectRouter } from "./routers/stripeConnect";
import { storeCheckoutRouter } from "./routers/storeCheckout";
import { accountDeletionRouter } from "./routers/accountDeletion";
import { dataExportRouter } from "./routers/dataExport";
import { platformAdminRouter } from "./routers/platformAdmin";
import { storeSsoRouter as storeSsoTrpcRouter } from "./routers/storeSso";
import { refundsRouter } from "./routers/refunds";
import { actionApprovalRouter } from "./routers/actionApproval";
import { agentRouter } from "./routers/agent";
import { storeDepartmentBudgetsRouter } from "./routers/storeDepartmentBudgets";
import { purchaseOrdersRouter } from "./routers/purchaseOrders";
import { printProductsRouter, printSupplierRouter } from "./routers/printProducts";
import { printRequestsCrudRouter } from "./routers/printRequestsCrud";
import { storeMediaRouter } from "./routers/storeMedia";
import { promoCodesCrudRouter } from "./routers/promoCodesCrud";
import { collectionsRouter } from "./routers/collections";
import { imprintZonesRouter } from "./routers/imprintZones";
import { supplierSyncRouter } from "./routers/supplierSync";
import { supplierCredentialsRouter } from "./routers/supplierCredentials";
import { psRestfulSubAccountsRouter } from "./routers/psRestfulSubAccounts";
import { fulfillmentRouter } from "./routers/fulfillment";
import { revokeAllUserSessions } from "./utils/tokenBlocklist";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),

    /** Standard logout — clears cookies for the current device. */
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(REFRESH_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),

    /**
     * Logout all devices — revokes every active session for the current user.
     * Clears cookies on this device AND adds a per-user revocation timestamp
     * to the token blocklist so all other devices are rejected on next request.
     */
    logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
      // Revoke all tokens issued before now
      await revokeAllUserSessions(ctx.user.openId);

      // Clear cookies on the current device
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(REFRESH_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });

      return {
        success: true,
        message: "All sessions have been revoked. You will need to sign in again on all devices.",
      } as const;
    }),

    /**
     * Update the AI copilot approval level for the CURRENT USER (solo path).
     * When the user belongs to an organization, prefer `organizations.updateSettings`
     * instead — the org-level setting takes precedence in copilot execution.
     */
    updateAiApprovalLevel: protectedProcedure
      .input(z.object({ aiApprovalLevel: z.enum(["all_auto", "review_auto", "all_review"]) }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        await db.update(users).set({ aiApprovalLevel: input.aiApprovalLevel }).where(eq(users.id, ctx.user.id));
        return { success: true } as const;
      }),
  }),

  clients: clientsRouter,
  clientContacts: clientContactsRouter,
  clientPricing: clientPricingRouter,
  products: productsRouter,
  proposals: proposalsRouter,
  stores: storesRouter,
  orders: ordersRouter,
  apiConnections: apiConnectionsRouter,
  copilot: copilotRouter,
  proofing: proofingRouter,
  billing: billingRouter,
  email: emailRouter,
  onboarding: onboardingRouter,
  waitlist: waitlistRouter,
  storeAuth: storeAuthRouter,
  socialAuth: socialAuthRouter,
  voice: voiceRouter,
  branding: brandingRouter,
  departmentApprovals: departmentApprovalsRouter,
  aiInsights: aiInsightsRouter,
  storePortal: storePortalRouter,
  storeProvisioning: storeUserProvisioningRouter,
  estimatesInvoices: estimatesInvoicesRouter,
  organizations: organizationsRouter,
  externalProducts: externalProductsRouter,
  notifications: notificationsRouter,
  stripeConnect: stripeConnectRouter,
  storeCheckout: storeCheckoutRouter,
  account: accountDeletionRouter,
  dataExport: dataExportRouter,
  platformAdmin: platformAdminRouter,
  storeSso: storeSsoTrpcRouter,
  refunds: refundsRouter,
  actionApproval: actionApprovalRouter,
  agent: agentRouter,
  storeDepartmentBudgets: storeDepartmentBudgetsRouter,
  purchaseOrders: purchaseOrdersRouter,
  promoCodes: promoCodesCrudRouter,
  collections: collectionsRouter,
  imprintZones: imprintZonesRouter,
  printProducts: printProductsRouter,
  printSupplier: printSupplierRouter,
  printRequests: printRequestsCrudRouter,
  storeMedia: storeMediaRouter,
  supplierSync: supplierSyncRouter,
  supplierCredentials: supplierCredentialsRouter,
  psRestfulSubAccounts: psRestfulSubAccountsRouter,
  fulfillment: fulfillmentRouter,
});

export type AppRouter = typeof appRouter;
