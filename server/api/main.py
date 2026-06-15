"""QHAWAY API — sirve el presupuesto público (SIAF-MEF) desde PostgreSQL.
Devuelve las mismas formas JSON que consume el dashboard estático, más un
endpoint de cubo OLAP. Datos estáticos por año → cacheados en memoria.
"""
import os
import time
import functools
from collections import deque
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
import psycopg
from psycopg.rows import dict_row

DB = os.environ["DATABASE_URL"]
ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
API_KEY = os.environ.get("QHAWAY_API_KEY", "").strip()      # gate de consumo (header X-API-Key)
RATE_MAX = int(os.environ.get("RATE_MAX", "120"))            # req por ventana
RATE_WINDOW = int(os.environ.get("RATE_WINDOW", "60"))       # segundos
# Ninacha (IA): key OCULTA en el servidor; el cliente nunca la ve. Modelo gratuito de OpenRouter.
OPENROUTER_KEY = os.environ.get("OPENROUTER_KEY", "").strip()
OR_MODEL = os.environ.get("OR_MODEL", "meta-llama/llama-3.3-70b-instruct:free")

API_DESC = """
**API pública del Observatorio QHAWAY** — presupuesto público del Perú (SIAF-MEF) e
inteligencia territorial distrital, como **datos abiertos** para investigación y reutilización.

- **Fuente:** MEF — Consulta del Gasto / Datos Abiertos (SIAF), cargada en PostgreSQL propio.
- **Cobertura:** serie nacional y regional 2004-2026; detalle distrital por año (en expansión).
- **Atribución territorial:** por *destino* (META, a nivel departamento) y por *ejecutora* (distrito).
- **Licencia:** datos bajo CC BY 4.0. Cita: «Observatorio QHAWAY (FIEECS-UNI), a partir de SIAF-MEF».
- **Uso justo:** la API es de solo lectura, con límite de tasa por IP. Si necesitas volúmenes grandes,
  descarga los JSON o escríbenos.

Cualquiera puede construir sobre estos datos: esta documentación interactiva (OpenAPI) es,
en sí misma, un entregable académico del observatorio.
"""

TAGS = [
    {"name": "Sistema", "description": "Estado del servicio y metadatos."},
    {"name": "Presupuesto", "description": "Series y agregados del gasto público (PIA/PIM/Devengado/Girado)."},
    {"name": "Territorio", "description": "Detalle por distrito (ejecutora) y por destino territorial (META)."},
    {"name": "OLAP", "description": "Cubo: cruces arbitrarios año × dimensión × nivel × territorio."},
    {"name": "IA", "description": "Ninacha, asistente del observatorio."},
]

