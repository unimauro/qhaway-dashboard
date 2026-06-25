#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scraper del navegador climático del MEF — clasificador temático OFICIAL de cambio
climático (Adaptación / Mitigación / Ambas × Directa / Indirecta), por año × dimensión.

Fuente: https://apps5.mineco.gob.pe/cambioclimatico2023/Navegador/  (mismo motor ASP.NET
que la Consulta Amigable general; controles confirmados por scraper_clima_discovery.py).

Reemplaza el proxy "función=AMBIENTE" del módulo de Clima por el etiquetado oficial.
Corre LOCAL (mejor para el WAF), lento, incremental y reanudable.

Uso:
  python3 etl/scraper_clima.py test            # 1 corte de validación
  python3 etl/scraper_clima.py 2024            # un año (todas las medidas×atrib×cortes)
  python3 etl/scraper_clima.py all             # 2016..2026
"""
import requests
import re
import json
import os
import sys
import time
from bs4 import BeautifulSoup

BASE = "https://apps5.mineco.gob.pe/cambioclimatico2023/Navegador/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "clima-tematico.json")

FLD_MEDIDA = "ctl00$CPH1$DrpMedida"
FLD_ATRIB = "ctl00$CPH1$DrpAtribucion"
# medida (clave del POST → etiqueta legible)
MEDIDAS = {"Mitigacion": "Mitigación", "Adaptacion": "Adaptación",
           "MitigacionAdaptacion": "Mitigación y Adaptación"}
ATRIB = {"Directa": "Directa", "Indirecta": "Indirecta"}
# corte → (nombre del botón, value del botón)
CORTES = {
    "funcion": ("ctl00$CPH1$BtnFuncion", "Función"),
    "departamento": ("ctl00$CPH1$BtnDepartamentoMeta", "Departamento"),
    "nivel": ("ctl00$CPH1$BtnTipoGobierno", "Nivel de Gobierno"),
}
YEARS_ALL = list(range(2026, 2015, -1))  # 2026..2016


def new_session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    s.get(BASE + "default.aspx", timeout=40)
    return s


def fields(soup):
    d = {}
    for inp in soup.select("input"):
        n = inp.get("name")
        t = (inp.get("type") or "text").lower()
        if not n or t in ("submit", "button", "image", "reset"):
            continue
        if t in ("radio", "checkbox"):
            if inp.has_attr("checked"):
                d[n] = inp.get("value", "on")
        else:
            d[n] = inp.get("value", "")
    for sel in soup.select("select"):
        n = sel.get("name")
        if n:
            o = sel.select_one("option[selected]") or sel.select_one("option")
            d[n] = o.get("value", "") if o else ""
    return d


def num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


def parse_rows(soup, year):
    """Filas 'NN: NOMBRE' (código 1-4 dígitos) con montos.

    Layout del navegador climático (confirmado por inspección): tras 'NN: NOMBRE' vienen
    [Ejecución 2014-2023 (acumulado histórico), PIA, PIM, Certificación, Compromiso Anual,
    Atención Compromiso Mensual, Devengado, Girado, Avance %]. Anclamos desde la DERECHA
    (Avance% es la última), robusto ante la presencia/ausencia de la columna histórica:
      Avance%=-1, Girado=-2, Devengado=-3, Atención=-4, Compromiso=-5, Certif=-6, PIM=-7, PIA=-8.
    """
    out = []
    pat = re.compile(r"^(\d{1,4}):\s*(.+)$")
    for tr in soup.find_all("tr"):
        txt = [t.get_text(" ", strip=True) for t in tr.find_all("td")]
        idx = next((i for i, c in enumerate(txt) if pat.match(c)), None)
        if idx is None:
            continue
        m = pat.match(txt[idx])
        code, name = m.group(1), m.group(2).strip()
        nums = [num(c) for c in txt[idx + 1:] if re.match(r"^-?[\d,]+(\.\d+)?$", c.replace(",", ""))]
        if len(nums) < 8:  # necesitamos al menos PIA..Avance
            continue
        out.append({"year": year, "code": code, "nombre": name,
                    "pia": nums[-8], "pim": nums[-7], "devengado": nums[-3], "girado": nums[-2]})
    return out


def scrape_cut(s, year, medida_k, atrib_k, corte_k):
    # El filtro Medida/Atribución NO va por el form: el JS Reload() del navegador lo aplica
    # por querystring en default.aspx → &md=<medida>&att=<atribucion>. (Verificado:
    # con estos params los totales por medida/atribución difieren; sin ellos, todos iguales.)
    qs = f"y={year}&ap=ActProy&md={medida_k}&att={atrib_k}"
    s.get(f"{BASE}default.aspx?{qs}", timeout=40)
    soup = BeautifulSoup(s.get(f"{BASE}Navegar.aspx?{qs}", timeout=40).text, "html.parser")
    d = fields(soup)
    btn_name, btn_val = CORTES[corte_k]
    d[btn_name] = btn_val
    action = soup.find("form").get("action") or f"Navegar_1.aspx?{qs}"
    html = s.post(BASE + action, data=d,
                  headers={"Referer": f"{BASE}Navegar.aspx?{qs}"}, timeout=50).text
    rows = parse_rows(BeautifulSoup(html, "html.parser"), year)
    for r in rows:
        r["medida"] = MEDIDAS[medida_k]
        r["atribucion"] = ATRIB[atrib_k]
        r["corte"] = corte_k
    return rows


def run(years, cortes=("funcion", "departamento")):
    existing = []
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as fh:
            existing = json.load(fh)
    done = {(r["year"], r["medida"], r["atribucion"], r["corte"]) for r in existing}
    s = new_session()
    out = list(existing)
    for year in years:
        for mk, mv in MEDIDAS.items():
            for ak, av in ATRIB.items():
                for ck in cortes:
                    if (year, mv, av, ck) in done:
                        continue
                    for attempt in range(3):
                        try:
                            rows = scrape_cut(s, year, mk, ak, ck)
                            out = [r for r in out if not (r["year"] == year and r["medida"] == mv
                                                          and r["atribucion"] == av and r["corte"] == ck)]
                            out += rows
                            print(f"  {year} {mv}/{av}/{ck}: {len(rows)} filas, "
                                  f"PIM {sum(r['pim'] for r in rows)/1e6:.0f} M", flush=True)
                            time.sleep(3)
                            break
                        except Exception as e:  # noqa: BLE001
                            print(f"  {year} {mv}/{av}/{ck}: reintento ({type(e).__name__})", flush=True)
                            time.sleep(8)
                            s = new_session()
                    with open(OUT, "w", encoding="utf-8") as fh:
                        json.dump(out, fh, ensure_ascii=False)
    print(f"LISTO → {OUT} ({len(out)} filas)", flush=True)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "test"
    if arg == "test":
        s = new_session()
        rows = scrape_cut(s, 2024, "Adaptacion", "Directa", "funcion")
        print(f"TEST 2024 Adaptación/Directa/función → {len(rows)} filas")
        for r in rows[:8]:
            print(f"   {r['code']}: {r['nombre'][:40]:40} PIM {r['pim']/1e6:8.1f} M  dev {r['devengado']/1e6:8.1f} M")
        return
    years = YEARS_ALL if arg == "all" else [int(a) for a in sys.argv[1:]]
    run(years)


if __name__ == "__main__":
    main()
