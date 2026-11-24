#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Carga a PostgreSQL los JSON temáticos (programas, clima, mitigación, cortes) que hoy solo
viven en public/data, para que la API los sirva con EXACTAMENTE la misma forma que el archivo.

  por-programa-historico.json    → gasto_programa       (ano, code, programa, pia, pim, certificado, devengado, girado)
  programa-territorio-clima.json → gasto_programa_depto (ano, code, programa, ubigeo, departamento, pim, devengado)
  clima-tematico.json            → clima_tematico       (ano, code, nombre, pia, pim, devengado, girado, medida, atribucion, corte)
  mitigacion-2021-2027.json      → documento_json (texto íntegro) + mitigacion_serie (una fila por registro con año)
  riesgos.json                   → documento_json (texto íntegro) + riesgo_region (región × riesgo × nivel)
                                   + nino_estado (context.ninoActual, context.ninoEventos)
  cortes.json                    → corte_dataset        (dataset, fecha_corte, fuente, anios, generado)

Los documentos anidados (riesgos, mitigación) se sirven desde documento_json tal cual (tipo JSON,
no JSONB: conserva orden de claves y formato → misma respuesta byte a byte que el archivo); las
tablas relacionales derivadas sirven para consultar/cruzar en SQL.

Idempotente: por cada archivo, en UNA transacción, borra los años presentes en el archivo y los
reinserta (los años que el archivo no trae se conservan). Los montos van en DOUBLE PRECISION
(no NUMERIC) para que la API devuelva los mismos números que el JSON (p. ej. 1280629828.0), y
`orden` guarda la posición en el archivo para devolver las filas en el mismo orden.
Si un archivo no existe, se avisa y se sigue (las tablas quedan creadas).

Uso:  DATA_DIR=/data python load_tematico.py            # todos
      DATA_DIR=/data python load_tematico.py clima      # solo los que contienen 'clima' en el nombre
"""
import json
import os
import sys

import psycopg

DB = os.environ.get("DATABASE_URL", "postgresql://qhaway:qhaway_local@qhaway-db:5432/qhaway")
DATA = os.environ.get("DATA_DIR", "/data")
MITIGACION = os.environ.get("MITIGACION_FILE", "mitigacion-2021-2027.json")

SCHEMA = """
CREATE TABLE IF NOT EXISTS gasto_programa (ano INT NOT NULL, code TEXT, programa TEXT,
  pia DOUBLE PRECISION, pim DOUBLE PRECISION, certificado DOUBLE PRECISION,
  devengado DOUBLE PRECISION, girado DOUBLE PRECISION, orden INT);
CREATE INDEX IF NOT EXISTS ix_gprog_ano ON gasto_programa(ano);
CREATE TABLE IF NOT EXISTS gasto_programa_depto (ano INT NOT NULL, code TEXT, programa TEXT,
  ubigeo TEXT, departamento TEXT, pim DOUBLE PRECISION, devengado DOUBLE PRECISION, orden INT);
CREATE INDEX IF NOT EXISTS ix_gprogd_ano ON gasto_programa_depto(ano);
CREATE TABLE IF NOT EXISTS clima_tematico (ano INT NOT NULL, code TEXT, nombre TEXT,
  pia DOUBLE PRECISION, pim DOUBLE PRECISION, devengado DOUBLE PRECISION, girado DOUBLE PRECISION,
  medida TEXT, atribucion TEXT, corte TEXT, orden INT);
CREATE INDEX IF NOT EXISTS ix_clima_ano ON clima_tematico(ano);
-- Documentos anidados guardados íntegros (tipo JSON conserva el texto exacto).
CREATE TABLE IF NOT EXISTS documento_json (archivo TEXT PRIMARY KEY, doc JSON NOT NULL,
  cargado_en TIMESTAMPTZ NOT NULL DEFAULT now());
