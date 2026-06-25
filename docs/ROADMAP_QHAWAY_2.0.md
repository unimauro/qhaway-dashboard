# QHAWAY 2.0 — Roadmap para cerrar los requisitos de FIEECS (Kely)

> Documento de planificación. Recoge los requisitos funcionales enviados por Kely Alfaro
> (FIEECS-UNI) y lo conversado en la llamada (jun-2026), y mapea **qué está hecho, qué falta y
> con qué datos se cierra cada punto**. Última actualización: 25-jun-2026.

---

## 0. Decisión arquitectónica central (resuelve "el portal colapsaría")

El portal **no consulta nunca datos granulares en vivo**. La cadena es:

```
CSV crudo MEF (~10.5 GB/año)
   └─[build-time, fuera del portal]→ cubo granular (solo 2 años, para drill a proyecto)
        └─→ RESÚMENES pre-sumarizados (JSON ligeros / tablas pequeñas en Postgres)
             └─→ el PORTAL sirve solo resúmenes  ✅ rápido, no colapsa
```

- **El filtro del usuario lee resúmenes**, no millones de filas. Cada combinación de filtros
  relevante se pre-calcula en el ETL.
- **La data cruda/consolidada se archiva comprimida** (`.gz` en `/opt/qhaway-api/raw/` del VPS
  **+ el disco externo de Carlos**, 2 TB). No vive caliente. Si se necesita re-explorar, se
  descomprime puntualmente; **no se re-descarga del MEF**.
- **Postgres del VPS** mantiene solo: (a) los agregados ya conciliados 2012-2026, (b) los
  resúmenes nuevos, y (c) el cubo granular de **2 años** para el drill a proyecto/actividad.

## 1. Estrategia de datos (resuelve el volumen)

| Alcance | Años | Dónde vive | Para qué |
|---|---|---|---|
| Agregados actuales (nivel, función, sector, depto destino, distrito ejecutora, fuente) | 2012-2026 (15) | Postgres VPS | filtros rápidos, ya conciliados |
| **Cubo granular** (hasta proyecto/actividad, categoría, tipo gasto) | **2 años representativos** (p. ej. 2025 + 2024 o 2019) | Postgres VPS (acotado) | drill profundo de demostración |
| Resúmenes nuevos pre-sumarizados (categoría, tipo gasto, programa×territorio) | todos los disponibles | Postgres / JSON | nuevos filtros sin colapsar |
| Crudo MEF comprimido `.gz` | los que se bajen | VPS `/raw` + disco externo Carlos | respaldo, no se re-descarga |

> **Por qué 2 años y no 15:** descargar un año = ~10.5 GB a ~2.3 MB/s ≈ 80 min, y procesar +
> indexar es pesado en un VPS compartido de 8 GB. 2 años granulares bastan para demostrar la
> profundidad (drill a proyecto en un distrito); el análisis de tendencia 2012-2026 se hace con
> los agregados, que ya cuadran al céntimo.

---

## 2. Matriz de requisitos de Kely — estado y faltante

Leyenda: ✅ hecho · 🟢 hecho, falta exponer en UI · 🟡 parcial (falta sumarizar/UI) · 🔴 falta dato/desarrollo · ⛔ bloqueado (insumo externo)

### Módulo 1 — Presupuesto Público (exploración multidimensional, drill nacional → proyecto)
| Sub-ítem | Estado | Qué falta | Fuente |
|---|---|---|---|
| Filtro Año | ✅ | — | agregados |
| Nivel de Gobierno (Nac/Reg/Local) | ✅ | — | gasto_nivel |
| Departamento (destino META) | ✅ | — | gasto_meta_funcion |
| Provincia / Distrito | 🟢 | existe por **ejecutora** (gasto_distrito); exponer en el drill jerárquico + avisar limitación destino | gasto_distrito |
| Función | ✅ | — | gasto_funcion / meta |
| Sector | ✅ | — | gasto_sector |
| Fuente de Financiamiento | ✅ | — | gasto_meta_fuente |
| **Categoría Presupuestal** (PP / Acc. Centrales / APNOP) | 🟡 | sumarizar (derivable de `PROGRAMA_PPTO`) | cubo/resumen |
| **Tipo de Gasto** (corriente/capital/deuda) | 🔴 | sumarizar (`CATEGORIA_GASTO`) | cubo/resumen |
| Programa Presupuestal | 🟢 | existe nacional (91); falta cruce × territorio | scraper/resumen |
| **Proyecto / Actividad** | 🔴 | solo vía cubo granular (2 años) — drill, no filtro masivo | cubo granular |
| **Navegación jerárquica** nacional→…→proyecto en distrito | 🔴 | UI de drill encadenado | — |

