/**
 * invoicePdfGenerator.ts — Client-side Invoice PDF using jsPDF.
 *
 * Renders a distributor-branded invoice matching the Otentik Brand PO
 * template: full-width header banner with rounded bottom-left corner,
 * info grid, two-column address block, notes area, line-item table with
 * brand-tinted header, totals block with "Amount Due", and branded footer
 * bar with rounded top corners.
 *
 * Async because the logo is loaded via fetch → data URL so jsPDF.addImage
 * can embed it directly.
 */
import jsPDF from "jspdf";
import {
  hexToRgb,
  brandLightFill,
  loadImageAsDataUrl,
  drawDocHeader,
  drawInfoGrid,
  drawAddressBlock,
  drawNotesArea,
  drawDocFooter,
  type Branding,
} from "./documentBranding";
import { computeColumnLayout } from "./estimatePdfGenerator";

interface InvoiceLineItem {
  productName: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl: string | null;
}

export interface InvoiceData {
  invoiceNumber: string;
  status: string;
  clientName?: string | null;
  clientCompany?: string | null;
  clientEmail?: string | null;
  proposalId?: number | null;
  lineItems: InvoiceLineItem[];
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  notes: string | null;
  dueDate?: string | null;
  createdAt: string;
}

export async function generateInvoicePdf(inv: InvoiceData, branding?: Branding): Promise<void> {
  const eff: Branding = branding ?? {
    brandLogoUrl: null,
    brandPrimaryColor: "#654BF9",
    brandCompanyName: null,
  };
  const logoDataUrl = eff.brandLogoDataUrl ?? (await loadImageAsDataUrl(eff.brandLogoUrl));
  await drawInvoice(inv, { ...eff, brandLogoDataUrl: logoDataUrl });
}

