# Presupuesto público ante El Niño y el cambio climático, 2021–2027

QHAWAY, FIEECS-UNI. Elaborado el 24-nov-2026. La ejecución tiene corte al **23-nov-2026**. Datos en `public/data/mitigacion-2021-2027.json`.

Contexto: el El Niño costero está en curso desde marzo de 2026. Según el ENFEN (comunicado N° 20-2026, del 13-nov), sería de magnitud extraordinaria hasta febrero de 2027.

## 1. Presupuesto 2027: qué está verificado

**Estado del trámite.** El Ejecutivo presentó el proyecto (PL 00002-2026-2031-CR, Oficio 242-2026-PR) el **28-ago-2026**. La Comisión Bicameral de Presupuesto aprobó el dictamen con texto sustitutorio el **5-nov-2026**, por 29 votos a favor, 1 en contra y 4 abstenciones. Según La República (21-nov-2026), el **Pleno lo aprobó** por 107 votos a favor, 46 en contra y 15 abstenciones, sin cambiar el monto total. Al 24-nov-2026 **no se halló la ley publicada en El Peruano** ni su número. Por eso, en el JSON, 2027 figura como `estado = "proyecto"`. El **PIA 2027 todavía no está en Consulta Amigable**, como es normal: se carga en enero.

| Concepto 2027 | Monto (S/) | Verificación | Fuente |
|---|---:|---|---|
| Presupuesto total | 266 506 316 735 | Documento oficial | Dictamen, p. 1; EM, p. 36 |
| PP 0068 Reducción de vulnerabilidad y atención de emergencias | 2 007,86 millones (PIA 2026: 2 187,28 millones; −8,2%) | Documento oficial | Dictamen, Tabla 26 |
| Reserva de Contingencia (fondo global, no solo para emergencias) | 9 601 millones (2026: 4 061 millones) | Documento oficial | EM, p. 37; dictamen |
| FONDES – INDECI (art. 63, Recursos Ordinarios) | 354 109 722 | Documento oficial | Dictamen, art. 63.1, p. 161 |
| ANA: descolmatación y protección de cauces (art. 62) | 18 400 000 (15,4 millones RDR + 3,0 millones RO) | Documento oficial | Dictamen, art. 62.1, p. 160 |
| Proyectos de inversión de la ANIN (incluye obras ajenas a El Niño) | 1 754 millones | Documento oficial | EM, p. 36 |
| Protección contra inundaciones del río Chicama, La Libertad (ANIN) | 266 millones | Documento oficial | EM, p. 36 y 118 |
| Protección de la quebrada Cansas/Chanchajalla, Ica (ANIN) | 235 millones | Documento oficial | EM, p. 36 y 117 |
| Drenaje pluvial de Sullana–Bellavista, Piura (ANIN) | 69 millones | Documento oficial | EM, p. 121 |
| Drenaje pluvial de Zarumilla y Aguas Verdes, Tumbes (MVCS) | 53 millones | Documento oficial | EM, p. 123 |
| Drenaje pluvial de 4 distritos de Chiclayo, Lambayeque (ANIN) | 30 millones | Documento oficial | EM, p. 118 |
| **Total para El Niño anunciado por el MEF** | **2 489 millones** | Prensa (declaración del ministro) | Infobae, 3-sep-2026 |
| …Gobierno nacional / gobiernos regionales / gobiernos locales | 2 023 / 246 / 219 millones | Prensa | Infobae; La República |
| …ANIN / INDECI / Vivienda / Transportes | 1 047 (de ellos, 928 en ríos y quebradas) / 413 / 273 / 91 millones | Prensa | La República, 4-sep-2026 |

Lectura:

