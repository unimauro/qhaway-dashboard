#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Descubre las tablas ANUALES de gasto del MEF (las que tienen TOTAL_DEVENGADO +
MONTO_PIA + DISTRITO_EJECUTORA) y mapea año -> resource_id. Escribe etl/resource_map.json.
Mucho más rápido que escanear las 1100+ tablas del datastore: filtra por columna.
"""
import json, os, urllib.parse, urllib.request, time

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
HERE = os.path.dirname(__file__)


def sql(q, timeout=120, retries=3):
    url = API + "?sql=" + urllib.parse.quote(q)
    for i in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                t = r.read().decode("utf-8", "ignore")
            if not t.strip():
                raise ValueError("vacío")
            return json.loads(t).get("records", [])
        except Exception as e:
            print("  retry", i, repr(e)[:60], flush=True)
            if i == retries:
                raise
            time.sleep(5)


def tables_with(col):
    return set(r["table_name"] for r in sql(
        f"SELECT table_name FROM information_schema.columns "
        f"WHERE column_name='{col}' AND table_name NOT LIKE '%_tmp'"))


print("Buscando tablas anuales de gasto…", flush=True)
cand = tables_with("TOTAL_DEVENGADO") & tables_with("MONTO_PIA") & tables_with("DISTRITO_EJECUTORA")
print(f"  {len(cand)} candidatas", flush=True)

res = {}
for t in sorted(cand):
    try:
        y = int(sql(f'SELECT "ANO_EJE" y FROM "{t}" LIMIT 1', timeout=90)[0]["y"])
        res[y] = t
        print(f"  año {y}: {t}", flush=True)
    except Exception as e:
        print(f"  skip {t[:12]}: {repr(e)[:50]}", flush=True)

out = {str(y): {"id": res[y], "devcol": "TOTAL_DEVENGADO", "rows": 300000, "hasGirado": False}
       for y in sorted(res)}
json.dump(out, open(os.path.join(HERE, "resource_map.json"), "w"), indent=1)
print("AÑOS:", sorted(res), flush=True)