app = FastAPI(
    title="QHAWAY API",
    version="1.1",
    description=API_DESC,
    openapi_tags=TAGS,
    contact={"name": "Observatorio QHAWAY · FIEECS-UNI", "url": "https://unimauro.github.io/qhaway-dashboard/"},
    license_info={"name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/"},
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS or ["*"],
    allow_methods=["GET", "POST"],
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


# --- Caché en memoria con TTL ---
# Los datos por año son inmutables una vez cargados, así que cachearlos es seguro.
# A diferencia del lru_cache anterior: (1) TTL, para que aparezcan años nuevos tras la
# migración sin reiniciar; (2) NUNCA cacheamos resultados vacíos (el bug previo cacheaba
# el [] de un año aún no cargado y lo servía para siempre).
CACHE_TTL = int(os.environ.get("CACHE_TTL", "900"))   # 15 min
_cache: dict = {}


def ttl_cache(fn):
    @functools.wraps(fn)
    def wrap(*args, **kwargs):
        # FastAPI pasa los path params como keyword args → la clave debe incluirlos.
        key = (fn.__name__, args, tuple(sorted(kwargs.items())))
        hit = _cache.get(key)
        now = time.time()
        if hit and hit[0] > now:
            return hit[1]
        val = fn(*args, **kwargs)
        if val:  # no cachear vacíos/None → reintenta hasta que la migración cargue el año
            _cache[key] = (now + CACHE_TTL, val)
        return val
    return wrap


# Datos por año, inmutables → el navegador/CDN pueden cachear duro.
CACHE_YEAR = "public, max-age=86400, stale-while-revalidate=604800"
# Meta cambia conforme la migración carga años → caché corto.
CACHE_META = "public, max-age=60"


@app.get("/", tags=["Sistema"], summary="Índice de la API")
def root():
    return {
        "api": "QHAWAY — Observatorio del Presupuesto Público del Perú",
        "estado": "ok",
        "docs": "https://qhaway.tunky.net/docs",
        "redoc": "https://qhaway.tunky.net/redoc",
        "openapi": "https://qhaway.tunky.net/openapi.json",
        "endpoints": ["/health", "/api/meta", "/api/serie-nacional", "/api/por-distrito/{año}",
                      "/api/por-funcion/{año}", "/api/por-sector/{año}", "/api/por-nivel/{año}",
                      "/api/flujo-fases/{año}", "/api/por-departamento-historico",
                      "/api/explorador-funcion-meta/{año}", "/api/explorador-fuente-meta/{año}",
                      "/api/cubo?year=&dimension=&nivel=&departamento="],
        "dashboard": "https://unimauro.github.io/qhaway-dashboard/",
        "fuente": "MEF — Consulta del Gasto (datos abiertos), cargado en PostgreSQL propio (FIEECS-UNI).",
        "licencia": "CC BY 4.0",
    }


@app.get("/health", tags=["Sistema"], summary="Salud del servicio y la base de datos")
def health():
    try:
        q("SELECT 1 AS ok")
        return {"status": "ok"}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"db: {e}")


@app.get("/api/meta", tags=["Sistema"], summary="Años disponibles, último corte y fases")
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


@app.get("/api/serie-nacional", tags=["Presupuesto"], summary="Serie nacional anual (2004-2026)")
@ttl_cache
def serie_nacional():
    return q("SELECT ano AS year, pia, pim, certificado, devengado, girado FROM gasto_nacional ORDER BY ano")


@app.get("/api/por-departamento-historico", tags=["Presupuesto"],
         summary="Serie por departamento de destino (META), 2004-2026")
@ttl_cache
def depto_hist():
    return q("SELECT ano AS year, ubigeo, departamento, pia, pim, certificado, devengado, girado "
             "FROM gasto_depto_hist ORDER BY ano, ubigeo")


@ttl_cache
def _por_distrito(year: int):
    return q("SELECT ubigeo, departamento, provincia, distrito, nivel, pia, pim, devengado, girado "
             "FROM gasto_distrito WHERE ano=%s", (year,))


@app.get("/api/por-distrito/{year}", tags=["Territorio"],
         summary="Detalle distrital por ejecutora (PIM/devengado por ubigeo)")
def por_distrito(year: int, response: Response):
    rows = _por_distrito(year)
    if not rows:
        raise HTTPException(404, f"sin datos distritales para {year}")
    response.headers["Cache-Control"] = CACHE_YEAR
    return rows


@app.get("/api/por-funcion/{year}", tags=["Presupuesto"], summary="Gasto por función (año)")
@ttl_cache
def por_funcion(year: int):
    return q("SELECT funcion, pim, devengado, girado FROM gasto_funcion WHERE ano=%s ORDER BY pim DESC", (year,))


@app.get("/api/por-sector/{year}", tags=["Presupuesto"], summary="Gasto por sector (año)")
@ttl_cache
def por_sector(year: int):
    return q("SELECT sector, pim, devengado FROM gasto_sector WHERE ano=%s ORDER BY pim DESC", (year,))


@app.get("/api/por-nivel/{year}", tags=["Presupuesto"], summary="Gasto por nivel de gobierno (año)")
@ttl_cache
def por_nivel(year: int):
    return q("SELECT ano AS year, nivel, pia, pim, devengado, girado FROM gasto_nivel WHERE ano=%s", (year,))


