# -*- coding: utf-8 -*-
"""Fecha de corte de los JSON scrapeados de la Consulta Amigable del MEF.

Los JSON de datos son arrays planos que src/ lee tal cual, así que la fecha de corte NO
va dentro de ellos: se registra en un archivo lateral public/data/cortes.json
  { "<archivo>.json": {"fecha_corte": "YYYY-MM-DD", "anios": [...], "fuente": ..., "generado": ...} }
La fecha sale del texto "Última actualización: 23 de noviembre de 2026" del navegador.
"""
import datetime
import json
import os
import re

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "cortes.json")
MESES = {m: i for i, m in enumerate(
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
     "septiembre", "octubre", "noviembre", "diciembre"], 1)}
MESES["setiembre"] = 9


def fecha_actualizacion(html):
    """'Última actualización: 23 de noviembre de 2026' → '2026-11-23' (o None)."""
    texto = re.sub(r"<[^>]+>", " ", html or "")  # la fecha va en <span id=...LblLastUpdate>
    m = re.search(r"ltima actualizaci\S*n:?\s*(\d{1,2}) de (\w+) de(?:l)? (\d{4})", texto, re.I)
    if not m or m.group(2).lower() not in MESES:
        return None
    return datetime.date(int(m.group(3)), MESES[m.group(2).lower()], int(m.group(1))).isoformat()


def registrar(archivo, html, anios, fuente):
    """Anota la fecha de corte de `archivo` si la página la trae. No falla nunca."""
    try:
        fecha = fecha_actualizacion(html)
        if not fecha:
            return
        d = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
        prev = d.get(archivo, {})
        anios_prev = prev.get("anios", []) if prev.get("fecha_corte") == fecha else []
        d[archivo] = {"fecha_corte": fecha,
                      "anios": sorted(set(anios_prev) | {int(a) for a in anios}),
                      "fuente": fuente,
                      "generado": datetime.date.today().isoformat()}
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, indent=1, sort_keys=True)
    except Exception:  # noqa: BLE001 — la fecha de corte es accesoria
        pass
