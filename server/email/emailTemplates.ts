/**
 * emailTemplates.ts  — thin barrel
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-exports the complete public surface of the three-lane email template
 * system.  All existing import paths remain unchanged.
 *
 * Sub-modules:
 *   ./emailTemplates/emailTemplateBase       — types, helpers, buildEmailHtml
 *   ./emailTemplates/emailTemplatesDistributor — Lane 1 (MT → Distributor)
 *   ./emailTemplates/emailTemplatesClient      — Lane 2 (Distributor → Client)
 *   ./emailTemplates/emailTemplatesStore       — Lane 3 (Store → Client)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Base (types + generic builder) ───────────────────────────────────────────
export {
  MT,
  buildEmailHtml,
  formatCurrency,
  lightenHex,
  renderProductCard,
  renderAlertBox,
} from "./emailTemplates/emailTemplateBase";

export type {
  EmailProductCard,
  EmailBranding,
  BuildEmailOptions,
} from "./emailTemplates/emailTemplateBase";

// ── Lane 1 — MergeTasks → Distributor ────────────────────────────────────────
export {
  buildFulfillmentApprovedEmail,
  buildOrderShippedEmail,
  buildStoreApprovedEmail,
  buildStoreChangesRequestedEmail,
} from "./emailTemplates/emailTemplatesDistributor";

// ── Lane 2 — Distributor → End Client ────────────────────────────────────────
export {
  buildProposalSentEmail,
  buildDeptApprovalRequestEmail,
  buildStoreApprovalRequestEmail,
} from "./emailTemplates/emailTemplatesClient";

// ── Lane 3 — Store/Portal → End Client ───────────────────────────────────────
export {
  buildStoreInviteEmail,
  buildVerificationCodeEmail,
  buildCustomRequestRejectedEmail,
} from "./emailTemplates/emailTemplatesStore";
