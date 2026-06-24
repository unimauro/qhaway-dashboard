"""QHAWAY API — sirve el presupuesto público (SIAF-MEF) desde PostgreSQL.
Devuelve las mismas formas JSON que consume el dashboard estático, más un
endpoint de cubo OLAP. Datos estáticos por año → cacheados en memoria.
"""
import os
import re
import ssl
import time
import functools
import smtplib
from email.message import EmailMessage
from email.headerregistry import Address
from email.policy import default as EMAIL_POLICY
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
OR_MODEL = os.environ.get("OR_MODEL", "openai/gpt-oss-120b:free")
# Buzón de contacto: envía por submission autenticada al exim del host
# (el contenedor lo alcanza por host.docker.internal). La cuenta emisora tiene DKIM
# → el correo llega a bandeja, no a spam. Credenciales OCULTAS en el .env del server.
CONTACTO_TO = os.environ.get("CONTACTO_TO", "carlos@cardenas.pe")
SMTP_HOST = os.environ.get("SMTP_HOST", "host.docker.internal")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_FROM = os.environ.get("SMTP_FROM", "qhaway@tiktuy.net")
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "").strip()
# Límite DEDICADO y estricto para el buzón (mucho más bajo que el general): evita
# que se use como mailbomb contra el destinatario fijo y quemar la reputación DKIM.
CONTACT_MAX = int(os.environ.get("CONTACT_MAX", "4"))          # mensajes…
CONTACT_WINDOW = int(os.environ.get("CONTACT_WINDOW", "3600"))  # …por hora por IP
# Detrás de un proxy de confianza (Caddy / HestiaCP) que SIEMPRE añade el IP real al
# final de X-Forwarded-For. Tomamos el ÚLTIMO hop (no el primero, que el cliente puede
# falsificar para evadir el rate-limit). Si algún día se expone directo, poner a "0".
TRUST_PROXY = os.environ.get("TRUST_PROXY", "1") == "1"

_CTRL_CHARS = re.compile(r"[\r\n\t\x00-\x1f\x7f]")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _hdr(v: str) -> str:
    """Colapsa CR/LF y caracteres de control a un espacio → sin inyección de cabeceras."""
    return _CTRL_CHARS.sub(" ", v).strip()


def client_ip(request) -> str:
    """IP real del cliente. Con proxy de confianza usamos el ÚLTIMO hop de XFF
    (lo pone el proxy); el primero lo controla el cliente y es falsificable."""
    if TRUST_PROXY:
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[-1].strip()
    return request.client.host if request.client else "?"
# El tier gratuito de OpenRouter se satura (429) o deprecia modelos: probamos varios en orden
# hasta que uno responda. Todos verificados disponibles y :free.
_OR_LIST = [OR_MODEL, "openai/gpt-oss-120b:free", "google/gemma-4-31b-it:free",
            "nvidia/nemotron-3-super-120b-a12b:free", "meta-llama/llama-3.3-70b-instruct:free"]
