/**
 * emailTemplateBase.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Core of the three-lane branded HTML email system.
 *
 * Exports:
 *   - MT                   — MergeTasks brand constants (Lane 1)
 *   - EmailProductCard     — product card data type
 *   - EmailBranding        — per-lane branding context
 *   - BuildEmailOptions    — options for the generic builder
 *   - buildEmailHtml()     — generic email layout engine
 *   - formatCurrency()     — USD formatter (used by domain modules)
 *   - lightenHex()         — color utility (used by domain modules)
 *   - renderProductCard()  — product row HTML fragment
 *   - renderAlertBox()     — alert box HTML fragment
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { formatCurrency as _fc } from "../../utils/formatCurrency";
/** Re-export for consumers that import from this module */
export const formatCurrency = _fc;


// ─── MergeTasks brand constants (Lane 1) ─────────────────────────────────────
export const MT = {
  purple:       "#654BF9",
  purpleLight:  "#8B7AFC",
  purpleDark:   "#4C35D9",
  purpleGhost:  "#F5F3FF",
  purpleBorder: "#DDD6FE",
  green:        "#059669",
  greenLight:   "#ECFDF5",
  greenDark:    "#065F46",
  amber:        "#D97706",
  amberLight:   "#FFFBEB",
  red:          "#DC2626",
  redLight:     "#FEF2F2",
  gray50:       "#F9FAFB",
  gray100:      "#F3F4F6",
  gray200:      "#E5E7EB",
  gray400:      "#9CA3AF",
  gray500:      "#6B7280",
  gray700:      "#374151",
  gray900:      "#111827",
  white:        "#FFFFFF",
  logoUrl:      "https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/email/logo_email_white_400.png",
  name:         "MergeTasks",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailProductCard {
  name: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  imageUrl?: string;
  sku?: string;
}

/**
 * Branding context passed to every email builder.
 *
 * - Lane 1 (MT→Distributor): leave undefined — defaults to MergeTasks brand
 * - Lane 2 (Distributor→Client): pass distributor's logo, color, company name
 * - Lane 3 (Store→Client): pass store's logo, primaryColor, store name
 */
export interface EmailBranding {
  /** Display name shown in the header pill and footer (e.g. "Acme Distributing") */
  companyName?: string;
  /** Hex color for header gradient and CTA buttons */
  primaryColor?: string;
  /** URL to the company/store logo (white or light version preferred) */
  logoUrl?: string;
  /** Optional secondary/accent color */
  secondaryColor?: string;
  /**
   * Lane identifier — controls footer copy.
   * "mergetasks" = Lane 1 (default)
   * "distributor" = Lane 2
   * "store"       = Lane 3
   */
  lane?: "mergetasks" | "distributor" | "store";
}

export interface BuildEmailOptions {
  /** Short badge text shown above the headline, e.g. "Proposal Approved" */
  badge?: { text: string; color?: string; bgColor?: string };
  /** Large headline */
  headline: string;
  /** Sub-headline shown below the headline in lighter text */
  subheadline?: string;
  /** Main body paragraphs — each string is a separate <p> */
  bodyParagraphs: string[];
  /** Highlighted info card (e.g. proposal name, order number) */
  infoCard?: {
    title: string;
    subtitle?: string;
    meta?: Array<{ label: string; value: string }>;
    accentColor?: string;
    bgColor?: string;
  };
  /** Product cards to render */
  products?: EmailProductCard[];
  /** Primary CTA button */
  cta?: { label: string; url: string; color?: string };
  /** Secondary smaller link */
  secondaryLink?: { label: string; url: string };
  /** Alert box (e.g. warning, notes) */
  alertBox?: { text: string; type: "info" | "warning" | "success" | "error" };
  /** Footer note below the standard footer */
  footerNote?: string;
  /** Branding context — determines which lane's visual identity to use */
  branding?: EmailBranding;
  /**
   * Signed unsubscribe URL for commercial emails. When set, the footer
   * renders an Unsubscribe link pointing here. When undefined, the footer
   * renders "This is a transactional email related to your account."
   * instead — transactional emails must not offer an unsubscribe path.
   */
  unsubscribeUrl?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lighten a hex color for gradient end stop */
export function lightenHex(hex: string, amount = 40): string {
  const h = hex.replace("#", "");
  const r = Math.min(255, parseInt(h.slice(0, 2), 16) + amount);
  const g = Math.min(255, parseInt(h.slice(2, 4), 16) + amount);
  const b = Math.min(255, parseInt(h.slice(4, 6), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Render a single product card row */
export function renderProductCard(p: EmailProductCard): string {
  const price = p.unitPrice != null ? formatCurrency(p.unitPrice) : null;
  const qty = p.quantity != null ? `Qty: ${p.quantity}` : null;
  const lineTotal =
    p.unitPrice != null && p.quantity != null
      ? formatCurrency(p.unitPrice * p.quantity)
      : null;
  return `
  <tr>
    <td style="padding:12px 0; border-bottom:1px solid ${MT.gray200};">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${p.imageUrl ? `
          <td style="width:56px; vertical-align:top; padding-right:12px;">
            <img src="${p.imageUrl}" alt="${p.name}" width="56" height="56"
              style="border-radius:8px; object-fit:cover; display:block; border:1px solid ${MT.gray200};" />
          </td>` : ""}
          <td style="vertical-align:top;">
            <p style="margin:0; font-size:14px; font-weight:600; color:${MT.gray900};">${p.name}</p>
            ${p.sku ? `<p style="margin:2px 0 0; font-size:12px; color:${MT.gray400};">SKU: ${p.sku}</p>` : ""}
            ${p.description ? `<p style="margin:4px 0 0; font-size:12px; color:${MT.gray500}; line-height:1.5;">${p.description}</p>` : ""}
            <p style="margin:6px 0 0; font-size:12px; color:${MT.gray500};">
              ${[qty, price ? `${price} each` : null].filter(Boolean).join(" &nbsp;·&nbsp; ")}
            </p>
          </td>
          ${lineTotal ? `
          <td style="vertical-align:top; text-align:right; white-space:nowrap;">
            <p style="margin:0; font-size:14px; font-weight:700; color:${MT.gray900};">${lineTotal}</p>
          </td>` : ""}
        </tr>
      </table>
    </td>
  </tr>`;
}

/** Render an alert box */
export function renderAlertBox(
  alert: NonNullable<BuildEmailOptions["alertBox"]>,
  accentColor: string
): string {
  const colors = {
    info:    { bg: MT.purpleGhost, border: accentColor, text: MT.purpleDark },
    success: { bg: MT.greenLight,  border: MT.green,    text: MT.greenDark },
    warning: { bg: MT.amberLight,  border: MT.amber,    text: "#92400E" },
    error:   { bg: MT.redLight,    border: MT.red,      text: "#991B1B" },
  }[alert.type];

  const borderColor = alert.type === "info" ? accentColor : colors.border;

  return `
  <tr>
    <td style="padding:0 0 20px 0;">
      <div style="background:${colors.bg}; border-left:4px solid ${borderColor}; border-radius:8px; padding:14px 16px;">
        <p style="margin:0; font-size:13px; color:${colors.text}; line-height:1.6;">${alert.text}</p>
      </div>
    </td>
  </tr>`;
}

// ─── Generic email layout engine ──────────────────────────────────────────────

export function buildEmailHtml(opts: BuildEmailOptions): string {
  const branding = opts.branding;
  const lane = branding?.lane || "mergetasks";

  const primaryColor = branding?.primaryColor || MT.purple;
  const lightColor   = lightenHex(primaryColor, 35);
  const companyName  = branding?.companyName  || MT.name;
  const logoUrl      = branding?.logoUrl       || MT.logoUrl;
  const year         = new Date().getFullYear();

  const headerGradient = `linear-gradient(135deg,${primaryColor} 0%,${lightColor} 60%,${primaryColor}CC 100%)`;

  const footerCopy =
    lane === "mergetasks"
      ? `&copy; ${year} MergeTasks &mdash; Promotional Products Platform`
      : `&copy; ${year} ${companyName}`;

  const poweredBy =
    lane === "mergetasks"
      ? `<br /><span style="font-size:11px; color:${MT.gray400};">Powered by <a href="https://mergetasks.com" style="color:${MT.gray500};text-decoration:none;font-weight:500;">MergeTasks</a></span>`
      : `<br /><span style="font-size:11px; color:${MT.gray400};">Powered by <a href="https://mergetasks.com" style="color:${MT.gray500};text-decoration:none;font-weight:500;">MergeTasks</a></span>`;

  const badgeHtml = opts.badge
    ? `
  <tr>
    <td style="padding:0 0 12px 0; text-align:center;">
      <span style="display:inline-block; background:${opts.badge.bgColor || MT.purpleGhost}; color:${opts.badge.color || primaryColor}; font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; padding:4px 12px; border-radius:100px; border:1px solid ${opts.badge.color || primaryColor}33;">
        ${opts.badge.text}
      </span>
    </td>
  </tr>`
    : "";

  const infoCardHtml = opts.infoCard
    ? (() => {
        const c = opts.infoCard;
        const accent = c.accentColor || primaryColor;
        const bg = c.bgColor || MT.purpleGhost;
        const metaRows = (c.meta || [])
          .map(
            (m) => `
      <tr>
        <td style="padding:4px 0; font-size:12px; color:${MT.gray500}; width:40%;">${m.label}</td>
        <td style="padding:4px 0; font-size:12px; color:${MT.gray700}; font-weight:600;">${m.value}</td>
      </tr>`
          )
          .join("");
        return `
  <tr>
    <td style="padding:0 0 20px 0;">
      <div style="background:${bg}; border-radius:12px; padding:18px 20px; border:1px solid ${accent}22;">
        <p style="margin:0; font-size:16px; font-weight:700; color:${accent};">${c.title}</p>
        ${c.subtitle ? `<p style="margin:4px 0 0; font-size:13px; color:${MT.gray500};">${c.subtitle}</p>` : ""}
        ${metaRows ? `<table style="width:100%; margin-top:12px; border-collapse:collapse;">${metaRows}</table>` : ""}
      </div>
    </td>
  </tr>`;
      })()
    : "";

  const productsHtml =
    opts.products && opts.products.length > 0
      ? `
  <tr>
    <td style="padding:0 0 20px 0;">
      <p style="margin:0 0 10px; font-size:13px; font-weight:600; color:${MT.gray700}; text-transform:uppercase; letter-spacing:0.05em;">Products</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${MT.gray200};">
        ${opts.products.map(renderProductCard).join("")}
      </table>
    </td>
  </tr>`
      : "";

  const ctaHtml = opts.cta
    ? `
  <tr>
    <td style="padding:8px 0 24px; text-align:center;">
      <a href="${opts.cta.url}"
        style="display:inline-block; background:${opts.cta.color || primaryColor}; color:#FFFFFF; font-size:15px; font-weight:700; text-decoration:none; padding:14px 40px; border-radius:10px; letter-spacing:0.01em;">
        ${opts.cta.label}
      </a>
    </td>
  </tr>`
    : "";

  const secondaryLinkHtml = opts.secondaryLink
    ? `
  <tr>
    <td style="padding:0 0 16px; text-align:center;">
      <a href="${opts.secondaryLink.url}" style="font-size:13px; color:${MT.gray400}; text-decoration:underline;">${opts.secondaryLink.label}</a>
    </td>
  </tr>`
    : "";

  const alertHtml = opts.alertBox ? renderAlertBox(opts.alertBox, primaryColor) : "";

  const bodyHtml = opts.bodyParagraphs
    .map(
      (p) =>
        `<tr><td style="padding:0 0 14px 0;"><p style="margin:0; font-size:15px; line-height:1.75; color:${MT.gray700};">${p}</p></td></tr>`
    )
    .join("");

  const subheadlineHtml = opts.subheadline
    ? `
  <tr>
    <td style="padding:0 0 20px 0; text-align:center;">
      <p style="margin:0; font-size:14px; color:${MT.gray400}; line-height:1.6;">${opts.subheadline}</p>
    </td>
  </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${opts.headline}</title>
</head>
<body style="margin:0; padding:0; background:${MT.gray100}; font-family:'Albert Sans','Helvetica Neue',Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${MT.gray100}; padding:40px 16px;">
    <tr><td align="center">

      <!-- Card -->
      <table width="100%" cellpadding="0" cellspacing="0"
        style="max-width:560px; background:${MT.white}; border-radius:20px; overflow:hidden; box-shadow:0 8px 40px rgba(0,0,0,0.08);">

        <!--  Header  -->
        <tr>
          <td style="background:${headerGradient}; padding:32px 32px 28px; text-align:center;">
            ${logoUrl
              ? `<img src="${logoUrl}" alt="${companyName}" width="180" height="36"
                  style="display:block; margin:0 auto; max-width:180px; height:auto;" />`
              : `<p style="margin:0; font-size:22px; font-weight:800; color:#FFFFFF; letter-spacing:-0.02em;">${companyName}</p>`
            }
            <div style="margin-top:20px;">
              <span style="display:inline-block; background:rgba(255,255,255,0.18); border-radius:100px; padding:4px 14px; font-size:11px; font-weight:600; color:rgba(255,255,255,0.9); letter-spacing:0.08em; text-transform:uppercase;">${companyName}</span>
            </div>
          </td>
        </tr>

        <!--  Headline block  -->
        <tr>
          <td style="padding:32px 36px 8px; text-align:center;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${badgeHtml}
              <tr>
                <td style="padding:0 0 8px; text-align:center;">
                  <h1 style="margin:0; font-size:24px; font-weight:800; color:${MT.gray900}; line-height:1.25;">${opts.headline}</h1>
                </td>
              </tr>
              ${subheadlineHtml}
            </table>
          </td>
        </tr>

        <!--  Body  -->
        <tr>
          <td style="padding:16px 36px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${bodyHtml}
              ${alertHtml}
              ${infoCardHtml}
              ${productsHtml}
              ${ctaHtml}
              ${secondaryLinkHtml}
            </table>
          </td>
        </tr>

        <!--  Divider  -->
        <tr>
          <td style="padding:0 36px;">
            <div style="height:1px; background:${MT.gray200};"></div>
          </td>
        </tr>

        <!--  Footer  -->
        <tr>
          <td style="padding:24px 36px; text-align:center;">
            <p style="margin:0; font-size:12px; color:${MT.gray400}; line-height:1.8;">
              ${footerCopy}${poweredBy}
            </p>
            <p style="margin:8px 0 0; font-size:11px; color:${MT.gray400}; line-height:1.6;">
              <a href="https://mergetasks.com/legal/privacy" style="color:${MT.gray500};text-decoration:none;">Privacy</a>
              &nbsp;&middot;&nbsp;
              <a href="https://mergetasks.com/legal/terms" style="color:${MT.gray500};text-decoration:none;">Terms</a>
              ${opts.unsubscribeUrl ? `
              &nbsp;&middot;&nbsp;
              <a href="${opts.unsubscribeUrl}" style="color:${MT.gray500};text-decoration:none;">Unsubscribe</a>` : ""}
            </p>
            ${opts.unsubscribeUrl ? "" : `
            <p style="margin:8px 0 0; font-size:11px; color:${MT.gray400}; line-height:1.5; font-style:italic;">
              This is a transactional email related to your account.
            </p>`}
            ${opts.footerNote ? `<p style="margin:10px 0 0; font-size:11px; color:${MT.gray400}; line-height:1.5;">${opts.footerNote}</p>` : ""}
          </td>
        </tr>

      </table>
      <!-- /Card -->

    </td></tr>
  </table>
  <!-- /Outer wrapper -->

</body>
</html>`;
}

// ─── Dedicated OTP / 2FA Email Layout ────────────────────────────────────────
/**
 * Premium OTP email — dark navy header with MergeTasks logo,
 * clean white body, large bold verification code front and center.
 * Apple-for-enterprise aesthetic: precise, minimal, trustworthy.
 */
export function buildOtpEmailHtml(opts: {
  code: string;
  headline: string;
  greeting: string;
  bodyText: string;
  expiryMinutes?: number;
  securityNote?: string;
  branding?: EmailBranding;
}): string {
  const primaryColor = opts.branding?.primaryColor || MT.purple;
  const companyName  = opts.branding?.companyName  || MT.name;
  const logoUrl      = opts.branding?.logoUrl       || MT.logoUrl;
  const expiry       = opts.expiryMinutes ?? 10;
  const year         = new Date().getFullYear();
  const isStoreLane  = opts.branding?.lane === "store";

  // Header: deep navy for MT brand, primary gradient for store lane
  const headerBg = isStoreLane
    ? `background:${primaryColor};`
    : `background:linear-gradient(135deg,#1C1C2E 0%,#2D2B55 60%,#1C1C2E 100%);`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${opts.headline}</title>
</head>
<body style="margin:0;padding:0;background:#F4F4F7;font-family:'Albert Sans','Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Albert Sans preferred; gracefully falls back on mail clients that strip web fonts. Color token #654BF9 (MT purple) applied via branding.primaryColor. -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F7;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
        style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Dark header with logo -->
        <tr>
          <td style="${headerBg}padding:36px 40px 32px;text-align:center;">
            ${logoUrl
              ? `<img src="${logoUrl}" alt="${companyName}" width="160" height="32"
                  style="display:block;margin:0 auto;max-width:160px;height:auto;" />`
              : `<p style="margin:0;font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;">${companyName}</p>`
            }
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding:36px 44px 8px;text-align:left;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;letter-spacing:-0.01em;">${opts.headline}</h1>
          </td>
        </tr>

        <!-- Greeting + body -->
        <tr>
          <td style="padding:16px 44px 0;">
            <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#374151;">${opts.greeting}</p>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">${opts.bodyText}</p>
          </td>
        </tr>

        <!-- OTP Code block -->
        <tr>
          <td style="padding:28px 44px 24px;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.08em;">Verification Code</p>
            <div style="background:#F9FAFB;border:1.5px solid #E5E7EB;border-radius:12px;padding:24px 20px;text-align:center;">
              <span style="font-size:44px;font-weight:800;color:#111827;letter-spacing:0.18em;font-variant-numeric:tabular-nums;">${opts.code}</span>
            </div>
            <p style="margin:10px 0 0;font-size:12px;color:#9CA3AF;text-align:center;">(This code will expire in ${expiry} minutes)</p>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 44px;">
            <div style="height:1px;background:#F0F0F0;"></div>
          </td>
        </tr>

        <!-- Security note -->
        <tr>
          <td style="padding:20px 44px 32px;">
            <p style="margin:0;font-size:13px;line-height:1.7;color:#9CA3AF;">
              ${opts.securityNote || "If you did not request this code, you can safely ignore this email. Do not share this code with anyone."}
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F9FAFB;padding:20px 44px;text-align:center;border-top:1px solid #F0F0F0;">
            <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;">
              &copy; ${year} ${companyName}. All rights reserved.
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#9CA3AF;line-height:1.6;">
              <a href="https://mergetasks.com/legal/privacy" style="color:#6B7280;text-decoration:none;">Privacy</a>
              &nbsp;&middot;&nbsp;
              <a href="https://mergetasks.com/legal/terms" style="color:#6B7280;text-decoration:none;">Terms</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

