/**
 * Migration 0100 verifier — proves the evaluateSelfSignupAllowed predicate
 * returns the right { allowed, reason } across the cross-product of modes
 * × scenarios (the matrix in the function's docblock).
 *
 * Also dumps the post-migration mode distribution across the stores
 * table so the operator can eyeball that the backfill populated as
 * expected.
 *
 * Pure predicate test — no tRPC, no HTTP, no Anthropic calls. Single
 * DB read for the mode-distribution report and a column-existence
 * check.
 *
 * Exits non-zero on any matrix mismatch or missing column.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  evaluateSelfSignupAllowed,
  type SelfSignupGateInputs,
  type SelfSignupGateResult,
  type SelfSignupMode,
} from "../../server/routers/storeAuth";

interface Case {
  label: string;
  input: SelfSignupGateInputs;
  expected: { allowed: boolean };
}

const ALL_MODES: SelfSignupMode[] = ["closed", "invite_only", "domain_whitelist", "open_signup"];

const SAMPLE_EMAIL = "alice@example.com";
const ALLOWED_LIST = ["alice@example.com", "bob@example.com"];
const ALLOWED_DOMAINS = [{ domain: "example.com" }];
const NEITHER_DOMAINS: { domain: string }[] = [];

function buildCases(): Case[] {
  const cases: Case[] = [];

  // Existing active user — allowed in every mode EXCEPT closed.
  for (const mode of ALL_MODES) {
    cases.push({
      label: `existing active user / ${mode}`,
      input: {
        emailLc: SAMPLE_EMAIL,
        mode,
        allowedEmailsJson: null,
        allowedDomains: NEITHER_DOMAINS,
        existingUser: { deletedAt: null },
      },
      expected: { allowed: mode !== "closed" },
    });
  }

  // Existing soft-deleted user — rejected in every mode.
  for (const mode of ALL_MODES) {
    cases.push({
      label: `existing soft-deleted user / ${mode}`,
      input: {
        emailLc: SAMPLE_EMAIL,
        mode,
        allowedEmailsJson: ALLOWED_LIST, // deliberate: prove list match doesn't override deletedAt
        allowedDomains: ALLOWED_DOMAINS,
        existingUser: { deletedAt: new Date("2026-01-01") },
      },
      expected: { allowed: false },
    });
  }

  // New email, on allowedEmails list, no domain match.
  for (const mode of ALL_MODES) {
    cases.push({
      label: `new email on list / ${mode}`,
      input: {
        emailLc: SAMPLE_EMAIL,
        mode,
        allowedEmailsJson: ALLOWED_LIST,
        allowedDomains: NEITHER_DOMAINS,
        existingUser: null,
      },
      expected: { allowed: mode === "invite_only" || mode === "open_signup" },
    });
  }

  // New email, on allowed domain, NOT on list.
  for (const mode of ALL_MODES) {
    cases.push({
      label: `new email on domain / ${mode}`,
      input: {
        emailLc: SAMPLE_EMAIL,
        mode,
        allowedEmailsJson: null,
        allowedDomains: ALLOWED_DOMAINS,
        existingUser: null,
      },
      expected: { allowed: mode === "domain_whitelist" || mode === "open_signup" },
    });
  }

  // New email, neither.
  for (const mode of ALL_MODES) {
    cases.push({
      label: `new email on neither / ${mode}`,
      input: {
        emailLc: SAMPLE_EMAIL,
        mode,
        allowedEmailsJson: null,
        allowedDomains: NEITHER_DOMAINS,
        existingUser: null,
      },
      expected: { allowed: mode === "open_signup" },
    });
  }

  return cases;
}

function runMatrix(): { passed: number; failed: number; failures: string[] } {
  const cases = buildCases();
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const got: SelfSignupGateResult = evaluateSelfSignupAllowed(c.input);
    if (got.allowed === c.expected.allowed) {
      passed++;
    } else {
      failed++;
      failures.push(
        `  ✗ ${c.label} — expected allowed=${c.expected.allowed}, got allowed=${got.allowed} (reason: ${got.reason ?? "<none>"})`,
      );
    }
  }
  return { passed, failed, failures };
}

async function main() {
  console.log("=== Predicate matrix (5 scenarios × 4 modes = 20 cases) ===");
  const { passed, failed, failures } = runMatrix();
  for (const f of failures) console.log(f);
  console.log(`  passed: ${passed}/${passed + failed}`);
  if (failed > 0) {
    console.error(`MATRIX FAILED — ${failed} mismatch(es). See above.`);
    process.exit(1);
  }
  console.log("  ✓ all 20 predicate cases match expected behavior");

  // Schema + data assertions — confirm migration applied, then report
  // the actual distribution across existing stores.
  const db = await getDb();
  if (!db) throw new Error("getDb returned null");

  const colCheck: any = await db.execute(sql`
    SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='stores' AND COLUMN_NAME='selfSignupMode'`);
  const colRow = (colCheck as unknown as [Array<Record<string, unknown>>, unknown])[0]?.[0];
  if (!colRow) {
    console.error("\nSCHEMA FAILED — stores.selfSignupMode column not present. 0100 not applied?");
    process.exit(1);
  }
  console.log(`\n=== Schema ===\n  ${JSON.stringify(colRow)}`);

  console.log("\n=== Mode distribution across existing stores ===");
  const dist: any = await db.execute(sql`
    SELECT selfSignupMode, COUNT(*) AS n
    FROM stores GROUP BY selfSignupMode ORDER BY n DESC`);
  const distRows = (dist as unknown as [Array<Record<string, unknown>>, unknown])[0] ?? [];
  for (const r of distRows) console.log(`  ${r.selfSignupMode}: ${r.n}`);

  console.log("\n=== Yan stores explicit check (id 2,3,4) ===");
  const yan: any = await db.execute(sql`
    SELECT id, slug, selfSignupMode FROM stores WHERE id IN (2,3,4) ORDER BY id`);
  const yanRows = (yan as unknown as [Array<Record<string, unknown>>, unknown])[0] ?? [];
  for (const r of yanRows) console.log(" ", r);
  // All three Yan stores currently have neither allowedEmailsJson nor
  // storeAllowedDomains rows, so the backfill should land them on
  // 'open_signup' (Phase G needs them logged-in-able with any email).
  for (const r of yanRows) {
    if (r.selfSignupMode !== "open_signup") {
      console.error(`\nUNEXPECTED — Yan storeId=${r.id} backfilled to ${r.selfSignupMode}, expected open_signup`);
      process.exit(1);
    }
  }
  console.log("  ✓ all three Yan stores correctly backfilled to open_signup");

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
