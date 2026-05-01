/**
 * copilotTools.ts — barrel re-export
 *
 * This file was split into focused modules:
 *   - copilotToolDefs.ts        → EXTENDED_TOOLS array (tool definitions for the LLM)
 *   - copilotExecScope.ts       → shared buildToolScope helper
 *   - copilotExecClients.ts     → client CRUD executors
 *   - copilotExecOrders.ts      → order management executors
 *   - copilotExecProducts.ts    → product catalog + external search/import executors
 *   - copilotExecProposals.ts   → proposal management executors
 *   - copilotExecEstimates.ts   → estimate & invoice executors
 *   - copilotExecProofs.ts      → virtual proofing executors
 *   - copilotExecAnalytics.ts   → reports & analytics executors
 *   - copilotExecStores.ts      → store management executors
 *   - copilotExecBranding.ts    → branding + email executors
 *   - copilotExecutors.ts       → dispatcher + barrel re-exports
 *
 * All existing imports from "copilotTools" continue to work unchanged.
 */

export { EXTENDED_TOOLS } from "./copilotToolDefs";
export {
  executeCreateClient,
  executeUpdateClient,
  executeDeleteClient,
  executeGetClientDetails,
  executeListClients,
  executeDeleteStore,
  executeGetProposalDetails,
  executeListOrders,
  executeGetOrderDetails,
  executeCreateOrder,
  executeUpdateOrderStatus,
  executeCreateProduct,
  executeUpdateProduct,
  executeDeleteProduct,
  executeCreateEstimate,
  executeCreateInvoice,
  executeListEstimates,
  executeListInvoices,
  executeUpdateInvoiceStatus,
  executeListProposals,
  executeUpdateProposal,
  executeDeleteProposal,
  executeDuplicateProposal,
  executeConfigureCatalogVariants,
  executeCreateVirtualProof,
  executeListProofs,
  executeUpdateProofStatus,
  executeGetDashboardStats,
  executeGetReorderAlerts,
  executeGetChurnSignals,
  executeGetRefundReport,
  executeUpdateStore,
  executeListStores,
  executeGetStoreDetails,
  executeSendCustomEmail,
  executeGetBranding,
  executeUpdateBranding,
  executeExtendedTool,
} from "./copilotExecutors";
