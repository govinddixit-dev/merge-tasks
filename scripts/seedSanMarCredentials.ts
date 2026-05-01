#!/usr/bin/env npx tsx
/**
 * One-time seed: insert Otentik Brand's SanMar credentials into the new
 * `supplierCredentials` table for org 23.
 *
 * Usage:
 *   CREDENTIAL_ENCRYPTION_KEY=<key> DATABASE_URL=<url> \
 *     SANMAR_ACCOUNT_ID=<id> SANMAR_PASSWORD=<pwd> \
 *     npx tsx scripts/seedSanMarCredentials.ts
 *
 * Reads credentials from env at run time — no values are hardcoded. Safe to
 * re-run: existing rows for (orgId=23, supplierCode='sanmar') are updated
 * in place via the UNIQUE(organizationId, supplierCode) constraint.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { supplierCredentials } from "../drizzle/schema";
import { encryptCredential } from "../server/utils/encryption";

const OTENTIK_ORG_ID = 23;
const SUPPLIER_CODE = "sanmar";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    console.error("CREDENTIAL_ENCRYPTION_KEY is required");
    process.exit(1);
  }
  const accountId = process.env.SANMAR_ACCOUNT_ID;
  const password = process.env.SANMAR_PASSWORD;
  if (!accountId || !password) {
    console.error("SANMAR_ACCOUNT_ID and SANMAR_PASSWORD must both be set in env");
    process.exit(1);
  }

  const accountIdEnc = encryptCredential(accountId);
  const passwordEnc = encryptCredential(password);
  if (!accountIdEnc || !passwordEnc) {
    console.error("Encryption returned null — check CREDENTIAL_ENCRYPTION_KEY");
    process.exit(1);
  }

  const connection = await mysql.createConnection(dbUrl);
  const db = drizzle(connection);

  try {
    const existing = await db
      .select({ id: supplierCredentials.id })
      .from(supplierCredentials)
      .where(
        and(
          eq(supplierCredentials.organizationId, OTENTIK_ORG_ID),
          eq(supplierCredentials.supplierCode, SUPPLIER_CODE),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(supplierCredentials)
        .set({ accountId: accountIdEnc, password: passwordEnc })
        .where(eq(supplierCredentials.id, existing[0].id));
      console.log(
        `Updated existing supplierCredentials row #${existing[0].id} for org=${OTENTIK_ORG_ID} supplier=${SUPPLIER_CODE}`,
      );
    } else {
      await db.insert(supplierCredentials).values({
        organizationId: OTENTIK_ORG_ID,
        supplierCode: SUPPLIER_CODE,
        accountId: accountIdEnc,
        password: passwordEnc,
      });
      console.log(
        `Inserted supplierCredentials row for org=${OTENTIK_ORG_ID} supplier=${SUPPLIER_CODE}`,
      );
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
