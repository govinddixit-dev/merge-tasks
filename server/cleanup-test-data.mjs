/**
 * Cleanup script to remove test data created by vitest runs.
 * 
 * Removes ALL test-named entries (not just duplicates) to keep DB clean.
 */

import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const db = drizzle(DATABASE_URL);

async function cleanup() {
  console.log("=== MergeTasks Test Data Cleanup ===\n");

  // 1. Remove ALL test-named clients
  const testClientNames = ["E2E Test Corp", "E2E Test Corp Updated", "Store Test Client", "Asset Test Client", "Vitest Corp", "Deletable Corp"];
  
  for (const name of testClientNames) {
    const rows = await db.execute(sql`SELECT id FROM clients WHERE companyName = ${name}`);
    const ids = rows[0];
    if (Array.isArray(ids) && ids.length > 0) {
      console.log(`Deleting ${ids.length} client(s) named "${name}"`);
      for (const row of ids) {
        // Delete related data first
        await db.execute(sql`DELETE FROM clientLogos WHERE clientId = ${row.id}`);
        await db.execute(sql`DELETE FROM clientAssets WHERE clientId = ${row.id}`);
        // Delete proposals linked to this client
        const proposals = await db.execute(sql`SELECT id FROM proposals WHERE clientId = ${row.id}`);
        if (Array.isArray(proposals[0])) {
          for (const p of proposals[0]) {
            await db.execute(sql`DELETE FROM proposalProducts WHERE proposalId = ${p.id}`);
            await db.execute(sql`DELETE FROM proposals WHERE id = ${p.id}`);
          }
        }
        // Delete stores linked to this client
        const stores = await db.execute(sql`SELECT id FROM stores WHERE clientId = ${row.id}`);
        if (Array.isArray(stores[0])) {
          for (const s of stores[0]) {
            await db.execute(sql`DELETE FROM storeProducts WHERE storeId = ${s.id}`);
            await db.execute(sql`DELETE FROM stores WHERE id = ${s.id}`);
          }
        }
        // Delete orders linked to this client
        const orders = await db.execute(sql`SELECT id FROM orders WHERE clientId = ${row.id}`);
        if (Array.isArray(orders[0])) {
          for (const o of orders[0]) {
            await db.execute(sql`DELETE FROM orderItems WHERE orderId = ${o.id}`);
            await db.execute(sql`DELETE FROM orders WHERE id = ${o.id}`);
          }
        }
        await db.execute(sql`DELETE FROM clients WHERE id = ${row.id}`);
      }
    } else {
      console.log(`Client "${name}": not found (clean)`);
    }
  }

  // 2. Remove ALL test-named products
  const testProductNames = ["Test Product", "Bulk Item A", "Bulk Item B", "Store Test Product"];
  
  for (const name of testProductNames) {
    const rows = await db.execute(sql`SELECT id FROM products WHERE name = ${name}`);
    const ids = rows[0];
    if (Array.isArray(ids) && ids.length > 0) {
      console.log(`Deleting ${ids.length} product(s) named "${name}"`);
      for (const row of ids) {
        await db.execute(sql`DELETE FROM storeProducts WHERE productId = ${row.id}`);
        await db.execute(sql`DELETE FROM proposalProducts WHERE productId = ${row.id}`);
        await db.execute(sql`DELETE FROM products WHERE id = ${row.id}`);
      }
    } else {
      console.log(`Product "${name}": not found (clean)`);
    }
  }

  // 3. Clean up test stores
  const testStoreNames = ["Duplicate Slug Store", "E2E Test Store", "E2E Test Store Updated", "Second Test Store"];
  for (const name of testStoreNames) {
    const rows = await db.execute(sql`SELECT id FROM stores WHERE name = ${name}`);
    const ids = rows[0];
    if (Array.isArray(ids) && ids.length > 0) {
      console.log(`Deleting ${ids.length} store(s) named "${name}"`);
      for (const row of ids) {
        await db.execute(sql`DELETE FROM storeProducts WHERE storeId = ${row.id}`);
        await db.execute(sql`DELETE FROM stores WHERE id = ${row.id}`);
      }
    }
  }
  // Also clean stores with slugs starting with "e2e-test-store-" or "second-test-store-"
  const e2eStores = await db.execute(sql`SELECT id FROM stores WHERE slug LIKE 'e2e-test-store-%' OR slug LIKE 'second-test-store-%'`);
  if (Array.isArray(e2eStores[0]) && e2eStores[0].length > 0) {
    console.log(`Deleting ${e2eStores[0].length} store(s) with test slugs`);
    for (const row of e2eStores[0]) {
      await db.execute(sql`DELETE FROM storeProducts WHERE storeId = ${row.id}`);
      await db.execute(sql`DELETE FROM stores WHERE id = ${row.id}`);
    }
  }

  // 4. Clean up orphaned proposals
  const orphanedProposals = await db.execute(sql`
    SELECT p.id, p.title, p.clientId 
    FROM proposals p 
    LEFT JOIN clients c ON p.clientId = c.id 
    WHERE c.id IS NULL
  `);
  const orphanedRows = orphanedProposals[0];
  if (Array.isArray(orphanedRows) && orphanedRows.length > 0) {
    console.log(`Deleting ${orphanedRows.length} orphaned proposal(s)`);
    for (const row of orphanedRows) {
      await db.execute(sql`DELETE FROM proposalProducts WHERE proposalId = ${row.id}`);
      await db.execute(sql`DELETE FROM proposals WHERE id = ${row.id}`);
    }
  }

  // 5. Clean up "Test Proposal" entries
  const testProposals = await db.execute(sql`SELECT id FROM proposals WHERE title = 'Test Proposal'`);
  const testPropRows = testProposals[0];
  if (Array.isArray(testPropRows) && testPropRows.length > 0) {
    console.log(`Deleting ${testPropRows.length} "Test Proposal" entries`);
    for (const row of testPropRows) {
      await db.execute(sql`DELETE FROM proposalProducts WHERE proposalId = ${row.id}`);
      await db.execute(sql`DELETE FROM proposals WHERE id = ${row.id}`);
    }
  }

  // Summary
  console.log("\n=== Cleanup Complete ===");
  
  const clientCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM clients`);
  const productCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM products`);
  const storeCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM stores`);
  const proposalCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM proposals`);
  
  console.log(`Remaining: ${clientCount[0][0].cnt} clients, ${productCount[0][0].cnt} products, ${storeCount[0][0].cnt} stores, ${proposalCount[0][0].cnt} proposals`);
  
  process.exit(0);
}

cleanup().catch(err => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
