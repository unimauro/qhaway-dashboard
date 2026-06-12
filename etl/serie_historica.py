#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Serie histórica nacional desde las tablas MENSUALES COMPLETAS del MEF (MONTO_GIRADO).
Robusto e INCREMENTAL: cachea el mapa año->tabla en etl/year_tabs.json y la serie en
public/data/serie-nacional.json; puede reanudarse. Identifica la tabla completa por año
(PIM > 80 mil M). Pensado para correr largo en segundo plano o vía GitHub Actions.
"""
import urllib.request, urllib.parse, json, time, os

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "public", "data")
TABS = json.load(open("/tmp/girado_tabs.json"))
YT_CACHE = os.path.join(HERE, "year_tabs.json")
SERIE = os.path.join(OUT, "serie-nacional.json")


def sql(q, timeout=120, retries=1):
    url = API + "?sql=" + urllib.parse.quote(q)
    for i in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                t = r.read().decode("utf-8", "ignore")
            if not t.strip():
                raise ValueError("vacío")
            return json.loads(t).get("records", [])
        except Exception:
            if i == retries:
                raise
            time.sleep(3)


def fn(x):
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


# --- Fase 1: año de cada tabla (incremental, reanudable) ---
year_tabs = {}
probed = set()
if os.path.exists(YT_CACHE):
    cache = json.load(open(YT_CACHE))
    year_tabs = {int(k): v for k, v in cache.get("year_tabs", {}).items()}
    probed = set(cache.get("probed", []))
    print(f"reanudando: {len(probed)} tablas ya probadas, años {sorted(year_tabs)}", flush=True)

for tb in TABS:
    if tb in probed:
        continue
    try:
        y = int(sql(f'SELECT "ANO_EJE" y FROM "{tb}" LIMIT 1', timeout=120)[0]["y"])
        year_tabs.setdefault(y, []).append(tb)
        print(f"  {tb[:8]} -> {y}", flush=True)
    except Exception:
        pass
    probed.add(tb)
    json.dump({"year_tabs": {str(k): v for k, v in year_tabs.items()}, "probed": list(probed)},
              open(YT_CACHE, "w"))
print("años:", {y: len(v) for y, v in sorted(year_tabs.items())}, flush=True)

# --- Fase 2: SUM nacional por año, quedándose con la tabla COMPLETA (PIM>80 mil M) ---
serie = {}
if os.path.exists(SERIE):
    for r in json.load(open(SERIE)):
        serie[r["year"]] = r

for y in sorted(year_tabs):
    if y in serie and serie[y]["pim"] > 80e9:
        continue  # ya tenemos un total completo para ese año
    best = None
    for tb in year_tabs[y]:
        try:
            r = sql(f'SELECT SUM("MONTO_PIA"::numeric) pia,SUM("MONTO_PIM"::numeric) pim,'
                    f'SUM("MONTO_CERTIFICADO"::numeric) cert,SUM("MONTO_DEVENGADO"::numeric) dev,'
                    f'SUM("MONTO_GIRADO"::numeric) gir FROM "{tb}"', timeout=240)[0]
            pim = fn(r["pim"])
            if best is None or pim > best["pim"]:
                best = {"year": y, "pia": fn(r["pia"]), "pim": pim, "certificado": fn(r["cert"]),
                        "devengado": fn(r["dev"]), "girado": fn(r["gir"])}
            if pim > 80e9:
                break  # tabla completa encontrada
        except Exception as e:
            print(f"  {y} {tb[:8]} err {repr(e)[:40]}", flush=True)
    if best:
        serie[y] = best
        out = [serie[k] for k in sorted(serie)]
        json.dump(out, open(SERIE, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"  {y}: PIM {best['pim']/1e9:.1f} mil M [{'completo' if best['pim']>80e9 else 'parcial'}] -> escrito", flush=True)

print("SERIE FINAL:", [(r["year"], round(r["pim"]/1e9, 1)) for r in sorted(serie.values(), key=lambda x: x["year"])], flush=True)
