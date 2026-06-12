#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Serie histórica nacional (acotada): de las tablas mensuales completas (MONTO_GIRADO),
identifica una tabla COMPLETA por año (PIM > 100 mil M) y suma totales nacionales.
Resiliente y con tope de tiempo. Fusiona con serie-nacional.json existente (2025).
"""
import urllib.request, urllib.parse, json, time, os

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data")
TABS = json.load(open("/tmp/girado_tabs.json"))
TIME_CAP = 1400  # segundos


def sql(q, timeout=60, retries=1):
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


t0 = time.time()
# Paso 1: año de cada tabla (LIMIT 1, rápido). Saltar lentas.
year_tabs: dict[int, list] = {}
for i, tb in enumerate(TABS):
    if time.time() - t0 > TIME_CAP * 0.45:
        print("corte fase ANO_EJE", flush=True)
        break
    try:
        y = int(sql(f'SELECT "ANO_EJE" y FROM "{tb}" LIMIT 1', timeout=15)[0]["y"])
        year_tabs.setdefault(y, []).append(tb)
    except Exception:
        pass
print("años detectados:", {y: len(v) for y, v in sorted(year_tabs.items())}, flush=True)

# Paso 2: por año faltante, sumar candidatos hasta encontrar uno COMPLETO (PIM>100 mil M).
TARGET = [2019, 2020, 2021, 2022, 2023, 2024]
serie = {}
existing = os.path.join(OUT, "serie-nacional.json")
if os.path.exists(existing):
    for r in json.load(open(existing)):
        serie[r["year"]] = r

for y in TARGET:
    if time.time() - t0 > TIME_CAP:
        print("corte por tiempo", flush=True)
        break
    if y not in year_tabs:
        continue
    for tb in year_tabs[y][:4]:  # como máximo 4 candidatos por año
        if time.time() - t0 > TIME_CAP:
            break
        try:
            r = sql(f'SELECT SUM("MONTO_PIA"::numeric) pia,SUM("MONTO_PIM"::numeric) pim,'
                    f'SUM("MONTO_CERTIFICADO"::numeric) cert,SUM("MONTO_DEVENGADO"::numeric) dev,'
                    f'SUM("MONTO_GIRADO"::numeric) gir FROM "{tb}"', timeout=200)[0]
            pim = fn(r["pim"])
            if pim > 100e9:  # tabla completa
                serie[y] = {"year": y, "pia": fn(r["pia"]), "pim": pim,
                            "certificado": fn(r["cert"]), "devengado": fn(r["dev"]), "girado": fn(r["gir"])}
                print(f"  {y}: PIM {pim/1e9:.1f} mil M ✓ (tabla {tb[:8]})", flush=True)
                break
            else:
                print(f"  {y}: candidato {tb[:8]} PIM {pim/1e9:.1f} (parcial, sigo)", flush=True)
        except Exception as e:
            print(f"  {y}: {tb[:8]} err {repr(e)[:40]}", flush=True)

out = [serie[y] for y in sorted(serie)]
json.dump(out, open(existing, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("SERIE:", [(r["year"], round(r["pim"]/1e9, 1)) for r in out], flush=True)
