#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QHAWAY 2.0 — ETL del presupuesto público (SIAF-MEF).

Construye los archivos JSON estáticos que consume el dashboard (public/data/)
a partir de la API de Datos Abiertos del MEF (CKAN datastore, SQL abierto por GET):

    https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql

Cada año del dataset "Consulta del Gasto Público" es una tabla Postgres con un
resource_id (UUID) propio. La tabla trae, entre otras, las columnas:
    ANO_EJE, NIVEL_GOBIERNO_NOMBRE,
    DEPARTAMENTO_EJECUTORA(_NOMBRE), PROVINCIA_EJECUTORA(_NOMBRE), DISTRITO_EJECUTORA(_NOMBRE),
    FUNCION_NOMBRE, SECTOR_NOMBRE,
    MONTO_PIA, MONTO_PIM, MONTO_CERTIFICADO, MONTO_DEVENGADO, MONTO_GIRADO

El ubigeo de 6 dígitos se forma concatenando los códigos de departamento(2) +
provincia(2) + distrito(2) de la EJECUTORA, y coincide con IDDIST del GeoJSON.

NOTA METODOLÓGICA (anti-overclaiming): la ubicación territorial corresponde a la
UNIDAD EJECUTORA, no necesariamente al lugar físico de la obra. El gobierno
nacional concentra su ejecución en Lima. Para una lectura territorial limpia se
recomienda filtrar a Gobiernos Locales / Regionales (campo `nivel`).

Uso:
    python etl/build.py                # usa los resource_ids conocidos
    python etl/build.py --discover     # redescubre los resource_ids por año

Requiere: requests (pip install requests). Pensado para correr offline o en CI;
el dashboard NO consulta la API en caliente, solo lee los JSON generados.
"""
from __future__ import annotations
import argparse
import json
import os
import time
import urllib.parse
import urllib.request

API = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data")

# resource_id (UUID) por año, verificados en la API. Si cambian, correr --discover.
RESOURCE_IDS: dict[int, str] = {
    2025: "77fc3228-fa6f-4c1f-a0ed-d32520ad11ad",
    2024: "42477a87-ee45-4df2-9c6f-ccd63c2b1411",
    2020: "64b41d99-676d-4206-b368-04de62db20d0",
    2026: "8e4cc4ae-32c1-45db-88d4-6cc0d88ec2ef",
}

DISTRITO_YEARS = [2024, 2025, 2026]  # años con desagregación distrital en el dashboard


def sql(query: str, retries: int = 3) -> list[dict]:
    url = API + "?sql=" + urllib.parse.quote(query)
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = json.load(r)
            return data.get("records", [])
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            print(f"  reintento {i+1}: {e}")
            time.sleep(3)
    return []


def f(x) -> float:
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def write(name: str, obj) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  -> {name} ({os.path.getsize(path)/1024:.0f} KB)")


def serie_nacional() -> None:
    out = []
    for year, rid in sorted(RESOURCE_IDS.items()):
        recs = sql(
            f'SELECT SUM("MONTO_PIA"::numeric) pia, SUM("MONTO_PIM"::numeric) pim, '
            f'SUM("MONTO_CERTIFICADO"::numeric) cert, SUM("MONTO_DEVENGADO"::numeric) dev, '
            f'SUM("MONTO_GIRADO"::numeric) gir FROM "{rid}"'
        )
        if recs:
            r = recs[0]
            out.append({"year": year, "pia": f(r["pia"]), "pim": f(r["pim"]),
                        "certificado": f(r["cert"]), "devengado": f(r["dev"]), "girado": f(r["gir"])})
    write("serie-nacional.json", out)


def por_distrito(year: int, rid: str) -> None:
    recs = sql(
        f'SELECT "DEPARTAMENTO_EJECUTORA" dep, "PROVINCIA_EJECUTORA" prov, "DISTRITO_EJECUTORA" dist, '
        f'MAX("DEPARTAMENTO_EJECUTORA_NOMBRE") depn, MAX("PROVINCIA_EJECUTORA_NOMBRE") provn, '
        f'MAX("DISTRITO_EJECUTORA_NOMBRE") distn, MAX("NIVEL_GOBIERNO_NOMBRE") nivel, '
        f'SUM("MONTO_PIA"::numeric) pia, SUM("MONTO_PIM"::numeric) pim, '
        f'SUM("MONTO_DEVENGADO"::numeric) dev, SUM("MONTO_GIRADO"::numeric) gir '
        f'FROM "{rid}" GROUP BY 1,2,3'
    )
    out = []
    for r in recs:
        dep, prov, dist = (r.get("dep") or ""), (r.get("prov") or ""), (r.get("dist") or "")
        if not (dep and prov and dist):
            continue
        ubigeo = f"{int(dep):02d}{int(prov):02d}{int(dist):02d}"
        out.append({"ubigeo": ubigeo, "departamento": r["depn"], "provincia": r["provn"],
                    "distrito": r["distn"], "nivel": r["nivel"],
                    "pia": f(r["pia"]), "pim": f(r["pim"]), "devengado": f(r["dev"]), "girado": f(r["gir"])})
    write(f"por-distrito-{year}.json", out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="store_true", help="Redescubrir resource_ids por año")
    args = ap.parse_args()

    if args.discover:
        print("Descubriendo tablas (information_schema)…")
        tabs = sql("SELECT table_name FROM information_schema.tables "
                   "WHERE table_schema='public' AND table_name NOT LIKE '%_tmp'")
        print(f"  {len(tabs)} tablas. Inspecciona ANO_EJE de cada una para mapear año→UUID.")

    print("Serie nacional…");  serie_nacional()
    for y in DISTRITO_YEARS:
        if y in RESOURCE_IDS:
            print(f"Por distrito {y}…");  por_distrito(y, RESOURCE_IDS[y])
    print("Listo. Genera además meta.json, por-departamento.json, por-funcion/sector y flujo-fases "
          "(ver el agente de datos / extiende este script con queries análogas).")


if __name__ == "__main__":
    main()
