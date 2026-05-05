/**
 * Professional branded proposal email template for MergeTasks.
 * Generates a rich HTML email with distributor branding, product list, proof images, and CTA.
 * 
 * Outlook-compatible: Uses table-based layout, explicit width/height on images,
 * bgcolor attributes, and MSO conditional comments for consistent rendering.
 */

import { formatCurrency } from "../utils/formatCurrency";

const DEFAULT_LOGO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/email/logo_email_white_400.png";

export interface ProposalEmailProduct {
  name: string;
  quantity: number;
  unitPrice: string | null;
  decorationType: string | null;
  imageUrl: string | null;
  proofImageUrl: string | null;
  proofStatus: string | null;
  /** Human label for the imprint zone (e.g. "Left Chest"). Rendered as a
   * muted secondary badge next to the decoration badge. Null when the
   * proposal line has no zone selected. */
  imprintZone?: string | null;
}

export interface ProposalEmailBranding {
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  bannerColor?: string | null;
  companyName?: string | null;
}

export interface ProposalEmailData {
  proposalTitle: string;
  clientName: string;
  clientCompany: string;
  senderName: string;
  senderCompany: string;
  estimatedValue: string;
  validDays: number;
  products: ProposalEmailProduct[];
  notes?: string;
  proposalId: number;
  proposalUrl?: string;
  branding?: ProposalEmailBranding;
  /**
   * Signed unsubscribe URL. Proposals are commercial emails under CASL so
   * a functional unsubscribe link is legally required. When omitted (e.g.
   * the live preview endpoint), the footer falls back to a neutral note.
   */
  unsubscribeUrl?: string;
}

const DECORATION_LABELS: Record<string, string> = {
  embroidery: "Embroidery",
  screen_print: "Screen Print",
  laser_engraving: "Laser Engraving",
  heat_transfer: "Heat Transfer",
  dtg: "DTG Print",
  sublimation: "Sublimation",
  deboss: "Deboss",
  patch: "Patch",
};

function buildProductRow(product: ProposalEmailProduct, index: number, primaryColor: string): string {
  const bgColor = index % 2 === 0 ? "#FFFFFF" : "#FAFAFA";
  
  const imageCell = product.proofImageUrl
    ? `<img src="${product.proofImageUrl}" alt="${product.name} proof" width="70" height="70" border="0" style="display:block;width:70px;height:70px;border:1px solid #E5E7EB;outline:none;-ms-interpolation-mode:bicubic;" />`
    : product.imageUrl
    ? `<img src="${product.imageUrl}" alt="${product.name}" width="70" height="70" border="0" style="display:block;width:70px;height:70px;border:1px solid #E5E7EB;outline:none;-ms-interpolation-mode:bicubic;" />`
    : `<table width="70" height="70" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F3F4F6" align="center" valign="middle" style="width:70px;height:70px;font-size:24px;">&#128230;</td></tr></table>`;

  const decorationBadge = product.decorationType
    ? `<br/><span style="display:inline-block;padding:2px 8px;background-color:#EEF2FF;color:#4338CA;font-size:11px;font-weight:600;margin-top:4px;">${DECORATION_LABELS[product.decorationType] || product.decorationType}</span>`
    : "";

  const zoneBadge = product.imprintZone
    ? `<span style="display:inline-block;padding:2px 8px;background-color:#F3F4F6;color:#4B5563;font-size:11px;font-weight:600;margin-left:4px;">${product.imprintZone}</span>`
    : "";

  const proofBadge = product.proofStatus === "approved"
    ? `<span style="display:inline-block;padding:2px 8px;background-color:#DCFCE7;color:#166534;font-size:10px;font-weight:600;margin-left:4px;">&#10003; Proof Approved</span>`
    : "";

  return `
    <tr>
      <td bgcolor="${bgColor}" style="padding:12px 16px;vertical-align:middle;width:86px;" valign="middle">
        ${imageCell}
      </td>
      <td bgcolor="${bgColor}" style="padding:12px 16px;vertical-align:middle;" valign="middle">
        <span style="font-size:14px;font-weight:600;color:#1F2937;">${product.name}</span>
        ${decorationBadge}${zoneBadge}${proofBadge}
      </td>
      <td bgcolor="${bgColor}" style="padding:12px 16px;vertical-align:middle;text-align:center;" valign="middle" align="center">
        <span style="font-size:14px;color:#4B5563;font-weight:500;">${product.quantity}</span>
      </td>
      <td bgcolor="${bgColor}" style="padding:12px 16px;vertical-align:middle;text-align:right;" valign="middle" align="right">
        <span style="font-size:14px;color:#1F2937;font-weight:600;">${formatCurrency(product.unitPrice)}</span>
      </td>
    </tr>`;
}

