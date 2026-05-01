/**
 * copilotExec/proposals.ts
 * Executors for the create_proposal and send_proposal copilot tools.
 */

import { eq, and, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  clients,
  products,
  proposals,
  proposalProducts,
  distributorProfiles,
  type InsertProposal,
  type InsertProposalProduct,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { buildProposalEmail, type ProposalEmailProduct, type ProposalEmailBranding } from "../../email/proposalEmail";
import { sendEmail } from "../../email/mailer";
import { buildToolScope } from "./scope";

export async function executeCreateProposal(
  userId: number,
  organizationId: number | null,
  args: {
    clientId: number;
    title: string;
    notes?: string;
    products: Array<{
      productId: number;
      quantity: number;
      unitPrice?: string;
      decorationType?: string;
    }>;
    multiDepartment?: boolean;
    validDays?: number;
  }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const clientRows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, args.clientId), scope.clients))
    .limit(1);
  if (clientRows.length === 0) {
    return { error: `Client ID ${args.clientId} not found or doesn't belong to you.` };
  }
  const client = clientRows[0];

  const requestedIds = args.products.map((p) => p.productId);
  const productRows =
    requestedIds.length > 0
      ? await db
          .select()
          .from(products)
          .where(and(scope.products, inArray(products.id, requestedIds)))
      : [];
  const productMap = new Map(productRows.map((p) => [p.id, p]));
  const validProducts = args.products.filter((p) => productMap.has(p.productId));

  if (validProducts.length === 0) {
    return {
      error:
        "None of the specified product IDs were found in your catalog. Use search_products first to find valid product IDs.",
    };
  }

  const total = validProducts.reduce((sum, p) => {
    const prod = productMap.get(p.productId);
    const price = parseFloat(p.unitPrice ?? prod?.basePrice?.toString() ?? "0");
    return sum + price * p.quantity;
  }, 0);

  const viewToken = nanoid(24);

  const values: InsertProposal = {
    userId,
    organizationId,
    clientId: args.clientId,
    title: args.title,
    proposalType: "promo",
    status: "draft",
    estimatedValue: total.toFixed(2),
    deliveryMethod: "email",
    storeId: null,
    stripeCheckout: false,
    multiDepartment: args.multiDepartment ?? false,
    approvalRouting: "parallel",
    virtualProofs: false,
    notes: args.notes ?? null,
    validDays: args.validDays ?? 30,
    viewToken,
    sentAt: null,
  };

  const result = await db.insert(proposals).values(values);
  const proposalId = result[0].insertId;

  if (validProducts.length > 0) {
    const ppValues: InsertProposalProduct[] = validProducts.map((p) => {
      const prod = productMap.get(p.productId);
      return {
        proposalId,
        productId: p.productId,
        quantity: p.quantity,
        unitPrice: p.unitPrice ?? prod?.basePrice?.toString() ?? null,
        decorationType: p.decorationType ?? null,
        decorationNotes: null,
      };
    });
    await db.insert(proposalProducts).values(ppValues);
  }

  const productSummary = validProducts.map((p) => {
    const prod = productMap.get(p.productId);
    const price = p.unitPrice ?? prod?.basePrice?.toString() ?? "0";
    return `${prod?.name} x${p.quantity} @ $${price}`;
  });

  return {
    success: true,
    proposalId,
    title: args.title,
    clientName: client.companyName,
    clientEmail: client.contactEmail,
    estimatedValue: total.toFixed(2),
    productCount: validProducts.length,
    products: productSummary,
    status: "draft",
  };
}

export async function executeSendProposal(
  userId: number,
  organizationId: number | null,
  args: { proposalId: number }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const proposalRows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, args.proposalId), scope.proposals))
    .limit(1);
  if (proposalRows.length === 0) return { error: `Proposal ID ${args.proposalId} not found.` };
  const proposal = proposalRows[0];

  const clientRows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, proposal.clientId), scope.clients))
    .limit(1);
  const client = clientRows[0];

  if (!client?.contactEmail) {
    return { error: "Client has no contact email. Cannot send proposal." };
  }

  let viewToken = proposal.viewToken;
  if (!viewToken) viewToken = nanoid(24);

  await db
    .update(proposals)
    .set({ status: "sent", sentAt: new Date(), viewToken })
    .where(eq(proposals.id, args.proposalId));

  const ppRows = await db
    .select()
    .from(proposalProducts)
    .where(eq(proposalProducts.proposalId, args.proposalId));

  const ppProductIds = ppRows.map((pp) => pp.productId).filter(Boolean);
  const productRows =
    ppProductIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, ppProductIds))
      : [];
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  const emailProducts: ProposalEmailProduct[] = ppRows.map((pp) => {
    const prod = productMap.get(pp.productId);
    return {
      name: prod?.name || "Product",
      quantity: pp.quantity ?? 1,
      unitPrice: pp.unitPrice?.toString() || prod?.basePrice?.toString() || null,
      decorationType: pp.decorationType || null,
      imageUrl: prod?.imageUrl || null,
      proofImageUrl: null,
      proofStatus: null,
    };
  });

  let branding: ProposalEmailBranding = {};
  try {
    const profileRows = await db
      .select()
      .from(distributorProfiles)
      .where(scope.distributorProfiles)
      .limit(1);
    if (profileRows.length > 0) {
      const profile = profileRows[0];
      branding = {
        logoUrl: profile.brandLogoUrl || undefined,
        primaryColor: profile.brandPrimaryColor || undefined,
        secondaryColor: profile.brandSecondaryColor || undefined,
        // brandBannerColor is not yet in the schema — fall back to primary
        bannerColor: profile.brandPrimaryColor || undefined,
        companyName: profile.brandCompanyName || profile.companyName || undefined,
      };
    }
  } catch {
    /* use defaults */
  }

  const { subject: emailSubject, html: emailHtml } = buildProposalEmail({
    proposalTitle: proposal.title,
    clientName: client.contactName || "",
    clientCompany: client.companyName || "",
    senderName: "",
    senderCompany: branding.companyName || "Your Distributor",
    estimatedValue: proposal.estimatedValue?.toString() || "0",
    validDays: proposal.validDays || 30,
    products: emailProducts,
    notes: proposal.notes || undefined,
    proposalId: args.proposalId,
    branding,
  });

  try {
    const result = await sendEmail(
      client.contactEmail,
      emailSubject,
      emailHtml,
      branding.companyName || undefined
    );
    if (result.sent) {
      return {
        success: true,
        proposalId: args.proposalId,
        sentTo: client.contactEmail,
        clientName: client.companyName,
        status: "sent",
      };
    }
    return { error: `Email sending failed: ${result.error}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Email sending failed: ${message}` };
  }
}
