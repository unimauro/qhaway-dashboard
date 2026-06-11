# QHAWAY 2.0 — Dashboard (Observatorio Territorial del Perú)

Plataforma interactiva del **presupuesto público del Perú a nivel distrital** y de
inteligencia territorial, para FIEECS-UNI. Es la implementación (Fase 1, GitHub Pages)
de la propuesta [qhaway-observatorio-2026](https://github.com/unimauro/qhaway-observatorio-2026).

**Live:** https://unimauro.github.io/qhaway-dashboard/

## Módulos

| Módulo | Qué responde | Datos |
|---|---|---|
| **Presupuesto Público** | PIA, PIM, Devengado, Girado por distrito/función/sector; ejecución; flujo de fases | SIAF-MEF (Datos Abiertos), real |
| **Pisos Altitudinales** | ¿Cuánto presupuesto recibe la puna, la selva, cada piso? | Pulgar Vidal + altitud por distrito |
| **Riesgos Territoriales** | Sismos, huaicos, heladas, sequías, inundaciones por región | IGP, SENAMHI, CENEPRED, INDECI, INAIGEM, MINAM |
| **Prosperidad (IPT)** | Índice de Prosperidad Territorial por distrito; rankings | IDH 2019 (PNUD), pobreza/vuln. (INEI) |

## Stack

React 18 · TypeScript · Vite · Tailwind 3 · Apache ECharts · Leaflet · React Router (hash). Sitio 100% estático en GitHub Pages; el dashboard **no** consulta APIs en caliente, solo lee JSON pregenerado.

## Datos

- **Presupuesto:** API de Datos Abiertos del MEF (`api.datosabiertos.mef.gob.pe`, CKAN datastore SQL). El ETL (`etl/build.py`) agrega server-side y emite los JSON de `public/data/`.
- **Territorio:** GeoJSON de 1,834 distritos (ubigeo `IDDIST`).
- **Indicadores sociales:** IDH 2019 (PNUD), pobreza y vulnerabilidad alimentaria (INEI), altitud — vía datasets abiertos.
- **Riesgos:** perfil de riesgo por región (25 departamentos) curado de fuentes oficiales.

Los datos abiertos se publican bajo **CC BY 4.0**. Las cifras pueden diferir de
*Consulta Amigable* por fecha de corte, nivel de agregación y por usar la ubicación
de la **unidad ejecutora** (ver la sección Metodología del propio dashboard).

## Desarrollo

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # genera dist/
```

## Actualizar los datos de presupuesto

```bash
pip install requests
python etl/build.py            # regenera public/data/*.json desde la API del MEF
python etl/build.py --discover # si cambian los resource_id por año
```

## Despliegue

Automático con GitHub Actions (`.github/workflows/deploy.yml`) en cada push a `main`.
