#!/usr/bin/env npx tsx
/**
 * One-time migration script: encrypt existing plaintext OAuth tokens and SMTP passwords.
 *
 * Usage:
 *   CREDENTIAL_ENCRYPTION_KEY=<your-key> DATABASE_URL=<your-url> npx tsx scripts/migrate-encrypt-credentials.ts
 *
 * This script is idempotent — it skips values that are already encrypted.
 * Run it once after deploying the encryption update.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { emailConnections } from "../drizzle/schema";
import { encryptCredential, decryptCredential, isEncrypted } from "../server/utils/encryption";

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

  const connection = await mysql.createConnection(dbUrl);
  const db = drizzle(connection);

  console.log("Fetching all email connections...");
  const rows = await db.select().from(emailConnections);
  console.log(`Found ${rows.length} email connection(s).`);

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    const updates: Record<string, string | null> = {};

    // Encrypt accessToken if present and not already encrypted
    if (row.accessToken && !isEncrypted(row.accessToken)) {
      updates.accessToken = encryptCredential(row.accessToken);
    }

    // Encrypt refreshToken if present and not already encrypted
    if (row.refreshToken && !isEncrypted(row.refreshToken)) {
      updates.refreshToken = encryptCredential(row.refreshToken);
    }

    // Encrypt smtpPassword if present and not already encrypted
    if (row.smtpPassword && !isEncrypted(row.smtpPassword)) {
      updates.smtpPassword = encryptCredential(row.smtpPassword);
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(emailConnections)
        .set(updates as any)
        .where(
          // Use raw SQL to match by id since eq requires the column import
          (await import("drizzle-orm")).eq(emailConnections.id, row.id)
        );
      encrypted++;
      console.log(`  ✅ Encrypted credentials for connection #${row.id} (${row.provider} — ${row.email})`);
    } else {
      skipped++;
      console.log(`  ⏭️  Skipped connection #${row.id} (${row.provider} — ${row.email}) — already encrypted or no credentials`);
    }
  }

  console.log(`\nDone. Encrypted: ${encrypted}, Skipped: ${skipped}`);
  await connection.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
