#!/bin/sh
# Corre dentro do container oficial do Recyclarr. O MediaStack escreve /config/request.env e cria
# /config/sync.trigger; este script cria as configs a partir dos templates TRaSH oficiais,
# preenche URL e chave, corre `recyclarr sync` e deixa o resultado em /config/last-sync.txt.
set -u
CFG=/config
log() { echo "[mediastack-recyclarr] $*"; }

do_sync() {
  # shellcheck disable=SC1091
  . "$CFG/request.env"
  rm -rf "$CFG/configs"
  mkdir -p "$CFG/configs"
  ok=1
  # Nunca apagar custom formats: o Recyclarr guarda o estado por servidor e, com várias configs
  # para o mesmo servidor (perfis + nomes), a limpeza de uma apagava os formatos da outra.
  printf '    delete_old_custom_formats: false\n' >"$CFG/keep.snippet"
  for t in ${RADARR_TEMPLATES:-}; do
    recyclarr config create -t "$t" -p "$CFG/configs" >/dev/null 2>&1 || ok=0
    sed -i "s|base_url: .*|base_url: $RADARR_URL|; s|api_key: .*|api_key: $RADARR_KEY|" "$CFG/configs/$t.yml" || ok=0
    sed -i "/^    api_key:/r $CFG/keep.snippet" "$CFG/configs/$t.yml" || ok=0
  done
  for t in ${SONARR_TEMPLATES:-}; do
    recyclarr config create -t "$t" -p "$CFG/configs" >/dev/null 2>&1 || ok=0
    sed -i "s|base_url: .*|base_url: $SONARR_URL|; s|api_key: .*|api_key: $SONARR_KEY|" "$CFG/configs/$t.yml" || ok=0
    sed -i "/^    api_key:/r $CFG/keep.snippet" "$CFG/configs/$t.yml" || ok=0
  done
  # Esquema de nomes (TRaSH): configs próprias, só se não for `keep`.
  if [ -n "${RADARR_NAMING:-}" ]; then
    cat >"$CFG/configs/naming-radarr.yml" <<YML
radarr:
  naming:
    base_url: $RADARR_URL
    api_key: $RADARR_KEY
    delete_old_custom_formats: false
    media_naming:
      folder: $RADARR_NAMING
      movie:
        rename: true
        standard: $RADARR_NAMING
YML
  fi
  if [ -n "${SONARR_NAMING_SERIES:-}" ]; then
    cat >"$CFG/configs/naming-sonarr.yml" <<YML
sonarr:
  naming:
    base_url: $SONARR_URL
    api_key: $SONARR_KEY
    delete_old_custom_formats: false
    media_naming:
      series: $SONARR_NAMING_SERIES
      season: default
      episodes:
        rename: true
        standard: default
        daily: default
        anime: default
YML
  fi
  # Uma invocação por ficheiro: com várias instâncias para o mesmo servidor, `recyclarr sync`
  # (sem --config) agrupa-as e não sincroniza nenhuma.
  : >"$CFG/last-sync.log"
  if [ "$ok" = 1 ]; then
    for f in "$CFG"/configs/*.yml; do
      [ -f "$f" ] || continue
      recyclarr sync --config "$f" >>"$CFG/last-sync.log" 2>&1 || ok=0
    done
  fi
  if [ "$ok" = 1 ]; then
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
