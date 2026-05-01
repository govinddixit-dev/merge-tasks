import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { users, distributorProfiles } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  exchangeGoogleCode,
  getGoogleUserInfo,
  exchangeMicrosoftCode,
  getMicrosoftUserInfo,
} from "./routers/socialAuth";
import { getLogger } from "./utils/logger";

const log = getLogger("socialAuthCallbacks");

/**
 * Register Express routes for Google and Microsoft OAuth callbacks.
 * These are plain Express routes (not tRPC) because the OAuth provider
 * redirects the browser here with a code in the query string, and we
 * need to set a cookie and redirect — which tRPC mutations can't do cleanly.
 */
export function registerSocialAuthRoutes(app: Express) {
  //  Google OAuth Callback 
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const stateParam = req.query.state as string | undefined;

    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    try {
      // Parse state to get origin
      let origin = `${req.protocol}://${req.get("host")}`;
      if (stateParam) {
        try {
          const parsed = JSON.parse(Buffer.from(stateParam, "base64url").toString());
          if (parsed.origin) origin = parsed.origin;
        } catch {}
      }

      const redirectUri = `${origin}/api/auth/google/callback`;
      const tokens = await exchangeGoogleCode(code, redirectUri);
      const userInfo = await getGoogleUserInfo(tokens.access_token);

      if (!userInfo.email) {
        return res.status(400).json({ error: "Could not retrieve email from Google" });
      }

      // Find or create user
      const db = await getDb();
      if (!db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const openId = `google_${userInfo.id}`;

      // Check if a user with this email already exists (may have signed up with email/password)
      const existingByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, userInfo.email))
        .limit(1);

      let user;
      if (existingByEmail.length > 0) {
        // Link Google to existing account — update openId if it was a local account
        user = existingByEmail[0];
        // Update loginMethod to include google
        await db
          .update(users)
          .set({
            loginMethod: "google",
            lastSignedIn: new Date(),
            name: user.name || userInfo.name, // don't overwrite if already set
          })
          .where(eq(users.id, user.id));
      } else {
        // Create new user
        const [result] = await db.insert(users).values({
          openId,
          name: userInfo.name,
          email: userInfo.email,
          loginMethod: "google",
          role: "user",
          lastSignedIn: new Date(),
        });

        const userId = Number(result.insertId);

        // Create distributor profile placeholder
        await db.insert(distributorProfiles).values({
          userId,
          companyName: "",
          onboardingCompleted: false,
        });

        // Fetch the created user
        const created = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        user = created[0];
      }

      // Issue short-lived access + refresh token pair
      await sdk.issueTokenPair(req, res, user.openId, user.name || userInfo.name || "");

      // Check if onboarding is needed
      const profiles = await db
        .select()
        .from(distributorProfiles)
        .where(eq(distributorProfiles.userId, user.id))
        .limit(1);

      const needsOnboarding = profiles.length === 0 || !profiles[0].onboardingCompleted;

      if (needsOnboarding) {
        res.redirect(302, `/onboarding?userId=${user.id}&company=${encodeURIComponent("")}`);
      } else {
        res.redirect(302, "/dashboard");
      }
    } catch (error) {
      log.error("Google callback failed:", error);
      res.redirect(302, "/sign-in?error=google_auth_failed");
    }
  });

  //  Microsoft OAuth Callback 
  app.get("/api/auth/microsoft/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const stateParam = req.query.state as string | undefined;

    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    try {
      // Parse state to get origin
      let origin = `${req.protocol}://${req.get("host")}`;
      if (stateParam) {
        try {
          const parsed = JSON.parse(Buffer.from(stateParam, "base64url").toString());
          if (parsed.origin) origin = parsed.origin;
        } catch {}
      }

      const redirectUri = `${origin}/api/auth/microsoft/callback`;
      const tokens = await exchangeMicrosoftCode(code, redirectUri);

      // Try Graph API first, fall back to decoding id_token JWT
      let email = "";
      let displayName = "";
      let odId = "";

      try {
        const userInfo = await getMicrosoftUserInfo(tokens.access_token);
        email = userInfo.mail || userInfo.userPrincipalName || "";
        displayName = userInfo.displayName || "";
        odId = userInfo.id || "";
      } catch (graphErr) {
        log.warn("Microsoft Graph /me failed, falling back to id_token:", graphErr);
        // Decode id_token JWT payload (base64url, no verification needed — token came directly from Microsoft)
        if (tokens.id_token) {
          try {
            const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString());
            email = payload.email || payload.preferred_username || "";
            displayName = payload.name || "";
            odId = payload.oid || payload.sub || "";
          } catch (decodeErr) {
            log.error("Failed to decode Microsoft id_token:", decodeErr);
          }
        }
      }

      if (!email) {
        return res.status(400).json({ error: "Could not retrieve email from Microsoft" });
      }

      // Find or create user
      const db = await getDb();
      if (!db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const openId = `microsoft_${odId}`;

      // Check if a user with this email already exists
      const existingByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      let user;
      if (existingByEmail.length > 0) {
        user = existingByEmail[0];
        await db
          .update(users)
          .set({
            loginMethod: "microsoft",
            lastSignedIn: new Date(),
            name: user.name || displayName,
          })
          .where(eq(users.id, user.id));
      } else {
        const [result] = await db.insert(users).values({
          openId,
          name: displayName,
          email,
          loginMethod: "microsoft",
          role: "user",
          lastSignedIn: new Date(),
        });

        const userId = Number(result.insertId);

        await db.insert(distributorProfiles).values({
          userId,
          companyName: "",
          onboardingCompleted: false,
        });

        const created = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        user = created[0];
      }

      // Issue short-lived access + refresh token pair
      await sdk.issueTokenPair(req, res, user.openId, user.name || displayName || "");

      // Check if onboarding is needed
      const profiles = await db
        .select()
        .from(distributorProfiles)
        .where(eq(distributorProfiles.userId, user.id))
        .limit(1);

      const needsOnboarding = profiles.length === 0 || !profiles[0].onboardingCompleted;

      if (needsOnboarding) {
        res.redirect(302, `/onboarding?userId=${user.id}&company=${encodeURIComponent("")}`);
      } else {
        res.redirect(302, "/dashboard");
      }
    } catch (error) {
      log.error("Microsoft callback failed:", error);
      res.redirect(302, "/sign-in?error=microsoft_auth_failed");
    }
  });
}