-- mitigación: el esquema lo describe la clave _doc del archivo (lo genera otro proceso).
CREATE TABLE IF NOT EXISTS mitigacion_serie (ano INT NOT NULL, clave TEXT NOT NULL, fila JSON NOT NULL, orden INT);
CREATE INDEX IF NOT EXISTS ix_mitig_ano ON mitigacion_serie(ano);
-- riesgos.json: una fila por región × tipo de riesgo.
CREATE TABLE IF NOT EXISTS riesgo_region (region_id TEXT NOT NULL, ubigeo TEXT, nombre TEXT, zona TEXT,
  ciudad TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION, pob BIGINT, riesgo TEXT NOT NULL,
  riesgo_nombre TEXT, nivel TEXT, fuente TEXT, orden INT, PRIMARY KEY (region_id, riesgo));
-- Estado de El Niño: claves de context (ninoActual, ninoEventos) como JSON.
CREATE TABLE IF NOT EXISTS nino_estado (clave TEXT PRIMARY KEY, valor JSON NOT NULL, fecha TEXT,
  cargado_en TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS corte_dataset (dataset TEXT PRIMARY KEY, fecha_corte DATE, fuente TEXT,
  anios INT[], generado TEXT, orden INT);
"""

# archivo → (tabla, columnas en la DB, claves del JSON en el mismo orden)
TABULARES = {
    "por-programa-historico.json": ("gasto_programa",
        ["ano", "code", "programa", "pia", "pim", "certificado", "devengado", "girado"],
        ["year", "code", "programa", "pia", "pim", "certificado", "devengado", "girado"]),
    "programa-territorio-clima.json": ("gasto_programa_depto",
        ["ano", "code", "programa", "ubigeo", "departamento", "pim", "devengado"],
        ["year", "code", "programa", "ubigeo", "departamento", "pim", "devengado"]),
    "clima-tematico.json": ("clima_tematico",
        ["ano", "code", "nombre", "pia", "pim", "devengado", "girado", "medida", "atribucion", "corte"],
        ["year", "code", "nombre", "pia", "pim", "devengado", "girado", "medida", "atribucion", "corte"]),
}


def leer(nombre):
    p = os.path.join(DATA, nombre)
    if not os.path.exists(p):
        print(f"  AVISO: no existe {p}; se omite (tabla creada, vacía)", flush=True)
        return None, None
    with open(p, encoding="utf-8") as fh:
        txt = fh.read()
    return txt, json.loads(txt)


def cargar_tabular(conn, nombre, tabla, cols, keys):
    _, d = leer(nombre)
    if d is None:
        return
    if not isinstance(d, list):
        raise RuntimeError(f"{nombre}: se esperaba una lista de registros")
    for i, r in enumerate(d):
        falt = [k for k in keys if k not in r]
        extra = [k for k in r if k not in keys]
        if falt or extra:
            raise RuntimeError(f"{nombre}[{i}]: esquema distinto (faltan {falt}, sobran {extra})")
    anos = sorted({r["year"] for r in d})
    ph = ",".join(["%s"] * (len(cols) + 1))
    with conn.transaction():
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {tabla} WHERE ano = ANY(%s)", (anos,))
        cur.executemany(f"INSERT INTO {tabla} ({','.join(cols)},orden) VALUES ({ph})",
                        [tuple(r[k] for k in keys) + (i,) for i, r in enumerate(d)])
        otros = [a for (a,) in cur.execute(f"SELECT DISTINCT ano FROM {tabla} WHERE NOT (ano = ANY(%s)) "
                                           "ORDER BY 1", (anos,)).fetchall()]
    print(f"  {tabla}: {len(d)} filas, años {anos[0]}–{anos[-1]}"
          + (f" (se conservan años ausentes del archivo: {otros})" if otros else ""), flush=True)


def _ano(r):
    for k in ("year", "ano", "anio", "año"):
        v = r.get(k) if isinstance(r, dict) else None
        if isinstance(v, int) or (isinstance(v, str) and v.isdigit()):
            return int(v)
    return None


def guardar_doc(cur, archivo, txt):
    cur.execute("INSERT INTO documento_json (archivo, doc) VALUES (%s, %s) ON CONFLICT (archivo) "
                "DO UPDATE SET doc=EXCLUDED.doc, cargado_en=now()", (archivo, txt))


def cargar_mitigacion(conn):
    txt, d = leer(MITIGACION)
    if d is None:
        return
    # Registros con año: la lista raíz, o cada lista de primer nivel del objeto (clave = su nombre).
    listas = {"": d} if isinstance(d, list) else {k: v for k, v in d.items() if isinstance(v, list)}
    filas = [(_ano(r), clave, json.dumps(r, ensure_ascii=False), i)
             for clave, lst in listas.items() for i, r in enumerate(lst) if _ano(r) is not None]
    with conn.transaction():
        cur = conn.cursor()
        guardar_doc(cur, "mitigacion", txt)
        cur.execute("DELETE FROM mitigacion_serie")
        cur.executemany("INSERT INTO mitigacion_serie (ano, clave, fila, orden) VALUES (%s,%s,%s,%s)", filas)
    print(f"  mitigacion: documento íntegro + {len(filas)} registros con año "
          f"en {sorted(set(c for _, c, _, _ in filas))}", flush=True)


def cargar_riesgos(conn):
    txt, d = leer("riesgos.json")
    if d is None:
        return
    regs, labels, ctx = d.get("regions") or [], d.get("riskLabels") or {}, d.get("context") or {}
    if not regs:
        raise RuntimeError("riesgos.json sin 'regions'")
    filas = []
    for i, r in enumerate(regs):
        fuentes = r.get("fuente") or {}
        for rk, nivel in (r.get("risks") or {}).items():
            filas.append((r["id"], r.get("ubigeo"), r.get("name"), r.get("zona"), r.get("ciudad"),
                          r.get("lat"), r.get("lon"), r.get("pob"), rk, labels.get(rk), nivel,
                          fuentes.get(rk), i))
    with conn.transaction():
        cur = conn.cursor()
        guardar_doc(cur, "riesgos", txt)
        cur.execute("DELETE FROM riesgo_region")
        cur.executemany("INSERT INTO riesgo_region (region_id, ubigeo, nombre, zona, ciudad, lat, lon, pob, "
                        "riesgo, riesgo_nombre, nivel, fuente, orden) VALUES "
                        "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", filas)
        cur.execute("DELETE FROM nino_estado")
        for k in ("ninoActual", "ninoEventos"):
            if k in ctx:
                cur.execute("INSERT INTO nino_estado (clave, valor, fecha) VALUES (%s,%s,%s)",
                            (k, json.dumps(ctx[k], ensure_ascii=False), d.get("lastUpdate")))
    print(f"  riesgos: documento íntegro + {len(filas)} región×riesgo "
          f"({sum(1 for f in filas if f[8] == 'nino')} con El Niño) + nino_estado "
          f"{[k for k in ('ninoActual', 'ninoEventos') if k in ctx]}", flush=True)


def cargar_cortes(conn):
    _, d = leer("cortes.json")
    if d is None:
        return
    with conn.transaction():
        cur = conn.cursor()
        for i, (ds, v) in enumerate(d.items()):
            extra = [k for k in v if k not in ("anios", "fecha_corte", "fuente", "generado")]
            if extra:
                raise RuntimeError(f"cortes.json[{ds}]: claves no previstas {extra}")
            cur.execute("INSERT INTO corte_dataset (dataset, fecha_corte, fuente, anios, generado, orden) "
                        "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (dataset) DO UPDATE SET "
                        "fecha_corte=EXCLUDED.fecha_corte, fuente=EXCLUDED.fuente, anios=EXCLUDED.anios, "
                        "generado=EXCLUDED.generado, orden=EXCLUDED.orden",
                        (ds, v.get("fecha_corte"), v.get("fuente"), v.get("anios"), v.get("generado"), i))
    print(f"  corte_dataset: {len(d)} datasets", flush=True)


def main():
    filtro = sys.argv[1:]
    sel = lambda n: not filtro or any(f in n for f in filtro)  # noqa: E731
    with psycopg.connect(DB) as conn:
        conn.execute(SCHEMA)
        conn.commit()
        for nombre, (tabla, cols, keys) in TABULARES.items():
            if sel(nombre):
                cargar_tabular(conn, nombre, tabla, cols, keys)
        if sel(MITIGACION):
            cargar_mitigacion(conn)
        if sel("riesgos.json"):
            cargar_riesgos(conn)
        if sel("cortes.json"):
            cargar_cortes(conn)
    print("LISTO load_tematico", flush=True)


if __name__ == "__main__":
    main()
