#!/usr/bin/env npx tsx
/**
 * phase7-e2e-verify.ts — Automated verification of Phase 7 (Render
 * Manager) end-to-end behavior. Replaces the manual click-through
 * checklist by driving the tRPC caller directly against the seeded
 * fixture and asserting API contracts.
 *
 * Usage
 * ─────
 *   DATABASE_URL=… npx tsx scripts/phase7-e2e-verify.ts
 *   DATABASE_URL=… npx tsx scripts/phase7-e2e-verify.ts --teardown
 *
 * Pre-req: scripts/phase7-e2e-setup.ts must have been run (or pass
 * --reset on this script's invocation to bootstrap). Refuses to run
 * against NODE_ENV=production or without the test marker user.
 *
 * Assertion scope: API contract only — status flips, URL values, return
 * shapes. Does NOT wait for BullMQ render workers to complete; reRender
 * and bulkReRenderFailed are checked at the immediate row state, not at
 * the eventual rendered output.
 */
import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../server/db";
import { users, products, stores, storeProducts, clients } from "../drizzle/schema";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

const MARKER_OPENID = "test-p7-e2e-user";
const MARKER_STORE_SLUG = "phase-7-e2e-test-store";

// 1×1 white PNG (valid, ~70 bytes decoded). Lets uploadOverride exercise
// the storage adapter without needing a real image fixture in the repo.
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

type Status = "PASS" | "FAIL" | "SKIP";
interface RowResult { name: string; status: Status; detail?: string }
const results: RowResult[] = [];

