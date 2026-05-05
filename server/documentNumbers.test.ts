import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, getPool } from "./db";
import { nextDocumentNumber } from "./utils/documentNumbers";
import {
  documentSequences,
  users,
  organizations,
} from "../drizzle/schema";

describe("nextDocumentNumber — documentSequences NULL-distinct fix (0079)", () => {
  let db: Awaited<ReturnType<typeof getDb>>;
  let testUserId = 0;
  let testOrgId = 0;
  let dbAvailable = false;

  beforeAll(async () => {
    db = await getDb();
    if (!db) {
      console.log("SKIP: DB unavailable");
      return;
    }
    dbAvailable = true;

    const unique = `doc_seq_test_${Date.now()}`;
    const [u] = await db.insert(users).values({
      openId: unique,
      email: `${unique}@example.com`,
      name: "Doc Seq Test",
    });
    testUserId = u.insertId;

    const [o] = await db.insert(organizations).values({
      name: `Doc Seq Test Org ${Date.now()}`,
      slug: unique,
      ownerId: testUserId,
    });
    testOrgId = o.insertId;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await db
      .delete(documentSequences)
      .where(eq(documentSequences.userId, testUserId));
    await db.delete(organizations).where(eq(organizations.id, testOrgId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it("team context (organizationId set): sequential monotonic numbers", async () => {
    if (!dbAvailable) return;
    const n1 = await nextDocumentNumber(testOrgId, testUserId, "est");
    const n2 = await nextDocumentNumber(testOrgId, testUserId, "est");
    const n3 = await nextDocumentNumber(testOrgId, testUserId, "est");
    expect(n1).toBe("EST-1001");
    expect(n2).toBe("EST-1002");
    expect(n3).toBe("EST-1003");
  });

  it("solo context (organizationId null): sequential monotonic numbers", async () => {
    if (!dbAvailable) return;
    // This is the regression case: before 0079, NULL-distinct meant every
    // call hit the INSERT branch and returned 1001 forever.
    const n1 = await nextDocumentNumber(null, testUserId, "inv");
    const n2 = await nextDocumentNumber(null, testUserId, "inv");
    const n3 = await nextDocumentNumber(null, testUserId, "inv");
    expect(n1).toBe("INV-1001");
    expect(n2).toBe("INV-1002");
    expect(n3).toBe("INV-1003");
  });

  it("enforces unique (orgKey, userId, docType) — bare INSERT collides", async () => {
    if (!dbAvailable) return;
    const pool = getPool();
    if (!pool) return;
    const conn = await pool.getConnection();
    try {
      // Seed a sequence row for (null, testUserId, 'po'). Use a unique docType
      // per test case to avoid interacting with the other it() blocks above.
      await conn.execute(
        `INSERT INTO documentSequences (organizationId, userId, docType, nextNumber)
         VALUES (NULL, ?, 'po', 1001)`,
        [testUserId],
      );
      // Second bare INSERT at same scope should fail with ER_DUP_ENTRY (1062)
      // because orgKey = COALESCE(NULL, 0) = 0 collides on the unique index
      // (orgKey, userId, docType) → (0, testUserId, 'po').
      let errCode: string | number | undefined;
      try {
        await conn.execute(
          `INSERT INTO documentSequences (organizationId, userId, docType, nextNumber)
           VALUES (NULL, ?, 'po', 2222)`,
          [testUserId],
        );
      } catch (e: any) {
        errCode = e?.code ?? e?.errno;
      }
      expect(errCode === "ER_DUP_ENTRY" || errCode === 1062).toBe(true);
    } finally {
      conn.release();
    }
  });
});
