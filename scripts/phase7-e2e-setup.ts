#!/usr/bin/env npx tsx
/**
 * phase7-e2e-setup.ts — Seed a self-contained Phase 7 (Render Manager)
 * walkthrough harness so a human can click through the approval flow
 * against deterministic data.
 *
 * What it creates
 * ───────────────
 *   user          openId="test-p7-e2e-user"
 *   client        companyName="Phase 7 E2E Test Client"  + logoUrl
 *   store         slug="phase-7-e2e-test-store"
 *   6 products    one per slot in the decoration matrix:
 *     1. Performance Polo            embroidery   (apparel)
 *     2. Cotton Tote                 heat_transfer
 *     3. Crew Tee                    screen_print
 *     4. Athletic Jersey             sublimation
 *     5. Structured Cap              embroidery   ← hat-silhouette bias
 *     6. Soft Tee                    dtg
 *   6 storeProducts (one per product, bound to the store) seeded with:
 *     - 3x renderStatus='complete' + renderApproved=false  → Pending Review
 *     - 1x renderStatus='failed'                            → Failed
 *     - 1x renderStatus='complete' + renderApproved=true    → Approved
 *     - 1x renderStatus='pending', no renderUrl             → No Render
 *   Each product also gets webstoreImprintPlacement* coordinates so the
 *   re-render path doesn't trip the no_analysis guard during the
 *   walkthrough.
 *
 * Usage
 * ─────
 *   DATABASE_URL=… npx tsx scripts/phase7-e2e-setup.ts
 *   DATABASE_URL=… npx tsx scripts/phase7-e2e-setup.ts --reset
 *     (--reset wipes any prior phase-7 e2e data first)
 *
 * Idempotent: re-running without --reset will fail with a unique-key
 * violation on the slug. Run scripts/phase7-e2e-teardown.ts first or
 * pass --reset.
 *
 * Cleanup: scripts/phase7-e2e-teardown.ts removes everything this
 * script creates by matching the well-known marker prefixes.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, inArray } from "drizzle-orm";
import {
  users, clients, products, stores, storeProducts,
  type InsertProduct,
} from "../drizzle/schema";

// Marker prefixes — teardown finds resources by these.
const MARKER_OPENID = "test-p7-e2e-user";
const MARKER_EMAIL = "p7-e2e@mergetasks.test";
const MARKER_CLIENT = "Phase 7 E2E Test Client";
const MARKER_STORE_SLUG = "phase-7-e2e-test-store";
const MARKER_PRODUCT_SKU_PREFIX = "P7-E2E-";

// Public placeholder image — works without auth, returns a valid PNG.
const PLACEHOLDER = (label: string, color = "F5F5F5") =>
  `https://placehold.co/600x600/${color}/333333.png?text=${encodeURIComponent(label)}`;
const LOGO_URL = PLACEHOLDER("Test+Logo", "654BF9");

type DecorationMethod =
  | "embroidery" | "screen_print" | "laser_engraving" | "heat_transfer"
  | "dtg" | "sublimation" | "deboss" | "patch";

interface ProductSeed {
  name: string;
  sku: string;
  category: "apparel" | "drinkware" | "tech" | "bags" | "writing" | "wellness" | "outdoor" | "office" | "other";
  decoration: DecorationMethod;
  /** Initial render state to seed on the storeProduct binding. */
  state: "pending_review" | "failed" | "approved" | "no_render";
}

const PRODUCT_MATRIX: ProductSeed[] = [
  { name: "Performance Polo",    sku: "P7-E2E-POLO",   category: "apparel", decoration: "embroidery",     state: "pending_review" },
  { name: "Cotton Tote",          sku: "P7-E2E-TOTE",   category: "bags",    decoration: "heat_transfer",  state: "pending_review" },
  { name: "Crew Tee",             sku: "P7-E2E-CREW",   category: "apparel", decoration: "screen_print",   state: "pending_review" },
  { name: "Athletic Jersey",      sku: "P7-E2E-JRSY",   category: "apparel", decoration: "sublimation",    state: "failed" },
  { name: "Structured Cap",       sku: "P7-E2E-CAP",    category: "apparel", decoration: "embroidery",     state: "approved" },
  { name: "Soft Tee",             sku: "P7-E2E-SOFT",   category: "apparel", decoration: "dtg",            state: "no_render" },
];