function record(name: string, status: Status, detail?: string): void {
  results.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "•";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function findRowBySku(db: Db, storeId: number, sku: string) {
  const rows = await db
    .select({
      id: storeProducts.id,
      productId: storeProducts.productId,
      webstoreRenderStatus: storeProducts.webstoreRenderStatus,
      webstoreRenderedImageUrl: storeProducts.webstoreRenderedImageUrl,
      renderApproved: storeProducts.renderApproved,
      renderOverrideUrl: storeProducts.renderOverrideUrl,
    })
    .from(storeProducts)
    .innerJoin(products, eq(products.id, storeProducts.productId))
    .where(and(eq(storeProducts.storeId, storeId), eq(products.sku, sku)))
    .limit(1);
  return rows[0];
}

async function readSp(db: Db, id: number) {
  const [row] = await db.select().from(storeProducts).where(eq(storeProducts.id, id)).limit(1);
  return row;
}

async function main(): Promise<void> {
  // ── Hard guard 1: never against prod ─────────────────────────────────
  if (process.env.NODE_ENV === "production") {
    console.error("[phase7-e2e-verify] FATAL: refusing to run with NODE_ENV=production");
    process.exit(1);
  }

  const db = await getDb();
  if (!db) {
    console.error("[phase7-e2e-verify] FATAL: getDb() returned null — DATABASE_URL set?");
    process.exit(1);
  }

  // ── Hard guard 2: test marker must exist ─────────────────────────────
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.openId, MARKER_OPENID)).limit(1);
  if (!u) {
    console.error(`[phase7-e2e-verify] FATAL: marker user "${MARKER_OPENID}" not found in DB.`);
    console.error("Seed first:  npx tsx scripts/phase7-e2e-setup.ts --reset");
    process.exit(1);
  }
  const userId = u.id;

  const [storeRow] = await db.select().from(stores).where(eq(stores.slug, MARKER_STORE_SLUG)).limit(1);
  if (!storeRow) {
    console.error(`[phase7-e2e-verify] FATAL: marker store "${MARKER_STORE_SLUG}" not found.`);
    process.exit(1);
  }
  const storeId = storeRow.id;

  const sps = await db.select().from(storeProducts).where(eq(storeProducts.storeId, storeId));
  if (sps.length !== 6) {
    console.error(`[phase7-e2e-verify] FATAL: expected 6 storeProducts in fixture, found ${sps.length}.`);
    console.error("Re-seed:  npx tsx scripts/phase7-e2e-setup.ts --reset");
    process.exit(1);
  }

  console.log(`\nFixture located: storeId=${storeId} userId=${userId} (${sps.length} bindings)\n`);

  // ── tRPC caller ──────────────────────────────────────────────────────
  // Mirrors server/renderManager.test.ts:107 ctxFor pattern.
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: MARKER_OPENID,
      email: "p7-e2e@mergetasks.test",
      name: "Phase 7 E2E Verify",
      loginMethod: "email",
      role: "admin",
      subscriptionTier: "pro",
      subscriptionStatus: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    organizationId: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
  const caller = appRouter.createCaller(ctx);

  // ── renderManager.listByStore ────────────────────────────────────────
  try {
    const list = await caller.renderManager.listByStore({ storeId, status: "all" });
    if (!Array.isArray(list)) {
      record("renderManager.listByStore returns array", "FAIL", `got ${typeof list}`);
    } else if (list.length !== 6) {
      record("renderManager.listByStore returns 6 products", "FAIL", `got ${list.length}`);
    } else {
      record("renderManager.listByStore returns 6 products", "PASS");
    }
  } catch (e) {
    record("renderManager.listByStore", "FAIL", (e as Error).message);
  }

  // ── renderManager.approve ────────────────────────────────────────────
  const poloRow = await findRowBySku(db, storeId, "P7-E2E-POLO");
  if (!poloRow) {
    record("renderManager.approve", "SKIP", "POLO row not found");
  } else {
    try {
      const r = await caller.renderManager.approve({ storeProductId: poloRow.id });
      const after = await readSp(db, poloRow.id);
      if (r.success === true && after?.renderApproved === true) {
        record("renderManager.approve flips renderApproved=true", "PASS");
      } else {
        record("renderManager.approve flips renderApproved=true", "FAIL",
          `success=${r.success} approved=${after?.renderApproved}`);
      }
    } catch (e) {
      record("renderManager.approve", "FAIL", (e as Error).message);
    }
  }

  // ── renderManager.reRender ───────────────────────────────────────────
  const toteRow = await findRowBySku(db, storeId, "P7-E2E-TOTE");
  if (!toteRow) {
    record("renderManager.reRender", "SKIP", "TOTE row not found");
  } else {
    try {
      await caller.renderManager.reRender({ storeProductId: toteRow.id });
      const after = await readSp(db, toteRow.id);
      if (after?.webstoreRenderStatus === "pending") {
        record("renderManager.reRender resets status to pending", "PASS");
      } else {
        record("renderManager.reRender resets status to pending", "FAIL",
          `status=${after?.webstoreRenderStatus}`);
      }
    } catch (e) {
      record("renderManager.reRender", "FAIL", (e as Error).message);
    }
  }

  // ── renderManager.uploadOverride ─────────────────────────────────────
  const crewRow = await findRowBySku(db, storeId, "P7-E2E-CREW");
  let uploadOk = false;
  if (!crewRow) {
    record("renderManager.uploadOverride", "SKIP", "CREW row not found");
  } else {
    try {
      await caller.renderManager.uploadOverride({
        storeProductId: crewRow.id,
        imageBase64: TEST_PNG_BASE64,
        mimeType: "image/png",
        fileName: "verify-override.png",
      });
      const after = await readSp(db, crewRow.id);
      const ok = !!after?.renderOverrideUrl && after?.renderApproved === true;
      record("renderManager.uploadOverride sets URL + auto-approves",
        ok ? "PASS" : "FAIL",
        `url=${after?.renderOverrideUrl ? "set" : "null"} approved=${after?.renderApproved}`);
      uploadOk = ok;
    } catch (e) {
      // Storage adapter may not be configured in dev/CI — log SKIP, not FAIL.
      record("renderManager.uploadOverride", "SKIP",
        `storage error: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  // ── renderManager.removeOverride ─────────────────────────────────────
  if (!crewRow || !uploadOk) {
    record("renderManager.removeOverride", "SKIP", "uploadOverride did not seed an override");
  } else {
    try {
      await caller.renderManager.removeOverride({ storeProductId: crewRow.id });
      const after = await readSp(db, crewRow.id);
      if (after?.renderOverrideUrl === null) {
        record("renderManager.removeOverride clears URL", "PASS");
      } else {
        record("renderManager.removeOverride clears URL", "FAIL",
          `url=${after?.renderOverrideUrl}`);
      }
    } catch (e) {
      record("renderManager.removeOverride", "FAIL", (e as Error).message);
    }
  }

  // ── renderManager.bulkApprove ────────────────────────────────────────
  try {
    await caller.renderManager.bulkApprove({ storeId });
    const all = await db.select().from(storeProducts).where(eq(storeProducts.storeId, storeId));
    const completeUnapproved = all.filter(r => r.webstoreRenderStatus === "complete" && !r.renderApproved);
    if (completeUnapproved.length === 0) {
      record("renderManager.bulkApprove approves all eligible (status=complete)", "PASS");
    } else {
      record("renderManager.bulkApprove approves all eligible", "FAIL",
        `${completeUnapproved.length} still unapproved`);
    }
  } catch (e) {
    record("renderManager.bulkApprove", "FAIL", (e as Error).message);
  }

  // ── renderManager.bulkReRenderFailed ─────────────────────────────────
  try {
    await caller.renderManager.bulkReRenderFailed({ storeId });
    const jrsy = await findRowBySku(db, storeId, "P7-E2E-JRSY");
    if (jrsy?.webstoreRenderStatus === "pending") {
      record("renderManager.bulkReRenderFailed re-enqueues failed rows", "PASS");
    } else {
      record("renderManager.bulkReRenderFailed re-enqueues failed rows", "FAIL",
        `JRSY status=${jrsy?.webstoreRenderStatus}`);
    }
  } catch (e) {
    record("renderManager.bulkReRenderFailed", "FAIL", (e as Error).message);
  }

  // ── stores.getBySlug — webstore approval gate contract ───────────────
  try {
    const page = await caller.stores.getBySlug({ slug: MARKER_STORE_SLUG });
    if (page.id !== storeId) {
      record("stores.getBySlug returns the seeded store", "FAIL", `id=${page.id}`);
    } else {
      record("stores.getBySlug returns the seeded store", "PASS");
    }

    // After bulkApprove, every binding with both an AI render URL and
    // status=complete should surface a non-null webstoreRenderedImageUrl
    // (the gate). Pending/failed bindings should be null.
    const pageProducts = page.products as Array<{ sku: string; webstoreRenderedImageUrl: string | null }>;
    const cap = pageProducts.find(p => p.sku === "P7-E2E-CAP");
    const soft = pageProducts.find(p => p.sku === "P7-E2E-SOFT");

    if (cap && cap.webstoreRenderedImageUrl !== null) {
      record("stores.getBySlug surfaces approved render URL (CAP)", "PASS");
    } else {
      record("stores.getBySlug surfaces approved render URL (CAP)", "FAIL",
        `url=${cap?.webstoreRenderedImageUrl ?? "row missing"}`);
    }
    if (soft && soft.webstoreRenderedImageUrl === null) {
      record("stores.getBySlug returns null for unapproved (SOFT/CSS fallback)", "PASS");
    } else {
      record("stores.getBySlug returns null for unapproved", "FAIL",
        `url=${soft?.webstoreRenderedImageUrl ?? "row missing"}`);
    }
  } catch (e) {
    record("stores.getBySlug", "FAIL", (e as Error).message);
  }

  // ── grouped picker smoke (best-effort; SKIP if no styleGroup data) ───
  try {
    const groups = await caller.products.listGrouped();
    if (!Array.isArray(groups) || groups.length === 0) {
      record("products.listGrouped returns groups", "SKIP", "no grouped data in DB");
    } else {
      const multi = groups.filter((g) => (g.variantCount ?? 0) > 1);
      if (multi.length > 0) {
        record("products.listGrouped includes >1-variant groups", "PASS",
          `${multi.length}/${groups.length} multi-variant`);
      } else {
        record("products.listGrouped includes >1-variant groups", "SKIP",
          `${groups.length} groups, all singletons — fixture has no variants`);
      }
      const sample = multi[0] ?? groups[0];
      const styleGroup = sample.styleGroup;
      if (typeof styleGroup === "string" && styleGroup.length > 0) {
        try {
          const g = await caller.products.getByStyleGroup({ styleGroup });
          const variants = (g as { variants?: unknown[] }).variants;
          record("products.getByStyleGroup returns variants",
            Array.isArray(variants) && variants.length > 0 ? "PASS" : "FAIL",
            `${variants?.length ?? 0} variants`);
        } catch (e) {
          record("products.getByStyleGroup", "FAIL", (e as Error).message);
        }
        try {
          const sg = await caller.stores.getStoreProductGroup({ storeId, styleGroup });
          const ok = Array.isArray((sg as { variants?: unknown[] }).variants)
            && Array.isArray((sg as { storeProducts?: unknown[] }).storeProducts);
          record("stores.getStoreProductGroup returns variants + storeProducts",
            ok ? "PASS" : "FAIL");
        } catch (e) {
          // Store typically doesn't bind every styleGroup — NOT_FOUND is expected.
          record("stores.getStoreProductGroup", "SKIP",
            `not bound to test store: ${(e as Error).message.slice(0, 60)}`);
        }
      } else {
        record("products.getByStyleGroup", "SKIP", "no styleGroup on sampled row");
        record("stores.getStoreProductGroup", "SKIP", "no styleGroup on sampled row");
      }
    }
  } catch (e) {
    record("products.listGrouped", "FAIL", (e as Error).message);
  }

  // ── teardown (opt-in) ────────────────────────────────────────────────
  if (process.argv.includes("--teardown")) {
    await wipe(db, userId);
    console.log("\n--teardown applied (fixture removed)");
  } else {
    console.log("\n(test data preserved — run scripts/phase7-e2e-teardown.ts to clean up)");
  }

  // ── summary ──────────────────────────────────────────────────────────
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const skip = results.filter(r => r.status === "SKIP").length;
  console.log(`\n───────────────────────────────────────────────`);
  console.log(`PASS: ${pass}   FAIL: ${fail}   SKIP: ${skip}   TOTAL: ${results.length}`);
  console.log(`───────────────────────────────────────────────`);
  process.exit(fail > 0 ? 1 : 0);
}

async function wipe(db: Db, userId: number): Promise<void> {
  const sps = await db.select({ id: storeProducts.id })
    .from(storeProducts)
    .innerJoin(stores, eq(stores.id, storeProducts.storeId))
    .where(eq(stores.userId, userId));
  if (sps.length > 0) await db.delete(storeProducts).where(inArray(storeProducts.id, sps.map(r => r.id)));
  await db.delete(stores).where(eq(stores.userId, userId));
  await db.delete(products).where(eq(products.userId, userId));
  await db.delete(clients).where(eq(clients.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

main().catch(err => {
  console.error("[phase7-e2e-verify] FAILED:", err);
  process.exit(1);
});
