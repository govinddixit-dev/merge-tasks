/**
 * sendSsoOnboardingEmail.ts
 *
 * Sends the branded SSO onboarding email to a distributor with the
 * MergeTasks SSO Setup Guide PDF attached.
 */

import path from "path";
import { sendEmail } from "./mailer";
import { buildSsoOnboardingEmail } from "./ssoOnboardingEmail";
import { getLogger } from "../utils/logger";

const log = getLogger("sso-onboarding-email");

/**
 * The branded SSO Setup Guide PDF lives in client/public/guides/ and is
 * copied to dist/public/guides/ during build.  We resolve relative to
 * the project root so it works in both dev and production.
 */
function getGuideAttachmentPath(): string {
  // In production the built assets are in dist/public/
  const distPath = path.resolve(__dirname, "../../dist/public/guides/MergeTasks_SSO_Setup_Guide.pdf");
  const devPath = path.resolve(__dirname, "../../client/public/guides/MergeTasks_SSO_Setup_Guide.pdf");

  // Prefer dist (production), fall back to dev source
  try {
    require("fs").accessSync(distPath);
    return distPath;
  } catch {
    return devPath;
  }
}

interface SendSsoOnboardingOpts {
  distributorEmail: string;
  distributorName: string;
  storeName: string;
  providerName: string;
  protocol: "saml" | "oidc";
  domain: string;
  storeUrl: string;
}

export async function sendSsoOnboardingEmail(
  opts: SendSsoOnboardingOpts
): Promise<{ sent: boolean; error?: string }> {
  const { subject, html } = buildSsoOnboardingEmail({
    distributorName: opts.distributorName,
    storeName: opts.storeName,
    providerName: opts.providerName,
    protocol: opts.protocol,
    domain: opts.domain,
    storeUrl: opts.storeUrl,
  });

  const guidePath = getGuideAttachmentPath();

  log.info(
    `Sending SSO onboarding email to ${opts.distributorEmail} ` +
    `(provider: ${opts.providerName}, domain: ${opts.domain})`
  );

  return sendEmail(
    opts.distributorEmail,
    subject,
    html,
    "MergeTasks",       // fromName — Lane 1
    undefined,          // replyTo — not needed
    [
      {
        filename: "MergeTasks_SSO_Setup_Guide.pdf",
        path: guidePath,
        contentType: "application/pdf",
      },
    ]
  );
}
