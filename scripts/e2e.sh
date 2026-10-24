#!/usr/bin/env bash
# E2E (critério 5): levanta o stack real + Jellyfin + indexador falso, corre o Playwright
# (wizard → pedido de um filme → fila do Radarr) e desfaz tudo. Não descarrega conteúdo real.
set -euo pipefail
cd "$(dirname "$0")/.."

export MEDIASTACK_IT_DIR="${MEDIASTACK_IT_DIR:-$HOME/mediastack-it}"
WORK="$MEDIASTACK_IT_DIR"
COMPOSE=(docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.test.yml --env-file "$WORK/.env" -p mediastacktest)
cleanup() { "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true; }

docker build -q -t mediastack:dev . >/dev/null
mkdir -p "$WORK"
cleanup
docker run --rm -v "$WORK:/w" alpine sh -c 'rm -rf /w/cfg /w/data; mkdir /w/cfg /w/data'
cat >"$WORK/.env" <<ENV
MEDIASTACK_IMAGE=mediastack:dev
CONFIG_ROOT=$WORK/cfg
DATA_ROOT=$WORK/data
MEDIASTACK_PORT=18088
TORRENT_PORT=16882
ENV
[ -n "${KEEP:-}" ] || trap cleanup EXIT
"${COMPOSE[@]}" up -d >/dev/null

JF=localhost:18096
for _ in $(seq 1 60); do [ "$(curl -s $JF/health)" = Healthy ] && break; sleep 3; done
JH='Content-Type: application/json'
curl -sf -X POST -H "$JH" -d '{"UICulture":"pt-PT","MetadataCountryCode":"PT","PreferredMetadataLanguage":"pt"}' $JF/Startup/Configuration
curl -sf $JF/Startup/User >/dev/null
curl -sf -X POST -H "$JH" -d '{"Name":"admin","Password":"jf-password-123"}' $JF/Startup/User
curl -sf -X POST -H "$JH" -d '{"EnableRemoteAccess":true,"EnableAutomaticPortMapping":false}' $JF/Startup/RemoteAccess
curl -sf -X POST $JF/Startup/Complete
for _ in $(seq 1 150); do curl -sf localhost:18088/healthz >/dev/null && break; sleep 2; done
curl -sf localhost:18088/healthz >/dev/null || { echo 'o MediaStack não ficou disponível em 5 min' >&2; "${COMPOSE[@]}" logs --tail 40 mediastack mediastack-init >&2; exit 1; }

npx -y pnpm@10.18.3 exec playwright test -c e2e/playwright.config.ts "$@"
