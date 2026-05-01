/**
 * Unit tests for reconcileOrphanRenderingRows (Followup R).
 *
 * Mocks the logger module so log emissions can be asserted; uses a hand-
 * rolled chainable fake for the drizzle Db handle (matches the project's
 * `as unknown as T` test idiom — see assertEvictionPolicy.test.ts).
 *
 * The sibling fire-and-forget helpers (enqueueRenderForStoreProduct,
 * fanOutRenderForProduct, flagPendingForStoreLogoChange) are out of scope
 * here — they are exercised by integration paths, not unit tests.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const logSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  getLogger: () => logSpies,
}));

import { eq } from "drizzle-orm";
import { storeProducts } from "../../drizzle/schema";
import { reconcileOrphanRenderingRows } from "./webstore-render-orchestrator";

type Db = Parameters<typeof reconcileOrphanRenderingRows>[0];

function makeFakeDb(updateResult: unknown[] | Error) {
  const whereSpy = vi.fn(() => {
    if (updateResult instanceof Error) return Promise.reject(updateResult);
    return Promise.resolve(updateResult);
  });
  const setSpy = vi.fn(() => ({ where: whereSpy }));
  const updateSpy = vi.fn(() => ({ set: setSpy }));
  return {
    db: { update: updateSpy } as unknown as Db,
    spies: { update: updateSpy, set: setSpy, where: whereSpy },
  };
}

beforeEach(() => {
  logSpies.info.mockClear();
  logSpies.warn.mockClear();
  logSpies.debug.mockClear();
  logSpies.error.mockClear();
});

describe("reconcileOrphanRenderingRows", () => {
  it("returns 0 and logs INFO when no orphan 'rendering' rows are present", async () => {
    const { db, spies } = makeFakeDb([{ affectedRows: 0 }]);

    const count = await reconcileOrphanRenderingRows(db);

    expect(count).toBe(0);
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledWith(storeProducts);
    expect(logSpies.info).toHaveBeenCalledTimes(1);
    expect(logSpies.info.mock.calls[0][0]).toMatch(/no orphan/i);
    expect(logSpies.warn).not.toHaveBeenCalled();
  });

  it("returns 3 and logs WARN with the count when 3 orphan rows are flipped to failed", async () => {
    const { db, spies } = makeFakeDb([{ affectedRows: 3 }]);

    const count = await reconcileOrphanRenderingRows(db);

    expect(count).toBe(3);
    // Single-column update — preserves webstoreRenderedImageUrl, _At, _Decoration, _Model.
    expect(spies.set).toHaveBeenCalledTimes(1);
    expect(spies.set).toHaveBeenCalledWith({ webstoreRenderStatus: "failed" });
    expect(logSpies.warn).toHaveBeenCalledTimes(1);
    expect(logSpies.warn.mock.calls[0][0]).toMatch(/3 orphan/);
    expect(logSpies.info).not.toHaveBeenCalled();
  });

  it("scopes the UPDATE predicate to webstoreRenderStatus = 'rendering'", async () => {
    const { db, spies } = makeFakeDb([{ affectedRows: 0 }]);

    await reconcileOrphanRenderingRows(db);

    // drizzle's eq() produces a SQL object whose queryChunks include the
    // column reference directly (singleton from schema.ts) and a Param chunk
    // carrying the literal value. JSON.stringify is unusable — the column ↔
    // table back-reference is circular. Asserting on (a) column identity
    // and (b) presence of the literal as a chunk value is the stable check.
    const actualWhere = spies.where.mock.calls[0][0] as { queryChunks: unknown[] };
    expect(actualWhere.queryChunks).toBeDefined();
    expect(actualWhere.queryChunks).toContain(storeProducts.webstoreRenderStatus);

    const hasRenderingLiteral = actualWhere.queryChunks.some(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { value?: unknown }).value === "rendering",
    );
    expect(hasRenderingLiteral).toBe(true);
  });

  it("propagates DB errors to the caller instead of swallowing them", async () => {
    const { db } = makeFakeDb(new Error("simulated DB outage"));

    await expect(reconcileOrphanRenderingRows(db)).rejects.toThrow(/simulated DB outage/);
    // Worker entry's try/catch is the warn-and-continue layer — the function
    // itself must surface the error so the caller can decide policy.
  });
});
