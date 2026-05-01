import { z } from "zod";
import { eq, and, gt, desc } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { SIGNIN_LIMIT, VERIFY_2FA_LIMIT } from "../utils/rateLimiter";
import { getDb } from "../db";
import {
  stores,
  storeUsers,
  storeVerificationCodes,
  storeAllowedDomains,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { sendEmail } from "../email/mailer";
import { SignJWT, jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "../_core/env";
import crypto from "crypto";
import { hashOtp } from "../utils/otpHash";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";

const log = getLogger("storeAuth");

const OTP_RANGE_MIN = 100_000;
const OTP_RANGE_MAX = 999_999;
const OTP_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Self-signup gate (added with migration 0100). Evaluates whether the
 * caller's email may proceed with OTP issuance for the given store.
 *
 * Decision matrix (rows = existing-user / new-email scenarios,
 * cols = mode):
 *
 *   | Scenario                              | closed | invite_only | domain_whitelist | open_signup |
 *   | Existing active user                  | ✗     | ✓           | ✓                | ✓           |
 *   | Existing soft-deleted user            | ✗     | ✗           | ✗                | ✗           |
 *   | New email, on allowedEmails list      | ✗     | ✓           | ✗                | ✓           |
 *   | New email, on allowed domain          | ✗     | ✗           | ✓                | ✓           |
 *   | New email, on neither                 | ✗     | ✗           | ✗                | ✓           |
 *
 * `closed` blocks ALL new authentication attempts regardless of existing
 * row state. Active JWT sessions remain valid (this gate runs only on
 * requestLogin → OTP issuance, not on protected-procedure use).
 *
 * Called from requestLogin in this same file — if you refactor
 * requestLogin to skip this gate, OTP issuance becomes unauthenticated.
 *
 * Exported for the verify-0100-selfsignup-modes regression script.
 */
export type SelfSignupMode = "closed" | "invite_only" | "domain_whitelist" | "open_signup";
export interface SelfSignupGateInputs {
  emailLc: string;
  mode: SelfSignupMode;
  allowedEmailsJson: string[] | null;
  allowedDomains: { domain: string }[];
  existingUser: { deletedAt: Date | null } | null;
}
export interface SelfSignupGateResult {
  allowed: boolean;
  reason?: string;
}
export function evaluateSelfSignupAllowed(input: SelfSignupGateInputs): SelfSignupGateResult {
  // Soft-deleted users are rejected in every mode. The downstream
  // create-or-fetch path then never sees them.
  if (input.existingUser?.deletedAt) {
    return { allowed: false, reason: "This account has been deactivated. Contact your administrator." };
  }

  switch (input.mode) {
    case "closed":
      return { allowed: false, reason: "Self-signup is disabled for this store. Contact your administrator." };

    case "invite_only": {
      if (input.existingUser) return { allowed: true };
      const list = input.allowedEmailsJson ?? [];
      const match = list.some(e => e.toLowerCase() === input.emailLc);
      return match
        ? { allowed: true }
        : { allowed: false, reason: "This email is not on the invite list. Contact your administrator." };
    }

    case "domain_whitelist": {
      if (input.existingUser) return { allowed: true };
      const emailDomain = input.emailLc.split("@")[1];
      const match = input.allowedDomains.some(d => d.domain.toLowerCase() === emailDomain);
      return match
        ? { allowed: true }
        : { allowed: false, reason: "Your email domain is not authorized. Contact your administrator." };
    }

    case "open_signup":
      return { allowed: true };
  }
}

//  JWT helpers for store sessions 
const STORE_COOKIE_PREFIX = "mt_store_";
const STORE_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function getStoreSecret() {
  return new TextEncoder().encode(ENV.cookieSecret + "_store");
}

async function createStoreSessionToken(storeId: number, storeUserId: number, email: string, role: string) {
  return new SignJWT({ storeId, storeUserId, email, role })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(getStoreSecret());
}

async function verifyStoreSessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getStoreSecret());
    return payload as { storeId: number; storeUserId: number; email: string; role: string };
  } catch {
    return null;
  }
}

function generateCode(): string {
  return crypto.randomInt(OTP_RANGE_MIN, OTP_RANGE_MAX).toString();
}

