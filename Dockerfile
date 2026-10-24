# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Desativa a verificação de idade mínima de lançamento do pnpm (minimumReleaseAge),
# necessária para builds com pacotes publicados recentemente
# (ex.: baseline-browser-mapping, electron-to-chromium).
ENV npm_config_minimum_release_age=0
RUN pnpm install --frozen-lockfile \
 && pnpm -r build \
 && pnpm --filter @mediastack/server deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production MEDIASTACK_WEB_DIR=/app/web MEDIASTACK_DATA_DIR=/config PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/web/dist ./web
# Script do Recyclarr: o init copia-o para a pasta partilhada (sem montar ficheiros do repositório).
COPY --from=build /repo/deploy/recyclarr/sync.sh ./recyclarr/sync.sh
RUN mkdir /config && chown node:node /config
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/index.js"]
