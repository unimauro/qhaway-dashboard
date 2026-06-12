#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Carga rápida a Postgres de los JSON ya calculados (serie 22 años, regional, distrital 2025…),
para que la API sirva datos reales de inmediato mientras el CSV completo se migra en paralelo.
Lee de /data (montado). Idempotente por año/tabla.
"""
import os, json, glob
import psycopg

DB = os.environ.get("DATABASE_URL", "postgresql://qhaway:qhaway_local@qhaway-db:5432/qhaway")
DATA = os.environ.get("DATA_DIR", "/data")

SCHEMA = """
CREATE TABLE IF NOT EXISTS gasto_nacional (ano INT PRIMARY KEY, pia NUMERIC, pim NUMERIC, certificado NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_distrito (ano INT, ubigeo TEXT, departamento TEXT, provincia TEXT, distrito TEXT, nivel TEXT, pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_funcion (ano INT, funcion TEXT, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_sector (ano INT, sector TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_nivel (ano INT, nivel TEXT, pia NUMERIC, pim NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_meta_funcion (ano INT, ubigeo TEXT, departamento TEXT, funcion TEXT, nivel TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_meta_fuente (ano INT, ubigeo TEXT, departamento TEXT, fuente TEXT, nivel TEXT, pim NUMERIC, devengado NUMERIC);
CREATE TABLE IF NOT EXISTS gasto_depto_hist (ano INT, ubigeo TEXT, departamento TEXT, pia NUMERIC, pim NUMERIC, certificado NUMERIC, devengado NUMERIC, girado NUMERIC);
CREATE INDEX IF NOT EXISTS ix_dist_ano ON gasto_distrito(ano);
CREATE INDEX IF NOT EXISTS ix_mf_ano ON gasto_meta_funcion(ano);
CREATE INDEX IF NOT EXISTS ix_mfu_ano ON gasto_meta_fuente(ano);
"""


def j(name):
    p = os.path.join(DATA, name)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


def g(d, *keys):
    for k in keys:
        if k in d:
            return d[k]
    return 0


def main():
    with psycopg.connect(DB) as conn:
        with conn.cursor() as c:
            c.execute(SCHEMA)
        conn.commit()
        with conn.cursor() as c:
            # serie nacional (22 años)
            serie = j("serie-historica-oficial.json") or []
            for r in serie:
                c.execute("DELETE FROM gasto_nacional WHERE ano=%s", (r["year"],))
                c.execute("INSERT INTO gasto_nacional VALUES (%s,%s,%s,%s,%s,%s)",
                          (r["year"], g(r, "pia"), g(r, "pim"), g(r, "certificado"), g(r, "devengado"), g(r, "girado")))
            print(f"gasto_nacional: {len(serie)} años")

            # regional histórico (22 años)
            dh = j("por-departamento-historico.json") or []
            anos = set(r["year"] for r in dh)
            for a in anos:
                c.execute("DELETE FROM gasto_depto_hist WHERE ano=%s", (a,))
            c.executemany("INSERT INTO gasto_depto_hist VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                          [(r["year"], r["ubigeo"], r["departamento"], g(r, "pia"), g(r, "pim"),
                            g(r, "certificado"), g(r, "devengado"), g(r, "girado")) for r in dh])
            print(f"gasto_depto_hist: {len(dh)} filas, {len(anos)} años")

            # distrital + función/sector/explorador por año (archivos por-distrito-*.json)
            def load_year_files(year):
                dist = j(f"por-distrito-{year}.json")
                if dist:
                    c.execute("DELETE FROM gasto_distrito WHERE ano=%s", (year,))
                    c.executemany("INSERT INTO gasto_distrito VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                                  [(year, r["ubigeo"], r["departamento"], r["provincia"], r["distrito"], r["nivel"],
                                    g(r, "pia"), g(r, "pim"), g(r, "devengado"), g(r, "girado")) for r in dist])
                    print(f"gasto_distrito {year}: {len(dist)} filas")
                fn = j(f"por-funcion-{year}.json")
                if fn:
                    c.execute("DELETE FROM gasto_funcion WHERE ano=%s", (year,))
                    c.executemany("INSERT INTO gasto_funcion VALUES (%s,%s,%s,%s,%s)",
                                  [(year, r["funcion"], g(r, "pim"), g(r, "devengado"), g(r, "girado")) for r in fn])
                se = j(f"por-sector-{year}.json")
                if se:
                    c.execute("DELETE FROM gasto_sector WHERE ano=%s", (year,))
                    c.executemany("INSERT INTO gasto_sector VALUES (%s,%s,%s,%s)",
                                  [(year, r["sector"], g(r, "pim"), g(r, "devengado")) for r in se])
                mf = j(f"explorador-funcion-meta-{year}.json")
                if mf:
                    c.execute("DELETE FROM gasto_meta_funcion WHERE ano=%s", (year,))
                    c.executemany("INSERT INTO gasto_meta_funcion VALUES (%s,%s,%s,%s,%s,%s,%s)",
                                  [(year, r["ubigeo"], r["departamento"], r["funcion"], r["nivel"], g(r, "pim"), g(r, "devengado")) for r in mf])
                ff = j(f"explorador-fuente-meta-{year}.json")
                if ff:
                    c.execute("DELETE FROM gasto_meta_fuente WHERE ano=%s", (year,))
                    c.executemany("INSERT INTO gasto_meta_fuente VALUES (%s,%s,%s,%s,%s,%s,%s)",
                                  [(year, r["ubigeo"], r["departamento"], r["fuente"], r["nivel"], g(r, "pim"), g(r, "devengado")) for r in ff])

            # años con archivos por-distrito-*.json
            import re
            years = sorted({int(re.search(r"(\d{4})", os.path.basename(p)).group(1))
                            for p in glob.glob(os.path.join(DATA, "por-distrito-*.json"))})
            print(f"años distritales encontrados: {years}")
            for y in years:
                load_year_files(y)

            # nivel de gobierno (archivo 2025 'por-nivel-gobierno.json')
            niv = j("por-nivel-gobierno.json")
            if niv:
                a = niv[0].get("year", 2025) if niv else 2025
                c.execute("DELETE FROM gasto_nivel WHERE ano=%s", (a,))
                c.executemany("INSERT INTO gasto_nivel VALUES (%s,%s,%s,%s,%s,%s)",
                              [(r.get("year", a), r["nivel"], g(r, "pia"), g(r, "pim"), g(r, "devengado"), g(r, "girado")) for r in niv])
        conn.commit()
    print("LISTO load_json")


if __name__ == "__main__":
    main()
