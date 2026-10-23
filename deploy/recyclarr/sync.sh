#!/bin/sh
# Corre dentro do container oficial do Recyclarr. O Cais escreve /config/request.env e cria
# /config/sync.trigger; este script cria as configs a partir dos templates TRaSH oficiais,
# preenche URL e chave, corre `recyclarr sync` e deixa o resultado em /config/last-sync.txt.
set -u
CFG=/config
log() { echo "[cais-recyclarr] $*"; }

do_sync() {
  # shellcheck disable=SC1091
  . "$CFG/request.env"
  rm -rf "$CFG/configs"
  mkdir -p "$CFG/configs"
  ok=1
  for t in ${RADARR_TEMPLATES:-}; do
    recyclarr config create -t "$t" -p "$CFG/configs" >/dev/null 2>&1 || ok=0
    sed -i "s|base_url: .*|base_url: $RADARR_URL|; s|api_key: .*|api_key: $RADARR_KEY|" "$CFG/configs/$t.yml" || ok=0
  done
  for t in ${SONARR_TEMPLATES:-}; do
    recyclarr config create -t "$t" -p "$CFG/configs" >/dev/null 2>&1 || ok=0
    sed -i "s|base_url: .*|base_url: $SONARR_URL|; s|api_key: .*|api_key: $SONARR_KEY|" "$CFG/configs/$t.yml" || ok=0
  done
  if [ "$ok" = 1 ] && recyclarr sync >"$CFG/last-sync.log" 2>&1; then
    status=ok
  else
    status=error
  fi
  # Nunca deixa a chave em claro no log.
  sed -i "s|$RADARR_KEY|***|g; s|$SONARR_KEY|***|g" "$CFG/last-sync.log" 2>/dev/null || true
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$status" >"$CFG/last-sync.txt"
  log "sync: $status"
}

log "à espera de pedidos em $CFG/sync.trigger"
while true; do
  if [ -f "$CFG/sync.trigger" ] && [ -f "$CFG/request.env" ]; then
    rm -f "$CFG/sync.trigger"
    do_sync
  fi
  sleep 5
done
