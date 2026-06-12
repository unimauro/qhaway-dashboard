#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Serie histórica NACIONAL oficial del Presupuesto del Sector Público, a partir de
los 'Informe Global de la Gestión Presupuestaria' del MEF (uno por año, gob.pe).
Extrae PIM total y gasto ejecutado (devengado). Escribe public/data/serie-historica-oficial.json
INCREMENTALMENTE (de a pocos hacia atrás). Cifras de cierre anual, alcance "Sector Público".
"""
import re, json, os, subprocess, urllib.request, time

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "public", "data", "serie-historica-oficial.json")
SLUGS = json.load(open("/tmp/year_slugs.json"))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# Cifras ya verificadas a mano (de informes ya descargados), para no re-bajar.
SEED = {
    2024: {"pim": 321038, "devengado": 291678},
    2023: {"pim": 302776, "devengado": 273448},
}


def fetch(url, dest, timeout=90):
    # gob.pe bloquea urllib; curl con UA sí pasa.
    subprocess.run(["curl", "-s", "--max-time", str(timeout), "-A", UA, "-L", url, "-o", dest], check=True)
    return os.path.getsize(dest)


def cdn_url(slug):
    fetch(f"https://www.gob.pe/institucion/mef/informes-publicaciones/{slug}", "/tmp/_pg.html")
    html = open("/tmp/_pg.html", encoding="utf-8", errors="ignore").read()
    m = re.search(r"cdn\.www\.gob\.pe/uploads/document/file/\d+/[^\"'?]+\.pdf", html)
    return ("https://" + m.group(0)) if m else None


def parse_millones(txt, label_re):
    m = re.search(label_re + r"[^0-9]{0,40}S/\s*([\d  .]+?)\s*millones", txt, re.IGNORECASE)
    if not m:
        return None
    n = re.sub(r"[ . ]", "", m.group(1))
    try:
        return int(n)
    except ValueError:
        return None


def load_out():
    if os.path.exists(OUT):
        return {r["year"]: r for r in json.load(open(OUT))}
    return {}


def save_out(d):
    arr = [d[y] for y in sorted(d)]
    json.dump(arr, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


out = load_out()
# Sembrar verificados
for y, v in SEED.items():
    out[y] = {"year": y, "pim": v["pim"] * 1_000_000, "devengado": v["devengado"] * 1_000_000}
save_out(out)
print("sembrados:", sorted(SEED), flush=True)

for y in sorted((int(k) for k in SLUGS), reverse=True):
    if y in out:
        continue
    slug = SLUGS[str(y)]
    try:
        url = cdn_url(slug)
        if not url:
            print(f"  {y}: sin URL CDN", flush=True); continue
        fetch(url, "/tmp/_inf.pdf", timeout=90)
        subprocess.run(["pdftotext", "-layout", "/tmp/_inf.pdf", "/tmp/_inf.txt"], check=True)
        txt = open("/tmp/_inf.txt", encoding="utf-8", errors="ignore").read()
        pim = parse_millones(txt, r"Presupuesto Institucional Modificado \(PIM\) ascendió a")
        dev = parse_millones(txt, r"ejecución de los gastos ascendió a")
        if pim and pim > 50000:  # sanity (>50 mil M)
            out[y] = {"year": y, "pim": pim * 1_000_000,
                      "devengado": (dev or 0) * 1_000_000}
            save_out(out)
            print(f"  {y}: PIM {pim/1000:.1f} mil M · Dev {(dev or 0)/1000:.1f} mil M -> ESCRITO ({len(out)} años)", flush=True)
        else:
            print(f"  {y}: no se pudo parsear (PIM={pim})", flush=True)
        time.sleep(1)
    except Exception as e:
        print(f"  {y}: ERROR {repr(e)[:60]}", flush=True)

print("SERIE OFICIAL:", [(r["year"], round(r["pim"]/1e9, 1)) for r in sorted(out.values(), key=lambda x: x["year"])], flush=True)
