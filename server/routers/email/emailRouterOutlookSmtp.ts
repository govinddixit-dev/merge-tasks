/**
 * emailRouterOutlookSmtp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Outlook OAuth, SMTP configuration, and email-send procedures:
 *   - connectOutlook         — generate the Outlook OAuth consent URL
 *   - completeOutlookConnect — exchange auth code for tokens, upsert connection
 *   - connectSMTP            — verify and save an SMTP configuration
 *   - sendEmail              — send via the user's default (or specified) provider
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eq, and } from "drizzle-orm";
import { z } from "zod";
import nodemailer from "nodemailer";
import { router, protectedProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { emailConnections } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../../utils/orgScope";
import { encryptCredential, decryptCredential } from "../../utils/encryption";
import { auditLog } from "../../utils/auditLog";
import {
  getOutlookAuthUrl,
  exchangeOutlookCode,
  getOutlookUserInfo,
  sendViaGmail,
  sendViaOutlook,
  sendViaSMTP,
  refreshGmailToken,
  refreshOutlookToken,
} from "./emailRouterHelpers";

export const emailOutlookSmtpRouter = router({
  /** Initiate Outlook OAuth flow — returns the consent URL */
  connectOutlook: protectedProcedure
    .input(z.object({ origin: z.string() }))
    .mutation(({ ctx, input }) => {
      const url = getOutlookAuthUrl(input.origin, ctx.user.id);
      return { url };
    }),

  /** Handle Outlook OAuth callback */
  completeOutlookConnect: protectedProcedure
    .input(
      z.object({
        code: z.string(),
        origin: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const redirectUri = `${input.origin}/api/email/outlook/callback`;
      const tokens = await exchangeOutlookCode(input.code, redirectUri);
      const userInfo = await getOutlookUserInfo(tokens.access_token);
      const email = userInfo.mail || userInfo.userPrincipalName;

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(emailConnections)
        .where(
          and(
            scope.emailConnections,
            eq(emailConnections.provider, "outlook"),
            eq(emailConnections.email, email)
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
        return { success: true, email, action: "reconnected" };
      }

      const allConnections = await db
        .select()
        .from(emailConnections)
        .where(scope.emailConnections);

      await db.insert(emailConnections).values({
        ...scope.stamp,
        provider: "outlook",
        email,
        displayName: userInfo.displayName,
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
        description: `Connected Outlook account ${email}`,
        metadata: { provider: "outlook", email },
      });

      return { success: true, email, action: "connected" };
    }),

  /** Configure and verify an SMTP connection */
  connectSMTP: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        displayName: z.string().optional(),
        host: z.string(),
        port: z.number(),
        username: z.string(),
        password: z.string(),
        secure: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Test the SMTP connection first
      try {
        const transporter = nodemailer.createTransport({
          host: input.host,
          port: input.port,
          secure: input.secure,
          auth: { user: input.username, pass: input.password },
        });
        await transporter.verify();
      } catch (err: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `SMTP connection failed: ${err instanceof Error ? err.message : String(err)}. Please check your credentials.`,
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(emailConnections)
        .where(
          and(
            scope.emailConnections,
            eq(emailConnections.provider, "smtp"),
            eq(emailConnections.email, input.email)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(emailConnections)
          .set({
            displayName: input.displayName || null,
            smtpHost: input.host,
            smtpPort: input.port,
            smtpUsername: input.username,
            smtpPassword: encryptCredential(input.password),
            smtpSecure: input.secure,
            status: "connected",
          })
          .where(eq(emailConnections.id, existing[0].id));
        return { success: true, action: "updated" };
      }

      const allConnections = await db
        .select()
        .from(emailConnections)
        .where(scope.emailConnections);

      await db.insert(emailConnections).values({
        ...scope.stamp,
        provider: "smtp",
        email: input.email,
        displayName: input.displayName || null,
        smtpHost: input.host,
        smtpPort: input.port,
        smtpUsername: input.username,
        smtpPassword: encryptCredential(input.password),
        smtpSecure: input.secure,
        isDefault: allConnections.length === 0,
        status: "connected",
      });

      auditLog({
        action: "email.connection.created",
        userId: ctx.user.id,
        resourceType: "emailConnection",
        description: `Connected SMTP account ${input.email} via ${input.host}:${input.port}`,
        metadata: { provider: "smtp", email: input.email, host: input.host, port: input.port },
      });

      return { success: true, action: "connected" };
    }),

  /** Send an email via the user's connected email provider */
  sendEmail: protectedProcedure
    .input(
      z.object({
        to: z.string().email(),
        subject: z.string(),
        htmlBody: z.string(),
        /** If not specified, uses the default connection */
        connectionId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      let connection;
      if (input.connectionId) {
        const [c] = await db
          .select()
          .from(emailConnections)
          .where(
            and(
              eq(emailConnections.id, input.connectionId),
              scope.emailConnections,
              eq(emailConnections.status, "connected")
            )
          )
          .limit(1);
        connection = c;
      } else {
        const [c] = await db
          .select()
          .from(emailConnections)
          .where(
            and(
              scope.emailConnections,
              eq(emailConnections.isDefault, true),
              eq(emailConnections.status, "connected")
            )
          )
          .limit(1);
        connection = c;
      }

      if (!connection) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No connected email account found. Please connect Gmail, Outlook, or SMTP in Settings → Email.",
        });
      }

      try {
        if (connection.provider === "gmail") {
          let accessToken = decryptCredential(connection.accessToken) || "";
          if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date()) {
            const decryptedRefresh = decryptCredential(connection.refreshToken);
            if (!decryptedRefresh) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Gmail token expired and no refresh token available. Please reconnect." });
            }
            const refreshed = await refreshGmailToken(decryptedRefresh);
            accessToken = refreshed.access_token;
            await db
              .update(emailConnections)
              .set({
                accessToken: encryptCredential(refreshed.access_token),
                tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
              })
              .where(eq(emailConnections.id, connection.id));
          }
          await sendViaGmail(accessToken, connection.email, input.to, input.subject, input.htmlBody);
        } else if (connection.provider === "outlook") {
          let accessToken = decryptCredential(connection.accessToken) || "";
          if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date()) {
            const decryptedRefresh = decryptCredential(connection.refreshToken);
            if (!decryptedRefresh) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Outlook token expired. Please reconnect." });
            }
            const refreshed = await refreshOutlookToken(decryptedRefresh);
            accessToken = refreshed.access_token;
            await db
              .update(emailConnections)
              .set({
                accessToken: encryptCredential(refreshed.access_token),
                refreshToken:
                  encryptCredential(refreshed.refresh_token) || connection.refreshToken,
                tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
              })
              .where(eq(emailConnections.id, connection.id));
          }
          await sendViaOutlook(accessToken, input.to, input.subject, input.htmlBody);
        } else if (connection.provider === "smtp") {
          const decryptedSmtpPass = decryptCredential(connection.smtpPassword);
          if (
            !connection.smtpHost ||
            !connection.smtpPort ||
            !connection.smtpUsername ||
            !decryptedSmtpPass
          ) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "SMTP configuration incomplete. Please update in Settings → Email." });
          }
          await sendViaSMTP(
            {
              host: connection.smtpHost,
              port: connection.smtpPort,
              username: connection.smtpUsername,
              password: decryptedSmtpPass,
              secure: connection.smtpSecure ?? true,
            },
            `${connection.displayName || connection.email} <${connection.email}>`,
            input.to,
            input.subject,
            input.htmlBody
          );
        }

        return { success: true, sentFrom: connection.email, provider: connection.provider };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Mark as expired if auth fails
        if (
          errMsg.includes("token") ||
          errMsg.includes("auth") ||
          errMsg.includes("401")
        ) {
          await db
            .update(emailConnections)
            .set({ status: "expired" })
            .where(eq(emailConnections.id, connection.id));
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to send email via ${connection.provider}: ${errMsg}`,
        });
      }
    }),
});
