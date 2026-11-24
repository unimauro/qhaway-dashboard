# QHAWAY 2.0 — Dashboard (Observatorio Territorial del Perú)

Plataforma interactiva del **presupuesto público del Perú a nivel distrital** y de
inteligencia territorial, de la FIEECS-UNI. Implementa la propuesta
[qhaway-observatorio-2026](https://github.com/unimauro/qhaway-observatorio-2026).

- **Producción:** https://qhaway.org (VPS: frontend + API sobre PostgreSQL)
- **Espejo estático:** https://unimauro.github.io/qhaway-dashboard/ (GitHub Pages)

## Módulos

| Módulo | Qué responde | Datos |
|---|---|---|
| **Presupuesto Público** | PIA, PIM, certificado, devengado y girado por distrito, función, sector y nivel; ejecución; flujo de fases | SIAF-MEF (Datos Abiertos) |
| **Pisos Altitudinales** | ¿Cuánto presupuesto recibe la puna, la selva, cada piso? | Pulgar Vidal + altitud por distrito |
| **Cambio Climático** | Gasto en adaptación y mitigación (clasificador temático oficial del MEF) | MEF |
| **Riesgos Territoriales** | Sismos, huaicos, heladas, sequías, inundaciones por región | IGP, SENAMHI, CENEPRED, INDECI, INAIGEM, MINAM |
| **El Niño** | Seguimiento del evento y del gasto asociado | ENFEN, NOAA + MEF |
| **Desarrollo Humano y Estado** | IDH, pobreza y presencia del Estado por distrito (indicadores oficiales citables) | IDH 2019 (PNUD), pobreza (INEI) |
| **Explorador / Cubo (OLAP)** | Cruces multidimensionales del gasto en vivo | API (PostgreSQL) |
| **Evolución Regional** | Presupuesto por departamento y año | Consulta Amigable / MEF |
| **Cobertura Territorial** | Qué distritos existían y tienen dato cada año | Demarcación territorial |

> El antiguo «Índice de Prosperidad Territorial (IPT)» fue retirado: era un índice
> compuesto poco transparente y se reemplazó por el módulo *Desarrollo Humano y Estado*.

## Stack

React 19 · TypeScript · Vite 7 · Tailwind 3 · Apache ECharts 6 (importación modular,
ver `src/components/Chart.tsx`) · Leaflet · React Router 7 (hash router).

## Arquitectura

```
                  ┌──────────────── VPS (qhaway.org) ────────────────┐
navegador ──────▶ │ Caddy ─┬─ /          → /var/www/qhaway (dist/)    │
                  │        └─ /api/*     → FastAPI (server/api)       │
                  │                         └─ PostgreSQL 16          │
                  │  loader (server/loader) ← ZIP anuales del MEF     │
                  └───────────────────────────────────────────────────┘
GitHub Pages ───▶ mismo build (base /qhaway-dashboard/), espejo estático
```

- **qhaway.org** es la fuente principal: el frontend llama a `/api/*` en el mismo
  origen; la API sirve los agregados desde PostgreSQL (cubo, drill, series, temáticos).
  Documentación: https://qhaway.org/docs (Swagger) y https://qhaway.org/redoc.
  Detalle del servidor y del loader en [`server/README.md`](server/README.md).
- **GitHub Pages** es un espejo: el mismo bundle intenta la API de qhaway.org (CORS) y,
  si no responde, cae a los JSON pregenerados de `public/data/` (ver `loadJSON` en
  `src/lib/data.ts`). Las vistas que solo existen en la API (p. ej. el cubo en vivo)
  quedan limitadas en el espejo si la API está caída.

## Datos

- **Presupuesto:** dataset «Presupuesto y Ejecución de Gasto» del MEF (Datos Abiertos).
  La API SQL del MEF (`datastore_search_sql`) fue retirada en 2026; ahora se usan los
  archivos anuales completos (ZIP/CSV):
  - `etl/discover_annual.py` descubre los recursos por año → `etl/resource_map.json`;
  - `etl/build_mef.py` los descarga (reanudable), los agrega en streaming y escribe los
    JSON de `public/data/` (por año y series multi-año + `meta.json` con la fecha de corte).
  - En el VPS, `server/loader/load.py` carga los mismos ZIP en PostgreSQL.
- **Territorio:** GeoJSON de 1 834 distritos (ubigeo `IDDIST`).
- **Indicadores sociales:** IDH 2019 (PNUD), pobreza y vulnerabilidad alimentaria (INEI), altitud.
- **Riesgos:** perfil de riesgo por región curado de fuentes oficiales.

Los datos abiertos se publican bajo **CC BY 4.0**. Las cifras pueden diferir de
*Consulta Amigable* por fecha de corte, nivel de agregación y por usar la ubicación
de la **unidad ejecutora** (ver la sección Metodología del propio dashboard).

## Desarrollo

```bash
npm ci
npm run dev            # http://localhost:5173/qhaway-dashboard/
npm run lint           # ESLint
npx tsc -b             # typecheck
npm run build          # tsc -b + vite build → dist/ (base /qhaway-dashboard/)
VITE_BASE=/ npm run build   # build para qhaway.org (base /)
```

## Actualizar los datos de presupuesto (JSON estáticos)

```bash
python etl/discover_annual.py      # si cambian los recursos por año
python etl/build_mef.py            # años cuyo archivo cambió desde el último corte
python etl/build_mef.py 2026 2025  # años concretos
```

En GitHub Actions, `.github/workflows/refresh-data.yml` lo hace el **último viernes de
cada mes** y commitea los JSON si cambiaron; si falla, abre o actualiza un issue.
En el VPS, la base de datos se refresca con `server/refresh.sh` (cron mensual).

## Despliegue

- **Producción (qhaway.org):** `./deploy-vps.sh` desde una máquina con la llave SSH.
  Corre lint, `tsc -b` y el build con `VITE_BASE=/`; sube el paquete como una release
  nueva en `/var/www/qhaway-releases/<timestamp>` y la sincroniza sobre
  `/var/www/qhaway` con `rsync --delay-updates --delete-after` (el sitio nunca queda vacío;
  Caddy no se toca). Conserva las últimas 5 releases:
  `./deploy-vps.sh --list` y `./deploy-vps.sh --rollback [TS]` para volver atrás.
- **Espejo (GitHub Pages):** `.github/workflows/deploy.yml` en cada push a `main`, a mano,
  o al terminar con éxito la actualización de datos (`workflow_run`; un push hecho con
  `GITHUB_TOKEN` no dispara workflows por sí mismo). Corre lint y `tsc -b` antes del build.
- `.github/workflows/serie-historica.yml` está **obsoleto** (usaba la API SQL retirada);
  solo se ejecuta a mano escribiendo `OBSOLETO` como confirmación.
