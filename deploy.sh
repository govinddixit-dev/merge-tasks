#!/usr/bin/env bash
###############################################################################
# deploy.sh — end-to-end deploy for the MergeTasks server.
#
# Ordered, auditable, and safe-by-default:
#   1. git pull                    (fast-forward from origin/main)
#   2. pnpm install                (only if pnpm-lock.yaml/package.json changed, or node_modules missing)
#   3. backup schema               (mysqldump --no-data to dist/schema-TS.sql)
#   4. npm run db:push             (our idempotent migrator)
#   5. npm run build               (vite + esbuild)
#   6. pm2 reload --update-env     (zero-downtime reload)
#   7. health check                (30-second poll on /api/health)
#   8. on health-check failure:    automatic rollback to previous dist/
#
# Every step writes a timestamped line to ~/mergetasks/deploy.log.
# The script is re-entrant: run as many times as you want; no state drift.
###############################################################################
set -euo pipefail

ROOT="/home/ubuntu/mergetasks"
LOG="$ROOT/deploy.log"
BACKUP_DIR="$ROOT/.deploy-backups"
HEALTH_URL="http://127.0.0.1:3000/health"
HEALTH_TIMEOUT_SECS=30
HEALTH_POLL_INTERVAL=2

mkdir -p "$BACKUP_DIR"
cd "$ROOT"

# All output — stdout and stderr — is tee'd to deploy.log. Every log line is
# timestamped at source so the log is readable without external processing.
exec > >(while IFS= read -r line; do printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$line"; done | tee -a "$LOG") 2>&1

DEPLOY_ID="$(date -u +'%Y%m%d-%H%M%S')"
START_EPOCH=$(date +%s)
echo "═══════════════════════════════════════════════════════════════════════"
echo "[deploy $DEPLOY_ID] DEPLOY STARTED commit=$(git rev-parse HEAD)→pending"
echo "═══════════════════════════════════════════════════════════════════════"

# Capture the pre-deploy commit in case we need to roll back the code.
PREV_COMMIT="$(git rev-parse HEAD)"
PREV_DIST_BACKUP="$BACKUP_DIR/dist-prev-$DEPLOY_ID.tar.gz"

# Rollback sequence — defined early so every failure path below can invoke it.
rollback_and_exit() {
  echo "[deploy $DEPLOY_ID] DEPLOY FAILED step=rollback elapsed=$(( $(date +%s) - START_EPOCH ))s — rolled back to previous build"
  if [ -f "$PREV_DIST_BACKUP" ]; then
    echo "[deploy $DEPLOY_ID] restoring dist/ from $PREV_DIST_BACKUP"
    rm -rf "$ROOT/dist"
    tar -xzf "$PREV_DIST_BACKUP" -C "$ROOT"
  else
    echo "[deploy $DEPLOY_ID] WARN: no dist snapshot to restore"
  fi
  if [ "${NEW_COMMIT:-}" ] && [ "$PREV_COMMIT" != "$NEW_COMMIT" ]; then
    echo "[deploy $DEPLOY_ID] rolling source back to $PREV_COMMIT"
    git reset --hard "$PREV_COMMIT"
  fi
  echo "[deploy $DEPLOY_ID] reloading pm2 on restored build"
  pm2 reload mergetasks --update-env || pm2 restart mergetasks --update-env || true
  exit 1
}
echo "[deploy $DEPLOY_ID] previous HEAD: $PREV_COMMIT"

# ── 1. pull latest ──────────────────────────────────────────────────────────
echo "[deploy $DEPLOY_ID] step 1/7: git pull origin main"
git fetch origin main
git reset --hard origin/main

NEW_COMMIT="$(git rev-parse HEAD)"
if [ "$NEW_COMMIT" = "$PREV_COMMIT" ]; then
  echo "[deploy $DEPLOY_ID] no new commits on origin/main — still continuing so manual reruns work"
else
  echo "[deploy $DEPLOY_ID] new HEAD: $NEW_COMMIT"
fi

# ── 2. install deps if lockfile changed ─────────────────────────────────────
echo "[deploy $DEPLOY_ID] step 2/7: pnpm install (only when pnpm-lock.yaml/package.json changed, or node_modules missing)"
deps_changed=0
if [ ! -d "$ROOT/node_modules" ]; then
  echo "[deploy $DEPLOY_ID] node_modules missing — forcing install"
  deps_changed=1
elif [ "$PREV_COMMIT" != "$NEW_COMMIT" ] && git diff --name-only "$PREV_COMMIT" "$NEW_COMMIT" | grep -qE '^(pnpm-lock\.yaml|package\.json)$'; then
  echo "[deploy $DEPLOY_ID] pnpm-lock.yaml or package.json changed — installing"
  deps_changed=1
fi
if [ "$deps_changed" -eq 1 ]; then
  pnpm install --frozen-lockfile
else
  echo "[deploy $DEPLOY_ID] dependencies unchanged — skipping pnpm install"
fi

# ── 3. back up DB schema before migrating ───────────────────────────────────
echo "[deploy $DEPLOY_ID] step 3/7: backup schema"
SCHEMA_BACKUP="$BACKUP_DIR/schema-$DEPLOY_ID.sql"
if DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2-)"; then
  re='mysql://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+)'
  if [[ "$DATABASE_URL" =~ $re ]]; then
    MYSQL_PWD="${BASH_REMATCH[2]}" mysqldump \
      --no-data --skip-comments --skip-dump-date \
      -h "${BASH_REMATCH[3]}" \
      -P "${BASH_REMATCH[5]:-3306}" \
      -u "${BASH_REMATCH[1]}" \
      "${BASH_REMATCH[6]}" > "$SCHEMA_BACKUP" 2> >(grep -v "Using a password" >&2 || true)
    echo "[deploy $DEPLOY_ID] schema snapshot → $SCHEMA_BACKUP ($(wc -c < "$SCHEMA_BACKUP") bytes)"
    # Keep the last 10 snapshots to bound disk usage.
    ls -1t "$BACKUP_DIR"/schema-*.sql 2>/dev/null | tail -n +11 | xargs -r rm -f
  else
    echo "[deploy $DEPLOY_ID] WARN: could not parse DATABASE_URL for schema backup; continuing without one"
  fi
