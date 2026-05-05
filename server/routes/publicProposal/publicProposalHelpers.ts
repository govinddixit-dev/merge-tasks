/**
 * publicProposalHelpers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared data-loading helpers used by all publicProposal sub-route modules.
 *
 *   loadProposalByToken(token)  — loads full proposal + products + branding
 *   loadBrandingForProposal(userId) — loads distributor branding for emails
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eq, inArray } from "drizzle-orm";
import {
  proposals,
  proposalProducts,
  products,
  clients,
  distributorProfiles,
  stores,
  virtualProofs,
  proposalProductVariants,
  proposalPriceTiers,
  proposalProductImages,
  proposalSizeCharts,
  proposalOrderItems,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { notifyOwner } from "../../_core/notification";
import { getLogger } from "../../utils/logger";
import { onProposalViewed } from "../../utils/agentTriggers";

const log = getLogger("publicProposal");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalBranding {
  logoUrl: string | null;
  primaryColor: string;
  bannerColor: string;
  companyName: string;
}

export interface ProposalProductItem {
  id: number;
  productId: number;
  name: string;
  description: string | null;
  category: string;
  sku: string | null;
  quantity: number;
  unitPrice: string | null;
  decorationType: string | null;
  decorationNotes: string | null;
  imageUrl: string | null;
  additionalImages: string[];
  proofImageUrl: string | null;
  proofStatus: string | null;
  decorationZone: string | null;
  colors: string[];
  sizes: string[];
  logoPositions: string[];
  priceTiers: Array<{
    id: number;
    tierType: string;
    label: string | null;
    minQty: number | null;
    maxQty: number | null;
    price: string;
  }>;
  proposalImages: string[];
  sizeChart: { chartData: Array<Record<string, unknown>>; imageUrl: string | null } | null;
  externalId: string | null;
  externalSource: string | null;
  supplierCode: string | null;
  productNumber: string | null;
  hasLiveInventory: boolean;
  currency: string;
}

export interface LoadedProposal {
  proposal: typeof proposals.$inferSelect;
  client: typeof clients.$inferSelect | undefined;
  productList: ProposalProductItem[];
  branding: ProposalBranding;
  orderItems: Array<{
    id: number;
    proposalProductId: number;
    productId: number;
    color: string | null;
    size: string | null;
    quantity: number;
    unitPrice: string | null;
    comment: string | null;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Loads distributor branding for notification emails. Falls back to safe defaults. */
export async function loadBrandingForProposal(userId: number): Promise<{
  companyName: string;
  primaryColor: string;
  logoUrl: string | null;
}> {
  const db = await getDb();
  if (!db) return { companyName: "Your Distributor", primaryColor: "#654BF9", logoUrl: null };
  try {
    const [profile] = await db
      .select()
      .from(distributorProfiles)
      .where(eq(distributorProfiles.userId, userId))
      .limit(1);
    if (profile) {
      return {
        companyName: profile.brandCompanyName || profile.companyName || "Your Distributor",
        primaryColor: profile.brandPrimaryColor || "#654BF9",
        logoUrl: profile.brandLogoUrl || null,
      };
    }
  } catch {
    /* ignore — use defaults */
  }
  return { companyName: "Your Distributor", primaryColor: "#654BF9", logoUrl: null };
}

/**
 * Loads Tier 3 (client/workstore) branding for a proposal.
 * Used for department approval emails that go to end users on the client side.
 * Pulls from the store's branding when the proposal has a storeId,
 * else falls back to the client company name.
 */
