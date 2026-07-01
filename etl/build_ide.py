#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Enriquece public/data/indicadores-distrito.json con acceso a servicios básicos
del Censo 2017 (INEI) y reconstruye el Índice de Densidad del Estado (IDE),
metodología PNUD.

FUENTE (real, oficial, descargable en caliente):
  INEI — REDATAM en línea, base CPV2017DI (Censos Nacionales 2017 a nivel
  distrital). Motor RpWebStats.exe/Frequency. Cada consulta "Frecuencia de la
  variable X con corte por Distrito" devuelve, en un solo pasada, un bloque por
  cada uno de los ~1874 distritos con su UBIGEO de 6 dígitos ("AREA # 010101"),
  los casos por categoría y el total. De ahí calculamos el % de viviendas/hogares.

Variables usadas (diccionario CPV2017DI):
  Vivienda.C2P6   Abastecimiento de agua           -> % agua por red pública
  Vivienda.C2P10  Servicio higiénico (desagüe)     -> % desagüe por red pública
  Vivienda.C2P11  Alumbrado eléctrico por red      -> % electricidad
  Hogar.C3P213    Conexión a Internet              -> % hogares con internet

Universo viviendas = Viviendas Particulares (TIPOVIV <= 8). El "Total" que
reporta REDATAM ya excluye "No Aplica", de modo que el % se calcula sobre
viviendas particulares con ocupantes que respondieron.

IDE (reconstrucción QHAWAY, PNUD): promedio simple 0..1 de las dimensiones
disponibles. Con el Censo 2017 obtenemos 2 de las 4 dimensiones:
  - agua + saneamiento  -> ideAgua = promedio(agua%, desague%) / 100
  - electrificación      -> ideElectricidad = electricidad% / 100
Las dimensiones SALUD (médicos por 10 000 hab.) y EDUCACIÓN (asistencia neta a
secundaria) NO se cargan aquí (requieren MINSA/SUSALUD y un cruce edad×asistencia
del censo); quedan como null y se documentan como pendientes. calcularIDE() en el
frontend promedia solo las dimensiones presentes.

El script CACHEA el HTML crudo de REDATAM en etl/cache_ide/ para que las
re-ejecuciones sean offline y reproducibles. Uso:
    python3 etl/build_ide.py            # usa caché si existe, si no descarga
    python3 etl/build_ide.py --refresh  # fuerza nueva descarga
