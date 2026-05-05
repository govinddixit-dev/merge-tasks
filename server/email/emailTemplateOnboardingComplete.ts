/**
 * MergeTasks Onboarding Completion Email Template
 * Sent once after a distributor finishes the onboarding wizard
 * (clicks "Finish & Personalize" on the final Payments step).
 *
 * Same Apple-style layout as the signup welcome email — reuses emailBase
 * so branding, header, and footer stay consistent across the platform.
 */

import { emailBase } from "./emailTemplateBase";

export interface BuildOnboardingCompleteEmailParams {
  firstName: string;
  companyName?: string;
  dashboardUrl: string;
  /** Distributor-provided answers from the questionnaire — surfaced as a short summary. */
  summary?: {
    companySize?: string;
    primaryGoal?: string;
    specialties?: string[];
    topCategories?: string[];
    targetIndustries?: string[];
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSummaryRow(label: string, value: string | undefined): string {
  if (!value || !value.trim()) return "";
  return `
    <tr>
      <td style="padding: 4px 0;">
        <span style="display:inline-block; min-width:110px; font-size:12px; font-weight:600; color:#6B7280; text-transform:uppercase; letter-spacing:1px;">${escapeHtml(label)}</span>
        <span style="font-size:14px; color:#111827; font-weight:600;">${escapeHtml(value)}</span>
      </td>
    </tr>`;
}

export function buildOnboardingCompleteEmail(
  params: BuildOnboardingCompleteEmailParams,
): { subject: string; html: string } {
  const { firstName, companyName, dashboardUrl, summary } = params;

  const subject = `You're all set, ${firstName} — MergeTasks is personalized for you.`;

  const summaryRows: string[] = [];
  if (summary?.companySize) summaryRows.push(renderSummaryRow("Company size", summary.companySize));
  if (summary?.primaryGoal) summaryRows.push(renderSummaryRow("Primary goal", summary.primaryGoal));
  if (summary?.specialties?.length) summaryRows.push(renderSummaryRow("Specialties", summary.specialties.join(", ")));
  if (summary?.topCategories?.length) summaryRows.push(renderSummaryRow("Top categories", summary.topCategories.join(", ")));
  if (summary?.targetIndustries?.length) summaryRows.push(renderSummaryRow("Target industries", summary.targetIndustries.join(", ")));

  const summaryBlock = summaryRows.length === 0 ? "" : `
    <!-- What you told us -->
    <tr>
      <td style="padding: 32px 48px 0;">
        <p style="margin:0 0 6px; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#654BF9;">WHAT YOU TOLD US</p>
        <h2 style="margin:0 0 16px; font-size:20px; font-weight:800; color:#111827; letter-spacing:-0.3px;">Your setup summary</h2>
        <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:14px; padding:20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${summaryRows.join("")}
          </table>
        </div>
      </td>
    </tr>`;

  const body = `
    <!-- Hero -->
    <tr>
      <td style="padding: 40px 48px 0; text-align: center;">
        <h1 style="margin:0 0 12px; font-size:28px; font-weight:800; color:#111827; letter-spacing:-0.5px; line-height:1.2;">
          You're all set${companyName ? `, ${escapeHtml(companyName)}` : ""}. 🎉
        </h1>
        <p style="margin:0; font-size:16px; color:#6B7280; line-height:1.6;">
          Onboarding is complete — your dashboard is personalized<br>and ready for your first proposal.
        </p>
      </td>
    </tr>

    <!-- Primary CTA -->
    <tr>
      <td style="padding: 28px 48px 0; text-align: center;">
        <a href="${dashboardUrl}" style="
          display:inline-block;
          background:linear-gradient(135deg,#654BF9 0%,#8B7AFC 100%);
          color:#FFFFFF;
          text-decoration:none;
          font-size:15px;
          font-weight:700;
          padding:14px 32px;
          border-radius:100px;
          box-shadow:0 4px 16px rgba(101,75,249,0.35);
        ">Open Your Dashboard →</a>
      </td>
    </tr>
    ${summaryBlock}

    <!-- Divider -->
    <tr>
      <td style="padding: 36px 48px 0;">
        <div style="height:1px; background:#E5E7EB;"></div>
      </td>
    </tr>

    <!-- Recommended next actions -->
    <tr>
      <td style="padding: 32px 48px 0;">
        <p style="margin:0 0 6px; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#654BF9;">RECOMMENDED NEXT</p>
        <h2 style="margin:0 0 18px; font-size:20px; font-weight:800; color:#111827; letter-spacing:-0.3px;">Three moves that pay off this week</h2>

        <!-- Action 1 -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
          <tr>
            <td style="padding:16px 18px; background:#F5F3FF; border-radius:12px;">
              <p style="margin:0 0 4px; font-size:14px; font-weight:700; color:#111827;">1. Create your first webstore</p>
              <p style="margin:0 0 8px; font-size:13px; color:#6B7280; line-height:1.5;">Spin up a branded storefront for one of your clients — MergeTasks does the heavy lifting.</p>
              <a href="${dashboardUrl.replace(/\/dashboard$/, "")}/create-webstore" style="font-size:12px; color:#654BF9; font-weight:700; text-decoration:none;">Start a store →</a>
            </td>
          </tr>
        </table>

        <!-- Action 2 -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
          <tr>
            <td style="padding:16px 18px; background:#F5F3FF; border-radius:12px;">
              <p style="margin:0 0 4px; font-size:14px; font-weight:700; color:#111827;">2. Send your first AI-generated proposal</p>
              <p style="margin:0 0 8px; font-size:13px; color:#6B7280; line-height:1.5;">Let MergeTasks Copilot draft the pitch, pricing, and proof in under a minute.</p>
              <a href="${dashboardUrl.replace(/\/dashboard$/, "")}/create-proposal" style="font-size:12px; color:#654BF9; font-weight:700; text-decoration:none;">Draft a proposal →</a>
            </td>
          </tr>
        </table>

        <!-- Action 3 -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
          <tr>
            <td style="padding:16px 18px; background:#F5F3FF; border-radius:12px;">
              <p style="margin:0 0 4px; font-size:14px; font-weight:700; color:#111827;">3. Connect Stripe so clients can pay by card</p>
              <p style="margin:0 0 8px; font-size:13px; color:#6B7280; line-height:1.5;">Funds route directly to your bank account; MergeTasks never touches them.</p>
              <a href="${dashboardUrl.replace(/\/dashboard$/, "")}/settings?tab=billing" style="font-size:12px; color:#654BF9; font-weight:700; text-decoration:none;">Connect Stripe →</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Support line -->
    <tr>
      <td style="padding: 32px 48px 8px; text-align: center;">
        <p style="margin:0; font-size:13px; color:#9CA3AF; line-height:1.6;">
          Need a hand? Reply to this email or reach us at
          <a href="mailto:support@mergetasks.com" style="color:#654BF9; text-decoration:none; font-weight:600;">support@mergetasks.com</a>.
        </p>
      </td>
    </tr>
  `;

  const html = emailBase({
    previewText: `Onboarding complete — your MergeTasks dashboard is ready.`,
    body,
  });

  return { subject, html };
}
