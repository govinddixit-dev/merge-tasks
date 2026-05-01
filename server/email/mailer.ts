import { Resend } from "resend";
import fs from "fs";
import { getLogger } from "../utils/logger";
import { buildVerificationCodeEmail } from "./emailTemplates";
import {
  buildUnsubscribeUrl,
  isUnsubscribed,
  type UnsubscribeContext,
} from "./unsubscribe";
import { getDb } from "../db";

const log = getLogger("mailer");

/**
 * Lazily instantiate the Resend client so the API key is read at send-time,
 * not at module load. This means credential changes (e.g. via env rotation)
 * are picked up without a server restart.
 */
let _resend: Resend | null = null;
let _apiKeySnapshot = "";

function getResendClient(): Resend | null {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    log.warn("RESEND_API_KEY is not set — emails will not be sent");
    return null;
  }
  // Re-create client only if the key has changed
  if (_resend && _apiKeySnapshot === apiKey) return _resend;
  _resend = new Resend(apiKey);
  _apiKeySnapshot = apiKey;
  log.info("Resend client initialised");
  return _resend;
}

/**
 * The verified "from" address used for all platform-sent emails.
 * Falls back to SMTP_FROM for backward-compat during transition.
 * In production this should be a Resend-verified domain address,
 * e.g. "noreply@mail.mergetasks.com".
 */
function getFromAddress(): string {
  return (
    process.env.RESEND_FROM ??
    process.env.SMTP_FROM ??
    "noreply@mergetasks.com"
  );
}

/**
 * No-op kept for API compatibility — Resend manages its own connection pool.
 * Callers that previously called resetTransporter() after auth errors can
 * keep calling this; it simply clears the cached client so the next send
 * re-initialises with the current API key.
 */
export function resetTransporter() {
  _resend = null;
  _apiKeySnapshot = "";
  log.info("Resend client reset — will reinitialise on next send");
}

/**
 * Send a branded HTML email to a recipient via Resend.
 *
 * Three-lane routing (unchanged from previous SMTP implementation):
 *   Lane 1 (MergeTasks → Distributor): fromName="MergeTasks", replyTo=undefined
 *   Lane 2 (Distributor → Client):     fromName=distributorCompanyName, replyTo=distributorEmail
 *   Lane 3 (Store → Client):           fromName=storeName, replyTo=storeReplyEmail
 *
 * The actual Resend sender is always the platform verified address (RESEND_FROM).
 * `fromName` controls the inbox display name; `replyTo` routes replies to the right party.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  fromName?: string,
  replyTo?: string,
  attachments?: Array<{ filename: string; path: string; contentType?: string }>,
  /**
   * Optional commercial-email metadata. Present ⇒ this email is subject to
   * CASL/CAN-SPAM rules:
   *   1. Suppress the send if the recipient has unsubscribed.
   *   2. Emit RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post` headers
   *      so inbox providers show a native one-click unsubscribe control.
   *
   * Omit entirely for transactional emails (2FA, approvals, receipts, etc.)
   * — those always send and carry no unsubscribe headers.
   */
  unsubscribe?: UnsubscribeContext,
): Promise<{ sent: boolean; error?: string; suppressed?: boolean }> {
  const resend = getResendClient();
  if (!resend) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  // Commercial-email suppression check. Transactional sends (unsubscribe
  // undefined) bypass this branch entirely.
  if (unsubscribe) {
    try {
      const db = await getDb();
      if (db && (await isUnsubscribed(db, unsubscribe))) {
        log.info(
          `Suppressed commercial email to ${to} (type=${unsubscribe.type}, storeId=${unsubscribe.storeId ?? "null"}) — recipient previously unsubscribed`,
        );
        return { sent: false, suppressed: true, error: "recipient unsubscribed" };
      }
    } catch (suppressionErr) {
      // Never let the suppression check take down a send. Log and continue
      // — this fails open, which is the correct behaviour for a best-effort
      // compliance check tied to a required DB round-trip.
      log.error(
        `Unsubscribe suppression lookup failed for ${to} — proceeding with send:`,
        suppressionErr,
      );
    }
  }

  const displayName = fromName || "MergeTasks";
  const fromAddress = getFromAddress();

  // Convert file-path attachments to Resend's base64 content format
  type ResendAttachment = { filename: string; content: string };
  let resendAttachments: ResendAttachment[] | undefined;
  if (attachments && attachments.length > 0) {
    resendAttachments = attachments
      .map((att) => {
        try {
          const content = fs.readFileSync(att.path).toString("base64");
          return { filename: att.filename, content };
        } catch (readErr) {
          log.warn(`Could not read attachment ${att.path}:`, readErr);
          return null;
        }
      })
      .filter((a): a is ResendAttachment => a !== null);
  }

  // RFC 8058 headers for commercial sends. Gmail/Outlook surface these as
  // native one-click unsubscribe controls, improving deliverability.
  let complianceHeaders: Record<string, string> | undefined;
  if (unsubscribe) {
    const url = buildUnsubscribeUrl(unsubscribe);
    complianceHeaders = {
      "List-Unsubscribe": `<${url}>, <mailto:unsubscribe@mergetasks.com>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  try {
    const payload: Parameters<Resend["emails"]["send"]>[0] = {
      from: `${displayName} <${fromAddress}>`,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(resendAttachments && resendAttachments.length > 0
        ? { attachments: resendAttachments }
        : {}),
      ...(complianceHeaders ? { headers: complianceHeaders } : {}),
    };

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      log.error(`Resend API error sending to ${to}:`, error.message);
      return { sent: false, error: error.message };
    }

    log.info(
      `Email sent to ${to} via Resend (from: "${displayName}", replyTo: ${replyTo || "none"}) — id: ${data?.id}`
    );
    return { sent: true };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`Unexpected error sending email to ${to}:`, errMsg);
    return { sent: false, error: errMsg };
  }
}

/**
 * Send a branded 2FA / verification code email.
 *
 * - type "welcome" / "login" → Lane 1 (MergeTasks branded)
 * - type "store_login"       → Lane 3 (Store branded, uses branding param)
 *
 * Returns { sent, emailDelivered, error? }
 */
export async function send2FAEmail(
  recipientEmail: string,
  code: string,
  type: "welcome" | "login" | "store_login",
  recipientName?: string,
  storeName?: string,
  branding?: { companyName?: string; primaryColor?: string; logoUrl?: string }
): Promise<{ sent: boolean; emailDelivered: boolean; error?: string }> {
  const { subject, html } = buildVerificationCodeEmail({
    type,
    code,
    recipientName,
    storeName,
    branding,
  });

  // Lane 1 for distributor 2FA, Lane 3 for store login — no replyTo needed
  const result = await sendEmail(
    recipientEmail,
    subject,
    html,
    type === "store_login"
      ? branding?.companyName || storeName || "MergeTasks"
      : "MergeTasks"
  );

  return {
    sent: true, // code was generated regardless of delivery
    emailDelivered: result.sent,
    error: result.error,
  };
}
