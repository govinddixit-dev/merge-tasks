/**
 * copilotExec/index.ts
 * Barrel file: re-exports all domain executor functions and the executeTool dispatcher.
 *
 * Domain split:
 *   scope.ts            — buildToolScope() shared helper
 *   clientsProducts.ts  — search_clients, search_products
 *   proposals.ts        — create_proposal, send_proposal
 *   webstore.ts         — create_webstore, assign_store_products, optimize_store
 */

export { buildToolScope } from "./scope";
export { executeSearchClients, executeSearchProducts } from "./clientsProducts";
export { executeCreateProposal, executeSendProposal } from "./proposals";
export { executeCreateWebstore, executeAssignStoreProducts, executeOptimizeStore } from "./webstore";

import { executeSearchClients, executeSearchProducts } from "./clientsProducts";
import { executeCreateProposal, executeSendProposal } from "./proposals";
import { executeCreateWebstore, executeAssignStoreProducts, executeOptimizeStore } from "./webstore";
import { executeExtendedTool } from "../copilotTools";
import type { ToolCall } from "../../_core/llm";
import { getDb } from "../../db";
import { eq, and } from "drizzle-orm";
import { poPreviewDrafts } from "../../../drizzle/schema";
import { createPOsFromBuckets } from "../../utils/generatePOsForOrder";
import type { SupplierBucket } from "../../utils/supplierGrouping";

/**
 * Routes an LLM ToolCall to the appropriate executor function.
 * Core tools are handled inline; all other tools are delegated to
 * executeExtendedTool() (copilotTools.ts barrel → copilotExec*.ts modules).
 */
export async function executeTool(
  userId: number,
  organizationId: number | null,
  toolCall: ToolCall
): Promise<{ result: string; action?: { type: string; data: unknown }; attachment?: { type: string; payload: unknown } }> {
  const fnName = toolCall.function.name;
  let args: unknown;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { result: "Failed to parse tool arguments" };
  }

  switch (fnName) {
    case "search_clients": {
      const res = await executeSearchClients(userId, organizationId, args as { query: string });
      return { result: JSON.stringify(res) };
    }
    case "search_products": {
      const res = await executeSearchProducts(userId, organizationId, args as { query: string; category?: string });
      return { result: JSON.stringify(res) };
    }
    case "create_proposal": {
      const res = await executeCreateProposal(userId, organizationId, args as Parameters<typeof executeCreateProposal>[2]);
      if ((res as { error?: string }).error) return { result: JSON.stringify(res) };
      const r = res as { proposalId: number; title: string; clientName: string; estimatedValue: string; productCount: number };
      return {
        result: JSON.stringify(res),
        action: {
          type: "proposal_created",
          data: {
            id: r.proposalId,
            title: r.title,
            clientName: r.clientName,
            estimatedValue: r.estimatedValue,
            productCount: r.productCount,
          },
        },
      };
    }
    case "send_proposal": {
      const res = await executeSendProposal(userId, organizationId, args as { proposalId: number });
      if ((res as { error?: string }).error) return { result: JSON.stringify(res) };
      const r = res as { proposalId: number; sentTo: string; clientName: string };
      return {
        result: JSON.stringify(res),
        action: {
          type: "proposal_sent",
          data: { proposalId: r.proposalId, sentTo: r.sentTo, clientName: r.clientName },
        },
      };
    }
    case "create_webstore": {
      const res = await executeCreateWebstore(userId, organizationId, args as Parameters<typeof executeCreateWebstore>[2]);
      if ((res as { error?: string }).error) return { result: JSON.stringify(res) };
      const r = res as { storeId: number; name: string; slug: string; clientName: string };
      return {
        result: JSON.stringify(res),
        action: {
          type: "webstore_created",
          data: { storeId: r.storeId, name: r.name, slug: r.slug, clientName: r.clientName },
        },
      };
    }
    case "assign_store_products": {
      const res = await executeAssignStoreProducts(userId, organizationId, args as Parameters<typeof executeAssignStoreProducts>[2]);
      if ((res as { error?: string }).error) return { result: JSON.stringify(res) };
      const r = res as { storeId: number; assignedCount: number };
      return {
        result: JSON.stringify(res),
        action: {
          type: "products_assigned",
          data: { storeId: r.storeId, assignedCount: r.assignedCount },
        },
      };
    }
    case "optimize_store": {
      const res = await executeOptimizeStore(userId, organizationId, args as { storeId: number });
      if ((res as { error?: string }).error) return { result: JSON.stringify(res) };
      const r = res as { storeId: number; tagline: string };
      return {
        result: JSON.stringify(res),
        action: {
          type: "store_optimized",
          data: { storeId: r.storeId, tagline: r.tagline },
        },
      };
    }
    case "po_auto_aggregate_apply": {
      // Distributor approved an Auto-Aggregate PO task from the AI Inbox.
      // The args carry the preview token (persisted at queue time); load
      // the stored supplier buckets and commit them as POs — same path
      // confirmGeneration uses in the purchaseOrders router.
      const a = args as {
        previewToken: string;
        sourceProposalIds?: number[];
        editedGroups?: SupplierBucket[];
      };
      const db = await getDb();
      if (!db) return { result: JSON.stringify({ error: "Database unavailable" }) };

      const ownerCond = organizationId != null
        ? and(eq(poPreviewDrafts.token, a.previewToken), eq(poPreviewDrafts.organizationId, organizationId))
        : and(eq(poPreviewDrafts.token, a.previewToken), eq(poPreviewDrafts.userId, userId));
      const [draft] = await db.select().from(poPreviewDrafts).where(ownerCond!).limit(1);
      if (!draft) return { result: JSON.stringify({ error: "Preview not found or expired" }) };
      if (draft.confirmedAt) return { result: JSON.stringify({ error: "Preview already confirmed" }) };
      if (draft.expiresAt && draft.expiresAt.getTime() < Date.now()) {
        return { result: JSON.stringify({ error: "Preview expired — re-run Auto-Aggregate" }) };
      }

      const payload = draft.payload as { groups: SupplierBucket[]; sourceProposalIds: number[] };
      const groups = a.editedGroups ?? payload.groups;

      await db.update(poPreviewDrafts)
        .set({ confirmedAt: new Date() })
        .where(eq(poPreviewDrafts.id, draft.id));

      const sourceProposalIds = (draft.sourceProposalIds as number[]) ?? a.sourceProposalIds ?? [];
      const result = await createPOsFromBuckets(userId, organizationId, groups, {
        orderId: null,
        proposalIds: sourceProposalIds,
        contextLabel: sourceProposalIds.length === 1
          ? `Proposal #${sourceProposalIds[0]}`
          : `Proposal(s) ${sourceProposalIds.join(", ")}`,
      });
      return {
        result: JSON.stringify(result),
        action: {
          type: "pos_created",
          data: {
            totalPOs: result.totalPOs,
            totalCost: result.totalCost,
            purchaseOrders: result.purchaseOrders,
          },
        },
      };
    }
    case "navigate_to_page": {
      const nav = args as { path: string; reason: string };
      return {
        result: `Navigating to ${nav.path}`,
        action: {
          type: "navigate",
          data: { path: nav.path, reason: nav.reason },
        },
      };
    }
    default: {
      return executeExtendedTool(userId, organizationId, toolCall);
    }
  }
}
