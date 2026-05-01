/**
 * Estimates & Invoices Router
 * Handles creation, listing, and conversion of estimates and invoices
 * from accepted proposals.
 */
import { z } from "zod";
import { randomBytes } from "crypto";
import { eq, and, desc, asc, notInArray, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  estimates, estimatePackages, estimateLineItems,
  invoices, proposals, proposalProducts, proposalOrderItems,
  products, clients, orders, orderItems, users,
  type InsertEstimate, type InsertInvoice,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";
import { nextDocumentNumber } from "../utils/documentNumbers";
import { resolveTier2 } from "../email/brandingResolver";
import { sendEmail } from "../email/mailer";
import { buildEmailHtml, formatCurrency } from "../email/emailTemplates/emailTemplateBase";
import { getLogger } from "../utils/logger";
import { computeTotals, resolveDueDate, type PaymentTerms } from "../../shared/invoiceMath";
import { ENV } from "../_core/env";
import { getStripe } from "../stripe/stripeClient";

const log = getLogger("estimatesInvoices");

/**
 * Shared helper — builds the distributor-branded HTML body used by both
 * estimates.sendToClient and invoices.sendToClient so the look stays
 * identical across the two document types.
 */
function buildDocumentEmailHtml(opts: {
  kind: "estimate" | "invoice";
  documentNumber: string;
  clientName: string | null;
  createdAt: Date;
  dueDate?: Date | null;
  validDays?: number | null;
  subtotal: string;
  tax: string;
  shipping: string;
  total: string;
  notes: string | null;
  branding: {
    companyName?: string;
    primaryColor?: string;
    logoUrl?: string;
  };
}): string {
  const label = opts.kind === "estimate" ? "Estimate" : "Invoice";
  const meta: Array<{ label: string; value: string }> = [
    { label: `${label} #`, value: opts.documentNumber },
    { label: "Issued", value: opts.createdAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) },
  ];
  if (opts.kind === "invoice" && opts.dueDate) {
    meta.push({ label: "Due", value: opts.dueDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) });
  }
  if (opts.kind === "estimate" && opts.validDays != null && opts.validDays > 0) {
    meta.push({ label: "Valid for", value: `${opts.validDays} days` });
  }
  const subtotal = parseFloat(opts.subtotal || "0");
  const tax = parseFloat(opts.tax || "0");
  const shipping = parseFloat(opts.shipping || "0");
  const total = parseFloat(opts.total || "0");
  const summaryLines: string[] = [
    `Subtotal: ${formatCurrency(subtotal)}`,
  ];
  if (tax > 0) summaryLines.push(`Tax: ${formatCurrency(tax)}`);
  if (shipping > 0) summaryLines.push(`Shipping: ${formatCurrency(shipping)}`);
  summaryLines.push(`Total: ${formatCurrency(total)}`);

  return buildEmailHtml({
    badge: { text: label },
    headline: `Your ${label.toLowerCase()} is ready`,
    subheadline: `${label} ${opts.documentNumber}${opts.clientName ? ` for ${opts.clientName}` : ""}`,
    bodyParagraphs: [
      `${opts.branding.companyName || "Your distributor"} has sent you ${
        opts.kind === "estimate" ? "an estimate" : "an invoice"
      } for your review.`,
      summaryLines.join(" &nbsp;·&nbsp; "),
      ...(opts.notes ? [`<strong>Notes:</strong> ${opts.notes}`] : []),
      opts.kind === "estimate"
        ? "Reply to this email to accept, decline, or request changes."
        : "Reply to this email with any questions or payment confirmation.",
    ],
    infoCard: {
      title: `${label} ${opts.documentNumber}`,
      subtitle: `Total due: ${formatCurrency(total)}`,
      meta,
    },
    branding: {
      lane: "distributor",
      companyName: opts.branding.companyName,
      primaryColor: opts.branding.primaryColor,
      logoUrl: opts.branding.logoUrl,
    },
  });
}

