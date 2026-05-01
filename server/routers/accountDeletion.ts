/**
 * accountDeletion.ts — Account deletion flow (GDPR Art. 17 / CCPA right to deletion)
 *
 * Provides a full cascade delete of all user data across all tables.
 * The deletion is wrapped in a transaction to ensure atomicity.
 * An audit log entry is written BEFORE the deletion so there is a record
 * of who requested it and when, even after the data is gone.
 */
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { auditLog } from "../utils/auditLog";
import {
  users,
  clients,
  products,
  stores,
  storeProducts,
  proposals,
  proposalProducts,
  proposalProductVariants,
  proposalPriceTiers,
  proposalOrderItems,
  proposalProductImages,
  proposalSizeCharts,
  proposalVersions,
  orders,
  orderItems,
  virtualProofs,
  clientLogos,
  clientAssets,
  emailConnections,
  verificationCodes,
  distributorProfiles,
  apiConnections,
  storeUsers,
  storeVerificationCodes,
  storeAllowedDomains,
  storePasswordTokens,
  aiTrainingData,
  aiEditFeedback,
  departmentApprovals,
  copilotConversations,
  copilotMemory,
  copilotTaskLog,
  printRequests,
  productVariants,
  estimates,
  invoices,
  organizations,
  orgMembers,
  notifications,
} from "../../drizzle/schema";
import { getLogger } from "../utils/logger";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { ACCOUNT_DELETION_LIMIT } from "../utils/rateLimiter";

const log = getLogger("accountDeletion");

