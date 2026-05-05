/**
 * backfillStyleGroups.ts — one-shot variant-grouping populator.
 *
 * Idempotent. Re-running yields the same slug + same primary pick.
 *
 * Phases:
 *   1. Bulk-update styleGroup, colorName, swatchUrl per row using the
 *      deterministic derivers in utils/styleGroup.ts.
 *   2. Pick exactly one row per styleGroup as isVariantPrimary using a
 *      window-function rank: prefer rows with images, then rows whose
 *      imageUrl carries a common color token (black/white/navy), then
 *      lowest id. The rank is recomputed every run, so a fresh insert
 *      gets folded in cleanly on the next pass.
 *
 * Usage:
 *   npx tsx server/jobs/backfillStyleGroups.ts --dry-run    # no writes
 *   npx tsx server/jobs/backfillStyleGroups.ts              # writes
 *
 * Both modes print summary stats: distinct groups, primary count
 * per group (must be 1), and a sample of 3 large groups so the
 * operator can eyeball the result before committing to prod.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { products } from "../../drizzle/schema";
import { deriveStyleGroupSlug, extractColorNameFromSanMarUrl } from "../utils/styleGroup";
import { getLogger } from "../utils/logger";

const log = getLogger("backfill-style-groups");

const CHUNK_SIZE = 1000;

interface BackfillStats {
  scanned: number;
  derivedSlugs: number;
  derivedColors: number;
  distinctGroups: number;
  primariesAssigned: number;
  groupsWithMultiplePrimaries: number;
  groupsWithNoPrimary: number;
  sampleLargeGroups: Array<{ styleGroup: string; variants: number; primaryName: string | null; primaryColor: string | null }>;
}

export async function backfillStyleGroups(opts: { dryRun: boolean }): Promise<BackfillStats> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const stats: BackfillStats = {
    scanned: 0,
    derivedSlugs: 0,
    derivedColors: 0,
    distinctGroups: 0,
    primariesAssigned: 0,
    groupsWithMultiplePrimaries: 0,
    groupsWithNoPrimary: 0,
    sampleLargeGroups: [],
  };

  // ── Phase 1: derive per-row fields ────────────────────────────────────
  let offset = 0;
  // Drizzle's mysql2 driver returns plain rows; cast at the boundary.
  type Row = { id: number; name: string | null; imageUrl: string | null };
  while (true) {
    const rows = (await db
      .select({
        id: products.id,
        name: products.name,
        imageUrl: products.imageUrl,
      })
      .from(products)
      .orderBy(products.id)
      .limit(CHUNK_SIZE)
      .offset(offset)) as Row[];

    if (rows.length === 0) break;

    for (const r of rows) {
      stats.scanned += 1;
      const slug = deriveStyleGroupSlug(r.name);
      const color = extractColorNameFromSanMarUrl(r.imageUrl);
      if (slug) stats.derivedSlugs += 1;
      if (color) stats.derivedColors += 1;

      if (!opts.dryRun) {
        await db.execute(sql`
          UPDATE products
          SET styleGroup = ${slug || null},
              colorName  = ${color},
              swatchUrl  = ${r.imageUrl}
          WHERE id = ${r.id}
        `);
      }
    }

    offset += CHUNK_SIZE;
    log.info(`backfillStyleGroups: scanned ${stats.scanned} rows so far${opts.dryRun ? " (dry-run)" : ""}`);
  }

  // ── Phase 2: pick the primary per group ───────────────────────────────
  // ROW_NUMBER ordering: rows WITH an imageUrl come first; among those,
  // rows whose imageUrl path carries a common-color token come first;
  // ties broken by lowest id for stability.
  if (!opts.dryRun) {
    // First clear any existing primary flags so a re-run is idempotent
    // even if the population rule changes between releases.
    await db.execute(sql`UPDATE products SET isVariantPrimary = FALSE`);

    await db.execute(sql`
      UPDATE products p
      JOIN (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY styleGroup
                 ORDER BY
                   (imageUrl IS NULL),
                   (imageUrl REGEXP '_(black|white|navy)_' = 0),
                   id
               ) AS rn
        FROM products
        WHERE styleGroup IS NOT NULL
      ) r ON p.id = r.id
      SET p.isVariantPrimary = (r.rn = 1)
    `);
  }

  // ── Sanity readbacks (run in both dry-run and live so the operator
  //    sees what would-be / what is) ──────────────────────────────────
  type CountRow = { c: number };
  const distinctRows = (await db.execute(sql`
    SELECT COUNT(DISTINCT styleGroup) AS c FROM products WHERE styleGroup IS NOT NULL
  `)) as unknown as Array<CountRow[]>;
  stats.distinctGroups = distinctRows[0]?.[0]?.c ?? 0;

  if (!opts.dryRun) {
    const primaryRows = (await db.execute(sql`
      SELECT COUNT(*) AS c FROM products WHERE isVariantPrimary = TRUE
    `)) as unknown as Array<CountRow[]>;
    stats.primariesAssigned = primaryRows[0]?.[0]?.c ?? 0;

    const dupes = (await db.execute(sql`
      SELECT styleGroup, COUNT(*) AS c FROM products
      WHERE isVariantPrimary = TRUE AND styleGroup IS NOT NULL
      GROUP BY styleGroup HAVING c > 1
    `)) as unknown as Array<Array<{ styleGroup: string; c: number }>>;
    stats.groupsWithMultiplePrimaries = dupes[0]?.length ?? 0;

    const empty = (await db.execute(sql`
      SELECT styleGroup FROM products
      WHERE styleGroup IS NOT NULL
      GROUP BY styleGroup
      HAVING SUM(isVariantPrimary = TRUE) = 0
    `)) as unknown as Array<Array<{ styleGroup: string }>>;
    stats.groupsWithNoPrimary = empty[0]?.length ?? 0;
  }

  // Sample 3 large groups for spot-check.
  type SampleRow = { styleGroup: string; variants: number; primaryName: string | null; primaryColor: string | null };
  const sampleQuery = opts.dryRun
    // Dry-run: primaries aren't written yet, so just show the slug + count.
    ? sql`
        SELECT styleGroup, COUNT(*) AS variants,
               (SELECT name FROM products WHERE styleGroup = p.styleGroup ORDER BY id LIMIT 1) AS primaryName,
               (SELECT colorName FROM products WHERE styleGroup = p.styleGroup ORDER BY id LIMIT 1) AS primaryColor
        FROM products p
        WHERE styleGroup IS NOT NULL
        GROUP BY styleGroup
        ORDER BY variants DESC
        LIMIT 5
      `
    : sql`
        SELECT styleGroup, COUNT(*) AS variants,
               MAX(CASE WHEN isVariantPrimary = TRUE THEN name      END) AS primaryName,
               MAX(CASE WHEN isVariantPrimary = TRUE THEN colorName END) AS primaryColor
        FROM products
        WHERE styleGroup IS NOT NULL
        GROUP BY styleGroup
        ORDER BY variants DESC
        LIMIT 5
      `;
  const samples = (await db.execute(sampleQuery)) as unknown as Array<SampleRow[]>;
  stats.sampleLargeGroups = samples[0] ?? [];

  return stats;
}

// ── CLI entry ──────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  log.info(`backfillStyleGroups starting${dryRun ? " (DRY-RUN — no writes)" : ""}`);

  // Dry-run preview: derive in memory only — don't UPDATE rows.
  // Phase-1 of the function above branches on dryRun; here we run that
  // and print the readback. For a true dry run against a DB without the
  // 0103 migration applied yet, the per-row UPDATE would fail; that's
  // why dryRun also skips Phase 1's writes.
  const stats = await backfillStyleGroups({ dryRun });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("backfillStyleGroups.ts")) {
  main().catch(err => {
    log.error(`backfillStyleGroups failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
