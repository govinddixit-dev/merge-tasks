/**
 * proposalsVersions — Version history, PDF generation, and revert.
 *
 * Procedures: listVersions, generatePdf, revertToVersion
 */
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  proposals, proposalProducts, clients, products,
  distributorProfiles, departmentApprovals, proposalVersions,
  productImprintZones,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";

export const proposalsVersionsRouter = router({
  listVersions: protectedProcedure
    .input(z.object({ proposalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const proposal = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals))
        .limit(1);
      if (proposal.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const versions = await db
        .select()
        .from(proposalVersions)
        .where(eq(proposalVersions.proposalId, input.proposalId))
        .orderBy(desc(proposalVersions.createdAt));

      return versions;
    }),

  generatePdf: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [proposal] = await db.select().from(proposals)
        .where(and(eq(proposals.id, input.id), scope.proposals))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const ppRows = await db.select().from(proposalProducts)
        .where(eq(proposalProducts.proposalId, input.id));

      const productIds = ppRows.map(pp => pp.productId).filter(Boolean) as number[];
      const productRows = productIds.length > 0
        ? await db.select().from(products).where(inArray(products.id, productIds))
        : [];

      const [client] = proposal.clientId
        ? await db.select().from(clients).where(eq(clients.id, proposal.clientId)).limit(1)
        : [undefined];

      const [distProfile] = await db.select().from(distributorProfiles)
        .where(eq(distributorProfiles.userId, ctx.user.id)).limit(1);
      const primaryColor = distProfile?.brandPrimaryColor || "#654BF9";
      const companyName = distProfile?.brandCompanyName || distProfile?.companyName || "MergeTasks";
      const logoUrl = distProfile?.brandLogoUrl || "https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/email/logo_email_white_400.png";

      // Batched zone-label lookup for every line that carries an imprintZoneId.
      const zoneIds = ppRows.map(pp => pp.imprintZoneId).filter((v): v is number => v != null);
      const zoneRows = zoneIds.length > 0
        ? await db
          .select({ id: productImprintZones.id, label: productImprintZones.label })
          .from(productImprintZones)
          .where(inArray(productImprintZones.id, zoneIds))
        : [];
      const zoneLabelById = new Map(zoneRows.map(z => [z.id, z.label]));

      const productMap = new Map(productRows.map(p => [p.id, p]));
      const lineItems = ppRows.map(pp => {
        const prod = pp.productId ? productMap.get(pp.productId) : null;
        const name = prod?.name || "Product";
        const sku = prod?.sku || "";
        const qty = pp.quantity || 1;
        const unitPrice = pp.unitPrice ? parseFloat(pp.unitPrice) : (prod?.basePrice ? parseFloat(prod.basePrice) : 0);
        const lineTotal = qty * unitPrice;
        const decoration = pp.decorationType || "";
        const imprintZone = pp.imprintZoneId != null ? zoneLabelById.get(pp.imprintZoneId) ?? "" : "";
        const imageUrl = prod?.imageUrl || "";
        return { name, sku, qty, unitPrice, lineTotal, decoration, imprintZone, imageUrl };
      });

      const grandTotal = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);
      const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
      const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      const productRowsHtml = lineItems.map(li => `
        <tr>
          <td style="padding:12px 16px; border-bottom:1px solid #F3F4F6; vertical-align:top;">
            ${li.imageUrl ? `<img src="${li.imageUrl}" width="40" height="40" style="border-radius:6px; object-fit:cover; vertical-align:middle; margin-right:10px; border:1px solid #E5E7EB;" />` : ""}
            <strong>${li.name}</strong>${li.sku ? `<br/><span style="color:#9CA3AF;font-size:11px;">SKU: ${li.sku}</span>` : ""}
            ${li.decoration ? `<br/><span style="color:#6B7280;font-size:11px;">${li.decoration}</span>` : ""}
            ${li.imprintZone ? `<br/><span style="color:#9CA3AF;font-size:11px;">Zone: ${li.imprintZone}</span>` : ""}
          </td>
          <td style="padding:12px 16px; border-bottom:1px solid #F3F4F6; text-align:center; color:#374151;">${li.qty}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #F3F4F6; text-align:right; color:#374151;">${fmt(li.unitPrice)}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #F3F4F6; text-align:right; font-weight:600; color:#111827;">${fmt(li.lineTotal)}</td>
        </tr>`).join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Proposal — ${proposal.title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #F9FAFB; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @media print { body { background: white; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div style="max-width:800px; margin:0 auto; background:white; box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,${primaryColor} 0%,${primaryColor}CC 100%); padding:40px 48px; color:white;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <img src="${logoUrl}" alt="${companyName}" style="height:32px; object-fit:contain; margin-bottom:20px; display:block;" />
          <h1 style="font-size:28px; font-weight:800; letter-spacing:-0.02em; margin-bottom:6px;">${proposal.title}</h1>
          <p style="font-size:14px; opacity:0.8;">Prepared by ${companyName} &nbsp;·&nbsp; ${today}</p>
        </div>
        <div style="text-align:right;">
          <div style="background:rgba(255,255,255,0.2); border-radius:8px; padding:12px 20px; display:inline-block;">
            <p style="font-size:11px; opacity:0.8; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Proposal Total</p>
            <p style="font-size:26px; font-weight:800;">${proposal.estimatedValue ? `$${parseFloat(proposal.estimatedValue).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : fmt(grandTotal)}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Client Info -->
    <div style="padding:32px 48px; border-bottom:1px solid #F3F4F6; display:flex; gap:48px;">
      <div>
        <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:#9CA3AF; margin-bottom:6px;">Prepared For</p>
        <p style="font-size:16px; font-weight:700; color:#111827;">${client?.companyName || "Client"}</p>
        ${client?.contactName ? `<p style="font-size:13px; color:#6B7280; margin-top:2px;">${client.contactName}</p>` : ""}
        ${client?.contactEmail ? `<p style="font-size:13px; color:#6B7280;">${client.contactEmail}</p>` : ""}
      </div>
      <div>
        <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:#9CA3AF; margin-bottom:6px;">Valid For</p>
        <p style="font-size:16px; font-weight:700; color:#111827;">${proposal.validDays || 30} days</p>
      </div>
      <div>
        <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:#9CA3AF; margin-bottom:6px;">Status</p>
        <p style="font-size:16px; font-weight:700; color:${primaryColor};">${(proposal.status || "draft").charAt(0).toUpperCase() + (proposal.status || "draft").slice(1)}</p>
      </div>
    </div>

    <!-- Notes -->
    ${proposal.notes ? `
    <div style="padding:24px 48px; border-bottom:1px solid #F3F4F6; background:#F9FAFB;">
      <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:#9CA3AF; margin-bottom:8px;">Notes</p>
      <p style="font-size:14px; color:#374151; line-height:1.6;">${proposal.notes}</p>
    </div>` : ""}

    <!-- Products Table -->
    <div style="padding:32px 48px;">
      <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:#9CA3AF; margin-bottom:16px;">Products &amp; Pricing</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border:1px solid #F3F4F6; border-radius:12px; overflow:hidden;">
        <thead>
          <tr style="background:#F9FAFB;">
            <th style="padding:12px 16px; text-align:left; font-size:12px; font-weight:600; color:#6B7280; text-transform:uppercase; letter-spacing:0.05em;">Product</th>
            <th style="padding:12px 16px; text-align:center; font-size:12px; font-weight:600; color:#6B7280; text-transform:uppercase; letter-spacing:0.05em;">Qty</th>
            <th style="padding:12px 16px; text-align:right; font-size:12px; font-weight:600; color:#6B7280; text-transform:uppercase; letter-spacing:0.05em;">Unit Price</th>
            <th style="padding:12px 16px; text-align:right; font-size:12px; font-weight:600; color:#6B7280; text-transform:uppercase; letter-spacing:0.05em;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${productRowsHtml}
        </tbody>
        <tfoot>
          <tr style="background:#F9FAFB;">
            <td colspan="3" style="padding:16px; text-align:right; font-size:14px; font-weight:700; color:#374151;">Grand Total</td>
            <td style="padding:16px; text-align:right; font-size:18px; font-weight:800; color:${primaryColor};">${proposal.estimatedValue ? `$${parseFloat(proposal.estimatedValue).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : fmt(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Footer -->
    <div style="padding:24px 48px; background:#F9FAFB; border-top:1px solid #F3F4F6; text-align:center;">
      <p style="font-size:12px; color:#9CA3AF;">Generated by <strong style="color:${primaryColor};">${companyName}</strong> via MergeTasks &nbsp;·&nbsp; ${today}</p>
    </div>

  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

      return { html, filename: `proposal-${proposal.id}-${proposal.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf` };
    }),

  revertToVersion: protectedProcedure
    .input(z.object({ proposalId: z.number(), versionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const proposal = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.proposalId), scope.proposals))
        .limit(1);
      if (proposal.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const version = await db
        .select()
        .from(proposalVersions)
        .where(and(eq(proposalVersions.id, input.versionId), eq(proposalVersions.proposalId, input.proposalId)))
        .limit(1);
      if (version.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });

      const v = version[0];
      const setObj: Record<string, unknown> = {};
      if (v.snapshotTitle) setObj.title = v.snapshotTitle;
      if (v.snapshotEstimatedValue) setObj.estimatedValue = v.snapshotEstimatedValue;
      if (v.snapshotStatus) setObj.status = v.snapshotStatus;

      if (Object.keys(setObj).length > 0) {
        await db.update(proposals).set(setObj).where(eq(proposals.id, input.proposalId));
      }

      const ppRows = await db.select().from(proposalProducts).where(eq(proposalProducts.proposalId, input.proposalId));
      const deptRows = await db.select().from(departmentApprovals).where(eq(departmentApprovals.proposalId, input.proposalId));
      await db.insert(proposalVersions).values({
        proposalId: input.proposalId,
        userId: ctx.user.id,
        authorName: ctx.user.name || "Distributor",
        snapshotTitle: v.snapshotTitle,
        snapshotEstimatedValue: v.snapshotEstimatedValue,
        snapshotStatus: v.snapshotStatus,
        snapshotProductCount: ppRows.length,
        snapshotDepartmentCount: deptRows.length,
        changes: [`Reverted to version from ${v.createdAt ? new Date(v.createdAt).toLocaleString() : "earlier"}`],
        action: "reverted",
      });

      const updated = await db.select().from(proposals).where(eq(proposals.id, input.proposalId)).limit(1);
      return updated[0];
    }),
});