"""
import json, os, re, sys, time, html as _html, urllib.request, urllib.parse, ssl

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "data")
DEST = os.path.join(DATA, "indicadores-distrito.json")
CACHE = os.path.join(HERE, "cache_ide")
os.makedirs(CACHE, exist_ok=True)

BASE = "CPV2017DI"
HOST = "https://censos2017.inei.gob.pe/bininei"
ACTION = HOST + "/RpWebStats.exe/Frequency?"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# ctx que ignora verificación TLS (el certificado de INEI a veces falla en curl/py)
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE

# variable -> (item REDATAM, universo, tag de salida)
QUERIES = {
    "agua":         ("Vivienda.C2P6",  "FREQVIV", "Vivienda.TIPOVIV <= 8"),
    "desague":      ("Vivienda.C2P10", "FREQVIV", "Vivienda.TIPOVIV <= 8"),
    "electricidad": ("Vivienda.C2P11", "FREQVIV", "Vivienda.TIPOVIV <= 8"),
    "internet":     ("Hogar.C3P213",   "FREQHOG", ""),
}


def _post(url, data, referer, timeout=240):
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "User-Agent": UA, "Referer": referer,
        "Content-Type": "application/x-www-form-urlencoded",
    })
    with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
        return r.read().decode("utf-8", "ignore")


def _get(url, timeout=240):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
        return r.read().decode("latin-1", "ignore")


def fetch_raw(tag, row, item, universe, refresh=False):
    """Devuelve el HTML crudo de la tabla de frecuencia por distrito (con caché)."""
    cache_file = os.path.join(CACHE, f"{tag}.html")
    if os.path.exists(cache_file) and not refresh:
        return open(cache_file, encoding="utf-8").read()

    referer = f"{HOST}/RpWebStats.exe/Frequency?BASE={BASE}&ITEM={item}&lang=esp"
    data = {
        "MAIN": "WebServerMain.inl", "BASE": BASE, "LANG": "esp",
        "CODIGO": "XXUSUARIOXX", "ITEM": item, "MODE": "RUN", "inputTitle": "",
        "ROW": row, "AREABREAK": "Distrito", "SELECTION": "ALL",
        "FORMAT": "HTML", "PERCENT": "OFF", "UNIVERSE": universe,
        "FILTER": "", "TEXT_FILTER": "", "INLINESELECTION": "", "Submit": "Ejecutar",
    }
    last = None
    for attempt in range(3):
        try:
            shell = _post(ACTION, data, referer)
            m = re.search(r"RpWebUtilities\.exe/Text\?LFN=RpBases\\Tempo\\[0-9]+\\~tmp_[0-9]+\.htm", shell)
            if not m:
                raise RuntimeError("REDATAM no devolvió enlace de resultados")
            grid = _get(HOST + "/" + m.group(0) + "&TYPE=TMP")
            if "AREA #" not in grid:
                raise RuntimeError("tabla de resultados sin bloques AREA")
            open(cache_file, "w", encoding="utf-8").write(grid)
            return grid
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"    [{tag}] reintento {attempt}: {e!r}", flush=True)
            time.sleep(3)
    raise SystemExit(f"No se pudo descargar {tag} de REDATAM: {last!r}")


_NUM = re.compile(r"[0-9]+")


def _to_int(s):
    s = s.replace(".", "").replace(",", "").replace("\xa0", "").replace(" ", "").strip()
    return int(s) if _NUM.fullmatch(s) else None


def parse_blocks(html):
    """HTML REDATAM -> {ubigeo: {'cats': {label: casos}, 'total': int}}."""
    # Parseo ligero por regex de filas para no depender de lxml/bs4.
    # Cada bloque: 'AREA # NNNNNN' ... filas '<label> <casos> <pct> <acum>' ... 'Total N'.
    rows = re.split(r"</tr>", html, flags=re.I)
    out, cur = {}, None
    for tr in rows:
        cells = [re.sub(r"<[^>]+>", "", c) for c in re.split(r"</t[dh]>", tr, flags=re.I)]
        cells = [re.sub(r"\s+", " ", _html.unescape(c)).strip() for c in cells]
        cells = [c for c in cells if c != ""]
        if not cells:
            continue
        joined = " ".join(cells)
        m = re.search(r"AREA #\s*([0-9]{6})", joined)
        if m:
            cur = m.group(1)
            out[cur] = {"cats": {}, "total": None}
            continue
        if cur is None or len(cells) < 2:
            continue
        label, val = cells[0], _to_int(cells[1])
        if val is None:
            continue
        if label == "Total":
            out[cur]["total"] = val
        elif not label.startswith("V:") and label not in ("Casos", "No Aplica :"):
            out[cur]["cats"][label] = val
    return out


# Qué categorías cuentan como "acceso" en cada variable (match por substring, robusto).
def _pct_agua(cats):
    # Definición oficial INEI "agua por red pública": red pública dentro + fuera
    # de la vivienda (78.3% nacional). El pilón/pileta de uso público (4.7%) se
    # contabiliza aparte y NO se incluye aquí.
    return sum(v for lab, v in cats.items() if "Red pública" in lab)


def _pct_desague(cats):
    return sum(v for lab, v in cats.items() if "Red pública de desagüe" in lab)


def _pct_si(cats):
    return sum(v for lab, v in cats.items() if lab.lower().startswith("sí") or lab.lower().startswith("si "))


EXTRACTOR = {
    "agua": _pct_agua,
    "desague": _pct_desague,
    "electricidad": _pct_si,
    "internet": _pct_si,
}


def compute_service(tag, blocks):
    """{ubigeo: pct 0..100} para un servicio."""
    fn = EXTRACTOR[tag]
    res = {}
    for ubigeo, b in blocks.items():
        tot = b["total"]
        if not tot:
            continue
        ok = fn(b["cats"])
        res[ubigeo] = round(100.0 * ok / tot, 2)
    return res


def r2(x):
    return None if x is None else round(x, 4)


def main():
    refresh = "--refresh" in sys.argv

    services = {}
    for tag, (row, item, uni) in QUERIES.items():
        print(f"[REDATAM] {tag}: {row} por Distrito …", flush=True)
        html = fetch_raw(tag, row, item, uni, refresh=refresh)
        blocks = parse_blocks(html)
        services[tag] = compute_service(tag, blocks)
        # validación nacional (viviendas/hogares ponderados por total del bloque)
        num = den = 0
        for ub, b in blocks.items():
            if not b["total"]:
                continue
            num += EXTRACTOR[tag](b["cats"])
            den += b["total"]
        nat = 100.0 * num / den if den else 0
        print(f"    distritos={len(services[tag])}  nacional≈{nat:.1f}%", flush=True)

    # ── merge con el JSON existente ──
    base = json.load(open(DEST, encoding="utf-8"))
    n_serv = 0
    for d in base:
        ub = d["ubigeo"]
        agua = services["agua"].get(ub)
        des = services["desague"].get(ub)
        ele = services["electricidad"].get(ub)
        net = services["internet"].get(ub)
        # servicios (0..100), null si el distrito no está en la base censal 2017
        d["agua"] = agua
        d["desague"] = des
        d["electricidad"] = ele
        d["internet"] = net
        # dimensiones IDE (0..1). agua+saneamiento = promedio(agua, desague).
        if agua is not None and des is not None:
            d["ideAgua"] = r2((agua + des) / 2.0 / 100.0)
        elif agua is not None:
            d["ideAgua"] = r2(agua / 100.0)
        else:
            d["ideAgua"] = None
        d["ideElectricidad"] = r2(ele / 100.0) if ele is not None else None
        # salud y educación: sin fuente distrital limpia todavía -> pendientes.
        d["ideSalud"] = None
        d["ideEducacion"] = None
        if agua is not None:
            n_serv += 1

    json.dump(base, open(DEST, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"\nOK -> {DEST}")
    print(f"    {n_serv}/{len(base)} distritos con servicios del Censo 2017")
    dims = sum(1 for d in base if d.get("ideAgua") is not None and d.get("ideElectricidad") is not None)
    print(f"    {dims} distritos con IDE reconstruido (agua+saneamiento & electrificación)")


if __name__ == "__main__":
    main()
