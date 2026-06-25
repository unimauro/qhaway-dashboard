#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Descubrimiento del navegador climático del MEF (Adaptación/Mitigación ante el Cambio
Climático). Vuelca los controles (selects de Medida/Atribución, botones de dimensión y la
acción del form) para construir el scraper real. NO scrapea datos todavía: solo inspecciona.

Navegador: https://apps5.mineco.gob.pe/cambioclimatico2023/Navegador/  (mismo motor ASP.NET
que la Consulta Amigable general → reutiliza la técnica de scraper_programa.py).

Uso:  python3 etl/scraper_clima_discovery.py 2024
"""
import sys
import requests
from bs4 import BeautifulSoup

BASE = "https://apps5.mineco.gob.pe/cambioclimatico2023/Navegador/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")


def new_session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    s.get(BASE + "default.aspx", timeout=40)
    return s


def main():
    year = sys.argv[1] if len(sys.argv) > 1 else "2024"
    s = new_session()
    # Probar con y sin ?ap=ActProy (el navegador climático tiene su propio filtro Act/Proy).
    for suffix in (f"?y={year}&ap=ActProy", f"?y={year}"):
        try:
            s.get(f"{BASE}default.aspx{suffix}", timeout=40)
            r = s.get(f"{BASE}Navegar.aspx{suffix}", timeout=40)
            if r.ok and "DrpYear" in r.text:
                print(f"### Navegar.aspx{suffix}  (HTTP {r.status_code}, {len(r.text)} bytes)")
                break
        except Exception as e:
            print(f"  intento {suffix}: {type(e).__name__}")
    else:
        print("No se pudo cargar el navegador (¿WAF?). Revisar manualmente.")
        return
    soup = BeautifulSoup(r.text, "html.parser")

    yr = soup.select_one("#ctl00_CPH1_DrpYear option[selected]") or \
        soup.select_one("select[name$=DrpYear] option[selected]")
    print("AÑO seleccionado:", yr.get_text(strip=True) if yr else "??")

    print("\n=== SELECTS (name -> opciones) ===")
    for sel in soup.select("select"):
        n = sel.get("name")
        opts = [(o.get("value", ""), o.get_text(strip=True)) for o in sel.select("option")]
        print(f"\n[{n}]  ({len(opts)} opciones)")
        for v, t in opts[:15]:
            print(f"   {v!r:>10} = {t}")

    print("\n=== BOTONES / inputs clicables ===")
    for inp in soup.select("input"):
        n = inp.get("name") or ""
        t = (inp.get("type") or "text").lower()
        if "Btn" in n or t in ("submit", "image", "button"):
            print(f"   name={n!r}  type={t}  value={inp.get('value', '')!r}")

    f = soup.find("form")
    print("\n=== form action ===", f.get("action") if f else None)


if __name__ == "__main__":
    main()
