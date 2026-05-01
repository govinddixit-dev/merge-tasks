/**
 * documentBranding.ts — Shared header/footer + brand-color helpers for
 * Estimate / Invoice / PO PDF generators.
 *
 * Reads org branding from the `branding.get` tRPC query and applies it
 * consistently across all document types.
 */
import type jsPDF from "jspdf";

export type Branding = {
  brandLogoUrl: string | null;
  brandPrimaryColor: string;
  brandCompanyName: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  /**
   * Optional pre-loaded logo as a data URL. PDF generators resolve logos
   * asynchronously via `loadImageAsDataUrl(brandLogoUrl)` before drawing,
   * because jsPDF's addImage needs bytes on-hand — a raw https:// URL will
   * silently drop. Populate this to have the logo rendered in the header.
   */
  brandLogoDataUrl?: string | null;
};

/**
 * Fetch an image URL and return a base64 data URL. Returns null on any
 * failure (missing URL, CORS, non-image response, abort) — PDF generation
 * must never throw because a logo didn't load.
 */
export async function loadImageAsDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: "omit", mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Detect image format from a data URL so jsPDF.addImage gets the right type.
 * Defaults to "PNG" which is safe for most uploads.
 */
export function imageFormatFromDataUrl(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

/**
 * Convert a `#RRGGBB` hex string into [r, g, b] ints. Falls back to the
 * MergeTasks default purple if the value is invalid.
 */
export function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const fallback: [number, number, number] = [101, 75, 249]; // #654BF9
  if (!hex || typeof hex !== "string") return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Compute a brand-tinted light fill (90% toward white) for table headers.
 */
export function brandLightFill(rgb: [number, number, number]): [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * 0.9),
    Math.round(rgb[1] + (255 - rgb[1]) * 0.9),
    Math.round(rgb[2] + (255 - rgb[2]) * 0.9),
  ];
}

/**
 * Draw a rounded rectangle using bezier curves.
 * jsPDF's built-in roundedRect draws all four corners with the same radius.
 * This helper allows per-corner radii so we can achieve the pill-edge effects
 * required by the template (e.g. only bottom-left rounded on the header).
 */
export function drawRoundedRect(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  radii: { tl?: number; tr?: number; br?: number; bl?: number },
  style: "F" | "S" | "FD",
): void {
  const tl = radii.tl ?? 0;
  const tr = radii.tr ?? 0;
  const br = radii.br ?? 0;
  const bl = radii.bl ?? 0;
  // k ≈ 0.5523 is the magic number for approximating a quarter-circle with a cubic bezier
  const k = 0.5523;

  // Start at top-left, after the tl radius
  doc.lines(
    [
      // Top edge
      [w - tl - tr, 0],
      // Top-right corner
      [tr * k, 0, tr, tr - tr * k, tr, tr],
      // Right edge
      [0, h - tr - br],
      // Bottom-right corner
      [0, br * k, -(br - br * k), br, -br, br],
      // Bottom edge
      [-(w - br - bl), 0],
      // Bottom-left corner
      [-bl * k, 0, -bl, -(bl - bl * k), -bl, -bl],
      // Left edge
      [0, -(h - bl - tl)],
      // Top-left corner
      [0, -tl * k, tl - tl * k, -tl, tl, -tl],
    ],
    x + tl,
    y,
    [1, 1],
    style,
    true,
  );
}

export interface DocHeaderOptions {
  doc: jsPDF;
  title: string;        // e.g. "PURCHASE ORDER", "ESTIMATE", "INVOICE"
  branding: Branding;
}

/**
 * Draw the branded header banner with both bottom corners rounded so the
 * banner curves inward into the white body area on both edges.
 * - Full-width brand-colored banner
 * - Large bold white title on the left
 * - Logo on the top right (white background area) or company name fallback
 * Returns the y-coordinate where the body content should start.
 */
export function drawDocHeader(opts: DocHeaderOptions): number {
  const { doc, title, branding } = opts;
  const pw = doc.internal.pageSize.getWidth();
  const rgb = hexToRgb(branding.brandPrimaryColor);
  const bannerH = 38;
  const cornerR = 14;

  // Draw the full-width banner with both bottom corners rounded
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  drawRoundedRect(doc, 0, 0, pw, bannerH, { bl: cornerR, br: cornerR }, "F");

  // Title on the left — large bold white
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text(title, 20, 24);

  // Logo on the top right (overlapping the banner edge)
  const logoAreaX = pw - 55;
  const logoAreaY = 6;
  const logoMaxW = 40;
  const logoMaxH = 26;

  // Diagnostic: surface whether the async logo fetch actually produced bytes.
  // The fallback below guarantees the header is never empty even when it didn't.
  console.log(
    "[PDF header] brandLogoDataUrl:",
    branding.brandLogoDataUrl ? `present (${branding.brandLogoDataUrl.length} chars)` : "null",
    "| brandLogoUrl:", branding.brandLogoUrl,
    "| brandCompanyName:", branding.brandCompanyName,
  );

  const drawCompanyNameFallback = () => {
    const fallbackText = branding.brandCompanyName || "Distributor";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text(fallbackText, pw - 20, 24, { align: "right" });
  };

  if (branding.brandLogoDataUrl) {
    try {
      const fmt = imageFormatFromDataUrl(branding.brandLogoDataUrl);
      doc.addImage(branding.brandLogoDataUrl, fmt, logoAreaX, logoAreaY, logoMaxW, logoMaxH, undefined, "FAST");
    } catch (err) {
      console.warn("[PDF header] logo render failed, using company name fallback:", err);
      drawCompanyNameFallback();
    }
  } else {
    drawCompanyNameFallback();
  }

  return bannerH + 6;
}

