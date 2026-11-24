#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Loader QHAWAY: descarga el archivo anual de gasto del MEF (fs.datosabiertos.mef.gob.pe)
y lo agrega en PostgreSQL. Corre EN EL VPS. Idempotente y reanudable.

Fuente (verificada 2026-11-24 con HEAD):
  * ZIP  {año}-Gasto.zip (≤2024) / {año}-Gasto-Mensual.zip (≥2025): 0.3–0.7 GB  ← preferido
  * CSV  {año}-Gasto.csv / {año}-Gasto-Mensual.csv: ~8–10 GB                      ← fallback
  Los nombres se descubren con el endpoint del portal (getDatasetDetalle); si el portal falla,
  se prueban los nombres conocidos con HEAD.
El ZIP se recorre en streaming (zipfile + io.TextIOWrapper): no se descomprime a disco.
Las columnas se ubican POR NOMBRE de encabezado; si falta alguna, error claro.

Antes de reemplazar un año se VALIDA (PIM vs año anterior ±40 %, 3 niveles de gobierno,
ningún nombre vacío). Si falla, lo ya cargado queda intacto. Cada carga deja un registro en
`carga_log` (año, URL, Last-Modified del archivo del MEF, filas, fecha de carga): es el
«corte real» que expone /api/meta.

Uso (contenedor del loader, con DATABASE_URL apuntando a la db):
  python load.py 2026 2025          # años concretos (salta si el archivo no cambió)
  python load.py all                # 2012..año actual
  python load.py --force 2026       # recarga aunque el archivo del MEF no haya cambiado
  python load.py --no-validate 2026 # omite la validación (solo si sabes por qué falla)
  python load.py --dry-run 2026     # descarga + agrega + valida, NO escribe (no requiere DB)
  python load.py --migrate          # solo aplica las migraciones SQL de ./migraciones
"""
import csv
import datetime
import email.utils
import glob
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict

DB = os.environ.get("DATABASE_URL", "postgresql://qhaway:qhaway_local@qhaway-db:5432/qhaway")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (qhaway-loader)"
FS = "https://fs.datosabiertos.mef.gob.pe/datastorefiles/"
PORTAL = "https://datosabiertos.mef.gob.pe/Rest/PortalWebDatasetDetalle/v1.0/getDatasetDetalle"
DATASET = "presupuesto-y-ejecucion-de-gasto"
TMP = os.environ.get("QHAWAY_TMP", "/tmp")
HERE = os.path.dirname(os.path.abspath(__file__))
MIGRACIONES = os.path.join(HERE, "migraciones")
FIRST_YEAR = 2012          # <2012 no es confiable (ver migraciones/001_pre2012.sql)
PIM_TOLERANCIA = 0.40      # ±40 % respecto del PIM nacional del año anterior
NIVELES = ("GOBIERNO NACIONAL", "GOBIERNOS REGIONALES", "GOBIERNOS LOCALES")
csv.field_size_limit(10_000_000)

# Columnas requeridas (por nombre). El orden define la tupla de índices de aggregate().
COLS = ["ANO_EJE", "NIVEL_GOBIERNO_NOMBRE", "SECTOR_NOMBRE",
        "DEPARTAMENTO_EJECUTORA", "DEPARTAMENTO_EJECUTORA_NOMBRE",
        "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE",
        "DISTRITO_EJECUTORA", "DISTRITO_EJECUTORA_NOMBRE",
        "FUNCION_NOMBRE", "DEPARTAMENTO_META", "DEPARTAMENTO_META_NOMBRE",
        "FUENTE_FINANCIAMIENTO_NOMBRE",
        "MONTO_PIA", "MONTO_PIM", "MONTO_CERTIFICADO", "MONTO_DEVENGADO", "MONTO_GIRADO"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS gasto_nacional (ano INT PRIMARY KEY, pia NUMERIC, pim NUMERIC, certificado NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_distrito (ano INT, ubigeo TEXT, departamento TEXT, provincia TEXT, distrito TEXT, nivel TEXT, pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_funcion (ano INT, funcion TEXT, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_sector (ano INT, sector TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_nivel (ano INT, nivel TEXT, pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_meta_funcion (ano INT, ubigeo TEXT, departamento TEXT, funcion TEXT, nivel TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_meta_fuente (ano INT, ubigeo TEXT, departamento TEXT, fuente TEXT, nivel TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_depto_hist (ano INT, ubigeo TEXT, departamento TEXT, pia NUMERIC, pim NUMERIC, certificado NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS carga_log (id BIGSERIAL PRIMARY KEY, ano INT NOT NULL, fuente_url TEXT, last_modified TIMESTAMPTZ, filas BIGINT, cargado_en TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_dist_ano ON gasto_distrito(ano);
CREATE INDEX IF NOT EXISTS ix_mf_ano ON gasto_meta_funcion(ano);
CREATE INDEX IF NOT EXISTS ix_mfu_ano ON gasto_meta_fuente(ano);
CREATE INDEX IF NOT EXISTS ix_carga_log_ano ON carga_log(ano, cargado_en DESC);
"""


