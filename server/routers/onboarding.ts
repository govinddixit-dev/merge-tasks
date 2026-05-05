import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { SIGNIN_LIMIT, SIGNUP_LIMIT, VERIFY_2FA_LIMIT, RESEND_CODE_LIMIT } from "../utils/rateLimiter";
import { getDb } from "../db";
import { users, verificationCodes, distributorProfiles } from "../../drizzle/schema";
import { eq, and, gt } from "drizzle-orm";
import { safeLLM } from "../_core/safeLLM";
import { send2FAEmail } from "../email/mailer";
import { sendWelcomeEmail } from "../email/sendWelcomeEmail";
import { sendOnboardingCompleteEmail } from "../email/sendOnboardingCompleteEmail";
import { buildVerificationCodeEmail } from "../email/emailTemplates";
import { sendItOnboardingEmail } from "../email/sendItOnboardingEmail";
import { organizations } from "../../drizzle/schema";
import crypto from "crypto";
import { getLogger } from "../utils/logger";
import { auditLog } from "../utils/auditLog";
import { validatePasswordComplexity, PASSWORD_MIN_LENGTH } from "../utils/passwordPolicy";
import { isAccountLocked, getLockoutExpiry, getLockoutMessage, MAX_FAILED_ATTEMPTS } from "../utils/accountLockout";
import { hashOtp } from "../utils/otpHash";
import { ENV } from "../_core/env";

const log = getLogger("onboarding");

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_RANGE_MIN = 100_000;
const OTP_RANGE_MAX = 999_999;

//  Password hashing with scrypt (no external deps) 
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(key, "hex"), derivedKey));
    });
  });
}

/**
 * Generate a cryptographically secure 6-digit verification code.
 * Uses crypto.randomInt() instead of Math.random() to prevent predictable codes.
 */
function generateCode(): string {
  return crypto.randomInt(OTP_RANGE_MIN, OTP_RANGE_MAX).toString();
}