@app.get("/api/flujo-fases/{year}", tags=["Presupuesto"], summary="Fases del gasto (PIA→PIM→…→Girado)")
@ttl_cache
def flujo(year: int):
    r = q("SELECT pia, pim, certificado, devengado, girado FROM gasto_nacional WHERE ano=%s", (year,))
    if not r:
        raise HTTPException(404, f"sin datos para {year}")
    return r[0]


@app.get("/api/explorador-funcion-meta/{year}", tags=["Territorio"],
         summary="Función × departamento de destino (META) × nivel")
@ttl_cache
def expl_funcion(year: int):
    return q("SELECT ubigeo, departamento, funcion, nivel, pim, devengado "
             "FROM gasto_meta_funcion WHERE ano=%s", (year,))


@app.get("/api/explorador-fuente-meta/{year}", tags=["Territorio"],
         summary="Fuente de financiamiento × departamento de destino (META) × nivel")
@ttl_cache
def expl_fuente(year: int):
    return q("SELECT ubigeo, departamento, fuente, nivel, pim, devengado "
             "FROM gasto_meta_fuente WHERE ano=%s", (year,))


@ttl_cache
def _cubo(year: int, dimension: str, nivel: str | None, departamento: str | None):
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


@app.get("/api/cubo", tags=["OLAP"],
         summary="Cubo OLAP: cruce año × dimensión × nivel × departamento")
def cubo(year: int, response: Response, dimension: str = "funcion",
         nivel: str | None = None, departamento: str | None = None):
    """Cubo OLAP simple: cruza año × dimensión (funcion|fuente) × nivel × departamento (destino META)."""
    rows = _cubo(year, dimension, nivel, departamento)
    response.headers["Cache-Control"] = CACHE_YEAR
    return rows


# --- Ninacha 🔥: asistente IA (proxy a OpenRouter, key oculta en el servidor) ---
NINACHA_SYSTEM = (
    "Eres Ninacha, la asistente del observatorio ciudadano QHAWAY sobre el presupuesto público "
    "del Perú (datos reales SIAF-MEF) e indicadores territoriales distritales. Responde SOLO sobre "
    "QHAWAY y presupuesto/territorio del Perú; si te preguntan otra cosa, redirige con amabilidad. "
    "Sé concisa (máx ~5 frases), en español del Perú, cálida y clara. Cita cifras SOLO si están en el "
    "CONTEXTO; nunca inventes datos. Sugiere qué sección revisar (Presupuesto, Pisos Altitudinales, "
    "Riesgos, Prosperidad, Cambio Climático, Explorador, Cubo o Metodología)."
)


@app.post("/api/ninacha", tags=["IA"], summary="Pregunta a Ninacha (asistente IA del observatorio)")
async def ninacha(payload: dict):
    """Ninacha — IA del observatorio. El servidor llama a OpenRouter con la key oculta; el cliente
    solo envía la pregunta y un resumen del contexto de datos. Guardrails + anti-overclaiming."""
    if not OPENROUTER_KEY:
        raise HTTPException(503, "Ninacha (IA) aún no está configurada en el servidor")
    pregunta = str(payload.get("pregunta") or "").strip()[:1000]
    contexto = str(payload.get("contexto") or "")[:4000]
    if not pregunta:
        raise HTTPException(400, "Falta la pregunta")
    body = {
        "model": OR_MODEL,
        "messages": [
            {"role": "system", "content": NINACHA_SYSTEM + "\n\nCONTEXTO DE DATOS:\n" + contexto},
            {"role": "user", "content": pregunta},
        ],
        "temperature": 0.3,
        "max_tokens": 500,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://unimauro.github.io/qhaway-dashboard/",
        "X-Title": "QHAWAY Ninacha",
    }
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post("https://openrouter.ai/api/v1/chat/completions",
                                  json=body, headers=headers)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Error conectando con la IA: {type(e).__name__}")
    if r.status_code != 200:
        raise HTTPException(502, f"IA no disponible (OpenRouter {r.status_code})")
    texto = (r.json().get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    if not texto:
        raise HTTPException(502, "La IA devolvió una respuesta vacía")
    return {"texto": texto, "modelo": OR_MODEL}
