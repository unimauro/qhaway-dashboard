#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ETL principal QHAWAY — presupuesto del MEF (SIAF, Datos Abiertos).

Usa etl/resource_map.json (generado por discover.py) = {year:{id,rows,devcol}}.
- serie-nacional.json: totales nacionales de TODOS los años disponibles (selector por año).
- por-distrito/funcion/sector/departamento/nivel + flujo: del año cerrado MÁS RECIENTE
  cuya tabla sea liviana (rows < 1.5M), para evitar timeouts en GROUP BY.
Resiliente: cada consulta aislada; escribe lo que completa.
"""
import json, os, urllib.parse, urllib.request, time

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "public", "data")
RMAP = json.load(open(os.path.join(HERE, "resource_map.json")))
RMAP = {int(y): v for y, v in RMAP.items()}

GEO = json.load(open(os.path.join(OUT, "distritos.geojson"), encoding="utf-8"))
NAMES, DEPN = {}, {}
for ft in GEO["features"]:
    p = ft["properties"]
    NAMES[p["IDDIST"]] = (p["NOMBDIST"], p["NOMBPROV"], p["NOMBDEP"])
    DEPN[p["IDDPTO"]] = p["NOMBDEP"]


def get(url, retries=3, timeout=290):
    for i in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                txt = r.read().decode("utf-8", "ignore")
            if not txt.strip():
                raise ValueError("vacío")
            return json.loads(txt)
        except Exception as e:
            print("   retry", i, repr(e)[:70], flush=True)
            if i == retries:
                raise
            time.sleep(6)


def sql(q, **kw):
    return get(API + "?sql=" + urllib.parse.quote(q), **kw).get("records", [])


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


# --- Serie nacional (todos los años) ---
serie = []
for y in sorted(RMAP):
    rid, dev = RMAP[y]["id"], RMAP[y]["devcol"]
    gir = ',SUM("MONTO_GIRADO"::numeric) gir' if RMAP[y].get("hasGirado", True) else ""
    print(f"[{y}] nacional… (filas {RMAP[y]['rows']})", flush=True)
    try:
        q = (f'SELECT SUM("MONTO_PIA"::numeric) pia,SUM("MONTO_PIM"::numeric) pim,'
             f'SUM("MONTO_CERTIFICADO"::numeric) cert,SUM("{dev}"::numeric) dev{gir} FROM "{rid}"')
        r = sql(q)[0]
        rec = {"year": y, "pia": fnum(r["pia"]), "pim": fnum(r["pim"]),
               "certificado": fnum(r["cert"]), "devengado": fnum(r["dev"]),
               "girado": fnum(r.get("gir", r["dev"]))}
        serie.append(rec)
        print(f"   {y}: PIM {rec['pim']/1e9:.1f} · Dev {rec['devengado']/1e9:.1f} mil M", flush=True)
    except Exception as e:
        print(f"   FALLÓ {y}: {e}", flush=True)
if serie:
    w("serie-nacional.json", serie)

# --- Año principal para detalle distrital: el más reciente y liviano ---
light = [y for y in sorted(RMAP, reverse=True) if RMAP[y]["rows"] < 1_500_000]
PY = light[0] if light else sorted(RMAP)[-1]
rid, dev = RMAP[PY]["id"], RMAP[PY]["devcol"]
hasGir = RMAP[PY].get("hasGirado", False)
print(f"[principal {PY}] territorial… dev={dev} girado={hasGir}", flush=True)

girsel = ',SUM("MONTO_GIRADO"::numeric) gir' if hasGir else ""
try:
    recs = sql(
        f'SELECT "DEPARTAMENTO_EJECUTORA" dep,"PROVINCIA_EJECUTORA" prov,"DISTRITO_EJECUTORA" dist,'
        f'MAX("NIVEL_GOBIERNO_NOMBRE") nivel,SUM("MONTO_PIA"::numeric) pia,SUM("MONTO_PIM"::numeric) pim,'
        f'SUM("MONTO_CERTIFICADO"::numeric) cert,SUM("{dev}"::numeric) dev{girsel} '
        f'FROM "{rid}" GROUP BY 1,2,3')
    dist_rows, dep_agg, niv_agg = [], {}, {}
    nat = {"pia": 0, "pim": 0, "cert": 0, "dev": 0, "gir": 0}
    for r in recs:
        dpc, prc, dic = (r.get("dep") or ""), (r.get("prov") or ""), (r.get("dist") or "")
        pia, pim, cert, dvg = map(fnum, (r["pia"], r["pim"], r["cert"], r["dev"]))
        gir = fnum(r["gir"]) if hasGir else dvg
        nat["pia"] += pia; nat["pim"] += pim; nat["cert"] += cert; nat["dev"] += dvg; nat["gir"] += gir
        niv = r.get("nivel") or "—"
        n = niv_agg.setdefault(niv, {"pia": 0, "pim": 0, "dev": 0, "gir": 0})
        n["pia"] += pia; n["pim"] += pim; n["dev"] += dvg; n["gir"] += gir
        if not (dpc and prc and dic):
            continue
        try:
            ub = f"{int(dpc):02d}{int(prc):02d}{int(dic):02d}"; ubd = f"{int(dpc):02d}"
        except ValueError:
            continue
        dn, pn, depn = NAMES.get(ub, (dic, prc, DEPN.get(ubd, "")))
        dist_rows.append({"ubigeo": ub, "departamento": depn, "provincia": pn, "distrito": dn,
                          "nivel": niv, "pia": pia, "pim": pim, "devengado": dvg, "girado": gir})
        d = dep_agg.setdefault((ubd, depn, niv), {"pia": 0, "pim": 0, "dev": 0, "gir": 0})
        d["pia"] += pia; d["pim"] += pim; d["dev"] += dvg; d["gir"] += gir
    w(f"por-distrito-{PY}.json", dist_rows)
    w(f"flujo-fases-{PY}.json", {"pia": round(nat["pia"], 2), "pim": round(nat["pim"], 2),
                                 "certificado": round(nat["cert"], 2), "devengado": round(nat["dev"], 2), "girado": round(nat["gir"], 2)})
    w("por-departamento.json", [{"year": PY, "ubigeo": ub, "departamento": dn, "nivel": niv,
                                 "pia": round(v["pia"], 2), "pim": round(v["pim"], 2), "devengado": round(v["dev"], 2), "girado": round(v["gir"], 2)}
                                for (ub, dn, niv), v in dep_agg.items()])
    w("por-nivel-gobierno.json", [{"year": PY, "nivel": niv, "pia": round(v["pia"], 2), "pim": round(v["pim"], 2),
                                   "devengado": round(v["dev"], 2), "girado": round(v["gir"], 2)} for niv, v in niv_agg.items()])
    print(f"   {PY}: {len(dist_rows)} distritos · niveles={list(niv_agg)}", flush=True)
except Exception as e:
    print(f"   FALLÓ territorial {PY}: {e}", flush=True)

# --- Función y sector del año principal ---
try:
    rr = sql(f'SELECT "FUNCION_NOMBRE" k,SUM("MONTO_PIM"::numeric) pim,SUM("{dev}"::numeric) dev'
             f'{girsel} FROM "{rid}" GROUP BY 1 ORDER BY 2 DESC')
    w(f"por-funcion-{PY}.json", [{"funcion": r["k"] or "—", "pim": fnum(r["pim"]), "devengado": fnum(r["dev"]),
                                  "girado": fnum(r["gir"]) if hasGir else fnum(r["dev"])} for r in rr if r.get("k")])
except Exception as e:
    print(f"   FALLÓ función: {e}", flush=True)
try:
    rr = sql(f'SELECT "SECTOR_NOMBRE" k,SUM("MONTO_PIM"::numeric) pim,SUM("{dev}"::numeric) dev '
             f'FROM "{rid}" GROUP BY 1 ORDER BY 2 DESC')
    w(f"por-sector-{PY}.json", [{"sector": r["k"] or "—", "pim": fnum(r["pim"]), "devengado": fnum(r["dev"])} for r in rr if r.get("k")])
except Exception as e:
    print(f"   FALLÓ sector: {e}", flush=True)

# --- meta.json ---
years = sorted(s["year"] for s in serie) or [PY]
meta = {
    "years": years, "latestYear": max(years), "distritoYear": PY, "lastUpdate": "2026-06-11",
    "fases": ["pia", "pim", "certificado", "devengado", "girado"],
    "sources": [
        {"name": "MEF — Datos Abiertos (Consulta del Gasto Público, SIAF)",
         "url": "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto",
         "endpoint": "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"},
        {"name": "IDH 2019 (PNUD) y pobreza/vulnerabilidad (INEI)", "url": "https://www.inei.gob.pe"},
        {"name": "Riesgos: IGP, SENAMHI, CENEPRED, INDECI, INAIGEM, MINAM", "url": "https://sigrid.cenepred.gob.pe"},
    ],
    "notas": (f"Datos reales del SIAF-MEF. La serie nacional cubre {min(years)}–{max(years)}; el detalle distrital "
              f"usa {PY} (último año fiscal con tabla anual desagregada). La ubicación corresponde a la UNIDAD "
              "EJECUTORA, no al lugar físico de la obra; el gobierno nacional concentra ejecución en Lima — para "
              "lectura territorial filtrar a Gobiernos Locales/Regionales. El girado puede no publicarse en el "
              "corte anual: cuando falta se usa el devengado como referencia de ejecución. Las cifras pueden diferir "
              "de Consulta Amigable por fecha de corte y agregación."),
    "resourceIds": {str(y): RMAP[y]["id"] for y in years},
}
w("meta.json", meta)
print("LISTO ✓", flush=True)
