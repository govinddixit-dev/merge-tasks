#!/bin/bash
# start-render-worker.sh — pm2 launcher for the nano-banana render worker.
# Mirrors start-server.sh but validates the additional env vars the worker
# needs (REDIS_URL for BullMQ, GEMINI_API_KEY for nano-banana).
cd /home/ubuntu/mergetasks
set -a
source /home/ubuntu/mergetasks/.env
set +a
for VAR in SESSION_SECRET DATABASE_URL REDIS_URL GEMINI_API_KEY; do
  if [ -z "${!VAR}" ]; then
    echo "FATAL: Missing required env var: $VAR" >&2
    exit 1
  fi
done
echo "[startup] All critical env vars verified. Starting webstore-render-worker..."
exec /home/ubuntu/.nvm/versions/node/v20.20.2/bin/node /home/ubuntu/mergetasks/dist/webstore-render-worker.js
