#!/usr/bin/env python3
"""Genera public/data/mitigacion-2021-2027.json (PP 0068, clima mitigación/adaptación y presupuesto 2027 El Niño).
Lee los JSON de programas/clima ya refrescados. Las cifras 2027 están codificadas desde la exposición de motivos
y el dictamen (ver docs/PRESUPUESTO_2027_EL_NINO.md); actualizar al publicarse la Ley 2027 en El Peruano."""
import json, collections, os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data") + os.sep
L = lambda f: json.load(open(R + f))
prog, terr, clima, tot, cortes = L("por-programa-historico.json"), L("programa-territorio-clima.json"), L("clima-tematico.json"), L("serie-historica-oficial.json"), L("cortes.json")
ANIOS = range(2021, 2027)
CORTE = cortes["por-programa-historico.json"]["fecha_corte"]          # 2026-11-23
CORTE_CL = cortes["clima-tematico.json"]["fecha_corte"]
CORTE_TE = cortes["programa-territorio-clima.json"]["fecha_corte"]
U_CA = "https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx"
U_CL = "https://apps5.mineco.gob.pe/cambioclimatico2023/Navegador/"
U_EM = "https://www.mef.gob.pe/contenidos/presu_publ/sectr_publ/proy_2027/EM_PL_Presupuesto_SP_2027.pdf"
U_DIC = "https://img.lpderecho.pe/wp-content/uploads/2026/11/PL-00002-2026-2031-CR-LP-Derecho.pdf"
U_LR_PLENO = "https://larepublica.pe/politica/2026/11/21/congreso-aprueba-presupuesto-2027-de-s-266-506-millones-con-107-votos-a-favor-46-en-contra-y-15-abstenciones-hnews-822192"
U_INFOBAE = "https://www.infobae.com/peru/2026/09/03/fenomeno-el-nino-marca-el-presupuesto-2027-gobierno-destina-s-2489-millones-para-enfrentar-sus-eventos-climaticos/"
U_LR_FEN = "https://larepublica.pe/economia/2026/09/04/presupuesto-2027-cinco-megaobras-reciben-el-doble-que-la-infraestructura-para-enfrentar-el-nino-y-solo-19-ira-a-regiones-hnews-42688"

def fc(y, c): return c if y == 2026 else f"{y}-12-31"
def ct(y): return "parcial" if y == 2026 else "cierre_anual"
def pct(a, b): return round(100 * a / b, 2) if a is not None and b else None
COLS = ["serie","anio","ambito","ubigeo","categoria","atribucion","pia","pim","devengado","avance_pct","pct_pia_total","pct_pim_total","estado","corte_tipo","verificacion","fuente_url","fecha_corte","nota"]
filas = []
def row(**k):
    r = {c: k.get(c) for c in COLS}
    for m in ("pia","pim","devengado"):
        if r[m] is not None: r[m] = round(float(r[m]), 2)
    r["avance_pct"] = pct(r["devengado"], r["pim"])
    filas.append(r)

T = {r["year"]: r for r in tot}
for y in ANIOS:
    t = T[y]
    row(serie="total_sector_publico", anio=y, ambito="NACIONAL", ubigeo="00", categoria="Presupuesto total (3 niveles de gobierno)", atribucion=None,
        pia=t["pia"], pim=t["pim"], devengado=t["devengado"], pct_pia_total=100.0, pct_pim_total=100.0, estado="ejecucion", corte_tipo=ct(y),
        verificacion="consulta_amigable", fuente_url=U_CA, fecha_corte=fc(y, CORTE), nota="serie-historica-oficial.json")
for p in prog:
    if p["code"] == "0068" and p["year"] in ANIOS:
        y = p["year"]; t = T[y]
        row(serie="pp0068", anio=y, ambito="NACIONAL", ubigeo="00", categoria="PP 0068 Reducción de vulnerabilidad y atención de emergencias por desastres",
            pia=p["pia"], pim=p["pim"], devengado=p["devengado"], pct_pia_total=pct(p["pia"], t["pia"]), pct_pim_total=pct(p["pim"], t["pim"]),
            estado="ejecucion", corte_tipo=ct(y), verificacion="consulta_amigable", fuente_url=U_CA, fecha_corte=fc(y, CORTE), nota=None)
