/**
 * MergeTasks-branded email template for notifying distributors
 * when a client accepts/submits a proposal order.
 *
 * This is a platform → distributor email, so it uses MergeTasks branding
 * (not the distributor's brand colors).
 */

interface ProposalAcceptedEmailData {
  distributorName: string;
  proposalTitle: string;
  clientName: string;
  clientCompany: string;
  clientEmail?: string;
  orderNumber: string;
  subtotal: string;
  itemCount: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: string;
    color?: string | null;
    size?: string | null;
  }>;
  paidViaStripe: boolean;
  dashboardUrl?: string;
}

export function buildProposalAcceptedEmail(data: ProposalAcceptedEmailData): { subject: string; html: string } {
  const {
    distributorName,
    proposalTitle,
    clientName,
    clientCompany,
    clientEmail,
    orderNumber,
    subtotal,
    itemCount,
    items,
    paidViaStripe,
  } = data;

  const paymentBadge = paidViaStripe
    ? `<span style="display:inline-block;background:#DCFCE7;color:#16A34A;font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;">&#10003; Paid via Stripe</span>`
    : `<span style="display:inline-block;background:#FEF3C7;color:#D97706;font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;">&#9679; Manual Payment</span>`;

  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;font-size:13px;color:#374151;">
          ${item.name}
          ${item.color ? `<br><span style="color:#9CA3AF;font-size:11px;">Color: ${item.color}</span>` : ""}
          ${item.size ? `<span style="color:#9CA3AF;font-size:11px;"> &middot; Size: ${item.size}</span>` : ""}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;font-size:13px;color:#374151;text-align:center;">${item.quantity}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;font-size:13px;color:#374151;text-align:right;">$${item.unitPrice}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;font-size:13px;color:#1A1A1A;font-weight:600;text-align:right;">$${(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}</td>
      </tr>`
    )
    .join("");

  const subject = `Proposal Accepted: "${proposalTitle}" — Order #${orderNumber}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#F3F4F6; font-family:'Albert Sans','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6; padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06);">

        <!-- Header with MergeTasks branding -->
        <tr>
          <td style="background:linear-gradient(135deg,#654BF9 0%,#8B7AFC 50%,#A594FD 100%); padding:36px 32px; text-align:center;">
            <img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/email/logo_email_white_400.png" alt="MergeTasks" width="200" height="40" style="display:block; margin:0 auto; max-width:180px; height:auto;" />
            <p style="color:rgba(255,255,255,0.9); font-size:15px; margin:14px 0 0 0; font-weight:500;">Proposal Accepted</p>
          </td>
        </tr>

        <!-- Main Content -->
        <tr>
          <td style="padding:32px 32px 8px 32px;">
            <p style="font-size:15px; line-height:1.7; color:#374151; margin:0 0 20px 0;">
              Hi ${distributorName},
            </p>
            <p style="font-size:15px; line-height:1.7; color:#374151; margin:0 0 24px 0;">
              Great news! Your proposal <strong style="color:#1A1A1A;">"${proposalTitle}"</strong> has been accepted and an order has been placed.
            </p>

            <!-- Order Summary Card -->
            <div style="background:#FAFAFA; border:1px solid #E5E7EB; border-radius:12px; padding:20px 24px; margin-bottom:24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;">
                    <p style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#9CA3AF; margin:0 0 4px 0; font-weight:600;">Order Number</p>
                    <p style="font-size:18px; font-weight:700; color:#654BF9; margin:0;">${orderNumber}</p>
                  </td>
                  <td style="padding-bottom:16px; text-align:right; vertical-align:top;">
                    ${paymentBadge}
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="border-top:1px solid #E5E7EB; padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:50%; padding-right:8px;">
                          <p style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#9CA3AF; margin:0 0 4px 0; font-weight:600;">Client</p>
                          <p style="font-size:14px; color:#1A1A1A; margin:0; font-weight:600;">${clientCompany || clientName}</p>
                          <p style="font-size:12px; color:#6B7280; margin:2px 0 0 0;">${clientName}${clientEmail ? ` &middot; ${clientEmail}` : ""}</p>
                        </td>
                        <td style="width:50%; padding-left:8px; text-align:right;">
                          <p style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#9CA3AF; margin:0 0 4px 0; font-weight:600;">Total</p>
                          <p style="font-size:22px; color:#1A1A1A; margin:0; font-weight:700;">$${subtotal}</p>
                          <p style="font-size:12px; color:#6B7280; margin:2px 0 0 0;">${itemCount} item${itemCount !== 1 ? "s" : ""}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Items Table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB; border-radius:8px; overflow:hidden; margin-bottom:24px;">
              <tr style="background:#F9FAFB;">
                <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280;font-weight:600;text-align:left;">Product</th>
                <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280;font-weight:600;text-align:center;">Qty</th>
                <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280;font-weight:600;text-align:right;">Unit</th>
                <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280;font-weight:600;text-align:right;">Total</th>
              </tr>
              ${itemRows}
              <tr style="background:#F9FAFB;">
                <td colspan="3" style="padding:12px;font-size:14px;font-weight:700;color:#1A1A1A;text-align:right;">Sub Total</td>
                <td style="padding:12px;font-size:14px;font-weight:700;color:#654BF9;text-align:right;">$${subtotal}</td>
              </tr>
            </table>

            <!-- CTA -->
            <div style="text-align:center; margin:28px 0 8px 0;">
              <p style="font-size:14px; color:#6B7280; margin:0 0 16px 0;">View and manage this order from your dashboard.</p>
              <a href="#" style="display:inline-block; background:#654BF9; color:#FFFFFF; text-decoration:none; font-size:14px; font-weight:600; padding:12px 32px; border-radius:8px;">
                Open Dashboard
              </a>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px; border-top:1px solid #F3F4F6; text-align:center;">
            <p style="font-size:12px; color:#9CA3AF; margin:0;">
              &copy; ${new Date().getFullYear()} MergeTasks &mdash; Promotional Products Platform
            </p>
            <p style="font-size:11px; color:#D1D5DB; margin:6px 0 0 0;">
              You're receiving this because a client accepted a proposal on your MergeTasks account.
            </p>
            <p style="font-size:11px; color:#9CA3AF; margin:8px 0 0 0;">
              Powered by <a href="https://mergetasks.com" style="color:#6B7280;text-decoration:none;font-weight:500;">MergeTasks</a>
            </p>
            <p style="font-size:11px; color:#9CA3AF; margin:8px 0 0 0;">
              <a href="https://mergetasks.com/unsubscribe" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe</a>
              &nbsp;&bull;&nbsp;
              <a href="https://mergetasks.com/privacy" style="color:#9CA3AF;text-decoration:underline;">Privacy</a>
              &nbsp;&bull;&nbsp;
              <a href="https://mergetasks.com/terms" style="color:#9CA3AF;text-decoration:underline;">Terms</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