def log(msg):
    print(msg, flush=True)


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


# ------------------------------------------------------------------ descubrimiento
def _req(url, data=None, method=None):
    h = {"User-Agent": UA}
    if data is not None:
        h["Content-Type"] = "application/json"
    return urllib.request.Request(url, data=data, headers=h, method=method)


def head(url):
    """(last_modified datetime UTC | None, tamaño) ; (None, 0) si no existe."""
    if not url:
        return None, 0
    for _ in range(3):
        try:
            with urllib.request.urlopen(_req(url, method="HEAD"), timeout=40) as r:
                lm = r.headers.get("Last-Modified")
                size = int(r.headers.get("Content-Length") or 0)
            return (email.utils.parsedate_to_datetime(lm) if lm else None), size
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, 0
            time.sleep(3)
        except Exception:  # noqa: BLE001
            time.sleep(3)
    return None, 0


def _portal_map():
    """{año: {csv, zip}} según el portal del MEF; {} si no responde."""
    import re
    body = json.dumps({"dataset": DATASET}).encode()
    for i in range(3):
        try:
            with urllib.request.urlopen(_req(PORTAL, body, "POST"), timeout=60) as r:
                d = json.loads(r.read().decode("utf-8", "ignore"))
            out = {}
            for res in d.get("resources", []):
                m = re.fullmatch(r"(\d{4})-Gasto(-Mensual)?\.csv", (res.get("resource_title") or "").strip(), re.I)
                if m:
                    out[int(m.group(1))] = {"csv": res.get("resource_url") or "",
                                            "zip": res.get("resource_download_url_zip") or ""}
            if out:
                return out
        except Exception as e:  # noqa: BLE001
            log(f"  portal intento {i}: {repr(e)[:90]}")
            time.sleep(4)
    return {}


_PORTAL = None


def discover(year):
    """Recurso del año: {'zip','csv'} (URLs; zip puede ser '')."""
    global _PORTAL
    if _PORTAL is None:
        _PORTAL = _portal_map()
        if not _PORTAL:
            log("  AVISO: el portal del MEF no respondió; uso los nombres de archivo conocidos")
    if year in _PORTAL:
        return dict(_PORTAL[year])
    names = (f"{year}-Gasto-Mensual", f"{year}-Gasto") if year >= 2025 else (f"{year}-Gasto",)
    for n in names:
        if head(FS + n + ".zip")[0] or head(FS + n + ".csv")[0]:
            return {"zip": FS + n + ".zip", "csv": FS + n + ".csv"}
    return {"zip": FS + names[0] + ".zip", "csv": FS + names[0] + ".csv"}


# ------------------------------------------------------------------ descarga
def _size(p):
    return os.path.getsize(p) if os.path.exists(p) else 0