REG = [("24","TUMBES"),("20","PIURA"),("14","LAMBAYEQUE"),("13","LA LIBERTAD"),("06","CAJAMARCA"),("02","ANCASH"),("15","LIMA"),("11","ICA")]
idx = {(r["year"], r["departamento"]): r for r in terr if r["code"] == "0068"}
for y in ANIOS:
    for ub, dep in REG:
        r = idx.get((y, dep))
        assert r and r["ubigeo"] == ub, (y, dep)
        row(serie="pp0068_region", anio=y, ambito=dep, ubigeo=ub, categoria="PP 0068 Reducción de vulnerabilidad y atención de emergencias por desastres",
            pia=None, pim=r["pim"], devengado=r["devengado"], estado="ejecucion", corte_tipo=ct(y), verificacion="consulta_amigable", fuente_url=U_CA,
            fecha_corte=fc(y, CORTE_TE), nota="Destino geográfico de la meta (los 3 niveles de gobierno); la fuente no trae PIA por departamento. LIMA incluye Lima Metropolitana y Lima provincias; Callao va aparte.")
agg = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
for r in clima:
    if r["corte"] == "funcion" and r["year"] in ANIOS:
        for k in ((r["year"], r["medida"], r["atribucion"]), (r["year"], r["medida"], "Total")):
            a = agg[k]; a[0] += r["pia"] or 0; a[1] += r["pim"] or 0; a[2] += r["devengado"] or 0
ORD = {"Mitigación": 0, "Adaptación": 1, "Mitigación y Adaptación": 2}
for (y, m, at) in sorted(agg, key=lambda k: (k[0], ORD[k[1]], k[2])):
    pia, pim, dev = agg[(y, m, at)]; t = T[y]
    row(serie="clima", anio=y, ambito="NACIONAL", ubigeo="00", categoria=m, atribucion=at, pia=pia, pim=pim, devengado=dev,
        pct_pia_total=pct(pia, t["pia"]), pct_pim_total=pct(pim, t["pim"]), estado="ejecucion", corte_tipo=ct(y), verificacion="clasificador_clima_mef",
        fuente_url=U_CL, fecha_corte=fc(y, CORTE_CL),
        nota="Clasificador temático de cambio climático del MEF (suma del corte por función). 'Mitigación y Adaptación' es una categoría propia del clasificador: no se reparte ni se suma a las otras dos. No es comparable con el PP 0068 completo.")

TOT27 = 266506316735.0
def p27(cat, monto, ver, url, nota, ambito="NACIONAL", ub="00", serie="partida_2027", estado="proyecto"):
    row(serie=serie, anio=2027, ambito=ambito, ubigeo=ub, categoria=cat, pia=monto, pim=None, devengado=None,
        pct_pia_total=pct(monto, TOT27) if ambito == "NACIONAL" else None, estado=estado, corte_tipo="presupuesto",
        verificacion=ver, fuente_url=url, fecha_corte="2026-11-05" if url == U_DIC else ("2026-08-28" if url == U_EM else None), nota=nota)
row(serie="total_sector_publico", anio=2027, ambito="NACIONAL", ubigeo="00", categoria="Presupuesto total (3 niveles de gobierno)", pia=TOT27,
    pct_pia_total=100.0, estado="proyecto", corte_tipo="presupuesto", verificacion="documento_oficial", fuente_url=U_DIC, fecha_corte="2026-11-05",
    nota="Monto del proyecto (PL 00002-2026-2031-CR, presentado el 28-ago-2026) y del dictamen de la Comisión Bicameral (5-nov-2026). Según La República (21-nov-2026), el Pleno lo aprobó por el mismo monto (107-46-15). Al 24-nov-2026 no se halló la ley publicada en El Peruano, por eso el estado sigue siendo 'proyecto'.")
row(serie="pp0068", anio=2027, ambito="NACIONAL", ubigeo="00", categoria="PP 0068 Reducción de vulnerabilidad y atención de emergencias por desastres",
    pia=2007860000.0, pct_pia_total=pct(2007860000.0, TOT27), estado="proyecto", corte_tipo="presupuesto", verificacion="documento_oficial", fuente_url=U_DIC,
    fecha_corte="2026-11-05", nota="Dictamen, Tabla 26 (p. 79-82 del PDF): S/ 2 007,86 millones, frente a un PIA 2026 de S/ 2 187,28 millones (-S/ 179,42 millones; -8,2%). La cifra viene redondeada a decenas de miles de soles. El PIA oficial 2027 aparecerá en Consulta Amigable desde enero de 2027.")