export interface InfoGridOptions {
  doc: jsPDF;
  leftLabel: string;
  leftValue: string;
  leftSub?: string;
  rightLabel: string;
  rightValue: string;
  y: number;
}

/**
 * Draw the info grid (two boxes with gray background and rounded corners).
 * Returns the y after the grid.
 */
export function drawInfoGrid(opts: InfoGridOptions): number {
  const { doc, leftLabel, leftValue, leftSub, rightLabel, rightValue, y } = opts;
  const pw = doc.internal.pageSize.getWidth();
  const marginX = 20;
  const gap = 8;
  const boxW = (pw - marginX * 2 - gap) / 2;
  const boxH = 22;
  const gray = [245, 245, 247] as const;
  const ink = [26, 26, 26] as const;
  const ink2 = [100, 100, 110] as const;

  // Left box
  doc.setFillColor(gray[0], gray[1], gray[2]);
  doc.roundedRect(marginX, y, boxW, boxH, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(ink2[0], ink2[1], ink2[2]);
  doc.text(leftLabel, marginX + 6, y + 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  doc.text(leftValue, marginX + 6, y + 14);
  if (leftSub) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(ink2[0], ink2[1], ink2[2]);
    doc.text(leftSub, marginX + 6, y + 19);
  }

  // Right box
  const rx = marginX + boxW + gap;
  doc.setFillColor(gray[0], gray[1], gray[2]);
  doc.roundedRect(rx, y, boxW, boxH, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(ink2[0], ink2[1], ink2[2]);
  doc.text(rightLabel, rx + 6, y + 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  doc.text(rightValue, rx + 6, y + 14);

  return y + boxH + 8;
}

export interface AddressBlockOptions {
  doc: jsPDF;
  y: number;
  leftTitle: string;
  leftName: string;
  leftAttention?: string | null;
  leftAddress?: string | null;
  leftPhone?: string | null;
  leftEmail?: string | null;
  rightTitle: string;
  rightName: string;
  rightContact?: string | null;
  rightEmail?: string | null;
}

/**
 * Draw a two-column address block. Returns the y after the block.
 */
export function drawAddressBlock(opts: AddressBlockOptions): number {
  const { doc, leftTitle, leftName, leftAttention, leftAddress, leftPhone, leftEmail,
    rightTitle, rightName, rightContact, rightEmail } = opts;
  let y = opts.y;
  const pw = doc.internal.pageSize.getWidth();
  const marginX = 20;
  const ink = [26, 26, 26] as const;
  const ink2 = [82, 82, 82] as const;
  const ink3 = [130, 130, 140] as const;

  // Left column header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(ink3[0], ink3[1], ink3[2]);
  doc.text(leftTitle, marginX, y);

  // Right column header
  doc.text(rightTitle, pw / 2 + 10, y);
  y += 6;

  // Left column content
  let leftY = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  doc.text(leftName, marginX, leftY);
  leftY += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(ink2[0], ink2[1], ink2[2]);
  if (leftAttention) { doc.text(leftAttention, marginX, leftY); leftY += 4; }
  if (leftAddress) {
    const addrLines = doc.splitTextToSize(leftAddress, pw / 2 - 30);
    doc.text(addrLines, marginX, leftY);
    leftY += addrLines.length * 3.8;
  }
  if (leftPhone) { doc.text(leftPhone, marginX, leftY); leftY += 4; }
  if (leftEmail) { doc.text(leftEmail, marginX, leftY); leftY += 4; }

  // Right column content
  let rightY = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  doc.text(rightName, pw / 2 + 10, rightY);
  rightY += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(ink2[0], ink2[1], ink2[2]);
  if (rightContact) { doc.text(rightContact, pw / 2 + 10, rightY); rightY += 4; }
  if (rightEmail) { doc.text(rightEmail, pw / 2 + 10, rightY); rightY += 4; }

  return Math.max(leftY, rightY) + 6;
}

/**
 * Draw a full-width notes/additional info area with gray background.
 * Returns the y after the area.
 */
export function drawNotesArea(doc: jsPDF, y: number, label: string, text: string): number {
  const pw = doc.internal.pageSize.getWidth();
  const marginX = 20;
  const gray = [245, 245, 247] as const;
  const ink2 = [82, 82, 82] as const;
  const ink3 = [130, 130, 140] as const;

  const lines = doc.splitTextToSize(text, pw - marginX * 2 - 12);
  const boxH = Math.max(lines.length * 4 + 14, 20);

  doc.setFillColor(gray[0], gray[1], gray[2]);
  doc.roundedRect(marginX, y, pw - marginX * 2, boxH, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(ink3[0], ink3[1], ink3[2]);
  doc.text(label, marginX + 6, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(ink2[0], ink2[1], ink2[2]);
  doc.text(lines, marginX + 6, y + 14);

  return y + boxH + 6;
}

/**
 * Draw the branded footer bar with rounded top-left and top-right corners.
 * - Full-width brand-colored bar at the bottom of the page
 * - Distributor website centered in white (if available)
 * - "Powered by MergeTasks" in subtle text on the right
 */
export function drawDocFooter(doc: jsPDF, branding: Branding): void {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const rgb = hexToRgb(branding.brandPrimaryColor);
  const barH = 16;
  const barY = ph - barH;
  const cornerR = 10;

  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  drawRoundedRect(doc, 0, barY, pw, barH, { tl: cornerR, tr: cornerR }, "F");

  // Website centered
  if (branding.companyWebsite) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(branding.companyWebsite, pw / 2, barY + 10, { align: "center" });
  }

  // "Powered by MergeTasks" on the right — subtle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(255, 255, 255, 180);
  doc.text("Powered by MergeTasks", pw - 20, barY + 10, { align: "right" });
}
