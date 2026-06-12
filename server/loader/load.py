#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Loader QHAWAY: descarga los CSV anuales del gasto del MEF (fs.datosabiertos.mef.gob.pe)
y los agrega en PostgreSQL. Corre EN EL VPS (mejor banda). Idempotente y reanudable.

Uso (dentro del contenedor de la API o con DATABASE_URL apuntando a la db):
  python load.py 2024 2023 2022 ...     # años específicos
  python load.py all                     # 2012..2026
Descarga cada CSV (resumible) a /tmp, agrega en streaming, inserta, borra el CSV.
"""
import os, sys, csv, json, subprocess, time
from collections import defaultdict
import psycopg

DB = os.environ.get("DATABASE_URL", "postgresql://qhaway:qhaway_local@qhaway-db:5432/qhaway")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
BASE = "https://fs.datosabiertos.mef.gob.pe/datastorefiles/"
TMP = "/tmp"
csv.field_size_limit(10_000_000)

# índices 0-based
I_NIV, I_SECTOR = 3, 5
I_DEP, I_PROV, I_DIST = 11, 13, 15
I_DEPNOM, I_PROVNOM, I_DISTNOM = 12, 14, 16
I_FUNCION = 27
I_DEPMETA, I_DEPMETANOM = 35, 36
I_FUENTE = 38
I_PIA, I_PIM, I_CERT, I_DEV, I_GIR = 56, 57, 58, 61, 62

SCHEMA = """
CREATE TABLE IF NOT EXISTS gasto_nacional (ano INT PRIMARY KEY, pia NUMERIC, pim NUMERIC, certificado NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_distrito (ano INT, ubigeo TEXT, departamento TEXT, provincia TEXT, distrito TEXT, nivel TEXT, pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_funcion (ano INT, funcion TEXT, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_sector (ano INT, sector TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_nivel (ano INT, nivel TEXT, pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_meta_funcion (ano INT, ubigeo TEXT, departamento TEXT, funcion TEXT, nivel TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_meta_fuente (ano INT, ubigeo TEXT, departamento TEXT, fuente TEXT, nivel TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_depto_hist (ano INT, ubigeo TEXT, departamento TEXT, pia NUMERIC, pim NUMERIC, certificado NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE INDEX IF NOT EXISTS ix_dist_ano ON gasto_distrito(ano);
CREATE INDEX IF NOT EXISTS ix_mf_ano ON gasto_meta_funcion(ano);
CREATE INDEX IF NOT EXISTS ix_mfu_ano ON gasto_meta_fuente(ano);
"""


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def url_for(year):
    return f"{BASE}{year}-Gasto-Mensual.csv" if year >= 2025 else f"{BASE}{year}-Gasto.csv"


def download(year):
    path = f"{TMP}/gasto_{year}.csv"
    url = url_for(year)
    try:
        h = subprocess.run(["curl", "-sI", "--max-time", "30", "-A", UA, url], capture_output=True, text=True)
        expected = int(next(l.split(":")[1] for l in h.stdout.splitlines() if l.lower().startswith("content-length")))
    except Exception:
        expected = 0
    print(f"[{year}] descargando ({expected/1e9:.1f} GB)…", flush=True)
    t0 = time.time()
    # Descarga CONTINUA: sin --max-time (no cortamos cada 5 min). curl corre hasta
    # terminar; --speed-limit/--speed-time lo aborta SOLO si se estanca <25 KB/s por 120s.
    # Así el caso feliz baja el archivo entero en una sola conexión y NUNCA reanuda
    # (con varias conexiones el MEF a veces ignora Range y responde 200 → curl trunca;
    # al no reanudar, evitamos ese thrashing). Si 3 ciclos no avanzan, reinicia limpio.
    stalls = 0
    for _ in range(40):
        have = os.path.getsize(path) if os.path.exists(path) else 0
        if expected and have >= expected * 0.98:
            break
        subprocess.run(["curl", "-s", "-C", "-", "--retry", "8", "--retry-delay", "15",
                        "--retry-all-errors", "--speed-limit", "25000", "--speed-time", "120",
                        "-A", UA, url, "-o", path])
        now = os.path.getsize(path) if os.path.exists(path) else 0
        if now <= have:
            stalls += 1
            if stalls >= 3:  # 3 ciclos sin avanzar (resume roto) → empieza de cero una vez
                try:
                    os.remove(path)
                except OSError:
                    pass
                stalls = 0
            time.sleep(8)
        else:
            stalls = 0
    ok = os.path.exists(path) and (not expected or os.path.getsize(path) >= expected * 0.98)
    print(f"  {year}: {'OK' if ok else 'INCOMPLETO'} {os.path.getsize(path)/1e9:.1f} GB en {time.time()-t0:.0f}s", flush=True)
    return path if ok else None


def aggregate(path):
    def z(): return [0.0, 0.0, 0.0, 0.0, 0.0]  # pia,pim,cert,dev,gir
    dist, func, sect, nivg = {}, defaultdict(z), defaultdict(z), defaultdict(z)
    fmeta, fuen, dmeta = defaultdict(z), defaultdict(z), defaultdict(z)
    dnom = {}
    nat = z()
    n = 0
    with open(path, encoding="utf-8", errors="ignore", newline="") as fh:
        rd = csv.reader(fh); next(rd, None)
        for r in rd:
            if len(r) <= I_GIR:
                continue
            pia, pim, cert, dev, gir = f(r[I_PIA]), f(r[I_PIM]), f(r[I_CERT]), f(r[I_DEV]), f(r[I_GIR])
            niv = r[I_NIV].strip(); fn = r[I_FUNCION].strip() or "—"; se = r[I_SECTOR].strip() or "—"; fu = r[I_FUENTE].strip() or "—"
            n += 1
            for arr, vals in ((nat, (pia, pim, cert, dev, gir)), (func[fn], (pia, pim, cert, dev, gir)),
                              (sect[se], (pia, pim, cert, dev, gir)), (nivg[niv], (pia, pim, cert, dev, gir))):
                for i, v in enumerate(vals):
                    arr[i] += v
            dep, prov, di = r[I_DEP].strip(), r[I_PROV].strip(), r[I_DIST].strip()
            if dep and prov and di and dep.isdigit():
                try:
                    ub = f"{int(dep):02d}{int(prov):02d}{int(di):02d}"
                    a = dist.get((ub, niv))
                    if a is None:
                        a = dist[(ub, niv)] = [r[I_DEPNOM].strip(), r[I_PROVNOM].strip(), r[I_DISTNOM].strip(), 0.0, 0.0, 0.0, 0.0]
                    a[3] += pia; a[4] += pim; a[5] += dev; a[6] += gir
                except ValueError:
                    pass
            dm = r[I_DEPMETA].strip()
            if dm and dm.isdigit():
                ubm = f"{int(dm):02d}"; dnom[ubm] = r[I_DEPMETANOM].strip()
                m = fmeta[(ubm, fn, niv)]; m[1] += pim; m[3] += dev
                g = fuen[(ubm, fu, niv)]; g[1] += pim; g[3] += dev
                d = dmeta[ubm]; d[0] += pia; d[1] += pim; d[2] += cert; d[3] += dev; d[4] += gir
    return dict(dist=dist, func=func, sect=sect, nivg=nivg, fmeta=fmeta, fuen=fuen, dmeta=dmeta, dnom=dnom, nat=nat, n=n)


def load_year(conn, year, agg):
    rnd = lambda v: round(v, 2)
    with conn.cursor() as cur:
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
        # Las municipalidades (gobiernos locales) no tienen SECTOR en el SIAF → caen en "—".
        # No las descartamos: las agrupamos como pseudo-sector "GOBIERNOS LOCALES" para que el
        # corte por sector reconcilie con el total nacional (de lo contrario faltaría el gasto local).
        cur.executemany("INSERT INTO gasto_sector VALUES (%s,%s,%s,%s)",
                        [(year, ("GOBIERNOS LOCALES" if k == "—" else k), rnd(v[1]), rnd(v[3]))
                         for k, v in agg["sect"].items()])
        cur.executemany("INSERT INTO gasto_nivel VALUES (%s,%s,%s,%s,%s,%s)",
                        [(year, k, rnd(v[0]), rnd(v[1]), rnd(v[3]), rnd(v[4])) for k, v in agg["nivg"].items()])
        cur.executemany("INSERT INTO gasto_meta_funcion VALUES (%s,%s,%s,%s,%s,%s,%s)",
                        [(year, ub, agg["dnom"].get(ub, ub), fn, nv, rnd(v[1]), rnd(v[3])) for (ub, fn, nv), v in agg["fmeta"].items()])
        cur.executemany("INSERT INTO gasto_meta_fuente VALUES (%s,%s,%s,%s,%s,%s,%s)",
                        [(year, ub, agg["dnom"].get(ub, ub), ft, nv, rnd(v[1]), rnd(v[3])) for (ub, ft, nv), v in agg["fuen"].items()])
        cur.executemany("INSERT INTO gasto_depto_hist VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        [(year, ub, agg["dnom"].get(ub, ub), rnd(v[0]), rnd(v[1]), rnd(v[2]), rnd(v[3]), rnd(v[4])) for ub, v in agg["dmeta"].items()])
    conn.commit()


def main():
    args = sys.argv[1:]
    years = list(range(2012, 2027)) if (not args or args[0] == "all") else [int(a) for a in args]
    with psycopg.connect(DB) as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
        conn.commit()
        for y in years:
            try:
                path = download(y)
                if not path:
                    continue
                print(f"  {y}: agregando…", flush=True)
                agg = aggregate(path)
                load_year(conn, y, agg)
                os.remove(path)
                ubs = len(set(ub for ub, _ in agg["dist"]))
                print(f"  {y}: {agg['n']:,} filas → {ubs} ubigeos, PIM nac {agg['nat'][1]/1e9:.1f} mil M → cargado", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"  {y}: ERROR {repr(e)[:90]}", flush=True)
    print("LISTO", flush=True)


if __name__ == "__main__":
    main()
