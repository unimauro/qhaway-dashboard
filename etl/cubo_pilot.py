#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cubo granular PILOTO (1 año) para QHAWAY 2.0.

Descarga el CSV anual del gasto del MEF, lo reduce a las dimensiones que pide Kely
(nivel, sector, territorio ejecutora depto/prov/distrito, depto destino META, programa,
categoría presupuestal, producto/proyecto, actividad, función, fuente, tipo de gasto) y
lo AGREGA en una tabla cubo (gasto_cubo) sumando montos. La agregación pesada la hace
PostgreSQL (COPY a staging → GROUP BY → cubo), no la RAM de Python: seguro en el VPS.

Tras cargar: COMPRIME el CSV crudo a .gz y lo archiva en RAW_DIR (no se pierde, pesa poco),
borra el crudo y el staging, y reporta filas + tamaño real (para decidir el build completo).

Uso (en el contenedor del loader, con DATABASE_URL):
  python cubo_pilot.py 2025
"""
import os
import sys
import csv
import gzip
import shutil
import time
import psycopg

import load  # reutiliza load.download() (descarga resumible del MEF)

DB = os.environ.get("DATABASE_URL", "postgresql://qhaway:qhaway_local@qhaway-db:5432/qhaway")
RAW_DIR = os.environ.get("RAW_DIR", "/opt/qhaway-api/raw")
csv.field_size_limit(10_000_000)

# Índices 0-based del CSV <año>-Gasto(-Mensual).csv del MEF (validados en el header 2025).
IX = dict(nivel=3, sector=5, dep=11, depnom=12, prov=13, provnom=14, dist=15, distnom=16,
          prog=18, prognom=19, prodproynom=23, actnom=25, funcionnom=27,
          depmetanom=36, fuentenom=38, catgastonom=44,
          pia=56, pim=57, dev=61, gir=62)
NCOLS = max(IX.values())

CUBO_DDL = """
CREATE TABLE IF NOT EXISTS gasto_cubo (
  ano INT,
  nivel TEXT, sector TEXT,
  departamento TEXT, provincia TEXT, distrito TEXT, ubigeo TEXT,
  departamento_meta TEXT,
  programa TEXT, categoria_ppto TEXT,
  producto_proyecto TEXT, actividad TEXT,
  funcion TEXT, fuente TEXT, tipo_gasto TEXT,
  pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC
);
CREATE INDEX IF NOT EXISTS ix_cubo_ano ON gasto_cubo(ano);
CREATE INDEX IF NOT EXISTS ix_cubo_ubigeo ON gasto_cubo(ano, ubigeo);
"""

STG_DDL = """
DROP TABLE IF EXISTS cubo_stg;
CREATE UNLOGGED TABLE cubo_stg (
  ano INT,
  nivel TEXT, sector TEXT,
  departamento TEXT, provincia TEXT, distrito TEXT, ubigeo TEXT,
  departamento_meta TEXT,
  programa TEXT, categoria_ppto TEXT,
  producto_proyecto TEXT, actividad TEXT,
  funcion TEXT, fuente TEXT, tipo_gasto TEXT,
  pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC
);
"""

DIMS = ("nivel", "sector", "departamento", "provincia", "distrito", "ubigeo",
        "departamento_meta", "programa", "categoria_ppto", "producto_proyecto",
        "actividad", "funcion", "fuente", "tipo_gasto")


def categoria_ppto(prog_code: str) -> str:
    c = (prog_code or "").strip()
    if c == "9001":
        return "ACCIONES CENTRALES"
    if c == "9002":
        return "APNOP"  # Asignaciones que no resultan en productos
    if c.isdigit():
        return "PROGRAMAS PRESUPUESTALES"
    return "—"


def reduce_csv(src: str, dst: str, year: int) -> int:
    """Stream del CSV crudo → TSV reducido (solo columnas del cubo). Sin agregar en RAM."""
    n = 0
    with open(src, encoding="utf-8", errors="ignore", newline="") as fh, \
            open(dst, "w", encoding="utf-8", newline="") as out:
        rd = csv.reader(fh)
        next(rd, None)
        w = csv.writer(out, delimiter="\t")
        for r in rd:
            if len(r) <= NCOLS:
                continue
            dep, prov, di = r[IX["dep"]].strip(), r[IX["prov"]].strip(), r[IX["dist"]].strip()
            ub = ""
            if dep.isdigit() and prov.isdigit() and di.isdigit():
                ub = f"{int(dep):02d}{int(prov):02d}{int(di):02d}"
            w.writerow([
                year,
                r[IX["nivel"]].strip(),
                r[IX["sector"]].strip() or "GOBIERNOS LOCALES",
                r[IX["depnom"]].strip(), r[IX["provnom"]].strip(), r[IX["distnom"]].strip(), ub,
                r[IX["depmetanom"]].strip(),
                r[IX["prognom"]].strip(), categoria_ppto(r[IX["prog"]]),
                r[IX["prodproynom"]].strip(), r[IX["actnom"]].strip(),
                r[IX["funcionnom"]].strip(), r[IX["fuentenom"]].strip(), r[IX["catgastonom"]].strip(),
                r[IX["pia"]] or "0", r[IX["pim"]] or "0", r[IX["dev"]] or "0", r[IX["gir"]] or "0",
            ])
            n += 1
    return n


def archive(src: str, year: int):
    os.makedirs(RAW_DIR, exist_ok=True)
    gz = os.path.join(RAW_DIR, f"{year}-Gasto.csv.gz")
    with open(src, "rb") as fi, gzip.open(gz, "wb", compresslevel=6) as fo:
        shutil.copyfileobj(fi, fo, length=16 * 1024 * 1024)
    return gz, os.path.getsize(gz)


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2025
    t0 = time.time()
    raw = load.download(year)
    if not raw:
        print(f"[{year}] descarga incompleta → abortar", flush=True)
        sys.exit(1)
    raw_size = os.path.getsize(raw)
    tsv = f"/tmp/cubo_{year}.tsv"
    print(f"[{year}] reduciendo CSV ({raw_size/1e9:.1f} GB) a dimensiones del cubo…", flush=True)
    n = reduce_csv(raw, tsv, year)
    print(f"[{year}] {n:,} filas crudas → COPY a staging + GROUP BY en Postgres…", flush=True)

    with psycopg.connect(DB) as conn:
        with conn.cursor() as cur:
            cur.execute(CUBO_DDL)
            cur.execute(STG_DDL)
            with open(tsv, "r", encoding="utf-8") as fh:
                with cur.copy("COPY cubo_stg FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', QUOTE '\"')") as cp:
                    while chunk := fh.read(8 * 1024 * 1024):
                        cp.write(chunk)
            cur.execute("DELETE FROM gasto_cubo WHERE ano=%s", (year,))
            dims = ", ".join(DIMS)
            cur.execute(
                f"INSERT INTO gasto_cubo (ano, {dims}, pia, pim, devengado, girado) "
                f"SELECT ano, {dims}, SUM(pia), SUM(pim), SUM(devengado), SUM(girado) "
                f"FROM cubo_stg GROUP BY ano, {dims}")
            filas = cur.execute("SELECT count(*) FROM gasto_cubo WHERE ano=%s", (year,)).fetchone()[0]
            pim = cur.execute("SELECT SUM(pim) FROM gasto_cubo WHERE ano=%s", (year,)).fetchone()[0]
            size = cur.execute("SELECT pg_size_pretty(pg_total_relation_size('gasto_cubo'))").fetchone()[0]
            nproy = cur.execute("SELECT count(DISTINCT producto_proyecto) FROM gasto_cubo WHERE ano=%s",
                                (year,)).fetchone()[0]
            cur.execute("DROP TABLE IF EXISTS cubo_stg")
        conn.commit()

    print(f"[{year}] cubo: {filas:,} filas · PIM {float(pim)/1e9:.1f} mil M · "
          f"{nproy:,} productos/proyectos · tabla {size}", flush=True)
    gz, gz_size = archive(raw, year)
    print(f"[{year}] crudo archivado: {gz} ({gz_size/1e6:.0f} MB comprimido vs {raw_size/1e9:.1f} GB)", flush=True)
    for p in (raw, tsv):
        try:
            os.remove(p)
        except OSError:
            pass
    print(f"[{year}] LISTO en {time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