def download(url, dest, expected):
    """Descarga continua con curl, reanudable (-C -). Devuelve True si quedó completa.
    Si el MEF ignora Range (responde 200), curl no anexa basura: se cuenta como ciclo sin
    avance y, tras 3, se reinicia de cero."""
    stalls = 0
    t0 = time.time()
    for _ in range(40):
        have = _size(dest)
        if expected and have == expected:
            break
        if expected and have > expected:  # basura de una corrida previa
            os.remove(dest)
            have = 0
        subprocess.run(["curl", "-s", "-f", "-C", "-", "--retry", "8", "--retry-delay", "15",
                        "--retry-all-errors", "--speed-limit", "25000", "--speed-time", "120",
                        "-A", UA, url, "-o", dest])
        now = _size(dest)
        if not expected and now > 0:
            break  # sin Content-Length no hay cómo reanudar con seguridad
        if now <= have:
            stalls += 1
            if stalls >= 3:
                try:
                    os.remove(dest)
                except OSError:
                    pass
                stalls = 0
            time.sleep(8)
        else:
            stalls = 0
    ok = _size(dest) > 0 and (not expected or _size(dest) == expected)
    log(f"    {os.path.basename(dest)}: {'OK' if ok else 'INCOMPLETO'} "
        f"{_size(dest)/1e9:.2f} GB en {time.time()-t0:.0f}s")
    return ok


def fetch(year):
    """Descarga el ZIP (o el CSV si no hay ZIP / el ZIP falla).
    Devuelve (ruta_local, url, last_modified)."""
    res = discover(year)
    for kind in ("zip", "csv"):
        url = res.get(kind)
        if not url:
            continue
        lm, size = head(url)
        if not size:
            log(f"  [{year}] {kind} no disponible ({url})")
            continue
        dest = os.path.join(TMP, f"qhaway_gasto_{year}.{kind}")
        log(f"  [{year}] descargando {url} ({size/1e9:.2f} GB, Last-Modified {lm})")
        if not download(url, dest, size):
            continue
        if kind == "zip":
            try:
                with zipfile.ZipFile(dest) as zf:
                    if not any(n.lower().endswith(".csv") for n in zf.namelist()):
                        raise zipfile.BadZipFile("ZIP sin CSV")
            except zipfile.BadZipFile as e:
                log(f"  [{year}] ZIP inválido ({e}); se descarta y cae al CSV")
                os.remove(dest)
                continue
        return dest, url, lm
    return None, None, None


def open_rows(path):
    """Iterador csv.reader en streaming sobre un .zip (sin descomprimir a disco) o un .csv."""
    if path.lower().endswith(".zip"):
        zf = zipfile.ZipFile(path)
        csvs = [i for i in zf.infolist() if i.filename.lower().endswith(".csv")]
        name = max(csvs, key=lambda i: i.file_size).filename
        fh = io.TextIOWrapper(zf.open(name), encoding="utf-8", errors="ignore", newline="")
    else:
        fh = open(path, encoding="utf-8", errors="ignore", newline="")
    return csv.reader(fh)


# ------------------------------------------------------------------ agregación
def column_index(header, year=None):
    hdr = [h.strip().lstrip("﻿").upper() for h in header]
    ix = {h: i for i, h in enumerate(hdr)}
    miss = [c for c in COLS if c not in ix]
    if miss:
        raise RuntimeError(f"{year}: el CSV del MEF cambió de esquema; faltan columnas {miss} "
                           f"(encabezado recibido: {hdr[:8]}… {len(hdr)} columnas)")
    return [ix[c] for c in COLS]


