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
I_SECTOR = 5
I_DEP, I_PROV, I_DIST = 11, 13, 15
I_DISTNOM, I_PROVNOM, I_DEPNOM = 16, 14, 12
I_FUNCION = 27
I_DEPMETA, I_DEPMETANOM = 35, 36
I_FUENTE = 38
I_PIA, I_PIM, I_CERT, I_DEV, I_GIR = 56, 57, 58, 61, 62

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
    if os.path.exists(os.path.join(OUT, f"por-funcion-{year}.json")) and os.path.exists(dest):
        print(f"  {year}: ya procesado, salto", flush=True)
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

    from collections import defaultdict
    def z(): return {"pia": 0.0, "pim": 0.0, "cert": 0.0, "dev": 0.0, "gir": 0.0}
    dist = {}                       # (ubigeo6, nivel) -> montos (ejecutora)
    func = defaultdict(z)           # funcion
    sect = defaultdict(z)           # sector
    nivg = defaultdict(z)           # nivel de gobierno
    fmeta = defaultdict(z)          # (ubigeoMeta2, funcion, nivel) -> explorador función×destino
    fuen = defaultdict(z)           # (ubigeoMeta2, fuente, nivel) -> explorador fuente×destino
    depmeta_nom = {}                # ubigeoMeta2 -> nombre
    nat = z()
    n = 0
    with open(csvpath, encoding="utf-8", errors="ignore", newline="") as fh:
        rd = csv.reader(fh)
        next(rd, None)
        for row in rd:
            if len(row) <= I_GIR:
                continue
            pia, pim, cert, dev, gir = f(row[I_PIA]), f(row[I_PIM]), f(row[I_CERT]), f(row[I_DEV]), f(row[I_GIR])
            niv = row[I_NIV].strip()
            funcion = row[I_FUNCION].strip() or "—"
            sector = row[I_SECTOR].strip() or "—"
            fuente = row[I_FUENTE].strip() or "—"
            n += 1
            nat["pia"] += pia; nat["pim"] += pim; nat["cert"] += cert; nat["dev"] += dev; nat["gir"] += gir
            for d, k in ((func[funcion], None), (sect[sector], None), (nivg[niv], None)):
                d["pia"] += pia; d["pim"] += pim; d["cert"] += cert; d["dev"] += dev; d["gir"] += gir
            # distrito (ejecutora)
            dep, prov, di = row[I_DEP].strip(), row[I_PROV].strip(), row[I_DIST].strip()
            if dep and prov and di and dep.isdigit():
                try:
                    ub = f"{int(dep):02d}{int(prov):02d}{int(di):02d}"
                    a = dist.get((ub, niv))
                    if a is None:
                        a = dist[(ub, niv)] = {"distrito": row[I_DISTNOM].strip(), "provincia": row[I_PROVNOM].strip(),
                                               "departamento": row[I_DEPNOM].strip(), "pia": 0.0, "pim": 0.0, "dev": 0.0, "gir": 0.0}
                    a["pia"] += pia; a["pim"] += pim; a["dev"] += dev; a["gir"] += gir
                except ValueError:
                    pass
            # destino META (departamento)
            dm = row[I_DEPMETA].strip()
            if dm and dm.isdigit():
                ubm = f"{int(dm):02d}"
                depmeta_nom[ubm] = row[I_DEPMETANOM].strip()
                fm = fmeta[(ubm, funcion, niv)]; fm["pim"] += pim; fm["dev"] += dev
                ff = fuen[(ubm, fuente, niv)]; ff["pim"] += pim; ff["dev"] += dev

    def w2(name, obj):
        json.dump(obj, open(os.path.join(OUT, name), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # 1) distrito
    drows = [{"ubigeo": ub, "departamento": a["departamento"], "provincia": a["provincia"], "distrito": a["distrito"],
              "nivel": niv, "pia": round(a["pia"], 2), "pim": round(a["pim"], 2),
              "devengado": round(a["dev"], 2), "girado": round(a["gir"], 2)} for (ub, niv), a in dist.items()]
    w2(f"por-distrito-{year}.json", drows)
    # 2) función / 3) sector
    w2(f"por-funcion-{year}.json", sorted([{"funcion": k, "pim": round(v["pim"], 2), "devengado": round(v["dev"], 2),
                                            "girado": round(v["gir"], 2)} for k, v in func.items() if k != "—"], key=lambda x: -x["pim"]))
    w2(f"por-sector-{year}.json", sorted([{"sector": k, "pim": round(v["pim"], 2), "devengado": round(v["dev"], 2)}
                                          for k, v in sect.items() if k != "—"], key=lambda x: -x["pim"]))
    # 4) flujo de fases / 5) nivel
    w2(f"flujo-fases-{year}.json", {"pia": round(nat["pia"], 2), "pim": round(nat["pim"], 2),
                                    "certificado": round(nat["cert"], 2), "devengado": round(nat["dev"], 2), "girado": round(nat["gir"], 2)})
    w2(f"por-nivel-{year}.json", [{"year": year, "nivel": k, "pia": round(v["pia"], 2), "pim": round(v["pim"], 2),
                                   "devengado": round(v["dev"], 2), "girado": round(v["gir"], 2)} for k, v in nivg.items()])
    # 6) explorador por destino (META): función×depto×nivel y fuente×depto×nivel
    w2(f"explorador-funcion-meta-{year}.json", [{"ubigeo": ub, "departamento": depmeta_nom.get(ub, ub), "funcion": fn, "nivel": nv,
                                                 "pim": round(v["pim"], 2), "devengado": round(v["dev"], 2)}
                                                for (ub, fn, nv), v in fmeta.items()])
    w2(f"explorador-fuente-meta-{year}.json", [{"ubigeo": ub, "departamento": depmeta_nom.get(ub, ub), "fuente": ft, "nivel": nv,
                                                "pim": round(v["pim"], 2), "devengado": round(v["dev"], 2)}
                                               for (ub, ft, nv), v in fuen.items()])
    os.remove(csvpath)
    ubs = len(set(ub for ub, _ in dist))
    print(f"  {year}: {n:,} filas → {len(drows)} distrito-nivel ({ubs} ubigeos), {len(func)} func, {len(sect)} sect; "
          f"PIM nac {nat['pim']/1e9:.1f} mil M → 7 archivos escritos; CSV borrado", flush=True)


if __name__ == "__main__":
    years = [int(a) for a in sys.argv[1:]] or [2024]
    for y in years:
        try:
            process(y)
        except Exception as e:
            print(f"  {y}: ERROR {repr(e)[:80]}", flush=True)
    print("LISTO", flush=True)