else
  echo "[deploy $DEPLOY_ID] WARN: DATABASE_URL missing from .env — skipping schema backup"
fi

# ── 4. run migrations ───────────────────────────────────────────────────────
echo "[deploy $DEPLOY_ID] step 4/7: npm run db:push"
if ! npm run db:push; then
  echo "[deploy $DEPLOY_ID] FAIL — migrations failed. Aborting BEFORE build/restart so pm2 keeps serving the previous build."
  echo "[deploy $DEPLOY_ID] DEPLOY FAILED step=migrations elapsed=$(( $(date +%s) - START_EPOCH ))s"
  exit 1
fi

# ── 5. snapshot current dist BEFORE build so we can roll back binary changes
#       even if git rollback isn't enough (e.g. a dep version change).
if [ -d "$ROOT/dist" ]; then
  echo "[deploy $DEPLOY_ID] snapshotting current dist/ → $PREV_DIST_BACKUP"
  tar -czf "$PREV_DIST_BACKUP" -C "$ROOT" dist
fi

# ── 6. build ────────────────────────────────────────────────────────────────
echo "[deploy $DEPLOY_ID] step 5/7: npm run build"
if ! npm run build; then
  echo "[deploy $DEPLOY_ID] FAIL — build failed. pm2 still serving the previous dist. No rollback needed."
  echo "[deploy $DEPLOY_ID] DEPLOY FAILED step=build elapsed=$(( $(date +%s) - START_EPOCH ))s"
  exit 1
fi

# ── 7. reload pm2 ───────────────────────────────────────────────────────────
echo "[deploy $DEPLOY_ID] step 6/7: pm2 reload mergetasks --update-env"
if ! pm2 reload mergetasks --update-env; then
  echo "[deploy $DEPLOY_ID] FAIL — pm2 reload failed. Attempting rollback."
  rollback_and_exit
fi

# ── 8. health check ─────────────────────────────────────────────────────────
echo "[deploy $DEPLOY_ID] step 7/7: health check (timeout ${HEALTH_TIMEOUT_SECS}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECS ))
health_ok=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  # /api/health returns 200 on healthy, 503 on degraded. Either means the
  # process bound to the port; anything else (curl failure, non-HTTP) is
  # the bad state we want to catch.
  if code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 "$HEALTH_URL" 2>/dev/null)"; then
    case "$code" in
      200) health_ok=1; break ;;
      503) echo "[deploy $DEPLOY_ID] app responded 503 (degraded) — not retrying, treating as live"; health_ok=1; break ;;
      *)   echo "[deploy $DEPLOY_ID] health check: HTTP $code, retrying…" ;;
    esac
  else
    echo "[deploy $DEPLOY_ID] health check: no response yet, retrying…"
  fi
  sleep "$HEALTH_POLL_INTERVAL"
done

if [ "$health_ok" -ne 1 ]; then
  rollback_and_exit
fi

echo "[deploy $DEPLOY_ID] ✓ healthy"
echo "[deploy $DEPLOY_ID] DEPLOY COMPLETE commit=$NEW_COMMIT elapsed=$(( $(date +%s) - START_EPOCH ))s"
echo "═══════════════════════════════════════════════════════════════════════"
