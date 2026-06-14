#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Migración LOCAL del presupuesto MEF — corre en tu Mac, sin VPS, sin Postgres, sin pip.

Descarga los CSV anuales completos del MEF (fs.datosabiertos.mef.gob.pe), los agrega y
escribe los JSON por año en `public/data/` (las MISMAS formas que consume el dashboard
como respaldo estático y que carga `load_json.py` hacia el Postgres del VPS).

Así puedes:
  • correr todo en local (tu conexión, sin cargar el VPS), y LUEGO
  • `git commit` los JSON  → datos estáticos del sitio (funciona aunque el VPS esté caído), o
  • subirlos al VPS con load_json.py cuando quieras que la API los sirva.

Solo necesita Python 3 + curl (ambos vienen en macOS). NO requiere paquetes ni venv.

Uso:
  python3 etl/migrar_local.py 2023 2022 2021            # años específicos
  python3 etl/migrar_local.py all                       # 2012..2026
  python3 etl/migrar_local.py 2023 --force              # rehace aunque ya exista el JSON
  KEEP_CSV=1 python3 etl/migrar_local.py 2023           # no borra el CSV de /tmp al terminar

Idempotente: salta un año si ya existe su por-distrito-YYYY.json (salvo --force).
"""
import os
import sys
import csv
import json
import time
import subprocess
from collections import defaultdict

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120 Safari/537.36"
BASE = "https://fs.datosabiertos.mef.gob.pe/datastorefiles/"
TMP = os.environ.get("TMPDIR", "/tmp").rstrip("/")
# Salida: public/data del repo (relativo a este archivo: etl/ -> ../public/data)
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "data"))
KEEP_CSV = os.environ.get("KEEP_CSV", "") not in ("", "0", "false")
csv.field_size_limit(10_000_000)

# índices 0-based de las columnas del CSV del MEF (idénticos al loader del VPS)
I_NIV, I_SECTOR = 3, 5
I_DEP, I_PROV, I_DIST = 11, 13, 15
I_DEPNOM, I_PROVNOM, I_DISTNOM = 12, 14, 16
I_FUNCION = 27
I_DEPMETA, I_DEPMETANOM = 35, 36
I_FUENTE = 38
I_PIA, I_PIM, I_CERT, I_DEV, I_GIR = 56, 57, 58, 61, 62


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def rnd(v):
    return round(v, 2)


def url_for(year):
    return f"{BASE}{year}-Gasto-Mensual.csv" if year >= 2025 else f"{BASE}{year}-Gasto.csv"


def download(year):
    """Descarga CONTINUA y robusta (sin cortar cada pocos min; aborta solo en estancamiento real)."""
    path = f"{TMP}/gasto_{year}.csv"
    url = url_for(year)
    try:
        h = subprocess.run(["curl", "-sI", "--max-time", "30", "-A", UA, url],
                           capture_output=True, text=True)
        expected = int(next(l.split(":")[1] for l in h.stdout.splitlines()
                            if l.lower().startswith("content-length")))
    except Exception:
        expected = 0
    print(f"[{year}] descargando ({expected/1e9:.1f} GB)…", flush=True)
    t0 = time.time()
    stalls = 0
    for _ in range(40):
        have = os.path.getsize(path) if os.path.exists(path) else 0
        if expected and have >= expected * 0.98:
            break
        subprocess.run(["curl", "-#", "-C", "-", "--retry", "8", "--retry-delay", "15",
                        "--retry-all-errors", "--speed-limit", "25000", "--speed-time", "120",
                        "-A", UA, url, "-o", path])
        now = os.path.getsize(path) if os.path.exists(path) else 0
        if now <= have:
            stalls += 1
            if stalls >= 3:
                try:
                    os.remove(path)
                except OSError:
                    pass
                stalls = 0
            time.sleep(8)
        else:
            stalls = 0
    ok = os.path.exists(path) and (not expected or os.path.getsize(path) >= expected * 0.98)
    print(f"  {year}: {'OK' if ok else 'INCOMPLETO'} {os.path.getsize(path)/1e9:.1f} GB en {time.time()-t0:.0f}s",
          flush=True)
    return path if ok else None


def aggregate(path):
    """Recorre el CSV en streaming y agrega a diccionarios (poca RAM: solo agregados)."""
    def z():
        return [0.0, 0.0, 0.0, 0.0, 0.0]  # pia,pim,cert,dev,gir
    dist = {}                                # (ubigeo,nivel) -> [depnom,provnom,distnom,pia,pim,dev,gir]
    func, sect, nivg = defaultdict(z), defaultdict(z), defaultdict(z)
    fmeta, fuen, dmeta = defaultdict(z), defaultdict(z), defaultdict(z)
    dnom = {}
    nat = z()
    n = 0
    with open(path, encoding="utf-8", errors="ignore", newline="") as fh:
        rd = csv.reader(fh)
        next(rd, None)
        for r in rd:
            if len(r) <= I_GIR:
                continue
            pia, pim, cert, dev, gir = f(r[I_PIA]), f(r[I_PIM]), f(r[I_CERT]), f(r[I_DEV]), f(r[I_GIR])
            niv = r[I_NIV].strip()
            fn = r[I_FUNCION].strip() or "—"
            se = r[I_SECTOR].strip() or "—"
            fu = r[I_FUENTE].strip() or "—"
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
                        a = dist[(ub, niv)] = [r[I_DEPNOM].strip(), r[I_PROVNOM].strip(),
                                               r[I_DISTNOM].strip(), 0.0, 0.0, 0.0, 0.0]
                    a[3] += pia
                    a[4] += pim
                    a[5] += dev
                    a[6] += gir
                except ValueError:
                    pass
            dm = r[I_DEPMETA].strip()
            if dm and dm.isdigit():
                ubm = f"{int(dm):02d}"
                dnom[ubm] = r[I_DEPMETANOM].strip()
                m = fmeta[(ubm, fn, niv)]
                m[1] += pim
                m[3] += dev
                g = fuen[(ubm, fu, niv)]
                g[1] += pim
                g[3] += dev
                d = dmeta[ubm]
                d[0] += pia
                d[1] += pim
                d[2] += cert
                d[3] += dev
                d[4] += gir
    return dict(dist=dist, func=func, sect=sect, nivg=nivg, fmeta=fmeta, fuen=fuen,
                dmeta=dmeta, dnom=dnom, nat=nat, n=n)


def write_json(name, obj):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def merge_year(name, year, filas, key="year"):
    """Carga un JSON multi-año existente, reemplaza las filas del `year` por las nuevas, reescribe."""
    p = os.path.join(OUT, name)
    prev = []
    if os.path.exists(p):
        try:
            prev = json.load(open(p, encoding="utf-8"))
        except Exception:
            prev = []
    prev = [r for r in prev if r.get(key) != year]
    prev.extend(filas)
    prev.sort(key=lambda r: (r.get(key, 0), r.get("ubigeo", "")))
    write_json(name, prev)


def escribir_anio(year, agg):
    # por-distrito-YYYY.json
    write_json(f"por-distrito-{year}.json", [
        {"ubigeo": ub, "departamento": a[0], "provincia": a[1], "distrito": a[2], "nivel": niv,
         "pia": rnd(a[3]), "pim": rnd(a[4]), "devengado": rnd(a[5]), "girado": rnd(a[6])}
        for (ub, niv), a in agg["dist"].items()
    ])
    # por-funcion-YYYY.json
    write_json(f"por-funcion-{year}.json", [
        {"funcion": k, "pim": rnd(v[1]), "devengado": rnd(v[3]), "girado": rnd(v[4])}
        for k, v in agg["func"].items() if k != "—"
    ])
    # por-sector-YYYY.json — las municipalidades no tienen sector ("—") → "GOBIERNOS LOCALES"
    write_json(f"por-sector-{year}.json", [
        {"sector": ("GOBIERNOS LOCALES" if k == "—" else k), "pim": rnd(v[1]), "devengado": rnd(v[3])}
        for k, v in agg["sect"].items()
    ])
    # por-nivel-YYYY.json
    write_json(f"por-nivel-{year}.json", [
        {"year": year, "nivel": k, "pia": rnd(v[0]), "pim": rnd(v[1]), "devengado": rnd(v[3]), "girado": rnd(v[4])}
        for k, v in agg["nivg"].items()
    ])
    # explorador-funcion-meta-YYYY.json (destino META × función × nivel)
    write_json(f"explorador-funcion-meta-{year}.json", [
        {"ubigeo": ub, "departamento": agg["dnom"].get(ub, ub), "funcion": fn, "nivel": nv,
         "pim": rnd(v[1]), "devengado": rnd(v[3])}
        for (ub, fn, nv), v in agg["fmeta"].items()
    ])
    # explorador-fuente-meta-YYYY.json
    write_json(f"explorador-fuente-meta-{year}.json", [
        {"ubigeo": ub, "departamento": agg["dnom"].get(ub, ub), "fuente": ft, "nivel": nv,
         "pim": rnd(v[1]), "devengado": rnd(v[3])}
        for (ub, ft, nv), v in agg["fuen"].items()
    ])
    # series multi-año (merge por año): nacional + por departamento (destino META)
    nat = agg["nat"]
    merge_year("serie-historica-oficial.json", year, [
        {"year": year, "pia": rnd(nat[0]), "pim": rnd(nat[1]), "certificado": rnd(nat[2]),
         "devengado": rnd(nat[3]), "girado": rnd(nat[4])}
    ])
    merge_year("por-departamento-historico.json", year, [
        {"year": year, "ubigeo": ub, "departamento": agg["dnom"].get(ub, ub), "pia": rnd(v[0]),
         "pim": rnd(v[1]), "certificado": rnd(v[2]), "devengado": rnd(v[3]), "girado": rnd(v[4])}
        for ub, v in agg["dmeta"].items()
    ])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    force = "--force" in sys.argv
    years = list(range(2012, 2027)) if (not args or args[0] == "all") else [int(a) for a in args]
    print(f"Salida → {OUT}\nAños: {years}  (force={force}, keep_csv={KEEP_CSV})\n", flush=True)
    for y in years:
        destino = os.path.join(OUT, f"por-distrito-{y}.json")
        if os.path.exists(destino) and not force:
            print(f"[{y}] ya existe {os.path.basename(destino)} → skip (usa --force para rehacer)", flush=True)
            continue
        path = download(y)
        if not path:
            print(f"  {y}: descarga incompleta → skip", flush=True)
            continue
        print(f"  {y}: agregando…", flush=True)
        agg = aggregate(path)
        escribir_anio(y, agg)
        ubs = len({ub for ub, _ in agg["dist"]})
        print(f"  {y}: {agg['n']:,} filas → {ubs} ubigeos, PIM nac {agg['nat'][1]/1e9:.1f} mil M → JSON escrito",
              flush=True)
        if not KEEP_CSV:
            try:
                os.remove(path)
            except OSError:
                pass
    print("\nLISTO. Revisa public/data/, luego: git add public/data && git commit  (o súbelos al VPS).", flush=True)


if __name__ == "__main__":
    main()
