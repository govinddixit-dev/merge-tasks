/**
 * storeUserProvisioningAuth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Public authentication procedures for store users:
 *   - validateToken   — verify a set-password / reset token
 *   - setPassword     — set password from token + auto-login
 *   - passwordLogin   — email/password login (No-SSO stores)
 *   - forgotPassword  — trigger a password-reset email
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eq, and, gt } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { stores, storeUsers, storePasswordTokens } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { jwtVerify } from "jose";
import { validatePasswordComplexity, PASSWORD_MIN_LENGTH } from "../../utils/passwordPolicy";
import { rateLimited } from "../../utils/rateLimitMiddleware";
import { PASSWORD_RESET_LIMIT, SIGNIN_LIMIT } from "../../utils/rateLimiter";
import { isAccountLocked, getLockoutExpiry, getLockoutMessage, MAX_FAILED_ATTEMPTS } from "../../utils/accountLockout";
import {
  BCRYPT_ROUNDS,
  STORE_COOKIE_PREFIX,
  STORE_SESSION_DURATION,
  createStoreSessionToken,
  loadDistributorBranding,
  provisionStoreUser,
} from "./storeUserProvisioningHelpers";

export const storeUserProvisioningAuthRouter = router({
  /**
   * Validate a set-password token — check if it's valid and return user info.
   * Public endpoint (no auth needed — the user is clicking an email link).
   */
  validateToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [tokenRow] = await db
        .select()
        .from(storePasswordTokens)
        .where(
          and(
            eq(storePasswordTokens.token, input.token),
            eq(storePasswordTokens.used, false),
            gt(storePasswordTokens.expiresAt, new Date())
          )
        )
        .limit(1);

      if (!tokenRow) {
        return { valid: false, expired: true, user: null, store: null };
      }

      const [user] = await db
        .select()
        .from(storeUsers)
        .where(eq(storeUsers.id, tokenRow.storeUserId))
        .limit(1);

      const [store] = await db
        .select()
        .from(stores)
        .where(eq(stores.id, tokenRow.storeId))
        .limit(1);

      if (!user || !store) {
        return { valid: false, expired: false, user: null, store: null };
      }

      const branding = await loadDistributorBranding(store.userId);

      return {
        valid: true,
        expired: false,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        store: {
          id: store.id,
          name: store.name,
          slug: store.slug,
          logoUrl: store.logoUrl,
          primaryColor: store.primaryColor,
        },
        branding: branding || {
          logoUrl: null,
          primaryColor: "#654BF9",
          companyName: "MergeTasks",
        },
      };
    }),

  /**
   * Set password — user submits their new password after clicking the email link.
   * Also creates a session so they're logged in immediately.
   */
  setPassword: publicProcedure
    .use(rateLimited("storeUser.setPassword", PASSWORD_RESET_LIMIT))
    .input(
      z.object({
        token: z.string(),
        password: z
          .string()
          .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [tokenRow] = await db
        .select()
        .from(storePasswordTokens)
        .where(
          and(
            eq(storePasswordTokens.token, input.token),
            eq(storePasswordTokens.used, false),
            gt(storePasswordTokens.expiresAt, new Date())
          )
        )
        .limit(1);

      if (!tokenRow) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired token. Please request a new invitation.",
        });
      }

      // Validate password complexity (PCI DSS Req 8.3.6)
      const pwCheck = validatePasswordComplexity(input.password);
      if (!pwCheck.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: pwCheck.errors.join(". ") });
      }

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

      await db
        .update(storeUsers)
        .set({ passwordHash, status: "active", lastLoginAt: new Date() })
        .where(eq(storeUsers.id, tokenRow.storeUserId));

      await db
        .update(storePasswordTokens)
        .set({ used: true })
        .where(eq(storePasswordTokens.id, tokenRow.id));

      const [user] = await db
        .select()
        .from(storeUsers)
        .where(eq(storeUsers.id, tokenRow.storeUserId))
        .limit(1);

      const [store] = await db
        .select()
        .from(stores)
        .where(eq(stores.id, tokenRow.storeId))
        .limit(1);

      if (!user || !store) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "User or store not found" });
      }

      const sessionToken = await createStoreSessionToken(store.id, user.id, user.email, user.role);
      const cookieName = STORE_COOKIE_PREFIX + store.slug;
      ctx.res.cookie(cookieName, sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: STORE_SESSION_DURATION,
        path: "/",
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          department: user.department,
        },
        storeSlug: store.slug,
      };
    }),

  /**
   * Login with email/password — for No-SSO stores.
   */
  passwordLogin: publicProcedure
    .use(rateLimited("storeUser.passwordLogin", SIGNIN_LIMIT))
    .input(
      z.object({
        storeSlug: z.string(),
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [store] = await db
        .select()
        .from(stores)
        .where(eq(stores.slug, input.storeSlug))
        .limit(1);

      if (!store) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }

      const [user] = await db
        .select()
        .from(storeUsers)
        .where(
          and(
            eq(storeUsers.storeId, store.id),
            eq(storeUsers.email, input.email.toLowerCase())
          )
        )
        .limit(1);

      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      if (user.deletedAt) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This account has been deactivated. Contact your administrator.",
        });
      }

      if (!user.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please set your password first using the link sent to your email.",
        });
      }

      if (user.status === "suspended") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your account has been suspended. Contact your administrator.",
        });
      }

      // PCI DSS Req 8.1.6 — check account lockout
      if (isAccountLocked(user.lockedUntil)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: getLockoutMessage() });
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        const newAttempts = (user.failedLoginAttempts || 0) + 1;
        const lockUpdate: Record<string, unknown> = { failedLoginAttempts: newAttempts };
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          lockUpdate.lockedUntil = getLockoutExpiry();
        }
        await db.update(storeUsers).set(lockUpdate).where(eq(storeUsers.id, user.id));
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      if (user.failedLoginAttempts > 0) {
        await db
          .update(storeUsers)
          .set({ failedLoginAttempts: 0, lockedUntil: null })
          .where(eq(storeUsers.id, user.id));
      }

      await db
        .update(storeUsers)
        .set({ lastLoginAt: new Date(), status: "active" })
        .where(eq(storeUsers.id, user.id));

      const sessionToken = await createStoreSessionToken(store.id, user.id, user.email, user.role);
      const cookieName = STORE_COOKIE_PREFIX + store.slug;
      ctx.res.cookie(cookieName, sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: STORE_SESSION_DURATION,
        path: "/",
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          department: user.department,
          spendingLimit: user.spendingLimit,
          pointsBalance: user.pointsBalance,
        },
      };
    }),

  /**
   * Forgot password — generate a reset token and send email.
   */
  forgotPassword: publicProcedure
    .use(rateLimited("storeUser.forgotPassword", PASSWORD_RESET_LIMIT))
    .input(
      z.object({
        storeSlug: z.string(),
        email: z.string().email(),
        origin: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [store] = await db
        .select()
        .from(stores)
        .where(eq(stores.slug, input.storeSlug))
        .limit(1);

      if (!store) {
        // Don't reveal store existence
        return { success: true, message: "If that email is registered, a reset link has been sent." };
      }

      const [user] = await db
        .select()
        .from(storeUsers)
        .where(
          and(
            eq(storeUsers.storeId, store.id),
            eq(storeUsers.email, input.email.toLowerCase())
          )
        )
        .limit(1);

      if (!user) {
        // Don't reveal user existence
        return { success: true, message: "If that email is registered, a reset link has been sent." };
      }

      await provisionStoreUser({
        storeId: store.id,
        storeUserId: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role,
        storeName: store.name,
        storeSlug: store.slug,
        distributorUserId: store.userId,
        origin: input.origin,
      });

      return { success: true, message: "If that email is registered, a reset link has been sent." };
    }),
});