export async function loadClientBrandingForProposal(proposalId: number): Promise<{
  companyName: string;
  primaryColor: string;
  logoUrl: string | null;
  /** Display name to use in From header (appends "via MergeTasks" per Tier 3 convention). */
  fromName: string;
  replyTo?: string;
}> {
  const fallback = {
    companyName: "Your Team",
    primaryColor: "#654BF9",
    logoUrl: null as string | null,
    fromName: "Your Team via MergeTasks",
    replyTo: undefined as string | undefined,
  };
  const db = await getDb();
  if (!db) return fallback;
  try {
    const [proposal] = await db
      .select({ storeId: proposals.storeId, clientId: proposals.clientId })
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .limit(1);
    if (!proposal) return fallback;

    if (proposal.storeId) {
      const [store] = await db
        .select()
        .from(stores)
        .where(eq(stores.id, proposal.storeId))
        .limit(1);
      if (store) {
        const companyName = store.senderName || store.name || "Your Team";
        return {
          companyName,
          primaryColor: store.primaryColor || "#654BF9",
          logoUrl: store.logoUrl || null,
          fromName: `${companyName} via MergeTasks`,
          replyTo: store.senderEmail || undefined,
        };
      }
    }

    // Fall back to client company info
    const [client] = await db
      .select({ companyName: clients.companyName })
      .from(clients)
      .where(eq(clients.id, proposal.clientId))
      .limit(1);
    if (client?.companyName) {
      return {
        companyName: client.companyName,
        primaryColor: "#654BF9",
        logoUrl: null,
        fromName: `${client.companyName} via MergeTasks`,
        replyTo: undefined,
      };
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

/**
 * Loads a proposal and all related data by its public viewToken.
 * Also marks the proposal as "viewed" on first access and fires a distributor
 * notification.
 *
 * Returns null when the token is invalid or the proposal does not exist.
 */
export async function loadProposalByToken(token: string): Promise<LoadedProposal | null> {
  if (!token || token.length < 10) return null;

  const db = await getDb();
  if (!db) return null;

  const proposalRows = await db
    .select()
    .from(proposals)
    .where(eq(proposals.viewToken, token))
    .limit(1);

  if (proposalRows.length === 0) return null;
  const proposal = proposalRows[0];

  // Mark as viewed on first access
  if (!proposal.viewedAt) {
    const now = new Date();
    await db
      .update(proposals)
      .set({ viewedAt: now, status: "viewed" })
      .where(eq(proposals.id, proposal.id));
    // Update local reference to reflect DB change (proposal is a plain object from Drizzle select)
    (proposal as { viewedAt: Date | null }).viewedAt = now;
    (proposal as { status: string }).status = "viewed";
    try {
      await notifyOwner({
        userId: proposal.userId,
        type: "proposal_viewed",
        title: "Proposal viewed",
        content: `A client just opened your proposal "${proposal.title}".`,
        actionPath: `/proposals/${proposal.id}`,
        actionLabel: "View Proposal",
        entityId: proposal.id,
        entityType: "proposal",
      });
    } catch {
      /* non-critical */
    }

    // Ask the agent to draft a follow-up email (fire-and-forget; never awaits).
    // Looks up the client's contact email inline — required for email drafting.
    (async () => {
      try {
        const [clientRow] = await db
          .select({
            contactEmail: clients.contactEmail,
            contactName: clients.contactName,
          })
          .from(clients)
          .where(eq(clients.id, proposal.clientId))
          .limit(1);
        if (clientRow?.contactEmail) {
          await onProposalViewed(
            proposal.id,
            proposal.organizationId ?? null,
            clientRow.contactEmail,
            clientRow.contactName,
            proposal.title,
            proposal.estimatedValue != null ? Number(proposal.estimatedValue) : null,
          );
        }
      } catch (err: unknown) {
        log.warn("[trigger] onProposalViewed failed:", err);
      }
    })();
  }

  // Client info
  const clientRows = await db
    .select()
    .from(clients)
    .where(eq(clients.id, proposal.clientId))
    .limit(1);
  const client = clientRows[0];

  // Proposal products
  const ppRows = await db
    .select()
    .from(proposalProducts)
    .where(eq(proposalProducts.proposalId, proposal.id));

  const productRows =
    ppRows.length > 0
      ? await db.select().from(products).where(eq(products.userId, proposal.userId))
      : [];
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  // Virtual proofs
  const proofRows = await db
    .select()
    .from(virtualProofs)
    .where(eq(virtualProofs.proposalId, proposal.id));
  const proofByProduct = new Map(proofRows.map((p) => [p.productId, p]));

  // Distributor branding
  let branding: ProposalBranding = {
    logoUrl: null,
    primaryColor: "#654BF9",
    bannerColor: "#654BF9",
    companyName: "Your Distributor",
  };
  try {
    const profileRows = await db
      .select()
      .from(distributorProfiles)
      .where(eq(distributorProfiles.userId, proposal.userId))
      .limit(1);
    if (profileRows.length > 0) {
      const profile = profileRows[0];
      branding = {
        logoUrl: profile.brandLogoUrl || null,
        primaryColor: profile.brandPrimaryColor || "#654BF9",
        bannerColor: profile.brandBannerColor || profile.brandPrimaryColor || "#654BF9",
        companyName: profile.brandCompanyName || profile.companyName || "Your Distributor",
      };
    }
  } catch (e) {
    log.info("Could not fetch branding:", e);
  }

  // Catalog-style data per proposal product
  const ppIds = ppRows.map((pp) => pp.id);

  let allVariants: typeof proposalProductVariants.$inferSelect[] = [];
  if (ppIds.length > 0) {
    allVariants = await db
      .select()
      .from(proposalProductVariants)
      .where(inArray(proposalProductVariants.proposalProductId, ppIds));
  }
  const variantsByPP = new Map<number, typeof allVariants>();
  for (const v of allVariants) {
    const arr = variantsByPP.get(v.proposalProductId) || [];
    arr.push(v);
    variantsByPP.set(v.proposalProductId, arr);
  }

  let allTiers: typeof proposalPriceTiers.$inferSelect[] = [];
  if (ppIds.length > 0) {
    allTiers = await db
      .select()
      .from(proposalPriceTiers)
      .where(inArray(proposalPriceTiers.proposalProductId, ppIds));
  }
  const tiersByPP = new Map<number, typeof allTiers>();
  for (const t of allTiers) {
    const arr = tiersByPP.get(t.proposalProductId) || [];
    arr.push(t);
    tiersByPP.set(t.proposalProductId, arr);
  }

  let allImages: typeof proposalProductImages.$inferSelect[] = [];
  if (ppIds.length > 0) {
    allImages = await db
      .select()
      .from(proposalProductImages)
      .where(inArray(proposalProductImages.proposalProductId, ppIds));
  }
  const imagesByPP = new Map<number, typeof allImages>();
  for (const img of allImages) {
    const arr = imagesByPP.get(img.proposalProductId) || [];
    arr.push(img);
    imagesByPP.set(img.proposalProductId, arr);
  }

  let allSizeCharts: typeof proposalSizeCharts.$inferSelect[] = [];
  if (ppIds.length > 0) {
    allSizeCharts = await db
      .select()
      .from(proposalSizeCharts)
      .where(inArray(proposalSizeCharts.proposalProductId, ppIds));
  }
  const sizeChartByPP = new Map<number, typeof proposalSizeCharts.$inferSelect>();
  for (const sc of allSizeCharts) {
    sizeChartByPP.set(sc.proposalProductId, sc);
  }

  // Existing order items (client's in-progress selections)
  const existingOrderItems = await db
    .select()
    .from(proposalOrderItems)
    .where(eq(proposalOrderItems.proposalId, proposal.id));

  // Build rich product list
  const productList: ProposalProductItem[] = ppRows.map((pp) => {
    const prod = productMap.get(pp.productId);
    const proof = proofByProduct.get(pp.productId);
    const variants = variantsByPP.get(pp.id) || [];
    const tiers = tiersByPP.get(pp.id) || [];
    const images = imagesByPP.get(pp.id) || [];
    const sizeChart = sizeChartByPP.get(pp.id) || null;

    return {
      id: pp.id,
      productId: pp.productId,
      name: prod?.name || "Product",
      description: prod?.description || null,
      category: prod?.category || "other",
      sku: prod?.sku || null,
      quantity: pp.quantity ?? 1,
      unitPrice: pp.unitPrice?.toString() || prod?.basePrice?.toString() || null,
      decorationType: pp.decorationType || proof?.decorationMethod || null,
      decorationNotes: pp.decorationNotes || null,
      imageUrl: prod?.imageUrl || null,
      additionalImages: (prod?.additionalImages as string[]) || [],
      proofImageUrl: proof?.proofImageUrl || null,
      proofStatus: proof?.status || null,
      decorationZone: proof?.decorationZone || null,
      colors: variants
        .filter((v) => v.variantType === "color")
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => v.value),
      sizes: variants
        .filter((v) => v.variantType === "size")
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => v.value),
      logoPositions: variants
        .filter((v) => v.variantType === "logo_position")
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => v.value),
      priceTiers: tiers
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({
          id: t.id,
          tierType: t.tierType,
          label: t.label,
          minQty: t.minQty,
          maxQty: t.maxQty,
          price: t.price?.toString() || "0",
        })),
      proposalImages: images
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((img) => img.imageUrl),
      sizeChart: sizeChart
        ? { chartData: sizeChart.chartData || [], imageUrl: sizeChart.imageUrl || null }
        : null,
      externalId: prod?.externalId || null,
      externalSource: prod?.externalSource || null,
      supplierCode: prod?.supplierCode || null,
      productNumber: prod?.productNumber || null,
      hasLiveInventory: prod?.hasLiveInventory || false,
      currency: prod?.currency || "USD",
    };
  });

  const orderItems = existingOrderItems.map((oi) => ({
    id: oi.id,
    proposalProductId: oi.proposalProductId,
    productId: oi.productId,
    color: oi.color,
    size: oi.size,
    quantity: oi.quantity,
    unitPrice: oi.unitPrice?.toString() || null,
    comment: oi.comment,
  }));

  return { proposal, client, productList, branding, orderItems };
}
