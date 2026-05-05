/**
 * Transitive-closure dependency audit for the test-data wipe.
 *
 * Walks the FK dependency graph from information_schema starting at a
 * set of "delete root" tables, recursively discovers every NO-ACTION /
 * SET-NULL / CASCADE child, pulls live row counts, and emits a
 * depth-ordered cleanup list.
 *
 * Algorithm:
 *   1. Load all FK edges from information_schema (single query)
 *   2. Build reverse-adjacency map: parent -> [{child, column, rule}]
 *   3. DFS from each root with a visited Set (no revisits)
 *   4. Compute depth for each table = longest path from any root
 *   5. Fetch row counts in parallel
 *   6. Emit depth-ordered output
 *
 * Read-only.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const DELETE_ROOTS = [
  "stores", "clients", "users",
  "audit_log", "aiAuditLog", "copilot_conversations", "notifications",
  "aiTrainingData", "poPreviewDrafts", "productCollections",
  "copilotPendingActions",
  "proposals", "invoices", "estimates", "purchaseOrders", "orders",
  "virtualProofs",
];

const PRESERVE_TABLES = new Set(["products", "organizations", "suppliers"]);

const SCRIPT_HANDLED = new Set([
  "proposalOrderItems", "proposalProductVariants", "proposalProductImages",
  "proposalSizeCharts", "proposalPriceTiers",
  "proposalProducts",
  "proposalVersions", "departmentApprovals", "virtualProofs", "refund_requests",
  "orderItems", "promoCodeUsages", "invoices", "estimates",
  "purchaseOrders", "orders",
  "proposals",
  "storeProducts", "storePasswordTokens", "storeAllowedDomains",
  "storeVerificationCodes", "promoCodes", "customOrderRequests",
  "emailUnsubscribes", "printRequests", "storeUsers",
  "stores",
  "clientLogos", "clientContacts", "clientAssets", "clientProductConfig",
  "clients",
  "distributorProfiles", "audit_log", "documentSequences",
  "aiEditFeedback", "aiTrainingData", "aiAuditLog",
  "copilot_conversations", "notifications", "poPreviewDrafts",
  "productCollections", "users",
  // Auto-handled via CASCADE before users delete runs:
  // purchaseOrderEvents → cleaned by Step 4.5's purchaseOrders delete (CASCADE on .purchaseOrderId)
  "purchaseOrderEvents",
]);

const COLUMN_REFS: Array<{ table: string; column: string; usedIn: string }> = [
  { table: "products", column: "userId", usedIn: "Step 7 SET + WHERE" },
  { table: "documentSequences", column: "userId", usedIn: "Step 11.3/11.4 WHERE" },
  { table: "documentSequences", column: "nextNumber", usedIn: "Step 11.4 SET" },
  { table: "distributorProfiles", column: "userId", usedIn: "Step 11.1 WHERE" },
  { table: "users", column: "id", usedIn: "Step 11.5 WHERE / verification" },
  { table: "organizations", column: "id", usedIn: "verification SELECT" },
  { table: "organizations", column: "ownerId", usedIn: "verification SELECT" },
];

type Edge = { child: string; childCol: string; parent: string; parentCol: string; rule: string };

async function main() {
  const db = await getDb();
  if (!db) throw new Error("getDb null");

  console.log("=== TRANSITIVE-CLOSURE DEPENDENCY AUDIT ===\n");

  // Step 1: Load all FK edges once
  const edgesRes = await db.execute(sql`
    SELECT k.TABLE_NAME AS childTable, k.COLUMN_NAME AS childCol,
           k.REFERENCED_TABLE_NAME AS parentTable, k.REFERENCED_COLUMN_NAME AS parentCol,
           r.DELETE_RULE AS rule
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME AND k.TABLE_SCHEMA = r.CONSTRAINT_SCHEMA
    WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
  `);
  const edgeRows = (edgesRes as unknown as [Array<Record<string, unknown>>, unknown])[0];
  const allEdges: Edge[] = edgeRows.map((r) => ({
    child: String(r.childTable), childCol: String(r.childCol),
    parent: String(r.parentTable), parentCol: String(r.parentCol),
    rule: String(r.rule),
  }));
  console.log(`Loaded ${allEdges.length} FK edges from information_schema`);

  // Step 2: Build reverse-adjacency map (parent -> children edges)
  const childrenByParent = new Map<string, Edge[]>();
  for (const e of allEdges) {
    if (!childrenByParent.has(e.parent)) childrenByParent.set(e.parent, []);
    childrenByParent.get(e.parent)!.push(e);
  }

  // Step 3: DFS from each root with visited set; collect topology
  const discovered = new Set<string>();
  const incomingEdges = new Map<string, Edge[]>(); // table -> edges that bring us TO it
  const stack: string[] = [...DELETE_ROOTS];
  while (stack.length > 0) {
    const t = stack.pop()!;
    if (PRESERVE_TABLES.has(t)) continue;
    if (discovered.has(t)) continue;
    discovered.add(t);
    if (!incomingEdges.has(t)) incomingEdges.set(t, []);
    const children = childrenByParent.get(t) ?? [];
    for (const e of children) {
      if (PRESERVE_TABLES.has(e.child)) continue;
      if (!incomingEdges.has(e.child)) incomingEdges.set(e.child, []);
      incomingEdges.get(e.child)!.push(e);
      if (!discovered.has(e.child)) stack.push(e.child);
    }
  }
  console.log(`Discovered ${discovered.size} tables in transitive closure\n`);

  // Step 4: Compute depth = longest path from any root, using memoized DFS
  const depthMemo = new Map<string, number>();
  function computeDepth(t: string, visiting: Set<string>): number {
    if (depthMemo.has(t)) return depthMemo.get(t)!;
    if (visiting.has(t)) return 0; // cycle protection
    visiting.add(t);
    const incoming = incomingEdges.get(t) ?? [];
    if (incoming.length === 0) {
      depthMemo.set(t, 0);
      visiting.delete(t);
      return 0;
    }
    let maxParentDepth = -1;
    for (const e of incoming) {
      if (!discovered.has(e.parent)) continue;
      const pd = computeDepth(e.parent, visiting);
      if (pd > maxParentDepth) maxParentDepth = pd;
    }
    visiting.delete(t);
    const d = maxParentDepth + 1;
    depthMemo.set(t, d);
    return d;
  }
  for (const t of discovered) computeDepth(t, new Set());

  // Step 5: Fetch row counts in parallel
  const tables = Array.from(discovered);
  const counts = await Promise.all(tables.map(async (t) => {
    try {
      const r = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${t}`));
      const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
      return { t, n: Number(rows[0].n) };
    } catch (err) {
      return { t, n: -1, err: (err as Error).message.slice(0, 60) };
    }
  }));
  const countByTable = new Map(counts.map((c) => [c.t, c.n]));

  // Step 6: Emit depth-ordered output (deepest first = delete first)
  const sorted = tables.sort((a, b) => (depthMemo.get(b)! - depthMemo.get(a)!) || a.localeCompare(b));

  console.log("=== DISCOVERED TABLES (depth-ordered, deepest = delete first) ===");
  console.log(`${"depth".padEnd(6)} ${"table".padEnd(32)} ${"rows".padEnd(8)} ${"status".padEnd(15)} via\n`);
  const gaps: string[] = [];
  const cascadeOk: string[] = [];
  for (const t of sorted) {
    const d = depthMemo.get(t)!;
    const n = countByTable.get(t)!;
    const inScript = SCRIPT_HANDLED.has(t);
    const incoming = incomingEdges.get(t) ?? [];
    const blockingIncoming = incoming.filter((e) => e.rule !== "CASCADE" && e.rule !== "SET NULL");
    const isBlocker = blockingIncoming.length > 0 && n > 0;
    const allCascade = incoming.length > 0 && incoming.every((e) => e.rule === "CASCADE");
    const status = inScript ? "✓ in-script" : isBlocker ? "⚠ GAP" : allCascade ? "○ cascade" : n === 0 ? "· empty" : "· non-blocker";
    const via = incoming.slice(0, 3).map((e) => `${e.parent}.${e.childCol}(${e.rule})`).join(",");
    const viaSuffix = incoming.length > 3 ? `,+${incoming.length - 3}more` : "";
    console.log(`${String(d).padEnd(6)} ${t.padEnd(32)} ${String(n).padEnd(8)} ${status.padEnd(15)} ${via}${viaSuffix}`);
    if (!inScript && isBlocker) gaps.push(`${t} (${n} rows; blocked by ${blockingIncoming.map((b) => b.parent).join(",")})`);
    if (!inScript && allCascade) cascadeOk.push(t);
  }

  console.log("\n=== GAPS — non-empty NO-ACTION children NOT in cleanup script ===");
  if (gaps.length === 0) console.log("  ✓ No gaps");
  else for (const g of gaps) console.log(`  ⚠ ${g}`);

  console.log("\n=== CASCADE-ONLY (auto-cleaned) ===");
  if (cascadeOk.length === 0) console.log("  (none)");
  else for (const c of cascadeOk) console.log(`  ○ ${c}`);

  // Column existence validation
  console.log("\n=== COLUMN-EXISTENCE VALIDATION ===");
  let colFailed = 0;
  for (const { table, column, usedIn } of COLUMN_REFS) {
    const r = await db.execute(sql`
      SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${column}
    `);
    const rows = (r as unknown as [Array<{ n: number }>, unknown])[0];
    const exists = Number(rows[0].n) === 1;
    console.log(`  ${exists ? "✓" : "✗"} ${table}.${column.padEnd(15)} (${usedIn})`);
    if (!exists) colFailed++;
  }
  console.log(colFailed === 0 ? "  ✓ All valid" : `  ⚠ ${colFailed} invalid`);

  // Supplier preservation safety
  console.log("\n=== SUPPLIER PRESERVATION SAFETY ===");
  const supRefs = await db.execute(sql`
    SELECT k.TABLE_NAME, k.COLUMN_NAME, r.DELETE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
      AND k.TABLE_SCHEMA = r.CONSTRAINT_SCHEMA
    WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = 'suppliers'
  `);
  const supRefRows = (supRefs as unknown as [Array<Record<string, unknown>>, unknown])[0];
  console.log("  FK refs TO suppliers.id:");
  if (supRefRows.length === 0) console.log("    (none)");
  for (const r of supRefRows) console.log(`    ${r.TABLE_NAME}.${r.COLUMN_NAME} (${r.DELETE_RULE})`);
  const supSample = await db.execute(sql`SELECT id, name, userId FROM suppliers LIMIT 5`);
  const supRows = (supSample as unknown as [Array<Record<string, unknown>>, unknown])[0];
  console.log("  suppliers row(s):");
  for (const r of supRows) console.log(`    ${JSON.stringify(r)}`);

  console.log("\n=== PRODUCTS OWNERSHIP (current) ===");
  const od = await db.execute(sql`SELECT userId, COUNT(*) AS n FROM products GROUP BY userId`);
  const odRows = (od as unknown as [Array<Record<string, unknown>>, unknown])[0];
  for (const r of odRows) console.log(`  ${JSON.stringify(r)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
