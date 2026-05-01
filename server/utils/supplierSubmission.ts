/**
 * supplierSubmission.ts — Provider-agnostic supplier submission layer.
 *
 * Registry pattern: when a supplier API integration is added (ASI, PromoStandards,
 * Sage, etc.), the developer creates one file implementing SupplierAdapter,
 * calls registerSupplierAdapter() at startup, and PO submission automatically
 * routes to it. No schema/router/frontend changes needed.
 *
 * Fallback chain: adapter found → use it. No adapter but email → PDF + email.
 * No adapter no email → return "download PDF manually".
 */

import type { PurchaseOrder } from "../../drizzle/schema";
import { getLogger } from "./logger";

const log = getLogger("supplier-submission");

// ── Types ───────────────────────────────────────────────────────────────────

export interface POSubmissionResult {
  success: boolean;
  method: "api" | "email" | "manual";
  confirmationNumber?: string;
  error?: string;
}

export interface SupplierAdapter {
  /** Source identifier — "asi" | "promostandards" | "sage" | etc. */
  source: string;
  /** Check if this adapter can handle the given PO */
  canSubmit(po: PurchaseOrder): boolean;
  /** Submit the PO to the supplier's API */
  submit(po: PurchaseOrder): Promise<POSubmissionResult>;
}

// ── Registry ────────────────────────────────────────────────────────────────

const adapters: SupplierAdapter[] = [];

/**
 * Register a supplier adapter. Called at server startup.
 * When ASI/PromoStandards/Sage integrations are built, each registers here.
 */
export function registerSupplierAdapter(adapter: SupplierAdapter): void {
  log.info(`Registered supplier adapter: ${adapter.source}`);
  adapters.push(adapter);
}

/**
 * Submit a PO to the supplier using the best available method.
 *
 * 1. Check registered adapters for one that can handle this PO
 * 2. If no adapter but supplier has email → return email method
 * 3. If nothing → return manual/download
 */
export async function submitPOToSupplier(po: PurchaseOrder): Promise<POSubmissionResult> {
  // 1. Try registered API adapters
  const adapter = adapters.find((a) => a.canSubmit(po));
  if (adapter) {
    log.info(`Submitting PO ${po.poNumber} via ${adapter.source} adapter`);
    try {
      return await adapter.submit(po);
    } catch (err) {
      log.error(`Adapter ${adapter.source} failed for PO ${po.poNumber}:`, err);
      // Fall through to email/manual
    }
  }

  // 2. Email fallback — supplier has a contact email
  if (po.supplierContactEmail) {
    return {
      success: true,
      method: "email",
      // The caller (PO router) handles actual email + PDF generation
    };
  }

  // 3. Manual fallback
  return {
    success: false,
    method: "manual",
    error: "No API integration or email configured for this supplier. Download the PO as PDF.",
  };
}

// ── Example adapter stubs (uncomment when integrations are built) ───────────

/*
// Future: ASI ESP Order API integration
registerSupplierAdapter({
  source: "asi",
  canSubmit: (po) => po.supplierSource === "asi" && !!process.env.ASI_API_KEY,
  submit: async (po) => {
    // Will call ASI ESP Order API with po.supplierCode, line items, ship-to
    // PO already has: supplierCode, lineItems with supplierSku, quantities
    throw new Error("ASI integration not yet implemented");
  },
});

// Future: PromoStandards / PSRESTful integration
registerSupplierAdapter({
  source: "promostandards",
  canSubmit: (po) => po.supplierSource === "promostandards" && !!process.env.PS_API_KEY,
  submit: async (po) => {
    // Will call PSRESTful REST API (wrapper around SOAP)
    throw new Error("PromoStandards integration not yet implemented");
  },
});
*/
