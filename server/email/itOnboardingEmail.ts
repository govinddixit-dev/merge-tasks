/**
 * itOnboardingEmail.ts
 *
 * Branded email sent to the organization admin (and optionally their IT
 * contact) when the org setup wizard completes. Links to the IT onboarding
 * packet covering SSO, network, admin provisioning, user import, and
 * security posture.
 */

import { buildEmailHtml } from "./emailTemplates";

interface ItOnboardingEmailData {
  adminName: string;
  organizationName: string;
  dashboardUrl: string;
  /** Public URL of the IT onboarding packet markdown / pdf, if hosted */
  packetUrl?: string;
}

export function buildItOnboardingEmail(data: ItOnboardingEmailData): {
  subject: string;
  html: string;
} {
  const { adminName, organizationName, dashboardUrl, packetUrl } = data;

  const subject = `Welcome to MergeTasks — IT Onboarding Packet for ${organizationName}`;

  const html = buildEmailHtml({
    headline: "Your IT Onboarding Packet",
    subheadline: `Everything ${organizationName}'s IT / security team needs to finish rolling out MergeTasks.`,
    bodyParagraphs: [
      `Hi ${adminName},`,
      `Thanks for setting up <strong>${organizationName}</strong> on MergeTasks. This email contains the complete IT onboarding packet — forward it to whoever handles SSO, network policy, or security reviews on your side.`,
      `<strong>What's inside:</strong>`,
      `&bull; &nbsp;SAML 2.0 and OIDC setup (metadata, attribute mapping, PKCE)<br />
       &bull; &nbsp;Network / firewall requirements (outbound only — no inbound rules needed)<br />
       &bull; &nbsp;Admin provisioning and role model<br />
       &bull; &nbsp;Bulk user import via CSV<br />
       &bull; &nbsp;Security overview: tenant isolation, encryption, audit logs, lockout<br />
       &bull; &nbsp;Support contacts (including security disclosures and Enterprise SLA)`,
      packetUrl
        ? `Packet URL: <a href="${packetUrl}">${packetUrl}</a>`
        : `The packet is attached as a PDF to this email.`,
    ],
    cta: {
      label: "Open MergeTasks Dashboard",
      url: dashboardUrl,
    },
    footerNote: "Questions? support@mergetasks.com  |  Security: security@mergetasks.com",
  });

  return { subject, html };
}
