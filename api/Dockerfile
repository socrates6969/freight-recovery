# API image (build context = repository root). Multi-stage:
#   build   - npm ci --ignore-scripts, explicit prisma generate + tsc builds
#   migrate - build stage + Prisma CLI, runs `prisma migrate deploy` (owner role) and exits
#   runtime - production deps only, non-root uid 10001, read-only-rootfs compatible, no secrets baked in
# Base images are pinned by digest; refresh on a schedule.

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
ENV CI=true NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY api api
RUN npm run prisma:generate \
 && npm run build -w packages/shared \
 && npm run build -w api

FROM build AS migrate
# Fetch the schema engine for this platform at build time (install scripts are disabled).
RUN npx prisma --version >/dev/null
USER node
CMD ["npx", "prisma", "migrate", "deploy", "--config", "api/prisma.config.ts"]

FROM build AS prune
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prune /app/package.json ./package.json
COPY --from=prune /app/node_modules ./node_modules
COPY --from=prune /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=prune /app/packages/shared/dist ./packages/shared/dist
COPY --from=prune /app/api/package.json ./api/package.json
COPY --from=prune /app/api/dist ./api/dist
COPY --from=prune /app/api/prisma ./api/prisma
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app
USER 10001:10001
WORKDIR /app/api
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/server.js"]