function buildStoreLoginEmail(
  storeName: string,
  code: string,
  recipientName?: string,
  branding?: { logoUrl?: string | null; primaryColor?: string | null },
): { subject: string; html: string } {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const codeColor = branding?.primaryColor ?? "#1a1a1a";
  const logoHtml = branding?.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${storeName}" style="max-height: 48px; display: block; margin: 0 auto 12px auto;" />`
    : "";
  return {
    subject: `Your ${storeName} login code: ${code}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 32px;">
          ${logoHtml}
          <h2 style="color: #1a1a1a; margin: 0;">${storeName}</h2>
          <p style="color: #666; margin: 4px 0 0 0; font-size: 14px;">Company Store</p>
        </div>
        <p style="color: #333; font-size: 16px; line-height: 1.5;">${greeting}</p>
        <p style="color: #333; font-size: 16px; line-height: 1.5;">Your verification code is:</p>
        <div style="text-align: center; margin: 24px 0;">
          <span style="display: inline-block; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: ${codeColor}; background: #f5f5f5; padding: 16px 32px; border-radius: 8px;">${code}</span>
        </div>
        <p style="color: #666; font-size: 14px; line-height: 1.5;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Secure login powered by ${storeName}</p>
      </div>
    `,
  };
}

export const storeAuthRouter = router({
  /**
   * Request login — send a verification code to the user's email.
   * Checks if the email is allowed (domain or explicit whitelist).
   */
  requestLogin: publicProcedure
    .use(rateLimited("storeRequestLogin", SIGNIN_LIMIT))
    .input(z.object({
      storeSlug: z.string(),
      email: z.string().email(),
      name: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Find the store
      const storeRows = await db!
        .select()
        .from(stores)
        .where(eq(stores.slug, input.storeSlug))
        .limit(1);

      if (storeRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }

      const store = storeRows[0];

      // Self-signup gate (migration 0100). Fetch existing user + allowed
      // domains in parallel; the predicate evaluates against all four
      // mode branches uniformly.
      const emailLc = input.email.toLowerCase();
      const [existingUserRows, allowedDomains] = await Promise.all([
        db!.select().from(storeUsers).where(and(
          eq(storeUsers.storeId, store.id),
          eq(storeUsers.email, emailLc),
        )).limit(1),
        db!.select().from(storeAllowedDomains).where(eq(storeAllowedDomains.storeId, store.id)),
      ]);
      const existingUser = existingUserRows[0] ?? null;

      const gate = evaluateSelfSignupAllowed({
        emailLc,
        mode: store.selfSignupMode as SelfSignupMode,
        allowedEmailsJson: (store.allowedEmailsJson ?? null) as string[] | null,
        allowedDomains: allowedDomains.map(d => ({ domain: d.domain })),
        existingUser: existingUser ? { deletedAt: existingUser.deletedAt } : null,
      });

      if (!gate.allowed) {
        // FORBIDDEN with a stable user-visible reason. The reason strings
        // are intentionally distinct per mode so admins debugging a
        // distributor's "why can't I log in" report can grep them.
        throw new TRPCError({ code: "FORBIDDEN", message: gate.reason ?? "Not authorized." });
      }

      let storeUserRows = existingUserRows;
      if (storeUserRows.length === 0) {
        // Auto-create user with default role. `name` only used at
        // creation — never overwrites an existing row (Phase J auth fix
        // design decision).
        await db.insert(storeUsers).values({
          storeId: store.id,
          email: emailLc,
          name: input.name || null,
          role: "employee",
          status: "active",
        });
        storeUserRows = await db!
          .select()
          .from(storeUsers)
          .where(and(
            eq(storeUsers.storeId, store.id),
            eq(storeUsers.email, emailLc),
          ))
          .limit(1);
      }

      // Generate verification code and store SHA-256 hash (PCI DSS Req 8.3.2)
      const code = generateCode();
      const codeHash = hashOtp(code);
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS); // 10 minutes

      await db.insert(storeVerificationCodes).values({
        storeId: store.id,
        email: input.email.toLowerCase(),
        code: codeHash,
        expiresAt,
      });

      // Send email
      const { subject, html } = buildStoreLoginEmail(store.name, code, input.name, {
        logoUrl: store.logoUrl,
        primaryColor: store.primaryColor,
      });
      const emailResult = await sendEmail(input.email, subject, html);

      // PCI hardening: if email delivery fails, the user cannot verify — fail the request
      if (!emailResult.sent) {
        log.error(`Store login email delivery failed for ${input.email}: ${emailResult.error}`);
        return {
          success: false,
          emailDelivered: false,
          message: "Unable to send verification code. Please try again later or contact support.",
        };
      }

      return {
        success: true,
        emailDelivered: true,
        message: "Verification code sent to your email.",
      };
    }),

  /**
   * Verify code — validate the OTP and create a store session.
   */
  verifyCode: publicProcedure
    .use(rateLimited("storeVerifyCode", VERIFY_2FA_LIMIT))
    .input(z.object({
      storeSlug: z.string(),
      email: z.string().email(),
      code: z.string().length(6),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Find the store
      const storeRows = await db!
        .select()
        .from(stores)
        .where(eq(stores.slug, input.storeSlug))
        .limit(1);

      if (storeRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }

      const store = storeRows[0];

      // Find valid code — compare SHA-256 hash (PCI DSS Req 8.3.2)
      const submittedHash = hashOtp(input.code);
      const codeRows = await db!
        .select()
        .from(storeVerificationCodes)
        .where(and(
          eq(storeVerificationCodes.storeId, store.id),
          eq(storeVerificationCodes.email, input.email.toLowerCase()),
          eq(storeVerificationCodes.code, submittedHash),
          eq(storeVerificationCodes.used, false),
          gt(storeVerificationCodes.expiresAt, new Date()),
        ))
        .limit(1);

      if (codeRows.length === 0) {
        return { success: false, error: "Invalid or expired code. Please request a new one." };
      }

      // Mark code as used
      await db!
        .update(storeVerificationCodes)
        .set({ used: true })
        .where(eq(storeVerificationCodes.id, codeRows[0].id));

      // Get store user
      const storeUserRows = await db!
        .select()
        .from(storeUsers)
        .where(and(
          eq(storeUsers.storeId, store.id),
          eq(storeUsers.email, input.email.toLowerCase()),
        ))
        .limit(1);

      if (storeUserRows.length === 0) {
        return { success: false, error: "User not found." };
      }

      const storeUser = storeUserRows[0];

      if (storeUser.deletedAt) {
        return {
          success: false,
          error: "This account has been deactivated. Contact your administrator.",
        };
      }

      // Update last login
      await db!
        .update(storeUsers)
        .set({ lastLoginAt: new Date(), status: "active" })
        .where(eq(storeUsers.id, storeUser.id));

      // Create JWT session token
      const token = await createStoreSessionToken(
        store.id,
        storeUser.id,
        storeUser.email,
        storeUser.role,
      );

      // Set cookie
      const cookieName = STORE_COOKIE_PREFIX + store.slug;
      ctx.res.cookie(cookieName, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: STORE_SESSION_DURATION,
        path: "/",
      });

      return {
        success: true,
        user: {
          id: storeUser.id,
          email: storeUser.email,
          name: storeUser.name,
          role: storeUser.role,
          department: storeUser.department,
          departmentId: storeUser.departmentId ?? null,
          locationId: storeUser.locationId ?? null,
          spendingLimit: storeUser.spendingLimit,
          pointsBalance: storeUser.pointsBalance,
        },
      };
    }),

  /**
   * Get current store session — check if the user is logged in.
   */
  getSession: publicProcedure
    .input(z.object({ storeSlug: z.string() }))
    .query(async ({ input, ctx }) => {
      const cookieName = STORE_COOKIE_PREFIX + input.storeSlug;
      const cookieHeader = ctx.req.headers?.cookie || "";
      const cookies = parseCookieHeader(cookieHeader);
      const token = cookies[cookieName];

      if (!token) {
        return { authenticated: false, user: null };
      }

      const payload = await verifyStoreSessionToken(token);
      if (!payload) {
        return { authenticated: false, user: null };
      }

      // Fetch fresh user data
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const storeUserRows = await db!
        .select()
        .from(storeUsers)
        .where(and(eq(storeUsers.id, payload.storeUserId), eq(storeUsers.storeId, payload.storeId)))
        .limit(1);

      if (storeUserRows.length === 0) {
        return { authenticated: false, user: null };
      }

      const storeUser = storeUserRows[0];
      return {
        authenticated: true,
        user: {
          id: storeUser.id,
          email: storeUser.email,
          name: storeUser.name,
          role: storeUser.role,
          department: storeUser.department,
          departmentId: storeUser.departmentId ?? null,
          locationId: storeUser.locationId ?? null,
          spendingLimit: storeUser.spendingLimit,
          pointsBalance: storeUser.pointsBalance,
        },
      };
    }),

  /**
   * Logout — clear the store session cookie.
   */
  logout: publicProcedure
    .input(z.object({ storeSlug: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cookieName = STORE_COOKIE_PREFIX + input.storeSlug;
      ctx.res.clearCookie(cookieName, { path: "/" });
      return { success: true };
    }),

  // pocLogin DELETED — was a full auth bypass (PCI DSS Req 8.2 violation).
  // It allowed anyone to create an authenticated store session with any email/role
  // and zero verification. Removed April 7, 2026.

  //  Distributor-side management 

  /**
   * List store users — for the distributor to manage access.
   */
  listUsers: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Verify ownership
      const storeRows = await db.select().from(stores).where(and(eq(stores.id, input.storeId), getOrgScope(ctx).stores)).limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to manage this store" });
      return db!
        .select()
        .from(storeUsers)
        .where(eq(storeUsers.storeId, input.storeId))
        .orderBy(desc(storeUsers.createdAt));
    }),

  /**
   * Add a store user — distributor adds an allowed user.
   */
  addUser: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      email: z.string().email(),
      name: z.string().optional(),
      role: z.enum(["admin", "manager", "employee", "intern"]).default("employee"),
      department: z.string().optional(),
      spendingLimit: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const storeRows = await db.select().from(stores).where(and(eq(stores.id, input.storeId), getOrgScope(ctx).stores)).limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to manage this store" });

      // Check if user already exists
      const existing = await db!
        .select()
        .from(storeUsers)
        .where(and(
          eq(storeUsers.storeId, input.storeId),
          eq(storeUsers.email, input.email.toLowerCase()),
        ))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "User already exists for this store." });
      }

      const [result] = await db.insert(storeUsers).values({
        storeId: input.storeId,
        email: input.email.toLowerCase(),
        name: input.name || null,
        role: input.role,
        department: input.department || null,
        spendingLimit: input.spendingLimit || null,
        status: "invited",
      });

      return { id: result.insertId };
    }),

  /**
   * Update a store user's role or spending limit.
   */
  updateUser: protectedProcedure
    .input(z.object({
      id: z.number(),
      role: z.enum(["admin", "manager", "employee", "intern"]).optional(),
      department: z.string().optional(),
      spendingLimit: z.string().optional(),
      status: z.enum(["active", "invited", "suspended"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Verify ownership via the store user's storeId
      const suRows = await db.select().from(storeUsers).where(eq(storeUsers.id, input.id)).limit(1);
      if (suRows.length > 0) {
        const ownerCheck = await db.select().from(stores).where(and(eq(stores.id, suRows[0].storeId), getOrgScope(ctx).stores)).limit(1);
        if (ownerCheck.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      const { id, ...updates } = input;
      const setObj: Record<string, any> = {};
      if (updates.role !== undefined) setObj.role = updates.role;
      if (updates.department !== undefined) setObj.department = updates.department;
      if (updates.spendingLimit !== undefined) setObj.spendingLimit = updates.spendingLimit;
      if (updates.status !== undefined) setObj.status = updates.status;

      await db.update(storeUsers).set(setObj).where(eq(storeUsers.id, id));
      return { success: true };
    }),

  /**
   * Remove a store user.
   */
  removeUser: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Verify ownership
      const suRows = await db.select().from(storeUsers).where(eq(storeUsers.id, input.id)).limit(1);
      if (suRows.length > 0) {
        const ownerCheck = await db.select().from(stores).where(and(eq(stores.id, suRows[0].storeId), getOrgScope(ctx).stores)).limit(1);
        if (ownerCheck.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      await db.delete(storeUsers).where(eq(storeUsers.id, input.id));
      return { success: true };
    }),

  /**
   * Manage allowed domains for a store.
   */
  listDomains: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const storeRows = await db.select().from(stores).where(and(eq(stores.id, input.storeId), getOrgScope(ctx).stores)).limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      return db!
        .select()
        .from(storeAllowedDomains)
        .where(eq(storeAllowedDomains.storeId, input.storeId));
    }),

  addDomain: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      domain: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const storeRows = await db.select().from(stores).where(and(eq(stores.id, input.storeId), getOrgScope(ctx).stores)).limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      const [result] = await db.insert(storeAllowedDomains).values({
        storeId: input.storeId,
        domain: input.domain.toLowerCase(),
      });
      return { id: result.insertId };
    }),

  removeDomain: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Verify ownership via the domain's storeId
      const domainRows = await db.select().from(storeAllowedDomains).where(eq(storeAllowedDomains.id, input.id)).limit(1);
      if (domainRows.length > 0) {
        const ownerCheck = await db.select().from(stores).where(and(eq(stores.id, domainRows[0].storeId), getOrgScope(ctx).stores)).limit(1);
        if (ownerCheck.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      await db.delete(storeAllowedDomains).where(eq(storeAllowedDomains.id, input.id));
      return { success: true };
    }),
});
