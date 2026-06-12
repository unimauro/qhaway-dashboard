#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Orquestador PARALELO de la migración (reusa load.py).

El cuello de botella es la descarga del MEF (throttle ~0.3 MB/s POR CONEXIÓN), no el
VPS. Por eso bajamos varios años a la vez: cada año es independiente en la base
(DELETE+INSERT WHERE ano=y), así que cada hilo usa su propia conexión y NO hay colisión.
La descarga (curl, subprocess) sí paraleliza de verdad; la agregación (GIL) se serializa
pero es ~minutos frente a horas de descarga, así que no importa.

Uso (dentro del contenedor del loader, con DATABASE_URL):
  python load_parallel.py 2023 2022 2021 ... 2012 2026
  PAR_WORKERS=3 python load_parallel.py all     # 2012..2026 (salta los ya cargados)

Salta automáticamente los años que ya tienen detalle distrital cargado (idempotente).
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg
import load  # módulo existente en /loader/load.py

DB = load.DB
WORKERS = int(os.environ.get("PAR_WORKERS", "3"))


def already_loaded(year: int) -> bool:
    with psycopg.connect(DB) as c:
        n = c.execute("SELECT count(*) FROM gasto_distrito WHERE ano=%s", (year,)).fetchone()[0]
    return n > 0


def do_year(year: int) -> str:
    try:
        if already_loaded(year):
            return f"[{year}] ya cargado → skip"
        path = load.download(year)
        if not path:
            return f"[{year}] descarga INCOMPLETA → skip"
        agg = load.aggregate(path)
        with psycopg.connect(DB) as conn:
            load.load_year(conn, year, agg)
        try:
            os.remove(path)
        except OSError:
            pass
        ubs = len(set(ub for ub, _ in agg["dist"]))
        return f"[{year}] OK {agg['n']:,} filas → {ubs} ubigeos, PIM {agg['nat'][1] / 1e9:.1f} mil M"
    except Exception as e:  # noqa: BLE001
        return f"[{year}] ERROR {repr(e)[:120]}"


def main() -> None:
    args = sys.argv[1:]
    years = list(range(2012, 2027)) if (not args or args[0] == "all") else [int(a) for a in args]
    with psycopg.connect(DB) as conn:
        with conn.cursor() as cur:
            cur.execute(load.SCHEMA)
        conn.commit()
    print(f"PARALELO: {WORKERS} a la vez · años {years}", flush=True)
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(do_year, y): y for y in years}
        for fut in as_completed(futs):
            print(fut.result(), flush=True)
    print("LISTO PARALELO", flush=True)


if __name__ == "__main__":
    main()
