"""QHAWAY API — sirve el presupuesto público (SIAF-MEF) desde PostgreSQL.
Devuelve las mismas formas JSON que consume el dashboard estático, más un
endpoint de cubo OLAP. Datos estáticos por año → cacheados en memoria.
"""
import os
import time
from collections import deque
from functools import lru_cache
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import psycopg
from psycopg.rows import dict_row

DB = os.environ["DATABASE_URL"]
ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
API_KEY = os.environ.get("QHAWAY_API_KEY", "").strip()      # gate de consumo (header X-API-Key)
RATE_MAX = int(os.environ.get("RATE_MAX", "120"))            # req por ventana
RATE_WINDOW = int(os.environ.get("RATE_WINDOW", "60"))       # segundos

app = FastAPI(title="QHAWAY API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS or ["*"],
    allow_methods=["GET"],
    allow_headers=["*", "X-API-Key"],
)

# --- Seguridad: API key + rate limiting por IP (en memoria) ---
_hits: dict[str, deque] = {}


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    # El preflight CORS (OPTIONS) no lleva la API key → no lo bloqueamos.
    if path.startswith("/api/") and request.method != "OPTIONS":
        # 1) API key (si está configurada)
        if API_KEY:
            sent = request.headers.get("x-api-key") or request.query_params.get("key", "")
            if sent != API_KEY:
                return JSONResponse({"detail": "API key requerida o inválida"}, status_code=401)
        # 2) rate limiting por IP (ventana deslizante)
        ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
              or (request.client.host if request.client else "?"))
        now = time.time()
        dq = _hits.setdefault(ip, deque())
        while dq and dq[0] < now - RATE_WINDOW:
            dq.popleft()
        if len(dq) >= RATE_MAX:
            return JSONResponse({"detail": "Demasiadas solicitudes, intenta en un momento"}, status_code=429)
        dq.append(now)
    return await call_next(request)


def q(sql: str, params=()):
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


@app.get("/")
def root():
    return {
        "api": "QHAWAY — Observatorio del Presupuesto Público del Perú",
        "estado": "ok",
        "endpoints": ["/health", "/api/meta", "/api/serie-nacional", "/api/por-distrito/{año}",
                      "/api/por-funcion/{año}", "/api/por-sector/{año}", "/api/por-departamento-historico",
                      "/api/explorador-funcion-meta/{año}", "/api/cubo?year=&dimension=&nivel=&departamento="],
        "dashboard": "https://unimauro.github.io/qhaway-dashboard/",
        "fuente": "MEF — Consulta del Gasto (datos abiertos), cargado en PostgreSQL propio (FIEECS-UNI).",
    }


@app.get("/health")
def health():
    try:
        q("SELECT 1 AS ok")
        return {"status": "ok"}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"db: {e}")


@app.get("/api/meta")
@lru_cache(maxsize=1)
def meta():
    years = [r["ano"] for r in q("SELECT DISTINCT ano FROM gasto_nacional ORDER BY ano")]
    dyears = [r["ano"] for r in q("SELECT DISTINCT ano FROM gasto_distrito ORDER BY ano DESC")]
    return {
        "years": years,
        "latestYear": max(years) if years else None,
        "distritoYears": dyears,
        "lastUpdate": q("SELECT to_char(now(),'YYYY-MM-DD') d")[0]["d"],
        "fases": ["pia", "pim", "certificado", "devengado", "girado"],
        "fuente": "MEF — Consulta del Gasto (CSV datos abiertos), cargado en PostgreSQL propio.",
    }


@app.get("/api/serie-nacional")
@lru_cache(maxsize=1)
def serie_nacional():
    return q("SELECT ano AS year, pia, pim, certificado, devengado, girado FROM gasto_nacional ORDER BY ano")


@app.get("/api/por-departamento-historico")
@lru_cache(maxsize=1)
def depto_hist():
    return q("SELECT ano AS year, ubigeo, departamento, pia, pim, certificado, devengado, girado "
             "FROM gasto_depto_hist ORDER BY ano, ubigeo")


@lru_cache(maxsize=64)
def _por_distrito(year: int):
    return q("SELECT ubigeo, departamento, provincia, distrito, nivel, pia, pim, devengado, girado "
             "FROM gasto_distrito WHERE ano=%s", (year,))


@app.get("/api/por-distrito/{year}")
def por_distrito(year: int):
    rows = _por_distrito(year)
    if not rows:
        raise HTTPException(404, f"sin datos distritales para {year}")
    return rows


@app.get("/api/por-funcion/{year}")
@lru_cache(maxsize=64)
def por_funcion(year: int):
    return q("SELECT funcion, pim, devengado, girado FROM gasto_funcion WHERE ano=%s ORDER BY pim DESC", (year,))


@app.get("/api/por-sector/{year}")
@lru_cache(maxsize=64)
def por_sector(year: int):
    return q("SELECT sector, pim, devengado FROM gasto_sector WHERE ano=%s ORDER BY pim DESC", (year,))


@app.get("/api/por-nivel/{year}")
@lru_cache(maxsize=64)
def por_nivel(year: int):
    return q("SELECT ano AS year, nivel, pia, pim, devengado, girado FROM gasto_nivel WHERE ano=%s", (year,))


@app.get("/api/flujo-fases/{year}")
@lru_cache(maxsize=64)
def flujo(year: int):
    r = q("SELECT pia, pim, certificado, devengado, girado FROM gasto_nacional WHERE ano=%s", (year,))
    if not r:
        raise HTTPException(404, f"sin datos para {year}")
    return r[0]


@app.get("/api/explorador-funcion-meta/{year}")
@lru_cache(maxsize=64)
def expl_funcion(year: int):
    return q("SELECT ubigeo, departamento, funcion, nivel, pim, devengado "
             "FROM gasto_meta_funcion WHERE ano=%s", (year,))


@app.get("/api/explorador-fuente-meta/{year}")
@lru_cache(maxsize=64)
def expl_fuente(year: int):
    return q("SELECT ubigeo, departamento, fuente, nivel, pim, devengado "
             "FROM gasto_meta_fuente WHERE ano=%s", (year,))


@app.get("/api/cubo")
def cubo(year: int, dimension: str = "funcion", nivel: str | None = None, departamento: str | None = None):
    """Cubo OLAP simple: cruza año × dimensión (funcion|fuente) × nivel × departamento (destino META)."""
    tbl = "gasto_meta_funcion" if dimension == "funcion" else "gasto_meta_fuente"
    col = "funcion" if dimension == "funcion" else "fuente"
    where = ["ano=%s"]
    params: list = [year]
    if nivel:
        where.append("nivel=%s"); params.append(nivel)
    if departamento:
        where.append("departamento=%s"); params.append(departamento)
    sql = (f"SELECT {col} AS clave, SUM(pim) pim, SUM(devengado) devengado "
           f"FROM {tbl} WHERE {' AND '.join(where)} GROUP BY 1 ORDER BY 2 DESC")
    return q(sql, tuple(params))
