#!/usr/bin/env bash
# Despliega el dashboard a qhaway.org (VPS, servido por Caddy desde /var/www/qhaway).
# NO toca Caddy: el docroot sigue siendo /var/www/qhaway (directorio real, no symlink).
#
# Flujo (sin ventana con el sitio vacío):
#   1. Local: lint + typecheck + build con base '/'.
#   2. Sube el tar y lo extrae en una RELEASE nueva: /var/www/qhaway-releases/<timestamp>.
#   3. Sincroniza esa release sobre /var/www/qhaway con
#        rsync --delay-updates --delete-after
#      Los archivos nuevos se escriben como temporales y se renombran todos al final; lo
#      que sobra se borra al terminar. Nunca queda el docroot vacío ni a medio copiar.
#   4. Conserva las últimas $KEEP releases para volver atrás.
#
# Uso:
#   ./deploy-vps.sh                 # build + deploy
#   ./deploy-vps.sh --list          # lista releases en el VPS
#   ./deploy-vps.sh --rollback      # vuelve a la release anterior a la actual
#   ./deploy-vps.sh --rollback TS   # vuelve a la release <TS> (ver --list)
#
# Variables opcionales: VPS (user@host), KEY (llave ssh), KEEP (releases a conservar).
set -euo pipefail

VPS=${VPS:-root@217.15.168.100}
KEY=${KEY:-~/.ssh/id_ed25519}
KEEP=${KEEP:-5}
WWW=/var/www/qhaway
RELEASES=/var/www/qhaway-releases
# accept-new: acepta la huella la primera vez y FALLA si después cambia (con
# StrictHostKeyChecking=no un MITM pasaba sin aviso).
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes)

cd "$(dirname "$0")"

# Ejecuta un script en el VPS con bash (vía stdin: no depende del shell de login).
remote() { ssh "${SSH_OPTS[@]}" "$VPS" bash -s <<<"$1"; }

# Sincroniza una release ya extraída en el VPS sobre el docroot y marca cuál está activa.
activate() {
  local ts=$1
  remote "set -euo pipefail
    command -v rsync >/dev/null || { echo '  ✗ falta rsync en el VPS (apt install rsync)'; exit 1; }
    test -f '$RELEASES/$ts/index.html' || { echo '  ✗ release $ts no existe o no tiene index.html'; exit 1; }
    mkdir -p '$WWW'
    rsync -a --checksum --delay-updates --delete-after '$RELEASES/$ts/' '$WWW/'
    echo '$ts' > '$RELEASES/CURRENT'
    echo \"  OK: release $ts activa (\$(ls '$WWW' | wc -l) entradas)\""
}

verify() {
  echo "▸ verificando https://qhaway.org…"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://qhaway.org/ || true)
  echo "  qhaway.org -> $code"
  if [ "$code" != "200" ]; then
    echo "✗ qhaway.org no responde 200. Para volver atrás: ./deploy-vps.sh --rollback" >&2
    exit 1
  fi
}

case "${1:-}" in
  --list)
    remote "ls -1 '$RELEASES' 2>/dev/null | grep -v CURRENT || true; echo \"activa: \$(cat '$RELEASES/CURRENT' 2>/dev/null || echo '?')\""
    exit 0
    ;;
  --rollback)
    TARGET=${2:-}
    if [ -z "$TARGET" ]; then
      # La anterior a la activa (releases ordenadas por nombre = por fecha).
      TARGET=$(remote "cur=\$(cat '$RELEASES/CURRENT' 2>/dev/null || true)
        ls -1 '$RELEASES' | grep -E '^[0-9]{8}-[0-9]{6}\$' | sort | awk -v c=\"\$cur\" '\$0==c{print p; exit} {p=\$0}'")
      [ -n "$TARGET" ] || { echo "✗ no hay release anterior a la activa (usa --list)" >&2; exit 1; }
    fi
    echo "▸ rollback a ${TARGET}…"
    activate "$TARGET"
    verify
    echo "✓ rollback hecho"
    exit 0
    ;;
  "") ;;
  *) echo "uso: $0 [--list | --rollback [TS]]" >&2; exit 2 ;;
esac

TS=$(date +%Y%m%d-%H%M%S)
TGZ=/tmp/qhaway-dist-$TS.tgz

echo "▸ lint…"
npm run lint
echo "▸ typecheck (tsc -b)…"
npx tsc -b
echo "▸ build (VITE_BASE=/)…"
VITE_BASE=/ npx vite build >/dev/null
test -f dist/index.html || { echo "✗ build sin dist/index.html" >&2; exit 1; }

echo "▸ empaquetando…"
tar -czf "$TGZ" -C dist .

echo "▸ subiendo release ${TS}…"
scp "${SSH_OPTS[@]}" "$TGZ" "$VPS:$TGZ"
remote "set -euo pipefail
  # Primer deploy con este esquema: guarda el sitio actual como release inicial para
  # poder volver atrás también desde la primera vez.
  if [ ! -f '$RELEASES/CURRENT' ] && [ -f '$WWW/index.html' ]; then
    mkdir -p '$RELEASES/00000000-000000'
    rsync -a '$WWW/' '$RELEASES/00000000-000000/' 2>/dev/null || cp -a '$WWW/.' '$RELEASES/00000000-000000/'
    echo '00000000-000000' > '$RELEASES/CURRENT'
    echo '  (sitio previo guardado como release 00000000-000000)'
  fi
  mkdir -p '$RELEASES/$TS'
  tar -xzf '$TGZ' -C '$RELEASES/$TS'
  rm -f '$TGZ'"
rm -f "$TGZ"

echo "▸ activando (rsync atómico sobre $WWW)…"
activate "$TS"

echo "▸ podando releases (se conservan $KEEP)…"
remote "cd '$RELEASES' && ls -1 | grep -E '^[0-9]{8}-[0-9]{6}\$' | sort -r | tail -n +$((KEEP + 1)) | xargs -r rm -rf --"

verify
echo "✓ desplegado (release $TS). Volver atrás: ./deploy-vps.sh --rollback"
