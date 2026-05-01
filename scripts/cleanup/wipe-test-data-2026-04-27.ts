/**
 * ONE-SHOT TEST DATA WIPE — Followup K, Phase 8 Sprint
 * Date: 2026-04-27
 *
 * DESTRUCTIVE OPERATION. Wipes ALL test data (stores, clients,
 * clientLogos, storeUsers, storeProducts, proposals, invoices, estimates,
 * purchase orders, virtualProofs, audit_log, distributorProfiles for
 * non-preserved users, all users except id=1) while preserving:
 *   - userId=1 (info@otentikbrand.com / Yan Charitar — operator)
 *   - organizationId=23 (Otentik Brand — operator's org)
 *   - All 13,857 products (SanMar catalog — operator's personal credentials)
 *
 * Preserves products by reassigning userId=5's 1 orphan product to userId=1
 * before deleting users.
 *
 * Modes:
 *   pnpm tsx scripts/cleanup/wipe-test-data-2026-04-27.ts dry-run
 *     - SELECT COUNT(*) preview of every planned DELETE/UPDATE
 *     - Worker-idle check
 *     - No DB changes
 *
 *   pnpm tsx scripts/cleanup/wipe-test-data-2026-04-27.ts execute
 *     - PRE-EXECUTION snapshot of all tracked tables
 *     - Worker-idle check (aborts if jobs in flight)
 *     - 11-step transactional cleanup (atomic rollback on any failure)
 *     - POST-EXECUTION snapshot
 *     - Preserved-state assertions (throws if any fail)
 *
 * Rollback: If transaction fails mid-execution, all prior steps roll back
 * automatically. If verification fails post-execution, restore from RDS
 * snapshot taken pre-execution.
 *
 * NOT FOR REPEATED USE. The dated filename is intentional — this is a
 * historical artifact, not an automation. Future similar operations
 * should be new scripts with their own audit trails.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { webstoreRenderQueue } from "../../server/queue/webstore-render-queue";

const PRESERVE_USER_ID = 1;
const PRESERVE_ORG_ID = 23;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const TRACKED_TABLES = [
  "stores", "clients", "clientLogos", "storeUsers", "storeProducts",
  "proposals", "invoices", "estimates", "purchaseOrders", "virtualProofs",
  "audit_log", "distributorProfiles", "users", "products", "organizations",
] as const;

async function snapshot(db: Db, label: string): Promise<void> {
  console.log(`\n=== ${label} SNAPSHOT ===`);
  for (const t of TRACKED_TABLES) {
    const r = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${t}`));
    const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
    console.log(`  ${t.padEnd(28)} ${rows[0].n}`);
  }
}

async function assertWorkerIdle(): Promise<void> {
  console.log("\n=== WORKER IDLE CHECK ===");
  const counts = await webstoreRenderQueue.getJobCounts("wait", "active", "delayed");
  console.log(`  BullMQ counts: ${JSON.stringify(counts)}`);
  if ((counts.active ?? 0) > 0 || (counts.wait ?? 0) > 0) {
    throw new Error(
      `Worker queue not idle: wait=${counts.wait} active=${counts.active}. ` +
      `Wait for completion before cleanup.`
    );
  }
  console.log("  ✓ Worker queue is idle — safe to proceed");
}

async function previewDelete(db: Db, label: string, table: string, where = "1=1"): Promise<void> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`));
  const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
  console.log(`  ${label.padEnd(60)} ${rows[0].n} rows`);
}

async function execStep(tx: Tx, label: string, query: ReturnType<typeof sql>): Promise<number> {
  const r = await tx.execute(query);
  const affected = (r as unknown as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0;
  console.log(`  ${label.padEnd(60)} ${affected} rows`);
  return affected;
}

async function runDryRun(db: Db): Promise<void> {
  console.log("\n=== DRY-RUN PREVIEW (no changes will be made) ===");

  console.log("\n--- Step 1: Leaf tables blocking proposalProducts AND proposals ---");
  await previewDelete(db, "Step 1.1 proposalOrderItems (blocks both proposalProducts + proposals)", "proposalOrderItems");
  await previewDelete(db, "Step 1.2 proposalProductVariants", "proposalProductVariants");
  await previewDelete(db, "Step 1.3 proposalProductImages", "proposalProductImages");
  await previewDelete(db, "Step 1.4 proposalSizeCharts", "proposalSizeCharts");
  await previewDelete(db, "Step 1.5 proposalPriceTiers", "proposalPriceTiers");

  console.log("\n--- Step 2: proposalProducts (now safe — children gone) ---");
  await previewDelete(db, "Step 2 proposalProducts", "proposalProducts");

  console.log("\n--- Step 3: Other tables blocking proposals ---");
  await previewDelete(db, "Step 3.1 proposalVersions (blocks proposals)", "proposalVersions");
  await previewDelete(db, "Step 3.2 departmentApprovals (blocks proposals)", "departmentApprovals");
  await previewDelete(db, "Step 3.3 virtualProofs (blocks proposals AND clients)", "virtualProofs");
  await previewDelete(db, "Step 3.4 refund_requests (blocks proposals AND storeUsers)", "refund_requests");

  console.log("\n--- Step 4: order/invoice/estimate/PO chain (blocks proposals) ---");
  await previewDelete(db, "Step 4.1 orderItems (blocks orders)", "orderItems");
  await previewDelete(db, "Step 4.2 promoCodeUsages (blocks orders AND storeUsers)", "promoCodeUsages");
  await previewDelete(db, "Step 4.3 invoices (refs proposals, estimates, orders)", "invoices");
  await previewDelete(db, "Step 4.4 estimates (cascade-cleans 2 children; refs proposals)", "estimates");
  await previewDelete(db, "Step 4.5 purchaseOrders (cascade-cleans purchaseOrderEvents)", "purchaseOrders");
  await previewDelete(db, "Step 4.6 orders (refs proposals, storeUsers)", "orders");

  console.log("\n--- Step 5: proposals (all referencers now gone) ---");
  await previewDelete(db, "Step 5 proposals", "proposals");

  console.log("\n--- Step 6: Store-blocking children ---");
  await previewDelete(db, "Step 6.1 storeProducts", "storeProducts");
  await previewDelete(db, "Step 6.2 storePasswordTokens (blocks storeUsers)", "storePasswordTokens");
  await previewDelete(db, "Step 6.3 storeAllowedDomains", "storeAllowedDomains");
  await previewDelete(db, "Step 6.4 storeVerificationCodes", "storeVerificationCodes");
  await previewDelete(db, "Step 6.5 promoCodes", "promoCodes");
  await previewDelete(db, "Step 6.6 customOrderRequests", "customOrderRequests");
  await previewDelete(db, "Step 6.7 emailUnsubscribes", "emailUnsubscribes");
  await previewDelete(db, "Step 6.8 printRequests", "printRequests");
  await previewDelete(db, "Step 6.9 storeUsers (SET NULL handles 3 child columns)", "storeUsers");

  console.log("\n--- Step 7: Reassign user-5's orphan product ---");
  await previewDelete(db, "Step 7 UPDATE products SET userId=1 WHERE userId=5", "products", "userId = 5");

  console.log("\n--- Step 8: Stores ---");
  await previewDelete(db, "Step 8 stores (cascade-cleans 6 child tables)", "stores");

  console.log("\n--- Step 9: Client-scoped child tables ---");
  await previewDelete(db, "Step 9.1 clientLogos", "clientLogos");
  await previewDelete(db, "Step 9.2 clientContacts", "clientContacts");
  await previewDelete(db, "Step 9.3 clientAssets", "clientAssets");
  await previewDelete(db, "Step 9.4 clientProductConfig (cascade-cleans 4 children)", "clientProductConfig");

  console.log("\n--- Step 10: Clients ---");
  await previewDelete(db, "Step 10 clients (cascade-cleans psRestfulSubAccounts)", "clients");

  console.log("\n--- Step 11: distributorProfiles, audit_log, documentSequences, user-children, users ---");
  await previewDelete(db, `Step 11.1 distributorProfiles WHERE userId != ${PRESERVE_USER_ID}`, "distributorProfiles", `userId != ${PRESERVE_USER_ID}`);
  await previewDelete(db, "Step 11.2 audit_log (full wipe)", "audit_log");
  await previewDelete(db, `Step 11.3 documentSequences WHERE userId != ${PRESERVE_USER_ID}`, "documentSequences", `userId != ${PRESERVE_USER_ID}`);
  await previewDelete(db, `Step 11.4 documentSequences SET nextNumber=1 WHERE userId=${PRESERVE_USER_ID}`, "documentSequences", `userId = ${PRESERVE_USER_ID}`);
  await previewDelete(db, "Step 11.5 aiEditFeedback (defensive — blocks aiTrainingData)", "aiEditFeedback");
  await previewDelete(db, "Step 11.6 aiTrainingData", "aiTrainingData");
  await previewDelete(db, "Step 11.7 aiAuditLog", "aiAuditLog");
  await previewDelete(db, "Step 11.8 copilot_conversations", "copilot_conversations");
  await previewDelete(db, "Step 11.9 notifications", "notifications");
  await previewDelete(db, "Step 11.10 poPreviewDrafts", "poPreviewDrafts");
  await previewDelete(db, "Step 11.11 productCollections", "productCollections");
  await previewDelete(db, `Step 11.12 users WHERE id != ${PRESERVE_USER_ID}`, "users", `id != ${PRESERVE_USER_ID}`);

  console.log("\n=== DRY-RUN COMPLETE — no changes made ===");
}

async function runExecute(db: Db): Promise<void> {
  console.log("\n=== EXECUTING TRANSACTIONAL CLEANUP ===");

  await db.transaction(async (tx) => {
    console.log("\n--- Step 1: Leaf tables blocking proposalProducts AND proposals ---");
    await execStep(tx, "Step 1.1 proposalOrderItems", sql`DELETE FROM proposalOrderItems`);
    await execStep(tx, "Step 1.2 proposalProductVariants", sql`DELETE FROM proposalProductVariants`);
    await execStep(tx, "Step 1.3 proposalProductImages", sql`DELETE FROM proposalProductImages`);
    await execStep(tx, "Step 1.4 proposalSizeCharts", sql`DELETE FROM proposalSizeCharts`);
    await execStep(tx, "Step 1.5 proposalPriceTiers", sql`DELETE FROM proposalPriceTiers`);

    console.log("\n--- Step 2: proposalProducts (children gone) ---");
    await execStep(tx, "Step 2 proposalProducts", sql`DELETE FROM proposalProducts`);

    console.log("\n--- Step 3: Other tables blocking proposals ---");
    await execStep(tx, "Step 3.1 proposalVersions", sql`DELETE FROM proposalVersions`);
    await execStep(tx, "Step 3.2 departmentApprovals", sql`DELETE FROM departmentApprovals`);
    await execStep(tx, "Step 3.3 virtualProofs", sql`DELETE FROM virtualProofs`);
    await execStep(tx, "Step 3.4 refund_requests", sql`DELETE FROM refund_requests`);

    console.log("\n--- Step 4: order/invoice/estimate/PO chain (blocks proposals) ---");
    await execStep(tx, "Step 4.1 orderItems", sql`DELETE FROM orderItems`);
    await execStep(tx, "Step 4.2 promoCodeUsages", sql`DELETE FROM promoCodeUsages`);
    await execStep(tx, "Step 4.3 invoices", sql`DELETE FROM invoices`);
    await execStep(tx, "Step 4.4 estimates (cascade-cleans 2 children)", sql`DELETE FROM estimates`);
    await execStep(tx, "Step 4.5 purchaseOrders (cascade-cleans purchaseOrderEvents)", sql`DELETE FROM purchaseOrders`);
    await execStep(tx, "Step 4.6 orders", sql`DELETE FROM orders`);

    console.log("\n--- Step 5: proposals (all referencers gone) ---");
    await execStep(tx, "Step 5 proposals", sql`DELETE FROM proposals`);

    console.log("\n--- Step 6: Store-blocking children ---");
    await execStep(tx, "Step 6.1 storeProducts", sql`DELETE FROM storeProducts`);
    await execStep(tx, "Step 6.2 storePasswordTokens", sql`DELETE FROM storePasswordTokens`);
    await execStep(tx, "Step 6.3 storeAllowedDomains", sql`DELETE FROM storeAllowedDomains`);
    await execStep(tx, "Step 6.4 storeVerificationCodes", sql`DELETE FROM storeVerificationCodes`);
    await execStep(tx, "Step 6.5 promoCodes", sql`DELETE FROM promoCodes`);
    await execStep(tx, "Step 6.6 customOrderRequests", sql`DELETE FROM customOrderRequests`);
    await execStep(tx, "Step 6.7 emailUnsubscribes", sql`DELETE FROM emailUnsubscribes`);
    await execStep(tx, "Step 6.8 printRequests", sql`DELETE FROM printRequests`);
    await execStep(tx, "Step 6.9 storeUsers", sql`DELETE FROM storeUsers`);

    console.log("\n--- Step 7: Reassign user-5's orphan product ---");
    const reassigned = await execStep(
      tx,
      "Step 7 UPDATE products SET userId=1 WHERE userId=5",
      sql`UPDATE products SET userId = ${PRESERVE_USER_ID} WHERE userId = 5`,
    );
    if (reassigned !== 1) {
      throw new Error(
        `Step 7 expected exactly 1 product reassignment, got ${reassigned}. ` +
        `Aborting transaction — investigate before retry.`,
      );
    }

    console.log("\n--- Step 8: Stores (cascade auto-cleans CASCADE children) ---");
    await execStep(tx, "Step 8 stores", sql`DELETE FROM stores`);

    console.log("\n--- Step 9: Client-scoped child tables ---");
    await execStep(tx, "Step 9.1 clientLogos", sql`DELETE FROM clientLogos`);
    await execStep(tx, "Step 9.2 clientContacts", sql`DELETE FROM clientContacts`);
    await execStep(tx, "Step 9.3 clientAssets", sql`DELETE FROM clientAssets`);
    await execStep(tx, "Step 9.4 clientProductConfig", sql`DELETE FROM clientProductConfig`);

    console.log("\n--- Step 10: Clients (cascade auto-cleans psRestfulSubAccounts) ---");
    await execStep(tx, "Step 10 clients", sql`DELETE FROM clients`);

    console.log("\n--- Step 11: distributorProfiles, audit_log, documentSequences, user-children, users ---");
    await execStep(
      tx,
      `Step 11.1 distributorProfiles WHERE userId != ${PRESERVE_USER_ID}`,
      sql`DELETE FROM distributorProfiles WHERE userId != ${PRESERVE_USER_ID}`,
    );
    await execStep(tx, "Step 11.2 audit_log", sql`DELETE FROM audit_log`);
    await execStep(
      tx,
      `Step 11.3 documentSequences WHERE userId != ${PRESERVE_USER_ID}`,
      sql`DELETE FROM documentSequences WHERE userId != ${PRESERVE_USER_ID}`,
    );
    await execStep(
      tx,
      `Step 11.4 documentSequences SET nextNumber=1 WHERE userId=${PRESERVE_USER_ID}`,
      sql`UPDATE documentSequences SET nextNumber = 1 WHERE userId = ${PRESERVE_USER_ID}`,
    );
    await execStep(tx, "Step 11.5 aiEditFeedback", sql`DELETE FROM aiEditFeedback`);
    await execStep(tx, "Step 11.6 aiTrainingData", sql`DELETE FROM aiTrainingData`);
    await execStep(tx, "Step 11.7 aiAuditLog", sql`DELETE FROM aiAuditLog`);
    await execStep(tx, "Step 11.8 copilot_conversations", sql`DELETE FROM copilot_conversations`);
    await execStep(tx, "Step 11.9 notifications", sql`DELETE FROM notifications`);
    await execStep(tx, "Step 11.10 poPreviewDrafts", sql`DELETE FROM poPreviewDrafts`);
    await execStep(tx, "Step 11.11 productCollections", sql`DELETE FROM productCollections`);
    const usersDeleted = await execStep(
      tx,
      `Step 11.12 users WHERE id != ${PRESERVE_USER_ID}`,
      sql`DELETE FROM users WHERE id != ${PRESERVE_USER_ID}`,
    );
    console.log(`  (CASCADE auto-cleans copilotPendingActions for ${usersDeleted} deleted users)`);
  });

  console.log("\n=== TRANSACTION COMMITTED ===");
}

async function verifyPreservedState(db: Db): Promise<void> {
  console.log("\n=== PRESERVED STATE VERIFICATION ===");
  const checks: Array<{ name: string; q: ReturnType<typeof sql>; assert: (n: number) => boolean }> = [
    { name: "products >= 13857", q: sql`SELECT COUNT(*) AS n FROM products`, assert: (n) => n >= 13857 },
    { name: "users == 1", q: sql`SELECT COUNT(*) AS n FROM users`, assert: (n) => n === 1 },
    { name: "users[0].id == 1", q: sql`SELECT id AS n FROM users LIMIT 1`, assert: (n) => n === 1 },
    { name: "organizations == 1", q: sql`SELECT COUNT(*) AS n FROM organizations`, assert: (n) => n === 1 },
    { name: "organizations[0].id == 23", q: sql`SELECT id AS n FROM organizations LIMIT 1`, assert: (n) => n === 23 },
    { name: "organizations.ownerId == 1", q: sql`SELECT ownerId AS n FROM organizations WHERE id = ${PRESERVE_ORG_ID}`, assert: (n) => n === 1 },
    { name: "stores == 0", q: sql`SELECT COUNT(*) AS n FROM stores`, assert: (n) => n === 0 },
    { name: "clients == 0", q: sql`SELECT COUNT(*) AS n FROM clients`, assert: (n) => n === 0 },
    { name: "storeProducts == 0", q: sql`SELECT COUNT(*) AS n FROM storeProducts`, assert: (n) => n === 0 },
    { name: "storeUsers == 0", q: sql`SELECT COUNT(*) AS n FROM storeUsers`, assert: (n) => n === 0 },
    { name: "audit_log == 0", q: sql`SELECT COUNT(*) AS n FROM audit_log`, assert: (n) => n === 0 },
    { name: "products with userId=5 == 0", q: sql`SELECT COUNT(*) AS n FROM products WHERE userId = 5`, assert: (n) => n === 0 },
  ];
  let failed = 0;
  for (const c of checks) {
    const r = await db.execute(c.q);
    const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
    const n = Number(rows[0].n);
    const ok = c.assert(n);
    console.log(`  ${ok ? "✓" : "✗"} ${c.name.padEnd(30)} actual: ${n}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    throw new Error(
      `${failed} preserved-state check(s) failed. ` +
      `Investigate before trusting cleanup; restore from RDS snapshot if needed.`,
    );
  }
  console.log("\n=== ALL CHECKS PASSED ===");
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "dry-run" && mode !== "execute") {
    console.error("Usage: pnpm tsx scripts/cleanup/wipe-test-data-2026-04-27.ts <dry-run|execute>");
    process.exit(1);
  }

  const banner =
    "\n" +
    "╔════════════════════════════════════════════════════════════════╗\n" +
    `║  TEST DATA WIPE — mode: ${mode.padEnd(40)}║\n` +
    `║  Date: ${new Date().toISOString().padEnd(56)}║\n` +
    `║  Preserve: userId=${PRESERVE_USER_ID}, organizationId=${PRESERVE_ORG_ID}                          ║\n` +
    "╚════════════════════════════════════════════════════════════════╝";
  console.log(banner);

  const db = await getDb();
  if (!db) throw new Error("getDb() returned null");

  try {
    await snapshot(db, "PRE-EXECUTION");
    await assertWorkerIdle();

    if (mode === "dry-run") {
      await runDryRun(db);
      return;
    }

    await runExecute(db);
    await snapshot(db, "POST-EXECUTION");
    await verifyPreservedState(db);
  } finally {
    // Always close the queue's Redis connection so the script exits cleanly.
    await webstoreRenderQueue.close();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\n=== CLEANUP FAILED ===\n", err);
  process.exit(1);
});
