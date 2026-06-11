#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Descubre, por año, la tabla (resource_id) MÁS LIVIANA del dataset de gasto del MEF
que tenga las columnas necesarias. Escribe etl/resource_map.json = {year: {id,rows,devcol}}.
"""
import json, os, urllib.parse, urllib.request, time

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
HERE = os.path.dirname(__file__)


def get(url, retries=3, timeout=120):
    for i in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                txt = r.read().decode("utf-8", "ignore")
            if not txt.strip():
                raise ValueError("respuesta vacía")
            return json.loads(txt)
        except Exception as e:
            print("   retry", i, repr(e)[:70], flush=True)
            if i == retries:
                raise
            time.sleep(6)


def sql(q, **kw):
    return get(API + "?sql=" + urllib.parse.quote(q), **kw).get("records", [])


print("Listando tablas…", flush=True)
tabs = [r["table_name"] for r in sql(
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_schema='public' AND table_name NOT LIKE '%_tmp'")]
print(f"  {len(tabs)} tablas no-tmp", flush=True)

# Para cada tabla: año (de 1 fila), nº filas, y qué columna de devengado tiene.
best: dict[int, dict] = {}
for t in tabs:
    try:
        # columnas
        cols = [r["column_name"] for r in sql(
            f"SELECT column_name FROM information_schema.columns "
            f"WHERE table_name='{t}'", timeout=60)]
        if "MONTO_PIM" not in cols or "DISTRITO_EJECUTORA" not in cols:
            continue
        devcol = "TOTAL_DEVENGADO" if "TOTAL_DEVENGADO" in cols else (
            "MONTO_DEVENGADO" if "MONTO_DEVENGADO" in cols else None)
        if not devcol:
            continue
        sample = sql(f'SELECT "ANO_EJE" y FROM "{t}" LIMIT 1', timeout=120)
        if not sample:
            continue
        year = int(sample[0]["y"])
        cnt = int(sql(f'SELECT COUNT(*) n FROM "{t}"', timeout=180)[0]["n"])
        print(f"  {t[:12]}… año={year} filas={cnt} dev={devcol}", flush=True)
        if year not in best or cnt < best[year]["rows"]:
            best[year] = {"id": t, "rows": cnt, "devcol": devcol}
    except Exception as e:
        print(f"  (skip {t[:12]}: {repr(e)[:50]})", flush=True)

best = {y: best[y] for y in sorted(best)}
json.dump(best, open(os.path.join(HERE, "resource_map.json"), "w"), indent=1)
print("RESULTADO:", json.dumps(best, indent=1), flush=True)
