/**
 * Supplemental count for Followup K cleanup planning — child tables that
 * my previous audit missed via FK reference, plus orgMembers (correct
 * table name) and a products spot-check.
 *
 * Read-only.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb null");
  const supplemental = [
    "promoCodes", "customOrderRequests", "emailUnsubscribes", "printRequests",
    "refund_requests", "storePasswordTokens", "storeVerificationCodes",
    "printProducts", "printSupplierConnections", "storeIdentityProviders",
    "storeMediaFiles", "clientAssets", "clientContacts", "virtualProofs",
    "psRestfulSubAccounts", "orgMembers", "orgInvites",
  ];
  for (const t of supplemental) {
    try {
      const r = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${t}`));
      const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
      console.log(`  ${t.padEnd(32)} ${rows[0].n}`);
    } catch (err) {
      const msg = (err as Error).message;
      const isNoTable = msg.includes("ER_NO_SUCH_TABLE") || msg.includes("doesn't exist") || msg.includes("Unknown table");
      console.log(`  ${t.padEnd(32)} ${isNoTable ? "(no table)" : "(error)"}`);
    }
  }
  console.log("\n  --- products spot-check ---");
  const sample = await db.execute(sql`SELECT id, name, category FROM products ORDER BY id LIMIT 5`);
  const sRows = (sample as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of sRows) console.log("    " + JSON.stringify(r));

  console.log("\n  --- orgMembers for org 23 ---");
  try {
    const m = await db.execute(sql`
      SELECT om.userId, om.organizationId, u.email
      FROM orgMembers om
      JOIN users u ON u.id = om.userId
      WHERE om.organizationId = 23
      ORDER BY om.userId
    `);
    const mRows = (m as unknown as [Array<Record<string, unknown>>, unknown])[0];
    if (mRows.length === 0) console.log("    (no members)");
    for (const r of mRows) console.log("    " + JSON.stringify(r));
  } catch (err) {
    console.log("    error: " + (err as Error).message.slice(0, 100));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
