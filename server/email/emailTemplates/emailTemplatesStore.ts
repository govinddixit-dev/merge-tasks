/**
 * emailTemplatesStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lane 3 — Store/Portal → End Client email templates.
 *
 * Exports:
 *   - buildStoreInviteEmail()
 *   - buildVerificationCodeEmail()
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  MT, buildEmailHtml, buildOtpEmailHtml,
  type EmailBranding,
} from "./emailTemplateBase";

// ─── buildStoreInviteEmail ────────────────────────────────────────────────────

/**
 * Lane 3 — Store/Portal → End Client
 * Store Invite email — sent to a new store user when they are provisioned.
 * Uses the store's branding (logo, primaryColor, store name).
 */
export function buildStoreInviteEmail(opts: {
  recipientName: string;
  storeName: string;
  role: string;
  setPasswordUrl: string;
  /** Store branding — logo, primaryColor, store name */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const subject = `You've been invited to ${opts.storeName}`;
  const isPoc = opts.role === "admin";
  const primaryColor = opts.branding?.primaryColor || MT.purple;

  const html = buildEmailHtml({
    branding: { lane: "store", companyName: opts.storeName, ...opts.branding },
    badge: { text: isPoc ? "Store Admin Access" : "Store Access", color: primaryColor },
    headline: `Welcome to ${opts.storeName}`,
    subheadline: isPoc
      ? "You have been set up as the store administrator."
      : "Your account is ready.",
    bodyParagraphs: [
      `Hi <strong>${opts.recipientName}</strong>,`,
      `You've been invited to access <strong>${opts.storeName}</strong>${isPoc ? " as a store administrator" : ""}. Click the button below to set your password and get started.`,
      isPoc
        ? "As a store admin, you can manage users, review orders, and configure store settings."
        : "You can browse products, place orders, and track your order history.",
    ],
    cta: {
      label: "Set Your Password & Access Store →",
      url: opts.setPasswordUrl,
      color: primaryColor,
    },
    alertBox: {
      text: "This invitation link expires in 72 hours. If you need a new link, contact your store administrator.",
      type: "info",
    },
    footerNote: `You received this email because you were added as a user to ${opts.storeName}.`,
  });

  return { subject, html };
}

// ─── buildVerificationCodeEmail ───────────────────────────────────────────────

/**
 * Lane 1 — MergeTasks → Distributor
 * 2FA / Verification Code email for distributor login/signup.
 *
 * Lane 3 — Store/Portal → End Client
 * Store login verification code — uses store branding when type = "store_login".
 */
export function buildVerificationCodeEmail(opts: {
  type: "welcome" | "login" | "store_login";
  code: string;
  recipientName?: string;
  storeName?: string;
  /** For store_login: pass store branding (Lane 3). For welcome/login: leave undefined (Lane 1). */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : "Hi there,";

  const isWelcome = opts.type === "welcome";
  const isStore   = opts.type === "store_login";

  const subject = isWelcome
    ? `Welcome to MergeTasks — Your verification code is ${opts.code}`
    : isStore
    ? `Your ${opts.storeName || "Store"} login code: ${opts.code}`
    : `Your MergeTasks login code: ${opts.code}`;

  const primaryColor = opts.branding?.primaryColor || MT.purple;

  const html = buildOtpEmailHtml({
    code: opts.code,
    headline: isWelcome
      ? "Welcome to MergeTasks"
      : isStore
      ? `Sign in to ${opts.storeName || "Your Store"}`
      : "Verify your identity",
    greeting,
    bodyText: isWelcome
      ? "Thank you for joining <strong>MergeTasks</strong>. Enter the code below to complete your registration."
      : isStore
      ? `Enter the code below to sign in to <strong>${opts.storeName || "your store"}</strong>.`
      : "We received a sign-in request for your MergeTasks account. Enter the code below to continue.",
    expiryMinutes: 10,
    securityNote: isWelcome
      ? "After verifying, you&#39;ll complete your distributor profile. If you didn&#39;t create this account, you can safely ignore this email."
      : "If you didn&#39;t request this code, you can safely ignore this email. Do not share this code with anyone.",
    branding: isStore
      ? { lane: "store" as const, companyName: opts.storeName, ...opts.branding }
      : { lane: "mergetasks" as const },
  });

  return { subject, html };
}

// ─── buildCustomRequestRejectedEmail ──────────────────────────────────────────

/**
 * Lane 3 — Store/Portal → End Client (employee)
 * Sent to the employee who placed a custom order request when their manager
 * declines it. Includes the manager's rejection reason so the employee knows
 * what to change. Fires independently of any distributor-side notification.
 */
export function buildCustomRequestRejectedEmail(opts: {
  employeeName: string;
  requestTitle: string;
  storeName: string;
  managerName?: string;
  reason?: string;
  /** Tier 3 — store branding (logo, primaryColor, store name). */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const subject = `Your request "${opts.requestTitle}" was declined`;
  const primaryColor = opts.branding?.primaryColor || MT.purple;
  const reviewer = opts.managerName?.trim() || "Your manager";

  const html = buildEmailHtml({
    branding: { lane: "store", companyName: opts.storeName, ...opts.branding, primaryColor },
    badge: { text: "Request Declined", color: MT.red, bgColor: MT.redLight },
    headline: "Your request was declined",
    subheadline: `${reviewer} reviewed your custom order request.`,
    bodyParagraphs: [
      `Hi <strong>${opts.employeeName}</strong>,`,
      `${reviewer} reviewed your request <strong>${opts.requestTitle}</strong> and was not able to approve it this time.`,
    ],
    ...(opts.reason && opts.reason.trim().length > 0
      ? { alertBox: { type: "warning" as const, text: `<strong>Reason:</strong> ${opts.reason}` } }
      : {}),
    footerNote: `You received this email because you submitted a custom order request through ${opts.storeName}. Reply to your manager directly if you have questions.`,
  });

  return { subject, html };
}
