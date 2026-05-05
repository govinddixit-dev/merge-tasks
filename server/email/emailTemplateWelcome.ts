/**
 * MergeTasks Welcome Email Template
 * Sent once after a new distributor successfully verifies their 2FA code on sign-up.
 * Apple-style layout — clean, branded, user-friendly.
 */

import { emailBase } from "./emailTemplateBase";

export function buildWelcomeEmail(params: {
  firstName: string;
  companyName?: string;
  loginUrl: string;
}): { subject: string; html: string } {
  const { firstName, companyName, loginUrl } = params;
  const displayName = companyName ? companyName : firstName;

  const subject = `Welcome to MergeTasks, ${firstName} — You're all set.`;

  const body = `
    <!-- Hero greeting -->
    <tr>
      <td style="padding: 40px 48px 0; text-align: center;">
        <h1 style="
          margin: 0 0 12px;
          font-size: 28px;
          font-weight: 800;
          color: #111827;
          letter-spacing: -0.5px;
          line-height: 1.2;
        ">Welcome to MergeTasks,<br>${firstName}. 👋</h1>
        <p style="
          margin: 0;
          font-size: 16px;
          color: #6B7280;
          line-height: 1.6;
        ">Your account is ready. Here's everything you need<br>to hit the ground running.</p>
      </td>
    </tr>

    <!-- Brand tagline pill -->
    <tr>
      <td style="padding: 20px 48px 0; text-align: center;">
        <span style="
          display: inline-block;
          background: #F5F3FF;
          color: #654BF9;
          border-radius: 100px;
          padding: 6px 18px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 1px;
          text-transform: uppercase;
        ">Built for hardworking distributors like you</span>
      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 32px 48px 0;">
        <div style="height: 1px; background: #E5E7EB;"></div>
      </td>
    </tr>

    <!-- Quick-start section heading -->
    <tr>
      <td style="padding: 32px 48px 8px;">
        <p style="
          margin: 0 0 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #654BF9;
        ">YOUR FIRST STEPS</p>
        <h2 style="
          margin: 0;
          font-size: 20px;
          font-weight: 800;
          color: #111827;
          letter-spacing: -0.3px;
        ">Get set up in 15 minutes</h2>
      </td>
    </tr>

    <!-- Step 1 -->
    <tr>
      <td style="padding: 16px 48px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="40" valign="top">
              <div style="
                width: 32px; height: 32px;
                background: #654BF9;
                border-radius: 50%;
                text-align: center;
                line-height: 32px;
                color: #fff;
                font-size: 14px;
                font-weight: 700;
              ">1</div>
            </td>
            <td valign="top" style="padding-left: 12px;">
              <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #111827;">Complete Your Profile</p>
              <p style="margin: 0; font-size: 13px; color: #6B7280; line-height: 1.6;">Add your company logo and contact details in <strong>Settings → Profile</strong>. This appears on every proposal you send.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Step 2 -->
    <tr>
      <td style="padding: 14px 48px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="40" valign="top">
              <div style="
                width: 32px; height: 32px;
                background: #654BF9;
                border-radius: 50%;
                text-align: center;
                line-height: 32px;
                color: #fff;
                font-size: 14px;
                font-weight: 700;
              ">2</div>
            </td>
            <td valign="top" style="padding-left: 12px;">
              <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #111827;">Connect Stripe</p>
              <p style="margin: 0; font-size: 13px; color: #6B7280; line-height: 1.6;">Go to <strong>Settings → Integrations → Stripe</strong> to accept payments in your webstores. Takes under 3 minutes.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Step 3 -->
    <tr>
      <td style="padding: 14px 48px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="40" valign="top">
              <div style="
                width: 32px; height: 32px;
                background: #654BF9;
                border-radius: 50%;
                text-align: center;
                line-height: 32px;
                color: #fff;
                font-size: 14px;
                font-weight: 700;
              ">3</div>
            </td>
            <td valign="top" style="padding-left: 12px;">
              <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #111827;">Add Your First Client</p>
              <p style="margin: 0; font-size: 13px; color: #6B7280; line-height: 1.6;">Go to <strong>Clients → Add Client</strong>. Everything in MergeTasks — proposals, webstores, POs — is built around your client list.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Step 4 -->
    <tr>
      <td style="padding: 14px 48px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="40" valign="top">
              <div style="
                width: 32px; height: 32px;
                background: #654BF9;
                border-radius: 50%;
                text-align: center;
                line-height: 32px;
                color: #fff;
                font-size: 14px;
                font-weight: 700;
              ">4</div>
            </td>
            <td valign="top" style="padding-left: 12px;">
              <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #111827;">Send Your First Proposal</p>
              <p style="margin: 0; font-size: 13px; color: #6B7280; line-height: 1.6;">Go to <strong>Proposals → New Proposal</strong>. Select your client, add products, and send. Your client approves with one click.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- CTA button -->
    <tr>
      <td style="padding: 36px 48px 0; text-align: center;">
        <a href="${loginUrl}" style="
          display: inline-block;
          background: #654BF9;
          color: #ffffff;
          text-decoration: none;
          font-size: 15px;
          font-weight: 700;
          padding: 14px 40px;
          border-radius: 10px;
          letter-spacing: 0.2px;
        ">Go to My Dashboard →</a>
      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 36px 48px 0;">
        <div style="height: 1px; background: #E5E7EB;"></div>
      </td>
    </tr>

    <!-- What's in the box section -->
    <tr>
      <td style="padding: 32px 48px 8px;">
        <p style="
          margin: 0 0 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #654BF9;
        ">WHAT YOU HAVE ACCESS TO</p>
        <h2 style="
          margin: 0 0 8px;
          font-size: 20px;
          font-weight: 800;
          color: #111827;
          letter-spacing: -0.3px;
        ">Your complete platform</h2>
        <p style="margin: 0; font-size: 13px; color: #6B7280; line-height: 1.6;">Everything below is included in your MergeTasks account — no add-ons, no hidden tiers.</p>
      </td>
    </tr>

    <!-- Feature grid row 1 -->
    <tr>
      <td style="padding: 16px 48px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="48%" valign="top" style="
              background: #F9FAFB;
              border: 1px solid #E5E7EB;
              border-radius: 12px;
              padding: 18px 20px;
            ">
              <p style="margin: 0 0 6px; font-size: 18px;">📋</p>
              <p style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #111827;">Proposals</p>
              <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">Branded proposals your clients approve with one click. Automatic follow-up reminders included.</p>
            </td>
            <td width="4%"></td>
            <td width="48%" valign="top" style="
              background: #F9FAFB;
              border: 1px solid #E5E7EB;
              border-radius: 12px;
              padding: 18px 20px;
            ">
              <p style="margin: 0 0 6px; font-size: 18px;">🏪</p>
              <p style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #111827;">Webstores</p>
              <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">Custom company stores with SSO, department budgets, and approval workflows for enterprise clients.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Feature grid row 2 -->
    <tr>
      <td style="padding: 12px 48px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="48%" valign="top" style="
              background: #F9FAFB;
              border: 1px solid #E5E7EB;
              border-radius: 12px;
              padding: 18px 20px;
            ">
              <p style="margin: 0 0 6px; font-size: 18px;">🤖</p>
              <p style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #111827;">AI Copilot</p>
              <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">88 AI tools that can search, create, approve, and report across the entire platform in plain English.</p>
            </td>
            <td width="4%"></td>
            <td width="48%" valign="top" style="
              background: #F9FAFB;
              border: 1px solid #E5E7EB;
              border-radius: 12px;
              padding: 18px 20px;
            ">
              <p style="margin: 0 0 6px; font-size: 18px;">🎨</p>
              <p style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #111827;">Virtual Proofing</p>
              <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">AI-generated product mockups. Show clients exactly what their branded merchandise will look like.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Feature grid row 3 -->
    <tr>
      <td style="padding: 12px 48px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="48%" valign="top" style="
              background: #F9FAFB;
              border: 1px solid #E5E7EB;
              border-radius: 12px;
              padding: 18px 20px;
            ">
              <p style="margin: 0 0 6px; font-size: 18px;">📦</p>
              <p style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #111827;">Purchase Orders</p>
              <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">Generate supplier POs from approved proposals. Sync with QuickBooks automatically.</p>
            </td>
            <td width="4%"></td>
            <td width="48%" valign="top" style="
              background: #F9FAFB;
              border: 1px solid #E5E7EB;
              border-radius: 12px;
              padding: 18px 20px;
            ">
              <p style="margin: 0 0 6px; font-size: 18px;">📊</p>
              <p style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #111827;">AI Insights</p>
              <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">Predictive reorder alerts, churn signals, revenue forecasts, and margin analysis.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Guides attachment note -->
    <tr>
      <td style="padding: 32px 48px 0;">
        <div style="
          background: #F5F3FF;
          border: 1px solid #DDD6FE;
          border-radius: 12px;
          padding: 20px 24px;
        ">
          <p style="margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #111827;">📎 Your Onboarding Guides are attached</p>
          <p style="margin: 0; font-size: 13px; color: #6B7280; line-height: 1.6;">We've included four PDF guides with this email — one for each major area of the platform. Read them as you need them, or keep them handy for reference.</p>
          <table style="margin-top: 12px;" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding: 3px 0;">
                <span style="font-size: 12px; color: #654BF9; font-weight: 600;">📘 Guide 1 — Getting Started</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 3px 0;">
                <span style="font-size: 12px; color: #654BF9; font-weight: 600;">📗 Guide 2 — Proposals, Orders & Virtual Proofing</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 3px 0;">
                <span style="font-size: 12px; color: #654BF9; font-weight: 600;">📙 Guide 3 — Webstores & Client Portals</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 3px 0;">
                <span style="font-size: 12px; color: #654BF9; font-weight: 600;">📕 Guide 4 — Integrations & Connections</span>
              </td>
            </tr>
          </table>
        </div>
      </td>
    </tr>

    <!-- Support line -->
    <tr>
      <td style="padding: 28px 48px 0; text-align: center;">
        <p style="margin: 0; font-size: 13px; color: #9CA3AF; line-height: 1.6;">
          Questions? Reply to this email or reach us at
          <a href="mailto:support@mergetasks.com" style="color: #654BF9; text-decoration: none; font-weight: 600;">support@mergetasks.com</a>
        </p>
      </td>
    </tr>
  `;

  const html = emailBase({
    previewText: `Welcome, ${firstName}! Your MergeTasks account is ready. Here's how to get started.`,
    body,
  });

  return { subject, html };
}
