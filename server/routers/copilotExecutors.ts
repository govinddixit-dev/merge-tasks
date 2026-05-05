/**
 * copilotExecutors.ts — Barrel + dispatcher for AI copilot tool execution.
 *
 * Domain executors are split into focused modules:
 *   - copilotExecScope.ts       → shared buildToolScope helper
 *   - copilotExecClients.ts     → client CRUD (create, update, delete, getDetails, list)
 *   - copilotExecOrders.ts      → order management (list, getDetails, create, updateStatus)
 *   - copilotExecProducts.ts    → product catalog + external search/import
 *   - copilotExecProposals.ts   → proposal management (list, update, delete, duplicate, catalog variants)
 *   - copilotExecEstimates.ts   → estimates & invoices (create, list, updateStatus)
 *   - copilotExecProofs.ts      → virtual proofing (create, list, updateStatus)
 *   - copilotExecAnalytics.ts   → reports (dashboard, reorder alerts, churn, refunds)
 *   - copilotExecStores.ts      → store management (update, list, getDetails, delete)
 *   - copilotExecBranding.ts    → branding + custom email
 *
 * This file re-exports every executor for backward compatibility and contains
 * the `executeExtendedTool` dispatcher that routes tool calls to the right executor.
 */

// ── Re-exports (preserves existing import paths) ──────────────────────
export { buildToolScope } from "./copilotExecScope";

export {
  executeCreateClient,
  executeUpdateClient,
  executeDeleteClient,
  executeGetClientDetails,
  executeListClients,
} from "./copilotExecClients";

export {
  executeListOrders,
  executeGetOrderDetails,
  executeCreateOrder,
  executeUpdateOrderStatus,
} from "./copilotExecOrders";

export {
  executeCreateProduct,
  executeUpdateProduct,
  executeDeleteProduct,
  executeSearchExternalProducts,
  executeImportExternalProduct,
} from "./copilotExecProducts";

export {
  executeGetProposalDetails,
  executeListProposals,
  executeUpdateProposal,
  executeDeleteProposal,
  executeDuplicateProposal,
  executeConfigureCatalogVariants,
} from "./copilotExecProposals";

export {
  executeCreateEstimate,
  executeCreateInvoice,
  executeListEstimates,
  executeListInvoices,
  executeUpdateInvoiceStatus,
} from "./copilotExecEstimates";

export {
  executeCreateVirtualProof,
  executeListProofs,
  executeUpdateProofStatus,
} from "./copilotExecProofs";

export {
  executeGetDashboardStats,
  executeGetReorderAlerts,
  executeGetChurnSignals,
  executeGetRefundReport,
} from "./copilotExecAnalytics";

export {
  executeUpdateStore,
  executeListStores,
  executeGetStoreDetails,
  executeDeleteStore,
} from "./copilotExecStores";

export {
  executeGetBranding,
  executeUpdateBranding,
  executeSendCustomEmail,
} from "./copilotExecBranding";

// ── Dispatcher ────────────────────────────────────────────────────────
// NOTE: `export { X } from "./mod"` re-exports do NOT bring names into local
// scope in TypeScript, so we need separate imports for the dispatcher below.
import type { ToolCall } from "../_core/llm";
import { getDb } from "../db";
import { eq, and } from "drizzle-orm";
import { proposals, invoices, estimates } from "../../drizzle/schema";
import { buildToolScope } from "./copilotExecScope";
import { executeCreateClient, executeUpdateClient, executeDeleteClient, executeGetClientDetails, executeListClients } from "./copilotExecClients";
import { executeListOrders, executeGetOrderDetails, executeCreateOrder, executeUpdateOrderStatus } from "./copilotExecOrders";
import { executeCreateProduct, executeUpdateProduct, executeDeleteProduct, executeSearchExternalProducts, executeImportExternalProduct } from "./copilotExecProducts";
import { executeGetProposalDetails, executeListProposals, executeUpdateProposal, executeDeleteProposal, executeDuplicateProposal, executeConfigureCatalogVariants } from "./copilotExecProposals";
import { executeCreateEstimate, executeCreateInvoice, executeListEstimates, executeListInvoices, executeUpdateInvoiceStatus } from "./copilotExecEstimates";
import { executeCreateVirtualProof, executeListProofs, executeUpdateProofStatus } from "./copilotExecProofs";
import { executeGetDashboardStats, executeGetReorderAlerts, executeGetChurnSignals, executeGetRefundReport } from "./copilotExecAnalytics";
import { executeUpdateStore, executeListStores, executeGetStoreDetails, executeDeleteStore } from "./copilotExecStores";
import { executeGetBranding, executeUpdateBranding, executeSendCustomEmail } from "./copilotExecBranding";
import { executeSearchPurchaseOrders, executeGeneratePurchaseOrders, executeGetPODetails, executeGetMarginAnalysis, executeGenerateBulkPOs, executeAggregatePendingPOs } from "./copilotExecPurchaseOrders";

