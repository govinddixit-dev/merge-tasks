/**
 * emailRouterHelpers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure OAuth and transport helpers used across the email router sub-modules.
 * No tRPC procedures — only functions.
 *
 * Exports:
 *   Gmail:   getGmailAuthUrl, exchangeGmailCode, getGmailUserInfo,
 *            sendViaGmail, refreshGmailToken
 *   Outlook: getOutlookAuthUrl, exchangeOutlookCode, getOutlookUserInfo,
 *            sendViaOutlook, refreshOutlookToken
 *   SMTP:    sendViaSMTP
 * ─────────────────────────────────────────────────────────────────────────────
 */

import nodemailer from "nodemailer";
import { TRPCError } from "@trpc/server";

// ─── Gmail ────────────────────────────────────────────────────────────────────

export function getGmailAuthUrl(origin: string, userId: number): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Gmail OAuth not configured. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Settings → API Keys.",
    });
  }

  const redirectUri = `${origin}/api/email/gmail/callback`;
  const state = JSON.stringify({ userId, origin });
  const scopes = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ].join(" ");

  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
}

export async function exchangeGmailCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: string }> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Gmail OAuth not configured" });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Gmail token exchange failed: ${err}` });
  }

  return resp.json();
}

export async function getGmailUserInfo(
  accessToken: string
): Promise<{ email: string; name: string }> {
  const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to get Gmail user info" });
  return resp.json();
}

export async function sendViaGmail(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  htmlBody: string
): Promise<unknown> {
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    htmlBody,
  ];
  const rawMessage = messageParts.join("\r\n");
  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encodedMessage }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Gmail send failed: ${err}` });
  }
  return resp.json();
}

export async function refreshGmailToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Gmail OAuth not configured" });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to refresh Gmail token" });
  return resp.json();
}

// ─── Outlook ──────────────────────────────────────────────────────────────────

export function getOutlookAuthUrl(origin: string, userId: number): string {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  if (!clientId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Outlook OAuth not configured. Add OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET in Settings → API Keys.",
    });
  }

  const redirectUri = `${origin}/api/email/outlook/callback`;
  const state = JSON.stringify({ userId, origin });
  const scopes = "openid profile email Mail.Send offline_access";

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
}

export async function exchangeOutlookCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Outlook OAuth not configured" });

  const resp = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Outlook token exchange failed: ${err}` });
  }

  return resp.json();
}

export async function getOutlookUserInfo(
  accessToken: string
): Promise<{ mail: string; displayName: string; userPrincipalName: string }> {
  const resp = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to get Outlook user info" });
  return resp.json();
}

export async function sendViaOutlook(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string
): Promise<void> {
  const resp = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: [{ emailAddress: { address: to } }],
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Outlook send failed: ${err}` });
  }
}

export async function refreshOutlookToken(
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Outlook OAuth not configured" });

  const resp = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to refresh Outlook token" });
  return resp.json();
}

// ─── SMTP ─────────────────────────────────────────────────────────────────────

export async function sendViaSMTP(
  config: { host: string; port: number; username: string; password: string; secure: boolean },
  from: string,
  to: string,
  subject: string,
  htmlBody: string
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
  });

  await transporter.sendMail({ from, to, subject, html: htmlBody });
}
