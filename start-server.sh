#!/bin/bash
cd /home/ubuntu/mergetasks
set -a
source /home/ubuntu/mergetasks/.env
set +a
for VAR in SESSION_SECRET DATABASE_URL; do
  if [ -z "${!VAR}" ]; then
    echo "FATAL: Missing required env var: $VAR" >&2
    exit 1
  fi
done
echo "[startup] All critical env vars verified. Starting server..."
exec /home/ubuntu/.nvm/versions/node/v20.20.2/bin/node /home/ubuntu/mergetasks/dist/index.js
