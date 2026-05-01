/**
 * sendItOnboardingEmail.ts
 *
 * Sends the IT onboarding packet email when an org admin completes the
 * setup wizard. Attaches docs/it-onboarding-packet.md as a plain-text
 * attachment (simplest cross-client rendering). If a PDF version is
 * present in dist/public/guides/, we prefer that.
 */

import path from "path";
import fs from "fs";
import { sendEmail } from "./mailer";
import { buildItOnboardingEmail } from "./itOnboardingEmail";
import { getLogger } from "../utils/logger";

const log = getLogger("it-onboarding-email");

function resolveAttachment(): { filename: string; path: string; contentType: string } | null {
  const candidates = [
    { file: "MergeTasks_IT_Onboarding_Packet.pdf", type: "application/pdf", dirs: ["../../dist/public/guides", "../../client/public/guides"] },
    { file: "it-onboarding-packet.md", type: "text/markdown", dirs: ["../../docs"] },
  ];
  for (const c of candidates) {
    for (const dir of c.dirs) {
      const p = path.resolve(__dirname, dir, c.file);
      try {
        fs.accessSync(p);
        return { filename: c.file, path: p, contentType: c.type };
      } catch { /* keep looking */ }
    }
  }
  return null;
}

interface SendItOnboardingOpts {
  adminEmail: string;
  adminName: string;
  organizationName: string;
  dashboardUrl: string;
  packetUrl?: string;
}

export async function sendItOnboardingEmail(
  opts: SendItOnboardingOpts,
): Promise<{ sent: boolean; error?: string }> {
  const { subject, html } = buildItOnboardingEmail({
    adminName: opts.adminName,
    organizationName: opts.organizationName,
    dashboardUrl: opts.dashboardUrl,
    packetUrl: opts.packetUrl,
  });

  const attachment = resolveAttachment();
  log.info(
    `Sending IT onboarding email to ${opts.adminEmail} for ${opts.organizationName}` +
    (attachment ? ` (attaching ${attachment.filename})` : " (no attachment found)")
  );

  return sendEmail(
    opts.adminEmail,
    subject,
    html,
    "MergeTasks",
    undefined,
    attachment ? [attachment] : undefined,
  );
}
