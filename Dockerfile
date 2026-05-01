# syntax=docker/dockerfile:1
# Production image: Vite client → dist/public, Express API → dist/index.js
FROM node:20-bookworm AS base
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_APP_ID=mergetasks
ENV VITE_APP_ID=${VITE_APP_ID}
ENV NODE_ENV=production
# Full install (no prune): esbuild bundles the server with --packages=external, so
# any static import from dev-only packages (e.g. vite in server/_core/vite.ts) must
# still exist in node_modules at runtime. Pruning devDependencies breaks production boot.
RUN pnpm build

FROM base AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends default-mysql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.sh ./scripts/migrate.sh
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh scripts/migrate.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
