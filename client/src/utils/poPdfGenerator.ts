/**
 * poPdfGenerator.ts — Client-side PO PDF generation using jsPDF.
 *
 * Renders a distributor-branded purchase order matching the Otentik Brand
 * PO template: full-width header banner with rounded bottom-left corner,
 * info grid, two-column address block, notes area, line-item table with
 * brand-tinted header, totals block, and branded footer bar with rounded
 * top corners.
 *
 * Shows COST prices only — never includes sell prices or margin data.
 * The supplier must never see the markup.
 *
 * Now async to support logo loading via fetch → data URL.
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

interface POLineItem {
  productName: string;
  supplierSku: string | null;
  quantity: number;
  costPrice: number;
  totalCost: number;
  quantityReceived?: number;
  decorationType: string | null;
  decorationLocation: string | null;
  color: string | null;
  size: string | null;
  notes: string | null;
}

interface POData {
  poNumber: string;
  status: string;
  supplierName: string;
  supplierCode: string | null;
  supplierSource: string | null;
  supplierContactEmail: string | null;
  supplierContactPhone: string | null;
  supplierAccountNumber: string | null;
  lineItems: POLineItem[];
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  shipToName: string | null;
  shipToAddress: string | null;
  shipToType: string | null;
  requestedShipDate: string | null;
  decorationInstructions: string | null;
  supplierNotes: string | null;
  createdAt: string;
  orderNumber?: string | null;
  /** Distributor company name — shown as the "from" on the PO */
  companyName?: string;
}

/**
 * Generate and download a PO PDF. Pass `branding` (from `branding.get`)
 * so the header/footer/table use the org's primary brand color and logo.
 */
export async function generatePOPdf(po: POData, branding?: Branding): Promise<void> {
  const eff: Branding = branding ?? {
    brandLogoUrl: null,
    brandPrimaryColor: "#654BF9",
    brandCompanyName: po.companyName ?? null,
  };
  const logoDataUrl = eff.brandLogoDataUrl ?? (await loadImageAsDataUrl(eff.brandLogoUrl));
  await drawPO(po, { ...eff, brandLogoDataUrl: logoDataUrl });
}