async function drawInvoice(inv: InvoiceData, eff: Branding): Promise<void> {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const brandRgb = hexToRgb(eff.brandPrimaryColor);
  const ink = [26, 26, 26] as const;
  const ink2 = [82, 82, 82] as const;
  const ink3 = [130, 130, 140] as const;
  const marginX = 20;

  // ── Header banner ────────────────────────────────────────────────────
  let y = drawDocHeader({ doc, title: "INVOICE", branding: eff });

  // ── Info grid: Invoice # + Payment terms | Due date ──────────────────
  const dueDateStr = inv.dueDate
    ? new Date(inv.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : new Date(inv.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  y = drawInfoGrid({
    doc, y,
    leftLabel: "INVOICE NUMBER",
    leftValue: inv.invoiceNumber,
    leftSub: "Payment terms: Due on receipt",
    rightLabel: inv.dueDate ? "DUE DATE" : "DATE",
    rightValue: dueDateStr,
  });

  // ── Two-column address block ─────────────────────────────────────────
  y = drawAddressBlock({
    doc, y,
    leftTitle: "BILL TO / SHIP TO",
    leftName: eff.brandCompanyName || "—",
    leftAddress: eff.companyAddress,
    leftPhone: eff.companyPhone,
    leftEmail: eff.companyEmail,
    rightTitle: "PREPARED FOR",
    rightName: inv.clientCompany || inv.clientName || "—",
    rightContact: inv.clientName && inv.clientCompany ? inv.clientName : null,
    rightEmail: inv.clientEmail,
  });

  // ── Notes / Additional Information ───────────────────────────────────
  if (inv.notes) {
    if (y > ph - 60) { doc.addPage(); y = 20; }
    y = drawNotesArea(doc, y, "ADDITIONAL INFORMATION", inv.notes);
  }

  // ── Line items table ─────────────────────────────────────────────────
  const colLayout = computeColumnLayout(marginX, pw - marginX);
  const lightFill = brandLightFill(brandRgb);

  // Header row
  doc.setFillColor(lightFill[0], lightFill[1], lightFill[2]);
  doc.rect(marginX, y - 4, pw - marginX * 2, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(brandRgb[0], brandRgb[1], brandRgb[2]);
  doc.text("ITEM", colLayout.item.x, y + 1);
  doc.text("COLOR", colLayout.color.x, y + 1);
  doc.text("SIZE", colLayout.size.x, y + 1);
  doc.text("QTY", colLayout.qty.x, y + 1, { align: "center" });
  doc.text("UNIT PRICE", colLayout.unit.x, y + 1, { align: "right" });
  doc.text("TOTAL", colLayout.total.x, y + 1, { align: "right" });
  y += 9;

  // Table rows with alternating shading
  doc.setFont("helvetica", "normal");
  const altFill: [number, number, number] = [249, 250, 251];

  for (let i = 0; i < inv.lineItems.length; i++) {
    const li = inv.lineItems[i];
    if (y > ph - 40) { doc.addPage(); y = 20; }

    const nameLines = doc.splitTextToSize(li.productName || "Product", colLayout.item.width);
    const rowHeight = Math.max(nameLines.length * 4.5, 8) + 3;
    if (i % 2 === 1) {
      doc.setFillColor(altFill[0], altFill[1], altFill[2]);
      doc.rect(marginX, y - 2, pw - marginX * 2, rowHeight, "F");
    }

    doc.setFontSize(9);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(nameLines, colLayout.item.x, y + 4);

    doc.setFontSize(9);
    doc.setTextColor(ink2[0], ink2[1], ink2[2]);
    doc.text(li.color || "—", colLayout.color.x, y + 4);
    doc.text(li.size || "—", colLayout.size.x, y + 4);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(String(li.quantity), colLayout.qty.x, y + 4, { align: "center" });
    doc.text(`$${(li.unitPrice || 0).toFixed(2)}`, colLayout.unit.x, y + 4, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(`$${(li.totalPrice || 0).toFixed(2)}`, colLayout.total.x, y + 4, { align: "right" });
    doc.setFont("helvetica", "normal");

    y += rowHeight;
    doc.setDrawColor(240, 240, 240);
    doc.setLineWidth(0.2);
    doc.line(marginX, y, pw - marginX, y);
    y += 1;
  }

  y += 6;

  // ── Totals block (bottom right) ──────────────────────────────────────
  const totalsRight = pw - marginX;
  const totalsLeft = totalsRight - 65;

  function totalsRow(label: string, value: string, opts?: { bold?: boolean; brand?: boolean; big?: boolean }) {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.big ? 12 : 9);
    if (opts?.brand) {
      doc.setTextColor(brandRgb[0], brandRgb[1], brandRgb[2]);
    } else if (opts?.bold) {
      doc.setTextColor(ink[0], ink[1], ink[2]);
    } else {
      doc.setTextColor(ink3[0], ink3[1], ink3[2]);
    }
    doc.text(label, totalsLeft, y);
    doc.setTextColor(opts?.brand ? brandRgb[0] : ink[0], opts?.brand ? brandRgb[1] : ink[1], opts?.brand ? brandRgb[2] : ink[2]);
    doc.text(value, totalsRight, y, { align: "right" });
  }

  totalsRow("Subtotal", `$${parseFloat(inv.subtotal || "0").toFixed(2)}`);
  y += 5;
  if (parseFloat(inv.shipping || "0") > 0) {
    totalsRow("Shipping", `$${parseFloat(inv.shipping).toFixed(2)}`);
    y += 5;
  }
  if (parseFloat(inv.tax || "0") > 0) {
    totalsRow("Tax", `$${parseFloat(inv.tax).toFixed(2)}`);
    y += 5;
  }

  doc.setDrawColor(229, 229, 229);
  doc.setLineWidth(0.4);
  doc.line(totalsLeft, y, totalsRight, y);
  y += 6;

  totalsRow("Amount Due", `$${parseFloat(inv.total || "0").toFixed(2)}`, { bold: true, brand: true, big: true });

  // ── Footer bar ───────────────────────────────────────────────────────
  drawDocFooter(doc, eff);

  doc.save(`${inv.invoiceNumber}.pdf`);
}