p27("Reserva de Contingencia (global)", 9601000000.0, "documento_oficial", U_EM, "Exposición de motivos, p. 37. Es un fondo global para gastos imprevistos y no se destina solo a emergencias. Monto redondeado a millones. PIA 2026: S/ 4 061 millones (dictamen).")
p27("FONDES - INDECI (art. 63)", 354109722.0, "documento_oficial", U_DIC, "Artículo 63.1 del texto sustitutorio (p. 161), fuente Recursos Ordinarios: intervenciones de mitigación, respuesta, rehabilitación y reconstrucción priorizadas por la Comisión Multisectorial del FONDES.")
p27("ANA - descolmatación y protección de cauces (art. 62)", 18400000.0, "documento_oficial", U_DIC, "Artículo 62.1 (p. 160): S/ 15,4 millones RDR + S/ 3,0 millones RO para operar maquinaria (DU 015-2023) en limpieza, descolmatación y protección con roca de ríos y quebradas críticas.")
p27("El Niño - total anunciado por el MEF", 2489000000.0, "prensa", U_INFOBAE, "Cifra del ministro Elmer Cuba ante el Congreso (3-sep-2026). No aparece desagregada en la exposición de motivos. Agrupa partidas de varias entidades; no es una categoría presupuestal.", serie="el_nino_2027")
for cat, m, nota in [("El Niño - Gobierno nacional", 2023e6, "Infobae y La República, 3 y 4-sep-2026"), ("El Niño - Gobiernos regionales", 246e6, "Infobae y La República"), ("El Niño - Gobiernos locales", 219e6, "Infobae y La República"),
                     ("El Niño - ANIN", 1047e6, "La República, 4-sep-2026; de este monto, S/ 928 millones son inversiones de protección en ríos y quebradas"), ("El Niño - INDECI", 413e6, "La República, 4-sep-2026"),
                     ("El Niño - Vivienda, Construcción y Saneamiento", 273e6, "La República, 4-sep-2026"), ("El Niño - Transportes y Comunicaciones", 91e6, "La República, 4-sep-2026")]:
    p27(cat, m, "prensa", U_LR_FEN if "ANIN" in cat or "INDECI" in cat or "Vivienda" in cat or "Transportes" in cat else U_INFOBAE, nota, serie="el_nino_2027")
p27("ANIN - total de proyectos de inversión (no solo El Niño)", 1754e6, "documento_oficial", U_EM, "Exposición de motivos, p. 36. Incluye obras ajenas a El Niño, como el Instituto de Neoplásicas de Arequipa (S/ 300 millones).")
for cat, m, dep, ub, pg in [("Protección contra inundaciones río Chicama (ANIN, CUI 2501802)", 266e6, "LA LIBERTAD", "13", 118),
                            ("Protección ante avenidas quebrada Cansas/Chanchajalla (ANIN, CUI 2524692)", 235e6, "ICA", "11", 117),
                            ("Drenaje pluvial urbano de 4 distritos de Chiclayo (ANIN, CUI 2545188)", 30e6, "LAMBAYEQUE", "14", 118),
                            ("Drenaje pluvial integral Sullana-Bellavista (ANIN, CUI 2532678)", 69e6, "PIURA", "20", 121),
                            ("Drenaje pluvial Zarumilla y Aguas Verdes (MVCS, CUI 2567526)", 53e6, "TUMBES", "24", 123)]:
    p27(cat, m, "documento_oficial", U_EM, f"Exposición de motivos, anexo de proyectos, p. {pg}. Monto redondeado a millones.", ambito=dep, ub=ub, serie="proyecto_2027_region")

