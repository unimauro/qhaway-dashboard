#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scrape 2D: PROGRAMA PRESUPUESTAL CLIMÁTICO × DEPARTAMENTO (destino META) × año.

Permite cortes tipo "conservación de biodiversidad en Cusco". Para cada año:
  1) POST BtnProgramaPpto → lista de programas (cada fila tiene su radio grp1).
  2) Para cada programa CLIMÁTICO presente, fija grp1=<su radio> y POST BtnDepartamentoMeta
     → distribución por departamento de ese programa.

Corre LOCAL (Mac). Lento a propósito. Escribe public/data/programa-territorio-clima.json,
incremental y reanudable por (año, code).
"""
import requests, re, json, os, time, sys
from bs4 import BeautifulSoup

BASE = "https://apps5.mineco.gob.pe/transparencia/Navegador/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "programa-territorio-clima.json")

# Programas con componente ambiental/climático (espejo de src/lib/programas.ts)
CLIMA = ['0057', '0068', '0096', '0120', '0130', '0144', '0036', '0042', '0089',
         '0082', '0083', '0046', '0118', '0072']


def new_session():
    s = requests.Session(); s.headers.update({"User-Agent": UA}); s.get(BASE + "default.aspx", timeout=40); return s


def fields(soup, cn=None, cv=None):
    d = {}
    for inp in soup.select("input"):
        n = inp.get("name"); t = (inp.get("type") or "text").lower()
        if not n or t in ("submit", "button", "image", "reset"): continue
        if t in ("radio", "checkbox"):
            if inp.has_attr("checked"): d[n] = inp.get("value", "on")
        else: d[n] = inp.get("value", "")
    for sel in soup.select("select"):
        n = sel.get("name")
        if n:
            o = sel.select_one("option[selected]") or sel.select_one("option"); d[n] = o.get("value", "") if o else ""
    if cn: d[cn] = cv
    return d


def num(s):
    s = (s or "").replace(",", "").strip()
    try: return round(float(s), 2)
    except ValueError: return 0.0


def btn(soup, key):
    for i in soup.select("input[type=submit],input[type=button]"):
        if key in (i.get("name") or "").lower(): return i.get("name"), i.get("value", "")
    raise RuntimeError(f"botón {key} no hallado")


def post(s, soup, click_key, click_val_default, grp1=None, year=None):
    bn, bv = btn(soup, click_key)
    d = fields(soup, bn, bv or click_val_default)
    if grp1 is not None: d["grp1"] = grp1
    else:
        g = soup.select_one('input[name=grp1]')
        if g: d["grp1"] = g.get("value")
    action = soup.find("form").get("action")
    ref = f"{BASE}Navegar.aspx?y={year}&ap=ActProy"
    return BeautifulSoup(s.post(BASE + action, data=d, headers={"Referer": ref}, timeout=60).text, "lxml")


def programa_radios(soup):
    """{code: radio_value} de la lista de programas."""
    pat = re.compile(r"^(\d{1,4}):\s")
    out = {}
    for tr in soup.find_all("tr"):
        txt = [t.get_text(" ", strip=True) for t in tr.find_all("td")]
        m = next((c for c in txt if pat.match(c)), None)
        if not m: continue
        code = pat.match(m).group(1)
        r = tr.find("input", {"name": "grp1"})
        if r: out[code] = r.get("value")
    return out


def parse_deptos(soup, year, code, programa):
    pat = re.compile(r"^(\d{2}):\s*(.+)$")
    out = []
    for tr in soup.find_all("tr"):
        txt = [t.get_text(" ", strip=True) for t in tr.find_all("td")]
        idx = next((i for i, c in enumerate(txt) if pat.match(c)), None)
        if idx is None: continue
        m = pat.match(txt[idx]); ub, name = m.group(1), m.group(2).strip()
        nums = [num(c) for c in txt[idx + 1:] if re.match(r"^[\d,]+(\.\d+)?$", c.replace(",", ""))]
        if len(nums) < 6: continue
        out.append({"year": year, "code": code, "programa": programa, "ubigeo": ub,
                    "departamento": name, "pim": nums[1], "devengado": nums[5]})
    return out


def main():
    args = sys.argv[1:]
    years = list(range(2026, 2011, -1)) if (not args or args[0] == "all") else [int(a) for a in args]
    rows = json.load(open(OUT)) if os.path.exists(OUT) else []
    done = {(r["year"], r["code"]) for r in rows}
    s = new_session()
    for y in years:
        try:
            s.get(f"{BASE}default.aspx?y={y}&ap=ActProy", timeout=40)
            base_soup = BeautifulSoup(s.get(f"{BASE}Navegar.aspx?y={y}&ap=ActProy", timeout=40).text, "lxml")
            sel = base_soup.select_one("#ctl00_CPH1_DrpYear option[selected]")
            if not sel or sel.get_text(strip=True) != str(y):
                print(f"{y}: año no fijado, skip", flush=True); continue
            prog_soup = post(s, base_soup, "programa", "Programa", year=y)
            radios = programa_radios(prog_soup)
            names = {}
            pat = re.compile(r"^(\d{1,4}):\s*(.+)$")
            for tr in prog_soup.find_all("tr"):
                for c in [t.get_text(" ", strip=True) for t in tr.find_all("td")]:
                    m = pat.match(c)
                    if m: names[m.group(1)] = m.group(2).strip()
        except Exception as e:
            print(f"{y}: error base {repr(e)[:60]}", flush=True); s = new_session(); time.sleep(6); continue
        for code in CLIMA:
            if (y, code) in done or code not in radios:
                continue
            for attempt in range(2):
                try:
                    dsoup = post(s, prog_soup, "departamentometa", "Departamento", grp1=radios[code], year=y)
                    deps = parse_deptos(dsoup, y, code, names.get(code, code))
                    if len(deps) >= 1:
                        rows += deps; done.add((y, code))
                        json.dump(rows, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
                        print(f"  {y} {code} {names.get(code,'')[:28]:28} → {len(deps)} deptos", flush=True)
                        break
                    else:
                        print(f"  {y} {code}: solo {len(deps)} deptos (reintento)", flush=True)
                except Exception as e:
                    print(f"  {y} {code}: error {repr(e)[:50]}", flush=True); time.sleep(5)
            time.sleep(2)
    print(f"LISTO: {len(rows)} filas, {len(done)} pares (año,programa)", flush=True)


if __name__ == "__main__":
    main()
