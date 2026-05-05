/**
 * actionClassifier.ts — Copilot Action Risk Classifier
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 2 of the AI Architecture: Human Approval Gate.
 *
 * Every tool call the LLM wants to execute is classified into one of three
 * risk tiers before execution:
 *
 *   SAFE    — read-only or low-stakes writes; execute immediately
 *   CONFIRM — irreversible or externally-visible actions; require 1-click approval
 *   BLOCK   — never allowed from the copilot (reserved for future use)
 *
 * The copilot tool loop checks this classification before calling executeTool().
 * If the result is CONFIRM, the action is persisted to copilotPendingActions and
 * a structured "awaiting_approval" response is returned to the client.
 *
 * The client renders an approval card; when the user clicks Approve/Deny, the
 * actionApproval.ts router resumes or discards the pending action.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ActionRisk = "SAFE" | "CONFIRM" | "BLOCK";

export interface ClassifiedAction {
  risk: ActionRisk;
  /**
   * Human-readable summary shown in the approval card.
   * Only populated for CONFIRM and BLOCK tiers.
   */
  summary?: string;
}

/* ------------------------------------------------------------------ */
/*  Risk classification table                                          */
/* ------------------------------------------------------------------ */

/**
 * Tools that are SAFE to execute without human confirmation.
 * All read-only queries and non-destructive, non-external writes belong here.
 */
const SAFE_TOOLS = new Set<string>([
  // Read-only queries
  "search_clients",
  "search_products",
  "get_client_details",
  "list_orders",
  "get_order_details",
  "list_proposals",
  "get_proposal_details",
  "list_estimates",
  "list_invoices",
  "list_proofs",
  "get_dashboard_stats",
  "get_reorder_alerts",
  "get_churn_signals",
  "get_refund_report",
  "list_stores",
  "get_store_details",
  "list_clients",
  "get_branding",
  // Low-stakes writes (no external side-effects, easily reversible)
  "create_proposal",        // creates a draft — not sent anywhere
  "update_proposal",        // edits a draft
  "duplicate_proposal",     // creates a copy
  "create_estimate",        // internal document, not sent
  "create_product",         // adds to catalog
  "update_product",         // edits catalog entry
  "configure_catalog_variants",
  "create_virtual_proof",
  "update_proof_status",
  "assign_store_products",
  "optimize_store",         // AI text generation only, no external call
  "navigate_to_page",       // client-side navigation only
  "create_client",          // creates a local CRM record
  "update_client",          // edits a local CRM record
  "create_webstore",        // creates a draft store (not yet published)
]);

/**
 * Tools that REQUIRE human confirmation before execution.
 * These are irreversible, externally-visible, or destructive actions.
 *
 * Each entry maps tool name → a function that produces a human-readable
 * summary from the parsed arguments.
 */
const CONFIRM_TOOLS: Record<string, (args: Record<string, any>) => string> = {
  // Externally-visible: sends an email to a real person
  send_proposal: (a) =>
    `Send proposal${a.proposalId ? ` #${a.proposalId}` : ""} to ${a.recipientEmail ?? a.email ?? "client"}`,

  send_custom_email: (a) =>
    `Send email "${a.subject ?? "(no subject)"}" to ${a.to ?? a.recipientEmail ?? "recipient"}`,

  // Destructive: permanent deletes
  delete_client: (a) =>
    `Permanently delete client #${a.clientId ?? "?"} and all associated data`,

  delete_proposal: (a) =>
    `Permanently delete proposal #${a.proposalId ?? "?"}`,

  delete_product: (a) =>
    `Permanently delete product #${a.productId ?? "?"}`,

  delete_store: (a) =>
    `Permanently delete webstore #${a.storeId ?? "?"}`,

  // Irreversible financial / status changes
  create_order: (a) =>
    `Create order for proposal #${a.proposalId ?? "?"} (${a.items?.length ?? 0} line items)`,

  update_order_status: (a) =>
    `Change order #${a.orderId ?? "?"} status to "${a.status ?? "?"}"`,

  update_invoice_status: (a) =>
    `Change invoice #${a.invoiceId ?? "?"} status to "${a.status ?? "?"}"`,

  create_invoice: (a) =>
    `Create invoice for ${a.clientId ? `client #${a.clientId}` : "client"} — ${a.lineItems?.length ?? 0} line items`,

  // Branding changes affect live store appearance
  update_branding: (a) =>
    `Update branding for ${a.storeId ? `store #${a.storeId}` : "distributor profile"}`,

  update_store: (a) =>
    `Update webstore #${a.storeId ?? "?"} settings`,
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Classify a tool call by name and parsed arguments.
 *
 * @param toolName  The LLM tool function name (e.g. "send_proposal")
 * @param args      Parsed JSON arguments from the tool call
 * @returns         { risk, summary? }
 */
export function classifyAction(
  toolName: string,
  args: Record<string, any>
): ClassifiedAction {
  if (SAFE_TOOLS.has(toolName)) {
    return { risk: "SAFE" };
  }

  const summaryFn = CONFIRM_TOOLS[toolName];
  if (summaryFn) {
    return {
      risk: "CONFIRM",
      summary: summaryFn(args),
    };
  }

  // Unknown tool — default to CONFIRM so nothing slips through unreviewed
  return {
    risk: "CONFIRM",
    summary: `Execute unknown action: ${toolName}`,
  };
}
