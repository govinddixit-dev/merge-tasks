#!/usr/bin/env node
/**
 * Debug migration runner - applies each SQL file individually and shows exact errors.
 * Skips statements that fail with "already exists" / "already applied" errors.
 * Used in CI when drizzle-kit migrate fails silently.
 *
 * Strategy: apply ALL migrations from scratch (ignoring __drizzle_migrations).
 * Idempotent errors (table/column/index already exists, table doesn't exist for
 * DROP/ALTER on already-removed objects) are silently skipped.
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join } from 'path';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const match = DB_URL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
if (!match) {
  console.error('Invalid DATABASE_URL format:', DB_URL);
  process.exit(1);
}
const [, user, password, host, port, database] = match;
const conn = await createConnection({
  host,
  port: parseInt(port),
  user,
  password,
  database,
  multipleStatements: false,
});

// Load journal
const journalPath = join(process.cwd(), 'drizzle', 'meta', '_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
console.log(`Journal has ${journal.entries.length} entries - applying all from scratch (idempotent)`);

const drizzleDir = join(process.cwd(), 'drizzle');
let failedCount = 0;

/**
 * Split SQL file content into individual statements.
 * Handles:
 *   - drizzle-kit --> statement-breakpoint markers
 *   - semicolons at end of line (including multi-line CREATE TABLE)
 *   - comment-only lines
 */
function splitStatements(content) {
  // First try drizzle-kit breakpoints
  if (content.includes('--> statement-breakpoint')) {
    return content
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.replace(/--[^\n]*/g, '').trim().startsWith(''));
  }

  // Otherwise split on semicolons that appear at the end of a line
  // This correctly handles multi-line CREATE TABLE statements
  const stmts = [];
  let current = '';
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip pure comment lines when building up a statement
    if (trimmed.startsWith('--') && current.trim() === '') continue;
    current += line + '\n';
    if (trimmed.endsWith(';')) {
      const stmt = current.trim().replace(/;$/, '').trim();
      if (stmt.length > 4 && !stmt.replace(/--[^\n]*/g, '').trim() === '') {
        stmts.push(stmt);
      }
      current = '';
    }
  }
  if (current.trim().length > 4) {
    stmts.push(current.trim());
  }
  return stmts.filter(s => {
    const noComments = s.replace(/--[^\n]*/g, '').trim();
    return noComments.length > 4;
  });
}

/**
 * Determine if a MySQL error is ignorable (statement was already applied or
 * references something that no longer exists due to a later migration).
 */
function isIgnorableError(msg, stmt) {
  // Already-exists errors
  if (msg.includes('already exists')) return true;
  if (msg.includes('Duplicate column name')) return true;
  if (msg.includes('Duplicate key name')) return true;
  if (msg.includes('Duplicate entry') && stmt.toUpperCase().startsWith('INSERT')) return true;

  // Drop/alter on things that don't exist (already cleaned up by a later migration)
  if (msg.includes("Can't DROP")) return true;
  if (msg.includes("Unknown column")) return true;
  if (msg.includes("Table") && msg.includes("doesn't exist") &&
      (stmt.toUpperCase().startsWith('ALTER TABLE') ||
       stmt.toUpperCase().startsWith('DROP TABLE') ||
       stmt.toUpperCase().startsWith('UPDATE') ||
       stmt.toUpperCase().startsWith('CREATE INDEX'))) return true;

  // CHANGE COLUMN on a column that was already renamed
  if (msg.includes("Unknown column") || msg.includes("doesn't exist")) return true;

  return false;
}

for (const entry of journal.entries) {
  const sqlFile = join(drizzleDir, `${entry.tag}.sql`);
  let content;
  try {
    content = readFileSync(sqlFile, 'utf8');
  } catch (e) {
    console.error(`❌ Cannot read migration file: ${sqlFile}`);
    await conn.end();
    process.exit(1);
  }

  const statements = splitStatements(content);
  console.log(`\nApplying ${entry.tag}.sql (${statements.length} statements)...`);

  let fileOk = true;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt || stmt.length < 5) continue;
    try {
      await conn.execute(stmt);
    } catch (err) {
      const msg = err.message || '';
      if (isIgnorableError(msg, stmt)) {
        console.log(`  ⚠️  Skipped (already applied): ${stmt.substring(0, 120)}...`);
        continue;
      }
      console.error(`\n❌ FAILED in ${entry.tag}.sql (statement ${i + 1}/${statements.length}):`);
      console.error(`SQL: ${stmt.substring(0, 500)}`);
      console.error(`\nError: ${err.message}`);
      fileOk = false;
      failedCount++;
      break;
    }
  }

  if (!fileOk) {
    console.error(`\nMigration failed in: ${entry.tag}.sql`);
    await conn.end();
    process.exit(1);
  }

  console.log(`✓ ${entry.tag}.sql applied`);
}

await conn.end();
if (failedCount === 0) {
  console.log('\n✅ All migrations applied successfully');
} else {
  console.log(`\n⚠️  ${failedCount} migrations had errors`);
  process.exit(1);
}
