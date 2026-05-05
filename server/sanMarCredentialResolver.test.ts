/**
 * Tests for the SanMar credential resolver and the per-org wiring path.
 *
 * Covers Session 2 acceptance criteria:
 *   - An org with a row in supplierCredentials uses those credentials.
 *   - An org without a row falls back to SANMAR_ACCOUNT_ID / SANMAR_PASSWORD.
 *   - Plaintext credential values never appear in any log line.
 *   - The bulk and inventory services accept per-org credentials via
 *     constructor injection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Set the encryption key BEFORE importing encryption — getEncryptionKey reads
// process.env at call time, so we just need this set when encryptCredential
// is invoked from inside test bodies.
process.env.CREDENTIAL_ENCRYPTION_KEY ??= "test-encryption-key-for-sanmar-resolver-tests";

import { encryptCredential } from "./utils/encryption";
import { resolveSanMarCredentials } from "./integrations/sanMarCredentialResolver";
import { SanMarBulkService } from "./integrations/SanMarBulkService";
import { SanMarInventoryService } from "./integrations/SanMarInventoryService";

// Test must succeed without a real DB. We pass a minimal db stub that
// implements just the chain `select(...).from(...).where(...).limit(...)`
// and resolves to whatever rows the test wants.
type Row = { accountId: string; password: string };

function makeFakeDb(rows: Row[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  } as unknown as Awaited<
    ReturnType<typeof import("./db").getDb>
  >;
}

// Capture logger output so we can grep for credential leaks.
type CapturedLog = { level: string; args: unknown[] };

function installLogCapture(): { captured: CapturedLog[]; restore: () => void } {
  const captured: CapturedLog[] = [];
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = ((...args: unknown[]) => {
      captured.push({ level, args });
    }) as typeof console.log;
  }
  return {
    captured,
    restore: () => {
      console.log = orig.log;
      console.info = orig.info;
      console.warn = orig.warn;
      console.error = orig.error;
    },
  };
}

describe("resolveSanMarCredentials — DB row wins over env", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns DB credentials when a supplierCredentials row exists for the org", async () => {
    vi.stubEnv("SANMAR_ACCOUNT_ID", "ENV_ACCT");
    vi.stubEnv("SANMAR_PASSWORD", "ENV_PWD");

    const db = makeFakeDb([
      {
        accountId: encryptCredential("DB_ACCT")!,
        password: encryptCredential("DB_PWD")!,
      },
    ]);
    const result = await resolveSanMarCredentials(123, { db });
    expect(result).not.toBeNull();
    expect(result?.source).toBe("db");
    expect(result?.accountId).toBe("DB_ACCT");
    expect(result?.password).toBe("DB_PWD");
  });

  it("falls back to env vars when no DB row exists", async () => {
    vi.stubEnv("SANMAR_ACCOUNT_ID", "ENV_ACCT");
    vi.stubEnv("SANMAR_PASSWORD", "ENV_PWD");

    const db = makeFakeDb([]);
    const result = await resolveSanMarCredentials(456, { db });
    expect(result).not.toBeNull();
    expect(result?.source).toBe("env");
    expect(result?.accountId).toBe("ENV_ACCT");
    expect(result?.password).toBe("ENV_PWD");
  });

  it("returns null when neither DB row nor env vars are configured", async () => {
    vi.stubEnv("SANMAR_ACCOUNT_ID", "");
    vi.stubEnv("SANMAR_PASSWORD", "");

    const db = makeFakeDb([]);
    const result = await resolveSanMarCredentials(789, { db });
    expect(result).toBeNull();
  });

  it("solo user (organizationId=null) skips DB lookup and uses env vars", async () => {
    vi.stubEnv("SANMAR_ACCOUNT_ID", "ENV_ACCT");
    vi.stubEnv("SANMAR_PASSWORD", "ENV_PWD");

    // The DB stub would throw if .where() was called — we want to assert it
    // is NOT called for solo users.
    let dbHit = false;
    const dbThatRecordsHits = {
      select: () => ({
        from: () => ({
          where: () => {
            dbHit = true;
            return { limit: async () => [] };
          },
        }),
      }),
    } as unknown as Awaited<ReturnType<typeof import("./db").getDb>>;

    const result = await resolveSanMarCredentials(null, { db: dbThatRecordsHits });
    expect(dbHit).toBe(false);
    expect(result?.source).toBe("env");
  });
});

describe("resolveSanMarCredentials — never logs plaintext credentials", () => {
  it("decrypted accountId/password are not present in any log line", async () => {
    const SECRET_ACCT = "SECRET-ACCT-9XKQZW";
    const SECRET_PWD = "SECRET-PWD-7V4P2L";
    const cap = installLogCapture();
    try {
      const db = makeFakeDb([
        {
          accountId: encryptCredential(SECRET_ACCT)!,
          password: encryptCredential(SECRET_PWD)!,
        },
      ]);
      const result = await resolveSanMarCredentials(42, { db });
      expect(result?.accountId).toBe(SECRET_ACCT);
      expect(result?.password).toBe(SECRET_PWD);

      const allLogs = cap.captured
        .map(({ args }) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
        .join("\n");
      expect(allLogs).not.toContain(SECRET_ACCT);
      expect(allLogs).not.toContain(SECRET_PWD);
    } finally {
      cap.restore();
    }
  });

  it("env-fallback path also keeps credential values out of logs", async () => {
    const cap = installLogCapture();
    vi.stubEnv("SANMAR_ACCOUNT_ID", "ENV-ACCT-3JK");
    vi.stubEnv("SANMAR_PASSWORD", "ENV-PWD-X9F");
    try {
      const db = makeFakeDb([]);
      const result = await resolveSanMarCredentials(99, { db });
      expect(result?.source).toBe("env");
      const allLogs = cap.captured
        .map(({ args }) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
        .join("\n");
      expect(allLogs).not.toContain("ENV-ACCT-3JK");
      expect(allLogs).not.toContain("ENV-PWD-X9F");
    } finally {
      vi.unstubAllEnvs();
      cap.restore();
    }
  });
});

describe("SanMarBulkService accepts per-org credentials via constructor", () => {
  it("uses the provided creds verbatim — env vars are ignored when creds passed", async () => {
    vi.stubEnv("SANMAR_ACCOUNT_ID", "ENV_ACCT");
    vi.stubEnv("SANMAR_PASSWORD", "ENV_PWD");
    try {
      const svc = new SanMarBulkService({ accountId: "DB_ACCT", password: "DB_PWD" });
      // Cast to inspect private fields safely without `any`.
      const inspect = svc as unknown as { accountId: string; password: string };
      expect(inspect.accountId).toBe("DB_ACCT");
      expect(inspect.password).toBe("DB_PWD");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to env vars when constructed with no args", () => {
    vi.stubEnv("SANMAR_ACCOUNT_ID", "ENV_ACCT_FALLBACK");
    vi.stubEnv("SANMAR_PASSWORD", "ENV_PWD_FALLBACK");
    try {
      const svc = new SanMarBulkService();
      const inspect = svc as unknown as { accountId: string; password: string };
      expect(inspect.accountId).toBe("ENV_ACCT_FALLBACK");
      expect(inspect.password).toBe("ENV_PWD_FALLBACK");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("SanMarInventoryService accepts per-org credentials via constructor", () => {
  it("uses the provided creds verbatim — env vars ignored when passed", () => {
    vi.stubEnv("SANMAR_ACCOUNT_ID", "ENV_ACCT");
    vi.stubEnv("SANMAR_PASSWORD", "ENV_PWD");
    try {
      const svc = new SanMarInventoryService({ accountId: "DB_ACCT_INV", password: "DB_PWD_INV" });
      const inspect = svc as unknown as { accountId: string; password: string };
      expect(inspect.accountId).toBe("DB_ACCT_INV");
      expect(inspect.password).toBe("DB_PWD_INV");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("env-var fallback is preserved", () => {
    vi.stubEnv("SANMAR_ACCOUNT_ID", "ENV_ACCT_INV");
    vi.stubEnv("SANMAR_PASSWORD", "ENV_PWD_INV");
    try {
      const svc = new SanMarInventoryService();
      const inspect = svc as unknown as { accountId: string; password: string };
      expect(inspect.accountId).toBe("ENV_ACCT_INV");
      expect(inspect.password).toBe("ENV_PWD_INV");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Source-grep audit — wired sites never interpolate credential values", () => {
  it("sanMarBulkSync.ts log lines reference only credentialSource, not values", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "./jobs/sanMarBulkSync.ts"),
      "utf8",
    );
    const logCalls = src.match(/log\.[a-z]+\([\s\S]*?\)/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toMatch(/\$\{[^}]*\.accountId\b/);
      expect(call).not.toMatch(/\$\{[^}]*\.password\b/);
      expect(call).not.toMatch(/\$\{[^}]*creds\.(accountId|password)\b/);
    }
  });

  it("sanMarCredentialResolver.ts log lines reference only the source, not values", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "./integrations/sanMarCredentialResolver.ts"),
      "utf8",
    );
    const logCalls = src.match(/log\.[a-z]+\([\s\S]*?\)/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toMatch(/\$\{[^}]*\baccountId\b/);
      expect(call).not.toMatch(/\$\{[^}]*\bpassword\b/);
    }
  });
});
