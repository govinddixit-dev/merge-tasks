#!/usr/bin/env bash
###############################################################################
# migrate.sh — idempotent schema migrator for MergeTasks.
#
# Why this script instead of `drizzle-kit migrate`?
# ─────────────────────────────────────────────────
# The hand-written migrations under drizzle/*.sql are not tracked in
# drizzle/meta/_journal.json. Running `drizzle-kit generate` therefore
# emits spurious "missing diff" migrations that collide with the real
# files (this is how the 0050_absurd_korvac mess was created). We own
# the migration order; a one-page shell runner is more trustworthy here.
#
# Behaviour
# ─────────
# 1. Creates a `_schema_migrations(filename, appliedAt)` tracker table if
#    absent.
# 2. Seeds the tracker with every drizzle/NNNN_*.sql file that pre-dates
#    this tool (first run only). Assumption: if the code-expected schema
#    matches the DB right now, every legacy migration is effectively
#    applied. The caller (deploy.sh) backs the DB up before invoking us
#    so the cost of a wrong assumption is bounded.
# 3. For every drizzle/NNNN_*.sql not in the tracker, applies it inside a
#    transaction (when possible — DDL is implicit-commit in MySQL, so
#    per-file success is the atomicity boundary), records it on success,
#    aborts the whole run on the first failure.
#
# Exit codes: 0 = success, 1 = error (caller must not proceed).
###############################################################################
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
MIGRATIONS_DIR="$ROOT/drizzle"

# DATABASE_URL is the source of truth. Prefer the process environment (CI
# runners, docker containers) and fall back to ./.env when the script is
# invoked from a shell that hasn't sourced the env file.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//')"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[migrate] FATAL: DATABASE_URL not set (neither in env nor in $ENV_FILE)" >&2
  exit 1
fi

# Parse mysql://user:pass@host:port/dbname?...
re='mysql://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+)'
if [[ ! "$DATABASE_URL" =~ $re ]]; then
  echo "[migrate] FATAL: could not parse DATABASE_URL" >&2
  exit 1
fi
DB_USER="${BASH_REMATCH[1]}"
DB_PASS="${BASH_REMATCH[2]}"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[5]:-3306}"
DB_NAME="${BASH_REMATCH[6]}"

mysql_run() {
  # Silence the "Using a password on the command line" warning to keep
  # deploy logs readable. We accept the trade-off because this script
  # runs on the server where .env sits next to the binary anyway.
  MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" "$@" 2> >(grep -v "Using a password" >&2 || true)
}

log() { echo "[migrate] $*"; }

# ── Ensure tracker table ────────────────────────────────────────────────────
mysql_run <<'SQL'
CREATE TABLE IF NOT EXISTS `_schema_migrations` (
  `filename` VARCHAR(255) NOT NULL PRIMARY KEY,
  `appliedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL

# ── First-run handling ──────────────────────────────────────────────────────
# Two "empty tracker" scenarios, handled differently:
#   (a) DB already has user tables — this is a production-first-run where
#       the legacy schema is in sync with the code. Seed the tracker with
#       every NNNN_*.sql file and move on.
#   (b) DB is genuinely empty (CI runner, fresh dev box) — apply every
#       migration in lexical order. The tracker grows as we go.
applied_count=$(mysql_run -Nse "SELECT COUNT(*) FROM \`_schema_migrations\`;")
user_table_count=$(mysql_run -Nse "
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name <> '_schema_migrations';
")

if [ "$applied_count" = "0" ] && [ "$user_table_count" != "0" ]; then
  log "first run on an existing DB — seeding tracker with all NNNN_*.sql files (assumption: schema is in sync with code right now)"
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    mysql_run -Nse "INSERT INTO \`_schema_migrations\` (filename) VALUES ('$name');"
    log "  seeded: $name"
  done
  log "tracker initialised; future runs will apply only new migrations"
  exit 0
fi

# ── Apply any file not yet in the tracker, in lexical order ────────────────
pending=()
for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  name="$(basename "$f")"
  is_applied=$(mysql_run -Nse "SELECT COUNT(*) FROM \`_schema_migrations\` WHERE filename='$name';")
  if [ "$is_applied" = "0" ]; then
    pending+=("$f")
  fi
done

if [ "${#pending[@]}" -eq 0 ]; then
  log "no pending migrations"
  exit 0
fi

log "pending migrations: ${#pending[@]}"
for f in "${pending[@]}"; do
  name="$(basename "$f")"
  log "applying $name"
  # Strip Drizzle's `--> statement-breakpoint` markers before piping to
  # mysql. The markers look like SQL line-comments but aren't: MySQL only
  # treats `-- ` (dash-dash-SPACE) as a comment, so `-->` parses as an
  # operator and errors out with "You have an error in your SQL syntax".
  # The markers appear both as standalone lines and tacked onto the end
  # of a statement (e.g. `...;--> statement-breakpoint`), so a blanket
  # string replace is the right tool.
  #
  # --force: The hand-written migrations and the drizzle-generated
  # snapshots (0025_daffy_genesis, 0026_dashing_lady_deathstrike,
  # 0050_flashy_sersi) overlap heavily — many ADD COLUMN / ADD CONSTRAINT
  # statements are declared in more than one file. On production the
  # tracker-seeding first-run branch masks this; on a fresh CI DB every
  # file is replayed and the duplicates surface as errors 1060, 1061,
  # 1826, 1050, 1091. `--force` lets the mysql client continue past each
  # statement and finish the file so the final schema converges with the
  # drizzle snapshot. Genuine syntax errors still show up in stderr and
  # are visible in the migration log; only per-statement errors are
  # tolerated, not connection/auth/server failures.
  apply_err=$(mktemp)
  if ! sed 's|--> statement-breakpoint||g' "$f" | mysql_run --force 2>"$apply_err"; then
    cat "$apply_err" >&2
    rm -f "$apply_err"
    log "FAILED: $name — aborting. Fix the SQL and re-run; do NOT mark it applied manually until the root cause is understood."
    exit 1
  fi
  # `mysql --force` exits 0 even when individual statements fail. We must
  # classify the per-statement errors ourselves: the documented "tolerated"
  # set (duplicate column / index / FK / table re-create / drop-of-missing)
  # comes from the legacy 0025/0026/0050 overlap; everything else — syntax
  # errors, unsupported algorithms, missing tables, etc. — is a real
  # failure that must NOT mark the migration as applied (otherwise the
  # tracker becomes a lying source of truth, exactly the bug that hid the
  # 0096 ER 1221 failure on 2026-04-25).
  TOLERATED_ERR_CODES_RE='^ERROR (1050|1060|1061|1091|1826) '
  fatal_errors="$(grep -E "^ERROR " "$apply_err" | grep -vE "$TOLERATED_ERR_CODES_RE" || true)"
  if [ -n "$fatal_errors" ]; then
    echo "$fatal_errors" | sed 's/^/[migrate]   FATAL: /' >&2
    rm -f "$apply_err"
    log "FAILED: $name — one or more statements raised a non-tolerated error. Tracker NOT updated."
    exit 1
  fi
  # Tolerated errors only — surface them as notes for visibility.
  if [ -s "$apply_err" ]; then
    grep -E "^ERROR " "$apply_err" | head -5 | sed 's/^/[migrate]   note (tolerated): /' >&2 || true
  fi
  rm -f "$apply_err"
  mysql_run -Nse "INSERT INTO \`_schema_migrations\` (filename) VALUES ('$name');"
  log "  ✓ $name"
done

log "all pending migrations applied successfully"