fuentes = [
 {"id":"consulta_amigable","titulo":"Consulta Amigable MEF (PIA/PIM/devengado por programa y por departamento)","url":U_CA,"fecha":CORTE,"tipo":"oficial"},
 {"id":"clasificador_clima","titulo":"Navegador de gasto en cambio climático MEF","url":U_CL,"fecha":CORTE_CL,"tipo":"oficial"},
 {"id":"em_pl_2027","titulo":"Exposición de motivos del Proyecto de Ley de Presupuesto del Sector Público para el AF 2027 (MEF)","url":U_EM,"fecha":"2026-08-28","tipo":"oficial"},
 {"id":"pl_2027","titulo":"Proyecto de Ley de Presupuesto AF 2027 (MEF; texto no revisado directamente)","url":"https://www.mef.gob.pe/contenidos/presu_publ/sectr_publ/proy_2027/PL_Presupuesto_SP_2027.pdf","fecha":"2026-08-28","tipo":"oficial"},
 {"id":"dictamen_2027","titulo":"Dictamen de la Comisión Bicameral de Presupuesto sobre el PL 00002-2026-2031-CR (copia en LP Derecho)","url":U_DIC,"fecha":"2026-11-05","tipo":"oficial (copia)"},
 {"id":"congreso_dictamen","titulo":"Nota del Congreso: la Comisión Bicameral aprueba el dictamen del Presupuesto 2027","url":"https://comunicaciones.congreso.gob.pe/noticias/comision-bicameral-aprueba-dictamen-de-presupuesto-publico-2027-por-mas-de-s-266-mil-millones/","fecha":"2026-11-05","tipo":"oficial"},
 {"id":"pleno_2027","titulo":"La República: el Congreso aprueba el Presupuesto 2027 de S/ 266 506 millones","url":U_LR_PLENO,"fecha":"2026-11-21","tipo":"prensa"},
 {"id":"fen_infobae","titulo":"Infobae: el Gobierno destina S/ 2 489 millones a El Niño en el Presupuesto 2027","url":U_INFOBAE,"fecha":"2026-09-03","tipo":"prensa"},
 {"id":"fen_larepublica","titulo":"La República: cinco megaobras reciben el doble que la infraestructura contra El Niño","url":U_LR_FEN,"fecha":"2026-09-04","tipo":"prensa"},
 {"id":"fen_nexos","titulo":"Nexos (U. de Lima): Millones contra la crecida (paquete de S/ 18 mil millones anunciado el 22-oct)","url":"https://nexos.ulima.edu.pe/2026/11/06/millones-contra-la-crecida/","fecha":"2026-11-06","tipo":"prensa"},
]
doc_cols = [
 ("serie","texto","Tipo de fila: total_sector_publico | pp0068 | pp0068_region | clima | partida_2027 | el_nino_2027 | proyecto_2027_region"),
 ("anio","entero","Año fiscal (2021-2027)"),
 ("ambito","texto","NACIONAL o nombre del departamento (como lo escribe la Consulta Amigable)"),
 ("ubigeo","texto","'00' para el ámbito nacional; código INEI de 2 dígitos para un departamento"),
 ("categoria","texto","Programa, medida climática (Mitigación | Adaptación | Mitigación y Adaptación) o partida"),
 ("atribucion","texto|null","Solo para serie=clima: Directa | Indirecta | Total (suma de Directa e Indirecta)"),
 ("pia","número|null","Presupuesto Institucional de Apertura, en soles. En 2027 es el monto del proyecto o dictamen"),
 ("pim","número|null","Presupuesto Institucional Modificado, en soles (no existe para 2027)"),
 ("devengado","número|null","Devengado en soles. En 2026 es parcial, al corte"),
 ("avance_pct","número|null","devengado / pim x 100"),
 ("pct_pia_total","número|null","pia / PIA total del sector público del mismo año x 100 (solo ámbito nacional)"),
 ("pct_pim_total","número|null","pim / PIM total del sector público del mismo año x 100 (solo ámbito nacional)"),
 ("estado","texto","ejecucion (dato de ejecución MEF) | proyecto (PL o dictamen 2027) | ley (ley publicada; aún no aplica)"),
 ("corte_tipo","texto","cierre_anual (2021-2025) | parcial (2026, al corte) | presupuesto (2027, sin ejecución)"),
 ("verificacion","texto","consulta_amigable | clasificador_clima_mef | documento_oficial | prensa (cifra declarada, no hallada en un documento oficial)"),
 ("fuente_url","texto","URL de la fuente de la fila"),
 ("fecha_corte","texto|null","YYYY-MM-DD: corte de la ejecución, o fecha del documento en 2027"),
 ("nota","texto|null","Aclaraciones metodológicas"),
]
out = {
 "_doc": {
   "descripcion": "Serie 2021-2027 del presupuesto público para gestión del riesgo ante El Niño y el cambio climático (QHAWAY, FIEECS-UNI). 'filas' es una tabla plana pensada para la tabla PostgreSQL mitigacion_serie: cada fila tiene las mismas columnas escalares. 'fuentes' es una tabla aparte. Todos los montos están en soles corrientes. No se deben sumar series distintas: el clasificador climático y el PP 0068 se solapan.",
   "generado": "2026-11-24",
   "fecha_corte_ejecucion": CORTE,
   "columnas": [{"columna": c, "tipo": t, "descripcion": d} for c, t, d in doc_cols],
   "no_verificado_2027": "No se hallaron montos 2027 para: intervenciones ante peligro inminente (el art. 58 solo autoriza modificaciones presupuestarias), Reconstrucción con Cambios (sin monto global), defensas ribereñas como agregado, cambio climático (adaptación o mitigación; la exposición de motivos no lo cuantifica) ni el PP 0068 por departamento. El PIA 2027 aún no está en Consulta Amigable (se publica desde enero de 2027). La ley no aparecía publicada en El Peruano al 24-nov-2026.",
   "fuentes_columnas": [{"columna": c, "descripcion": d} for c, d in [("id","Identificador corto"),("titulo","Descripción"),("url","URL"),("fecha","Fecha del documento o del corte"),("tipo","oficial | oficial (copia) | prensa")]]
 },
 "fecha_corte": CORTE,
 "filas": filas,
 "fuentes": fuentes,
}
json.dump(out, open(R + "mitigacion-2021-2027.json", "w"), ensure_ascii=False, indent=1)
print(len(filas))
