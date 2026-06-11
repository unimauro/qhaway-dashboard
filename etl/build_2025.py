#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ETL focalizado QHAWAY: JSON de presupuesto del MEF (SIAF, Datos Abiertos).
Consulta agregada server-side. Nombres territoriales resueltos desde el GeoJSON
para aligerar el escaneo de la tabla 2025 (11.4M filas). Resiliente: cada consulta
se aísla; lo que completa se escribe aunque otra falle.
"""
import json, os, urllib.parse, urllib.request, time

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "public", "data")
RIDS = {2025: "77fc3228-fa6f-4c1f-a0ed-d32520ad11ad",
        2024: "42477a87-ee45-4df2-9c6f-ccd63c2b1411"}
DIST_YEARS = [2025, 2024]

# ubigeo(6) -> (distrito, provincia, departamento) desde el GeoJSON
GEO = json.load(open(os.path.join(OUT, "distritos.geojson"), encoding="utf-8"))
NAMES, DEPN = {}, {}
for ft in GEO["features"]:
    p = ft["properties"]
    NAMES[p["IDDIST"]] = (p["NOMBDIST"], p["NOMBPROV"], p["NOMBDEP"])
    DEPN[p["IDDPTO"]] = p["NOMBDEP"]


def sql(q, retries=2, timeout=290):
    url = API + "?sql=" + urllib.parse.quote(q)
    for i in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.load(r).get("records", [])
        except Exception as e:
            print("   retry", i, repr(e)[:80], flush=True)
            if i == retries:
                raise
            time.sleep(5)


def fnum(x):
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def w(name, obj):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"   -> {name} ({os.path.getsize(p)/1024:.0f} KB)", flush=True)


serie, por_dep, por_nivel = [], [], []

for year in DIST_YEARS:
    rid = RIDS[year]
    print(f"[{year}] territorial…", flush=True)
    try:
        recs = sql(
            f'SELECT "DEPARTAMENTO_EJECUTORA" dep,"PROVINCIA_EJECUTORA" prov,"DISTRITO_EJECUTORA" dist,'
            f'MAX("NIVEL_GOBIERNO_NOMBRE") nivel,'
            f'SUM("MONTO_PIA"::numeric) pia,SUM("MONTO_PIM"::numeric) pim,'
            f'SUM("MONTO_CERTIFICADO"::numeric) cert,SUM("MONTO_DEVENGADO"::numeric) dev,'
            f'SUM("MONTO_GIRADO"::numeric) gir FROM "{rid}" GROUP BY 1,2,3'
        )
    except Exception as e:
        print(f"   [{year}] FALLÓ territorial: {e}", flush=True)
        continue

    dist_rows, dep_agg, niv_agg = [], {}, {}
    nat = {"pia": 0, "pim": 0, "cert": 0, "dev": 0, "gir": 0}
    for r in recs:
        dep, prov, di = (r.get("dep") or ""), (r.get("prov") or ""), (r.get("dist") or "")
        pia, pim, cert, dev, gir = map(fnum, (r["pia"], r["pim"], r["cert"], r["dev"], r["gir"]))
        nat["pia"] += pia; nat["pim"] += pim; nat["cert"] += cert; nat["dev"] += dev; nat["gir"] += gir
        niv = r.get("nivel") or "—"
        n = niv_agg.setdefault(niv, {"pia": 0, "pim": 0, "dev": 0, "gir": 0})
        n["pia"] += pia; n["pim"] += pim; n["dev"] += dev; n["gir"] += gir
        if not (dep and prov and di):
            continue
        try:
            ub = f"{int(dep):02d}{int(prov):02d}{int(di):02d}"; ubd = f"{int(dep):02d}"
        except ValueError:
            continue
        dn, pn, depn = NAMES.get(ub, (r.get("dist") or ub, r.get("prov") or "", DEPN.get(ubd, "")))
        dist_rows.append({"ubigeo": ub, "departamento": depn, "provincia": pn, "distrito": dn,
                          "nivel": niv, "pia": pia, "pim": pim, "devengado": dev, "girado": gir})
        d = dep_agg.setdefault((ubd, depn, niv), {"pia": 0, "pim": 0, "dev": 0, "gir": 0})
        d["pia"] += pia; d["pim"] += pim; d["dev"] += dev; d["gir"] += gir

    w(f"por-distrito-{year}.json", dist_rows)
    serie.append({"year": year, "pia": round(nat["pia"], 2), "pim": round(nat["pim"], 2),
                  "certificado": round(nat["cert"], 2), "devengado": round(nat["dev"], 2), "girado": round(nat["gir"], 2)})
    for (ub, dn, niv), v in dep_agg.items():
        por_dep.append({"year": year, "ubigeo": ub, "departamento": dn, "nivel": niv,
                        "pia": round(v["pia"], 2), "pim": round(v["pim"], 2), "devengado": round(v["dev"], 2), "girado": round(v["gir"], 2)})
    for niv, v in niv_agg.items():
        por_nivel.append({"year": year, "nivel": niv, "pia": round(v["pia"], 2), "pim": round(v["pim"], 2),
                          "devengado": round(v["dev"], 2), "girado": round(v["gir"], 2)})
    if year == 2025:
        w("flujo-fases-2025.json", {"pia": round(nat["pia"], 2), "pim": round(nat["pim"], 2),
                                    "certificado": round(nat["cert"], 2), "devengado": round(nat["dev"], 2), "girado": round(nat["gir"], 2)})
    print(f"   {year}: PIM {nat['pim']/1e9:.1f} mil M · Dev {nat['dev']/1e9:.1f} mil M · {len(dist_rows)} distritos · niveles={list(niv_agg)}", flush=True)

# Escribe agregados acumulados (aunque falte algún año)
if serie:
    serie.sort(key=lambda x: x["year"])
    w("serie-nacional.json", serie)
    w("por-departamento.json", por_dep)
    w("por-nivel-gobierno.json", por_nivel)

# Función y sector (2025) — un escaneo cada uno, aislados
for fname, col, label, extra in [
    ("por-funcion-2025.json", "FUNCION_NOMBRE", "funcion", True),
    ("por-sector-2025.json", "SECTOR_NOMBRE", "sector", False),
]:
    print(f"[2025] por {label}…", flush=True)
    try:
        if extra:
            rr = sql(f'SELECT "{col}" k,SUM("MONTO_PIM"::numeric) pim,SUM("MONTO_DEVENGADO"::numeric) dev,'
                     f'SUM("MONTO_GIRADO"::numeric) gir FROM "{RIDS[2025]}" GROUP BY 1 ORDER BY 2 DESC')
            w(fname, [{"funcion": r["k"] or "—", "pim": fnum(r["pim"]), "devengado": fnum(r["dev"]), "girado": fnum(r["gir"])} for r in rr if r.get("k")])
        else:
            rr = sql(f'SELECT "{col}" k,SUM("MONTO_PIM"::numeric) pim,SUM("MONTO_DEVENGADO"::numeric) dev '
                     f'FROM "{RIDS[2025]}" GROUP BY 1 ORDER BY 2 DESC')
            w(fname, [{"sector": r["k"] or "—", "pim": fnum(r["pim"]), "devengado": fnum(r["dev"])} for r in rr if r.get("k")])
    except Exception as e:
        print(f"   FALLÓ {label}: {e}", flush=True)

# meta.json
years = sorted(set(s["year"] for s in serie)) or [2025]
meta = {
    "years": years, "latestYear": max(years), "lastUpdate": "2026-06-11",
    "fases": ["pia", "pim", "certificado", "devengado", "girado"],
    "sources": [
        {"name": "MEF — Datos Abiertos (Consulta del Gasto Público, SIAF)",
         "url": "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto",
         "endpoint": "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"},
        {"name": "IDH 2019 (PNUD) y pobreza/vulnerabilidad (INEI)", "url": "https://www.inei.gob.pe"},
        {"name": "Riesgos: IGP, SENAMHI, CENEPRED, INDECI, INAIGEM, MINAM", "url": "https://sigrid.cenepred.gob.pe"},
    ],
    "notas": "Datos reales de ejecución del gasto del SIAF-MEF. La ubicación territorial corresponde a la UNIDAD EJECUTORA (DISTRITO_EJECUTORA), no necesariamente al lugar físico de la obra; el gobierno nacional concentra ejecución en Lima. Para lectura territorial usar el filtro de nivel de gobierno (Gobiernos Locales/Regionales). Las cifras pueden diferir de Consulta Amigable por fecha de corte y agregación.",
    "resourceIds": {str(y): RIDS[y] for y in years if y in RIDS},
}
w("meta.json", meta)
print("LISTO ✓", flush=True)
