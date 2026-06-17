#!/usr/bin/env bash
# Despliega el dashboard a qhaway.org (VPS, servido por Caddy desde /var/www/qhaway).
# Build con base '/' → tar → scp → extrae en el VPS. NO toca Caddy (ya configurado).
set -euo pipefail
VPS=root@217.15.168.100
KEY=~/.ssh/id_ed25519
cd "$(dirname "$0")"
echo "▸ build (VITE_BASE=/)…"
VITE_BASE=/ npm run build >/dev/null
echo "▸ empaquetando…"
tar -czf /tmp/qhaway-dist.tgz -C dist .
echo "▸ subiendo y extrayendo en /var/www/qhaway…"
scp -i "$KEY" -o StrictHostKeyChecking=no /tmp/qhaway-dist.tgz "$VPS":/tmp/qhaway-dist.tgz
ssh -i "$KEY" "$VPS" 'rm -rf /var/www/qhaway/* && tar -xzf /tmp/qhaway-dist.tgz -C /var/www/qhaway && echo "  OK: $(ls /var/www/qhaway | wc -l) entradas"'
echo "▸ verificando https://qhaway.org…"
curl -s -o /dev/null -w "  qhaway.org -> %{http_code}\n" --max-time 15 https://qhaway.org/
echo "✓ desplegado"
