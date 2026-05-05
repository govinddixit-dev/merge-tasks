/**
 * copilotExecProofs.ts — Virtual proofing executors for the AI copilot.
 *
 * Handles: createVirtualProof, listProofs, updateProofStatus
 */
import { getDb } from "../db";
import { products, virtualProofs, clientLogos } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { buildToolScope } from "./copilotExecScope";

export async function executeCreateVirtualProof(userId: number, organizationId: number | null, args: {
  productId: number; clientId: number; decorationMethod: string;
  decorationZone?: string; proposalId?: number;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const productRows = await db.select().from(products)
    .where(and(eq(products.id, args.productId), scope.products)).limit(1);
  if (productRows.length === 0) return { error: `Product ID ${args.productId} not found` };

  // Audit fix #17: use scope.clientLogos so team members can use org-shared logos
  const logoRows = await db.select().from(clientLogos)
    .where(and(eq(clientLogos.clientId, args.clientId), scope.clientLogos))
    .orderBy(desc(clientLogos.createdAt)).limit(1);

  const product = productRows[0];

  const result = await db.insert(virtualProofs).values({
    userId,
    // Audit fix #17: stamp organizationId so team members share virtual proofs
    organizationId: organizationId ?? null,
    productId: args.productId,
    clientId: args.clientId,
    proposalId: args.proposalId || null,
    productName: product.name,
    productImageUrl: product.imageUrl || null,
    logoUrl: logoRows[0]?.logoUrl || null,
    logoName: logoRows[0]?.logoName || null,
    decorationMethod: args.decorationMethod as "embroidery" | "screen_print" | "laser_engraving" | "heat_transfer" | "dtg" | "sublimation" | "deboss" | "patch",
    decorationZone: args.decorationZone || "front",
    status: "draft" as const,
  });

  const proofId = Number(result[0].insertId);
  return {
    success: true, proofId,
    productName: product.name,
    hasLogo: logoRows.length > 0,
    status: "draft",
    message: logoRows.length === 0 ? "No logo found for this client. Upload a logo first for best results." : undefined,
  };
}

export async function executeListProofs(userId: number, organizationId: number | null, args: { clientId?: number; status?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const conditions = [scope.virtualProofs];
  if (args.clientId) conditions.push(eq(virtualProofs.clientId, args.clientId));
  if (args.status) conditions.push(eq(virtualProofs.status, args.status as "draft" | "rendering" | "ready" | "approved" | "revision_requested"));

  const rows = await db.select().from(virtualProofs)
    .where(and(...conditions))
    .orderBy(desc(virtualProofs.createdAt))
    .limit(args.limit || 20);

  return {
    count: rows.length,
    proofs: rows.map(r => ({
      id: r.id, productName: r.productName, decorationMethod: r.decorationMethod,
      decorationZone: r.decorationZone, status: r.status,
      hasProofImage: !!r.proofImageUrl, createdAt: r.createdAt,
    })),
  };
}

export async function executeUpdateProofStatus(userId: number, organizationId: number | null, args: {
  proofId: number; action: string; revisionNotes?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const existing = await db.select().from(virtualProofs)
    .where(and(eq(virtualProofs.id, args.proofId), scope.virtualProofs)).limit(1);
  if (existing.length === 0) return { error: `Proof ID ${args.proofId} not found` };

  if (args.action === "approve") {
    await db.update(virtualProofs).set({ status: "approved", approvedAt: new Date() })
      .where(eq(virtualProofs.id, args.proofId));
    return { success: true, proofId: args.proofId, newStatus: "approved" };
  } else if (args.action === "request_revision") {
    if (!args.revisionNotes) return { error: "Revision notes are required when requesting a revision" };
    await db.update(virtualProofs).set({ status: "revision_requested", revisionNotes: args.revisionNotes })
      .where(eq(virtualProofs.id, args.proofId));
    return { success: true, proofId: args.proofId, newStatus: "revision_requested" };
  }

  return { error: `Unknown action: ${args.action}` };
}