def aggregate(rows, year):
    (I_ANO, I_NIV, I_SECTOR, I_DEP, I_DEPNOM, I_PROV, I_PROVNOM, I_DIST, I_DISTNOM, I_FUNCION,
     I_DEPMETA, I_DEPMETANOM, I_FUENTE, I_PIA, I_PIM, I_CERT, I_DEV, I_GIR) = column_index(next(rows), year)
    last = max(I_ANO, I_NIV, I_SECTOR, I_DEP, I_DEPNOM, I_PROV, I_PROVNOM, I_DIST, I_DISTNOM,
               I_FUNCION, I_DEPMETA, I_DEPMETANOM, I_FUENTE, I_PIA, I_PIM, I_CERT, I_DEV, I_GIR)
    sy = str(year)

    def z(): return [0.0, 0.0, 0.0, 0.0, 0.0]  # pia,pim,cert,dev,gir
    dist, func, sect, nivg = {}, defaultdict(z), defaultdict(z), defaultdict(z)
    fmeta, fuen, dmeta = defaultdict(z), defaultdict(z), defaultdict(z)
    dnom = {}
    nat = z()
    n = cortas = otro_ano = 0
    vacios = defaultdict(int)  # conteo de nombres vacíos por campo (para la validación)
    for r in rows:
        if len(r) <= last:
            cortas += 1
            continue
        if r[I_ANO].strip() != sy:
            otro_ano += 1
            continue
        vals = (f(r[I_PIA]), f(r[I_PIM]), f(r[I_CERT]), f(r[I_DEV]), f(r[I_GIR]))
        niv = r[I_NIV].strip()
        if not niv:
            vacios["NIVEL_GOBIERNO_NOMBRE"] += 1
            niv = "—"
        fn = r[I_FUNCION].strip()
        if not fn:
            vacios["FUNCION_NOMBRE"] += 1
            fn = "—"
        se = r[I_SECTOR].strip() or "—"  # vacío es normal en gobiernos locales
        fu = r[I_FUENTE].strip()
        if not fu:
            vacios["FUENTE_FINANCIAMIENTO_NOMBRE"] += 1
            fu = "—"
        n += 1
        for arr in (nat, func[fn], sect[se], nivg[niv]):
            for i, v in enumerate(vals):
                arr[i] += v
        dep, prov, di = r[I_DEP].strip(), r[I_PROV].strip(), r[I_DIST].strip()
        if dep.isdigit() and prov.isdigit() and di.isdigit():
            ub = f"{int(dep):02d}{int(prov):02d}{int(di):02d}"
            a = dist.get((ub, niv))
            if a is None:
                a = dist[(ub, niv)] = [r[I_DEPNOM].strip(), r[I_PROVNOM].strip(), r[I_DISTNOM].strip(),
                                       0.0, 0.0, 0.0, 0.0]
            a[3] += vals[0]; a[4] += vals[1]; a[5] += vals[3]; a[6] += vals[4]
        dm = r[I_DEPMETA].strip()
        if dm.isdigit():
            ubm = f"{int(dm):02d}"
            nm = r[I_DEPMETANOM].strip()
            if nm:
                dnom[ubm] = nm
            m = fmeta[(ubm, fn, niv)]; m[1] += vals[1]; m[3] += vals[3]
            g = fuen[(ubm, fu, niv)]; g[1] += vals[1]; g[3] += vals[3]
            d = dmeta[ubm]
            for i, v in enumerate(vals):
                d[i] += v
    # META sin nombre y sin montos (p. ej. '00' en 2026: PIM 0) es ruido del SIAF → se descarta.
    for ub in [u for u in dmeta if not dnom.get(u) and not any(abs(x) > 0.5 for x in dmeta[u])]:
        log(f"  [{year}] META '{ub}' sin nombre y sin montos → descartado")
        del dmeta[ub]
        for dd in (fmeta, fuen):
            for k in [k for k in dd if k[0] == ub]:
                del dd[k]
    log(f"  [{year}] {n:,} filas (cortas {cortas}, otro año {otro_ano}) · PIM {nat[1]/1e9:.1f} · "
        f"Dev {nat[3]/1e9:.1f} mil M")
    return dict(dist=dist, func=func, sect=sect, nivg=nivg, fmeta=fmeta, fuen=fuen, dmeta=dmeta,
                dnom=dnom, nat=nat, n=n, vacios=dict(vacios))


