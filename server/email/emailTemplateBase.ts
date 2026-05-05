/**
 * emailTemplateBase.ts
 *
 * Shared email layout wrapper used by the welcome email template.
 * Provides a full HTML document with MergeTasks branded header, body wrapper,
 * and footer — the `body` parameter is injected as <tr> rows inside the main table.
 */

const LOGO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/email/logo_email_white_400.png";

export function emailBase(opts: {
  previewText: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>MergeTasks</title>
</head>
<body style="margin:0; padding:0; background:#F3F4F6; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased;">
  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${opts.previewText}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div>
  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6; padding:40px 16px;">
    <tr><td align="center">
      <!-- Card -->
      <table width="100%" cellpadding="0" cellspacing="0"
        style="max-width:600px; background:#FFFFFF; border-radius:20px; overflow:hidden; box-shadow:0 8px 40px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#654BF9 0%,#8B7AFC 60%,#654BF9CC 100%); padding:28px 48px 24px; text-align:center;">
            <img src="${LOGO_URL}" alt="MergeTasks" width="180" height="36"
              style="display:block; margin:0 auto; max-width:180px; height:auto;" />
          </td>
        </tr>
        <!-- Body rows injected here -->
        ${opts.body}
        <!-- Divider -->
        <tr>
          <td style="padding:0 48px;">
            <div style="height:1px; background:#E5E7EB;"></div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 48px 32px; text-align:center;">
            <p style="margin:0; font-size:12px; color:#9CA3AF; line-height:1.8;">
              &copy; ${new Date().getFullYear()} MergeTasks &nbsp;&middot;&nbsp;
              <a href="https://mergetasks.com" style="color:#9CA3AF; text-decoration:none;">mergetasks.com</a>
              &nbsp;&middot;&nbsp; Built for the promo industry
            </p>
          </td>
        </tr>
      </table>
      <!-- /Card -->
    </td></tr>
  </table>
</body>
</html>`;
}
