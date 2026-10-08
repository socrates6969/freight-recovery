# Web image (build context = repository root): builds the SPA, serves it with an unprivileged nginx
# using web/nginx.conf (generated from web/security-headers.json) and reverse-proxies /api/ and /healthz
# to the api service so the browser sees one origin. Base images pinned by digest.

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
ENV CI=true NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY web web
RUN npm run build -w packages/shared \
 && npm run build -w web \
 && node web/tools/gen-nginx-conf.mjs --check

FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS runtime
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/nginx.conf
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/index.html"]
