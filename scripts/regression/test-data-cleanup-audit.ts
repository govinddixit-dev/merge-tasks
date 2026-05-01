/**
 * Followup K Phase 2 read-only audit — comprehensive test data cleanup
 * scoping. Counts rows in every test-data candidate table, every preserve
 * table, samples real-data, and pulls FK metadata from information_schema.
 *
 * Read-only. No mutations.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function tryCount(db: Awaited<ReturnType<typeof getDb>>, table: string): Promise<string> {
  if (!db) return "(no db)";
  try {
    const r = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`));
    const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
    return String(rows[0].n);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("doesn't exist") || msg.includes("Unknown table")) return "(table not present)";
    return `(error: ${msg.slice(0, 80)})`;
  }
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb() returned null");

  // === 1 & 2. Counts ===
  const sections = [
    {
      header: "TEST DATA CANDIDATES (to be cleaned)",
      tables: [
        "stores", "clients", "clientLogos", "storeUsers", "storeProducts",
        "storeAllowedDomains", "storePages", "storeBranding", "storeDepartments",
        "storeLocations", "verificationCodes", "proposals", "invoices",
        "estimates", "orders", "purchaseOrders", "departmentApprovals",
        "storeAuditLog", "storeOrders", "storeCarts", "storeCheckouts",
        "storeAllowedEmails", "storeSso", "storeBudgets",
        "proposalProducts", "proposalProductVariants", "proposalProductImages",
        "proposalSizeCharts", "proposalPriceTiers",
        "clientLogoVariants", "clientProductConfig", "clientNotes",
        "distributorProfiles",
      ],
    },
    {
      header: "PRESERVE (real production data)",
      tables: [
        "products", "users", "organizations", "organizationMembers",
        "organizationInvites", "documentSequences",
      ],
    },
  ];

  for (const { header, tables } of sections) {
    console.log(`\n=== ${header} ===`);
    for (const t of tables) {
      const c = await tryCount(db, t);
      console.log(`  ${t.padEnd(32)} ${c}`);
    }
  }

  // === 3. Operator's real accounts ===
  console.log("\n=== OPERATOR USERS (auth identity) ===");
  const usersRes = await db.execute(sql`
    SELECT id, email, name, lastSignedIn FROM users ORDER BY id
  `);
  const userRows = (usersRes as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of userRows) console.log("  " + JSON.stringify(r));

  console.log("\n=== ORGANIZATIONS ===");
  const orgsRes = await db.execute(sql`SELECT id, name FROM organizations ORDER BY id`);
  const orgRows = (orgsRes as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of orgRows) console.log("  " + JSON.stringify(r));

  console.log("\n=== ORG MEMBERSHIP (who belongs to org 23) ===");
  try {
    const memRes = await db.execute(sql`
      SELECT om.userId, om.organizationId, om.role, u.email
      FROM organizationMembers om
      JOIN users u ON u.id = om.userId
      WHERE om.organizationId = 23
      ORDER BY om.userId
    `);
    const memRows = (memRes as unknown as [Array<Record<string, unknown>>, unknown])[0];
    if (memRows.length === 0) console.log("  (no members)");
    for (const r of memRows) console.log("  " + JSON.stringify(r));
  } catch (err) {
    console.log("  (organizationMembers query failed: " + (err as Error).message.slice(0, 100) + ")");
  }

  // === 4. FK cascade audit ===
  console.log("\n=== FOREIGN KEYS REFERENCING stores.id ===");
  const fkStoresRes = await db.execute(sql`
    SELECT k.TABLE_NAME, k.COLUMN_NAME, k.CONSTRAINT_NAME, r.DELETE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
      AND k.TABLE_SCHEMA = r.CONSTRAINT_SCHEMA
    WHERE k.TABLE_SCHEMA = DATABASE()
      AND k.REFERENCED_TABLE_NAME = 'stores'
    ORDER BY k.TABLE_NAME
  `);
  const fkStores = (fkStoresRes as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of fkStores) console.log("  " + JSON.stringify(r));

  console.log("\n=== FOREIGN KEYS REFERENCING clients.id ===");
  const fkClientsRes = await db.execute(sql`
    SELECT k.TABLE_NAME, k.COLUMN_NAME, k.CONSTRAINT_NAME, r.DELETE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
      AND k.TABLE_SCHEMA = r.CONSTRAINT_SCHEMA
    WHERE k.TABLE_SCHEMA = DATABASE()
      AND k.REFERENCED_TABLE_NAME = 'clients'
    ORDER BY k.TABLE_NAME
  `);
  const fkClients = (fkClientsRes as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of fkClients) console.log("  " + JSON.stringify(r));

  // === 5. Products audit ===
  console.log("\n=== PRODUCTS TABLE (SanMar catalog — must be preserved) ===");
  const prodCount = await tryCount(db, "products");
  console.log(`  total rows: ${prodCount}`);
  try {
    const supRes = await db.execute(sql`SELECT COUNT(DISTINCT supplierStyleId) AS n FROM products`);
    const supRows = (supRes as unknown as [Array<{ n: number }>, unknown])[0];
    console.log(`  distinct supplierStyleId: ${supRows[0].n}`);
  } catch (err) {
    console.log("  supplier distinct query: " + (err as Error).message.slice(0, 100));
  }
  try {
    const sampleRes = await db.execute(sql`SELECT id, supplierStyleId, name, category FROM products ORDER BY id LIMIT 5`);
    const sampleRows = (sampleRes as unknown as [Array<Record<string, unknown>>, unknown])[0];
    console.log("  spot-check first 5 products:");
    for (const r of sampleRows) console.log("    " + JSON.stringify(r));
  } catch (err) {
    console.log("  products sample query: " + (err as Error).message.slice(0, 100));
  }

  // === 6. Audit log presence ===
  console.log("\n=== AUDIT LOG TABLES (check existence) ===");
  for (const t of ["audit_log", "auditLog", "auditLogs", "audit_logs"]) {
    const c = await tryCount(db, t);
    console.log(`  ${t.padEnd(20)} ${c}`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});