export async function executeExtendedTool(
  userId: number,
  organizationId: number | null,
  toolCall: ToolCall
): Promise<{ result: string; action?: { type: string; data: unknown }; attachment?: { type: string; payload: unknown } }> {
  const fnName = toolCall.function.name;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse returns any; each executor validates its own args
  let args: any;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { result: "Failed to parse tool arguments" };
  }

  try {
    return await dispatch(fnName, userId, organizationId, args);
  } catch (err) {
    // Individual executors do their own error handling via { error } return
    // values. Anything thrown here is unexpected (FK violation, offline DB,
    // etc.). Return it as a structured tool result rather than propagating —
    // the copilot conversation should surface the failure to the caller
    // as a tool result, not crash the whole request.
    const message = err instanceof Error ? err.message : String(err);
    return { result: JSON.stringify({ error: message }) };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dispatch(fnName: string, userId: number, organizationId: number | null, args: any): Promise<{ result: string; action?: { type: string; data: unknown }; attachment?: { type: string; payload: unknown } }> {
  switch (fnName) {
    // Client Management
    case "create_client": {
      const res = await executeCreateClient(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "client_created", data: { clientId: res.clientId, companyName: res.companyName } } };
    }
    case "update_client": {
      const res = await executeUpdateClient(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "client_updated", data: { clientId: args.clientId } } : undefined };
    }
    case "delete_client": {
      const res = await executeDeleteClient(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "client_deleted", data: { deleted: res.deleted } } : undefined };
    }
    case "get_client_details": {
      const res = await executeGetClientDetails(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "list_clients": {
      const res = await executeListClients(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }

    // Order Management
    case "list_orders": {
      const res = await executeListOrders(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "get_order_details": {
      const res = await executeGetOrderDetails(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "create_order": {
      const res = await executeCreateOrder(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "order_created", data: { orderId: res.orderId, orderNumber: res.orderNumber, total: res.total } } };
    }
    case "update_order_status": {
      const res = await executeUpdateOrderStatus(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "order_updated", data: { orderId: args.orderId, status: args.status } } : undefined };
    }

    // Product Catalog
    case "create_product": {
      const res = await executeCreateProduct(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "product_created", data: { productId: res.productId, name: res.name } } };
    }
    case "update_product": {
      const res = await executeUpdateProduct(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "product_updated", data: { productId: args.productId } } : undefined };
    }
    case "delete_product": {
      const res = await executeDeleteProduct(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "product_deleted", data: { deleted: res.deleted } } : undefined };
    }

    // Estimates & Invoices
    case "create_estimate": {
      const res = await executeCreateEstimate(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "estimate_created", data: { estimateId: res.estimateId, estimateNumber: res.estimateNumber } } };
    }
    case "create_invoice": {
      const res = await executeCreateInvoice(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "invoice_created", data: { invoiceId: res.invoiceId, invoiceNumber: res.invoiceNumber } } };
    }
    case "list_estimates": {
      const res = await executeListEstimates(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "list_invoices": {
      const res = await executeListInvoices(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "update_invoice_status": {
      const res = await executeUpdateInvoiceStatus(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "invoice_updated", data: { invoiceId: args.invoiceId, status: args.status } } : undefined };
    }
    case "mark_fulfilled": {
      const { entityType, entityId, notes } = args as { entityType: "proposal" | "invoice" | "estimate"; entityId: number; notes?: string };
      const db = await getDb();
      if (!db) return { result: JSON.stringify({ error: "Database unavailable" }) };
      const scope = buildToolScope(userId, organizationId);

      if (entityType === "proposal") {
        const [row] = await db.select().from(proposals).where(and(eq(proposals.id, entityId), scope.proposals)).limit(1);
        if (!row) return { result: JSON.stringify({ error: "Proposal not found" }) };
        if (row.status !== "accepted") return { result: JSON.stringify({ error: "Only accepted proposals can be fulfilled" }) };
        await db.update(proposals).set({ status: "fulfilled", fulfilledAt: new Date() }).where(and(eq(proposals.id, entityId), scope.proposals));
      } else if (entityType === "invoice") {
        const [row] = await db.select().from(invoices).where(and(eq(invoices.id, entityId), scope.invoices)).limit(1);
        if (!row) return { result: JSON.stringify({ error: "Invoice not found" }) };
        if (!["paid", "sent"].includes(row.status)) return { result: JSON.stringify({ error: "Only paid or sent invoices can be fulfilled" }) };
        await db.update(invoices).set({ status: "fulfilled", fulfilledAt: new Date() }).where(and(eq(invoices.id, entityId), scope.invoices));
      } else if (entityType === "estimate") {
        const [row] = await db.select().from(estimates).where(and(eq(estimates.id, entityId), scope.estimates)).limit(1);
        if (!row) return { result: JSON.stringify({ error: "Estimate not found" }) };
        if (row.status !== "accepted") return { result: JSON.stringify({ error: "Only accepted estimates can be fulfilled" }) };
        await db.update(estimates).set({ status: "fulfilled", fulfilledAt: new Date() }).where(and(eq(estimates.id, entityId), scope.estimates));
      }

      return {
        result: JSON.stringify({ success: true, entityType, entityId, notes }),
        action: { type: "marked_fulfilled", data: { entityType, entityId } },
      };
    }

    // Proposal Management
    case "list_proposals": {
      const res = await executeListProposals(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "get_proposal_details": {
      const res = await executeGetProposalDetails(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "update_proposal": {
      const res = await executeUpdateProposal(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "proposal_updated", data: { proposalId: args.proposalId } } : undefined };
    }
    case "delete_proposal": {
      const res = await executeDeleteProposal(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "proposal_deleted", data: { deleted: res.deleted } } : undefined };
    }
    case "duplicate_proposal": {
      const res = await executeDuplicateProposal(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "proposal_duplicated", data: { newProposalId: res.newProposalId, title: res.title } } };
    }
    case "configure_catalog_variants": {
      const res = await executeConfigureCatalogVariants(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "catalog_configured", data: { proposalProductId: args.proposalProductId } } : undefined };
    }

    // Virtual Proofing
    case "create_virtual_proof": {
      const res = await executeCreateVirtualProof(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "proof_created", data: { proofId: res.proofId, productName: res.productName } } };
    }
    case "list_proofs": {
      const res = await executeListProofs(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "update_proof_status": {
      const res = await executeUpdateProofStatus(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "proof_updated", data: { proofId: args.proofId, status: res.newStatus } } : undefined };
    }

    // Reports & Analytics
    case "get_dashboard_stats": {
      const res = await executeGetDashboardStats(userId, organizationId);
      return { result: JSON.stringify(res) };
    }
    case "get_reorder_alerts": {
      const res = await executeGetReorderAlerts(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "get_churn_signals": {
      const res = await executeGetChurnSignals(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "get_refund_report": {
      const res = await executeGetRefundReport(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }

    // Store Management
    case "update_store": {
      const res = await executeUpdateStore(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "store_updated", data: { storeId: args.storeId } } : undefined };
    }
    case "list_stores": {
      const res = await executeListStores(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "get_store_details": {
      const res = await executeGetStoreDetails(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "delete_store": {
      const res = await executeDeleteStore(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "store_deleted", data: { deleted: res.deleted } } : undefined };
    }

    // Email
    case "send_custom_email": {
      const res = await executeSendCustomEmail(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "email_sent", data: { sentTo: res.sentTo, subject: res.subject } } };
    }

    // Branding
    case "get_branding": {
      const res = await executeGetBranding(userId, organizationId);
      return { result: JSON.stringify(res) };
    }
    case "update_branding": {
      const res = await executeUpdateBranding(userId, organizationId, args);
      return { result: JSON.stringify(res), action: res.success ? { type: "branding_updated", data: { updated: res.updated } } : undefined };
    }

    // External Product Search & Import
    case "search_external_products": {
      const res = await executeSearchExternalProducts(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "import_external_product": {
      const res = await executeImportExternalProduct(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }

    // Purchase Orders
    case "search_purchase_orders": {
      const res = await executeSearchPurchaseOrders(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "generate_purchase_orders": {
      const res = await executeGeneratePurchaseOrders(userId, organizationId, args);
      if (res.error) return { result: JSON.stringify(res) };
      return { result: JSON.stringify(res), action: { type: "pos_generated", data: { orderId: args.orderId, count: res.purchaseOrders?.length } } };
    }
    case "get_po_details": {
      const res = await executeGetPODetails(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "get_margin_analysis": {
      const res = await executeGetMarginAnalysis(userId, organizationId, args);
      return { result: JSON.stringify(res) };
    }
    case "generate_bulk_purchase_orders": {
      const res = await executeGenerateBulkPOs(userId, organizationId);
      const attachment = (res as { attachment?: { type: string; payload: unknown } }).attachment;
      return {
        result: JSON.stringify(res),
        action: res.success
          ? { type: "po_bulk_preview_ready", data: { previewToken: (res as { previewToken?: string }).previewToken } }
          : undefined,
        attachment,
      };
    }
    case "aggregate_pending_purchase_orders": {
      const res = await executeAggregatePendingPOs(userId, organizationId, args);
      const attachment = (res as { attachment?: { type: string; payload: unknown } }).attachment;
      return {
        result: JSON.stringify(res),
        attachment,
      };
    }

    default:
      return { result: `Unknown extended tool: ${fnName}` };
  }
}
