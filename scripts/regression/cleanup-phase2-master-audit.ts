/**
 * Followup K Phase 2 master audit (revised) — investigation only.
 * Five domains: users.id FK map, org-scoping mechanism, product tenant
 * isolation, hardcoded mock data, backup verification.
 *
 * Read-only. No mutations.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb null");

  // ── DOMAIN 1: FK map for users.id ──
  console.log("\n=== D1.1 — Foreign keys referencing users.id ===");
  const fkUsers = await db.execute(sql`
    SELECT k.TABLE_NAME, k.COLUMN_NAME, k.CONSTRAINT_NAME, r.DELETE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
      AND k.TABLE_SCHEMA = r.CONSTRAINT_SCHEMA
    WHERE k.TABLE_SCHEMA = DATABASE()
      AND k.REFERENCED_TABLE_NAME = 'users'
    ORDER BY k.TABLE_NAME
  `);
  const fkUsersRows = (fkUsers as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of fkUsersRows) console.log("  " + JSON.stringify(r));

  console.log("\n=== D1.2 — Product ownership distribution by userId ===");
  const ownDist = await db.execute(sql`
    SELECT userId, COUNT(*) AS productCount FROM products GROUP BY userId ORDER BY productCount DESC
  `);
  const ownRows = (ownDist as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of ownRows) console.log("  " + JSON.stringify(r));

  // ── DOMAIN 2: Org-scoping ──
  console.log("\n=== D2.1 — users.organizationId column? ===");
  const usersDesc = await db.execute(sql`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME LIKE '%rganization%' OR COLUMN_NAME LIKE '%rg%'
  `);
  const usersDescRows = (usersDesc as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of usersDescRows) console.log("  " + JSON.stringify(r));

  console.log("\n=== D2.2 — distributorProfiles.organizationId values ===");
  const dpRows = await db.execute(sql`
    SELECT id, userId, organizationId, companyName FROM distributorProfiles ORDER BY userId
  `);
  const dpData = (dpRows as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of dpData) console.log("  " + JSON.stringify(r));

  console.log("\n=== D2.3 — orgMembers full content (we know it's empty but confirm) ===");
  const omRows = await db.execute(sql`SELECT * FROM orgMembers`);
  const omData = (omRows as unknown as [Array<Record<string, unknown>>, unknown])[0];
  console.log("  total rows: " + omData.length);
  for (const r of omData.slice(0, 5)) console.log("  " + JSON.stringify(r));

  // ── DOMAIN 5: DATABASE_URL host check ──
  console.log("\n=== D5 — DATABASE_URL host verification (masked) ===");
  const dbUrl = process.env.DATABASE_URL || "(unset)";
  const masked = dbUrl.replace(/\/\/[^@]*@/, "//MASKED@").replace(/:[^@/]*@/g, ":MASKED@");
  console.log("  DATABASE_URL: " + masked);
  const hostMatch = dbUrl.match(/@([^:/]+)/);
  if (hostMatch) {
    const host = hostMatch[1];
    console.log("  host: " + host);
    console.log("  is-RDS: " + (host.includes("rds.amazonaws.com") ? "YES" : "NO"));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
