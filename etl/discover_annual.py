#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Descubre los archivos ANUALES de gasto del MEF y mapea año -> recurso. Escribe etl/resource_map.json.

Contrato vigente (verificado 2026-11-24):
  * La API SQL `api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql` fue RETIRADA
    (HTTP 404 «Recurso no encontrado» para toda consulta desde ~sep-2026). Tampoco existen las rutas
    CKAN estándar (/api/3/action/*). Solo queda `datastore_search` (paginado, inviable para agregar
    ~10 M filas/año) y `dump`.
  * El portal (Angular) lista los recursos del dataset vía
    POST https://datosabiertos.mef.gob.pe/Rest/PortalWebDatasetDetalle/v1.0/getDatasetDetalle
    {"dataset": "presupuesto-y-ejecucion-de-gasto"}
    → un recurso por año: `{AÑO}-Gasto.csv` (≤2024) o `{AÑO}-Gasto-Mensual.csv` (≥2025), cada uno
    con su `.zip` (~0.3–0.7 GB comprimido, ~10 GB descomprimido) en fs.datosabiertos.mef.gob.pe.
  * Los resource_id cambian cuando el MEF re-publica; por eso se re-descubren en cada corrida.

Si el endpoint del portal falla, cae a los nombres de archivo conocidos (HEAD a fs.datosabiertos).
Para cada año guarda: id, csv, zip, lastModified y tamaño del zip (para detectar cortes nuevos).
"""
import json, os, re, sys, time, datetime, urllib.request, email.utils

HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL = "https://datosabiertos.mef.gob.pe/Rest/PortalWebDatasetDetalle/v1.0/getDatasetDetalle"
DATASET = "presupuesto-y-ejecucion-de-gasto"
FS = "https://fs.datosabiertos.mef.gob.pe/datastorefiles/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (qhaway-etl)"


def req(url, data=None, method=None, timeout=60):
    h = {"User-Agent": UA}
    if data is not None:
        h["Content-Type"] = "application/json"
    return urllib.request.Request(url, data=data, headers=h, method=method)


def from_portal():
    body = json.dumps({"dataset": DATASET}).encode()
    for i in range(4):
        try:
            with urllib.request.urlopen(req(PORTAL, body, "POST"), timeout=60) as r:
                d = json.loads(r.read().decode("utf-8", "ignore"))
            out = {}
            for res in d.get("resources", []):
                title = res.get("resource_title", "")
                # 2024-Gasto.csv / 2026-Gasto-Mensual.csv ; se ignoran *-Diario y el diccionario
                m = re.fullmatch(r"(\d{4})-Gasto(-Mensual)?\.csv", title.strip(), re.I)
                if not m:
                    continue
                out[int(m.group(1))] = {"id": res.get("resource_id"), "csv": res.get("resource_url"),
                                        "zip": res.get("resource_download_url_zip") or ""}
            if out:
                return out
            raise ValueError("respuesta sin recursos anuales")
        except Exception as e:
            print(f"  portal intento {i}: {repr(e)[:90]}", flush=True)
            time.sleep(5)
    return {}


def head(url):
    """(lastModified ISO, tamaño) o (None, 0) si no existe."""
    if not url:
        return None, 0
    for i in range(3):
        try:
            with urllib.request.urlopen(req(url, method="HEAD"), timeout=40) as r:
                lm = r.headers.get("Last-Modified")
                size = int(r.headers.get("Content-Length") or 0)
            iso = email.utils.parsedate_to_datetime(lm).strftime("%Y-%m-%dT%H:%M:%SZ") if lm else None
            return iso, size
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, 0
            time.sleep(3)
        except Exception:
            time.sleep(3)
    return None, 0


def main():
    print("Buscando recursos anuales de gasto (portal MEF)…", flush=True)
    res = from_portal()
    if not res:
        print("  AVISO: el portal no respondió; uso nombres de archivo conocidos en fs.datosabiertos", flush=True)
        for y in range(2009, datetime.date.today().year + 1):
            for name in ((f"{y}-Gasto-Mensual", f"{y}-Gasto") if y >= 2025 else (f"{y}-Gasto",)):
                lm, size = head(FS + name + ".zip")
                if lm:
                    res[y] = {"id": None, "csv": FS + name + ".csv", "zip": FS + name + ".zip"}
                    break
    out = {}
    for y in sorted(res):
        r = res[y]
        lm, size = head(r["zip"])
        if not lm:  # sin zip: usar el CSV directo
            r["zip"] = ""
            lm, size = head(r["csv"])
        if not lm:
            print(f"  año {y}: archivo no accesible, se omite", flush=True)
            continue
        out[str(y)] = {**r, "lastModified": lm, "size": size}
        print(f"  año {y}: {r['id']} · {lm} · {size/1e9:.2f} GB {'zip' if r['zip'] else 'csv'}", flush=True)
    if not out:
        print("ERROR: no se encontró ningún archivo anual de gasto del MEF (¿WAF/IP bloqueada o portal caído?).",
              flush=True)
        sys.exit(1)
    with open(os.path.join(HERE, "resource_map.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("AÑOS:", sorted(int(y) for y in out), flush=True)


if __name__ == "__main__":
    main()
