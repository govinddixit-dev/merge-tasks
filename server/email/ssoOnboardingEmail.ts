/**
 * ssoOnboardingEmail.ts
 *
 * Branded email sent to a distributor when they successfully configure an SSO
 * identity provider for one of their stores.  The email:
 *
 *   1. Confirms the SSO connection is active
 *   2. Attaches the branded MergeTasks SSO Setup Guide PDF
 *   3. Includes a copy-paste email template the distributor can forward to
 *      their client's IT admin
 *
 * Uses Lane 1 branding (MergeTasks → Distributor).
 */

import { buildEmailHtml } from "./emailTemplates";

interface SsoOnboardingEmailData {
  distributorName: string;
  storeName: string;
  providerName: string;
  protocol: "saml" | "oidc";
  domain: string;
  storeUrl: string;
}

export function buildSsoOnboardingEmail(data: SsoOnboardingEmailData): {
  subject: string;
  html: string;
} {
  const { distributorName, storeName, providerName, protocol, domain, storeUrl } = data;
  const protocolLabel = protocol === "saml" ? "SAML 2.0" : "OpenID Connect";

  const subject = `SSO is live — ${providerName} connected to ${storeName}`;

  const html = buildEmailHtml({
    headline: "SSO Connection Active",
    subheadline: `${providerName} is now connected to your store via ${protocolLabel}.`,
    bodyParagraphs: [
      `Hi ${distributorName},`,
      `Great news — Single Sign-On for <strong>${storeName}</strong> is configured and ready. Employees at <strong>@${domain}</strong> can now sign into your store using their existing work credentials.`,
      `We've attached the <strong>MergeTasks SSO Setup Guide</strong> to this email. It walks you through the full setup process in 5 simple steps — including a ready-to-send email template you can forward to your client's IT admin.`,
      `For a deeper technical reference — network/firewall requirements, admin provisioning, bulk CSV imports, tenant isolation and security posture — share the <a href="https://app.mergetasks.com/docs/it-onboarding-packet.md" style="color:#654BF9;text-decoration:underline;">MergeTasks IT Onboarding Packet</a> with your client's IT team.`,
      `<strong>What happens next:</strong>`,
      `&bull; &nbsp;Employees with an <strong>@${domain}</strong> email will be automatically redirected to their company login when they visit your store.<br />
       &bull; &nbsp;New hires get access automatically — no setup needed on your end.<br />
       &bull; &nbsp;When someone leaves the company, their IT team deactivates the account and they're locked out of your store instantly.`,
    ],
    cta: {
      label: "Open Store Settings",
      url: storeUrl,
    },
    infoCard: {
      title: "Connection Details",
      meta: [
        { label: "Provider", value: providerName },
        { label: "Protocol", value: protocolLabel },
        { label: "Email Domain", value: `@${domain}` },
        { label: "Status", value: "✓ Active" },
      ],
    },
    footerNote: "If you need help, contact us at support@mergetasks.com.",
  });

  return { subject, html };
}
