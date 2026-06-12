import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { getPorFuncion, loadJSON, getGeoJSON } from '../lib/data'
import type { PorFuncion, RiesgosData } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { solesCompact, soles, num, pct, ejecucion } from '../lib/format'
import {
  Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro,
} from '../components/ui'
import { Chart, PALETA } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'

/* ───────────────────────── Tipos de datasets ───────────────────────── */

interface FilaFuncionMeta {
  ubigeo: string // 2 dígitos (departamento)
  departamento: string
  funcion: string
  nivel: string
  pim: number
  devengado: number
}
interface IndicadorDistrito {
  ubigeo: string // 6 dígitos
  pob: number
  idh: number
  pobreza: number
  pobrezaExt: number
  vulnAlim: number
  altitud: number
}

/* ───────────────────────── Proxy por función ───────────────────────── */

type Alcance = 'nucleo' | 'ampliado'

const NUCLEO: string[] = ['AMBIENTE']
const AMPLIADO: string[] = ['AMBIENTE', 'SANEAMIENTO', 'AGROPECUARIA', 'ENERGIA']

/** Funciones a considerar según el alcance elegido. */
function funcionesDe(alcance: Alcance): string[] {
  return alcance === 'nucleo' ? NUCLEO : AMPLIADO
}

/** Color de marca por función para el desglose. */
const COLOR_FUNCION: Record<string, string> = {
  AMBIENTE: '#16a34a',
  SANEAMIENTO: '#0ea5e9',
  AGROPECUARIA: '#f59e0b',
  ENERGIA: '#a855f7',
}
const ETIQUETA_FUNCION: Record<string, string> = {
  AMBIENTE: 'Ambiente',
  SANEAMIENTO: 'Saneamiento (agua)',
  AGROPECUARIA: 'Agropecuaria (riego/suelos)',
  ENERGIA: 'Energía',
}

/* ───────────────────────── Riesgo climático ───────────────────────── */

/** Peligros de riesgos.json que tienen origen climático (excluye sismo/tsunami/volcanes/minería/mercurio). */
const RIESGOS_CLIMA = [
  'nino', 'huaicos', 'inundaciones', 'sequia', 'heladas', 'friajes',
  'glaciares', 'deforestacion', 'deslizamientos', 'incendios',
] as const

type NivelRiesgo = 'alta' | 'media' | 'baja'
const PESO_RIESGO: Record<NivelRiesgo, number> = { alta: 3, media: 2, baja: 1 }

/** Índice de riesgo climático 0..1 promediando los pesos de los peligros climáticos presentes. */
function indiceClima(risks: Record<string, string>): number {
  let suma = 0
  let n = 0
  for (const k of RIESGOS_CLIMA) {
    const v = risks[k] as NivelRiesgo | undefined
    if (v) {
      suma += PESO_RIESGO[v]
      n += 1
    }
  }
  if (n === 0) return 0
  return suma / n / 3 // normalizado a 0..1
}

function nivelDesdeIndice(ix: number): NivelRiesgo {
  if (ix >= 0.66) return 'alta'
  if (ix >= 0.45) return 'media'
  return 'baja'
}
const COLOR_NIVEL: Record<NivelRiesgo, string> = { alta: '#ef4444', media: '#f59e0b', baja: '#22c55e' }
const LABEL_NIVEL: Record<NivelRiesgo, string> = { alta: 'Alto', media: 'Medio', baja: 'Bajo' }

/* ───────────────────────── Carga año-aware ───────────────────────── */

const FALLBACK_YEAR = 2025
const YEARS_SERIE = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
const YEARS_MAPA = [2026, 2025, 2023, 2022]

/** Carga por-funcion de varios años en paralelo; ignora los años sin datos. */
async function cargarSerie(years: number[]): Promise<{ year: number; rows: PorFuncion[] }[]> {
  const res = await Promise.all(
    years.map(async (y) => {
      try {
        const rows = await getPorFuncion(y)
        return { year: y, rows }
      } catch {
        return null
      }
    }),
  )
  return res.filter((r): r is { year: number; rows: PorFuncion[] } => r !== null)
}

