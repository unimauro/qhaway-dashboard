#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Descarga los CSV anuales completos del gasto (fs.datosabiertos.mef.gob.pe) y agrega
por DISTRITO (ejecutora) + nivel de gobierno. Genera public/data/por-distrito-{año}.json.
Los CSV pesan ~7-10 GB; se descargan (resumible) a /tmp, se procesan en streaming y se borran.
Resumable: salta años cuyo JSON ya existe.

Accesible solo desde IP residencial (el WAF bloquea datacenters).
"""
import sys, os, csv, json, subprocess, time

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data")
TMP = "/tmp"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
BASE = "https://fs.datosabiertos.mef.gob.pe/datastorefiles/"

# índices 0-based en el CSV
I_ANO, I_NIV = 0, 3
I_DEP, I_PROV, I_DIST = 11, 13, 15
I_DISTNOM, I_PROVNOM, I_DEPNOM = 16, 14, 12
I_PIA, I_PIM, I_DEV, I_GIR = 56, 57, 61, 62

csv.field_size_limit(10_000_000)


def url_for(year):
    if year >= 2025:
        return f"{BASE}{year}-Gasto-Mensual.csv"
    return f"{BASE}{year}-Gasto.csv"


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def process(year):
    dest = os.path.join(OUT, f"por-distrito-{year}.json")
    if os.path.exists(dest) and year != 2025:  # 2025 ya existe vía API; recalcular el resto
        print(f"  {year}: ya existe, salto", flush=True)
        return
    csvpath = f"{TMP}/gasto_{year}.csv"
    url = url_for(year)
    # tamaño esperado (Content-Length)
    try:
        h = subprocess.run(["curl", "-sI", "--max-time", "30", "-A", UA, url], capture_output=True, text=True)
        expected = int(next(l.split(":")[1] for l in h.stdout.splitlines() if l.lower().startswith("content-length")))
    except Exception:
        expected = 0
    print(f"[{year}] descargando {url} ({expected/1e9:.1f} GB) con reanudación…", flush=True)
    t0 = time.time()
    # bucle de reanudación: curl -C - hasta completar (el server corta conexiones largas)
    for attempt in range(60):
        have = os.path.getsize(csvpath) if os.path.exists(csvpath) else 0
        if expected and have >= expected:
            break
        subprocess.run(["curl", "-s", "-C", "-", "--max-time", "180", "--retry", "3", "-A", UA, url, "-o", csvpath])
        now = os.path.getsize(csvpath) if os.path.exists(csvpath) else 0
        if attempt % 3 == 0:
            print(f"    {year}: {now/1e9:.2f}/{expected/1e9:.1f} GB [{time.time()-t0:.0f}s]", flush=True)
        if now == have:  # sin avance en este intento
            time.sleep(5)
    if not os.path.exists(csvpath) or (expected and os.path.getsize(csvpath) < expected * 0.98):
        print(f"  {year}: descarga incompleta ({os.path.getsize(csvpath) if os.path.exists(csvpath) else 0}/{expected}), salto", flush=True)
        return
    print(f"  {year}: descargado {os.path.getsize(csvpath)/1e9:.1f} GB en {time.time()-t0:.0f}s; agregando…", flush=True)

    agg = {}
    nat = 0.0
    n = 0
    with open(csvpath, encoding="utf-8", errors="ignore", newline="") as fh:
        rd = csv.reader(fh)
        next(rd, None)  # cabecera
        for row in rd:
            if len(row) <= I_GIR:
                continue
            dep, prov, dist = row[I_DEP].strip(), row[I_PROV].strip(), row[I_DIST].strip()
            if not (dep and prov and dist) or not dep.isdigit():
                continue
            try:
                ub = f"{int(dep):02d}{int(prov):02d}{int(dist):02d}"
            except ValueError:
                continue
            niv = row[I_NIV].strip()
            k = (ub, niv)
            a = agg.get(k)
            pim = f(row[I_PIM])
            nat += pim
            if a is None:
                a = agg[k] = {"distrito": row[I_DISTNOM].strip(), "provincia": row[I_PROVNOM].strip(),
                              "departamento": row[I_DEPNOM].strip(), "pia": 0.0, "pim": 0.0, "dev": 0.0, "gir": 0.0}
            a["pia"] += f(row[I_PIA]); a["pim"] += pim
            a["dev"] += f(row[I_DEV]); a["gir"] += f(row[I_GIR])
            n += 1
    rows = [{"ubigeo": ub, "departamento": a["departamento"], "provincia": a["provincia"], "distrito": a["distrito"],
             "nivel": niv, "pia": round(a["pia"], 2), "pim": round(a["pim"], 2),
             "devengado": round(a["dev"], 2), "girado": round(a["gir"], 2)}
            for (ub, niv), a in agg.items()]
    json.dump(rows, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.remove(csvpath)
    ubs = len(set(ub for ub, _ in agg))
    print(f"  {year}: {n:,} filas → {len(rows)} agregados, {ubs} ubigeos, PIM nac {nat/1e9:.1f} mil M → escrito; CSV borrado", flush=True)


if __name__ == "__main__":
    years = [int(a) for a in sys.argv[1:]] or [2024]
    for y in years:
        try:
            process(y)
        except Exception as e:
            print(f"  {y}: ERROR {repr(e)[:80]}", flush=True)
    print("LISTO", flush=True)
