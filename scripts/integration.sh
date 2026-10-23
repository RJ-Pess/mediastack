#!/usr/bin/env bash
# Teste de integração da Fase 2: levanta o stack real (imagens oficiais) num ambiente limpo
# e verifica, pela API de cada serviço, que ficou tudo ligado sem intervenção.
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="${MEDIASTACK_IT_DIR:-$HOME/mediastack-it}" # tem de estar num caminho partilhado com a VM do Docker
PROJECT=mediastacktest
PORT=18088
SEERR_PORT=15055
COMPOSE=(docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.test.yml --env-file "$WORK/.env" -p "$PROJECT")
fail() {
  echo "FALHOU: $*" >&2
  "${COMPOSE[@]}" ps >&2 || true
  "${COMPOSE[@]}" logs --tail 40 mediastack mediastack-init >&2 || true
  exit 1
}
cleanup() { "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true; }

docker build -q -t mediastack:dev . >/dev/null
mkdir -p "$WORK"
cleanup
docker run --rm -v "$WORK:/w" alpine sh -c 'rm -rf /w/cfg /w/data; mkdir /w/cfg /w/data'
cat >"$WORK/.env" <<ENV
MEDIASTACK_IMAGE=mediastack:dev
CONFIG_ROOT=$WORK/cfg
DATA_ROOT=$WORK/data
MEDIASTACK_PORT=$PORT
TORRENT_PORT=16882
ENV
[ -n "${KEEP:-}" ] || trap cleanup EXIT

"${COMPOSE[@]}" up -d >/dev/null
JAR="$WORK/cookies.txt"
c() { curl -s -b "$JAR" -c "$JAR" -H 'Content-Type: application/json' "$@"; }
for _ in $(seq 1 150); do curl -sf "localhost:$PORT/healthz" >/dev/null && break; sleep 2; done
curl -sf "localhost:$PORT/healthz" >/dev/null || fail "o MediaStack não ficou disponível em 5 min"
# 0. Sem sessão a API está fechada; o setup cria o admin e abre a sessão
[ "$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/api/plan")" = 401 ] || fail "API acessível sem login"
c -X POST -d '{"username":"admin","password":"password-de-teste-123"}' "localhost:$PORT/api/auth/setup" | grep -q '"user":"admin"' || fail "setup do admin falhou"
echo "à espera do primeiro reconcile..."
for _ in $(seq 1 40); do
  R=$(c "localhost:$PORT/api/reconcile" || true)
  if grep -q '"lastRun":"' <<<"$R" && grep -q '"error":null' <<<"$R"; then break; fi
  sleep 6
done
grep -q '"error":null' <<<"$R" || fail "reconcile não terminou sem erros: $R"

json() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
api() { docker exec mediastack wget -qO- "${@:2}" "$1"; }
key() { cat "$WORK/cfg/mediastack/secrets/$1"; }
H() { echo "--header=X-Api-Key: $(key "$1.key")"; }

# O estado por omissão é aplicado a seguir ao reconcile e inclui esperar pelo Recyclarr (TRaSH,
# via GitHub). Espera até o plano convergir.
for _ in $(seq 1 90); do
  c "localhost:$PORT/api/plan" | json "import sys;sys.exit(0 if d['changes']==[] and d['errors']==[] else 1)" 2>/dev/null && break
  sleep 5
done
c "localhost:$PORT/api/plan" | json "assert d['changes']==[] and d['errors']==[], d" || fail "o plano inicial não convergiu: $(c "localhost:$PORT/api/plan") audit: $(c "localhost:$PORT/api/audit")"
c "localhost:$PORT/api/audit" | grep -q '"status":"error"' && fail "apply inicial com erros: $(c "localhost:$PORT/api/audit")"

# 1. Cada serviço aceita a chave gerada
for s in sonarr:8989:v3 radarr:7878:v3 prowlarr:9696:v1; do
  IFS=: read -r n p v <<<"$s"
  api "http://$n:$p/api/$v/system/status" "$(H "$n")" | grep -q '"appName"' || fail "$n não aceita a chave"
done
# 2. Sonarr/Radarr têm qBittorrent e root folders
api http://sonarr:8989/api/v3/downloadclient "$(H sonarr)" | grep -c 'MediaStack qBittorrent' >/dev/null || fail "Sonarr sem qBittorrent"
api http://radarr:7878/api/v3/downloadclient "$(H radarr)" | grep -c 'MediaStack qBittorrent' >/dev/null || fail "Radarr sem qBittorrent"
api http://sonarr:8989/api/v3/rootfolder "$(H sonarr)" | grep -c '/data/media/tv' >/dev/null || fail "Sonarr sem root folder"
api http://radarr:7878/api/v3/rootfolder "$(H radarr)" | grep -c '/data/media/movies' >/dev/null || fail "Radarr sem root folder"
# 3. Prowlarr tem Sonarr, Radarr e o proxy Byparr
APPS=$(api http://prowlarr:9696/api/v1/applications "$(H prowlarr)")
grep -q 'MediaStack Sonarr' <<<"$APPS" && grep -q 'MediaStack Radarr' <<<"$APPS" || fail "Prowlarr sem apps"
api http://prowlarr:9696/api/v1/indexerProxy "$(H prowlarr)" | grep -c 'http://byparr:8191/' >/dev/null || fail "Prowlarr sem proxy Byparr"
# 4. Bazarr ligado aos dois
api http://bazarr:6767/api/system/settings "--header=X-API-KEY: $(key bazarr.key)" |
  python3 -c "import sys,json;d=json.load(sys.stdin);assert d['general']['use_sonarr'] and d['general']['use_radarr'] and d['sonarr']['ip']=='sonarr' and d['radarr']['ip']=='radarr'" ||
  fail "Bazarr não está ligado ao Sonarr/Radarr"
# 5. Idempotência: o segundo reconcile não altera nada
R2=$(c -X POST -d '{}' "localhost:$PORT/api/reconcile")
grep -qE '"result":"(created|updated)"' <<<"$R2" && fail "segundo reconcile alterou algo: $R2"

# 5b. O estado por omissão foi aplicado no arranque: perfil MediaStack (pt, en) é o perfil por omissão
BPROF() { api http://bazarr:6767/api/system/languages/profiles "--header=X-API-KEY: $(key bazarr.key)"; }
BPROF | json "p=[x for x in d if x['name']=='MediaStack'];assert [i['language'] for i in p[0]['items']]==['pt','en'], d" || fail "perfil MediaStack do Bazarr em falta"

# 5c. Perfis TRaSH criados pelo Recyclarr no Sonarr e no Radarr
api http://radarr:7878/api/v3/qualityprofile "$(H radarr)" | grep -c 'HD Bluray + WEB' >/dev/null || fail "Radarr sem o perfil TRaSH 'HD Bluray + WEB'"
api http://sonarr:8989/api/v3/qualityprofile "$(H sonarr)" | grep -c 'WEB-1080p' >/dev/null || fail "Sonarr sem o perfil TRaSH 'WEB-1080p'"

# 6. Plan/apply: mudar a categoria e um limite no MediaStack altera o valor real nos serviços
MEDIASTACK="localhost:$PORT"
D=$(c "$MEDIASTACK/api/desired" | json "d['downloads']['categories']['tv']='series';d['downloads']['downKiBps']=2048;d['subtitles']['languages']=['pt','pb'];print(json.dumps(d))")
c -X PUT -d "$D" "$MEDIASTACK/api/desired" >/dev/null
PLAN=$(c "$MEDIASTACK/api/plan")
echo "$PLAN" | json "assert {c['fieldId'] for c in d['changes']}>={'sonarr.downloadclient.category','qbittorrent.limit.down'}, d" || fail "plan sem as alterações esperadas: $PLAN"
c -X POST -d '{}' "$MEDIASTACK/api/apply" | json "assert not d['failed'], d" || fail "apply falhou"
api http://sonarr:8989/api/v3/downloadclient "$(H sonarr)" | grep -c '"value": "series"' >/dev/null || fail "categoria não mudou no Sonarr"
BPROF | json "p=[x for x in d if x['name']=='MediaStack'];assert [i['language'] for i in p[0]['items']]==['pt','pb'], d" || fail "idiomas não mudaram no Bazarr"
c "$MEDIASTACK/api/plan" | json "assert d['changes']==[] and d['errors']==[], d" || fail "segundo plan não está vazio"

# 7. Drift: alteração direta no qBittorrent é detetada
QB="http://qbittorrent:8080/api/v2"
SID=$(docker exec mediastack wget -S -qO- --post-data="username=mediastack&password=$(key qbittorrent.password)" "$QB/auth/login" 2>&1 | sed -n 's/.*set-cookie: \([^;]*\).*/\1/Ip' | head -1)
docker exec mediastack wget -qO- --header="Cookie: $SID" --post-data='json={"up_limit":524288}' "$QB/app/setPreferences" >/dev/null
c "$MEDIASTACK/api/drift" | json "assert [c['fieldId'] for c in d['changes']]==['qbittorrent.limit.up'], d" || fail "drift não detetado"
c -X POST -d '{"fieldId":"qbittorrent.limit.up"}' "$MEDIASTACK/api/drift/adopt" | json "assert d['downloads']['upKiBps']==512, d" || fail "adopt falhou"
c "$MEDIASTACK/api/drift" | json "assert d['changes']==[], d" || fail "drift persiste depois de adotar"

# 7b. Seerr: o setup nunca passa pela página /setup; completa-se com o admin do Jellyfin
JF=localhost:18096
for _ in $(seq 1 60); do [ "$(curl -s $JF/health)" = Healthy ] && break; sleep 3; done
[ "$(curl -s $JF/health)" = Healthy ] || fail "Jellyfin não ficou saudável"
JH='Content-Type: application/json'
curl -sf -X POST -H "$JH" -d '{"UICulture":"pt-PT","MetadataCountryCode":"PT","PreferredMetadataLanguage":"pt"}' $JF/Startup/Configuration
curl -sf $JF/Startup/User >/dev/null
curl -sf -X POST -H "$JH" -d '{"Name":"admin","Password":"jf-password-123"}' $JF/Startup/User
curl -sf -X POST -H "$JH" -d '{"EnableRemoteAccess":true,"EnableAutomaticPortMapping":false}' $JF/Startup/RemoteAccess
curl -sf -X POST $JF/Startup/Complete
c "$MEDIASTACK/api/seerr" | json "assert d=={'initialized':False,'linked':False}, d" || fail "Seerr devia estar por inicializar"
c -X POST -d '{"hostname":"jellyfin","port":8096,"username":"admin","password":"jf-password-123"}' "$MEDIASTACK/api/seerr/setup" | json "assert d['error'] is None and any(s['step']=='Seerr → Sonarr' and s['result']=='created' for s in d['steps']), d" || fail "setup do Seerr falhou"
c "$MEDIASTACK/api/seerr" | json "assert d=={'initialized':True,'linked':True}, d" || fail "Seerr não ficou inicializado"
APPLY=$(c -X POST -d '{}' "$MEDIASTACK/api/apply")
json "assert not d['failed'], d" <<<"$APPLY" || fail "apply após ligar o Seerr falhou: $APPLY"
SK=$(python3 -c "import json;print(json.load(open('$WORK/cfg/seerr/settings.json'))['main']['apiKey'])")
for k in sonarr radarr; do
  curl -s -H "X-Api-Key: $SK" "localhost:$SEERR_PORT/api/v1/settings/$k" | grep -q 'MediaStack' || fail "Seerr sem $k"
done
curl -s -H "X-Api-Key: $SK" "localhost:$SEERR_PORT/api/v1/settings/radarr" | grep -q 'HD Bluray + WEB' || fail "Seerr sem o perfil TRaSH por omissão (Radarr)"
curl -s -H "X-Api-Key: $SK" "localhost:$SEERR_PORT/api/v1/settings/sonarr" | grep -q 'WEB-1080p' || fail "Seerr sem o perfil TRaSH por omissão (Sonarr)"
c -X POST -d '{}' "$MEDIASTACK/api/reconcile" | grep -qE '"result":"(created|updated)"' && fail "reconcile com Seerr não é idempotente"

# 7c. Indexadores: adicionar um público, desativar, confirmar no Prowlarr e remover
DEF=$(c "$MEDIASTACK/api/indexers" | json "print(next(a['definitionName'] for a in d['available'] if a['definitionName']=='yts' or True))")
NEW=$(c -X POST -d "{\"definitionName\":\"$DEF\"}" "$MEDIASTACK/api/indexers" | json "print(d['id'])") || fail "não adicionou o indexador $DEF"
api http://prowlarr:9696/api/v1/indexer "$(H prowlarr)" | grep -c "\"id\": $NEW" >/dev/null || fail "indexador não está no Prowlarr"
c -X POST -d '{"enable":false}' "$MEDIASTACK/api/indexers/$NEW/enabled" >/dev/null
api "http://prowlarr:9696/api/v1/indexer/$NEW" "$(H prowlarr)" | grep -c '"enable": false' >/dev/null || fail "indexador não foi desativado"
c -X DELETE "$MEDIASTACK/api/indexers/$NEW" | grep -q '"ok":true' || fail "remoção falhou"
c "$MEDIASTACK/api/indexers" | json "assert d['installed']==[], d" || fail "indexador ficou instalado depois de removido"

# 8. Hardlinks: o mount único funciona; dois mounts separados geram aviso (critério 4)
HL() { docker run --rm --user 0 "$@" mediastack:dev node dist/index.js hardlink-check /data/torrents /data/media; }
c -X POST -d "{}" "$MEDIASTACK/api/storage/hardlink-check" | json "assert all(x['ok'] for x in d), d" || fail "hardlinks falham no stack (mount único)"
docker volume create mediastack-hl-a >/dev/null; docker volume create mediastack-hl-b >/dev/null
OUT=$(HL -v mediastack-hl-a:/data/torrents -v mediastack-hl-b:/data/media || true)
docker volume rm mediastack-hl-a mediastack-hl-b >/dev/null
grep -q '"reason":"different_mounts"' <<<"$OUT" || fail "mount partido não foi detetado: $OUT"

echo "OK: ligações, login, plan/apply idempotente, drift e verificação de hardlinks"
