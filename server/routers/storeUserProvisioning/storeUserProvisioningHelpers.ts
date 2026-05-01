/**
 * storeUserProvisioningHelpers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared constants, session utilities, branding loader, the legacy
 * buildSetPasswordEmail helper, and the core provisionStoreUser() function
 * used by both the auth and management sub-routers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { stores, storeUsers, storePasswordTokens, distributorProfiles } from "../../../drizzle/schema";
import { sendEmail } from "../../email/mailer";
import { buildStoreInviteEmail } from "../../email/emailTemplates";
import { nanoid } from "nanoid";
import { SignJWT } from "jose";
import { ENV } from "../../_core/env";
import { getLogger } from "../../utils/logger";

const log = getLogger("storeUserProvisioning");

// ─── Constants ────────────────────────────────────────────────────────────────
export const TOKEN_EXPIRY_HOURS = 72; // 3 days for set-password links
export const BCRYPT_ROUNDS = 10;
export const STORE_COOKIE_PREFIX = "mt_store_";
export const STORE_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24h

// ─── Session helpers ──────────────────────────────────────────────────────────

export function getStoreSecret() {
  return new TextEncoder().encode(ENV.cookieSecret + "_store");
}

export async function createStoreSessionToken(
  storeId: number,
  storeUserId: number,
  email: string,
  role: string
) {
  return new SignJWT({ storeId, storeUserId, email, role })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(getStoreSecret());
}

// ─── Distributor branding loader ──────────────────────────────────────────────

export async function loadDistributorBranding(userId: number) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [profile] = await db
      .select()
      .from(distributorProfiles)
      .where(eq(distributorProfiles.userId, userId))
      .limit(1);
    if (profile) {
      return {
        logoUrl: profile.brandLogoUrl || null,
        primaryColor: profile.brandPrimaryColor || "#654BF9",
        secondaryColor: profile.brandSecondaryColor || "#1A1A1A",
        bannerColor: profile.brandBannerColor || "#654BF9",
        companyName: profile.brandCompanyName || profile.companyName || "MergeTasks",
      };
    }
  } catch (e) {
    log.info("Could not fetch branding:", e);
  }
  return null;
}

// ─── Legacy distributor-branded set-password email ────────────────────────────
// Kept for backward compatibility; active path uses buildStoreInviteEmail.

export function buildSetPasswordEmail(opts: {
  recipientName: string;
  storeName: string;
  role: string;
  setPasswordUrl: string;
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    bannerColor: string;
    companyName: string;
  };
}): { subject: string; html: string } {
  const { recipientName, storeName, role, setPasswordUrl, branding } = opts;
  const roleName =
    role === "admin"
      ? "Point of Contact (Admin)"
      : role.charAt(0).toUpperCase() + role.slice(1);

  const logoHtml = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" width="180" height="40" style="display:block; margin:0 auto; max-width:180px; height:auto;" />`
    : `<h1 style="color:#FFFFFF; font-size:24px; font-weight:700; margin:0; letter-spacing:-0.5px;">${branding.companyName}</h1>`;

  return {
    subject: `You've been invited to ${storeName} — Set your password`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#F3F4F6; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6; padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <!-- Header — Distributor branded -->
        <tr>
          <td style="background:linear-gradient(135deg,${branding.bannerColor} 0%,${branding.primaryColor} 100%); padding:36px 32px; text-align:center;">
            ${logoHtml}
            <p style="color:rgba(255,255,255,0.85); font-size:14px; margin:12px 0 0 0; font-weight:400;">Company Store Invitation</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px 32px;">
            <p style="font-size:15px; line-height:1.7; color:#374151; margin:0 0 16px 0;">Hi ${recipientName},</p>
            <p style="font-size:15px; line-height:1.7; color:#374151; margin:0 0 16px 0;">
              You've been invited to access <strong>${storeName}</strong> as a <strong>${roleName}</strong>.
            </p>
            <p style="font-size:15px; line-height:1.7; color:#374151; margin:0 0 24px 0;">
              Please click the button below to set your password and activate your account:
            </p>
            <!-- CTA Button -->
            <div style="text-align:center; margin:24px 0;">
              <a href="${setPasswordUrl}" style="display:inline-block; background:${branding.primaryColor}; color:#FFFFFF; font-size:16px; font-weight:600; text-decoration:none; padding:14px 40px; border-radius:8px;">
                Set Your Password
              </a>
            </div>
            <p style="font-size:13px; color:#9CA3AF; text-align:center; margin:16px 0 0 0;">
              This link expires in ${TOKEN_EXPIRY_HOURS} hours. If you didn't expect this invitation, you can safely ignore this email.
            </p>
            <!-- Info box -->
            <div style="margin-top:28px; padding:20px 24px; background:#F9FAFB; border-radius:12px; border:1px solid #E5E7EB;">
              <p style="margin:0 0 8px 0; font-size:14px; font-weight:600; color:#374151;">Your access details:</p>
              <table style="width:100%; border-collapse:collapse;">
                <tr>
                  <td style="padding:4px 0; font-size:13px; color:#6B7280; width:80px;">Store:</td>
                  <td style="padding:4px 0; font-size:13px; color:#111827; font-weight:500;">${storeName}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0; font-size:13px; color:#6B7280;">Role:</td>
                  <td style="padding:4px 0; font-size:13px; color:#111827; font-weight:500;">${roleName}</td>
                </tr>
              </table>
            </div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px; border-top:1px solid #F3F4F6; text-align:center;">
            <p style="font-size:12px; color:#9CA3AF; margin:0;">
              &copy; ${new Date().getFullYear()} ${branding.companyName} &mdash; Powered by MergeTasks
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

// ─── Core provisioning function ───────────────────────────────────────────────

/**
 * Create a set-password token for a store user and send the invitation email.
 * Used both for initial provisioning and for password-reset flows.
 */
export async function provisionStoreUser(opts: {
  storeId: number;
  storeUserId: number;
  email: string;
  name: string;
  role: string;
  storeName: string;
  storeSlug: string;
  distributorUserId: number;
  /** Frontend origin for building the set-password URL */
  origin: string;
}): Promise<{ token: string; emailSent: boolean }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  // Generate a unique token
  const token = nanoid(48);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  await db.insert(storePasswordTokens).values({
    storeId: opts.storeId,
    storeUserId: opts.storeUserId,
    token,
    type: "set_password",
    expiresAt,
  });

  // Load distributor branding
  const branding = await loadDistributorBranding(opts.distributorUserId);
  const brandingData = branding || {
    logoUrl: null,
    primaryColor: "#654BF9",
    bannerColor: "#654BF9",
    companyName: "MergeTasks",
  };

  // Build the set-password URL
  const setPasswordUrl = `${opts.origin}/s/${opts.storeSlug}/set-password?token=${token}`;

  const { subject, html } = buildStoreInviteEmail({
    recipientName: opts.name || opts.email,
    storeName: opts.storeName,
    role: opts.role,
    setPasswordUrl,
    branding: {
      lane: "store",
      companyName: brandingData.companyName,
      primaryColor: brandingData.primaryColor,
      logoUrl: brandingData.logoUrl || undefined,
    },
  });

  // Lane 3: from="<Store> via MergeTasks", replyTo=store.senderEmail
  const { resolveTier3 } = await import("../../email/brandingResolver");
  const resolved = await resolveTier3({ storeId: opts.storeId });
  const emailResult = await sendEmail(opts.email, subject, html, resolved.fromName, resolved.replyTo);

  return { token, emailSent: emailResult.sent };
}
