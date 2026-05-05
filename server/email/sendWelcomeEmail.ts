/**
 * sendWelcomeEmail.ts
 *
 * Sends the post-onboarding welcome email to a new distributor with all four
 * MergeTasks onboarding guides attached as PDFs.
 *
 * Triggered once from onboarding.saveOnboarding after onboardingCompleted is set to true.
 */
import path from "path";
import { sendEmail } from "./mailer";
import { buildWelcomeEmail } from "./emailTemplateWelcome";
import { getLogger } from "../utils/logger";

const log = getLogger("welcome-email");

/**
 * Resolve a guide PDF path — prefers the production dist build, falls back to
 * the dev source in client/public/guides/ (same pattern as sendSsoOnboardingEmail).
 */
function getGuidePath(filename: string): string {
  const distPath = path.resolve(__dirname, "../../dist/public/guides/", filename);
  const devPath  = path.resolve(__dirname, "../../client/public/guides/", filename);
  try {
    require("fs").accessSync(distPath);
    return distPath;
  } catch {
    return devPath;
  }
}

const GUIDE_ATTACHMENTS = [
  {
    filename: "MergeTasks_Guide_01_Getting_Started.pdf",
    label:    "Guide 1 — Getting Started",
  },
  {
    filename: "MergeTasks_Guide_02_Proposals_Orders_Proofing.pdf",
    label:    "Guide 2 — Proposals, Orders & Virtual Proofing",
  },
  {
    filename: "MergeTasks_Guide_03_Webstores_Client_Portals.pdf",
    label:    "Guide 3 — Webstores & Client Portals",
  },
  {
    filename: "MergeTasks_Guide_04_Integrations.pdf",
    label:    "Guide 4 — Integrations & Connections",
  },
];

export interface SendWelcomeEmailOpts {
  distributorEmail: string;
  firstName: string;
  companyName?: string;
  loginUrl?: string;
}

export async function sendWelcomeEmail(
  opts: SendWelcomeEmailOpts
): Promise<{ sent: boolean; error?: string }> {
  const loginUrl = opts.loginUrl ?? "https://app.mergetasks.com";

  const { subject, html } = buildWelcomeEmail({
    firstName:   opts.firstName,
    companyName: opts.companyName,
    loginUrl,
  });

  const attachments = GUIDE_ATTACHMENTS.map((g) => ({
    filename:    g.filename,
    path:        getGuidePath(g.filename),
    contentType: "application/pdf" as const,
  }));

  log.info(
    `Sending welcome email to ${opts.distributorEmail} ` +
    `(${opts.firstName}${opts.companyName ? ` / ${opts.companyName}` : ""}) ` +
    `with ${attachments.length} guide attachments`
  );

  const result = await sendEmail(
    opts.distributorEmail,
    subject,
    html,
    "MergeTasks",  // fromName — Lane 1
    undefined,     // replyTo — not needed
    attachments
  );

  if (!result.sent) {
    log.warn(
      `Welcome email delivery failed for ${opts.distributorEmail}: ${result.error}`
    );
  }

  return result;
}
