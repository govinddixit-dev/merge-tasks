/**
 * emailRouterConnections.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Connection management procedures:
 *   - listConnections  — list all connected email accounts
 *   - disconnect       — disconnect an account and re-assign default if needed
 *   - setDefault       — set a connection as the default sender
 *   - testConnection   — send a test email via the specified connection
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { emailConnections } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../../utils/orgScope";
import { decryptCredential } from "../../utils/encryption";
import { auditLog } from "../../utils/auditLog";
import {
  sendViaGmail, refreshGmailToken,
  sendViaOutlook, refreshOutlookToken,
  sendViaSMTP,
} from "./emailRouterHelpers";

export const emailConnectionsRouter = router({
  /** List connected email accounts for the current user */
  listConnections: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const scope = getOrgScope(ctx);
    const connections = await db.select().from(emailConnections).where(scope.emailConnections);

    return connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      email: c.email,
      displayName: c.displayName,
      isDefault: c.isDefault,
      status: c.status,
      createdAt: c.createdAt,
    }));
  }),

  /** Disconnect an email account */
  disconnect: protectedProcedure
    .input(z.object({ connectionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [connection] = await db
        .select()
        .from(emailConnections)
        .where(and(eq(emailConnections.id, input.connectionId), scope.emailConnections))
        .limit(1);

      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }

      await db
        .update(emailConnections)
        .set({ status: "disconnected", accessToken: null, refreshToken: null })
        .where(eq(emailConnections.id, input.connectionId));

      // If this was the default, promote another connected account
      if (connection.isDefault) {
        const remaining = await db
          .select()
          .from(emailConnections)
          .where(and(scope.emailConnections, eq(emailConnections.status, "connected")))
          .limit(1);

        if (remaining.length > 0) {
          await db
            .update(emailConnections)
            .set({ isDefault: true })
            .where(eq(emailConnections.id, remaining[0].id));
        }
      }

      auditLog({
        action: "email.connection.deleted",
        userId: ctx.user.id,
        resourceType: "emailConnection",
        resourceId: input.connectionId,
        description: `Disconnected email connection ${connection.provider} (${connection.email})`,
        metadata: { provider: connection.provider, email: connection.email },
      });

      return { success: true };
    }),

  /** Set a connection as the default sender */
  setDefault: protectedProcedure
    .input(z.object({ connectionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const allConns = await db.select().from(emailConnections).where(scope.emailConnections);

      for (const conn of allConns) {
        await db
          .update(emailConnections)
          .set({ isDefault: conn.id === input.connectionId })
          .where(eq(emailConnections.id, conn.id));
      }

      return { success: true };
    }),

  /** Test email connection by sending a test email to the connected address */
  testConnection: protectedProcedure
    .input(z.object({ connectionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [connection] = await db
        .select()
        .from(emailConnections)
        .where(and(eq(emailConnections.id, input.connectionId), scope.emailConnections))
        .limit(1);

      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }

      const testHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <div style="background: #654BF9; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h2 style="color: white; margin: 0;">MergeTasks</h2>
          </div>
          <div style="padding: 20px; border: 1px solid #E5E5E5; border-top: none; border-radius: 0 0 8px 8px;">
            <p>This is a test email from your MergeTasks platform.</p>
            <p>Your <strong>${connection.provider.toUpperCase()}</strong> email connection is working correctly!</p>
            <p style="color: #737373; font-size: 12px;">Sent at: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `;

      try {
        if (connection.provider === "gmail") {
          let accessToken = decryptCredential(connection.accessToken) || "";
          if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date() && connection.refreshToken) {
            const refreshed = await refreshGmailToken(decryptCredential(connection.refreshToken) || "");
            accessToken = refreshed.access_token;
          }
          await sendViaGmail(accessToken, connection.email, connection.email, "MergeTasks - Email Connection Test", testHtml);
        } else if (connection.provider === "outlook") {
          let accessToken = decryptCredential(connection.accessToken) || "";
          if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date() && connection.refreshToken) {
            const refreshed = await refreshOutlookToken(decryptCredential(connection.refreshToken) || "");
            accessToken = refreshed.access_token;
          }
          await sendViaOutlook(accessToken, connection.email, "MergeTasks - Email Connection Test", testHtml);
        } else if (connection.provider === "smtp") {
          await sendViaSMTP(
            {
              host: connection.smtpHost!,
              port: connection.smtpPort!,
              username: connection.smtpUsername!,
              password: decryptCredential(connection.smtpPassword) || "",
              secure: connection.smtpSecure ?? true,
            },
            connection.email,
            connection.email,
            "MergeTasks - Email Connection Test",
            testHtml
          );
        }
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Test failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
});
