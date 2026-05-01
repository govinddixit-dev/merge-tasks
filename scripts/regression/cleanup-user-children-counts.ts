/**
 * Probe row counts for every table that references users.id with
 * NO ACTION. The Phase 2 audit listed these tables but didn't enumerate
 * which had data. After the Step 11.5 failure (aiAuditLog non-empty),
 * we need to know which ones actually contain rows so they can be
 * cleaned in the wipe script before users delete.
 *
 * Read-only.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

// Every users.id NO ACTION child NOT already handled by the wipe script.
// (Already-handled tables removed: distributorProfiles, documentSequences,
// stores, products, clients, clientLogos, clientAssets, virtualProofs,
// proposals, proposalVersions, estimates, invoices, orders, purchaseOrders,
// printRequests, refund_requests, orgMembers, organizations.ownerId.)
const CANDIDATES = [
  "adminAuditLog",      // adminUserId
  "aiAuditLog",         // userId — the one that blocked us
  "aiEditFeedback",     // userId
  "aiTrainingData",     // userId
  "apiConnections",     // userId
  "copilot_conversations",  // userId
  "copilot_memory",         // userId
  "copilot_task_log",       // userId
  "copilotPendingActions",  // userId — CASCADE so auto-cleans, just count
  "emailConnections",   // userId
  "notifications",      // userId
  "poPreviewDrafts",    // userId
  "productCollections", // userId
  "suppliers",          // userId
  "verificationCodes",  // userId
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb null");

  console.log("=== USER-ID CHILD TABLE COUNTS (not yet handled by wipe script) ===\n");
  for (const t of CANDIDATES) {
    try {
      const r = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${t}`));
      const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
      const n = Number(rows[0].n);
      const mark = n > 0 ? "⚠" : "✓";
      console.log(`  ${mark} ${t.padEnd(28)} ${n}`);
    } catch (err) {
      const msg = (err as Error).message;
      const noTable = msg.includes("ER_NO_SUCH_TABLE") || msg.includes("doesn't exist") || msg.includes("Unknown table");
      console.log(`  ${noTable ? "—" : "?"} ${t.padEnd(28)} ${noTable ? "(no table)" : "(error)"}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
