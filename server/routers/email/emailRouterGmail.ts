/**
 * emailRouterGmail.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gmail OAuth procedures:
 *   - connectGmail         — generate the Gmail OAuth consent URL
 *   - completeGmailConnect — exchange auth code for tokens, upsert connection
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { emailConnections } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../../utils/orgScope";
import { encryptCredential } from "../../utils/encryption";
import { auditLog } from "../../utils/auditLog";
import {
  getGmailAuthUrl,
  exchangeGmailCode,
  getGmailUserInfo,
} from "./emailRouterHelpers";

export const emailGmailRouter = router({
  /** Initiate Gmail OAuth flow — returns the consent URL */
  connectGmail: protectedProcedure
    .input(z.object({ origin: z.string() }))
    .mutation(({ ctx, input }) => {
      const url = getGmailAuthUrl(input.origin, ctx.user.id);
      return { url };
    }),

  /** Handle Gmail OAuth callback (called from the redirect handler) */
  completeGmailConnect: protectedProcedure
    .input(
      z.object({
        code: z.string(),
        origin: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const redirectUri = `${input.origin}/api/email/gmail/callback`;
      const tokens = await exchangeGmailCode(input.code, redirectUri);
      const userInfo = await getGmailUserInfo(tokens.access_token);

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Check if already connected — update tokens if so
      const existing = await db
        .select()
        .from(emailConnections)
        .where(
          and(
            scope.emailConnections,
            eq(emailConnections.provider, "gmail"),
            eq(emailConnections.email, userInfo.email)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(emailConnections)
          .set({
            accessToken: encryptCredential(tokens.access_token),
            refreshToken: encryptCredential(tokens.refresh_token),
            tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
            status: "connected",
          })
          .where(eq(emailConnections.id, existing[0].id));
        return { success: true, email: userInfo.email, action: "reconnected" };
      }

      // First connection → make it the default
      const allConnections = await db
        .select()
        .from(emailConnections)
        .where(scope.emailConnections);

      await db.insert(emailConnections).values({
        ...scope.stamp,
        provider: "gmail",
        email: userInfo.email,
        displayName: userInfo.name,
        accessToken: encryptCredential(tokens.access_token),
        refreshToken: encryptCredential(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        isDefault: allConnections.length === 0,
        status: "connected",
      });

      auditLog({
        action: "email.connection.created",
        userId: ctx.user.id,
        resourceType: "emailConnection",
        description: `Connected Gmail account ${userInfo.email}`,
        metadata: { provider: "gmail", email: userInfo.email },
      });

      return { success: true, email: userInfo.email, action: "connected" };
    }),
});
