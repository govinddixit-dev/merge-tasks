/**
 * copilotExecProposals.ts — Proposal management executors for the AI copilot.
 *
 * Handles: getDetails, list, update, delete, duplicate, configureCatalogVariants
 */
import { getDb } from "../db";
import {
  clients, products, proposals, proposalProducts,
  proposalProductVariants, proposalPriceTiers,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { buildToolScope } from "./copilotExecScope";

export async function executeGetProposalDetails(userId: number, organizationId: number | null, args: { proposalId: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const proposalRows = await db.select().from(proposals)
    .where(and(eq(proposals.id, args.proposalId), scope.proposals))
    .limit(1);
  if (proposalRows.length === 0) return { error: `Proposal ID ${args.proposalId} not found` };

  const proposal = proposalRows[0];

  let clientName = "Unknown";
  if (proposal.clientId) {
    const clientRows = await db.select({ companyName: clients.companyName })
      .from(clients).where(eq(clients.id, proposal.clientId)).limit(1);
    if (clientRows.length > 0) clientName = clientRows[0].companyName;
  }

  const productRows = await db.select({
    id: proposalProducts.id,
    productId: proposalProducts.productId,
    name: products.name,
    quantity: proposalProducts.quantity,
    unitPrice: proposalProducts.unitPrice,
    decorationType: proposalProducts.decorationType,
    decorationNotes: proposalProducts.decorationNotes,
  }).from(proposalProducts)
    .leftJoin(products, eq(products.id, proposalProducts.productId))
    .where(eq(proposalProducts.proposalId, args.proposalId));

  const total = productRows.reduce((sum, p) => {
    return sum + (Number(p.quantity || 0) * Number(p.unitPrice || 0));
  }, 0);

  return {
    proposal: {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      clientName,
      notes: proposal.notes,
      validDays: proposal.validDays,
      createdAt: proposal.createdAt,
    },
    products: productRows.map(p => ({
      name: p.name,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
      lineTotal: (Number(p.quantity || 0) * Number(p.unitPrice || 0)).toFixed(2),
      decorationType: p.decorationType,
      decorationNotes: p.decorationNotes,
    })),
    estimatedTotal: total.toFixed(2),
    productCount: productRows.length,
  };
}

export async function executeListProposals(userId: number, organizationId: number | null, args: { status?: string; clientId?: number; limit?: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const conditions = [scope.proposals];
  if (args.status) conditions.push(eq(proposals.status, args.status as "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired"));
  if (args.clientId) conditions.push(eq(proposals.clientId, args.clientId));

  const rows = await db.select().from(proposals)
    .where(and(...conditions))
    .orderBy(desc(proposals.createdAt))
    .limit(args.limit || 20);

  const propClientIds = Array.from(new Set(rows.map(r => r.clientId))) as number[];
  const clientMap = new Map<number, string>();
  if (propClientIds.length > 0) {
    const clientRows = await db.select({ id: clients.id, companyName: clients.companyName }).from(clients)
      .where(scope.clients);
    clientRows.forEach(c => clientMap.set(c.id, c.companyName));
  }

  return {
    count: rows.length,
    proposals: rows.map(r => ({
      id: r.id, title: r.title, status: r.status,
      clientName: clientMap.get(r.clientId) || "Unknown",
      estimatedValue: r.estimatedValue, validDays: r.validDays,
      sentAt: r.sentAt, createdAt: r.createdAt,
    })),
  };
}

export async function executeUpdateProposal(userId: number, organizationId: number | null, args: {
  proposalId: number; title?: string; notes?: string; validDays?: number; status?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const existing = await db.select().from(proposals)
    .where(and(eq(proposals.id, args.proposalId), scope.proposals)).limit(1);
  if (existing.length === 0) return { error: `Proposal ID ${args.proposalId} not found` };

  const updates: Record<string, any> = {};
  if (args.title) updates.title = args.title;
  if (args.notes !== undefined) updates.notes = args.notes;
  if (args.validDays) updates.validDays = args.validDays;
  if (args.status) updates.status = args.status;

  if (Object.keys(updates).length === 0) return { error: "No fields to update" };

  await db.update(proposals).set(updates).where(and(eq(proposals.id, args.proposalId), scope.proposals));
  return { success: true, proposalId: args.proposalId, updated: Object.keys(updates) };
}

export async function executeDeleteProposal(userId: number, organizationId: number | null, args: { proposalId: number; confirm: boolean }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);
  if (!args.confirm) return { error: "Deletion not confirmed. Set confirm: true to proceed." };

  const existing = await db.select().from(proposals)
    .where(and(eq(proposals.id, args.proposalId), scope.proposals)).limit(1);
  if (existing.length === 0) return { error: `Proposal ID ${args.proposalId} not found` };

  const title = existing[0].title;
  await db.delete(proposalProducts).where(eq(proposalProducts.proposalId, args.proposalId));
  await db.delete(proposals).where(and(eq(proposals.id, args.proposalId), scope.proposals));
  return { success: true, deleted: title };
}

export async function executeDuplicateProposal(userId: number, organizationId: number | null, args: {
  proposalId: number; newTitle?: string; newClientId?: number;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const existing = await db.select().from(proposals)
    .where(and(eq(proposals.id, args.proposalId), scope.proposals)).limit(1);
  if (existing.length === 0) return { error: `Proposal ID ${args.proposalId} not found` };

  const original = existing[0];
  const viewToken = nanoid(24);

  const result = await db.insert(proposals).values({
    userId,
    // Audit fix #17: stamp organizationId so duplicated proposals are visible to team
    organizationId: organizationId ?? null,
    clientId: args.newClientId || original.clientId,
    title: args.newTitle || `Copy of ${original.title}`,
    proposalType: original.proposalType,
    status: "draft",
    estimatedValue: original.estimatedValue,
    deliveryMethod: original.deliveryMethod,
    storeId: original.storeId,
    stripeCheckout: original.stripeCheckout,
    multiDepartment: original.multiDepartment,
    approvalRouting: original.approvalRouting,
    virtualProofs: original.virtualProofs,
    notes: original.notes,
    validDays: original.validDays,
    viewToken,
    sentAt: null,
  });

  const newId = Number(result[0].insertId);

  const ppRows = await db.select().from(proposalProducts)
    .where(eq(proposalProducts.proposalId, args.proposalId));
  for (const pp of ppRows) {
    await db.insert(proposalProducts).values({
      proposalId: newId,
      productId: pp.productId,
      quantity: pp.quantity,
      unitPrice: pp.unitPrice,
      decorationType: pp.decorationType,
      decorationNotes: pp.decorationNotes,
    });
  }

  return {
    success: true, newProposalId: newId,
    title: args.newTitle || `Copy of ${original.title}`,
    productCount: ppRows.length,
  };
}

export async function executeConfigureCatalogVariants(userId: number, organizationId: number | null, args: {
  proposalProductId: number;
  colors?: string[];
  sizes?: string[];
  priceTiers?: Array<{ tierType: string; label: string; minQty?: number; maxQty?: number; price: string }>;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const ppRows = await db.select().from(proposalProducts)
    .where(eq(proposalProducts.id, args.proposalProductId)).limit(1);
  if (ppRows.length === 0) return { error: `Proposal product ID ${args.proposalProductId} not found` };

  const pp = ppRows[0];
  const proposalRows = await db.select().from(proposals)
    .where(and(eq(proposals.id, pp.proposalId), scope.proposals)).limit(1);
  if (proposalRows.length === 0) return { error: "Proposal not found or doesn't belong to you" };

  let colorsAdded = 0;
  let sizesAdded = 0;
  let tiersAdded = 0;

  if (args.colors && args.colors.length > 0) {
    await db.delete(proposalProductVariants)
      .where(and(eq(proposalProductVariants.proposalProductId, args.proposalProductId), eq(proposalProductVariants.variantType, "color")));
    for (const color of args.colors) {
      await db.insert(proposalProductVariants).values({
        proposalProductId: args.proposalProductId,
        variantType: "color" as const,
        value: color,
      });
      colorsAdded++;
    }
  }

  if (args.sizes && args.sizes.length > 0) {
    await db.delete(proposalProductVariants)
      .where(and(eq(proposalProductVariants.proposalProductId, args.proposalProductId), eq(proposalProductVariants.variantType, "size")));
    for (const size of args.sizes) {
      await db.insert(proposalProductVariants).values({
        proposalProductId: args.proposalProductId,
        variantType: "size" as const,
        value: size,
      });
      sizesAdded++;
    }
  }

  if (args.priceTiers && args.priceTiers.length > 0) {
    await db.delete(proposalPriceTiers)
      .where(eq(proposalPriceTiers.proposalProductId, args.proposalProductId));
    for (const tier of args.priceTiers) {
      await db.insert(proposalPriceTiers).values({
        proposalProductId: args.proposalProductId,
        tierType: tier.tierType as "quantity" | "size",
        label: tier.label,
        minQty: tier.minQty || null,
        maxQty: tier.maxQty || null,
        price: tier.price,
      });
      tiersAdded++;
    }
  }

  return {
    success: true, proposalProductId: args.proposalProductId,
    colorsAdded, sizesAdded, tiersAdded,
  };
}
