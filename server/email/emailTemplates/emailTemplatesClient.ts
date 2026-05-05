/**
 * emailTemplatesClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lane 2 — Distributor → End Client email templates.
 *
 * Exports:
 *   - buildProposalSentEmail()
 *   - buildDeptApprovalRequestEmail()
 *   - buildStoreApprovalRequestEmail()
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  MT, buildEmailHtml, formatCurrency,
  type EmailProductCard, type EmailBranding,
} from "./emailTemplateBase";

// ─── buildProposalSentEmail ───────────────────────────────────────────────────

/**
 * Lane 2 — Distributor → End Client (via Store/Portal)
 * Proposal Sent email — sent to the client when a distributor sends a proposal.
 * Uses the distributor's branding (logo, colors, company name).
 */
export function buildProposalSentEmail(opts: {
  clientName: string;
  distributorName: string;
  proposalTitle: string;
  personalMessage?: string;
  products?: EmailProductCard[];
  proposalTotal?: number;
  viewUrl: string;
  /** Distributor branding — logo, primaryColor, companyName */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const subject = `${opts.distributorName} sent you a proposal: ${opts.proposalTitle}`;
  const primaryColor = opts.branding?.primaryColor || MT.purple;

  const html = buildEmailHtml({
    branding: { lane: "distributor", ...opts.branding },
    badge: { text: "New Proposal", color: primaryColor },
    headline: "You Have a New Proposal",
    subheadline: `From ${opts.distributorName}`,
    bodyParagraphs: [
      `Hi <strong>${opts.clientName}</strong>,`,
      opts.personalMessage ||
        `${opts.distributorName} has put together a proposal for you. Click below to review the products, pricing, and details.`,
    ],
    infoCard: {
      title: opts.proposalTitle,
      subtitle: "Click the button below to view your proposal",
      accentColor: primaryColor,
      meta: [
        { label: "From", value: opts.distributorName },
        ...(opts.proposalTotal != null
          ? [{ label: "Proposal Total", value: formatCurrency(opts.proposalTotal) }]
          : []),
        {
          label: "Sent",
          value: new Date().toLocaleDateString("en-US", {
            month: "long", day: "numeric", year: "numeric",
          }),
        },
      ],
    },
    products: opts.products?.slice(0, 3),
    cta: {
      label: "View Your Proposal →",
      url: opts.viewUrl,
      color: primaryColor,
    },
    alertBox: {
      text: "You can review, approve, or request changes directly from the proposal page — no account required.",
      type: "info",
    },
    footerNote: `This proposal was sent to you by ${opts.distributorName}. If you were not expecting this, you can safely ignore this email.`,
  });

  return { subject, html };
}

// ─── buildDeptApprovalRequestEmail ───────────────────────────────────────────

/**
 * Lane 2 — Distributor → End Client (via Store/Portal)
 * Department Approval Request email — sent to a department head when their
 * approval is required for a proposal.
 * Uses the distributor's (or store's) branding.
 */
export function buildDeptApprovalRequestEmail(opts: {
  approverName: string;
  departmentName: string;
  clientCompany: string;
  proposalTitle: string;
  proposalTotal?: number;
  products?: EmailProductCard[];
  approveUrl: string;
  declineUrl: string;
  expiresAt?: Date;
  /** Distributor or store branding */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const subject = `Approval Required: ${opts.proposalTitle} — ${opts.departmentName}`;
  const primaryColor = opts.branding?.primaryColor || MT.purple;

  const html = buildEmailHtml({
    branding: { lane: "distributor", ...opts.branding },
    badge: { text: "Approval Required", color: "#D97706", bgColor: "#FFFBEB" },
    headline: "Your Approval is Required",
    subheadline: `${opts.departmentName} sign-off needed for ${opts.clientCompany}`,
    bodyParagraphs: [
      `Hi <strong>${opts.approverName}</strong>,`,
      `A proposal from <strong>${opts.clientCompany}</strong> requires your department's approval before it can proceed to fulfillment. Please review the details below and approve or decline.`,
    ],
    infoCard: {
      title: opts.proposalTitle,
      subtitle: `Awaiting ${opts.departmentName} approval`,
      accentColor: "#D97706",
      bgColor: "#FFFBEB",
      meta: [
        { label: "Client", value: opts.clientCompany },
        { label: "Department", value: opts.departmentName },
        ...(opts.proposalTotal != null
          ? [{ label: "Total", value: formatCurrency(opts.proposalTotal) }]
          : []),
        ...(opts.expiresAt
          ? [
              {
                label: "Expires",
                value: opts.expiresAt.toLocaleDateString("en-US", {
                  month: "long", day: "numeric", year: "numeric",
                }),
              },
            ]
          : []),
      ],
    },
    products: opts.products?.slice(0, 4),
    cta: {
      label: "✓ Approve This Proposal →",
      url: opts.approveUrl,
      color: MT.green,
    },
    secondaryLink: {
      label: "Decline this proposal",
      url: opts.declineUrl,
    },
    alertBox: {
      text: "By approving, you confirm that your department has reviewed and authorized this purchase. This action is logged.",
      type: "warning",
    },
    footerNote:
      "You received this email because you are listed as a department approver for this proposal.",
  });

  return { subject, html };
}

// ─── buildStoreApprovalRequestEmail ──────────────────────────────────────────

/**
 * Lane 2 — Distributor → Client
 * Sent when a distributor requests client approval for a store design.
 */
export function buildStoreApprovalRequestEmail(opts: {
  clientName: string;
  storeName: string;
  distributorName: string;
  approvalUrl: string;
  branding: { logoUrl?: string | null; primaryColor: string; companyName: string };
}): { subject: string; html: string } {
  const { clientName, storeName, approvalUrl } = opts;
  const { logoUrl, primaryColor, companyName } = opts.branding;

  const subject = `${storeName} — Your Store is Ready for Review`;

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName}" style="max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<span style="font-size:22px;font-weight:800;color:#ffffff;">${companyName}</span>`;

  const html = [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    "<head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Your Store is Ready for Review</title></head>",
    "<body style=\"margin:0;padding:0;background:#F5F5F5;font-family:'Helvetica Neue',Arial,sans-serif;\">",
    "  <table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#F5F5F5;padding:32px 0;\">",
    "    <tr><td align=\"center\">",
    "      <table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);\">",
    `        <tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,${primaryColor}CC 100%);padding:32px 40px;text-align:center;">${logoHtml}</td></tr>`,
    "        <tr><td style=\"padding:40px;\">",
    "          <h1 style=\"margin:0 0 8px;font-size:26px;font-weight:800;color:#111827;\">Your branded store is ready!</h1>",
    `          <p style="margin:0 0 24px;font-size:15px;color:#6B7280;">Hi ${clientName},</p>`,
    `          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">${companyName} has built a custom branded store for you — <strong>${storeName}</strong>. Please take a moment to review the design and click <strong>Approve</strong> when you're happy with it.</p>`,
    "          <table cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 auto 32px;\">",
    `            <tr><td style="background:${primaryColor};border-radius:12px;">`,
    `              <a href="${approvalUrl}" style="display:inline-block;padding:16px 40px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Review &amp; Approve Store →</a>`,
    "            </td></tr>",
    "          </table>",
    "          <p style=\"margin:0 0 8px;font-size:13px;color:#9CA3AF;text-align:center;\">This link expires in 14 days.</p>",
    `          <p style="margin:0;font-size:13px;color:#D1D5DB;text-align:center;">Or copy this link: <span style="color:#6B7280;word-break:break-all;">${approvalUrl}</span></p>`,
    "        </td></tr>",
    `        <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 40px;text-align:center;">`,
    `          <p style="margin:0;font-size:12px;color:#9CA3AF;">Sent by ${companyName} · Powered by <strong>MergeTasks</strong></p>`,
    "        </td></tr>",
    "      </table>",
    "    </td></tr>",
    "  </table>",
    "</body></html>",
  ].join("\n");

  return { subject, html };
}