### Módulo 2 — Cambio Climático (clasificación OFICIAL, no solo función Ambiente)
| Sub-ítem | Estado | Qué falta | Fuente |
|---|---|---|---|
| Adaptación / Mitigación / Ambas | ⛔ | **clasificador temático del MEF** (no viene en el CSV de gasto) | MEF temático / Excel Kely |
| Gasto Directo / Indirecto | ⛔ | idem | idem |
| Filtros año/nivel/depto/prov/distrito/función/categoría/fuente | 🟡 | dependen del cubo + del clasificador | cubo + temático |
| (Hoy) proxy por función AMBIENTE + programas climáticos curados | ✅ | reemplazar por etiquetado oficial cuando llegue | lib/programas.ts |

### Módulo 3 — Indicadores Territoriales (reemplazo del IPT "Prosperidad/Felicidad")
| Sub-ítem | Estado | Qué falta | Fuente |
|---|---|---|---|
| Retirar IPT (metodología poco clara) | 🟡 | decisión tomada; ejecutar el reemplazo | — |
| Densidad del Estado (PNUD) | 🔴 | conseguir el dato distrital | PNUD Perú |
| Desarrollo Humano (IDH) | ✅ | IDH 2019 PNUD ya cargado | indicadores-distrito |
| Acceso a servicios públicos | 🔴 | conseguir/consolidar (INEI/PNUD) | INEI |
| Capacidades territoriales | 🔴 | definir indicadores + datos | PNUD/INEI |
| Bienestar de la población | 🟡 | pobreza/vuln. ya están; mapear a "bienestar" | INEI |
| Metodología transparente y documentada | 🔴 | redactar nota metodológica PNUD | — |

### Módulo 4 — Cubo Analítico (dimensiones dinámicas)
| Sub-ítem | Estado | Qué falta | Fuente |
|---|---|---|---|
| Cubo OLAP en vivo (función\|fuente × nivel\|depto) | ✅ | — | /api/cubo-pivot |
| Cambiar dimensión sin reconstruir consulta | ✅ | patrón ya existe | — |
| Añadir dimensiones: región/provincia/distrito, categoría, tipo gasto, programa, proyecto | 🟡 | sobre **resúmenes pre-sumarizados** (no granular en vivo) | resúmenes |
| Medidas PIM/Devengado/Girado por año | 🟢 | ampliar a las nuevas dimensiones | — |

### Módulo 5 — Plataforma de inteligencia territorial (objetivo del rediseño)
| Sub-ítem | Estado | Qué falta |
|---|---|---|
| Integrar presupuesto + clima + riesgos + indicadores sociales + desarrollo | 🟡 | en curso; se cierra al completar 1-4 |
| Audiencias (investigadores, estudiantes, decisores, ciudadanía) | ✅ | export CSV/PNG, API pública, buzón ya listos |

---

## 3. Fases (orden sugerido)

- **Fase 0 — Cimiento de datos** *(en curso)*
  - [⏳] Piloto cubo granular **2025** (descarga 10.5 GB → cubo → mide filas/tamaño → archiva `.gz`).
  - [ ] Validar tamaño real; decidir el **2º año** granular.
  - [ ] Definir el **esquema de resúmenes** pre-sumarizados (qué combinaciones de filtros sirve el portal).
  - [ ] Archivar consolidado en disco externo de Carlos.
- **Fase 1 — Presupuesto multidimensional + drill** (cierra Módulo 1)
  - [ ] Resúmenes: categoría, tipo de gasto, programa×territorio.
  - [ ] UI de filtros jerárquicos nacional→…→proyecto (drill encadenado).
- **Fase 2 — Indicadores PNUD** (cierra Módulo 3)
  - [ ] Conseguir Densidad del Estado + acceso a servicios; retirar IPT; nota metodológica.
- **Fase 3 — Clima oficial** (cierra Módulo 2) ⛔ depende del clasificador temático del MEF
  - [ ] Cruce cubo × clasificador → adaptación/mitigación × directo/indirecto.
- **Fase 4 — Cubo ampliado + plataforma integrada** (cierra Módulos 4 y 5)
  - [ ] Pivote sobre resúmenes con todas las dimensiones.

---

## 4. Insumos que faltan (para no quedarnos bloqueados)

| Insumo | Para | Quién/origen |
|---|---|---|
| **Clasificador temático de cambio climático del MEF** (o el Excel de Kely) | Módulo 2 (bloqueado) | MEF / Kely |
| **Densidad del Estado (PNUD)** distrital | Módulo 3 | PNUD Perú (informes IDH) |
| Acceso a servicios / capacidades territoriales | Módulo 3 | INEI / PNUD |
| Decidir el **2º año granular** (¿2024? ¿2019 pre-pandemia?) | Fase 0 | Carlos/Kely |
| Disco externo para el consolidado | respaldo | Carlos (2 TB) |

---

## 5. Estado actual (25-jun-2026)
- Cubo granular **2025** descargándose en el VPS (detached, ~80 min). Validará el esquema y el
  tamaño real para dimensionar el resto.
- Todo lo demás del dashboard (11 módulos, buzón, API, export, seguridad) está **live en qhaway.org**.
- **Bloqueo principal**: el etiquetado oficial de clima (Módulo 2) espera el clasificador temático.
