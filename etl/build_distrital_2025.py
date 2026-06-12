#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Detalle distrital 2025 desde la tabla mensual completa (11.4M filas).
Una consulta por departamento (filtra por DEPARTAMENTO_EJECUTORA). Escribe
INCREMENTALMENTE tras cada departamento y REANUDA: salta los que ya están.
"""
import urllib.request, urllib.parse, json, time, os

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
RID = "77fc3228-fa6f-4c1f-a0ed-d32520ad11ad"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data")
DEST = os.path.join(OUT, "por-distrito-2025.json")

GEO = json.load(open(os.path.join(OUT, "distritos.geojson")))
NAMES = {f["properties"]["IDDIST"]: (f["properties"]["NOMBDIST"], f["properties"]["NOMBPROV"], f["properties"]["NOMBDEP"])
         for f in GEO["features"]}


def sql(q, timeout=200, retries=2):
    url = API + "?sql=" + urllib.parse.quote(q)
    for i in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                t = r.read().decode("utf-8", "ignore")
            if not t.strip():
                raise ValueError("vacío")
            return json.loads(t).get("records", [])
        except Exception as e:
            print("    retry", i, repr(e)[:50], flush=True)
            if i == retries:
                raise
            time.sleep(5)


def fn(x):
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


# Reanudar: cargar lo ya hecho
rows = []
done = set()
if os.path.exists(DEST):
    try:
        rows = json.load(open(DEST, encoding="utf-8"))
        done = {r["ubigeo"][:2] for r in rows}
        print(f"Reanudando: {len(rows)} filas, deptos hechos: {sorted(done)}", flush=True)
    except Exception:
        rows = []

t0 = time.time()
for i in range(1, 26):
    d = f"{i:02d}"
    if d in done:
        continue
    try:
        rr = sql(f'SELECT "PROVINCIA_EJECUTORA" p,"DISTRITO_EJECUTORA" di,"NIVEL_GOBIERNO_NOMBRE" niv,'
                 f'SUM("MONTO_PIA"::numeric) pia,SUM("MONTO_PIM"::numeric) pim,SUM("MONTO_DEVENGADO"::numeric) dev,'
                 f'SUM("MONTO_GIRADO"::numeric) gir FROM "{RID}" WHERE "DEPARTAMENTO_EJECUTORA"=\'{d}\' GROUP BY 1,2,3')
        c = 0
        for r in rr:
            p, di = (r.get("p") or ""), (r.get("di") or "")
            if not (p and di):
                continue
            try:
                ub = f"{int(d):02d}{int(p):02d}{int(di):02d}"
            except ValueError:
                continue
            dn, pn, depn = NAMES.get(ub, (di, p, ""))
            rows.append({"ubigeo": ub, "departamento": depn, "provincia": pn, "distrito": dn,
                         "nivel": r["niv"] or "—", "pia": fn(r["pia"]), "pim": fn(r["pim"]),
                         "devengado": fn(r["dev"]), "girado": fn(r["gir"])})
            c += 1
        # escritura incremental
        json.dump(rows, open(DEST, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"  dep {d}: +{c} filas (total {len(rows)}) [{time.time()-t0:.0f}s]", flush=True)
    except Exception as e:
        print(f"  dep {d} FALLÓ: {repr(e)[:60]}", flush=True)

ubs = set(r["ubigeo"] for r in rows)
print(f"DISTRITAL 2025 LISTO: {len(rows)} filas, {len(ubs)} ubigeos [{time.time()-t0:.0f}s]", flush=True)