export const onboardingRouter = router({
  /**
   * Sign up — create account with hashed password and send branded welcome email with 2FA code
   */
  signUp: publicProcedure
    .use(rateLimited("signUp", SIGNUP_LIMIT))
    .input(z.object({
      email: z.string().email(),
      fullName: z.string().min(1),
      companyName: z.string().min(1),
      password: z.string().min(PASSWORD_MIN_LENGTH),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Check if email already exists
      const existing = await db!
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existing.length > 0) {
        return { success: false, error: "An account with this email already exists. Please sign in instead.", emailDelivered: false };
      }

      // Validate password complexity (PCI DSS Req 8.3.6)
      const pwCheck = validatePasswordComplexity(input.password);
      if (!pwCheck.valid) {
        return { success: false, error: pwCheck.errors.join(". "), emailDelivered: false };
      }

      // Hash the password
      const passwordHashed = await hashPassword(input.password);

      // Create user with hashed password — catch duplicate key to handle race condition
      let newUser;
      try {
        [newUser] = await db.insert(users).values({
          openId: `local_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`,
          name: input.fullName,
          email: input.email,
          passwordHash: passwordHashed,
          loginMethod: "email",
          role: "user",
        });
      } catch (err: unknown) {
        if (err instanceof Object && "code" in err && err.code === "ER_DUP_ENTRY") {
          return { success: false, error: "An account with this email already exists. Please sign in instead.", emailDelivered: false };
        }
        throw err;
      }

      const userId = newUser.insertId;

      // Create distributor profile placeholder
      await db.insert(distributorProfiles).values({
        userId: Number(userId),
        companyName: input.companyName,
        onboardingCompleted: false,
      });

      // Generate verification code and store SHA-256 hash (PCI DSS Req 8.3.2)
      const code = generateCode();
      const codeHash = hashOtp(code);
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS); // 10 minutes

      await db.insert(verificationCodes).values({
        userId: Number(userId),
        email: input.email,
        code: codeHash,
        type: "signup_verify",
        expiresAt,
      });

      // Send branded welcome email via dedicated mailer
      const emailResult = await send2FAEmail(input.email, code, "welcome", input.fullName);

      // PCI hardening: if email delivery fails, the user cannot verify — fail the signup
      if (!emailResult.emailDelivered) {
        log.error(`Signup email delivery failed for ${input.email}: ${emailResult.error}`);
        return {
          success: false,
          error: "Unable to send verification email. Please try again later or contact support.",
          emailDelivered: false,
        };
      }

      return {
        success: true,
        userId: Number(userId),
        email: input.email,
        emailDelivered: true,
        message: "Account created! Check your email for the verification code.",
      };
    }),

  /**
   * Sign in — validate credentials (email + password) and send 2FA code
   */
  signIn: publicProcedure
    .use(rateLimited("signIn", SIGNIN_LIMIT))
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Find user by email
      const userRows = await db!
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (userRows.length === 0) {
        auditLog({
          action: "auth.login.failed",
          userId: null,
          description: `Failed login attempt for unknown email ${input.email}`,
          metadata: { reason: "unknown_email" },
        });
        return { success: false, error: "No account found with this email. Please sign up first.", emailDelivered: false };
      }

      const user = userRows[0];

      // PCI DSS Req 8.1.6 — check account lockout
      if (isAccountLocked(user.lockedUntil)) {
        auditLog({
          action: "auth.login.failed",
          userId: user.id,
          actorEmail: input.email,
          description: `Login attempt on locked account ${input.email}`,
          metadata: { reason: "account_locked", lockedUntil: user.lockedUntil?.toISOString() },
        });
        return { success: false, error: getLockoutMessage(), emailDelivered: false };
      }

      // Verify password
      if (!user.passwordHash) {
        return { success: false, error: "This account uses social login. Please sign in with Google or Microsoft.", emailDelivered: false };
      }

      const passwordValid = await verifyPassword(input.password, user.passwordHash);
      if (!passwordValid) {
        // Increment failed attempts
        const newAttempts = (user.failedLoginAttempts || 0) + 1;
        const lockUpdate: Record<string, unknown> = { failedLoginAttempts: newAttempts };
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          lockUpdate.lockedUntil = getLockoutExpiry();
        }
        await db.update(users).set(lockUpdate).where(eq(users.id, user.id));

        auditLog({
          action: "auth.login.failed",
          userId: user.id,
          actorEmail: input.email,
          description: `Failed login attempt for ${input.email} — incorrect password (attempt ${newAttempts}/${MAX_FAILED_ATTEMPTS})`,
          metadata: { reason: "bad_password", attempt: newAttempts, locked: newAttempts >= MAX_FAILED_ATTEMPTS },
        });
        return { success: false, error: "Incorrect password. Please try again.", emailDelivered: false };
      }

      // Reset failed attempts on successful password verification
      if (user.failedLoginAttempts > 0) {
        await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
      }

      // DEMO/DEV ONLY — skip 2FA and issue session directly when DEMO_SKIP_2FA=true
      if (ENV.demoSkip2FA) {
        const { sdk } = await import("../_core/sdk");
        await sdk.issueTokenPair(ctx.req, ctx.res, user.openId, user.name || user.email || "MergeTasks User");
        await db!.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
        const profileRows = await db!.select().from(distributorProfiles).where(eq(distributorProfiles.userId, user.id)).limit(1);
        const needsOnboarding = profileRows.length === 0 || !profileRows[0].onboardingCompleted;
        log.warn(`[DEMO] 2FA bypassed for ${input.email} — DEMO_SKIP_2FA is enabled`);
        return { success: true, userId: user.id, email: input.email, emailDelivered: true, demoBypass: true, needsOnboarding, message: "Demo mode: 2FA bypassed." };
      }

      // Generate 2FA code and store SHA-256 hash (PCI DSS Req 8.3.2)
      const code = generateCode();
      const codeHash = hashOtp(code);
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

      await db.insert(verificationCodes).values({
        userId: user.id,
        email: input.email,
        code: codeHash,
        type: "login_2fa",
        expiresAt,
      });

      // Send branded 2FA email via dedicated mailer
      const emailResult = await send2FAEmail(input.email, code, "login", user.name || "");

      // PCI hardening: if email delivery fails, the user cannot complete 2FA — fail the login
      if (!emailResult.emailDelivered) {
        log.error(`2FA email delivery failed for ${input.email}: ${emailResult.error}`);
        return {
          success: false,
          error: "Unable to send verification code. Please try again later or contact support.",
          emailDelivered: false,
        };
      }

      return {
        success: true,
        userId: user.id,
        email: input.email,
        emailDelivered: true,
        message: "Verification code sent to your email.",
      };
    }),

  /**
   * Verify 2FA code — establishes a real session cookie so protectedProcedure works
   */
  verify2FA: publicProcedure
    .use(rateLimited("verify2FA", VERIFY_2FA_LIMIT))
    .input(z.object({
      userId: z.number(),
      code: z.string().length(6),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Find valid, unused code — compare SHA-256 hash (PCI DSS Req 8.3.2)
      const submittedHash = hashOtp(input.code);
      const codeRows = await db!
        .select()
        .from(verificationCodes)
        .where(and(
          eq(verificationCodes.userId, input.userId),
          eq(verificationCodes.code, submittedHash),
          eq(verificationCodes.used, false),
          gt(verificationCodes.expiresAt, new Date()),
        ))
        .orderBy(verificationCodes.createdAt)
        .limit(1);

      if (codeRows.length === 0) {
        return { success: false, error: "Invalid or expired verification code. Please request a new one." };
      }

      const codeRow = codeRows[0];
      const isSignupVerification = codeRow.type === "signup_verify";

      // Mark code as used
      await db!
        .update(verificationCodes)
        .set({ used: true })
        .where(eq(verificationCodes.id, codeRow.id));

      // Get the user record
      const userRows = await db!
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      if (userRows.length === 0) {
        return { success: false, error: "User not found." };
      }

      const user = userRows[0];

      // Update last sign in
      await db!
        .update(users)
        .set({ lastSignedIn: new Date() })
        .where(eq(users.id, input.userId));

      // Welcome email on first-ever signup verification — fire-and-forget so a
      // delivery failure never blocks the user from landing on the app.
      if (isSignupVerification && user.email) {
        const firstName = (user.name || user.email).split(" ")[0] || "there";
        const [profile] = await db!
          .select({ companyName: distributorProfiles.companyName })
          .from(distributorProfiles)
          .where(eq(distributorProfiles.userId, user.id))
          .limit(1);
        const loginUrl = process.env.APP_BASE_URL ?? "https://app.mergetasks.com";
        sendWelcomeEmail({
          distributorEmail: user.email,
          firstName,
          companyName: profile?.companyName ?? undefined,
          loginUrl,
        }).catch((err: unknown) => {
          log.warn("Signup welcome email failed (non-blocking):", err);
        });
      }

      //  Issue short-lived access + refresh token pair 
      const { sdk } = await import("../_core/sdk");
      await sdk.issueTokenPair(ctx.req, ctx.res, user.openId, user.name || user.email || "MergeTasks User");

      auditLog({
        action: "auth.login.success",
        userId: user.id,
        actorEmail: user.email ?? undefined,
        ip: ctx.req?.ip || ctx.req?.socket?.remoteAddress,
        description: `User ${user.email} logged in via 2FA verification`,
      });

      // Check if onboarding is completed
      const profileRows = await db!
        .select()
        .from(distributorProfiles)
        .where(eq(distributorProfiles.userId, input.userId))
        .limit(1);

      const needsOnboarding = profileRows.length === 0 || !profileRows[0].onboardingCompleted;

      return {
        success: true,
        verified: true,
        needsOnboarding,
        message: "Email verified successfully!",
      };
    }),

  /**
   * Resend 2FA code
   */
  resendCode: publicProcedure
    .use(rateLimited("resendCode", RESEND_CODE_LIMIT))
    .input(z.object({
      userId: z.number(),
      email: z.string().email(),
      type: z.enum(["login_2fa", "signup_verify"]).default("login_2fa"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify userId matches the supplied email — prevents sending codes to arbitrary addresses
      const userRows = await db!
        .select()
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.email, input.email)))
        .limit(1);

      if (userRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid request" });
      }

      const userName = userRows[0]?.name || "";

      const code = generateCode();
      const codeHash = hashOtp(code);
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

      await db.insert(verificationCodes).values({
        userId: input.userId,
        email: input.email,
        code: codeHash,
        type: input.type,
        expiresAt,
      });

      const isWelcome = input.type === "signup_verify";
      const emailResult = await send2FAEmail(input.email, code, isWelcome ? "welcome" : "login", userName);

      // PCI hardening: if email delivery fails, the user cannot verify — fail the resend
      if (!emailResult.emailDelivered) {
        log.error(`Resend code email delivery failed for ${input.email}: ${emailResult.error}`);
        return {
          success: false,
          emailDelivered: false,
          message: "Unable to send verification code. Please try again later or contact support.",
        };
      }

      return {
        success: true,
        emailDelivered: true,
        message: "New verification code sent!",
      };
    }),

  /**
   * Save onboarding questionnaire answers
   */
  saveOnboarding: protectedProcedure
    .input(z.object({
      companyName: z.string().optional(),
      companySize: z.string().optional(),
      annualRevenue: z.string().optional(),
      yearsInBusiness: z.string().optional(),
      specialties: z.array(z.string()).optional(),
      topCategories: z.array(z.string()).optional(),
      targetIndustries: z.array(z.string()).optional(),
      primaryGoal: z.string().optional(),
      currentTools: z.string().optional(),
      teamSize: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // userId always comes from the authenticated session — never from client input
      const userId = ctx.user.id;
      const profileData = input;

      // Check if profile exists
      const existing = await db!
        .select()
        .from(distributorProfiles)
        .where(eq(distributorProfiles.userId, userId))
        .limit(1);

      const wasAlreadyCompleted = existing[0]?.onboardingCompleted === true;

      if (existing.length > 0) {
        await db!
          .update(distributorProfiles)
          .set({ ...profileData, onboardingCompleted: true })
          .where(eq(distributorProfiles.userId, userId));
      } else {
        await db.insert(distributorProfiles).values({
          userId,
          organizationId: ctx.organizationId ?? null,
          ...profileData,
          onboardingCompleted: true,
        });
      }

      // Fire-and-forget emails on first-ever onboarding completion only
      if (!wasAlreadyCompleted) {
        // IT onboarding email (for enterprise/org setups)
        try {
          let orgName = input.companyName || "your organization";
          if (ctx.organizationId) {
            const [org] = await db!
              .select({ name: organizations.name })
              .from(organizations)
              .where(eq(organizations.id, ctx.organizationId))
              .limit(1);
            if (org?.name) orgName = org.name;
          }
          const baseUrl = process.env.APP_BASE_URL || "https://app.mergetasks.com";
          const adminEmail = ctx.user.email;
          if (adminEmail) {
            void sendItOnboardingEmail({
              adminEmail,
              adminName: ctx.user.name || adminEmail,
              organizationName: orgName,
              dashboardUrl: `${baseUrl}/dashboard`,
              packetUrl: `${baseUrl}/docs/it-onboarding-packet`,
            }).catch((err) => log.error("IT onboarding email failed", err));
          }
        } catch (err) {
          log.error("Failed to trigger IT onboarding email", err);
        }
        // Onboarding-complete email — recaps their answers + recommends next
        // actions. Distinct from the signup welcome email which fires earlier
        // from verify2FA on the first successful signup_verify.
        if (ctx.user?.email) {
          const firstName = (ctx.user.name || ctx.user.email).split(" ")[0] || "there";
          const baseUrl = process.env.APP_BASE_URL ?? "https://app.mergetasks.com";
          sendOnboardingCompleteEmail({
            distributorEmail: ctx.user.email,
            firstName,
            companyName: (input.companyName ?? existing[0]?.companyName) || undefined,
            dashboardUrl: `${baseUrl}/dashboard`,
            summary: {
              companySize: input.companySize,
              primaryGoal: input.primaryGoal,
              specialties: input.specialties,
              topCategories: input.topCategories,
              targetIndustries: input.targetIndustries,
            },
          }).catch((err: unknown) => {
            log.warn("Onboarding-complete email failed (non-blocking):", err);
          });
        }
      }

      return { success: true };
    }),

  /**
   * AI-powered personalization based on onboarding answers
   */
  getAIPersonalization: protectedProcedure
    .input(z.object({
      companyName: z.string(),
      companySize: z.string(),
      annualRevenue: z.string(),
      specialties: z.array(z.string()),
      topCategories: z.array(z.string()),
      targetIndustries: z.array(z.string()),
      primaryGoal: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const response = await safeLLM({
          messages: [
            {
              role: "system",
              content: `You are MergeTasks AI, an onboarding assistant for a B2B promotional products platform. Based on the distributor's profile, generate personalized recommendations. Return JSON with:
- welcomeMessage: A warm, personalized 2-3 sentence welcome message mentioning their company name and how MergeTasks will help their specific needs
- recommendedFeatures: Array of 3-4 feature recommendations with { name, description, priority } based on their profile
- suggestedFirstSteps: Array of 3 actionable first steps they should take
- dashboardLayout: "standard" | "sales_focused" | "operations_focused" | "enterprise" based on their size and goals`
            },
            {
              role: "user",
              content: `Distributor Profile:
- Company: ${input.companyName}
- Size: ${input.companySize}
- Annual Revenue: ${input.annualRevenue}
- Specialties: ${input.specialties.join(", ")}
- Top Categories: ${input.topCategories.join(", ")}
- Target Industries: ${input.targetIndustries.join(", ")}
- Primary Goal: ${input.primaryGoal}`
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "personalization",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  welcomeMessage: { type: "string" },
                  recommendedFeatures: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        priority: { type: "string" },
                      },
                      required: ["name", "description", "priority"],
                      additionalProperties: false,
                    },
                  },
                  suggestedFirstSteps: {
                    type: "array",
                    items: { type: "string" },
                  },
                  dashboardLayout: { type: "string" },
                },
                required: ["welcomeMessage", "recommendedFeatures", "suggestedFirstSteps", "dashboardLayout"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        const parsed = typeof content === "string" ? JSON.parse(content) : null;

        // Save to profile
        if (parsed) {
          const db = await getDb();
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
          await db!
            .update(distributorProfiles)
            .set({
              aiRecommendations: parsed.recommendedFeatures,
              aiWelcomeMessage: parsed.welcomeMessage,
              onboardingCompleted: true,
            })
            .where(eq(distributorProfiles.userId, ctx.user.id));
        }

        return { success: true, personalization: parsed };
      } catch (err) {
        log.error("AI personalization failed:", err);
        return {
          success: true,
          personalization: {
            welcomeMessage: `Welcome to MergeTasks, ${input.companyName}! We're excited to help you streamline your promotional products business. Let's get started with setting up your first proposal.`,
            recommendedFeatures: [
              { name: "Virtual Proofing Studio", description: "Create stunning product mockups with AI-powered decoration rendering", priority: "high" },
              { name: "Proposal Builder", description: "Build professional proposals with multi-department support", priority: "high" },
              { name: "Webstore Management", description: "Launch branded company stores for your clients", priority: "medium" },
            ],
            suggestedFirstSteps: [
              "Import your product catalog",
              "Create your first client profile",
              "Build a sample proposal",
            ],
            dashboardLayout: "standard",
          },
        };
      }
    }),

  /**
   * Get the branded email HTML for preview (used in Settings)
   */
  previewEmail: publicProcedure
    .input(z.object({
      type: z.enum(["welcome", "login"]),
    }))
    .query(({ input }) => {
      const { html } = buildVerificationCodeEmail({ type: input.type, code: "847291", recipientName: "John" });
      return { html };
    }),

  /**
   * Re-send the IT onboarding packet email to the current admin. Used when
   * the org adds a new division and wants IT to receive an updated packet
   * with the new division's ACS URLs.
   */
  resendItPacket: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.user.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No email on file for current user" });
      }
      const db = await getDb();
      let organizationName = "Your Organization";
      if (db && ctx.organizationId) {
        const [org] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, ctx.organizationId))
          .limit(1);
        if (org?.name) organizationName = org.name;
      }
      const baseUrl = process.env.APP_BASE_URL || "https://app.mergetasks.com";
      const result = await sendItOnboardingEmail({
        adminEmail: ctx.user.email,
        adminName: ctx.user.name || ctx.user.email,
        organizationName,
        dashboardUrl: `${baseUrl}/dashboard`,
        packetUrl: `${baseUrl}/docs/it-onboarding-packet`,
      });
      if (!result.sent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Failed to send IT packet",
        });
      }
      return { success: true };
    }),
});