# ------------------------------------------------------------------ validación
def validate(agg, year, pim_prev=None):
    """Lista de problemas (vacía = OK). pim_prev: PIM nacional del año anterior en la DB."""
    errs = []
    pim = agg["nat"][1]
    if agg["n"] == 0 or pim <= 0:
        errs.append("archivo vacío o PIM nacional ≤ 0")
    if pim_prev:
        ratio = pim / float(pim_prev)
        if not (1 - PIM_TOLERANCIA <= ratio <= 1 + PIM_TOLERANCIA):
            errs.append(f"PIM nacional {pim/1e9:.1f} mil M fuera de ±{PIM_TOLERANCIA:.0%} del año "
                        f"anterior ({float(pim_prev)/1e9:.1f} mil M; ratio {ratio:.2f})")
    else:
        log(f"  [{year}] AVISO: sin PIM del año anterior en la DB; se omite el control ±40 %")
    falt = [nv for nv in NIVELES if agg["nivg"].get(nv, [0, 0])[1] <= 0]
    if falt:
        errs.append(f"faltan niveles de gobierno (o PIM 0): {falt}; presentes {sorted(agg['nivg'])}")
    for campo, k in agg["vacios"].items():
        errs.append(f"{k:,} filas con {campo} vacío")
    sin_nombre = sum(1 for a in agg["dist"].values() if not (a[0] and a[1] and a[2]))
    if sin_nombre:
        errs.append(f"{sin_nombre} ubigeos ejecutores sin nombre de departamento/provincia/distrito")
    sin_dep = [ub for ub in agg["dmeta"] if not agg["dnom"].get(ub)]
    if sin_dep:
        errs.append(f"departamentos META sin nombre y con montos: {sin_dep}")
    return errs


# ------------------------------------------------------------------ escritura
def apply_migrations(conn):
    files = sorted(glob.glob(os.path.join(MIGRACIONES, "*.sql")))
    for p in files:
        with open(p, encoding="utf-8") as fh:
            conn.execute(fh.read())
        log(f"  migración aplicada: {os.path.basename(p)}")
    conn.commit()


def pim_anterior(conn, year):
    r = conn.execute("SELECT pim FROM gasto_nacional WHERE ano=%s", (year - 1,)).fetchone()
    return r[0] if r and r[0] else None


def ultimo_last_modified(conn, year):
    r = conn.execute("SELECT last_modified FROM carga_log WHERE ano=%s ORDER BY cargado_en DESC LIMIT 1",
                     (year,)).fetchone()
    return r[0] if r else None


def load_year(conn, year, agg, fuente_url=None, last_modified=None):
    """Reemplaza el año en UNA transacción (si algo falla, queda lo anterior)."""
    rnd = lambda v: round(v, 2)  # noqa: E731
    with conn.transaction():
        cur = conn.cursor()
        for t in ("gasto_nacional", "gasto_distrito", "gasto_funcion", "gasto_sector", "gasto_nivel",
                  "gasto_meta_funcion", "gasto_meta_fuente", "gasto_depto_hist"):
            cur.execute(f"DELETE FROM {t} WHERE ano=%s", (year,))
        nat = agg["nat"]
        cur.execute("INSERT INTO gasto_nacional VALUES (%s,%s,%s,%s,%s,%s)",
                    (year, rnd(nat[0]), rnd(nat[1]), rnd(nat[2]), rnd(nat[3]), rnd(nat[4])))
        cur.executemany("INSERT INTO gasto_distrito VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        [(year, ub, a[0], a[1], a[2], niv, rnd(a[3]), rnd(a[4]), rnd(a[5]), rnd(a[6]))
                         for (ub, niv), a in agg["dist"].items()])
        cur.executemany("INSERT INTO gasto_funcion VALUES (%s,%s,%s,%s,%s)",
                        [(year, k, rnd(v[1]), rnd(v[3]), rnd(v[4])) for k, v in agg["func"].items() if k != "—"])
        # Las municipalidades no tienen SECTOR en el SIAF → caen en "—". Se agrupan como
        # pseudo-sector "GOBIERNOS LOCALES" para que el corte por sector reconcilie con el total.
        cur.executemany("INSERT INTO gasto_sector VALUES (%s,%s,%s,%s)",
                        [(year, ("GOBIERNOS LOCALES" if k == "—" else k), rnd(v[1]), rnd(v[3]))
                         for k, v in agg["sect"].items()])
        cur.executemany("INSERT INTO gasto_nivel VALUES (%s,%s,%s,%s,%s,%s)",
                        [(year, k, rnd(v[0]), rnd(v[1]), rnd(v[3]), rnd(v[4])) for k, v in agg["nivg"].items()])
        cur.executemany("INSERT INTO gasto_meta_funcion VALUES (%s,%s,%s,%s,%s,%s,%s)",
                        [(year, ub, agg["dnom"].get(ub, ub), fn, nv, rnd(v[1]), rnd(v[3]))
                         for (ub, fn, nv), v in agg["fmeta"].items()])
        cur.executemany("INSERT INTO gasto_meta_fuente VALUES (%s,%s,%s,%s,%s,%s,%s)",
                        [(year, ub, agg["dnom"].get(ub, ub), ft, nv, rnd(v[1]), rnd(v[3]))
                         for (ub, ft, nv), v in agg["fuen"].items()])
        cur.executemany("INSERT INTO gasto_depto_hist VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        [(year, ub, agg["dnom"].get(ub, ub), rnd(v[0]), rnd(v[1]), rnd(v[2]), rnd(v[3]), rnd(v[4]))
                         for ub, v in agg["dmeta"].items()])
        cur.execute("INSERT INTO carga_log (ano, fuente_url, last_modified, filas) VALUES (%s,%s,%s,%s)",
                    (year, fuente_url, last_modified, agg["n"]))


