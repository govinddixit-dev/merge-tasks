/**
 * Unit tests for reconcileOrphanRenderingRows.
 *
 * Hand-rolled chainable fakes for the drizzle Db handle (matches the
 * project's `as unknown as T` test idiom — see assertEvictionPolicy.test.ts).
 *
 * Post-upgrade contract: the function does a SELECT to enumerate
 * `rendering` rows, then consults BullMQ for live jobs, then UPDATEs
 * only the rows whose (storeId, productId) keys aren't represented by
 * an active queue entry. Tests stub both the db chain and the queue.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const logSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

const queueState = vi.hoisted(() => ({
  jobs: [] as Array<{ data: { storeId: number; productId: number } }>,
  throwOnGet: null as Error | null,
}));

vi.mock("../utils/logger", () => ({
  getLogger: () => logSpies,
}));

vi.mock("../queue/webstore-render-queue", () => ({
  webstoreRenderQueue: {
    getJobs: vi.fn(async () => {
      if (queueState.throwOnGet) throw queueState.throwOnGet;
      return queueState.jobs;
    }),
  },
  // Re-export the symbols the orchestrator imports from this module so
  // the upgrade doesn't break the unmocked code paths.
  addWebstoreRenderJob: vi.fn(async () => {}),
}));

import { storeProducts } from "../../drizzle/schema";
import { reconcileOrphanRenderingRows } from "./webstore-render-orchestrator";

type Db = Parameters<typeof reconcileOrphanRenderingRows>[0];

interface RenderingRow { id: number; storeId: number; productId: number; }

/**
 * Build a fake db that:
 *   - .select(...).from(...).where(...) resolves with selectResult
 *   - .update(...).set(...).where(...) resolves with updateResult (or rejects)
 * Spies are returned for assertion.
 */
function makeFakeDb(
  selectResult: RenderingRow[] | Error,
  updateResult: unknown[] | Error = [{ affectedRows: 0 }],
) {
  const selectWhereSpy = vi.fn(() => {
    if (selectResult instanceof Error) return Promise.reject(selectResult);
    return Promise.resolve(selectResult);
  });
  const fromSpy = vi.fn(() => ({ where: selectWhereSpy }));
  const selectSpy = vi.fn(() => ({ from: fromSpy }));

  const updateWhereSpy = vi.fn(() => {
    if (updateResult instanceof Error) return Promise.reject(updateResult);
    return Promise.resolve(updateResult);
  });
  const setSpy = vi.fn(() => ({ where: updateWhereSpy }));
  const updateSpy = vi.fn(() => ({ set: setSpy }));

  return {
    db: { select: selectSpy, update: updateSpy } as unknown as Db,
    spies: { select: selectSpy, from: fromSpy, selectWhere: selectWhereSpy,
             update: updateSpy, set: setSpy, updateWhere: updateWhereSpy },
  };
}

beforeEach(() => {
  logSpies.info.mockClear();
  logSpies.warn.mockClear();
  logSpies.debug.mockClear();
  logSpies.error.mockClear();
  queueState.jobs = [];
  queueState.throwOnGet = null;
});

describe("reconcileOrphanRenderingRows", () => {
  it("returns 0 and logs INFO when no 'rendering' rows are present (no queue lookup needed)", async () => {
    const { db, spies } = makeFakeDb([]);

    const count = await reconcileOrphanRenderingRows(db);

    expect(count).toBe(0);
    expect(spies.select).toHaveBeenCalledTimes(1);
    expect(spies.update).not.toHaveBeenCalled();
    expect(logSpies.info).toHaveBeenCalledTimes(1);
    expect(logSpies.info.mock.calls[0][0]).toMatch(/no orphan/i);
    expect(logSpies.warn).not.toHaveBeenCalled();
  });

  it("flips a row to 'failed' when its (storeId, productId) is NOT in the live queue", async () => {
    queueState.jobs = []; // No active jobs → every rendering row is an orphan.
    const { db, spies } = makeFakeDb(
      [{ id: 42, storeId: 7, productId: 11 }],
      [{ affectedRows: 1 }],
    );

    const count = await reconcileOrphanRenderingRows(db);

    expect(count).toBe(1);
    expect(spies.update).toHaveBeenCalledWith(storeProducts);
    expect(spies.set).toHaveBeenCalledWith({ webstoreRenderStatus: "failed" });
    expect(logSpies.warn).toHaveBeenCalledTimes(1);
    expect(logSpies.warn.mock.calls[0][0]).toMatch(/1\/1 orphan/);
  });

  it("leaves a row alone when its (storeId, productId) matches a live queue job", async () => {
    queueState.jobs = [{ data: { storeId: 7, productId: 11 } }];
    const { db, spies } = makeFakeDb([
      { id: 42, storeId: 7, productId: 11 },
    ]);

    const count = await reconcileOrphanRenderingRows(db);

    expect(count).toBe(0);
    // Crucial: NO UPDATE issued — the row is in flight, not orphaned.
    expect(spies.update).not.toHaveBeenCalled();
    expect(logSpies.info).toHaveBeenCalledTimes(1);
    expect(logSpies.info.mock.calls[0][0]).toMatch(/all have live queue jobs/);
  });

  it("partially reconciles: some rows orphaned, others have live jobs", async () => {
    queueState.jobs = [{ data: { storeId: 1, productId: 100 } }];
    const { db, spies } = makeFakeDb(
      [
        { id: 1, storeId: 1, productId: 100 }, // live job → keep
        { id: 2, storeId: 1, productId: 200 }, // orphan → flip
        { id: 3, storeId: 2, productId: 300 }, // orphan → flip
      ],
      [{ affectedRows: 2 }],
    );

    const count = await reconcileOrphanRenderingRows(db);

    expect(count).toBe(2);
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(logSpies.warn.mock.calls[0][0]).toMatch(/2\/3 orphan/);
  });

  it("propagates DB errors from the SELECT to the caller", async () => {
    const { db } = makeFakeDb(new Error("simulated DB outage"));

    await expect(reconcileOrphanRenderingRows(db)).rejects.toThrow(/simulated DB outage/);
  });

  it("propagates queue errors instead of falling back to a destructive reset", async () => {
    queueState.throwOnGet = new Error("Redis connection refused");
    const { db, spies } = makeFakeDb([{ id: 42, storeId: 7, productId: 11 }]);

    await expect(reconcileOrphanRenderingRows(db)).rejects.toThrow(/Redis connection refused/);
    // Critical: NO UPDATE issued. We don't know which rows are in flight,
    // so we MUST NOT reset blindly — that's the regression this guard exists to prevent.
    expect(spies.update).not.toHaveBeenCalled();
  });
});
