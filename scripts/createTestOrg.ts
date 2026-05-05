#!/usr/bin/env npx tsx
/**
 * createTestOrg.ts — Stand up (or tear down) a second test organization
 * used by the Session 3 multi-tenant isolation verification.
 *
 * Usage:
 *   CREDENTIAL_ENCRYPTION_KEY=<key> DATABASE_URL=<url> \
 *     npx tsx scripts/createTestOrg.ts            # create
 *   CREDENTIAL_ENCRYPTION_KEY=<key> DATABASE_URL=<url> \
 *     npx tsx scripts/createTestOrg.ts --cleanup  # delete
 *
 * What it creates / removes:
 *   - organizations row { name: "Test Distributor Co", ownerId: 5 }
 *     (userId 5 = yancharitar11@gmail.com per Session 3 spec).
 *   - supplierCredentials row { supplierCode: "sanmar",
 *     accountId: "TEST_ACCOUNT_999",
 *     password: "test@testdistributor.com" } scoped to that org.
 *
 * Idempotent: re-running the create path updates the existing row, the
 * cleanup path removes any rows that match the well-known seed name.
 *
 * The credential values are intentionally fake and never sent to SanMar —
 * the script exists purely so the isolation tests can exercise a second
 * tenant alongside Otentik Brand (org 23).
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { organizations, supplierCredentials } from "../drizzle/schema";
import { encryptCredential } from "../server/utils/encryption";

const TEST_ORG_NAME = "Test Distributor Co";
const TEST_ORG_SLUG = "test-distributor-co";
const TEST_OWNER_ID = 5; // yancharitar11@gmail.com per Session 3 spec
const TEST_SUPPLIER_CODE = "sanmar";
const TEST_ACCOUNT_ID = "TEST_ACCOUNT_999";
const TEST_PASSWORD = "test@testdistributor.com";

async function main() {
  const cleanup = process.argv.includes("--cleanup");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    console.error("CREDENTIAL_ENCRYPTION_KEY is required");
    process.exit(1);
  }

  const connection = await mysql.createConnection(dbUrl);
  const db = drizzle(connection);

  try {
    if (cleanup) {
      // Find any rows matching the well-known seed name. Cascade through
      // supplierCredentials first so the org delete doesn't trip the FK.
      const orgs = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.name, TEST_ORG_NAME));
      for (const o of orgs) {
        const removed = await db
          .delete(supplierCredentials)
          .where(eq(supplierCredentials.organizationId, o.id));
        console.log(
          `Removed supplierCredentials for orgId=${o.id} (rows affected: ${removed[0]?.affectedRows ?? "?"})`,
        );
        await db.delete(organizations).where(eq(organizations.id, o.id));
        console.log(`Removed organization "${TEST_ORG_NAME}" id=${o.id}`);
      }
      if (orgs.length === 0) {
        console.log(`No "${TEST_ORG_NAME}" organization found — nothing to clean up.`);
      }
      return;
    }

    // Create or update the test org.
    let testOrgId: number;
    const existingOrg = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.name, TEST_ORG_NAME))
      .limit(1);
    if (existingOrg.length > 0) {
      testOrgId = existingOrg[0].id;
      console.log(`Re-using existing organization "${TEST_ORG_NAME}" id=${testOrgId}`);
    } else {
      const insertResult = await db.insert(organizations).values({
        name: TEST_ORG_NAME,
        slug: TEST_ORG_SLUG,
        ownerId: TEST_OWNER_ID,
      });
      testOrgId = Number(insertResult[0].insertId);
      console.log(`Inserted organization "${TEST_ORG_NAME}" id=${testOrgId}`);
    }

    // Upsert the fake credentials.
    const accountIdEnc = encryptCredential(TEST_ACCOUNT_ID);
    const passwordEnc = encryptCredential(TEST_PASSWORD);
    if (!accountIdEnc || !passwordEnc) {
      console.error("Encryption returned null — check CREDENTIAL_ENCRYPTION_KEY.");
      process.exit(1);
    }
    const existingCred = await db
      .select({ id: supplierCredentials.id })
      .from(supplierCredentials)
      .where(
        and(
          eq(supplierCredentials.organizationId, testOrgId),
          eq(supplierCredentials.supplierCode, TEST_SUPPLIER_CODE),
        ),
      )
      .limit(1);
    if (existingCred.length > 0) {
      await db
        .update(supplierCredentials)
        .set({ accountId: accountIdEnc, password: passwordEnc })
        .where(eq(supplierCredentials.id, existingCred[0].id));
      console.log(
        `Updated existing supplierCredentials row #${existingCred[0].id} for org=${testOrgId}`,
      );
    } else {
      await db.insert(supplierCredentials).values({
        organizationId: testOrgId,
        supplierCode: TEST_SUPPLIER_CODE,
        accountId: accountIdEnc,
        password: passwordEnc,
      });
      console.log(
        `Inserted supplierCredentials row for org=${testOrgId} supplier=${TEST_SUPPLIER_CODE}`,
      );
    }

    console.log("Done. Run the same script with --cleanup to remove.");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("createTestOrg failed:", err);
  process.exit(1);
});
