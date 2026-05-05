/**
 * email.ts  — thin barrel
 * ─────────────────────────────────────────────────────────────────────────────
 * Assembles the emailRouter by spreading three domain sub-routers.
 * All existing tRPC call paths (trpc.email.*) remain unchanged.
 *
 * Sub-modules:
 *   ./email/emailRouterHelpers      — pure OAuth/SMTP transport helpers (no procedures)
 *   ./email/emailRouterConnections  — listConnections, disconnect, setDefault, testConnection
 *   ./email/emailRouterGmail        — connectGmail, completeGmailConnect
 *   ./email/emailRouterOutlookSmtp  — connectOutlook, completeOutlookConnect, connectSMTP, sendEmail
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { router } from "../_core/trpc";
import { emailConnectionsRouter } from "./email/emailRouterConnections";
import { emailGmailRouter } from "./email/emailRouterGmail";
import { emailOutlookSmtpRouter } from "./email/emailRouterOutlookSmtp";

export const emailRouter = router({
  // ── Connection management ─────────────────────────────────────────────────
  ...emailConnectionsRouter._def.procedures,

  // ── Gmail OAuth ───────────────────────────────────────────────────────────
  ...emailGmailRouter._def.procedures,

  // ── Outlook OAuth + SMTP + send ───────────────────────────────────────────
  ...emailOutlookSmtpRouter._def.procedures,
});
