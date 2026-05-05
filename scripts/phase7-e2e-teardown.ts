#!/usr/bin/env npx tsx
/**
 * phase7-e2e-teardown.ts — Remove everything seeded by phase7-e2e-setup.ts.
 *
 * Marker-based: finds the user via openId="test-p7-e2e-user" and
 * cascade-deletes everything owned by that user in reverse FK order:
 *   storeProducts → stores → products → clients → users
 *
 * Idempotent — safe to re-run; missing rows are silently skipped.
 *
 * Usage
 * ─────
 *   DATABASE_URL=… npx tsx scripts/phase7-e2e-teardown.ts
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, inArray } from "drizzle-orm";
import { users, clients, products, stores, storeProducts } from "../drizzle/schema";

const MARKER_OPENID = "test-p7-e2e-user";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[phase7-e2e-teardown] FATAL: DATABASE_URL not set");
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbUrl);
  const db = drizzle(conn);

  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.openId, MARKER_OPENID)).limit(1);
  if (!u) {
    console.log("[phase7-e2e-teardown] no test user found — nothing to remove");
    await conn.end();
    return;
  }
  const userId = u.id;

  // Reverse FK order. storeProducts must go before stores; products
  // before clients via the user FK; clients before users.
  const sps = await db.select({ id: storeProducts.id })
    .from(storeProducts)
    .innerJoin(stores, eq(stores.id, storeProducts.storeId))
    .where(eq(stores.userId, userId));
  let spDeleted = 0;
  if (sps.length > 0) {
    await db.delete(storeProducts).where(inArray(storeProducts.id, sps.map(r => r.id)));
    spDeleted = sps.length;
  }

  const storesResult = await db.delete(stores).where(eq(stores.userId, userId));
  const storesDeleted = readAffected(storesResult);

  const productsResult = await db.delete(products).where(eq(products.userId, userId));
  const productsDeleted = readAffected(productsResult);

  const clientsResult = await db.delete(clients).where(eq(clients.userId, userId));
  const clientsDeleted = readAffected(clientsResult);

  await db.delete(users).where(eq(users.id, userId));

  console.log("[phase7-e2e-teardown] removed:");
  console.log(`  storeProducts: ${spDeleted}`);
  console.log(`  stores:        ${storesDeleted}`);
  console.log(`  products:      ${productsDeleted}`);
  console.log(`  clients:       ${clientsDeleted}`);
  console.log(`  users:         1 (id=${userId})`);

  await conn.end();
}

function readAffected(r: unknown): number {
  return (r as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
}

main().catch(err => {
  console.error("[phase7-e2e-teardown] FAILED:", err);
  process.exit(1);
});