- **El PP 0068 baja 8,2% en 2027**, en plena alerta por un El Niño extraordinario. El propio dictamen lo señala: la reducción "merece especial atención". El PIA del PP 0068 representa el 0,75% del total, la menor proporción del periodo 2021–2027.
- Los **S/ 2 489 millones** para El Niño son un agregado que el ministro Elmer Cuba presentó al Congreso. La exposición de motivos no lo desagrega, así que no se puede rastrear partida por partida. Solo el 19% (S/ 465 millones) llega a gobiernos regionales y locales.
- La **Reserva de Contingencia se duplica con creces** (+136%). Es la vía habitual para financiar emergencias durante el año, mediante decretos supremos. Al votar en el Pleno, sin embargo, la senadora Mirtha Vásquez criticó que se use para "obras con nombre propio".
- El presupuesto 2026 se dispara durante el año: el **PIM del PP 0068 en 2026 llega a S/ 5 140 millones**, 2,35 veces su PIA. Es de esperar lo mismo en 2027: el PIA subestima lo que realmente se gastará.
- El paquete de **S/ 18 mil millones** que el MEF anunció el 22-oct-2026 para 2027 (El Niño, petróleo y tasas; fuente: Nexos-ULima) **no forma parte** de la ley de presupuesto. Se tramitaría por separado y no entra en el JSON.

### Lo que no se pudo verificar (2027)

- **Intervenciones ante peligro inminente.** No tienen monto: el art. 58 del texto solo autoriza modificaciones presupuestarias.
- **Reconstrucción con Cambios.** No hay un monto global (solo menciones normativas a contratos del PIRCC).
- **Defensas ribereñas como agregado.** Solo hay proyectos sueltos.
- **Cambio climático (adaptación o mitigación).** La exposición de motivos no lo cuantifica. Solo da la función Ambiente (S/ 4 578 millones), que no equivale a gasto climático, por lo que no entra en la serie `clima`.
- **PP 0068 por departamento en 2027.**
- **Texto final de la ley.** No se revisó; se usaron el proyecto, la exposición de motivos y el dictamen. Si el Pleno modificó artículos, los montos de los arts. 62 y 63 podrían cambiar.

## 2. Serie 2021–2026 (Consulta Amigable y clasificador climático del MEF)

### PP 0068, nacional (millones de S/)

| Año | PIA | PIM | Devengado | Avance (%) | PIA / PIA total (%) | PIM / PIM total (%) | Estado |
|---|---:|---:|---:|---:|---:|---:|---|
| 2021 | 1 444 | 2 446 | 1 842 | 75,3 | 0,79 | 1,07 | Cierre |
| 2022 | 2 088 | 2 186 | 1 725 | 78,9 | 1,06 | 0,92 | Cierre |
| 2023 | 2 266 | 3 902 | 3 239 | 83,0 | 1,05 | 1,56 | Cierre (Yaku y FEN 2023) |
| 2024 | 2 664 | 3 286 | 2 884 | 87,8 | 1,11 | 1,25 | Cierre |
| 2025 | 2 172 | 2 998 | 2 569 | 85,7 | 0,86 | 1,10 | Cierre |
| 2026 | 2 187 | 5 140 | 2 650 | 51,6 | 0,85 | 1,71 | Corte al 23-nov |
| 2027 | 2 008 | — | — | — | 0,75 | — | Proyecto |

### Clasificador de cambio climático del MEF (millones de S/, Directa + Indirecta)

"Mitigación y Adaptación" es una categoría propia del clasificador y no se reparte entre las otras dos. Estos montos **no se suman al PP 0068**, porque ambos se solapan.

| Año | Mitigación (PIM / devengado) | Adaptación (PIM / devengado) | Mitigación y Adaptación (PIM / devengado) |
|---|---:|---:|---:|
| 2021 | 2 443 / 2 118 | 1 769 / 1 625 | 384 / 364 |
| 2022 | 2 640 / 2 380 | 1 378 / 1 255 | 444 / 419 |
| 2023 | 4 626 / 3 927 | 8 371 / 6 719 | 4 289 / 3 039 |
| 2024 | 3 452 / 3 200 | 2 132 / 2 000 | 589 / 566 |
| 2025 | 3 510 / 3 268 | 2 384 / 2 226 | 716 / 676 |
| 2026* | 3 659 / 2 929 | 3 358 / 2 045 | 762 / 588 |

