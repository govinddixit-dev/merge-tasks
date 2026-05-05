/**
 * copilotExecBranding.ts — Branding & email executors for the AI copilot.
 *
 * Handles: getBranding, updateBranding, sendCustomEmail
 *
 * SECURITY: All queries MUST scope by organizationId when available,
 * falling back to userId. Never query distributorProfiles by userId alone
 * when the user belongs to an organization — that would bypass org-level
 * access control.
 *
 * Gap Report fix PO-5: Previously queried only by userId, ignoring
 * organizationId entirely. Now scopes correctly.
 *
 * Gap Report fix S9: sendCustomEmail now validates email format before
 * dispatching.
 */
import { getDb } from "../db";
import { distributorProfiles } from "../../drizzle/schema";
import { eq, and, type SQL } from "drizzle-orm";
import { sendEmail } from "../email/mailer";
import { checkRateLimit, COPILOT_EMAIL_LIMIT } from "../utils/rateLimiter";
import { getLogger } from "../utils/logger";

const log = getLogger("copilot:email");

// ── Helpers ──────────────────────────────────────────────

/** Build a WHERE clause that scopes distributorProfiles to the caller's tenant. */
function profileScope(userId: number, organizationId: number | null): SQL {
  if (organizationId != null) {
    return and(
      eq(distributorProfiles.userId, userId),
      eq(distributorProfiles.organizationId, organizationId),
    )!;
  }
  return eq(distributorProfiles.userId, userId);
}

/** Basic RFC-5322-ish email format check (no external deps). */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Get Branding ─────────────────────────────────────────

export async function executeGetBranding(
  userId: number,
  organizationId: number | null,
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const profileRows = await db
    .select()
    .from(distributorProfiles)
    .where(profileScope(userId, organizationId))
    .limit(1);

  if (profileRows.length === 0) {
    return {
      branding: null,
      message: "No branding configured yet. Use update_branding to set it up.",
    };
  }

  const p = profileRows[0];
  return {
    branding: {
      companyName: p.brandCompanyName || p.companyName,
      logoUrl: p.brandLogoUrl,
      primaryColor: p.brandPrimaryColor,
      secondaryColor: p.brandSecondaryColor,
      bannerColor: p.brandBannerColor,
    },
  };
}

// ── Update Branding ──────────────────────────────────────

export async function executeUpdateBranding(
  userId: number,
  organizationId: number | null,
  args: {
    primaryColor?: string;
    secondaryColor?: string;
    bannerColor?: string;
    companyName?: string;
  },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const scope = profileScope(userId, organizationId);
  const existing = await db
    .select()
    .from(distributorProfiles)
    .where(scope)
    .limit(1);

  const updates: Record<string, string> = {};
  if (args.primaryColor) updates.brandPrimaryColor = args.primaryColor;
  if (args.secondaryColor) updates.brandSecondaryColor = args.secondaryColor;
  if (args.bannerColor) updates.brandBannerColor = args.bannerColor;
  if (args.companyName) updates.brandCompanyName = args.companyName;

  if (Object.keys(updates).length === 0) {
    return { error: "No fields to update" };
  }

  if (existing.length === 0) {
    await db.insert(distributorProfiles).values({
      userId,
      organizationId,
      ...updates,
    });
  } else {
    await db
      .update(distributorProfiles)
      .set(updates)
      .where(scope);
  }

  return { success: true, updated: Object.keys(updates) };
}

// ── Send Custom Email ────────────────────────────────────

export async function executeSendCustomEmail(
  userId: number,
  organizationId: number | null,
  args: {
    to: string;
    subject: string;
    body: string;
    fromName?: string;
  },
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  // Gap Report S9: validate email before sending
  if (!isValidEmail(args.to)) {
    return { error: `Invalid recipient email address: ${args.to}` };
  }
  if (!args.subject.trim()) {
    return { error: "Email subject cannot be empty" };
  }
  if (!args.body.trim()) {
    return { error: "Email body cannot be empty" };
  }

  // Rate limit per organization (or per user when there's no org context).
  // The copilot's email tool takes free-form LLM-driven arguments, so an
  // unbounded send rate lets a single chat session be coerced into fan-out
  // spam that damages the org's sender reputation for everyone.
  const rlKey = `copilot:email:${organizationId != null ? `org:${organizationId}` : `user:${userId}`}`;
  const rl = await checkRateLimit(rlKey, COPILOT_EMAIL_LIMIT);
  if (!rl.allowed) {
    log.warn(
      `Copilot email rate limit hit (${rlKey}) — resetInMs=${rl.resetInMs}`,
    );
    return {
      error:
        "Email rate limit reached. You can send up to 10 emails per hour via the AI assistant.",
      rateLimited: true,
      retryInSeconds: Math.ceil(rl.resetInMs / 1000),
    };
  }

  let senderName = args.fromName;
  if (!senderName) {
    const profileRows = await db
      .select()
      .from(distributorProfiles)
      .where(profileScope(userId, organizationId))
      .limit(1);
    senderName =
      profileRows[0]?.brandCompanyName ||
      profileRows[0]?.companyName ||
      "MergeTasks";
  }

  try {
    const result = await sendEmail(args.to, args.subject, args.body, senderName);
    if (result.sent) {
      return { success: true, sentTo: args.to, subject: args.subject };
    }
    return { error: `Email sending failed: ${result.error}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Email sending failed: ${message}` };
  }
}