def process_year(year, conn=None, force=False, validar=True, keep=False):
    """Pipeline completo de un año. conn=None → dry-run (no escribe). Devuelve un resumen."""
    if conn is not None and not force:
        res = discover(year)
        lm, _ = head(res.get("zip")) if res.get("zip") else (None, 0)
        if not lm:
            lm, _ = head(res.get("csv"))
        prev = ultimo_last_modified(conn, year)
        if lm and prev and prev >= lm:
            return f"[{year}] sin cambios en el MEF (Last-Modified {lm:%Y-%m-%d}) → skip (usa --force)"
    path, url, lm = fetch(year)
    if not path:
        return f"[{year}] descarga FALLIDA (ZIP y CSV) → no se toca lo cargado"
    try:
        agg = aggregate(open_rows(path), year)
    finally:
        if not keep:
            try:
                os.remove(path)
            except OSError:
                pass
    if validar:
        errs = validate(agg, year, pim_anterior(conn, year) if conn is not None else None)
        if errs:
            return f"[{year}] VALIDACIÓN FALLIDA → no se reemplaza lo cargado:\n    - " + "\n    - ".join(errs)
    resumen = (f"{agg['n']:,} filas → {len(set(ub for ub, _ in agg['dist']))} ubigeos, "
               f"PIM {agg['nat'][1]/1e9:.1f} / Dev {agg['nat'][3]/1e9:.1f} mil M · corte {lm}")
    if conn is None:
        return f"[{year}] DRY-RUN {resumen}"
    load_year(conn, year, agg, url, lm)
    return f"[{year}] CARGADO {resumen}"


def parse_args(argv):
    flags = {a for a in argv if a.startswith("--")}
    args = [a for a in argv if not a.startswith("--")]
    if not args or args[0] == "all":
        years = list(range(FIRST_YEAR, datetime.date.today().year + 1))
    else:
        years = [int(a) for a in args]
    return years, flags


def main():
    years, flags = parse_args(sys.argv[1:])
    if "--dry-run" in flags:
        for y in years:
            log(process_year(y, None, validar="--no-validate" not in flags, keep="--keep" in flags))
        return
    import psycopg
    with psycopg.connect(DB) as conn:
        conn.execute(SCHEMA)
        conn.commit()
        apply_migrations(conn)
        if "--migrate" in flags:
            log("LISTO (solo migraciones)")
            return
        fallos = []
        for y in years:
            try:
                msg = process_year(y, conn, force="--force" in flags, validar="--no-validate" not in flags)
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                msg = f"[{y}] ERROR {repr(e)[:200]}"
            log(msg)
            if "FALLID" in msg or "ERROR" in msg:
                fallos.append(y)
    log(f"LISTO{' con fallos en ' + str(fallos) if fallos else ''}")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