async function main() {
  const reset = process.argv.includes("--reset");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[phase7-e2e-setup] FATAL: DATABASE_URL not set");
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbUrl);
  const db = drizzle(conn);

  if (reset) {
    console.log("[phase7-e2e-setup] --reset: wiping prior phase-7 e2e data");
    await wipe(db);
  }

  // ── 1. user ──────────────────────────────────────────────────────────
  // Mirrors createTestOrg.ts pattern — INSERT IGNORE + lookup by openId.
  await db.insert(users).values({
    openId: MARKER_OPENID,
    email: MARKER_EMAIL,
    name: "Phase 7 E2E Test User",
    role: "user",
    subscriptionTier: "pro",
    subscriptionStatus: "active",
    loginMethod: "email",
  }).onDuplicateKeyUpdate({ set: { email: MARKER_EMAIL } });
  const [userRow] = await db.select({ id: users.id }).from(users).where(eq(users.openId, MARKER_OPENID)).limit(1);
  if (!userRow) throw new Error("user lookup failed");
  const userId = userRow.id;

  // ── 2. client ───────────────────────────────────────────────────────
  const clientId = readInsertId(await db.insert(clients).values({
    userId,
    companyName: MARKER_CLIENT,
    contactName: "Phase 7 Test Contact",
    contactEmail: "p7-contact@mergetasks.test",
    industry: "Tech",
  }));

  // ── 3. store ────────────────────────────────────────────────────────
  const storeId = readInsertId(await db.insert(stores).values({
    userId,
    clientId,
    name: "Phase 7 E2E Test Store",
    slug: MARKER_STORE_SLUG,
    logoUrl: LOGO_URL,
    primaryColor: "#654BF9",
    status: "active",
    requireAuth: false,
  }));

  // ── 4. products ─────────────────────────────────────────────────────
  // Placement coordinates are populated so the re-render path passes
  // the no_analysis gate. Conservative chest-left placement; the
  // walkthrough doesn't validate placement quality.
  const productIds: number[] = [];
  for (const seed of PRODUCT_MATRIX) {
    const insert: InsertProduct = {
      userId,
      name: seed.name,
      sku: seed.sku,
      category: seed.category,
      imageUrl: PLACEHOLDER(seed.name, "FFFFFF"),
      decorationMethods: [seed.decoration],
      basePrice: "29.99",
      currency: "USD",
      // Placement fields satisfy the no_analysis gate in the orchestrator.
      webstoreImprintPlacementX:          "0.3500",
      webstoreImprintPlacementY:          "0.2000",
      webstoreImprintPlacementWidth:      "0.3000",
      webstoreImprintPlacementHeight:     "0.1500",
      webstoreImprintPlacementZone:       "chest_left",
      webstoreImprintPlacementBlendMode:  "multiply",
      webstoreImprintPlacementConfidence: "0.85",
      webstoreImprintPlacementAnalyzedAt: new Date(),
      webstoreImprintPlacementSource:     "ai",
    };
    const productId = readInsertId(await db.insert(products).values(insert));
    productIds.push(productId);
  }

  // ── 5. storeProducts with varied state ──────────────────────────────
  const summary: { storeProductId: number; product: string; state: string }[] = [];
  for (let i = 0; i < PRODUCT_MATRIX.length; i++) {
    const seed = PRODUCT_MATRIX[i];
    const productId = productIds[i];

    const fields: Partial<typeof storeProducts.$inferInsert> = {
      storeId,
      productId,
      featured: false,
      sortOrder: i,
    };

    switch (seed.state) {
      case "pending_review":
        // Worker-style fields: complete + unapproved → Pending Review.
        fields.webstoreRenderStatus = "complete";
        fields.webstoreRenderedImageUrl = PLACEHOLDER(`${seed.name} render`, "654BF9");
        fields.webstoreRenderedAt = new Date();
        fields.webstoreRenderDecoration = seed.decoration;
        fields.webstoreRenderModel = "phase7-e2e-stub";
        fields.renderApproved = false;
        break;
      case "failed":
        fields.webstoreRenderStatus = "failed";
        fields.renderApproved = false;
        break;
      case "approved":
        fields.webstoreRenderStatus = "complete";
        fields.webstoreRenderedImageUrl = PLACEHOLDER(`${seed.name} render`, "16A34A");
        fields.webstoreRenderedAt = new Date();
        fields.webstoreRenderDecoration = seed.decoration;
        fields.webstoreRenderModel = "phase7-e2e-stub";
        fields.renderApproved = true;
        fields.renderApprovedAt = new Date();
        fields.renderApprovedBy = userId;
        break;
      case "no_render":
        fields.webstoreRenderStatus = "pending";
        fields.renderApproved = false;
        break;
    }

    const storeProductId = readInsertId(await db.insert(storeProducts).values(fields as typeof storeProducts.$inferInsert));
    summary.push({ storeProductId, product: seed.name, state: seed.state });
  }

  // ── 6. report ───────────────────────────────────────────────────────
  console.log("");
  console.log("───────────────────────────────────────────────────────────────");
  console.log("Phase 7 E2E test environment seeded");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(`  userId:    ${userId}`);
  console.log(`  clientId:  ${clientId}`);
  console.log(`  storeId:   ${storeId}`);
  console.log(`  storeSlug: ${MARKER_STORE_SLUG}`);
  console.log("");
  console.log("storeProducts:");
  for (const row of summary) {
    console.log(`  ${row.storeProductId}\t${row.state.padEnd(16)}\t${row.product}`);
  }
  console.log("");
  console.log("Click-through targets:");
  console.log(`  Renders tab:   /store-management/${storeId}  → click "Renders" tab`);
  console.log(`  Customer view: /store/${MARKER_STORE_SLUG}    → verify approved-only display`);
  console.log("");
  console.log("Cleanup:  npx tsx scripts/phase7-e2e-teardown.ts");
  console.log("");

  await conn.end();
}

function readInsertId(r: unknown): number {
  return (r as Array<{ insertId: number }>)[0].insertId;
}

async function wipe(db: ReturnType<typeof drizzle>) {
  // Find user → cascade-delete owned data in reverse FK order.
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.openId, MARKER_OPENID)).limit(1);
  if (!u) return;
  const userId = u.id;

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
  console.error("[phase7-e2e-setup] FAILED:", err);
  process.exit(1);
});
