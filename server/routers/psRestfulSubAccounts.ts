import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { psRestfulSubAccounts, clients, organizations } from "../../drizzle/schema";
import { getOrgScope } from "../utils/orgScope";
import { psRestfulService } from "../integrations/PSRestfulService";
import { encryptCredential } from "../utils/encryption";
import { generateClientExternalId } from "../utils/externalCustomerId";

export const psRestfulSubAccountsRouter = router({

  /**
   * Get sub-account status for a client.
   */
  getForClient: protectedProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [subAccount] = await db
        .select({
          id: psRestfulSubAccounts.id,
          psRestfulSubAccountId: psRestfulSubAccounts.psRestfulSubAccountId,
          externalCustomerId: psRestfulSubAccounts.externalCustomerId,
          isActive: psRestfulSubAccounts.isActive,
          provisionedAt: psRestfulSubAccounts.provisionedAt,
          hasApiKey: psRestfulSubAccounts.apiKey,
        })
        .from(psRestfulSubAccounts)
        .where(eq(psRestfulSubAccounts.clientId, input.clientId))
        .limit(1);

      return subAccount ? {
        ...subAccount,
        hasApiKey: !!subAccount.hasApiKey,
      } : null;
    }),

  /**
   * Provision a PSRESTful sub-account for a client.
   * Only available when USE_SUB_ACCOUNTS=true and distributor has subAccountsEnabled.
   * Creates the sub-account in PSRESTful and stores the encrypted API key.
   */
  provision: protectedProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      if (process.env.USE_SUB_ACCOUNTS !== "true") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Sub-Accounts are not enabled on this platform yet. Contact support to upgrade to the Enterprise plan.",
        });
      }

      if (scope.organizationId === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Sub-Accounts require an organization context.",
        });
      }

      const [org] = await db
        .select({ subAccountsEnabled: organizations.subAccountsEnabled })
        .from(organizations)
        .where(eq(organizations.id, scope.organizationId))
        .limit(1);

      if (!org?.subAccountsEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Sub-Accounts are not enabled for your account. Contact support to enable this feature.",
        });
      }

      const [client] = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, input.clientId), scope.clients))
        .limit(1);

      if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      const [existing] = await db
        .select()
        .from(psRestfulSubAccounts)
        .where(eq(psRestfulSubAccounts.clientId, input.clientId))
        .limit(1);

      if (existing?.psRestfulSubAccountId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This client already has a PSRESTful sub-account.",
        });
      }

      const externalCustomerId = client.externalCustomerId ?? generateClientExternalId(client.id);

      const subAccount = await psRestfulService.createSubAccount({
        name: client.companyName,
        externalCustomerId,
        contactEmail: client.pocEmail ?? client.contactEmail,
        notes: `Created via MergeTasks for ${client.companyName}`,
      });

      const apiKey = await psRestfulService.createSubAccountApiKey(subAccount.id);
      const encryptedKey = encryptCredential(apiKey);

      if (existing) {
        await db.update(psRestfulSubAccounts)
          .set({
            psRestfulSubAccountId: subAccount.id,
            externalCustomerId,
            apiKey: encryptedKey,
            isActive: true,
            provisionedAt: new Date(),
          })
          .where(eq(psRestfulSubAccounts.id, existing.id));
      } else {
        await db.insert(psRestfulSubAccounts).values({
          clientId: input.clientId,
          organizationId: scope.organizationId,
          psRestfulSubAccountId: subAccount.id,
          externalCustomerId,
          apiKey: encryptedKey,
          isActive: true,
          provisionedAt: new Date(),
        });
      }

      return { success: true, psRestfulSubAccountId: subAccount.id, externalCustomerId };
    }),

  /**
   * Deprovision — soft delete the sub-account record.
   * Does not delete the sub-account in PSRESTful (contact support for that).
   */
  deprovision: protectedProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db.update(psRestfulSubAccounts)
        .set({ isActive: false })
        .where(eq(psRestfulSubAccounts.clientId, input.clientId));

      return { success: true };
    }),
});