/** Carga funcion-meta-{year}, con fallback a 2025 si el año no existe. */
async function cargarMeta(year: number): Promise<{ rows: FilaFuncionMeta[]; yearReal: number; fellBack: boolean }> {
  try {
    const rows = await loadJSON<FilaFuncionMeta[]>(`explorador-funcion-meta-${year}.json`)
    return { rows, yearReal: year, fellBack: false }
  } catch (e) {
    if (year === FALLBACK_YEAR) throw e
    const rows = await loadJSON<FilaFuncionMeta[]>(`explorador-funcion-meta-${FALLBACK_YEAR}.json`)
    return { rows, yearReal: FALLBACK_YEAR, fellBack: true }
  }
}

const ALCANCE_OPTS: { value: Alcance; label: string }[] = [
  { value: 'nucleo', label: 'Solo Ambiente (núcleo)' },
  { value: 'ampliado', label: 'Ampliado (Ambiente + agua + agro + energía)' },
]

/* ════════════════════════════════════════════════════════════════════ */

export default function Clima() {
  const [alcance, setAlcance] = useState<Alcance>('nucleo')
  const [yearMapa, setYearMapa] = useState<number>(2025)

  const funciones = useMemo(() => funcionesDe(alcance), [alcance])
  const funcionesSet = useMemo(() => new Set(funciones), [funciones])

  // Serie multi-año (nacional, por función) — robusta a años faltantes.
  const serie = useAsync(() => cargarSerie(YEARS_SERIE), [])
  // Inversión por destino (META) por región, para el mapa y el cruce de equidad.
  const meta = useAsync(() => cargarMeta(yearMapa), [yearMapa])
  // Riesgo climático + geometría + población (per-cápita).
  const ctx = useAsync<[RiesgosData, any, IndicadorDistrito[]]>(
    () => Promise.all([
      loadJSON<RiesgosData>('riesgos.json'),
      getGeoJSON(),
      loadJSON<IndicadorDistrito[]>('indicadores-distrito.json'),
    ]),
    [],
  )

  // ── Serie temporal filtrada al set de funciones elegido ──
  const serieClima = useMemo(() => {
    if (!serie.data) return []
    return serie.data
      .map(({ year, rows }) => {
        let pim = 0
        let dev = 0
        for (const r of rows) {
          if (funcionesSet.has(r.funcion)) {
            pim += r.pim
            dev += r.devengado
          }
        }
        return { year, pim, dev }
      })
      .filter((d) => d.pim > 0)
      .sort((a, b) => a.year - b.year)
  }, [serie.data, funcionesSet])

  // Último año disponible de la serie (para KPIs).
  const ultimo = serieClima.length ? serieClima[serieClima.length - 1] : undefined

  // Total nacional de ese mismo año (todas las funciones) para el % del presupuesto.
  const totalNacionalUltimo = useMemo(() => {
    if (!serie.data || !ultimo) return 0
    const fila = serie.data.find((d) => d.year === ultimo.year)
    if (!fila) return 0
    return fila.rows.reduce((s, r) => s + r.pim, 0)
  }, [serie.data, ultimo])

  // ── Desglose por función (año del mapa, datos META) ──
  const desglose = useMemo(() => {
    if (!meta.data) return []
    const acc = new Map<string, number>()
    for (const r of meta.data.rows) {
      if (funcionesSet.has(r.funcion)) {
        acc.set(r.funcion, (acc.get(r.funcion) ?? 0) + r.pim)
      }
    }
    return funciones
      .filter((f) => acc.has(f))
      .map((f) => ({ funcion: f, pim: acc.get(f) ?? 0 }))
      .sort((a, b) => b.pim - a.pim)
  }, [meta.data, funcionesSet, funciones])

  // ── PIM climático por departamento (ubigeo 2díg), datos META ──
  const pimPorDpto = useMemo(() => {
    const m = new Map<string, number>()
    if (!meta.data) return m
    for (const r of meta.data.rows) {
      if (funcionesSet.has(r.funcion)) {
        m.set(r.ubigeo, (m.get(r.ubigeo) ?? 0) + r.pim)
      }
    }
    return m
  }, [meta.data, funcionesSet])

  // ── Población por departamento (suma de distritos), para per-cápita ──
  const pobPorDpto = useMemo(() => {
    const m = new Map<string, number>()
    if (!ctx.data) return m
    const [, , ind] = ctx.data
    for (const d of ind) {
      const dpto = d.ubigeo.slice(0, 2)
      m.set(dpto, (m.get(dpto) ?? 0) + d.pob)
    }
    return m
  }, [ctx.data])

  // ── Valores del mapa: cada distrito hereda el PIM climático de su departamento ──
  const mapValues = useMemo(() => {
    const m = new Map<string, MapValue>()
    if (!ctx.data) return m
    const [, geo] = ctx.data
    if (!geo?.features) return m
    for (const f of geo.features) {
      const idDist = f?.properties?.IDDIST as string | undefined
      const idDpto = f?.properties?.IDDPTO as string | undefined
      const nombreDpto = f?.properties?.NOMBDEP as string | undefined
      if (!idDist || !idDpto) continue
      const v = pimPorDpto.get(idDpto) ?? 0
      m.set(idDist, {
        value: v,
        label: `${nombreDpto ?? ''} — PIM climático del departamento`,
      })
    }
    return m
  }, [ctx.data, pimPorDpto])

  const maxMapa = useMemo(() => {
    let mx = 0
    for (const v of pimPorDpto.values()) if (v > mx) mx = v
    return mx
  }, [pimPorDpto])

  // ── Cruce de equidad: riesgo climático vs inversión por región ──
  const equidad = useMemo(() => {
    if (!ctx.data) return []
    const [riesgos] = ctx.data
    return riesgos.regions
      .map((r) => {
        const ix = indiceClima(r.risks)
        const nivel = nivelDesdeIndice(ix)
        const pim = pimPorDpto.get(r.ubigeo) ?? 0
        const pob = pobPorDpto.get(r.ubigeo) ?? 0
        const perCapita = pob > 0 ? pim / pob : 0
        return { name: r.name, ubigeo: r.ubigeo, ix, nivel, pim, pob, perCapita }
      })
      .sort((a, b) => b.ix - a.ix || a.perCapita - b.perCapita)
  }, [ctx.data, pimPorDpto, pobPorDpto])

  // Regiones de alto riesgo con baja inversión per-cápita (mediana como umbral).
  const desatendidas = useMemo(() => {
    const altas = equidad.filter((e) => e.nivel === 'alta' && e.perCapita > 0)
    if (!altas.length) return new Set<string>()
    const ordenadas = [...equidad.filter((e) => e.perCapita > 0)].sort((a, b) => a.perCapita - b.perCapita)
    const mediana = ordenadas.length ? ordenadas[Math.floor(ordenadas.length / 2)].perCapita : 0
    return new Set(altas.filter((e) => e.perCapita < mediana).map((e) => e.ubigeo))
  }, [equidad])

  /* ───────────────────────── Estados de carga ───────────────────────── */

  const anyError = serie.error || meta.error || ctx.error
  if (serie.loading || meta.loading || ctx.loading) {
    return <Loading label="Cargando inversión climática (proxy por función)…" />
  }
  if (anyError && !serieClima.length && !meta.data && !ctx.data) {
    return <ErrorBox error={anyError} />
  }

  const etiquetaAlcance = alcance === 'nucleo'
    ? 'función Ambiente'
    : 'Ambiente + Saneamiento + Agropecuaria + Energía'

  /* ───────────────────────── Opciones de gráficos ───────────────────────── */

  // 3. Serie temporal (barras si ≤2 años, líneas si más).
  const usarLineas = serieClima.length >= 3
  const serieOption: EChartsOption = {
    grid: { left: 64, right: 24, top: 30, bottom: 28 },
    legend: { top: 0, data: ['PIM (asignado)', 'Devengado (gastado)'] },
    tooltip: {
      trigger: 'axis',
      formatter: (p: any) => {
        const arr = Array.isArray(p) ? p : [p]
        const head = `Año ${arr[0].axisValue}`
        const body = arr.map((s: any) => `${s.marker} ${s.seriesName}: ${soles(s.value)}`).join('<br>')
        return `<b>${head}</b><br>${body}`
      },
    },
    xAxis: { type: 'category', data: serieClima.map((d) => String(d.year)), boundaryGap: !usarLineas },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v) } },
    series: [
      {
        name: 'PIM (asignado)',
        type: usarLineas ? 'line' : 'bar',
        data: serieClima.map((d) => d.pim),
        smooth: usarLineas,
        ...(usarLineas
          ? { lineStyle: { width: 3, color: PALETA[0] }, itemStyle: { color: PALETA[0] }, areaStyle: { opacity: 0.12 } }
          : { itemStyle: { color: PALETA[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 38 }),
      },
      {
        name: 'Devengado (gastado)',
        type: usarLineas ? 'line' : 'bar',
        data: serieClima.map((d) => d.dev),
        smooth: usarLineas,
        ...(usarLineas
          ? { lineStyle: { width: 3, color: '#16a34a' }, itemStyle: { color: '#16a34a' } }
          : { itemStyle: { color: '#16a34a', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 38 }),
      },
    ],
  }

  // 4. Desglose por función (barras horizontales).
  const totalDesglose = desglose.reduce((s, d) => s + d.pim, 0)
  const desgloseOption: EChartsOption = {
    grid: { left: 130, right: 64, top: 8, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      formatter: (p: any) => {
        const s = Array.isArray(p) ? p[0] : p
        const part = totalDesglose ? s.value / totalDesglose : 0
        return `<b>${s.name}</b><br>PIM: ${soles(s.value)}<br>${pct(part)} del total`
      },
    },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v) } },
    yAxis: {
      type: 'category',
      data: desglose.map((d) => ETIQUETA_FUNCION[d.funcion] ?? d.funcion).reverse(),
      axisLabel: { fontSize: 11 },
    },
    series: [{
      type: 'bar',
      data: desglose.map((d) => ({ value: d.pim, itemStyle: { color: COLOR_FUNCION[d.funcion] ?? PALETA[0] } })).reverse(),
      barMaxWidth: 32,
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: {
        show: true, position: 'right', fontSize: 10,
        formatter: (p: any) => solesCompact(p.value),
        color: 'inherit',
      },
    }],
  }

  // 6. Cruce de equidad: scatter riesgo (x) vs per-cápita (y).
  const equidadConPC = equidad.filter((e) => e.perCapita > 0)
  const equidadOption: EChartsOption = {
    grid: { left: 64, right: 24, top: 16, bottom: 50 },
    tooltip: {
      formatter: (p: any) => {
        const e = p.data.meta
        return `<b>${e.name}</b><br>Riesgo climático: ${LABEL_NIVEL[e.nivel as NivelRiesgo]} (${(e.ix * 100).toFixed(0)}/100)`
          + `<br>Inversión per cápita: ${soles(e.perCapita)}`
          + `<br>PIM climático: ${soles(e.pim)}`
      },
    },
    xAxis: {
      type: 'value', name: 'Índice de riesgo climático', nameLocation: 'middle', nameGap: 30,
      min: 0, max: 1, axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}` },
    },
    yAxis: {
      type: 'value', name: 'S/ per cápita', nameGap: 12,
      axisLabel: { formatter: (v: number) => soles(v) },
    },
    series: [{
      type: 'scatter',
      symbolSize: (val: number[]) => Math.max(10, Math.min(34, Math.sqrt((val[2] ?? 0) / 1e6) * 4)),
      data: equidadConPC.map((e) => ({
        value: [e.ix, e.perCapita, e.pim],
        meta: e,
        itemStyle: {
          color: COLOR_NIVEL[e.nivel],
          borderColor: desatendidas.has(e.ubigeo) ? '#7c3aed' : 'transparent',
          borderWidth: desatendidas.has(e.ubigeo) ? 3 : 0,
          opacity: 0.85,
        },
      })),
      label: {
        show: true, position: 'top', fontSize: 9, formatter: (p: any) => p.data.meta.name,
        color: 'inherit',
      },
    }],
  }

  return (
    <div className="space-y-6">
      {/* 1. Intro + nota metodológica + toggle */}
      <SectionIntro title="Cambio Climático">
        <p>
          ¿Cuánto y dónde invierte el Perú en ambiente y clima, cuál es su ejecución y cómo evoluciona?
          Este módulo responde cuatro preguntas:
        </p>
        <ul className="mt-2 ml-4 list-disc space-y-1 text-sm">
          <li><b>¿Cuánto?</b> El monto asignado (PIM) y gastado (devengado) en {etiquetaAlcance}.</li>
          <li><b>¿Dónde?</b> La distribución territorial por región (según el destino META del gasto).</li>
          <li><b>¿Cómo se ejecuta?</b> El porcentaje de lo asignado que efectivamente se gasta.</li>
          <li><b>¿Cómo evoluciona?</b> La serie de los años disponibles del SIAF abierto.</li>
        </ul>
        <p className="mt-3">
          <b>Nota metodológica (importante):</b> el SIAF abierto <b>no</b> tiene una etiqueta exacta de
          «clima». Usamos como <b>aproximación las funciones de gasto</b>: la función{' '}
          <b>Ambiente</b> como núcleo y, en modo ampliado, <b>Saneamiento</b> (recursos hídricos),
          <b> Agropecuaria</b> (manejo de suelos/riego) y <b>Energía</b> como gasto relacionado con
          adaptación/mitigación. <b>No</b> es el etiquetado oficial por programa presupuestal con
          marcadores climáticos (eso es Fase 2). Léelo como una cota inferior orientativa.
        </p>
      </SectionIntro>

      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <Select
            label="Alcance del proxy climático"
            value={alcance}
            onChange={setAlcance}
            options={ALCANCE_OPTS}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone="warn">aprox. por función</Pill>
            <Pill tone="brand">{alcance === 'nucleo' ? 'Solo Ambiente' : 'Ampliado'}</Pill>
            <span className="text-ink-600 dark:text-ink-300">
              Proxy presupuestal, no marcadores climáticos oficiales.
            </span>
          </div>
        </div>
      </Card>

      {/* 2. KPIs del último año */}
      <Card>
        <CardHeader
          title={`Inversión climática — ${ultimo ? ultimo.year : 's/d'}`}
          subtitle={`Proxy por función: ${etiquetaAlcance}`}
          help={
            <HelpTip>
              KPIs del último año disponible. <b>Inversión climática</b> = PIM (presupuesto asignado
              vigente) de las funciones del proxy. <b>Ejecución</b> = devengado ÷ PIM (cuánto de lo
              asignado se gastó). <b>% del presupuesto nacional</b> = inversión climática ÷ PIM total
              de todas las funciones del mismo año. Todo en soles corrientes; es una aproximación por
              función, no el etiquetado oficial.
            </HelpTip>
          }
          right={<Pill tone="warn">soles corrientes</Pill>}
        />
        {!ultimo ? (
          <Pill tone="warn">Aún no hay años de la serie por-función cargados.</Pill>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KPI label="Inversión climática (PIM)" value={solesCompact(ultimo.pim)} sub={`Año ${ultimo.year}`} accent />
            <KPI label="Gastado (devengado)" value={solesCompact(ultimo.dev)} />
            <KPI
              label="% de ejecución"
              value={pct(ejecucion(ultimo.dev, ultimo.pim))}
              sub="devengado ÷ PIM"
            />
            {totalNacionalUltimo > 0 && (
              <KPI
                label="% del presupuesto nacional"
                value={pct(ultimo.pim / totalNacionalUltimo)}
                sub="del PIM total de todas las funciones"
              />
            )}
          </div>
        )}
      </Card>

      {/* 3. Serie temporal */}
      <Card>
        <CardHeader
          title="Evolución de la inversión climática"
          subtitle={
            serieClima.length
              ? `${num(serieClima.length)} año(s) disponibles: ${serieClima[0].year}–${serieClima[serieClima.length - 1].year}`
              : 'Sin años disponibles todavía'
          }
          help={
            <HelpTip>
              {usarLineas ? 'Líneas' : 'Barras'} con el PIM (asignado) y el devengado (gastado) por año.
              La serie crece conforme la migración del SIAF carga más años; sólo se muestran los años
              que respondieron. Montos en <b>soles corrientes</b> (no ajustados por inflación) y bajo el
              proxy por función — no compares ciegamente con el etiquetado climático oficial.
            </HelpTip>
          }
          right={<Pill tone="warn">soles corrientes</Pill>}
        />
        {!serieClima.length ? (
          <Pill tone="warn">No hay datos por-función cargados para ningún año del rango.</Pill>
        ) : (
          <Chart option={serieOption} height={300} />
        )}
      </Card>

      {/* 4. Desglose por función */}
      <Card>
        <CardHeader
          title={`Desglose por función — ${meta.data ? meta.data.yearReal : ''}`}
          subtitle={alcance === 'nucleo'
            ? 'Con «Solo Ambiente» hay una sola función; cambia a «Ampliado» para comparar.'
            : 'Reparto del PIM climático entre las funciones del proxy (destino META).'}
          help={
            <HelpTip>
              Barras con el PIM por función bajo el destino META (a dónde se dirige el gasto). En modo
              <b> Ampliado</b> permite ver cuánto pesa Ambiente frente a Saneamiento, Agropecuaria y
              Energía. <b>Ojo:</b> Saneamiento/Agro/Energía sólo son <i>parcialmente</i> climáticos
              (incluyen gasto no climático), por eso el modo ampliado sobreestima.
            </HelpTip>
          }
          right={meta.data?.fellBack ? <Pill tone="warn">datos {meta.data.yearReal}</Pill> : undefined}
        />
        {!desglose.length ? (
          <Pill tone="warn">Sin datos de función para el año seleccionado.</Pill>
        ) : (
          <>
            <Chart option={desgloseOption} height={Math.max(180, desglose.length * 46 + 60)} />
            <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
              Total proxy {meta.data?.yearReal}: <b>{soles(totalDesglose)}</b>
            </p>
          </>
        )}
      </Card>

      {/* 5. Mapa por región */}
      <Card>
        <CardHeader
          title="Inversión climática por región (destino META)"
          subtitle="Cada distrito se colorea con el PIM climático de su departamento"
          help={
            <HelpTip>
              Mapa coroplético: todos los distritos de un departamento comparten el color según el
              <b> PIM climático departamental</b> (destino META = a dónde se dirige el gasto, no la
              ejecutora). Tonos más intensos = más inversión. <b>No</b> interpretes variación dentro de
              un departamento: el dato es regional. Usa el selector para cambiar de año.
            </HelpTip>
          }
          right={
            <Select
              value={yearMapa}
              onChange={setYearMapa}
              options={YEARS_MAPA.map((y) => ({ value: y, label: String(y) }))}
              label="Año"
            />
          }
        />
        {!ctx.data || maxMapa === 0 ? (
          <Pill tone="warn">Sin datos territoriales para este año/alcance.</Pill>
        ) : (
          <MapaDistrital
            geojson={ctx.data[1]}
            values={mapValues}
            unitLabel="PIM climático"
            formatValue={(v) => solesCompact(v)}
            max={maxMapa}
            height={520}
          />
        )}
        {meta.data?.fellBack && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            El año pedido no estaba disponible; se muestran datos de {meta.data.yearReal}.
          </p>
        )}
      </Card>

      {/* 6. Cruce de equidad: riesgo vs inversión */}
      <Card>
        <CardHeader
          title="¿Las regiones de mayor riesgo reciben más inversión?"
          subtitle="Riesgo climático (de riesgos.json) frente a la inversión ambiental per cápita"
          help={
            <HelpTip>
              Eje horizontal = <b>índice de riesgo climático</b> de la región (promedio de los peligros
              de origen climático: El Niño, sequía, heladas, friajes, huaicos/inundaciones, glaciares,
              deforestación, incendios; 0–100). Eje vertical = <b>inversión climática per cápita</b>
              (PIM ÷ población). El tamaño del punto = PIM total. <b>Lectura de equidad:</b> idealmente
              las regiones a la derecha (más riesgo) deberían estar arriba (más inversión). Los puntos
              con <b style={{ color: '#7c3aed' }}>borde violeta</b> son regiones de <b>alto riesgo</b>
              {' '}con inversión per cápita por debajo de la mediana: <b>posibles brechas de equidad</b>.
            </HelpTip>
          }
          right={<Pill tone="warn">per cápita aprox.</Pill>}
        />
        {!equidadConPC.length ? (
          <Pill tone="warn">Faltan datos de riesgo, población o inversión para el cruce.</Pill>
        ) : (
          <>
            <Chart option={equidadOption} height={360} />
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-600 dark:text-ink-300">
              <Leyenda color={COLOR_NIVEL.alta} t="Riesgo alto" />
              <Leyenda color={COLOR_NIVEL.media} t="Riesgo medio" />
              <Leyenda color={COLOR_NIVEL.baja} t="Riesgo bajo" />
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-[3px]" style={{ borderColor: '#7c3aed' }} />
                Alto riesgo + baja inversión
              </span>
            </div>

            {/* Tabla de apoyo */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-500 dark:text-ink-400">
                    <th className="py-1 pr-3 font-medium">Región</th>
                    <th className="py-1 pr-3 font-medium">Riesgo climático</th>
                    <th className="py-1 pr-3 text-right font-medium">PIM climático</th>
                    <th className="py-1 pr-3 text-right font-medium">Per cápita</th>
                    <th className="py-1 text-left font-medium">Alerta</th>
                  </tr>
                </thead>
                <tbody>
                  {equidad.map((e) => (
                    <tr key={e.ubigeo} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-1.5 pr-3">{e.name}</td>
                      <td className="py-1.5 pr-3">
                        <Pill tone={e.nivel === 'alta' ? 'warn' : e.nivel === 'baja' ? 'good' : 'neutral'}>
                          {LABEL_NIVEL[e.nivel]} ({(e.ix * 100).toFixed(0)})
                        </Pill>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{solesCompact(e.pim)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{e.perCapita > 0 ? soles(e.perCapita) : '—'}</td>
                      <td className="py-1.5">
                        {desatendidas.has(e.ubigeo)
                          ? <span className="font-medium text-violet-600 dark:text-violet-400">Alto riesgo, baja inversión</span>
                          : <span className="text-ink-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* 7. Frase interpretativa honesta */}
      <Card>
        <p className="text-sm leading-relaxed text-ink-700 dark:text-ink-200">
          <b>Lectura honesta:</b> estas cifras son una <b>aproximación por función</b> del gasto
          ambiental/climático, no un conteo oficial con marcadores climáticos. Sirven para ver órdenes
          de magnitud, ejecución y distribución territorial, y para señalar <b>posibles brechas de
          equidad</b> (regiones de alto riesgo con baja inversión per cápita). No deben leerse como el
          «presupuesto climático del Perú» en sentido estricto: la trazabilidad real exige etiquetado
          por programa presupuestal y actividad, trabajo previsto para la Fase 2.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone="warn">proxy por función</Pill>
          <Pill tone="warn">soles corrientes</Pill>
          <Pill tone="neutral">riesgo a nivel departamental</Pill>
          <Pill tone="neutral">Fuente: SIAF-MEF · riesgos: CENEPRED/SENAMHI/MINAM</Pill>
        </div>
      </Card>
    </div>
  )
}

function Leyenda({ color, t }: { color: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      {t}
    </span>
  )
}
