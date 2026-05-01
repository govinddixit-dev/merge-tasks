/**
 * proposalsCrud — Core CRUD procedures for proposals.
 *
 * Procedures: list, getById, create, update, delete, duplicate
 */
import { z } from "zod";
import { eq, and, or, desc, inArray, count } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  proposals, proposalProducts, clients, products, virtualProofs,
  distributorProfiles, departmentApprovals, proposalVersions,
  proposalProductVariants, proposalPriceTiers, proposalProductImages,
  proposalSizeCharts, proposalOrderItems,
  productImprintZones,
  estimates, invoices, purchaseOrders, refundRequests,
  type InsertProposal, type InsertProposalProduct,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { getOrgScope } from "../utils/orgScope";
import { checkProposalMonthlyLimit } from "../utils/planLimits";

export const proposalsCrudRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["draft", "sent", "viewed", "accepted", "declined", "expired"]).optional(),
        clientId: z.number().optional(),
        limit: z.number().min(1).max(200).optional().default(50),
        offset: z.number().min(0).optional().default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const [{ cnt: totalCount }] = await db
        .select({ cnt: count() })
        .from(proposals)
        .where(scope.proposals);

      const rows = await db
        .select()
        .from(proposals)
        .where(scope.proposals)
        .orderBy(desc(proposals.updatedAt))
        .limit(limit + 1)
        .offset(offset);

      let filtered = rows;
      if (input?.status) filtered = filtered.filter(p => p.status === input.status);
      if (input?.clientId) filtered = filtered.filter(p => p.clientId === input.clientId);

      const clientIds = Array.from(new Set(filtered.map(p => p.clientId).filter(Boolean))) as number[];
      const clientRows = clientIds.length > 0
        ? await db.select().from(clients).where(and(inArray(clients.id, clientIds), scope.clients))
        : [];
      const clientMap = new Map(clientRows.map(c => [c.id, c]));

      const allProposalIds = filtered.map(p => p.id);
      const ppRows = allProposalIds.length > 0
        ? await db.select().from(proposalProducts).where(inArray(proposalProducts.proposalId, allProposalIds))
        : [];
      const productsByProposal = new Map<number, typeof ppRows>();
      for (const pp of ppRows) {
        if (!productsByProposal.has(pp.proposalId)) productsByProposal.set(pp.proposalId, []);
        productsByProposal.get(pp.proposalId)!.push(pp);
      }

      // Defense in depth: even if a cross-tenant proposalProducts row exists
      // (write-path bug, historical data, manual SQL), scope.products keeps
      // the foreign product row out of the response. Any unmatched productId
      // resolves to "Unknown" via the optional-chain at the projection step
      // — same behavior as a deleted product.
      const allProductIds = Array.from(new Set(ppRows.map(pp => pp.productId))) as number[];
      const productRows = allProductIds.length > 0
        ? await db.select().from(products).where(and(inArray(products.id, allProductIds), scope.products))
        : [];
      const productMap = new Map(productRows.map(p => [p.id, p]));

      const hasMore = filtered.length > limit;
      const page = hasMore ? filtered.slice(0, limit) : filtered;
      const items = page.map(p => {
        const pProducts = productsByProposal.get(p.id) || [];
        return {
          ...p,
          client: clientMap.get(p.clientId) ?? null,
          productCount: pProducts.length,
          products: pProducts.map(pp => {
            const prod = productMap.get(pp.productId);
            return {
              name: prod?.name || "Unknown",
              sku: prod?.sku || "",
              qty: pp.quantity,
              price: parseFloat(pp.unitPrice || "0"),
              decoration: pp.decorationType || "",
            };
          }),
        };
      });
      return { items, total: Number(totalCount), hasMore, nextOffset: hasMore ? offset + limit : null };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const rows = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.id), scope.proposals))
        .limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const proposal = rows[0];

      const ppRows = await db
        .select()
        .from(proposalProducts)
        .where(eq(proposalProducts.proposalId, proposal.id));

      const productIds = ppRows.map(pp => pp.productId);
      const productRows = productIds.length > 0
        ? await db.select().from(products).where(and(inArray(products.id, productIds), scope.products))
        : [];
      const productMap = new Map(productRows.map(p => [p.id, p]));

      const proofRows = await db
        .select()
        .from(virtualProofs)
        .where(and(scope.virtualProofs, eq(virtualProofs.proposalId, proposal.id)));
      const proofByProduct = new Map(proofRows.map(p => [p.productId, p]));

      const clientRows = await db
        .select()
        .from(clients)
        .where(eq(clients.id, proposal.clientId))
        .limit(1);

      // Resolve imprintZoneId → { label, slug } for every line that has one.
      // One batched query keyed by id; zones can be selected independently of
      // org scope because ownership is already enforced via the parent product.
      const zoneIds = ppRows.map(pp => pp.imprintZoneId).filter((v): v is number => v != null);
      const zoneRows = zoneIds.length > 0
        ? await db
          .select({
            id: productImprintZones.id,
            label: productImprintZones.label,
            slug: productImprintZones.slug,
          })
          .from(productImprintZones)
          .where(inArray(productImprintZones.id, zoneIds))
        : [];
      const zoneMap = new Map(zoneRows.map(z => [z.id, z]));

      const enrichedProducts = ppRows.map(pp => {
        const product = productMap.get(pp.productId);
        const proof = proofByProduct.get(pp.productId);
        const zone = pp.imprintZoneId != null ? zoneMap.get(pp.imprintZoneId) : undefined;
        return {
          ...pp,
          product: product ? {
            id: product.id,
            name: product.name,
            category: product.category,
            imageUrl: product.imageUrl,
            basePrice: product.basePrice,
            sku: product.sku,
            description: product.description,
            decorationMethods: product.decorationMethods,
            externalId: product.externalId,
            externalSource: product.externalSource,
            supplierCode: product.supplierCode,
            productNumber: product.productNumber,
            hasLiveInventory: product.hasLiveInventory,
            currency: product.currency,
            colors: product.colors,
            sizes: product.sizes,
          } : null,
          proof: proof ? {
            id: proof.id,
            status: proof.status,
            proofImageUrl: proof.proofImageUrl,
            decorationMethod: proof.decorationMethod,
            decorationZone: proof.decorationZone,
            approvedAt: proof.approvedAt,
          } : null,
          imprintZone: zone ? { id: zone.id, label: zone.label, slug: zone.slug } : null,
        };
      });

      return {
        ...proposal,
        products: enrichedProducts,
        proofs: proofRows,
        client: clientRows[0] ?? null,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        clientId: z.number(),
        title: z.string().min(1),
        proposalType: z.enum(["promo", "print", "promo_print"]).optional(),
        deliveryMethod: z.enum(["email", "webstore", "both"]).optional(),
        storeId: z.number().optional(),
        stripeCheckout: z.boolean().optional(),
        multiDepartment: z.boolean().optional(),
        approvalRouting: z.enum(["parallel", "sequential"]).optional(),
        virtualProofs: z.boolean().optional(),
        approvalLinkExpiryEnabled: z.boolean().optional(),
        notes: z.string().optional(),
        validDays: z.number().optional(),
        status: z.enum(["draft", "sent"]).optional(),
        products: z.array(
          z.object({
            productId: z.number(),
            quantity: z.number().optional(),
            unitPrice: z.string().optional(),
            decorationType: z.string().optional(),
            decorationNotes: z.string().optional(),
            imprintZoneId: z.number().int().positive().nullable().optional(),
          })
        ).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const clientRows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, input.clientId), scope.clients))
        .limit(1);
      if (clientRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      // Validate every productId in the payload belongs to the caller's
      // org BEFORE allocating any DB rows. Without this, the FK accepts
      // foreign productIds and the resulting proposalProducts row leaks
      // the foreign product's name/sku via proposals.list. NOT_FOUND
      // (not FORBIDDEN) avoids existence disclosure for foreign IDs.
      if (input.products && input.products.length > 0) {
        const inputProductIds = input.products.map(p => p.productId);
        const validProducts = await db
          .select({ id: products.id })
          .from(products)
          .where(and(inArray(products.id, inputProductIds), scope.products));
        if (validProducts.length !== new Set(inputProductIds).size) {
          const validIds = new Set(validProducts.map(p => p.id));
          const invalidIds = inputProductIds.filter(id => !validIds.has(id));
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Product not found: ${invalidIds.join(", ")}`,
          });
        }
      }

      let estimatedValue = "0.00";
      if (input.products && input.products.length > 0) {
        const total = input.products.reduce((sum, p) => {
          const price = parseFloat(p.unitPrice ?? "0");
          return sum + price * (p.quantity ?? 1);
        }, 0);
        estimatedValue = total.toFixed(2);
      }

      const viewToken = nanoid(24);

      const values: InsertProposal = {
        ...scope.stamp,
        clientId: input.clientId,
        title: input.title,
        proposalType: input.proposalType ?? "promo",
        status: input.status ?? "draft",
        estimatedValue,
        deliveryMethod: input.deliveryMethod ?? "email",
        storeId: input.storeId ?? null,
        stripeCheckout: input.stripeCheckout ?? false,
        multiDepartment: input.multiDepartment ?? false,
        approvalRouting: input.approvalRouting ?? "parallel",
        virtualProofs: input.virtualProofs ?? false,
        approvalLinkExpiryEnabled: input.approvalLinkExpiryEnabled ?? false,
        notes: input.notes ?? null,
        validDays: input.validDays ?? 30,
        viewToken,
        sentAt: input.status === "sent" ? new Date() : null,
      };

      let proposalId: number;
      await db.transaction(async (tx) => {
        await checkProposalMonthlyLimit(tx, scope, ctx.user.subscriptionTier);
        const result = await tx.insert(proposals).values(values);
        proposalId = result[0].insertId;

        if (input.products && input.products.length > 0) {
          const ppValues: InsertProposalProduct[] = input.products.map(p => ({
            proposalId: proposalId!,
            productId: p.productId,
            quantity: p.quantity ?? 1,
            unitPrice: p.unitPrice ?? null,
            decorationType: p.decorationType ?? null,
            decorationNotes: p.decorationNotes ?? null,
            imprintZoneId: p.imprintZoneId ?? null,
          }));
          await tx.insert(proposalProducts).values(ppValues);
        }
      });

      const created = await db.select().from(proposals).where(eq(proposals.id, proposalId!)).limit(1);
      return created[0];
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        proposalType: z.enum(["promo", "print", "promo_print"]).optional(),
        deliveryMethod: z.enum(["email", "webstore", "both"]).optional(),
        storeId: z.number().nullable().optional(),
        stripeCheckout: z.boolean().optional(),
        multiDepartment: z.boolean().optional(),
        approvalRouting: z.enum(["parallel", "sequential"]).optional(),
        virtualProofs: z.boolean().optional(),
        approvalLinkExpiryEnabled: z.boolean().optional(),
        notes: z.string().optional(),
        validDays: z.number().optional(),
        estimatedValue: z.string().optional(),
        products: z.array(z.object({
          productId: z.number(),
          quantity: z.number().default(1),
          unitPrice: z.string().optional(),
          decorationType: z.string().optional(),
          decorationNotes: z.string().optional(),
          imprintZoneId: z.number().int().positive().nullable().optional(),
        })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const { id, products: inputProducts, ...updateData } = input;

      const existing = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, id), scope.proposals))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      // Same scope check as create: any productId in the updated set must
      // belong to the caller's org. Empty array (clear all products) is
      // legitimate and bypasses the check.
      if (inputProducts !== undefined && inputProducts.length > 0) {
        const inputProductIds = inputProducts.map(p => p.productId);
        const validProducts = await db
          .select({ id: products.id })
          .from(products)
          .where(and(inArray(products.id, inputProductIds), scope.products));
        if (validProducts.length !== new Set(inputProductIds).size) {
          const validIds = new Set(validProducts.map(p => p.id));
          const invalidIds = inputProductIds.filter(id => !validIds.has(id));
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Product not found: ${invalidIds.join(", ")}`,
          });
        }
      }

      const setObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (value !== undefined) setObj[key] = value;
      }

      await db.transaction(async (tx) => {
        if (Object.keys(setObj).length > 0) {
          await tx.update(proposals).set(setObj).where(and(eq(proposals.id, id), scope.proposals));
        }

        if (inputProducts !== undefined) {
          await tx.delete(proposalProducts).where(eq(proposalProducts.proposalId, id));
          if (inputProducts.length > 0) {
            const ppValues: InsertProposalProduct[] = inputProducts.map(p => ({
              proposalId: id,
              productId: p.productId,
              quantity: p.quantity,
              unitPrice: p.unitPrice || null,
              decorationType: p.decorationType || "Standard",
              decorationNotes: p.decorationNotes || null,
              imprintZoneId: p.imprintZoneId ?? null,
            }));
            await tx.insert(proposalProducts).values(ppValues);
          }
        }
      });

      const updated = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1);

      // Record version history
      const old = existing[0];
      const changes: string[] = [];
      if (input.title !== undefined && input.title !== old.title) changes.push(`Title changed to "${input.title}"`);
      if (input.estimatedValue !== undefined && input.estimatedValue !== (old.estimatedValue ?? "")) changes.push(`Estimated value updated to $${input.estimatedValue}`);
      if (input.proposalType !== undefined && input.proposalType !== old.proposalType) changes.push(`Proposal type changed to ${input.proposalType}`);
      if (input.deliveryMethod !== undefined && input.deliveryMethod !== old.deliveryMethod) changes.push(`Delivery method changed to ${input.deliveryMethod}`);
      if (input.validDays !== undefined && input.validDays !== old.validDays) changes.push(`Valid days changed to ${input.validDays === 0 ? "No Expiration" : input.validDays + " days"}`);
      if (input.multiDepartment !== undefined && input.multiDepartment !== old.multiDepartment) changes.push(input.multiDepartment ? "Multi-department enabled" : "Multi-department disabled");
      if (input.stripeCheckout !== undefined && input.stripeCheckout !== old.stripeCheckout) changes.push(input.stripeCheckout ? "Stripe checkout enabled" : "Stripe checkout disabled");
      if (input.approvalLinkExpiryEnabled !== undefined && input.approvalLinkExpiryEnabled !== old.approvalLinkExpiryEnabled) changes.push(input.approvalLinkExpiryEnabled ? "Approval link expiry enabled (72h)" : "Approval link expiry disabled");
      if (input.approvalRouting !== undefined && input.approvalRouting !== old.approvalRouting) changes.push(`Approval routing changed to ${input.approvalRouting}`);
      if (input.notes !== undefined && input.notes !== (old.notes ?? "")) changes.push("Notes updated");
      if (inputProducts !== undefined) changes.push(`Products updated (${inputProducts.length} items)`);
      if (changes.length === 0) changes.push("Draft saved");

      const ppRows = await db.select().from(proposalProducts).where(eq(proposalProducts.proposalId, id));
      const deptRows = await db.select().from(departmentApprovals).where(eq(departmentApprovals.proposalId, id));

      await db.insert(proposalVersions).values({
        proposalId: id,
        userId: ctx.user.id,
        authorName: ctx.user.name || "Distributor",
        snapshotTitle: updated[0].title,
        snapshotEstimatedValue: updated[0].estimatedValue,
        snapshotStatus: updated[0].status,
        snapshotProductCount: ppRows.length,
        snapshotDepartmentCount: deptRows.length,
        changes,
        action: "updated",
      });

      return updated[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.id), scope.proposals))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const proposalId = input.id;

      await db.transaction(async (tx) => {
        // Resolve dependent IDs for grandchild cleanup.
        const productRows = await tx
          .select({ id: proposalProducts.id })
          .from(proposalProducts)
          .where(eq(proposalProducts.proposalId, proposalId));
        const proposalProductIds = productRows.map((r) => r.id);

        const estimateRows = await tx
          .select({ id: estimates.id })
          .from(estimates)
          .where(eq(estimates.proposalId, proposalId));
        const estimateIds = estimateRows.map((r) => r.id);

        // purchaseOrders reference proposalId (nullable). purchaseOrderEvents cascade.
        await tx.delete(purchaseOrders).where(eq(purchaseOrders.proposalId, proposalId));

        // invoices may link via proposalId or estimateId.
        const invConds = [eq(invoices.proposalId, proposalId)];
        if (estimateIds.length) invConds.push(inArray(invoices.estimateId, estimateIds));
        await tx.delete(invoices).where(invConds.length === 1 ? invConds[0] : or(...invConds));

        // estimates (proposalId NOT NULL).
        await tx.delete(estimates).where(eq(estimates.proposalId, proposalId));

        // proposalProducts grandchildren.
        if (proposalProductIds.length) {
          await tx.delete(proposalProductVariants).where(inArray(proposalProductVariants.proposalProductId, proposalProductIds));
          await tx.delete(proposalPriceTiers).where(inArray(proposalPriceTiers.proposalProductId, proposalProductIds));
          await tx.delete(proposalProductImages).where(inArray(proposalProductImages.proposalProductId, proposalProductIds));
          await tx.delete(proposalSizeCharts).where(inArray(proposalSizeCharts.proposalProductId, proposalProductIds));
        }
        await tx.delete(proposalOrderItems).where(eq(proposalOrderItems.proposalId, proposalId));

        await tx.delete(virtualProofs).where(eq(virtualProofs.proposalId, proposalId));
        await tx.delete(departmentApprovals).where(eq(departmentApprovals.proposalId, proposalId));
        await tx.delete(proposalVersions).where(eq(proposalVersions.proposalId, proposalId));
        await tx.delete(refundRequests).where(eq(refundRequests.proposalId, proposalId));

        await tx.delete(proposalProducts).where(eq(proposalProducts.proposalId, proposalId));
        await tx.delete(proposals).where(and(eq(proposals.id, proposalId), scope.proposals));
      });
      return { success: true };
    }),

  duplicate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [original] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.id), scope.proposals))
        .limit(1);
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      const originalProducts = await db
        .select()
        .from(proposalProducts)
        .where(eq(proposalProducts.proposalId, input.id));

      let newProposalId: number;
      await db.transaction(async (tx) => {
        const [newProposal] = await tx.insert(proposals).values({
          ...scope.stamp,
          clientId: original.clientId,
          title: `${original.title} (Copy)`,
          proposalType: original.proposalType,
          estimatedValue: original.estimatedValue,
          validDays: original.validDays,
          deliveryMethod: original.deliveryMethod,
          stripeCheckout: original.stripeCheckout,
          multiDepartment: original.multiDepartment,
          virtualProofs: original.virtualProofs,
          approvalLinkExpiryEnabled: original.approvalLinkExpiryEnabled,
          notes: original.notes,
          viewToken: null,
          sentAt: null,
          viewedAt: null,
        }).$returningId();
        newProposalId = newProposal.id;

        if (originalProducts.length > 0) {
          await tx.insert(proposalProducts).values(
            originalProducts.map(p => ({
              proposalId: newProposal.id,
              productId: p.productId,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              decorationType: p.decorationType,
              decorationNotes: p.decorationNotes,
              imprintZoneId: p.imprintZoneId,
            }))
          );
        }
      });

      return { id: newProposalId!, title: `${original.title} (Copy)` };
    }),
});
