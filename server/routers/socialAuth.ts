import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { SOCIAL_AUTH_LIMIT } from "../utils/rateLimiter";

/**
 * Social Auth Router — Google & Microsoft OAuth for distributor sign-in/sign-up
 *
 * Flow:
 * 1. Frontend calls socialAuth.getGoogleUrl / socialAuth.getMicrosoftUrl with origin
 * 2. Frontend redirects to the returned URL
 * 3. Provider redirects back to /api/auth/google/callback or /api/auth/microsoft/callback
 * 4. Express callback handler exchanges code, gets user info, upserts user, sets session cookie
 * 5. Redirects to /dashboard
 */

//  Google OAuth helpers 
function buildGoogleAuthUrl(origin: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the project root `.env` file (or the process environment), then restart the server.",
    });
  }

  const redirectUri = `${origin}/api/auth/google/callback`;
  const state = Buffer.from(JSON.stringify({ origin })).toString("base64url");
  const scopes = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ].join(" ");

  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
}

//  Microsoft OAuth helpers 
function buildMicrosoftAuthUrl(origin: string): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in the project root `.env` file (or the process environment), then restart the server.",
    });
  }

  const redirectUri = `${origin}/api/auth/microsoft/callback`;
  const state = Buffer.from(JSON.stringify({ origin })).toString("base64url");
  const scopes = "openid profile email offline_access";

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
}

export const socialAuthRouter = router({
  /**
   * Get Google OAuth URL — frontend redirects user to this URL
   */
  getGoogleUrl: publicProcedure
    .use(rateLimited("socialAuth.getGoogleUrl", SOCIAL_AUTH_LIMIT))
    .input(z.object({ origin: z.string().url() }))
    .mutation(({ input }) => {
      return { url: buildGoogleAuthUrl(input.origin) };
    }),

  /**
   * Get Microsoft OAuth URL — frontend redirects user to this URL
   */
  getMicrosoftUrl: publicProcedure
    .use(rateLimited("socialAuth.getMicrosoftUrl", SOCIAL_AUTH_LIMIT))
    .input(z.object({ origin: z.string().url() }))
    .mutation(({ input }) => {
      return { url: buildMicrosoftAuthUrl(input.origin) };
    }),
});

//  Express callback handlers (registered in _core/index.ts) 

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Google OAuth not configured" });

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
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Google token exchange failed: ${err}` });
  }

  return resp.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  }>;
}

export async function getGoogleUserInfo(accessToken: string) {
  const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to get Google user info" });
  return resp.json() as Promise<{ email: string; name: string; id: string; picture?: string }>;
}

export async function exchangeMicrosoftCode(code: string, redirectUri: string) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Microsoft OAuth not configured" });

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
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Microsoft token exchange failed: ${err}` });
  }

  return resp.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  }>;
}

export async function getMicrosoftUserInfo(accessToken: string) {
  const resp = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    console.error(`[Microsoft Graph] /me failed (${resp.status}):`, errBody);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to get Microsoft user info: ${resp.status} ${errBody}` });
  }
  return resp.json() as Promise<{
    mail: string;
    displayName: string;
    userPrincipalName: string;
    id: string;
  }>;
}