async function drawPO(po: POData, eff: Branding): Promise<void> {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const brandRgb = hexToRgb(eff.brandPrimaryColor);
  const ink = [26, 26, 26] as const;
  const ink2 = [82, 82, 82] as const;
  const ink3 = [130, 130, 140] as const;
  const marginX = 20;

  // ── Header banner ────────────────────────────────────────────────────
  let y = drawDocHeader({ doc, title: "PURCHASE ORDER", branding: eff });

  // ── Info grid: PO # + Payment terms | Date ───────────────────────────
  const dateStr = new Date(po.createdAt).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  y = drawInfoGrid({
    doc, y,
    leftLabel: "PO NUMBER",
    leftValue: po.poNumber,
    leftSub: "Payment terms: Net 30",
    rightLabel: "DATE",
    rightValue: dateStr,
  });

  // ── Two-column address block ─────────────────────────────────────────
  // Resolve the supplier label from the PO header, falling back to the
  // supplier code when only a code was captured. "Unassigned" / blank
  // means the upstream proposal items had no supplier metadata.
  const supplierLabel = (() => {
    const name = (po.supplierName || "").trim();
    if (name && name.toLowerCase() !== "unassigned") return name;
    if (po.supplierCode) return po.supplierCode;
    return name || "—";
  })();
  y = drawAddressBlock({
    doc, y,
    leftTitle: "BILL TO / SHIP TO",
    leftName: eff.brandCompanyName || po.companyName || "—",
    leftAttention: po.shipToName,
    leftAddress: po.shipToAddress || eff.companyAddress,
    leftPhone: eff.companyPhone,
    leftEmail: eff.companyEmail,
    rightTitle: "SUPPLIER",
    rightName: supplierLabel,
    rightContact: po.supplierContactPhone,
    rightEmail: po.supplierContactEmail,
  });

  // ── Notes / Additional Information ───────────────────────────────────
  const notesText = [
    po.orderNumber ? `Order: ${po.orderNumber}` : null,
    po.supplierCode ? `Supplier Code: ${po.supplierCode}${po.supplierSource ? ` (${po.supplierSource.toUpperCase()})` : ""}` : null,
    po.supplierAccountNumber ? `Account: ${po.supplierAccountNumber}` : null,
    po.requestedShipDate ? `Requested Ship Date: ${new Date(po.requestedShipDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : null,
    po.shipToType ? `Ship Type: ${po.shipToType === "decorator" ? "Decorator" : po.shipToType === "warehouse" ? "Warehouse" : "Direct to Client"}` : null,
  ].filter(Boolean).join("\n");

  if (notesText) {
    if (y > ph - 60) { doc.addPage(); y = 20; }
    y = drawNotesArea(doc, y, "ADDITIONAL INFORMATION", notesText);
  }

  // ── Line items table ─────────────────────────────────────────────────
  // PO columns: Item #, Description, QTY, Unit $, Setup Fee, Total
  const tableLeft = marginX;
  const tableRight = pw - marginX;
  const tableW = tableRight - tableLeft;
  const cols = {
    itemNo: tableLeft,
    desc: tableLeft + tableW * 0.08,
    descW: tableW * 0.38,
    qty: tableLeft + tableW * 0.50,
    unit: tableLeft + tableW * 0.62,
    setup: tableLeft + tableW * 0.78,
    total: tableRight,
  };

  const lightFill = brandLightFill(brandRgb);

  // Header row
  doc.setFillColor(lightFill[0], lightFill[1], lightFill[2]);
  doc.rect(tableLeft, y - 4, tableW, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(brandRgb[0], brandRgb[1], brandRgb[2]);
  doc.text("ITEM #", cols.itemNo, y + 1);
  doc.text("DESCRIPTION", cols.desc, y + 1);
  doc.text("QTY", cols.qty, y + 1, { align: "right" });
  doc.text("UNIT $", cols.unit, y + 1, { align: "right" });
  doc.text("SETUP FEE", cols.setup, y + 1, { align: "right" });
  doc.text("TOTAL", cols.total, y + 1, { align: "right" });
  y += 9;

  // Table rows with alternating shading
  doc.setFont("helvetica", "normal");
  const altFill: [number, number, number] = [249, 250, 251];

  for (let i = 0; i < po.lineItems.length; i++) {
    const item = po.lineItems[i];
    if (y > ph - 40) { doc.addPage(); y = 20; }

    // Build description with color/size details
    let descText = item.productName;
    const details = [item.color, item.size].filter(Boolean).join(" / ");
    if (details) descText += `\n${details}`;
    if (item.decorationType) {
      descText += `\n${item.decorationType}`;
      if (item.decorationLocation) descText += ` — ${item.decorationLocation}`;
    }

    const descLines = doc.splitTextToSize(descText, cols.descW);
    const rowHeight = Math.max(descLines.length * 4, 8) + 3;

    if (i % 2 === 1) {
      doc.setFillColor(altFill[0], altFill[1], altFill[2]);
      doc.rect(tableLeft, y - 2, tableW, rowHeight, "F");
    }

    doc.setFontSize(8);
    doc.setTextColor(ink3[0], ink3[1], ink3[2]);
    doc.text(String(i + 1), cols.itemNo, y + 4);

    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(descLines, cols.desc, y + 4);

    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(String(item.quantity), cols.qty, y + 4, { align: "right" });
    doc.text(`$${item.costPrice.toFixed(2)}`, cols.unit, y + 4, { align: "right" });
    doc.setTextColor(ink2[0], ink2[1], ink2[2]);
    doc.text("$0.00", cols.setup, y + 4, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(`$${item.totalCost.toFixed(2)}`, cols.total, y + 4, { align: "right" });
    doc.setFont("helvetica", "normal");

    y += rowHeight;
    doc.setDrawColor(240, 240, 240);
    doc.setLineWidth(0.2);
    doc.line(tableLeft, y - 1, tableRight, y - 1);
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

  totalsRow("Subtotal", `$${parseFloat(po.subtotal).toFixed(2)}`);
  y += 5;
  if (parseFloat(po.shipping) > 0) {
    totalsRow("Shipping", `$${parseFloat(po.shipping).toFixed(2)}`);
    y += 5;
  }
  if (parseFloat(po.tax) > 0) {
    totalsRow("Tax", `$${parseFloat(po.tax).toFixed(2)}`);
    y += 5;
  }

  doc.setDrawColor(229, 229, 229);
  doc.setLineWidth(0.4);
  doc.line(totalsLeft, y, totalsRight, y);
  y += 6;

  totalsRow("Total", `$${parseFloat(po.total).toFixed(2)}`, { bold: true, brand: true, big: true });
  y += 12;

  // ── Decoration Instructions ──────────────────────────────────────────
  if (po.decorationInstructions) {
    if (y > ph - 40) { doc.addPage(); y = 20; }
    y = drawNotesArea(doc, y, "DECORATION INSTRUCTIONS", po.decorationInstructions);
  }

  // ── Supplier Notes ───────────────────────────────────────────────────
  if (po.supplierNotes) {
    if (y > ph - 40) { doc.addPage(); y = 20; }
    y = drawNotesArea(doc, y, "SUPPLIER NOTES", po.supplierNotes);
  }

  // ── Footer bar ───────────────────────────────────────────────────────
  drawDocFooter(doc, eff);

  doc.save(`${po.poNumber}.pdf`);
}
