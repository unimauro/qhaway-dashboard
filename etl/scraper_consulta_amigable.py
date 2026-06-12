#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scraper de la Consulta Amigable del MEF (apps5.mineco.gob.pe/transparencia/Navegador).
Hito 1: presupuesto por DEPARTAMENTO (destino META) para TODOS los años 1999-2026.

Mecánica validada (PoC):
  - Sesión con cookie jar pasa el WAF (Incapsula) sin navegador.
  - GET default.aspx?y=AÑO fija el año; GET Navegar.aspx?y=AÑO&ap=ActProy carga el navegador.
  - La fila TOTAL se auto-selecciona (radio grp1, su value codifica los montos).
  - POST al form (action Navegar_7.aspx) con SOLO el botón 'BtnDepartamentoMeta' → 25 deptos + Callao.
  - Columnas: nombre | PIA | PIM | Certificado | CompromisoAnual | AtencionMensual | Devengado | Girado | Avance%.

Escribe public/data/por-departamento-historico.json INCREMENTAL y reanudable.
Lento a propósito (pausas) para respetar el portal. Reanuda saltando años ya hechos.
"""
import requests, re, json, os, time, sys
from bs4 import BeautifulSoup

BASE = "https://apps5.mineco.gob.pe/transparencia/Navegador/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "por-departamento-historico.json")
YEARS = list(range(2026, 1998, -1))  # 2026 -> 1999


def new_session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    s.get(BASE + "default.aspx", timeout=40)
    return s


def fields(soup, click_name=None, click_val=None):
    d = {}
    for inp in soup.select("input"):
        n = inp.get("name"); t = (inp.get("type") or "text").lower()
        if not n:
            continue
        if t in ("submit", "button", "image", "reset"):
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


def parse_rows(soup, year, code_len=2):
    """Filas tipo 'NN: NOMBRE' (o 'NNNN:' para provincia, 'NNNNNN:' distrito) con
    una celda vacía inicial (radio). Devuelve dicts con montos."""
    out = []
    pat = re.compile(r"^(\d{%d}):\s*(.+)$" % code_len)
    for tr in soup.find_all("tr"):
        txt = [t.get_text(" ", strip=True) for t in tr.find_all("td")]
        # localizar la celda con 'NN: NOMBRE'
        idx = next((i for i, c in enumerate(txt) if pat.match(c)), None)
        if idx is None:
            continue
        m = pat.match(txt[idx])
        code, name = m.group(1), m.group(2).strip()
        nums = [num(c) for c in txt[idx + 1:] if re.match(r"^[\d,]+(\.\d+)?$", c.replace(",", ""))]
        if len(nums) < 6:
            continue
        # nums: PIA, PIM, Certif, CompAnual, AtencMensual, Devengado, Girado, (Avance%)
        out.append({"year": year, "code": code, "nombre": name,
                    "pia": nums[0], "pim": nums[1], "certificado": nums[2],
                    "devengado": nums[5], "girado": nums[6] if len(nums) > 6 else nums[5]})
    return out


def parse_deptos(soup, year):
    rows = parse_rows(soup, year, 2)
    for r in rows:
        r["ubigeo"] = r.pop("code"); r["departamento"] = r.pop("nombre")
    return rows


def scrape_year(s, year):
    s.get(f"{BASE}default.aspx?y={year}&ap=ActProy", timeout=40)
    html = s.get(f"{BASE}Navegar.aspx?y={year}&ap=ActProy", timeout=40).text
    soup = BeautifulSoup(html, "lxml")
    sel = soup.select_one("#ctl00_CPH1_DrpYear option[selected]")
    if not sel or sel.get_text(strip=True) != str(year):
        raise RuntimeError(f"año no fijado (got {sel.get_text(strip=True) if sel else '?'})")
    d = fields(soup, "ctl00$CPH1$BtnDepartamentoMeta", "Departamento")
    g = soup.select_one('input[name=grp1]')
    if g:
        d["grp1"] = g.get("value")
    action = soup.find("form").get("action")
    resp = s.post(BASE + action, data=d, headers={"Referer": f"{BASE}Navegar.aspx?y={year}&ap=ActProy"}, timeout=50).text
    return parse_deptos(BeautifulSoup(resp, "lxml"), year)


def main():
    data = {}
    if os.path.exists(OUT):
        for r in json.load(open(OUT)):
            data.setdefault(r["year"], []).append(r)
    done = set(data.keys())
    print(f"reanudando: años hechos {sorted(done)}", flush=True)
    s = new_session()
    for i, y in enumerate(YEARS):
        if y in done:
            continue
        for attempt in range(3):
            try:
                rows = scrape_year(s, y)
                if len(rows) >= 24:
                    data[y] = rows
                    flat = [r for k in sorted(data) for r in data[k]]
                    json.dump(flat, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
                    tot = sum(r["pim"] for r in rows)
                    print(f"  {y}: {len(rows)} deptos, PIM total {tot/1e9:.1f} mil M -> escrito", flush=True)
                    break
                else:
                    print(f"  {y}: solo {len(rows)} filas (reintento {attempt})", flush=True)
            except Exception as e:
                print(f"  {y}: error {repr(e)[:60]} (reintento {attempt})", flush=True)
                time.sleep(8)
                s = new_session()  # refrescar sesión/cookies
        time.sleep(3)  # respetar el portal
    flat = [r for k in sorted(data) for r in data[k]]
    print(f"LISTO: {len(data)} años, {len(flat)} filas", flush=True)


if __name__ == "__main__":
    main()