export const accountDeletionRouter = router({
  /**
   * Get a summary of what will be deleted — shown to user before confirmation.
   */
  preview: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const userId = ctx.user.id;

    // Count records in each major table
    const [clientCount] = await db.select({ count: eq(clients.userId, userId) }).from(clients).where(eq(clients.userId, userId));
    const clientRows = await db.select({ id: clients.id }).from(clients).where(eq(clients.userId, userId));
    const clientIds = clientRows.map(r => r.id);

    const [productCount] = await db.select({ count: eq(products.userId, userId) }).from(products).where(eq(products.userId, userId));
    const [storeCount] = await db.select({ count: eq(stores.userId, userId) }).from(stores).where(eq(stores.userId, userId));
    const [proposalCount] = await db.select({ count: eq(proposals.userId, userId) }).from(proposals).where(eq(proposals.userId, userId));
    const [orderCount] = await db.select({ count: eq(orders.userId, userId) }).from(orders).where(eq(orders.userId, userId));
    const [proofCount] = await db.select({ count: eq(virtualProofs.userId, userId) }).from(virtualProofs).where(eq(virtualProofs.userId, userId));

    return {
      email: ctx.user.email,
      counts: {
        clients: clientRows.length,
        products: productCount ? 1 : 0, // simplified — just indicate presence
        stores: storeCount ? 1 : 0,
        proposals: proposalCount ? 1 : 0,
        orders: orderCount ? 1 : 0,
        virtualProofs: proofCount ? 1 : 0,
      },
      warning: "This action is permanent and cannot be undone. All your data, including clients, proposals, stores, orders, and files will be permanently deleted.",
    };
  }),

  /**
   * Permanently delete the authenticated user's account and all associated data.
   * Requires the user to type their email as confirmation.
   */
  deleteMyAccount: protectedProcedure
    .use(rateLimited("accountDeletion.deleteMyAccount", ACCOUNT_DELETION_LIMIT))
    .input(z.object({
      confirmEmail: z.string().email(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify confirmation email matches
      if (!ctx.user.email || input.confirmEmail.toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirmation email does not match your account email.",
        });
      }

      const userId = ctx.user.id;

      // Write audit log BEFORE deletion (so the record exists even after user data is gone)
      auditLog({
        action: "user.deleted",
        userId,
        actorEmail: ctx.user.email || "unknown",
        ip: ctx.req?.ip || ctx.req?.socket?.remoteAddress || "unknown",
        description: `Account self-deletion requested. Confirmed email: ${input.confirmEmail}`,
      });

      log.info(`Account deletion requested by user ${userId} (${ctx.user.email})`);

      try {
        await db.transaction(async (tx) => {
          // 1. Get all entity IDs owned by this user for cascade
          const userClients = await tx.select({ id: clients.id }).from(clients).where(eq(clients.userId, userId));
          const clientIds = userClients.map(r => r.id);

          const userProposals = await tx.select({ id: proposals.id }).from(proposals).where(eq(proposals.userId, userId));
          const proposalIds = userProposals.map(r => r.id);

          const userStores = await tx.select({ id: stores.id }).from(stores).where(eq(stores.userId, userId));
          const storeIds = userStores.map(r => r.id);

          const userOrders = await tx.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));
          const orderIds = userOrders.map(r => r.id);

          const userProducts = await tx.select({ id: products.id }).from(products).where(eq(products.userId, userId));
          const productIds = userProducts.map(r => r.id);

          const userEstimates = await tx.select({ id: estimates.id }).from(estimates).where(eq(estimates.userId, userId));
          const estimateIds = userEstimates.map(r => r.id);

          // 2. Delete deepest children first (leaf tables)

          // Proposal children
          if (proposalIds.length > 0) {
            const proposalProds = await tx.select({ id: proposalProducts.id }).from(proposalProducts)
              .where(inArray(proposalProducts.proposalId, proposalIds));
            const ppIds = proposalProds.map(r => r.id);

            if (ppIds.length > 0) {
              await tx.delete(proposalProductVariants).where(inArray(proposalProductVariants.proposalProductId, ppIds));
              await tx.delete(proposalPriceTiers).where(inArray(proposalPriceTiers.proposalProductId, ppIds));
              await tx.delete(proposalProductImages).where(inArray(proposalProductImages.proposalProductId, ppIds));
              await tx.delete(proposalSizeCharts).where(inArray(proposalSizeCharts.proposalProductId, ppIds));
            }
            await tx.delete(proposalProducts).where(inArray(proposalProducts.proposalId, proposalIds));
            await tx.delete(proposalOrderItems).where(inArray(proposalOrderItems.proposalId, proposalIds));
            await tx.delete(proposalVersions).where(inArray(proposalVersions.proposalId, proposalIds));
            await tx.delete(departmentApprovals).where(inArray(departmentApprovals.proposalId, proposalIds));
          }

          // Order children
          if (orderIds.length > 0) {
            await tx.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
          }

          // Store children
          if (storeIds.length > 0) {
            await tx.delete(storeProducts).where(inArray(storeProducts.storeId, storeIds));
            await tx.delete(storeUsers).where(inArray(storeUsers.storeId, storeIds));
            await tx.delete(storeVerificationCodes).where(inArray(storeVerificationCodes.storeId, storeIds));
            await tx.delete(storeAllowedDomains).where(inArray(storeAllowedDomains.storeId, storeIds));
            await tx.delete(storePasswordTokens).where(inArray(storePasswordTokens.storeId, storeIds));
          }

          // Product children
          if (productIds.length > 0) {
            await tx.delete(productVariants).where(inArray(productVariants.productId, productIds));
          }

          // Client children
          if (clientIds.length > 0) {
            await tx.delete(clientLogos).where(inArray(clientLogos.clientId, clientIds));
            await tx.delete(clientAssets).where(inArray(clientAssets.clientId, clientIds));
          }

          // Invoice children — delete by userId to catch ALL invoices (not just estimate-linked)
          // This also handles invoices linked to proposals or orders directly
          await tx.delete(invoices).where(eq(invoices.userId, userId));

          // 3. Delete parent entities
          await tx.delete(proposals).where(eq(proposals.userId, userId));
          await tx.delete(orders).where(eq(orders.userId, userId));
          await tx.delete(stores).where(eq(stores.userId, userId));
          await tx.delete(products).where(eq(products.userId, userId));
          await tx.delete(clients).where(eq(clients.userId, userId));
          await tx.delete(estimates).where(eq(estimates.userId, userId));
          await tx.delete(virtualProofs).where(eq(virtualProofs.userId, userId));
          await tx.delete(printRequests).where(eq(printRequests.userId, userId));
          await tx.delete(emailConnections).where(eq(emailConnections.userId, userId));
          await tx.delete(apiConnections).where(eq(apiConnections.userId, userId));
          await tx.delete(distributorProfiles).where(eq(distributorProfiles.userId, userId));
          await tx.delete(verificationCodes).where(eq(verificationCodes.userId, userId));

          // AI / Copilot data
          await tx.delete(copilotConversations).where(eq(copilotConversations.userId, userId));
          await tx.delete(copilotMemory).where(eq(copilotMemory.userId, userId));
          await tx.delete(copilotTaskLog).where(eq(copilotTaskLog.userId, userId));
          await tx.delete(aiTrainingData).where(eq(aiTrainingData.userId, userId));
          await tx.delete(aiEditFeedback).where(eq(aiEditFeedback.userId, userId));

          // Notifications
          await tx.delete(notifications).where(eq(notifications.userId, userId));

          // Organization membership (leave orgs, don't delete the org if others are in it)
          await tx.delete(orgMembers).where(eq(orgMembers.userId, userId));

          // 4. Finally, delete the user record itself
          await tx.delete(users).where(eq(users.id, userId));
        });

        log.info(`Account deletion completed for user ${userId}`);

        return {
          success: true,
          message: "Your account and all associated data have been permanently deleted.",
        };
      } catch (error) {
        log.error(`Account deletion failed for user ${userId}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Account deletion failed. Please contact support.",
        });
      }
    }),
});
