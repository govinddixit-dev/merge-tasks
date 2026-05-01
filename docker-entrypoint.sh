#!/bin/sh
set -e

MYSQL_WAIT_HOST="${MYSQL_WAIT_HOST:-mysql}"
MYSQL_WAIT_PORT="${MYSQL_WAIT_PORT:-3306}"
MYSQL_WAIT_USER="${MYSQL_WAIT_USER:-mergetasks}"
MYSQL_WAIT_PASSWORD="${MYSQL_WAIT_PASSWORD:-mergetasks_pass}"

echo "[docker-entrypoint] Waiting for MySQL (${MYSQL_WAIT_HOST}:${MYSQL_WAIT_PORT})..."
i=0
while [ "$i" -lt 90 ]; do
  if MYSQL_PWD="$MYSQL_WAIT_PASSWORD" mysqladmin ping -h "$MYSQL_WAIT_HOST" -P "$MYSQL_WAIT_PORT" -u "$MYSQL_WAIT_USER" --silent 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 2
done
if ! MYSQL_PWD="$MYSQL_WAIT_PASSWORD" mysqladmin ping -h "$MYSQL_WAIT_HOST" -P "$MYSQL_WAIT_PORT" -u "$MYSQL_WAIT_USER" --silent 2>/dev/null; then
  echo "[docker-entrypoint] FATAL: MySQL did not become ready in time" >&2
  exit 1
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[docker-entrypoint] Applying database migrations..."
  cd /app && bash scripts/migrate.sh
fi

exec "$@"
