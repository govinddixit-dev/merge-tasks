#!/usr/bin/env bash
###############################################################################
# Wipe all application rows from the DB pointed at by DATABASE_URL (from env
# or repo .env). Keeps table definitions and `_schema_migrations` so
# `pnpm db:push` / migrate.sh stay idempotent.
#
# Usage:
#   pnpm db:clear
#   bash scripts/clear-app-data.sh --yes
#
# For Docker Compose MySQL (no host port), either temporarily set DATABASE_URL
# to mysql://mergetasks:mergetasks_pass@127.0.0.1:3307/mergetasks after
# publishing 3307:3306, or run the TRUNCATE block inside the mysql container.
###############################################################################
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//')"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[clear-app-data] FATAL: DATABASE_URL not set (env or $ENV_FILE)" >&2
  exit 1
fi

re='mysql://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+)'
if [[ ! "$DATABASE_URL" =~ $re ]]; then
  echo "[clear-app-data] FATAL: could not parse DATABASE_URL" >&2
  exit 1
fi
DB_USER="${BASH_REMATCH[1]}"
DB_PASS="${BASH_REMATCH[2]}"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[5]:-3306}"
DB_NAME="${BASH_REMATCH[6]}"

if [[ "${1:-}" != "--yes" ]]; then
  echo "[clear-app-data] Refusing to run without --yes (this deletes ALL data in $DB_NAME)."
  exit 1
fi

mysql_run() {
  MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" "$@" 2> >(grep -v "Using a password" >&2 || true)
}

echo "[clear-app-data] Truncating all tables except _schema_migrations on ${DB_HOST}:${DB_PORT}/${DB_NAME} ..."

tables="$(mysql_run -N -e "SHOW TABLES;" | grep -v '^_schema_migrations$' || true)"
if [ -z "$tables" ]; then
  echo "[clear-app-data] No tables to truncate."
  exit 0
fi

{
  echo "SET FOREIGN_KEY_CHECKS=0;"
  while IFS= read -r t; do
    [ -n "$t" ] && printf 'TRUNCATE TABLE `%s`;\n' "$t"
  done <<< "$tables"
  echo "SET FOREIGN_KEY_CHECKS=1;"
} | mysql_run

remaining="$(mysql_run -N -e "SELECT COUNT(*) FROM users;")"
echo "[clear-app-data] Done. users row count: $remaining"
