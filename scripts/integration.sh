#!/usr/bin/env bash
# Teste de integração da Fase 2: levanta o stack real (imagens oficiais) num ambiente limpo
# e verifica, pela API de cada serviço, que ficou tudo ligado sem intervenção.
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="${CAIS_IT_DIR:-$HOME/cais-it}" # tem de estar num caminho partilhado com a VM do Docker
PROJECT=caistest
PORT=18088
COMPOSE=(docker compose -f deploy/docker-compose.yml --env-file "$WORK/.env" -p "$PROJECT")
fail() { echo "FALHOU: $*" >&2; exit 1; }
cleanup() { "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true; }

docker build -q -t cais:dev . >/dev/null
mkdir -p "$WORK"
cleanup
docker run --rm -v "$WORK:/w" alpine sh -c 'rm -rf /w/cfg /w/data; mkdir /w/cfg /w/data'
cat >"$WORK/.env" <<ENV
CAIS_IMAGE=cais:dev
CONFIG_ROOT=$WORK/cfg
DATA_ROOT=$WORK/data
CAIS_PORT=$PORT
TORRENT_PORT=16882
ENV
trap cleanup EXIT

"${COMPOSE[@]}" up -d >/dev/null
echo "à espera do primeiro reconcile..."
for _ in $(seq 1 40); do
  R=$(curl -s "localhost:$PORT/api/reconcile" || true)
  if grep -q '"lastRun":"' <<<"$R" && grep -q '"error":null' <<<"$R"; then break; fi
  sleep 6
done
grep -q '"error":null' <<<"$R" || fail "reconcile não terminou sem erros: $R"

api() { docker exec cais wget -qO- "${@:2}" "$1"; }
key() { cat "$WORK/cfg/cais/secrets/$1"; }
H() { echo "--header=X-Api-Key: $(key "$1.key")"; }

# 1. Cada serviço aceita a chave gerada
for s in sonarr:8989:v3 radarr:7878:v3 prowlarr:9696:v1; do
  IFS=: read -r n p v <<<"$s"
  api "http://$n:$p/api/$v/system/status" "$(H "$n")" | grep -q '"appName"' || fail "$n não aceita a chave"
done
# 2. Sonarr/Radarr têm qBittorrent e root folders
api http://sonarr:8989/api/v3/downloadclient "$(H sonarr)" | grep -q 'Cais qBittorrent' || fail "Sonarr sem qBittorrent"
api http://radarr:7878/api/v3/downloadclient "$(H radarr)" | grep -q 'Cais qBittorrent' || fail "Radarr sem qBittorrent"
api http://sonarr:8989/api/v3/rootfolder "$(H sonarr)" | grep -q '/data/media/tv' || fail "Sonarr sem root folder"
api http://radarr:7878/api/v3/rootfolder "$(H radarr)" | grep -q '/data/media/movies' || fail "Radarr sem root folder"
# 3. Prowlarr tem Sonarr, Radarr e o proxy Byparr
APPS=$(api http://prowlarr:9696/api/v1/applications "$(H prowlarr)")
grep -q 'Cais Sonarr' <<<"$APPS" && grep -q 'Cais Radarr' <<<"$APPS" || fail "Prowlarr sem apps"
api http://prowlarr:9696/api/v1/indexerProxy "$(H prowlarr)" | grep -q 'http://byparr:8191/' || fail "Prowlarr sem proxy Byparr"
# 4. Bazarr ligado aos dois
api http://bazarr:6767/api/system/settings "--header=X-API-KEY: $(key bazarr.key)" |
  python3 -c "import sys,json;d=json.load(sys.stdin);assert d['general']['use_sonarr'] and d['general']['use_radarr'] and d['sonarr']['ip']=='sonarr' and d['radarr']['ip']=='radarr'" ||
  fail "Bazarr não está ligado ao Sonarr/Radarr"
# 5. Idempotência: o segundo reconcile não altera nada
R2=$(curl -s -X POST "localhost:$PORT/api/reconcile")
grep -qE '"result":"(created|updated)"' <<<"$R2" && fail "segundo reconcile alterou algo: $R2"

echo "OK: stack ligado e idempotente"
