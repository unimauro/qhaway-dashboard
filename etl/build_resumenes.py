#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Construye las tablas-resumen pre-sumarizadas de QHAWAY 2.0 desde el cubo granular.

Lee `gasto_cubo` (cargado por cubo_pilot.py) y, con INSERT ... SELECT ... GROUP BY en
PostgreSQL (la agregación la hace la BD, no la RAM de Python), crea/llena tablas pequeñas
que el portal sirve directo sin tocar millones de filas:

  - res_categoria   : gasto por categoría presupuestal × nivel
  - res_tipo_gasto  : gasto por tipo de gasto × nivel
  - res_cubo_n      : cubo acotado (sin producto_proyecto/actividad/distrito) para pivotes
                      arbitrarios año × {depto_meta, funcion, fuente, categoría, tipo} × nivel

IDEMPOTENTE: borra (DELETE WHERE ano=…) e inserta de nuevo. CREATE TABLE IF NOT EXISTS
+ índices por año. Corre dentro del contenedor del loader, reusando DATABASE_URL.

Uso (en el contenedor del loader):
  python build_resumenes.py            # todos los años presentes en gasto_cubo
  python build_resumenes.py 2025       # solo un año
"""
import os
import sys
import time
import psycopg

DB = os.environ.get("DATABASE_URL", "postgresql://qhaway:qhaway_local@qhaway-db:5432/qhaway")

DDL = """
CREATE TABLE IF NOT EXISTS res_categoria (
  ano INT, nivel TEXT, categoria_ppto TEXT,
  pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC
);
CREATE INDEX IF NOT EXISTS ix_res_categoria_ano ON res_categoria(ano);

CREATE TABLE IF NOT EXISTS res_tipo_gasto (
  ano INT, nivel TEXT, tipo_gasto TEXT,
  pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC
);
CREATE INDEX IF NOT EXISTS ix_res_tipo_gasto_ano ON res_tipo_gasto(ano);

CREATE TABLE IF NOT EXISTS res_cubo_n (
  ano INT, nivel TEXT, departamento_meta TEXT, funcion TEXT, fuente TEXT,
  categoria_ppto TEXT, tipo_gasto TEXT,
  pim NUMERIC, devengado NUMERIC
);
CREATE INDEX IF NOT EXISTS ix_res_cubo_n_ano ON res_cubo_n(ano);
"""

# (tabla destino, columnas dimensión, columnas medida)
JOBS = [
    ("res_categoria", ("nivel", "categoria_ppto"),
     ("SUM(pia)", "SUM(pim)", "SUM(devengado)", "SUM(girado)"),
     ("pia", "pim", "devengado", "girado")),
    ("res_tipo_gasto", ("nivel", "tipo_gasto"),
     ("SUM(pia)", "SUM(pim)", "SUM(devengado)", "SUM(girado)"),
     ("pia", "pim", "devengado", "girado")),
    ("res_cubo_n",
     ("nivel", "departamento_meta", "funcion", "fuente", "categoria_ppto", "tipo_gasto"),
     ("SUM(pim)", "SUM(devengado)"),
     ("pim", "devengado")),
]


def build(cur, year: int):
    for tbl, dims, aggs, measures in JOBS:
        dimcols = ", ".join(dims)
        aggsel = ", ".join(aggs)
        meascols = ", ".join(measures)
        cur.execute(f"DELETE FROM {tbl} WHERE ano=%s", (year,))
        cur.execute(
            f"INSERT INTO {tbl} (ano, {dimcols}, {meascols}) "
            f"SELECT ano, {dimcols}, {aggsel} "
            f"FROM gasto_cubo WHERE ano=%s GROUP BY ano, {dimcols}", (year,))
        n = cur.execute(f"SELECT count(*) FROM {tbl} WHERE ano=%s", (year,)).fetchone()[0]
        print(f"[{year}] {tbl}: {n:,} filas", flush=True)


def main():
    t0 = time.time()
    with psycopg.connect(DB) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            if len(sys.argv) > 1:
                years = [int(a) for a in sys.argv[1:]]
            else:
                years = [r[0] for r in
                         cur.execute("SELECT DISTINCT ano FROM gasto_cubo ORDER BY ano").fetchall()]
            if not years:
                print("gasto_cubo sin datos → nada que resumir", flush=True)
                sys.exit(1)
            for year in years:
                build(cur, year)
        conn.commit()
    print(f"LISTO en {time.time()-t0:.0f}s (años: {years})", flush=True)


if __name__ == "__main__":
    main()
