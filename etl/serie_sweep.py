#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Barrido paciente de las tablas mensuales completas del MEF, una por una, con
consulta COMBINADA (año + totales en una sola). Escribe serie-nacional.json
INCREMENTALMENTE: cada año que responde se agrega de inmediato. Saltea tablas
vacías (responden al instante) y las que hacen timeout. Reanudable.
"""
import urllib.request, urllib.parse, json, time, os

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "public", "data")
SERIE = os.path.join(OUT, "serie-nacional.json")
DONE = os.path.join(HERE, "sweep_done.json")
TABS = json.load(open("/tmp/girado_tabs.json"))


def sql(q, timeout=250):
    url = API + "?sql=" + urllib.parse.quote(q)
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore")).get("records", [])


def fn(x):
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


serie = {}
if os.path.exists(SERIE):
    for r in json.load(open(SERIE)):
        serie[r["year"]] = r
done = set(json.load(open(DONE))) if os.path.exists(DONE) else set()

t0 = time.time()
for i, tb in enumerate(TABS):
    if tb in done:
        continue
    try:
        r = sql(f'SELECT MIN("ANO_EJE") y, COUNT(*) n, SUM("MONTO_PIA"::numeric) pia,'
                f'SUM("MONTO_PIM"::numeric) pim, SUM("MONTO_CERTIFICADO"::numeric) cert,'
                f'SUM("MONTO_DEVENGADO"::numeric) dev, SUM("MONTO_GIRADO"::numeric) gir FROM "{tb}"')[0]
        done.add(tb)
        json.dump(list(done), open(DONE, "w"))
        if not r.get("y"):
            print(f"  [{i+1}/{len(TABS)}] {tb[:8]} vacía", flush=True)
            continue
        y = int(r["y"]); pim = fn(r["pim"])
        cur = serie.get(y)
        if cur is None or pim > cur["pim"]:
            serie[y] = {"year": y, "pia": fn(r["pia"]), "pim": pim, "certificado": fn(r["cert"]),
                        "devengado": fn(r["dev"]), "girado": fn(r["gir"])}
            out = [serie[k] for k in sorted(serie)]
            json.dump(out, open(SERIE, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            print(f"  [{i+1}/{len(TABS)}] {tb[:8]} AÑO {y}: PIM {pim/1e9:.1f} mil M -> ESCRITO ({len(serie)} años) [{time.time()-t0:.0f}s]", flush=True)
        else:
            print(f"  [{i+1}/{len(TABS)}] {tb[:8]} año {y} PIM {pim/1e9:.1f} (no mejora)", flush=True)
    except Exception as e:
        print(f"  [{i+1}/{len(TABS)}] {tb[:8]} {repr(e)[:40]}", flush=True)

print("FINAL:", [(r["year"], round(r["pim"]/1e9, 1)) for r in sorted(serie.values(), key=lambda x: x["year"])], flush=True)
