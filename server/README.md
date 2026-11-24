# QHAWAY — servidor (API + loader)

Stack en el VPS: `/opt/qhaway-api` (docker compose, proyecto `qhaway-api`).

| Pieza | Contenedor / imagen | Qué hace |
|---|---|---|
| PostgreSQL 16 | `qhaway-db` (red `qhaway_net`) | Datos agregados |
| API FastAPI (`api/main.py`) | `qhaway-api` / imagen `qhaway-api-qhaway-api` | `/api/*` detrás de Caddy (https://qhaway.org) |
| Loader MEF (`loader/load.py`) | imagen `qhaway-loader` (one-off) | ZIP anual del MEF → tablas `gasto_*` + `carga_log` |
| Loader temático (`loader/load_tematico.py`) | misma imagen | JSON de `data/` → programas, clima, mitigación, riesgos/El Niño, cortes |
| `refresh.sh` | cron `30 4 1 * *` | build si falta + carga año actual y anterior + temáticos + restart API |

En el VPS **no se tocan** al desplegar: `.env`, `raw/` (base de `gasto_cubo` y `res_*`),
`data/` (salvo copiar JSON nuevos), `loader/cubo_pilot.py`, `loader/build_resumenes.py`.

## Loader MEF (`loader/load.py`)

- Fuente: dataset «Presupuesto y Ejecución de Gasto». Los recursos se descubren con
  `POST https://datosabiertos.mef.gob.pe/Rest/PortalWebDatasetDetalle/v1.0/getDatasetDetalle`
  (`{"dataset":"presupuesto-y-ejecucion-de-gasto"}`); si el portal falla, se prueban por HEAD los nombres
  conocidos: `fs.datosabiertos.mef.gob.pe/datastorefiles/{año}-Gasto.zip` (≤2024) y
  `{año}-Gasto-Mensual.zip` (≥2025), de 0.3–0.7 GB. Si no hay ZIP o está corrupto, cae al `.csv` (~10 GB).
- Descarga reanudable con `curl -C -`; el ZIP se lee en streaming (`zipfile` + `io.TextIOWrapper`).
- Columnas por **nombre** de encabezado (`MONTO_PIA`, `NIVEL_GOBIERNO_NOMBRE`, …). Si falta una: error
  con la lista de faltantes y no se toca la DB.
- **Validación** antes de reemplazar un año: PIM nacional dentro de ±40 % del año anterior ya cargado,
  presencia de los 3 niveles de gobierno, ningún nombre vacío. Si falla, el año cargado queda intacto
  (todo el reemplazo va en una transacción).
- Cada carga registra `carga_log(ano, fuente_url, last_modified, filas, cargado_en)`; `last_modified` es el
  `Last-Modified` del archivo del MEF = **fecha de corte real**. `/api/meta` expone `lastUpdate`
  (máximo de esos cortes; nunca la fecha de hoy) y `cortes: {año: fecha}`.
- Si el archivo del MEF no cambió desde la última carga, el año se salta (usar `--force` para recargar).
- Opciones: `--force`, `--no-validate`, `--dry-run` (sin DB), `--migrate` (solo migraciones), `all`.
- Migraciones: `loader/migraciones/*.sql` se aplican en cada corrida (idempotentes).
  `001_pre2012.sql` crea `carga_log` y una vista de auditoría; **no borra datos**.
  La limpieza destructiva de <2012 está en `loader/manual/001b_pre2012_limpieza.sql` (a mano, con respaldo).

### Años < 2012
Las fases certificado/devengado/girado de 2004–2011 en `gasto_nacional` y `gasto_depto_hist` vienen de
`load_json.py` ← `serie-historica-oficial.json` / `por-departamento-historico.json` ← scraper de la Consulta
Amigable, que en esos años desalineaba columnas (Compromiso → «certificado», Avance % → «devengado» y
«girado»). La API devuelve `null` en esas fases para `ano < 2012` y omite 2005 (PIA 0, desalineado),
aunque no se haya corrido la limpieza. `load_json.py` ya inserta NULL para <2012.
**Ojo:** `load_json.py` reescribe `gasto_nacional`/`gasto_depto_hist` de **todos** los años del JSON:
no correrlo después de una carga por ZIP (pisaría el corte nuevo con el del JSON).

## Datos temáticos (`loader/load_tematico.py`)

| Archivo en `data/` | Tabla(s) | Endpoint (misma forma que el JSON) |
|---|---|---|
| `por-programa-historico.json` | `gasto_programa` | `/api/por-programa-historico?desde=&hasta=&code=` |
| `programa-territorio-clima.json` | `gasto_programa_depto` | `/api/programa-territorio-clima?desde=&hasta=&code=0068` |
| `clima-tematico.json` | `clima_tematico` | `/api/clima-tematico?desde=&hasta=` |
| `mitigacion-2021-2027.json` | `documento_json`, `mitigacion_serie` | `/api/mitigacion?desde=2021&hasta=2027` |
| `riesgos.json` | `documento_json`, `riesgo_region`, `nino_estado` | `/api/riesgos` |
| `cortes.json` | `corte_dataset` | `/api/cortes` |

Idempotente (por archivo, una transacción: borra los años del archivo y los reinserta). Si falta un
archivo, avisa y sigue. Sin filtros, cada endpoint devuelve el mismo contenido y orden que el archivo.

## Caché de la API
Los endpoints usan caché en memoria (TTL 15 min) y `Cache-Control`. Tras una carga:
`docker restart qhaway-api`, o `curl -X POST -H "X-Cache-Token: $CACHE_TOKEN" http://127.0.0.1:8000/api/admin/cache-clear`
(requiere `CACHE_TOKEN` en `.env`; sin él el endpoint responde 404).

## Despliegue en el VPS (paso a paso)

Desde la máquina local, en la raíz del repo (sin `--delete`: conserva `.env`, `raw/`, `data/`, `logs/`, `work/`
y los scripts extra de `loader/`):

```bash
rsync -av --exclude '.env' --exclude 'raw/' --exclude 'data/' --exclude '__pycache__/' \
  server/ root@217.15.168.100:/opt/qhaway-api/
rsync -av public/data/por-programa-historico.json public/data/programa-territorio-clima.json \
  public/data/clima-tematico.json public/data/riesgos.json public/data/cortes.json \
  root@217.15.168.100:/opt/qhaway-api/data/
# cuando exista: public/data/mitigacion-2021-2027.json → mismo destino
```

En el VPS:

```bash
cd /opt/qhaway-api
chmod +x refresh.sh
set -a; . ./.env; set +a                                  # POSTGRES_PASSWORD
DBURL="postgresql://qhaway:${POSTGRES_PASSWORD}@qhaway-db:5432/qhaway"

# 0) respaldo de las tablas que se reemplazan
docker exec qhaway-db pg_dump -U qhaway -d qhaway -t 'gasto_*' -t 'carga_log' > /root/qhaway-backup-$(date +%F).sql

# 1) imagen del loader
docker build -t qhaway-loader /opt/qhaway-api/loader

# 2) migración (idempotente, no borra datos)
docker run --rm --network qhaway_net -e DATABASE_URL="$DBURL" qhaway-loader --migrate

# 3) carga MEF 2026 y 2025 desde el ZIP (~0.6–0.7 GB c/u en /opt/qhaway-api/work, se borra al terminar)
mkdir -p work
docker run --rm --network qhaway_net -e DATABASE_URL="$DBURL" -e QHAWAY_TMP=/work \
  -v /opt/qhaway-api/work:/work qhaway-loader 2026 2025
#    (2021–2024 después, si hace falta: ... qhaway-loader 2024 2023 2022 2021)

# 4) datos temáticos (programas, clima, mitigación, riesgos/El Niño, cortes)
docker run --rm --network qhaway_net -e DATABASE_URL="$DBURL" -e DATA_DIR=/data \
  -v /opt/qhaway-api/data:/data:ro --entrypoint python qhaway-loader load_tematico.py

# 5) API nueva (código de api/main.py) y caché limpia
docker compose build qhaway-api && docker compose up -d qhaway-api
docker restart qhaway-api      # si solo cambiaron datos

# 6) verificación
curl -s https://qhaway.org/api/meta | python3 -m json.tool | head -40          # lastUpdate = corte del MEF, cortes{}
curl -s https://qhaway.org/api/flujo-fases/2026                                 # PIM ~291 mil M, devengado ~216 mil M (corte 02-nov-2026)
curl -s https://qhaway.org/api/serie-nacional | python3 -c 'import json,sys; print(json.load(sys.stdin)[0])'  # 2004: devengado null
curl -s https://qhaway.org/api/riesgos | head -c 300; echo
curl -s "https://qhaway.org/api/programa-territorio-clima?code=0068&desde=2021" | head -c 300; echo
curl -s https://qhaway.org/api/cortes | head -c 300; echo
docker exec qhaway-db psql -U qhaway -d qhaway -c "SELECT ano, last_modified, filas, cargado_en FROM carga_log ORDER BY cargado_en DESC LIMIT 5"
```

Cron (ya instalado): `30 4 1 * * /opt/qhaway-api/refresh.sh` → logs en `/opt/qhaway-api/logs/`.
Prueba manual: `/opt/qhaway-api/refresh.sh 2026 && tail -50 /opt/qhaway-api/logs/refresh-$(date +%F).log`.

## Prueba local sin VPS
```bash
# solo agregación (sin DB): descarga el ZIP, agrega y valida
QHAWAY_TMP=/tmp python server/loader/load.py --dry-run 2026
```
