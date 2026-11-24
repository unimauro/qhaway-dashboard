#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Orquestador PARALELO (reusa load.process_year: ZIP→validación→carga→carga_log).

Con los ZIP (0.3–0.7 GB) la descarga ya no es el cuello de botella extremo que era con los CSV
de ~10 GB, pero sigue conviniendo bajar varios años a la vez. Cada año es independiente en la
base (DELETE+INSERT WHERE ano=y en una transacción), así que cada hilo usa su propia conexión.
La agregación (GIL) se serializa; no importa.

Uso (contenedor del loader, con DATABASE_URL):
  python load_parallel.py 2026 2025 2024 2023 2022 2021
  PAR_WORKERS=3 python load_parallel.py all          # 2012..año actual
  python load_parallel.py --force 2026               # recarga aunque el archivo no haya cambiado

Salta los años cuyo archivo del MEF no cambió desde la última carga (según carga_log).
Nota: el control de PIM ±40 % usa el año anterior YA cargado; en una carga paralela desde cero
ese año puede no estar aún → se omite ese control (queda un AVISO en el log).
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg
import load  # /loader/load.py

DB = load.DB
WORKERS = int(os.environ.get("PAR_WORKERS", "3"))


def do_year(year: int, flags: set) -> str:
    try:
        with psycopg.connect(DB) as conn:
            return load.process_year(year, conn, force="--force" in flags,
                                     validar="--no-validate" not in flags)
    except Exception as e:  # noqa: BLE001
        return f"[{year}] ERROR {repr(e)[:200]}"


def main() -> None:
    years, flags = load.parse_args(sys.argv[1:])
    with psycopg.connect(DB) as conn:
        conn.execute(load.SCHEMA)
        conn.commit()
        load.apply_migrations(conn)
    load.discover(years[0])  # precarga el mapa del portal una vez (antes de abrir hilos)
    print(f"PARALELO: {WORKERS} a la vez · años {years}", flush=True)
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(do_year, y, flags): y for y in years}
        for fut in as_completed(futs):
            print(fut.result(), flush=True)
    print("LISTO PARALELO", flush=True)


if __name__ == "__main__":
    main()