export function buildProposalEmail(data: ProposalEmailData): { subject: string; html: string } {
  const primaryColor = data.branding?.primaryColor || "#654BF9";
  const bannerColor = data.branding?.bannerColor || data.branding?.primaryColor || "#654BF9";
  const brandName = data.branding?.companyName || data.senderCompany || "Your Distributor";
  const logoUrl = data.branding?.logoUrl || DEFAULT_LOGO_URL;
  const hasCustomBranding = !!(data.branding?.logoUrl || data.branding?.companyName);

  const subject = `Proposal: ${data.proposalTitle} — from ${brandName}`;

  const productRows = data.products.map((p, i) => buildProductRow(p, i, primaryColor)).join("");
  const approvedCount = data.products.filter(p => p.proofStatus === "approved").length;
  const hasProofs = approvedCount > 0;

  // CTA button — using VML for Outlook rounded button support
  const ctaUrl = data.proposalUrl || `mailto:?subject=Re: ${encodeURIComponent(data.proposalTitle)}`;
  const ctaText = data.proposalUrl ? "View Full Proposal" : "Reply to This Proposal";
  
  const ctaButton = `
    <table cellpadding="0" cellspacing="0" border="0" align="center">
      <tr>
        <td align="center" bgcolor="${primaryColor}" style="padding:14px 40px;background-color:${primaryColor};">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${ctaUrl}" style="height:48px;v-text-anchor:middle;width:250px;" arcsize="17%" strokecolor="${primaryColor}" fillcolor="${primaryColor}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:'Albert Sans',Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;">${ctaText}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${ctaUrl}" style="display:inline-block;background-color:${primaryColor};color:#FFFFFF;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:700;font-family:'Albert Sans',Helvetica,Arial,sans-serif;letter-spacing:0.3px;">${ctaText}</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>`;

  const proofSection = hasProofs ? `
        <tr>
          <td style="padding:0 32px 16px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#DCFCE7" style="padding:12px 16px;text-align:center;background-color:#DCFCE7;border:1px solid #BBF7D0;" align="center">
                  <span style="font-size:13px;color:#166534;font-weight:600;">&#10024; ${approvedCount} product${approvedCount !== 1 ? "s" : ""} include${approvedCount === 1 ? "s" : ""} AI-generated proof mockups showing your branding</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : "";

  const notesSection = data.notes ? `
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#FFFBEB" style="padding:14px 16px;background-color:#FFFBEB;border:1px solid #FDE68A;">
                  <span style="font-size:12px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.5px;">Notes</span><br/>
                  <span style="font-size:13px;color:#78350F;line-height:1.5;">${data.notes}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : "";

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <title>${data.proposalTitle}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; }
      .fluid { max-width: 100% !important; height: auto !important; }
      .stack-column { display: block !important; width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:'Albert Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;" bgcolor="#F3F4F6">

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F6" style="background-color:#F3F4F6;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!--[if mso]>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center"><tr><td>
        <![endif]-->

        <!-- Email container -->
        <table role="presentation" class="email-container" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:600px;background-color:#FFFFFF;">

          <!--  HEADER / BANNER  -->
          <tr>
            <td bgcolor="${bannerColor}" style="background-color:${bannerColor};padding:28px 32px 24px 32px;text-align:center;" align="center">
              <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="200"><tr><td align="center"><![endif]-->
              <img src="${logoUrl}" alt="${brandName}" width="200" border="0" style="display:block;margin:0 auto;width:200px;max-width:200px;height:auto;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
              <!--[if mso]></td></tr></table><![endif]-->
              <p style="color:rgba(255,255,255,0.85);font-size:13px;margin:12px 0 0 0;font-weight:400;letter-spacing:0.5px;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">PROMOTIONAL PRODUCTS PROPOSAL</p>
            </td>
          </tr>

          <!--  GREETING  -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <p style="font-size:16px;line-height:1.6;color:#374151;margin:0 0 8px 0;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">
                Hi ${data.clientName || "there"},
              </p>
              <p style="font-size:14px;line-height:1.7;color:#6B7280;margin:0 0 24px 0;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">
                We've put together a customized promotional products proposal for <strong style="color:#374151;">${data.clientCompany}</strong>. 
                Below you'll find the curated selection${hasProofs ? " with AI-generated product mockups showing exactly how your branding will look" : ""}.
              </p>
            </td>
          </tr>

          <!--  PROPOSAL SUMMARY CARD  -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F3FF" style="background-color:#F5F3FF;">
                <tr>
                  <td style="padding:20px 24px;">
                    <!-- Title row -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:top;" valign="top">
                          <p style="margin:0 0 4px 0;font-size:18px;font-weight:700;color:${primaryColor};font-family:'Albert Sans',Helvetica,Arial,sans-serif;">${data.proposalTitle}</p>
                          <p style="margin:0;font-size:13px;color:#6B7280;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">Prepared by ${data.senderName || "Your Account Manager"} at ${brandName}</p>
                        </td>
                      </tr>
                    </table>
                    <!-- Stats row -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                      <tr>
                        <td width="33%" align="center" style="text-align:center;padding:8px;" valign="top">
                          <p style="margin:0;font-size:22px;font-weight:800;color:${primaryColor};font-family:'Albert Sans',Helvetica,Arial,sans-serif;">$${data.estimatedValue}</p>
                          <p style="margin:4px 0 0 0;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">Estimated Value</p>
                        </td>
                        <td width="1" bgcolor="#E0D4FD" style="width:1px;background-color:#E0D4FD;"></td>
                        <td width="33%" align="center" style="text-align:center;padding:8px;" valign="top">
                          <p style="margin:0;font-size:22px;font-weight:800;color:${primaryColor};font-family:'Albert Sans',Helvetica,Arial,sans-serif;">${data.products.length}</p>
                          <p style="margin:4px 0 0 0;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">Products</p>
                        </td>
                        <td width="1" bgcolor="#E0D4FD" style="width:1px;background-color:#E0D4FD;"></td>
                        <td width="33%" align="center" style="text-align:center;padding:8px;" valign="top">
                          <p style="margin:0;font-size:22px;font-weight:800;color:${primaryColor};font-family:'Albert Sans',Helvetica,Arial,sans-serif;">${data.validDays === 0 ? "\u221E" : data.validDays}</p>
                          <p style="margin:4px 0 0 0;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">${data.validDays === 0 ? "No Expiration" : "Days Valid"}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${proofSection}

          <!--  PRODUCT TABLE  -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E5E7EB;">
                <!-- Table Header -->
                <tr>
                  <td bgcolor="#F9FAFB" style="padding:10px 16px;font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;width:86px;background-color:#F9FAFB;">Image</td>
                  <td bgcolor="#F9FAFB" style="padding:10px 16px;font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;background-color:#F9FAFB;">Product</td>
                  <td bgcolor="#F9FAFB" style="padding:10px 16px;font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;text-align:center;background-color:#F9FAFB;" align="center">Qty</td>
                  <td bgcolor="#F9FAFB" style="padding:10px 16px;font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;background-color:#F9FAFB;" align="right">Price</td>
                </tr>
                ${productRows}
              </table>
            </td>
          </tr>

          ${notesSection}

          <!--  CTA  -->
          <tr>
            <td style="padding:0 32px 24px 32px;text-align:center;" align="center">
              <p style="font-size:14px;color:#6B7280;margin:0 0 16px 0;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">
                ${data.proposalUrl 
                  ? "Click below to view the full proposal with product details and place your order."
                  : "Interested in moving forward? Simply reply to this email or contact your account manager."}
              </p>
              ${ctaButton}
              ${data.proposalUrl ? `<p style="font-size:12px;color:#9CA3AF;margin:12px 0 0 0;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">Or reply directly to this email to discuss with your account manager.</p>` : ""}
            </td>
          </tr>

          <!--  VALIDITY NOTICE  -->
          <tr>
            <td style="padding:0 32px 24px 32px;text-align:center;" align="center">
              <p style="font-size:12px;color:#9CA3AF;margin:0;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">
                ${data.validDays === 0
                  ? "This proposal has <strong>no expiration date</strong>. Pricing and availability are subject to change."
                  : `This proposal is valid for <strong>${data.validDays} days</strong> from the date of this email. Pricing and availability are subject to change.`
                }
              </p>
            </td>
          </tr>

          <!--  FOOTER  -->
          <tr>
            <td bgcolor="#FAFAFA" style="padding:20px 32px;border-top:1px solid #F3F4F6;text-align:center;background-color:#FAFAFA;" align="center">
              <p style="font-size:12px;color:#9CA3AF;margin:0;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">
                &copy; ${new Date().getFullYear()} ${brandName}
              </p>
              <p style="font-size:11px;color:#D1D5DB;margin:6px 0 0 0;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">
                Sent via ${brandName} &bull; Powered by <a href="https://mergetasks.com" style="color:#6B7280;text-decoration:none;font-weight:500;">MergeTasks</a>
              </p>
              <p style="font-size:11px;color:#9CA3AF;margin:8px 0 0 0;font-family:'Albert Sans',Helvetica,Arial,sans-serif;">
                ${data.unsubscribeUrl ? `<a href="${data.unsubscribeUrl}" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe</a>
                &nbsp;&bull;&nbsp;` : ""}
                <a href="https://mergetasks.com/privacy" style="color:#9CA3AF;text-decoration:underline;">Privacy</a>
                &nbsp;&bull;&nbsp;
                <a href="https://mergetasks.com/terms" style="color:#9CA3AF;text-decoration:underline;">Terms</a>
              </p>
            </td>
          </tr>

        </table>
        <!-- /Email container -->

        <!--[if mso]>
        </td></tr></table>
        <![endif]-->

      </td>
    </tr>
  </table>

</body>
</html>`;

  return { subject, html };
}