export const estimatesInvoicesRouter = router({
  //  Estimates 

  estimates: router({
    list: protectedProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const rows = await db.select().from(estimates)
          .where(scope.estimates)
          .orderBy(desc(estimates.createdAt));

        let filtered = rows;
        if (input?.status) filtered = filtered.filter(e => e.status === input.status);

        // Enrich with client names
        const clientRows = await db.select().from(clients).where(scope.clients);
        const clientMap = new Map(clientRows.map(c => [c.id, c]));

        return filtered.map(e => ({
          ...e,
          client: clientMap.get(e.clientId) ?? null,
        }));
      }),

    /**
     * Single-read accessor for the Estimate Detail page / PDF generator.
     *
     * Post-migration-0089, every estimate — whether minted by
     * createFromProposal or builderSave — stores its line items in the
     * relational estimateLineItems + estimatePackages tables. This query
     * reads those tables and shapes them into the `resolvedLineItems`
     * array the render layer expects.
     *
     * Snapshot columns on estimateLineItems (sku, color, size, imageUrl)
     * are preferred over a catalog lookup so the document is stable even
     * if the underlying product is later renamed or deleted.
     *
     * `isBuilderCreated` is retained on the return shape for back-compat
     * with callers that branch on it; it now simply reports whether the
     * estimate has a parent proposal.
     */
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const [est] = await db.select().from(estimates)
          .where(and(eq(estimates.id, input.id), scope.estimates))
          .limit(1);
        if (!est) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });

        const [client] = await db.select().from(clients).where(eq(clients.id, est.clientId)).limit(1);
        const [proposal] = est.proposalId
          ? await db.select().from(proposals).where(eq(proposals.id, est.proposalId)).limit(1)
          : [null];

        const [pkgRows, itemRows] = await Promise.all([
          db.select().from(estimatePackages)
            .where(eq(estimatePackages.estimateId, est.id))
            .orderBy(asc(estimatePackages.sortOrder), asc(estimatePackages.id)),
          db.select().from(estimateLineItems)
            .where(eq(estimateLineItems.estimateId, est.id))
            .orderBy(asc(estimateLineItems.sortOrder), asc(estimateLineItems.id)),
        ]);

        // Fallback catalog lookup only for items whose snapshot columns
        // are null (e.g. older builder rows created before the snapshot
        // columns existed on the table).
        const productIds = Array.from(new Set(
          itemRows
            .filter(r => r.sku == null || r.imageUrl == null)
            .map(r => r.productId)
            .filter((x): x is number => x != null),
        ));
        const productRows = productIds.length > 0
          ? await db.select({
              id: products.id,
              sku: products.sku,
              imageUrl: products.imageUrl,
            }).from(products).where(inArray(products.id, productIds))
          : [];
        const productMap = new Map(productRows.map(p => [p.id, p]));
        const pkgNameById = new Map(pkgRows.map(p => [p.id, p.name]));
        const pkgSortById = new Map(pkgRows.map(p => [p.id, p.sortOrder]));

        // Order items by their package's sortOrder, with ungrouped items
        // last. Keeps packaged items contiguous in the document so the
        // render layer can insert a single sub-header per group.
        const sorted = [...itemRows].sort((a, b) => {
          const aPkg = a.packageId == null ? Number.POSITIVE_INFINITY : (pkgSortById.get(a.packageId) ?? Number.POSITIVE_INFINITY);
          const bPkg = b.packageId == null ? Number.POSITIVE_INFINITY : (pkgSortById.get(b.packageId) ?? Number.POSITIVE_INFINITY);
          if (aPkg !== bPkg) return aPkg - bPkg;
          return a.sortOrder - b.sortOrder;
        });

        const resolvedLineItems = sorted.map(item => {
          const prod = item.productId != null ? productMap.get(item.productId) : undefined;
          return {
            productName: item.description,
            sku: item.sku ?? prod?.sku ?? null,
            color: item.color,
            size: item.size,
            quantity: parseFloat(item.quantity),
            unitPrice: parseFloat(item.unitPrice),
            totalPrice: parseFloat(item.lineTotal),
            imageUrl: item.imageUrl ?? prod?.imageUrl ?? null,
            packageName: item.packageId != null ? (pkgNameById.get(item.packageId) ?? null) : null,
          };
        });

        return {
          ...est,
          client: client ?? null,
          proposal: proposal ?? null,
          resolvedLineItems,
          isBuilderCreated: est.proposalId == null,
        };
      }),

    /**
     * Create estimate from an accepted proposal.
     *
     * Writes to the relational tables (estimates header +
     * estimatePackages "Default" + estimateLineItems) as of the
     * migration-0089 rewrite. The deprecated JSON estimates.lineItems
     * column is explicitly set to null on every insert so every row
     * created from this handler flows through the same read path as
     * builderSave rows. Legacy rows created before this rewrite are
     * backfilled by migration 0089.
     */
    createFromProposal: protectedProcedure
      .input(z.object({
        proposalId: z.number(),
        notes: z.string().optional(),
        validDays: z.number().optional(),
        tax: z.string().optional(),
        shipping: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        const [proposal] = await db.select().from(proposals)
          .where(and(eq(proposals.id, input.proposalId), scope.proposals))
          .limit(1);
        if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

        // Resolve the item source: prefer the client's actual cart
        // (proposalOrderItems) so color/size selections survive into the
        // estimate; fall back to the raw proposal product list when no
        // cart exists.
        type BuiltItem = {
          productId: number | null;
          productName: string;
          sku: string | null;
          color: string | null;
          size: string | null;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          imageUrl: string | null;
        };
        let builtItems: BuiltItem[] = [];

        const orderItemRows = await db.select().from(proposalOrderItems)
          .where(eq(proposalOrderItems.proposalId, input.proposalId));

        if (orderItemRows.length > 0) {
          const productRows = await db.select().from(products).where(scope.products);
          const productMap = new Map(productRows.map(p => [p.id, p]));

          builtItems = orderItemRows.map(item => {
            const prod = productMap.get(item.productId);
            const qty = item.quantity;
            const price = parseFloat(item.unitPrice?.toString() || "0");
            return {
              productId: item.productId,
              productName: prod?.name || "Product",
              sku: prod?.sku || null,
              color: item.color || null,
              size: item.size || null,
              quantity: qty,
              unitPrice: price,
              totalPrice: qty * price,
              imageUrl: prod?.imageUrl || null,
            };
          });
        } else {
          const ppRows = await db.select().from(proposalProducts)
            .where(eq(proposalProducts.proposalId, input.proposalId));
          const productRows = await db.select().from(products).where(scope.products);
          const productMap = new Map(productRows.map(p => [p.id, p]));

          builtItems = ppRows.map(pp => {
            const prod = productMap.get(pp.productId);
            const qty = pp.quantity ?? 1;
            const price = parseFloat(pp.unitPrice?.toString() || prod?.basePrice?.toString() || "0");
            return {
              productId: pp.productId,
              productName: prod?.name || "Product",
              sku: prod?.sku || null,
              color: null,
              size: null,
              quantity: qty,
              unitPrice: price,
              totalPrice: qty * price,
              imageUrl: prod?.imageUrl || null,
            };
          });
        }

        const subtotal = builtItems.reduce((sum, li) => sum + li.totalPrice, 0);
        const tax = parseFloat(input.tax || "0");
        const shipping = parseFloat(input.shipping || "0");
        const total = subtotal + tax + shipping;

        // Atomic write: estimate header + Default package + N line items
        // in one transaction. If any leg fails the whole thing rolls back
        // so we never end up with a header pointing at half-written rows.
        let estimateId: number = 0;
        await db.transaction(async (tx) => {
          const headerValues: InsertEstimate = {
            ...scope.stamp,
            proposalId: input.proposalId,
            clientId: proposal.clientId,
            estimateNumber: await nextDocumentNumber(scope.organizationId, ctx.user.id, "est"),
            status: "draft",
            // JSON column left null — readers should use the relational
            // tables. The column is retained as a rollback escape hatch
            // until a future migration drops it.
            lineItems: null,
            subtotal: subtotal.toFixed(2),
            tax: tax.toFixed(2),
            shipping: shipping.toFixed(2),
            total: total.toFixed(2),
            notes: input.notes ?? null,
            validDays: input.validDays ?? 30,
          };
          const insertResult = await tx.insert(estimates).values(headerValues);
          estimateId = insertResult[0].insertId;

          if (builtItems.length > 0) {
            const [pkg] = await tx.insert(estimatePackages).values({
              estimateId,
              name: "Default",
              sortOrder: 0,
            }).$returningId();

            for (let i = 0; i < builtItems.length; i++) {
              const item = builtItems[i];
              await tx.insert(estimateLineItems).values({
                estimateId,
                packageId: pkg.id,
                productId: item.productId,
                description: item.productName,
                quantity: item.quantity.toFixed(3),
                unitPrice: item.unitPrice.toFixed(2),
                lineTotal: item.totalPrice.toFixed(2),
                sortOrder: i,
                color: item.color,
                size: item.size,
                imageUrl: item.imageUrl,
                sku: item.sku,
              });
            }
          }
        });

        const [created] = await db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
        return created;
      }),

    /**
     * Convert estimate to invoice.
     *
     * Reads from the relational estimateLineItems / estimatePackages
     * tables and projects the result back into the invoices.lineItems
     * JSON column — invoices have not yet been migrated to relational
     * line items, so the boundary is crossed here. Legacy estimates
     * that still have non-null JSON (shouldn't happen post-0089, but
     * possible mid-deploy) fall through to the JSON copy as a fallback.
     */
    convertToInvoice: protectedProcedure
      .input(z.object({
        estimateId: z.number(),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const [est] = await db.select().from(estimates)
          .where(and(eq(estimates.id, input.estimateId), scope.estimates))
          .limit(1);
        if (!est) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });
        if (est.status === "converted") throw new TRPCError({ code: "BAD_REQUEST", message: "Estimate already converted" });

        // Project the relational line items back to the invoice JSON
        // shape. We don't need package info on the invoice side — just
        // the flat list, ordered by sortOrder.
        const itemRows = await db.select().from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, est.id))
          .orderBy(asc(estimateLineItems.sortOrder), asc(estimateLineItems.id));

        let invoiceLineItems: InsertInvoice["lineItems"];
        if (itemRows.length > 0) {
          invoiceLineItems = itemRows.map(r => ({
            productName: r.description,
            sku: r.sku,
            color: r.color,
            size: r.size,
            quantity: parseFloat(r.quantity),
            unitPrice: parseFloat(r.unitPrice),
            totalPrice: parseFloat(r.lineTotal),
            imageUrl: r.imageUrl,
          }));
        } else {
          // Pre-0089 legacy rows: fall back to the JSON copy. Safe to
          // drop once all rows are confirmed backfilled.
          invoiceLineItems = est.lineItems;
        }

        const invoiceValues: InsertInvoice = {
          ...scope.stamp,
          proposalId: est.proposalId,
          estimateId: est.id,
          clientId: est.clientId,
          invoiceNumber: await nextDocumentNumber(scope.organizationId, ctx.user.id, "inv"),
          status: "draft",
          lineItems: invoiceLineItems,
          subtotal: est.subtotal,
          tax: est.tax,
          shipping: est.shipping,
          total: est.total,
          notes: input.notes ?? est.notes ?? null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        };

        // Use a transaction to ensure atomicity: insert invoice + update estimate together
        let invoiceId: number = 0;
        await db.transaction(async (tx) => {
          const result = await tx.insert(invoices).values(invoiceValues);
          invoiceId = result[0].insertId;
          // Mark estimate as converted
          await tx.update(estimates)
            .set({ status: "converted", convertedToInvoiceId: invoiceId })
            .where(eq(estimates.id, est.id));
        });
        const [created] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
        return created;
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const [est] = await db.select().from(estimates)
          .where(and(eq(estimates.id, input.id), scope.estimates))
          .limit(1);
        if (!est) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });

        await db.delete(estimates).where(and(eq(estimates.id, input.id), scope.estimates));
        return { success: true };
      }),

    /**
     * Duplicate an estimate — copies the header, packages, and relational
     * line items into a fresh draft. Package IDs are remapped so each copied
     * line item points at its new package (not the original's).
     */
    duplicate: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        const [original] = await db.select().from(estimates)
          .where(and(eq(estimates.id, input.id), scope.estimates))
          .limit(1);
        if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });

        const estimateNumber = await nextDocumentNumber(
          ctx.organizationId ?? null,
          ctx.user.id,
          "est",
        );

        const result = await db.insert(estimates).values({
          userId: original.userId,
          organizationId: original.organizationId,
          proposalId: null,
          clientId: original.clientId,
          estimateNumber,
          status: "draft",
          lineItems: null,
          subtotal: original.subtotal,
          tax: original.tax,
          shipping: original.shipping,
          total: original.total,
          notes: original.notes ?? null,
          validDays: original.validDays,
        });
        const newId = result[0].insertId;

        // Copy packages first so we can remap old → new package IDs when we
        // clone the relational line items.
        const srcPackages = await db.select().from(estimatePackages)
          .where(eq(estimatePackages.estimateId, input.id));
        const pkgIdMap = new Map<number, number>();
        for (const pkg of srcPackages) {
          const pkgResult = await db.insert(estimatePackages).values({
            estimateId: newId,
            name: pkg.name,
            sortOrder: pkg.sortOrder,
          });
          pkgIdMap.set(pkg.id, pkgResult[0].insertId);
        }

        // Clone line items in one insert, remapping packageId through the map.
        // Unpackaged items (packageId null) stay null.
        const srcItems = await db.select().from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, input.id));
        if (srcItems.length > 0) {
          await db.insert(estimateLineItems).values(srcItems.map(item => ({
            estimateId: newId,
            packageId: item.packageId != null ? (pkgIdMap.get(item.packageId) ?? null) : null,
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            sortOrder: item.sortOrder,
            color: item.color,
            size: item.size,
            imageUrl: item.imageUrl,
            sku: item.sku,
          })));
        }

        return { success: true, newId, estimateNumber };
      }),

    /**
     * Send the estimate to the client via email (distributor-branded).
     * Resolves branding live from distributorProfiles via resolveTier2 —
     * same pattern proposals use. Updates status → "sent" only if delivery
     * succeeds.
     */
    sendToClient: protectedProcedure
      .input(z.object({
        id: z.number(),
        toEmailOverride: z.string().email().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        const [est] = await db.select().from(estimates)
          .where(and(eq(estimates.id, input.id), scope.estimates))
          .limit(1);
        if (!est) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });

        const [client] = await db.select().from(clients).where(eq(clients.id, est.clientId)).limit(1);
        const toEmail = input.toEmailOverride || client?.contactEmail;
        if (!toEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "No client email on file — add a contact email or pass an override" });

        const resolved = await resolveTier2({
          distributorUserId: ctx.user.id,
          organizationId: ctx.organizationId ?? null,
        });

        const html = buildDocumentEmailHtml({
          kind: "estimate",
          documentNumber: est.estimateNumber,
          clientName: client?.contactName || client?.companyName || null,
          createdAt: est.createdAt ?? new Date(),
          validDays: est.validDays,
          subtotal: est.subtotal,
          tax: est.tax,
          shipping: est.shipping,
          total: est.total,
          notes: est.notes,
          branding: resolved.branding,
        });

        const result = await sendEmail(
          toEmail,
          `${resolved.branding.companyName || "Estimate"} — Estimate ${est.estimateNumber}`,
          html,
          resolved.fromName,
          resolved.replyTo,
        );
        if (!result.sent) {
          log.error(`Failed to send estimate ${est.id} to ${toEmail}: ${result.error}`);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Email delivery failed: ${result.error || "unknown"}` });
        }

        await db.update(estimates).set({ status: "sent", sentAt: new Date() }).where(eq(estimates.id, est.id));
        return { success: true, sentTo: toEmail };
      }),

    /**
     * Unified-canvas Estimate Builder — load full builder state for a draft.
     *
     * Reads the relational tables (estimatePackages, estimateLineItems),
     * NOT the deprecated JSON lineItems column. Legacy rows created by
     * createFromProposal will therefore come back with `packages: []` and
     * `lineItems: []` — the detail page continues to use estimates.getById
     * (which reads the JSON column) for those.
     */
    builderGet: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        const [est] = await db.select().from(estimates)
          .where(and(eq(estimates.id, input.id), scope.estimates))
          .limit(1);
        if (!est) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });

        const [pkgRows, itemRows] = await Promise.all([
          db.select().from(estimatePackages)
            .where(eq(estimatePackages.estimateId, est.id))
            .orderBy(asc(estimatePackages.sortOrder), asc(estimatePackages.id)),
          db.select().from(estimateLineItems)
            .where(eq(estimateLineItems.estimateId, est.id))
            .orderBy(asc(estimateLineItems.sortOrder), asc(estimateLineItems.id)),
        ]);

        return {
          estimate: est,
          packages: pkgRows,
          lineItems: itemRows,
        };
      }),

    /**
     * Unified-canvas Estimate Builder — full-form snapshot save.
     *
     * Dual-write boundary: the builder writes exclusively to the relational
     * tables (estimates row + estimatePackages + estimateLineItems). The
     * deprecated JSON estimates.lineItems column is explicitly set to null
     * on every save here so a row sourced from the builder can never be
     * ambiguously interpreted as legacy. Legacy createFromProposal continues
     * to write the JSON column only.
     *
     * Behaviour
     * ─────────
     * - If `input.id` is absent: mints a new draft. clientId is required.
     *   estimateNumber is assigned via nextDocumentNumber.
     * - If `input.id` is present: updates the existing draft. Only rows in
     *   status "draft" can be mutated; sent/accepted/etc. are rejected.
     * - Packages and line items are replaced atomically by diff: rows whose
     *   id isn't in the incoming set are deleted; rows with ids are updated;
     *   rows without ids are inserted.
     * - New packages can be referenced by line items in the same save via
     *   `clientPackageKey` — a client-assigned string that the server
     *   resolves to the real packageId after insert.
     * - Subtotal / total are recomputed server-side from line-item rows
     *   after the diff. tax and shipping on the estimate header are
     *   preserved (not part of the builder's scope today).
     */
    builderSave: protectedProcedure
      .input(z.object({
        id: z.number().optional(),
        clientId: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
        terms: z.string().nullable().optional(),
        currency: z.string().length(3).optional(),
        validUntil: z.string().datetime().nullable().optional(),
        packages: z.array(z.object({
          id: z.number().optional(),
          clientPackageKey: z.string().optional(),
          name: z.string().min(1).max(255),
          sortOrder: z.number().int().nonnegative(),
        })).default([]),
        lineItems: z.array(z.object({
          id: z.number().optional(),
          packageId: z.number().nullable().optional(),
          clientPackageKey: z.string().nullable().optional(),
          productId: z.number().nullable().optional(),
          description: z.string().min(1),
          quantity: z.number().min(0),
          unitPrice: z.number().min(0),
          sortOrder: z.number().int().nonnegative(),
        })).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        // Resolve or create the header row. The transaction below handles
        // child-row diffs; header creation is cheap and safe to do first.
        let estimateId: number;
        if (input.id != null) {
          const [existing] = await db.select().from(estimates)
            .where(and(eq(estimates.id, input.id), scope.estimates))
            .limit(1);
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });
          if (existing.status !== "draft") {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot edit an estimate in status "${existing.status}"` });
          }
          estimateId = existing.id;
        } else {
          if (input.clientId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "clientId is required to create a draft" });
          }
          const insertValues: InsertEstimate = {
            ...scope.stamp,
            clientId: input.clientId,
            estimateNumber: await nextDocumentNumber(scope.organizationId, ctx.user.id, "est"),
            status: "draft",
            subtotal: "0.00",
            tax: "0.00",
            shipping: "0.00",
            total: "0.00",
            // proposalId left null — builder-created drafts have no parent proposal
            // lineItems left null — builder writes to the relational tables only
            currency: input.currency ?? "CAD",
          };
          const [created] = await db.insert(estimates).values(insertValues).$returningId();
          estimateId = created.id;
        }

        // Diff + write packages and line items atomically. If the client
        // sends bad package references, the whole save rolls back.
        await db.transaction(async (tx) => {
          // ── Packages: delete-not-in, then upsert ──────────────────────
          const keepPackageIds = input.packages
            .map((p) => p.id)
            .filter((v): v is number => v != null);
          if (keepPackageIds.length > 0) {
            await tx.delete(estimatePackages).where(and(
              eq(estimatePackages.estimateId, estimateId),
              notInArray(estimatePackages.id, keepPackageIds),
            ));
          } else {
            await tx.delete(estimatePackages).where(eq(estimatePackages.estimateId, estimateId));
          }

          const clientKeyToPackageId = new Map<string, number>();
          for (const pkg of input.packages) {
            if (pkg.id != null) {
              await tx.update(estimatePackages).set({
                name: pkg.name,
                sortOrder: pkg.sortOrder,
              }).where(and(
                eq(estimatePackages.id, pkg.id),
                eq(estimatePackages.estimateId, estimateId),
              ));
              if (pkg.clientPackageKey) clientKeyToPackageId.set(pkg.clientPackageKey, pkg.id);
            } else {
              const [created] = await tx.insert(estimatePackages).values({
                estimateId,
                name: pkg.name,
                sortOrder: pkg.sortOrder,
              }).$returningId();
              if (pkg.clientPackageKey) clientKeyToPackageId.set(pkg.clientPackageKey, created.id);
            }
          }

          // ── Line items: delete-not-in, then upsert ────────────────────
          const keepItemIds = input.lineItems
            .map((li) => li.id)
            .filter((v): v is number => v != null);
          if (keepItemIds.length > 0) {
            await tx.delete(estimateLineItems).where(and(
              eq(estimateLineItems.estimateId, estimateId),
              notInArray(estimateLineItems.id, keepItemIds),
            ));
          } else {
            await tx.delete(estimateLineItems).where(eq(estimateLineItems.estimateId, estimateId));
          }

          let subtotalCents = 0;
          for (const li of input.lineItems) {
            // Resolve the package reference: prefer a concrete id; fall
            // back to a clientPackageKey that the packages diff above just
            // mapped to a real id. Unknown keys become null (ungrouped).
            let resolvedPackageId: number | null = li.packageId ?? null;
            if (resolvedPackageId == null && li.clientPackageKey) {
              resolvedPackageId = clientKeyToPackageId.get(li.clientPackageKey) ?? null;
            }

            // Totals are money — compute in cents to avoid float drift,
            // then serialize to the DECIMAL(12,2) column via toFixed(2).
            const lineTotalCents = Math.round(li.quantity * li.unitPrice * 100);
            subtotalCents += lineTotalCents;

            if (li.id != null) {
              await tx.update(estimateLineItems).set({
                packageId: resolvedPackageId,
                productId: li.productId ?? null,
                description: li.description,
                quantity: li.quantity.toFixed(3),
                unitPrice: li.unitPrice.toFixed(2),
                lineTotal: (lineTotalCents / 100).toFixed(2),
                sortOrder: li.sortOrder,
              }).where(and(
                eq(estimateLineItems.id, li.id),
                eq(estimateLineItems.estimateId, estimateId),
              ));
            } else {
              await tx.insert(estimateLineItems).values({
                estimateId,
                packageId: resolvedPackageId,
                productId: li.productId ?? null,
                description: li.description,
                quantity: li.quantity.toFixed(3),
                unitPrice: li.unitPrice.toFixed(2),
                lineTotal: (lineTotalCents / 100).toFixed(2),
                sortOrder: li.sortOrder,
              });
            }
          }

          // ── Header: update fields + recomputed totals ─────────────────
          const [current] = await tx.select({ tax: estimates.tax, shipping: estimates.shipping })
            .from(estimates).where(eq(estimates.id, estimateId)).limit(1);
          const taxCents = Math.round(parseFloat(current?.tax ?? "0") * 100);
          const shippingCents = Math.round(parseFloat(current?.shipping ?? "0") * 100);
          const totalCents = subtotalCents + taxCents + shippingCents;

          const headerUpdate: Partial<InsertEstimate> = {
            subtotal: (subtotalCents / 100).toFixed(2),
            total: (totalCents / 100).toFixed(2),
            // Explicit null on every builder save so the dual-write
            // boundary with createFromProposal stays testable.
            lineItems: null,
          };
          if (input.clientId != null) headerUpdate.clientId = input.clientId;
          if (input.notes !== undefined) headerUpdate.notes = input.notes;
          if (input.terms !== undefined) headerUpdate.terms = input.terms;
          if (input.currency !== undefined) headerUpdate.currency = input.currency;
          if (input.validUntil !== undefined) {
            headerUpdate.validUntil = input.validUntil ? new Date(input.validUntil) : null;
          }

          await tx.update(estimates).set(headerUpdate).where(eq(estimates.id, estimateId));
        });

        // Re-read the full builder state after the transaction. Cheaper
        // than constructing it from the inputs because ids for new rows
        // are now concrete and sortOrders are authoritative.
        const [est] = await db.select().from(estimates)
          .where(eq(estimates.id, estimateId)).limit(1);
        const [pkgRows, itemRows] = await Promise.all([
          db.select().from(estimatePackages)
            .where(eq(estimatePackages.estimateId, estimateId))
            .orderBy(asc(estimatePackages.sortOrder), asc(estimatePackages.id)),
          db.select().from(estimateLineItems)
            .where(eq(estimateLineItems.estimateId, estimateId))
            .orderBy(asc(estimateLineItems.sortOrder), asc(estimateLineItems.id)),
        ]);

        return { estimate: est, packages: pkgRows, lineItems: itemRows };
      }),
  }),

  //  Invoices

  invoices: router({
    list: protectedProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const rows = await db.select().from(invoices)
          .where(scope.invoices)
          .orderBy(desc(invoices.createdAt));

        let filtered = rows;
        if (input?.status) filtered = filtered.filter(i => i.status === input.status);

        const clientRows = await db.select().from(clients).where(scope.clients);
        const clientMap = new Map(clientRows.map(c => [c.id, c]));

        return filtered.map(i => ({
          ...i,
          client: clientMap.get(i.clientId) ?? null,
        }));
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const [inv] = await db.select().from(invoices)
          .where(and(eq(invoices.id, input.id), scope.invoices))
          .limit(1);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

        const [client] = await db.select().from(clients).where(eq(clients.id, inv.clientId)).limit(1);
        const [proposal] = inv.proposalId
          ? await db.select().from(proposals).where(eq(proposals.id, inv.proposalId)).limit(1)
          : [null];

        return { ...inv, client: client ?? null, proposal: proposal ?? null };
      }),

    /** Create invoice directly from an accepted proposal */
    createFromProposal: protectedProcedure
      .input(z.object({
        proposalId: z.number(),
        notes: z.string().optional(),
        dueDate: z.string().optional(),
        tax: z.string().optional(),
        shipping: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const [proposal] = await db.select().from(proposals)
          .where(and(eq(proposals.id, input.proposalId), scope.proposals))
          .limit(1);
        if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

        // Get line items (same logic as estimate)
        let lineItems: InsertInvoice["lineItems"] = [];
        const orderItemRows = await db.select().from(proposalOrderItems)
          .where(eq(proposalOrderItems.proposalId, input.proposalId));

        if (orderItemRows.length > 0) {
          const productRows = await db.select().from(products).where(scope.products);
          const productMap = new Map(productRows.map(p => [p.id, p]));

          lineItems = orderItemRows.map(item => {
            const prod = productMap.get(item.productId);
            const qty = item.quantity;
            const price = parseFloat(item.unitPrice?.toString() || "0");
            return {
              productName: prod?.name || "Product",
              sku: prod?.sku || null,
              color: item.color || null,
              size: item.size || null,
              quantity: qty,
              unitPrice: price,
              totalPrice: qty * price,
              imageUrl: prod?.imageUrl || null,
            };
          });
        } else {
          const ppRows = await db.select().from(proposalProducts)
            .where(eq(proposalProducts.proposalId, input.proposalId));
          const productRows = await db.select().from(products).where(scope.products);
          const productMap = new Map(productRows.map(p => [p.id, p]));

          lineItems = ppRows.map(pp => {
            const prod = productMap.get(pp.productId);
            const qty = pp.quantity ?? 1;
            const price = parseFloat(pp.unitPrice?.toString() || prod?.basePrice?.toString() || "0");
            return {
              productName: prod?.name || "Product",
              sku: prod?.sku || null,
              color: null,
              size: null,
              quantity: qty,
              unitPrice: price,
              totalPrice: qty * price,
              imageUrl: prod?.imageUrl || null,
            };
          });
        }

        const subtotal = lineItems.reduce((sum, li) => sum + li.totalPrice, 0);
        const tax = parseFloat(input.tax || "0");
        const shipping = parseFloat(input.shipping || "0");
        const total = subtotal + tax + shipping;

        const invoiceValues: InsertInvoice = {
          ...scope.stamp,
          proposalId: input.proposalId,
          clientId: proposal.clientId,
          invoiceNumber: await nextDocumentNumber(scope.organizationId, ctx.user.id, "inv"),
          status: "draft",
          lineItems,
          subtotal: subtotal.toFixed(2),
          tax: tax.toFixed(2),
          shipping: shipping.toFixed(2),
          total: total.toFixed(2),
          notes: input.notes ?? null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        };

        const result = await db.insert(invoices).values(invoiceValues);
        const [created] = await db.select().from(invoices).where(eq(invoices.id, result[0].insertId)).limit(1);
        return created;
      }),

    /**
     * Build an invoice from scratch using the Document Canvas split-view
     * creation flow. Unlike `createFromProposal`, this path does not require
     * a pre-existing proposal — the distributor picks a client, builds line
     * items, and the server stamps the invoice with authoritative totals.
     *
     * Totals are recomputed server-side via the shared `computeTotals`
     * helper so the stored numbers cannot drift from what the canvas showed
     * the distributor (the UI uses the same helper for its live totals).
     */
    create: protectedProcedure
      .input(z.object({
        clientId: z.number(),
        lineItems: z.array(z.object({
          productName: z.string().min(1),
          description: z.string().optional().nullable(),
          sku: z.string().optional().nullable(),
          color: z.string().optional().nullable(),
          size: z.string().optional().nullable(),
          quantity: z.number().min(0),
          unitPrice: z.number().min(0),
          discountType: z.enum(["percent", "flat"]).optional(),
          discountValue: z.number().min(0).optional(),
          taxable: z.boolean().optional(),
          imageUrl: z.string().optional().nullable(),
        })).min(1, "An invoice needs at least one line item"),
        taxRate: z.number().min(0).max(1).optional().default(0),
        shipping: z.number().min(0).optional().default(0),
        notes: z.string().optional().nullable(),
        paymentTerms: z.enum(["due_on_receipt", "net_15", "net_30", "net_60", "custom"]),
        customDueDate: z.string().optional().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        // Verify the client belongs to this org/user. Without this check the
        // caller could stamp an invoice against a foreign client id.
        const [client] = await db.select().from(clients)
          .where(and(eq(clients.id, input.clientId), scope.clients))
          .limit(1);
        if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

        if (input.paymentTerms === "custom" && !input.customDueDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A custom due date is required when payment terms are Custom." });
        }

        const totals = computeTotals(
          input.lineItems.map(li => ({
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountType: li.discountType,
            discountValue: li.discountValue,
            taxable: li.taxable,
          })),
          { taxRate: input.taxRate, shipping: input.shipping },
        );

        const lineItems: InsertInvoice["lineItems"] = input.lineItems.map((li, idx) => ({
          productName: li.productName,
          description: li.description ?? null,
          sku: li.sku ?? null,
          color: li.color ?? null,
          size: li.size ?? null,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          totalPrice: totals.lines[idx].net,
          imageUrl: li.imageUrl ?? null,
          discountType: li.discountType,
          discountValue: li.discountValue,
          taxable: li.taxable ?? !client.taxExempt,
        }));

        const dueDate = resolveDueDate(input.paymentTerms as PaymentTerms, input.customDueDate ?? null);

        const invoiceValues: InsertInvoice = {
          ...scope.stamp,
          proposalId: null,
          clientId: input.clientId,
          invoiceNumber: await nextDocumentNumber(scope.organizationId, ctx.user.id, "inv"),
          status: "draft",
          lineItems,
          subtotal: totals.subtotal.toFixed(2),
          tax: totals.tax.toFixed(2),
          shipping: totals.shipping.toFixed(2),
          total: totals.grandTotal.toFixed(2),
          notes: input.notes ?? null,
          dueDate,
          paymentTerms: input.paymentTerms,
        };

        const result = await db.insert(invoices).values(invoiceValues);
        const [created] = await db.select().from(invoices).where(eq(invoices.id, result[0].insertId)).limit(1);
        return created;
      }),

    /**
     * Save Draft — permissive sibling of `create`. Accepts partial data
     * (empty line items, no client, no due date are all fine) so the
     * Document Canvas can autosave every 60s and every Save Draft click
     * while the distributor is still filling the form.
     *
     * • Without `id`: inserts a new row with status = "draft".
     * • With `id`: updates the existing draft in place. Only draft rows
     *   can be updated this way — sent/paid/void invoices are immutable
     *   through this mutation.
     *
     * Totals are recomputed server-side with the same shared helper as
     * `create` so drafts carry the same authoritative numbers. Any
     * skipped fields (missing unit prices, blank product names) simply
     * resolve to 0 — drafts are allowed to be empty.
     */
    saveDraft: protectedProcedure
      .input(z.object({
        id: z.number().optional(),
        clientId: z.number().optional().nullable(),
        lineItems: z.array(z.object({
          productName: z.string().optional().default(""),
          description: z.string().optional().nullable(),
          sku: z.string().optional().nullable(),
          color: z.string().optional().nullable(),
          size: z.string().optional().nullable(),
          quantity: z.number().min(0).optional().default(0),
          unitPrice: z.number().min(0).optional().default(0),
          discountType: z.enum(["percent", "flat"]).optional(),
          discountValue: z.number().min(0).optional(),
          taxable: z.boolean().optional(),
          imageUrl: z.string().optional().nullable(),
        })).optional().default([]),
        taxRate: z.number().min(0).max(1).optional().default(0),
        shipping: z.number().min(0).optional().default(0),
        notes: z.string().optional().nullable(),
        paymentTerms: z.enum(["due_on_receipt", "net_15", "net_30", "net_60", "custom"]).optional(),
        customDueDate: z.string().optional().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        // If a clientId was supplied, verify it belongs to the caller.
        // We don't require one — drafts can be client-less — but if set,
        // it can't point at a foreign tenant's client row.
        let clientTaxExempt = false;
        if (input.clientId != null) {
          const [client] = await db.select().from(clients)
            .where(and(eq(clients.id, input.clientId), scope.clients))
            .limit(1);
          if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
          clientTaxExempt = Boolean(client.taxExempt);
        }

        const totals = computeTotals(
          input.lineItems.map(li => ({
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountType: li.discountType,
            discountValue: li.discountValue,
            taxable: li.taxable,
          })),
          { taxRate: input.taxRate, shipping: input.shipping },
        );

        const lineItems: InsertInvoice["lineItems"] = input.lineItems.map((li, idx) => ({
          productName: li.productName,
          description: li.description ?? null,
          sku: li.sku ?? null,
          color: li.color ?? null,
          size: li.size ?? null,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          totalPrice: totals.lines[idx]?.net ?? 0,
          imageUrl: li.imageUrl ?? null,
          discountType: li.discountType,
          discountValue: li.discountValue,
          taxable: li.taxable ?? !clientTaxExempt,
        }));

        const dueDate = input.paymentTerms
          ? resolveDueDate(input.paymentTerms as PaymentTerms, input.customDueDate ?? null)
          : null;

        // ── Update path — only drafts can be edited in place ─────────────
        if (input.id != null) {
          const [existing] = await db.select().from(invoices)
            .where(and(eq(invoices.id, input.id), scope.invoices))
            .limit(1);
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
          if (existing.status !== "draft") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Only drafts can be updated — this invoice has already been sent.",
            });
          }

          await db.update(invoices).set({
            clientId: input.clientId ?? existing.clientId,
            lineItems,
            subtotal: totals.subtotal.toFixed(2),
            tax: totals.tax.toFixed(2),
            shipping: totals.shipping.toFixed(2),
            total: totals.grandTotal.toFixed(2),
            notes: input.notes ?? null,
            dueDate,
            paymentTerms: input.paymentTerms ?? null,
          }).where(eq(invoices.id, input.id));

          const [updated] = await db.select().from(invoices)
            .where(eq(invoices.id, input.id)).limit(1);
          return updated;
        }

        // ── Insert path — drafts can start without a clientId ───────────
        // The schema requires clientId NOT NULL, so a first-save without a
        // client is rejected with a clear message rather than a FK error.
        if (input.clientId == null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Pick a client before saving the draft.",
          });
        }

        const invoiceValues: InsertInvoice = {
          ...scope.stamp,
          proposalId: null,
          clientId: input.clientId,
          invoiceNumber: await nextDocumentNumber(scope.organizationId, ctx.user.id, "inv"),
          status: "draft",
          lineItems,
          subtotal: totals.subtotal.toFixed(2),
          tax: totals.tax.toFixed(2),
          shipping: totals.shipping.toFixed(2),
          total: totals.grandTotal.toFixed(2),
          notes: input.notes ?? null,
          dueDate,
          paymentTerms: input.paymentTerms ?? null,
        };

        const result = await db.insert(invoices).values(invoiceValues);
        const [created] = await db.select().from(invoices).where(eq(invoices.id, result[0].insertId)).limit(1);
        return created;
      }),

    /**
     * Send — the "commit" path that turns a draft into a live invoice:
     *
     *   1. Re-validates required fields (client, at least one priced line,
     *      a due date resolved from payment terms).
     *   2. If the distributor's Stripe Connect account can accept card
     *      payments AND the caller opted in via `acceptCard`, creates a
     *      Stripe Checkout Session on the platform account (matching the
     *      pattern used by proposal checkout). `client_reference_id` is
     *      `invoice_<id>` so the webhook can identify paid invoices.
     *   3. Mints a random 32-byte publicToken so the client can load the
     *      invoice at /invoices/pay/:token without authentication.
     *   4. Sends a distributor-branded "View & Pay Invoice" email.
     *   5. Flips status → "sent", stamps sentAt, persists the token + any
     *      checkout URL.
     *
     * Payment gating rule: when the distributor is NOT Stripe-eligible
     * the Checkout Session is skipped and the payload sets Pay Now to
     * hidden on the client (the public route returns stripeCheckoutUrl =
     * null). The distributor's Notes field becomes the payment
     * instructions (pay by check / ACH / etc).
     */
    send: protectedProcedure
      .input(z.object({
        id: z.number(),
        acceptCard: z.boolean().optional().default(false),
        toEmailOverride: z.string().email().optional(),
        origin: z.string().url().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        const [inv] = await db.select().from(invoices)
          .where(and(eq(invoices.id, input.id), scope.invoices))
          .limit(1);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

        // ── Validate required fields — an invoice has to name a client,
        //    list at least one priced line, and resolve to a concrete due
        //    date before it can go out the door.
        if (!inv.clientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a client before sending." });
        }
        const lines = inv.lineItems ?? [];
        if (lines.length === 0 || !lines.some(l => l.productName && l.quantity > 0)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one line item with a description and quantity." });
        }
        if (!inv.dueDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Set payment terms (and a due date if custom) before sending." });
        }

        const [client] = await db.select().from(clients).where(eq(clients.id, inv.clientId)).limit(1);
        const toEmail = input.toEmailOverride || client?.contactEmail;
        if (!toEmail) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No client email on file — add a contact email or pass an override." });
        }

        // ── Stripe Checkout Session — optional, gated on distributor
        //    Connect status. If anything here fails we fall back to the
        //    "pay by check/transfer" flow rather than blocking the send.
        const [distributor] = await db.select({
          stripeConnectChargesEnabled: users.stripeConnectChargesEnabled,
          stripeConnectPayoutsEnabled: users.stripeConnectPayoutsEnabled,
        }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
        const cardEligible = Boolean(
          distributor?.stripeConnectChargesEnabled &&
          distributor?.stripeConnectPayoutsEnabled &&
          ENV.stripeSecretKey,
        );

        // Mint the publicToken once per invoice; reuse if already present
        // (e.g. re-send after an expired checkout session).
        const publicToken = inv.publicToken ?? randomBytes(32).toString("hex");

        const originBase = input.origin
          || process.env.APP_BASE_URL
          || process.env.PUBLIC_BASE_URL
          || "https://app.mergetasks.com";
        const publicInvoiceUrl = `${originBase.replace(/\/$/, "")}/invoices/pay/${publicToken}`;

        let checkoutUrl: string | null = inv.stripeCheckoutUrl ?? null;
        let checkoutSessionId: string | null = inv.stripeCheckoutSessionId ?? null;

        if (cardEligible && input.acceptCard) {
          try {
            const stripe = getStripe();
            const amountCents = Math.round(parseFloat(inv.total || "0") * 100);
            if (amountCents <= 0) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice total must be greater than zero to accept a card payment." });
            }
            const session = await stripe.checkout.sessions.create({
              mode: "payment",
              line_items: [{
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: `Invoice ${inv.invoiceNumber}`,
                    description: client?.companyName ? `For ${client.companyName}` : undefined,
                  },
                  unit_amount: amountCents,
                },
                quantity: 1,
              }],
              success_url: `${publicInvoiceUrl}?checkout=success`,
              cancel_url: `${publicInvoiceUrl}?checkout=canceled`,
              customer_email: toEmail,
              client_reference_id: `invoice_${inv.id}`,
              metadata: {
                invoice_id: inv.id.toString(),
                invoice_number: inv.invoiceNumber,
                distributor_user_id: ctx.user.id.toString(),
              },
            });
            checkoutUrl = session.url ?? null;
            checkoutSessionId = session.id;
          } catch (err) {
            // Checkout failure must not lose the send — log and fall
            // through to the non-card flow. The public page will render
            // with Pay-by-transfer instructions instead of a Pay Now.
            log.warn(`Invoice ${inv.id} checkout session creation failed:`, err);
            checkoutUrl = null;
            checkoutSessionId = null;
          }
        }

        // ── Build the distributor-branded email with a "View & Pay
        //    Invoice" CTA pointing at the public payment route. The
        //    CTA text changes copy slightly when card pay isn't set up.
        const resolved = await resolveTier2({
          distributorUserId: ctx.user.id,
          organizationId: ctx.organizationId ?? null,
        });

        const meta: Array<{ label: string; value: string }> = [
          { label: "Invoice #", value: inv.invoiceNumber },
          { label: "Issued", value: (inv.createdAt ?? new Date()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) },
          { label: "Due", value: inv.dueDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) },
        ];
        const total = parseFloat(inv.total || "0");
        const html = buildEmailHtml({
          branding: {
            lane: "distributor",
            companyName: resolved.branding.companyName,
            primaryColor: resolved.branding.primaryColor,
            logoUrl: resolved.branding.logoUrl,
          },
          badge: { text: "Invoice" },
          headline: "Your invoice is ready",
          subheadline: `Invoice ${inv.invoiceNumber}${client?.companyName ? ` for ${client.companyName}` : ""}`,
          bodyParagraphs: [
            `${resolved.branding.companyName || "Your distributor"} has sent you an invoice for your review.`,
            `Total due: ${formatCurrency(total)}`,
            ...(inv.notes ? [`<strong>Notes:</strong> ${inv.notes}`] : []),
            checkoutUrl
              ? "Click below to view the full invoice and pay securely by card."
              : "Click below to view the full invoice. Payment instructions are included on the invoice.",
          ],
          infoCard: {
            title: `Invoice ${inv.invoiceNumber}`,
            subtitle: `Total due: ${formatCurrency(total)}`,
            meta,
          },
          cta: {
            label: checkoutUrl ? "View & Pay Invoice" : "View Invoice",
            url: publicInvoiceUrl,
          },
        });

        const result = await sendEmail(
          toEmail,
          `${resolved.branding.companyName || "Invoice"} — Invoice ${inv.invoiceNumber}`,
          html,
          resolved.fromName,
          resolved.replyTo,
        );
        if (!result.sent) {
          log.error(`Failed to send invoice ${inv.id} to ${toEmail}: ${result.error}`);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Email delivery failed: ${result.error || "unknown"}` });
        }

        await db.update(invoices).set({
          status: "sent",
          sentAt: new Date(),
          publicToken,
          stripeCheckoutSessionId: checkoutSessionId,
          stripeCheckoutUrl: checkoutUrl,
        }).where(eq(invoices.id, inv.id));

        return {
          success: true,
          sentTo: toEmail,
          publicToken,
          stripeCheckoutUrl: checkoutUrl,
          cardPaymentEnabled: Boolean(checkoutUrl),
        };
      }),

    updateStatus: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["draft", "sent", "paid", "overdue", "cancelled", "void"]),
        paymentMethod: z.string().optional(),
        paymentReference: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const [inv] = await db.select().from(invoices)
          .where(and(eq(invoices.id, input.id), scope.invoices))
          .limit(1);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

        const setObj: Record<string, unknown> = { status: input.status };
        if (input.status === "paid") {
          setObj.paidAt = new Date();
          if (input.paymentMethod) setObj.paymentMethod = input.paymentMethod;
          if (input.paymentReference) setObj.paymentReference = input.paymentReference;
        }
        if (input.status === "sent") setObj.sentAt = new Date();

        await db.update(invoices).set(setObj).where(eq(invoices.id, input.id));
        const [updated] = await db.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
        return updated;
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

        const [inv] = await db.select().from(invoices)
          .where(and(eq(invoices.id, input.id), scope.invoices))
          .limit(1);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

        await db.delete(invoices).where(and(eq(invoices.id, input.id), scope.invoices));
        return { success: true };
      }),

    /**
     * Send the invoice to the client via email (distributor-branded).
     * Mirrors estimates.sendToClient. Flips status → "sent" + stamps
     * sentAt only after Resend confirms delivery.
     */
    sendToClient: protectedProcedure
      .input(z.object({
        id: z.number(),
        toEmailOverride: z.string().email().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        const scope = getOrgScope(ctx);

        const [inv] = await db.select().from(invoices)
          .where(and(eq(invoices.id, input.id), scope.invoices))
          .limit(1);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

        const [client] = await db.select().from(clients).where(eq(clients.id, inv.clientId)).limit(1);
        const toEmail = input.toEmailOverride || client?.contactEmail;
        if (!toEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "No client email on file — add a contact email or pass an override" });

        const resolved = await resolveTier2({
          distributorUserId: ctx.user.id,
          organizationId: ctx.organizationId ?? null,
        });

        const html = buildDocumentEmailHtml({
          kind: "invoice",
          documentNumber: inv.invoiceNumber,
          clientName: client?.contactName || client?.companyName || null,
          createdAt: inv.createdAt ?? new Date(),
          dueDate: inv.dueDate ?? null,
          subtotal: inv.subtotal,
          tax: inv.tax,
          shipping: inv.shipping,
          total: inv.total,
          notes: inv.notes,
          branding: resolved.branding,
        });

        const result = await sendEmail(
          toEmail,
          `${resolved.branding.companyName || "Invoice"} — Invoice ${inv.invoiceNumber}`,
          html,
          resolved.fromName,
          resolved.replyTo,
        );
        if (!result.sent) {
          log.error(`Failed to send invoice ${inv.id} to ${toEmail}: ${result.error}`);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Email delivery failed: ${result.error || "unknown"}` });
        }

        await db.update(invoices).set({ status: "sent", sentAt: new Date() }).where(eq(invoices.id, inv.id));
        return { success: true, sentTo: toEmail };
      }),
  }),
});
