#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ETL principal QHAWAY — presupuesto del MEF (SIAF, Datos Abiertos).

La API SQL del MEF (datastore_search_sql) fue retirada en sep-2026 (HTTP 404). Este ETL usa ahora
los archivos anuales COMPLETOS del dataset «Presupuesto y Ejecución de Gasto» (un CSV por año,
publicado también como ZIP), descubiertos por etl/discover_annual.py → etl/resource_map.json.
Descarga el ZIP (reanudable), lo recorre en streaming (sin descomprimir a disco) y agrega en memoria.

Uso:
  python etl/build_mef.py              # años cuyo archivo cambió desde el último corte (meta.json)
  python etl/build_mef.py 2026 2025    # años concretos
  python etl/build_mef.py all          # todos los años de la ventana (FIRST_YEAR..último)
  JOBS=4 python etl/build_mef.py all   # procesos en paralelo (por defecto 3)

Escribe en public/data/ (mismos esquemas que antes):
  por año: por-distrito-Y, por-funcion-Y, por-sector-Y, por-nivel-Y, flujo-fases-Y,
           explorador-funcion-meta-Y, explorador-fuente-meta-Y, evolucion-mensual-Y
  multi-año (merge por año): serie-nacional, serie-historica-oficial, por-departamento-historico
  del último año: por-departamento.json, por-nivel-gobierno.json;  meta.json