\* Corte al 23-nov-2026. El pico de 2023 en adaptación se explica sobre todo por la función Agropecuaria "directa" (S/ 4 473 millones de PIM). Hay que revisarlo antes de interpretarlo como un cambio de política. El JSON trae además el desglose Directa/Indirecta y el PIA.

### PP 0068 en las regiones expuestas a El Niño (PIM / devengado, millones de S/)

Se mide por el destino geográfico de la meta (los 3 niveles de gobierno). La fuente no trae PIA por departamento. La serie completa 2021–2026 está en el JSON (`serie = "pp0068_region"`).

| Departamento | 2023 | 2025 | 2026 (al 23-nov) | Avance 2026 (%) |
|---|---:|---:|---:|---:|
| Tumbes | 174 / 152 | 115 / 99 | 176 / 96 | 54,9 |
| Piura | 401 / 328 | 89 / 65 | 271 / 119 | 43,9 |
| Lambayeque | 139 / 124 | 30 / 23 | 95 / 41 | 43,2 |
| La Libertad | 104 / 93 | 34 / 30 | 135 / 34 | 25,4 |
| Cajamarca | 66 / 56 | 49 / 45 | 77 / 48 | 63,1 |
| Áncash | 298 / 172 | 189 / 155 | 288 / 119 | 41,3 |
| Lima | 1 050 / 916 | 955 / 836 | 1 725 / 897 | 52,0 |
| Ica | 538 / 452 | 442 / 422 | 497 / 390 | 78,6 |

En 2026, el PIM de Piura, Lambayeque y La Libertad se multiplicó entre 3 y 4 veces respecto de 2025, pero a cinco semanas de cerrar el año ejecutan menos de la mitad. La Libertad está en 25%.

## 3. Fuentes

- Consulta Amigable MEF: https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx (corte al 23-nov-2026)
- Navegador de cambio climático MEF: https://apps5.mineco.gob.pe/cambioclimatico2023/Navegador/
- Exposición de motivos del PL de Presupuesto 2027 (MEF): https://www.mef.gob.pe/contenidos/presu_publ/sectr_publ/proy_2027/EM_PL_Presupuesto_SP_2027.pdf
- PL de Presupuesto 2027 (MEF; no se revisó directamente): https://www.mef.gob.pe/contenidos/presu_publ/sectr_publ/proy_2027/PL_Presupuesto_SP_2027.pdf
- Dictamen de la Comisión Bicameral, PL 00002-2026-2031-CR (copia en LP Derecho): https://img.lpderecho.pe/wp-content/uploads/2026/11/PL-00002-2026-2031-CR-LP-Derecho.pdf
- Congreso, aprobación del dictamen (5-nov-2026): https://comunicaciones.congreso.gob.pe/noticias/comision-bicameral-aprueba-dictamen-de-presupuesto-publico-2027-por-mas-de-s-266-mil-millones/
- La República, aprobación en el Pleno (21-nov-2026): https://larepublica.pe/politica/2026/11/21/congreso-aprueba-presupuesto-2027-de-s-266-506-millones-con-107-votos-a-favor-46-en-contra-y-15-abstenciones-hnews-822192
- Infobae, S/ 2 489 millones para El Niño (3-sep-2026): https://www.infobae.com/peru/2026/09/03/fenomeno-el-nino-marca-el-presupuesto-2027-gobierno-destina-s-2489-millones-para-enfrentar-sus-eventos-climaticos/
- La República, desglose por entidad (4-sep-2026): https://larepublica.pe/economia/2026/09/04/presupuesto-2027-cinco-megaobras-reciben-el-doble-que-la-infraestructura-para-enfrentar-el-nino-y-solo-19-ira-a-regiones-hnews-42688
- Nexos-ULima, paquete de S/ 18 mil millones (6-nov-2026): https://nexos.ulima.edu.pe/2026/11/06/millones-contra-la-crecida/
