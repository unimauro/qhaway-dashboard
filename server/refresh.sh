#!/usr/bin/env bash
# Actualización mensual de QHAWAY en el VPS (cron: 30 4 1 * * /opt/qhaway-api/refresh.sh).
#   1. Construye la imagen qhaway-loader si no existe (antes fallaba con "pull access denied").
#   2. Carga el año en curso y el anterior desde el ZIP anual del MEF (salta si no cambió).
#   3. Recarga los JSON temáticos de /opt/qhaway-api/data (programas, clima, riesgos, cortes…).
#   4. Reinicia la API para vaciar su caché en memoria.
# Uso manual:  /opt/qhaway-api/refresh.sh                 # año actual + anterior
#              /opt/qhaway-api/refresh.sh 2026 2025 2024  # años concretos
#              LOADER_ARGS=--force /opt/qhaway-api/refresh.sh 2026
#              REBUILD=1 /opt/qhaway-api/refresh.sh       # reconstruye la imagen aunque exista
# Log: /opt/qhaway-api/logs/refresh-AAAA-MM-DD.log  ·  resumen: /opt/qhaway-api/logs/refresh.log
set -uo pipefail

BASE=${QHAWAY_BASE:-/opt/qhaway-api}
NET=qhaway_net
IMG=qhaway-loader
LOGDIR="$BASE/logs"
mkdir -p "$LOGDIR" "$BASE/work"
LOG="$LOGDIR/refresh-$(date +%F).log"
exec >>"$LOG" 2>&1

# Una sola corrida a la vez.
exec 9>"$BASE/work/.refresh.lock"
if ! flock -n 9; then echo "$(date -Is) otra corrida en curso → salgo"; exit 0; fi

YEAR=$(date +%Y)
YEARS=${*:-"$YEAR $((YEAR - 1))"}
PGPASS=$(grep -E '^POSTGRES_PASSWORD=' "$BASE/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'")
DBURL="postgresql://qhaway:${PGPASS:-qhaway_local}@qhaway-db:5432/qhaway"
estado=OK
falla() { if [ "$estado" = OK ]; then estado=$1; else estado="$estado,$1"; fi; }

echo "===== $(date -Is) refresh años: $YEARS ${LOADER_ARGS:-}"

if [ "${REBUILD:-0}" = 1 ] || ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "--- build $IMG"
  docker build -t "$IMG" "$BASE/loader" || { echo "ERROR build"; falla BUILD; }
fi

if [ "$estado" = OK ]; then
  echo "--- carga MEF (ZIP)"
  # shellcheck disable=SC2086
  docker run --rm --name qhaway-loader-run --network "$NET" \
    -e DATABASE_URL="$DBURL" -e QHAWAY_TMP=/work -v "$BASE/work:/work" \
    "$IMG" ${LOADER_ARGS:-} $YEARS || falla CARGA

  if ls "$BASE"/data/*.json >/dev/null 2>&1; then
    echo "--- carga temática (JSON de $BASE/data)"
    docker run --rm --network "$NET" -e DATABASE_URL="$DBURL" -e DATA_DIR=/data \
      -v "$BASE/data:/data:ro" --entrypoint python "$IMG" load_tematico.py \
      || falla TEMATICO
  fi

  echo "--- restart API (vacía caché)"
  docker restart qhaway-api >/dev/null || falla RESTART
  sleep 5
  curl -s --max-time 20 http://127.0.0.1:8000/api/meta | head -c 600; echo
fi

echo "===== $(date -Is) fin: $estado"
echo "$(date -Is) años=[$YEARS] estado=$estado log=$LOG" >>"$LOGDIR/refresh.log"
[ "$estado" = OK ]
