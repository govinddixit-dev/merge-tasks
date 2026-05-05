/**
 * sanMarCredentialResolver.ts — Look up the SanMar credentials a sync run
 * should authenticate with for a given organization.
 *
 * Resolution order:
 *   1. Per-org row in `supplierCredentials` where supplierCode='sanmar'
 *      (the canonical, encrypted-at-rest source).
 *   2. Platform env vars (SANMAR_ACCOUNT_ID / SANMAR_PASSWORD) — preserved
 *      so Otentik Brand and other tenants without DB rows keep syncing.
 *   3. null — caller treats as "no credentials available" and skips.
 *
 * The resolver NEVER logs the plaintext credential values. The `source`
 * field on the return type is what gets logged at info level so operators
 * can see, per run, whether the org was using its own credentials or
 * inheriting the platform fallback.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { supplierCredentials } from "../../drizzle/schema";
import { decryptCredential } from "../utils/encryption";
import { getLogger } from "../utils/logger";

const log = getLogger("sanmar-creds");

export type CredentialSource = "db" | "env";

export interface ResolvedSanMarCredentials {
  accountId: string;
  password: string;
  source: CredentialSource;
}

/**
 * Pull the org's SanMar credentials from the DB, falling back to env vars.
 * Returns null only when neither source is configured.
 *
 * The `db` argument is injectable for tests; in production callers pass the
 * already-resolved drizzle handle to avoid an extra `await getDb()`.
 */
export async function resolveSanMarCredentials(
  organizationId: number | null,
  deps: {
    db?: Awaited<ReturnType<typeof getDb>>;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ResolvedSanMarCredentials | null> {
  const env = deps.env ?? process.env;
  const db = deps.db ?? (await getDb());

  if (db && organizationId !== null) {
    const rows = await db
      .select({
        accountId: supplierCredentials.accountId,
        password: supplierCredentials.password,
      })
      .from(supplierCredentials)
      .where(
        and(
          eq(supplierCredentials.organizationId, organizationId),
          eq(supplierCredentials.supplierCode, "sanmar"),
        ),
      )
      .limit(1);
    if (rows.length > 0) {
      const accountId = decryptCredential(rows[0].accountId);
      const password = decryptCredential(rows[0].password);
      if (accountId && password) {
        log.info(
          `Resolved SanMar credentials for org=${organizationId} source=db`,
        );
        return { accountId, password, source: "db" };
      }
      log.warn(
        `SanMar credentials row exists for org=${organizationId} but decrypted to empty values — falling back to env`,
      );
    }
  }

  const accountId = env.SANMAR_ACCOUNT_ID ?? "";
  const password = env.SANMAR_PASSWORD ?? "";
  if (accountId && password) {
    log.info(
      `Resolved SanMar credentials for org=${organizationId ?? "<solo>"} source=env`,
    );
    return { accountId, password, source: "env" };
  }
  return null;
}
