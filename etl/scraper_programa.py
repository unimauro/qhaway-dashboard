#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scraper de la Consulta Amigable del MEF — CATEGORÍA / PROGRAMA PRESUPUESTAL por año.

Hermano de scraper_consulta_amigable.py: en vez de clicar 'BtnDepartamentoMeta', clica
el botón de **Programa Presupuestal** para traer los ~90 programas presupuestales con sus
montos (PIA/PIM/Certificado/Devengado/Girado) por año. Incluye los programas CLIMÁTICOS
(conservación de biodiversidad, gestión de riesgo de desastres, recursos hídricos, etc.).

Corre LOCAL (Mac, conexión residencial) — tablas agregadas pequeñas, NO toca el VPS.
Lento a propósito (respeta el WAF Incapsula). Escribe public/data/por-programa-historico.json,
incremental y reanudable.

Uso:
  python3 etl/scraper_programa.py 2025            # un año (para probar)
  python3 etl/scraper_programa.py 2026 2025 2024  # varios
  python3 etl/scraper_programa.py all             # 2026..2012
"""
import requests, re, json, os, time, sys
from bs4 import BeautifulSoup

BASE = "https://apps5.mineco.gob.pe/transparencia/Navegador/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "por-programa-historico.json")

# El botón de Programa Presupuestal en el navegador del MEF (probamos varios nombres posibles).
BTN_CANDIDATOS = ["BtnProgramaPpto", "BtnPrograma", "BtnCategoria", "BtnCategoriaPresupuestal"]


def new_session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    s.get(BASE + "default.aspx", timeout=40)
    return s


def fields(soup, click_name=None, click_val=None):
    d = {}
    for inp in soup.select("input"):
        n = inp.get("name"); t = (inp.get("type") or "text").lower()
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
    if click_name:
        d[click_name] = click_val
    return d


def num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


def parse_programas(soup, year):
    """Filas 'NNNN: NOMBRE' (programa presupuestal, código de 1-4 dígitos) con montos."""
    out = []
    pat = re.compile(r"^(\d{1,4}):\s*(.+)$")
    for tr in soup.find_all("tr"):
        txt = [t.get_text(" ", strip=True) for t in tr.find_all("td")]
        idx = next((i for i, c in enumerate(txt) if pat.match(c)), None)
        if idx is None:
            continue
        m = pat.match(txt[idx])
        code, name = m.group(1), m.group(2).strip()
        nums = [num(c) for c in txt[idx + 1:] if re.match(r"^[\d,]+(\.\d+)?$", c.replace(",", ""))]
        if len(nums) < 6:
            continue
        out.append({"year": year, "code": code, "programa": name,
                    "pia": nums[0], "pim": nums[1], "certificado": nums[2],
                    "devengado": nums[5], "girado": nums[6] if len(nums) > 6 else nums[5]})
    return out


def find_button(soup):
    """Encuentra el botón de Programa Presupuestal por nombre, devuelve (name, value)."""
    for inp in soup.select("input[type=submit], input[type=button]"):
        n = inp.get("name") or ""
        if any(c.lower() in n.lower() for c in BTN_CANDIDATOS):
            return n, inp.get("value", "Programa")
    # fallback: lista los botones disponibles para depurar
    botones = [(inp.get("name"), inp.get("value")) for inp in soup.select("input[type=submit], input[type=button]")]
    raise RuntimeError(f"botón de programa no hallado. Botones: {botones[:25]}")


def scrape_year(s, year):
    s.get(f"{BASE}default.aspx?y={year}&ap=ActProy", timeout=40)
    html = s.get(f"{BASE}Navegar.aspx?y={year}&ap=ActProy", timeout=40).text
    soup = BeautifulSoup(html, "lxml")
    sel = soup.select_one("#ctl00_CPH1_DrpYear option[selected]")
    if not sel or sel.get_text(strip=True) != str(year):
        raise RuntimeError(f"año no fijado (got {sel.get_text(strip=True) if sel else '?'})")
    bname, bval = find_button(soup)
    d = fields(soup, bname, bval)
    g = soup.select_one('input[name=grp1]')
    if g:
        d["grp1"] = g.get("value")
    action = soup.find("form").get("action")
    resp = s.post(BASE + action, data=d, headers={"Referer": f"{BASE}Navegar.aspx?y={year}&ap=ActProy"}, timeout=50).text
    return parse_programas(BeautifulSoup(resp, "lxml"), year)


def main():
    args = [a for a in sys.argv[1:]]
    years = list(range(2026, 2011, -1)) if (not args or args[0] == "all") else [int(a) for a in args]
    data = {}
    if os.path.exists(OUT):
        for r in json.load(open(OUT)):
            data.setdefault(r["year"], []).append(r)
    done = set(data.keys())
    print(f"reanudando: años hechos {sorted(done)} · objetivo {years}", flush=True)
    s = new_session()
    for y in years:
        if y in done:
            print(f"  {y}: ya hecho, skip", flush=True); continue
        for attempt in range(3):
            try:
                rows = scrape_year(s, y)
                if len(rows) >= 5:
                    data[y] = rows
                    flat = [r for k in sorted(data) for r in data[k]]
                    json.dump(flat, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
                    tot = sum(r["pim"] for r in rows)
                    print(f"  {y}: {len(rows)} programas, PIM total {tot/1e9:.1f} mil M -> escrito", flush=True)
                    break
                else:
                    print(f"  {y}: solo {len(rows)} filas (reintento {attempt})", flush=True)
            except Exception as e:
                print(f"  {y}: error {repr(e)[:120]} (reintento {attempt})", flush=True)
                time.sleep(8)
                s = new_session()
        time.sleep(3)
    print(f"LISTO: {len(data)} años", flush=True)


if __name__ == "__main__":
    main()