_seen: set = set()
# Máximo 3 modelos en cadena (con timeout corto): evita que un request a Ninacha
# ocupe un worker por minutos si el tier gratuito está saturado.
OR_FALLBACKS = [m for m in _OR_LIST if m and not (m in _seen or _seen.add(m))][:3]
OR_TIMEOUT = 12  # segundos por intento

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
# Orígenes EXPLÍCITOS por defecto (no `*`): aunque no usamos cookies, evita que cualquier
# web lea la API portando una X-API-Key si algún día se activa el gate.
DEFAULT_ORIGINS = [
    "https://unimauro.github.io", "https://qhaway.org", "https://www.qhaway.org",
    "https://qhaway.tunky.net", "http://localhost:5173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=(ORIGINS if ORIGINS and ORIGINS != ["*"] else DEFAULT_ORIGINS),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)

# --- Seguridad: API key + rate limiting por IP (en memoria) ---
_hits: dict[str, deque] = {}


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    # El preflight CORS (OPTIONS) no lleva la API key → no lo bloqueamos.
    if path.startswith("/api/") and request.method != "OPTIONS":
        # 0) Cap de tamaño de cuerpo (barato, antes de parsear): evita que un POST
        #    gigante se bufferice en RAM en un VPS compartido.
        cl = request.headers.get("content-length", "")
        if cl.isdigit() and int(cl) > 64 * 1024:
            return JSONResponse({"detail": "Cuerpo demasiado grande"}, status_code=413)
        # 1) API key (si está configurada)
        if API_KEY:
            sent = request.headers.get("x-api-key") or request.query_params.get("key", "")
            if sent != API_KEY:
                return JSONResponse({"detail": "API key requerida o inválida"}, status_code=401)
        # 2) rate limiting por IP (ventana deslizante), con IP real por último hop
        ip = client_ip(request)
        now = time.time()
        dq = _hits.setdefault(ip, deque())
        while dq and dq[0] < now - RATE_WINDOW:
            dq.popleft()
        if not dq:
            # IP ociosa: no dejes el bucket vacío acumulándose en memoria.
            del _hits[ip]
            dq = _hits.setdefault(ip, deque())
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
CACHE_MAX = int(os.environ.get("CACHE_MAX", "500"))   # tope de entradas (anti-crecimiento)
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
            # Cap de tamaño: ante un atacante iterando parámetros basura, descarta la
            # entrada más antigua en vez de crecer sin límite (dict preserva inserción).
            if len(_cache) >= CACHE_MAX:
                _cache.pop(next(iter(_cache)), None)
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
    except Exception:  # noqa: BLE001
        # No filtrar el detalle del error de DB al cliente.
        raise HTTPException(503, "base de datos no disponible")


@app.get("/api/meta", tags=["Sistema"], summary="Años disponibles, último corte y fases")
@ttl_cache
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
    _check_year(year)
    if dimension not in ("funcion", "fuente"):
        raise HTTPException(400, "dimension debe ser funcion o fuente")
    rows = _cubo(year, dimension, nivel, departamento)
    response.headers["Cache-Control"] = CACHE_YEAR
    return rows


_PIVOT_DIM = {"funcion": ("gasto_meta_funcion", "funcion"), "fuente": ("gasto_meta_fuente", "fuente")}
_PIVOT_BY = {"nivel", "departamento"}
_PIVOT_MEASURE = {"pim", "devengado"}


def _check_year(year: int):
    # Rechaza años absurdos: evita escaneos/caché por parámetros basura iterados.
    if not (2004 <= year <= 2030):
        raise HTTPException(400, "año fuera de rango (2004-2030)")


@ttl_cache
def _cubo_pivot(year: int, dim: str, by: str, measure: str):
    # Validación interna (defensa en profundidad): la función que CONSTRUYE el SQL no
    # depende de que el caller haya validado dim/by/measure antes de interpolarlos.
    if dim not in _PIVOT_DIM or by not in _PIVOT_BY or measure not in _PIVOT_MEASURE:
        raise HTTPException(400, "parámetros de pivote inválidos")
    tbl, dcol = _PIVOT_DIM[dim]
    sql = (f"SELECT {dcol} AS fila, {by} AS col, SUM({measure}) v "
           f"FROM {tbl} WHERE ano=%s GROUP BY 1,2")
    return q(sql, (year,))


@app.get("/api/cubo-pivot", tags=["OLAP"],
         summary="Pivote OLAP 2D en vivo: dimensión (filas) × eje (columnas)")
def cubo_pivot(year: int, response: Response, dim: str = "funcion",
               by: str = "nivel", measure: str = "pim"):
    """Tabla cruzada en vivo: `dim` (funcion|fuente) en filas × `by` (nivel|departamento) en
    columnas, midiendo `measure` (pim|devengado), por destino territorial (META) y año.
    Devuelve {columnas, filas:[{clave, total, valores:{col:val}}]} ordenadas por total desc."""
    _check_year(year)
    if dim not in _PIVOT_DIM or by not in _PIVOT_BY or measure not in _PIVOT_MEASURE:
        raise HTTPException(400, "Parámetros: dim=funcion|fuente, by=nivel|departamento, measure=pim|devengado")
    rows = _cubo_pivot(year, dim, by, measure)
    cols: dict[str, float] = {}
    filas: dict[str, dict] = {}
    for r in rows:
        fila, col, v = r["fila"] or "—", r["col"] or "—", float(r["v"] or 0)
        cols[col] = cols.get(col, 0.0) + v
        f = filas.setdefault(fila, {"clave": fila, "total": 0.0, "valores": {}})
        f["total"] += v
        f["valores"][col] = round(f["valores"].get(col, 0.0) + v, 2)
    columnas = [c for c, _ in sorted(cols.items(), key=lambda kv: -kv[1])]
    filas_ord = sorted(filas.values(), key=lambda f: -f["total"])
    for f in filas_ord:
        f["total"] = round(f["total"], 2)
    response.headers["Cache-Control"] = CACHE_YEAR
    return {"year": year, "dim": dim, "by": by, "measure": measure,
            "columnas": columnas, "filas": filas_ord}


# --- Ninacha 🔥: asistente IA (proxy a OpenRouter, key oculta en el servidor) ---
NINACHA_SYSTEM = (
    "Eres Ninacha, la asistente del observatorio ciudadano QHAWAY sobre el presupuesto público "
    "del Perú (datos reales SIAF-MEF) e indicadores territoriales distritales. Responde SOLO sobre "
    "QHAWAY y presupuesto/territorio del Perú; si te preguntan otra cosa, redirige con amabilidad. "
    "Sé concisa (máx ~5 frases), en español del Perú, cálida y clara. Cita cifras SOLO si están en el "
    "CONTEXTO; nunca inventes datos. Sugiere qué sección revisar (Presupuesto, Pisos Altitudinales, "
    "Riesgos, Prosperidad, Cambio Climático, Explorador, Cubo o Metodología)."
)


_ninacha_hits: dict[str, deque] = {}


@app.post("/api/ninacha", tags=["IA"], summary="Pregunta a Ninacha (asistente IA del observatorio)")
async def ninacha(payload: dict, request: Request):
    """Ninacha — IA del observatorio. El servidor llama a OpenRouter con la key oculta; el cliente
    solo envía la pregunta y un resumen del contexto de datos. Guardrails + anti-overclaiming."""
    # Límite por IP: la IA consume cuota y ata un worker hasta ~36s → evita abuso.
    _throttle(_ninacha_hits, client_ip(request), 20, 60,
              "Demasiadas preguntas seguidas a Ninacha; espera unos segundos.")
    if not OPENROUTER_KEY:
        raise HTTPException(503, "Ninacha (IA) aún no está configurada en el servidor")
    pregunta = str(payload.get("pregunta") or "").strip()[:1000]
    contexto = str(payload.get("contexto") or "")[:4000]
    if not pregunta:
        raise HTTPException(400, "Falta la pregunta")
    body = {
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
    last = "sin respuesta"
    async with httpx.AsyncClient(timeout=OR_TIMEOUT) as client:
        for model in OR_FALLBACKS:  # prueba modelos gratis en orden hasta que uno responda
            body["model"] = model
            try:
                r = await client.post("https://openrouter.ai/api/v1/chat/completions",
                                      json=body, headers=headers)
            except httpx.HTTPError as e:
                last = f"conexión {type(e).__name__}"
                continue
            if r.status_code == 200:
                texto = (r.json().get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
                if texto:
                    return {"texto": texto, "modelo": model}
                last = "respuesta vacía"
                continue
            last = f"OpenRouter {r.status_code}"  # 429/404 → siguiente modelo
    raise HTTPException(502, f"IA no disponible ahora ({last}). Intenta en un momento.")


# --- Throttle por IP dedicado y reutilizable (para recursos sensibles: buzón, IA) ---
def _throttle(store: dict, ip: str, max_n: int, window: int, msg: str):
    now = time.time()
    dq = store.setdefault(ip, deque())
    while dq and dq[0] < now - window:
        dq.popleft()
    if not dq:
        del store[ip]
        dq = store.setdefault(ip, deque())
    if len(dq) >= max_n:
        raise HTTPException(429, msg)
    dq.append(now)


# --- Buzón de contacto: el formulario del dashboard envía un correo al observatorio ---
_contact_hits: dict[str, deque] = {}


def _contact_throttle(ip: str):
    _throttle(_contact_hits, ip, CONTACT_MAX, CONTACT_WINDOW,
              "Has enviado varios mensajes; espera un momento antes de escribir otro.")


@app.post("/api/contacto", tags=["Sistema"], summary="Buzón de contacto (envía un correo al observatorio)")
def contacto(payload: dict, request: Request):
    # Límite estricto y dedicado por IP (independiente del general): anti-mailbomb.
    _contact_throttle(client_ip(request))
    # Honeypot: campo oculto que un humano deja vacío; si viene lleno = bot → fingimos
    # éxito y NO enviamos nada.
    if str(payload.get("website") or "").strip():
        return {"ok": True}
    # Sanitizamos los campos que van a CABECERAS (sin CR/LF → sin inyección de cabeceras).
    nombre = _hdr(str(payload.get("nombre") or ""))[:120]
    correo = _hdr(str(payload.get("email") or ""))[:160]
    asunto = _hdr(str(payload.get("asunto") or "Mensaje desde QHAWAY"))[:160]
    mensaje = str(payload.get("mensaje") or "").strip()[:5000]  # cuerpo: saltos de línea OK
    if not nombre or not mensaje:
        raise HTTPException(400, "Faltan el nombre o el mensaje")
    if not _EMAIL_RE.match(correo):
        raise HTTPException(400, "Correo electrónico inválido")
    # Política estricta (RFC-5322) + Address(): valida el addr-spec y serializa seguro.
    msg = EmailMessage(policy=EMAIL_POLICY)
    msg["Subject"] = f"[QHAWAY] {asunto}"
    msg["From"] = Address("QHAWAY · Contacto", addr_spec=SMTP_FROM)
    msg["To"] = CONTACTO_TO
    try:
        msg["Reply-To"] = Address(nombre, addr_spec=correo)
    except (ValueError, IndexError):
        raise HTTPException(400, "Correo electrónico inválido")
    msg.set_content(
        "Nuevo mensaje desde el buzón de QHAWAY (qhaway.org)\n\n"
        f"Nombre:  {nombre}\nCorreo:  {correo}\nAsunto:  {asunto}\n\nMensaje:\n{mensaje}\n"
    )
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            # STARTTLS con contexto sin verificación: es una conexión interna
            # contenedor→host por el bridge de Docker, el cert no coincide con la IP.
            s.starttls(context=ssl._create_unverified_context())
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg, from_addr=SMTP_FROM, to_addrs=[CONTACTO_TO])
    except Exception:  # noqa: BLE001
        # No revelar la causa interna (auth/conexión/timeout) al cliente.
        raise HTTPException(502, "No se pudo enviar el mensaje ahora. Intenta más tarde.")
    return {"ok": True}