"""
import csv, datetime, io, json, os, sys, time, urllib.request, zipfile
from collections import defaultdict
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "data")
TMP = os.environ.get("QHAWAY_TMP") or os.path.join(os.environ.get("RUNNER_TEMP") or os.environ.get("TMPDIR") or "/tmp")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (qhaway-etl)"
FIRST_YEAR = 2012  # 2009-2011 existen en el MEF, pero el front trata <2012 como no confiable
DATASET_URL = "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto"
csv.field_size_limit(10_000_000)


def load_json(name, default):
    try:
        with open(os.path.join(OUT, name), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def w(name, obj):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"   -> {name} ({os.path.getsize(p)/1024:.0f} KB)", flush=True)


def rnd(v):
    return round(v, 2)


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------- descarga
def download(url, dest, expected):
    """Descarga reanudable (Range) con reintentos; el servidor corta conexiones largas."""
    t0 = time.time()
    for attempt in range(30):
        have = os.path.getsize(dest) if os.path.exists(dest) else 0
        if expected and have >= expected:
            break
        if expected and have > expected:  # basura de una corrida previa
            os.remove(dest); have = 0
        h = {"User-Agent": UA}
        if have:
            h["Range"] = f"bytes={have}-"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120) as r:
                mode = "ab" if (have and r.status == 206) else "wb"
                with open(dest, mode) as fh:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        fh.write(b)
            if not expected:
                break
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise RuntimeError(f"HTTP {e.code} al descargar {url} (¿WAF bloquea esta IP?)") from e
            print(f"    reintento {attempt}: HTTP {e.code}", flush=True); time.sleep(5)
        except Exception as e:
            print(f"    reintento {attempt}: {repr(e)[:70]}", flush=True); time.sleep(5)
    size = os.path.getsize(dest) if os.path.exists(dest) else 0
    if expected and size < expected:
        raise RuntimeError(f"descarga incompleta {size}/{expected} bytes de {url}")
    print(f"    {os.path.basename(dest)}: {size/1e9:.2f} GB en {time.time()-t0:.0f}s", flush=True)
    return dest


def open_rows(info, year):
    """Devuelve (path_temporal, iterador de filas csv). Prefiere el ZIP; cae al CSV."""
    src = info.get("zip") or info["csv"]
    ext = ".zip" if info.get("zip") else ".csv"
    dest = os.path.join(TMP, f"qhaway_gasto_{year}{ext}")
    download(src, dest, info.get("size") or 0)
    if ext == ".zip":
        zf = zipfile.ZipFile(dest)
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        fh = io.TextIOWrapper(zf.open(name), encoding="utf-8", errors="ignore", newline="")
    else:
        fh = open(dest, encoding="utf-8", errors="ignore", newline="")
    return dest, csv.reader(fh)


# ---------------------------------------------------------------- agregación
def aggregate(args):
    year, info = args
    t0 = time.time()
    print(f"[{year}] descargando {info.get('zip') or info['csv']}", flush=True)
    dest, rd = open_rows(info, year)
    hdr = [h.strip().upper() for h in next(rd)]
    ix = {h: i for i, h in enumerate(hdr)}
    need = ["ANO_EJE", "MES_EJE", "NIVEL_GOBIERNO_NOMBRE", "SECTOR_NOMBRE", "DEPARTAMENTO_EJECUTORA",
            "DEPARTAMENTO_EJECUTORA_NOMBRE", "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE",
            "DISTRITO_EJECUTORA", "DISTRITO_EJECUTORA_NOMBRE", "FUNCION_NOMBRE", "DEPARTAMENTO_META",
            "DEPARTAMENTO_META_NOMBRE", "FUENTE_FINANCIAMIENTO_NOMBRE", "MONTO_PIA", "MONTO_PIM",
            "MONTO_CERTIFICADO", "MONTO_DEVENGADO", "MONTO_GIRADO"]
    miss = [c for c in need if c not in ix]
    if miss:
        raise RuntimeError(f"{year}: el CSV del MEF cambió de esquema; faltan columnas {miss}")
    (I_ANO, I_MES, I_NIV, I_SEC, I_DEP, I_DEPN, I_PROV, I_PROVN, I_DIST, I_DISTN, I_FUN, I_DM, I_DMN,
     I_FUE, I_PIA, I_PIM, I_CERT, I_DEV, I_GIR) = [ix[c] for c in need]
    last = max(I_PIA, I_PIM, I_CERT, I_DEV, I_GIR)

    def z():
        return [0.0, 0.0, 0.0, 0.0, 0.0]  # pia, pim, cert, dev, gir
    nat = z()
    func, sect, nivg, dmeta, depej, mes = (defaultdict(z) for _ in range(6))
    fmeta, fuen = defaultdict(z), defaultdict(z)
    dist, dnom, depejn = {}, {}, {}
    n = bad_year = 0
    for r in rd:
        if len(r) <= last:
            continue
        if r[I_ANO].strip() != str(year):
            bad_year += 1
            continue
        v = (fnum(r[I_PIA]), fnum(r[I_PIM]), fnum(r[I_CERT]), fnum(r[I_DEV]), fnum(r[I_GIR]))
        niv = r[I_NIV].strip() or "—"
        fn = r[I_FUN].strip() or "—"
        se = r[I_SEC].strip() or "—"
        fu = r[I_FUE].strip() or "—"
        n += 1
        for a in (nat, func[fn], sect[se], nivg[niv]):
            a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; a[3] += v[3]; a[4] += v[4]
        try:
            m = mes[int(r[I_MES])]
            m[1] += v[1]; m[3] += v[3]; m[4] += v[4]
        except ValueError:
            pass
        dep, prov, di = r[I_DEP].strip(), r[I_PROV].strip(), r[I_DIST].strip()
        if dep.isdigit() and prov.isdigit() and di.isdigit():
            ub = f"{int(dep):02d}{int(prov):02d}{int(di):02d}"
            a = dist.get((ub, niv))
            if a is None:
                a = dist[(ub, niv)] = [r[I_DEPN].strip(), r[I_PROVN].strip(), r[I_DISTN].strip(), 0.0, 0.0, 0.0, 0.0]
            a[3] += v[0]; a[4] += v[1]; a[5] += v[3]; a[6] += v[4]
            ubd = ub[:2]
            depejn[ubd] = r[I_DEPN].strip()
            d = depej[(ubd, niv)]
            d[0] += v[0]; d[1] += v[1]; d[3] += v[3]; d[4] += v[4]
        dm = r[I_DM].strip()
        if dm.isdigit():
            ubm = f"{int(dm):02d}"
            dnom[ubm] = r[I_DMN].strip()
            a = fmeta[(ubm, fn, niv)]; a[1] += v[1]; a[3] += v[3]
            a = fuen[(ubm, fu, niv)]; a[1] += v[1]; a[3] += v[3]
            a = dmeta[ubm]
            a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; a[3] += v[3]; a[4] += v[4]
    try:
        os.remove(dest)
    except OSError:
        pass
    mes_corte = max([k for k, a in mes.items() if a[3] != 0] or [0])
    print(f"[{year}] {n:,} filas (descartadas {bad_year}) · mes máx. con devengado {mes_corte} · "
          f"PIM {nat[1]/1e9:.1f} · Dev {nat[3]/1e9:.1f} mil M · {time.time()-t0:.0f}s", flush=True)
    if n == 0 or nat[1] <= 0:
        raise RuntimeError(f"{year}: archivo vacío o sin PIM")
    return dict(year=year, n=n, nat=nat, func=dict(func), sect=dict(sect), nivg=dict(nivg),
                dmeta=dict(dmeta), dnom=dnom, depej=dict(depej), depejn=depejn, mes=dict(mes),
                fmeta=dict(fmeta), fuen=dict(fuen), dist=dist, mes_corte=mes_corte)


def safe_aggregate(args):
    try:
        return aggregate(args)
    except Exception as e:
        print(f"[{args[0]}] FALLÓ: {e}", flush=True)
        return None


# ---------------------------------------------------------------- escritura
GEO = load_json("distritos.geojson", {"features": []})
NAMES = {ft["properties"]["IDDIST"]: (ft["properties"]["NOMBDIST"], ft["properties"]["NOMBPROV"],
                                      ft["properties"]["NOMBDEP"]) for ft in GEO["features"]}


def escribir_anio(a):
    y, nat = a["year"], a["nat"]
    drows = []
    for (ub, niv), v in sorted(a["dist"].items()):
        dn, pn, depn = NAMES.get(ub, (v[2], v[1], v[0]))
        drows.append({"ubigeo": ub, "departamento": depn, "provincia": pn, "distrito": dn, "nivel": niv,
                      "pia": rnd(v[3]), "pim": rnd(v[4]), "devengado": rnd(v[5]), "girado": rnd(v[6])})
    w(f"por-distrito-{y}.json", drows)
    w(f"por-funcion-{y}.json", sorted(
        [{"funcion": k, "pim": rnd(v[1]), "devengado": rnd(v[3]), "girado": rnd(v[4])}
         for k, v in a["func"].items() if k != "—"], key=lambda r: -r["pim"]))
    # Las municipalidades no tienen sector en el SIAF (vacío) → "GOBIERNOS LOCALES"
    sect = defaultdict(lambda: [0.0, 0.0])
    for k, v in a["sect"].items():
        s = sect["GOBIERNOS LOCALES" if k == "—" else k]
        s[0] += v[1]; s[1] += v[3]
    w(f"por-sector-{y}.json", sorted([{"sector": k, "pim": rnd(v[0]), "devengado": rnd(v[1])}
                                      for k, v in sect.items()], key=lambda r: -r["pim"]))
    w(f"por-nivel-{y}.json", sorted([{"year": y, "nivel": k, "pia": rnd(v[0]), "pim": rnd(v[1]),
                                      "devengado": rnd(v[3]), "girado": rnd(v[4])}
                                     for k, v in a["nivg"].items()], key=lambda r: -r["pim"]))
    w(f"flujo-fases-{y}.json", {"pia": rnd(nat[0]), "pim": rnd(nat[1]), "certificado": rnd(nat[2]),
                                "devengado": rnd(nat[3]), "girado": rnd(nat[4])})
    w(f"explorador-funcion-meta-{y}.json", [
        {"ubigeo": ub, "departamento": a["dnom"].get(ub, ub), "funcion": fn, "nivel": nv,
         "pim": rnd(v[1]), "devengado": rnd(v[3])} for (ub, fn, nv), v in sorted(a["fmeta"].items())])
    w(f"explorador-fuente-meta-{y}.json", [
        {"ubigeo": ub, "departamento": a["dnom"].get(ub, ub), "fuente": ft, "nivel": nv,
         "pim": rnd(v[1]), "devengado": rnd(v[3])} for (ub, ft, nv), v in sorted(a["fuen"].items())])
    acc_d = acc_g = 0.0
    evol = []
    for m in range(1, (a["mes_corte"] or 0) + 1):
        v = a["mes"].get(m, [0.0] * 5)
        acc_d += v[3]; acc_g += v[4]
        evol.append({"mes": m, "devengado": rnd(v[3]), "girado": rnd(v[4]), "devengadoAcum": rnd(acc_d),
                     "giradoAcum": rnd(acc_g), "pim": rnd(nat[1])})
    w(f"evolucion-mensual-{y}.json", evol)


def merge_years(name, rows_by_year, sort_key):
    prev = [r for r in load_json(name, []) if r.get("year") not in rows_by_year]
    for rows in rows_by_year.values():
        prev.extend(rows)
    prev.sort(key=sort_key)
    w(name, prev)


def main():
    rmap_path = os.path.join(HERE, "resource_map.json")
    try:
        RMAP = {int(y): v for y, v in json.load(open(rmap_path)).items() if isinstance(v, dict) and v.get("csv")}
    except Exception as e:
        sys.exit(f"ERROR: no se pudo leer {rmap_path} ({e}). Corre antes: python etl/discover_annual.py")
    if not RMAP:
        sys.exit("ERROR: resource_map.json no tiene años con CSV. Corre antes: python etl/discover_annual.py")

    meta_prev = load_json("meta.json", {})
    prev_cortes = meta_prev.get("cortes", {})
    window = [y for y in sorted(RMAP) if y >= FIRST_YEAR]
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args and args[0] == "all":
        years = window
    elif args:
        years = [int(a) for a in args if int(a) in RMAP]
    else:  # solo los años cuyo archivo cambió (o que nunca se procesaron con este ETL)
        years = [y for y in window if prev_cortes.get(str(y), {}).get("archivo") != RMAP[y]["lastModified"]]
    if not years:
        print("Sin archivos nuevos del MEF desde el último corte; nada que hacer.", flush=True)
        return
    jobs = max(1, int(os.environ.get("JOBS", "3")))
    print(f"Años a procesar: {years} (jobs={jobs}, tmp={TMP})", flush=True)

    with Pool(min(jobs, len(years))) as pool:
        results = [r for r in pool.map(safe_aggregate, [(y, RMAP[y]) for y in years], chunksize=1) if r]
    ok = {r["year"]: r for r in results}
    failed = [y for y in years if y not in ok]
    if not ok:
        sys.exit("ERROR: no se pudo procesar ningún año (ver mensajes arriba). Los JSON existentes NO se tocaron.")

    for y in sorted(ok):
        print(f"[{y}] escribiendo…", flush=True)
        escribir_anio(ok[y])

    def nat_row(a):
        n = a["nat"]
        return {"year": a["year"], "pia": rnd(n[0]), "pim": rnd(n[1]), "certificado": rnd(n[2]),
                "devengado": rnd(n[3]), "girado": rnd(n[4])}
    merge_years("serie-nacional.json", {y: [nat_row(a)] for y, a in ok.items()}, lambda r: r["year"])
    merge_years("serie-historica-oficial.json", {y: [nat_row(a)] for y, a in ok.items()}, lambda r: r["year"])
    merge_years("por-departamento-historico.json", {y: [
        {"year": y, "pia": rnd(v[0]), "pim": rnd(v[1]), "certificado": rnd(v[2]), "devengado": rnd(v[3]),
         "girado": rnd(v[4]), "ubigeo": ub, "departamento": a["dnom"].get(ub, ub)}
        for ub, v in sorted(a["dmeta"].items())] for y, a in ok.items()}, lambda r: (r["year"], r["ubigeo"]))

    # Archivos "del año principal" (el más reciente disponible)
    PY = max(RMAP)
    if PY in ok:
        a = ok[PY]
        w("por-departamento.json", [
            {"year": PY, "ubigeo": ub, "departamento": a["depejn"].get(ub, ub), "nivel": niv, "pia": rnd(v[0]),
             "pim": rnd(v[1]), "devengado": rnd(v[3]), "girado": rnd(v[4])}
            for (ub, niv), v in sorted(a["depej"].items())])
        w("por-nivel-gobierno.json", load_json(f"por-nivel-{PY}.json", []))

    # meta.json
    serie_years = sorted(r["year"] for r in load_json("serie-nacional.json", []) if r["year"] >= FIRST_YEAR)
    cortes = {k: v for k, v in prev_cortes.items() if int(k) in RMAP}
    for y, a in ok.items():
        cortes[str(y)] = {"archivo": RMAP[y]["lastModified"], "mesMax": a["mes_corte"], "filas": a["n"]}
    dist_years = sorted(y for y in serie_years if os.path.exists(os.path.join(OUT, f"por-distrito-{y}.json")))
    today = datetime.date.today().isoformat()
    meta = {
        "years": serie_years, "latestYear": max(serie_years), "distritoYear": PY, "distritoYears": dist_years,
        "lastUpdate": today if not failed else meta_prev.get("lastUpdate", today),
        "corteDatos": RMAP[PY]["lastModified"][:10],
        "fases": ["pia", "pim", "certificado", "devengado", "girado"],
        "sources": [
            {"name": "MEF — Datos Abiertos (Presupuesto y Ejecución de Gasto, SIAF; CSV anuales)",
             "url": DATASET_URL, "endpoint": RMAP[PY].get("zip") or RMAP[PY]["csv"]},
            {"name": "IDH 2019 (PNUD) y pobreza/vulnerabilidad (INEI)", "url": "https://www.inei.gob.pe"},
            {"name": "Riesgos: IGP, SENAMHI, CENEPRED, INDECI, INAIGEM, MINAM", "url": "https://sigrid.cenepred.gob.pe"},
        ],
        "notas": (f"Datos reales del SIAF-MEF (archivos anuales completos de Datos Abiertos). La serie nacional cubre "
                  f"{min(serie_years)}–{max(serie_years)}; {PY} es el ejercicio en curso (corte del archivo MEF "
                  f"{RMAP[PY]['lastModified'][:10]}, ejecución hasta el mes {cortes.get(str(PY), {}).get('mesMax', '?')}). "
                  "La ubicación del detalle distrital corresponde a la UNIDAD EJECUTORA, no al lugar físico de la "
                  "obra; el gobierno nacional concentra ejecución en Lima — para lectura territorial filtrar a "
                  "Gobiernos Locales/Regionales o usar la atribución por destino (META). Las cifras pueden diferir "
                  "de Consulta Amigable por fecha de corte y agregación."),
        "cortes": dict(sorted(cortes.items())),
        "resourceIds": {str(y): RMAP[y].get("id") for y in serie_years if y in RMAP},
    }
    for k in ("parcial",):  # preserva campos opcionales que otros scripts puedan haber puesto
        if k in meta_prev:
            meta[k] = meta_prev[k]
    w("meta.json", meta)
    if failed:
        print(f"AVISO: fallaron {failed}; sus JSON quedaron como estaban.", flush=True)
        sys.exit(2)
    print("LISTO ✓", flush=True)


if __name__ == "__main__":
    main()
