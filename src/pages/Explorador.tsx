import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { getGeoJSON, getPorDistrito, loadJSON } from '../lib/data'
import type { PorDistrito } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { solesCompact, soles, pct, num, ejecucion } from '../lib/format'
import {
  Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro,
} from '../components/ui'
import { Chart } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'

/* ───────────────────────── Tipos de los datasets del explorador ───────────────────────── */

interface FilaFuncion {
  ubigeo: string
  departamento: string
  funcion: string
  nivel: string
  pim: number
  devengado: number
}
interface FilaFuente {
  ubigeo: string
  departamento: string
  fuente: string
  nivel: string
  pim: number
  devengado: number
}

/** Fila normalizada para que el resto del componente trate función/fuente de forma uniforme. */
interface FilaNorm {
  ubigeo: string
  departamento: string
  cat: string // función o fuente, según la dimensión
  nivel: string
  pim: number
  devengado: number
}

type Dimension = 'funcion' | 'fuente'
type Fase = 'pim' | 'devengado'
type Atribucion = 'meta' | 'ejecutora'
type NivelSel = 'Todos' | 'GOBIERNO NACIONAL' | 'GOBIERNOS REGIONALES' | 'GOBIERNOS LOCALES'

const TODOS = '__TODOS__'

const NIVEL_OPTS: { value: NivelSel; label: string }[] = [
  { value: 'Todos', label: 'Todos los niveles' },
  { value: 'GOBIERNO NACIONAL', label: 'Gobierno Nacional' },
  { value: 'GOBIERNOS REGIONALES', label: 'Gobiernos Regionales' },
  { value: 'GOBIERNOS LOCALES', label: 'Gobiernos Locales' },
]
const NIVEL_LABEL: Record<string, string> = {
  'GOBIERNO NACIONAL': 'Gobierno Nacional',
  'GOBIERNOS REGIONALES': 'Gobiernos Regionales',
  'GOBIERNOS LOCALES': 'Gobiernos Locales',
}

const DIM_OPTS: { value: Dimension; label: string }[] = [
  { value: 'funcion', label: 'Por función' },
  { value: 'fuente', label: 'Por fuente de financiamiento' },
]
const FASE_OPTS: { value: Fase; label: string }[] = [
  { value: 'pim', label: 'PIM (asignado vigente)' },
  { value: 'devengado', label: 'Devengado (gastado)' },
]
const FASE_LABEL: Record<Fase, string> = { pim: 'PIM', devengado: 'Devengado' }

const ATRIB_OPTS: { value: Atribucion; label: string }[] = [
  { value: 'meta', label: 'Por destino (META) — recomendado' },
  { value: 'ejecutora', label: 'Por ejecutora' },
]

/* ───────────────────────── Utilidades ───────────────────────── */

/** Normaliza tildes/mayúsculas para comparar nombres de preset con los datos. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
}

/** Color por % ejecución (fracción 0..1): <0.5 rojo, 0.5–0.8 ámbar, >0.8 verde */
function colorEjec(frac: number): string {
  if (frac < 0.5) return '#f87171'
  if (frac < 0.8) return '#fbbf24'
  return '#34d399'
}
function toneEjec(frac: number): 'good' | 'warn' | 'neutral' {
  if (frac >= 0.8) return 'good'
  if (frac >= 0.5) return 'warn'
  return 'neutral'
}

/* ───────────────────────── Presets / casos de uso ───────────────────────── */

interface Preset {
  label: string
  dimension: Dimension
  departamento: string // nombre tal cual aparece en datos, o TODOS
  nivel: NivelSel
  cat: string // función/fuente, o TODOS
}

const PRESETS: Preset[] = [
  { label: 'Educación en Cajamarca', dimension: 'funcion', departamento: 'CAJAMARCA', nivel: 'Todos', cat: 'EDUCACION' },
  { label: 'Ambiente (clima) en Puno', dimension: 'funcion', departamento: 'PUNO', nivel: 'Todos', cat: 'AMBIENTE' },
  { label: 'Salud en Loreto', dimension: 'funcion', departamento: 'LORETO', nivel: 'Todos', cat: 'SALUD' },
  { label: 'Transporte nacional', dimension: 'funcion', departamento: TODOS, nivel: 'GOBIERNO NACIONAL', cat: 'TRANSPORTE' },
  { label: 'Saneamiento en Gobiernos Locales', dimension: 'funcion', departamento: TODOS, nivel: 'GOBIERNOS LOCALES', cat: 'SANEAMIENTO' },
]

/* ───────────────────────── Página ───────────────────────── */

export default function Explorador() {
  const funcionDS = useAsync<FilaFuncion[]>(() => loadJSON<FilaFuncion[]>('explorador-funcion-depto-2025.json'), [])
  const funcionMetaDS = useAsync<FilaFuncion[]>(() => loadJSON<FilaFuncion[]>('explorador-funcion-meta-2025.json'), [])
  const fuenteDS = useAsync<FilaFuente[]>(() => loadJSON<FilaFuente[]>('explorador-fuente-depto-2025.json'), [])
  const geo = useAsync<unknown>(getGeoJSON, [])
  const distrito = useAsync<PorDistrito[]>(() => getPorDistrito(2025), [])

  return (
    <div className="space-y-5">
      <SectionIntro title="Explorador Presupuestal Multidimensional">
        Cruza en un mismo lugar <strong>presupuesto × territorio × función/fuente × nivel de gobierno</strong>:
        un cruce que el portal del MEF (Consulta Amigable) no integra en una sola vista interactiva.
        Esta es la <strong>Fase 1</strong>: cruces pre-computados del año <strong>2025</strong> sobre datos
        del SIAF-MEF. El cubo OLAP completo —cruces arbitrarios de Presupuesto × Clima × Riesgos × Pobreza ×
        Piso altitudinal, con serie histórica— llega en la <strong>Fase 2</strong>, con backend. Sin sobre-promesas:
        aquí solo verás lo que los datos publicados permiten afirmar.
      </SectionIntro>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="brand">Año 2025</Pill>
        <Pill tone="warn">serie histórica y cubo completo: Fase 2</Pill>
        <span className="text-[11px] text-ink-400">Fuente: SIAF-MEF (Consulta Amigable). Cifras en soles corrientes.</span>
      </div>

      <ExploradorBody funcionDS={funcionDS} funcionMetaDS={funcionMetaDS} fuenteDS={fuenteDS} geo={geo} distrito={distrito} />
    </div>
  )
}

function ExploradorBody({
  funcionDS, funcionMetaDS, fuenteDS, geo, distrito,
}: {
  funcionDS: ReturnType<typeof useAsync<FilaFuncion[]>>
  funcionMetaDS: ReturnType<typeof useAsync<FilaFuncion[]>>
  fuenteDS: ReturnType<typeof useAsync<FilaFuente[]>>
  geo: ReturnType<typeof useAsync<unknown>>
  distrito: ReturnType<typeof useAsync<PorDistrito[]>>
}) {
  const [dimension, setDimension] = useState<Dimension>('funcion')
  const [departamento, setDepartamento] = useState<string>(TODOS)
  const [nivel, setNivel] = useState<NivelSel>('Todos')
  const [cat, setCat] = useState<string>(TODOS)
  const [fase, setFase] = useState<Fase>('pim')
  const [atribucion, setAtribucion] = useState<Atribucion>('meta')
  const [orderDesc, setOrderDesc] = useState<boolean>(true)

  // La atribución efectiva: "Por fuente" solo existe por ejecutora.
  const atribEfectiva: Atribucion = dimension === 'fuente' ? 'ejecutora' : atribucion

  // Dataset activo según la dimensión y la atribución territorial, normalizado a FilaNorm.
  const filas: FilaNorm[] | undefined = useMemo(() => {
    if (dimension === 'funcion') {
      // Por destino (META) vs por ejecutora. Si el de META falta, cae a ejecutora.
      const src = atribEfectiva === 'meta' ? (funcionMetaDS.data ?? funcionDS.data) : funcionDS.data
      if (!src) return undefined
      return src.map((r) => ({
        ubigeo: r.ubigeo, departamento: r.departamento, cat: r.funcion,
        nivel: r.nivel, pim: r.pim || 0, devengado: r.devengado || 0,
      }))
    }
    if (!fuenteDS.data) return undefined
    return fuenteDS.data.map((r) => ({
      ubigeo: r.ubigeo, departamento: r.departamento, cat: r.fuente,
      nivel: r.nivel, pim: r.pim || 0, devengado: r.devengado || 0,
    }))
  }, [dimension, atribEfectiva, funcionDS.data, funcionMetaDS.data, fuenteDS.data])

  // ¿El usuario pidió META pero está mirando "Por fuente" (forzado a ejecutora)?
  const metaNoDisponible = dimension === 'fuente' && atribucion === 'meta'
  // ¿Pidió META en función pero el dataset META no cargó (fallback a ejecutora)?
  const metaFallback = dimension === 'funcion' && atribucion === 'meta' && !funcionMetaDS.data && !!funcionDS.data

  // Catálogos para los selects (salen de los datos).
  const deptosOpts = useMemo(() => {
    const set = new Set<string>()
    for (const r of filas ?? []) set.add(r.departamento)
    const arr = [...set].sort((a, b) => a.localeCompare(b))
    return [{ value: TODOS, label: 'Todos los departamentos' }, ...arr.map((d) => ({ value: d, label: d }))]
  }, [filas])

  const catOpts = useMemo(() => {
    const set = new Set<string>()
    for (const r of filas ?? []) set.add(r.cat)
    const arr = [...set].sort((a, b) => a.localeCompare(b))
    const etiqueta = dimension === 'funcion' ? 'Todas las funciones' : 'Todas las fuentes'
    return [{ value: TODOS, label: etiqueta }, ...arr.map((c) => ({ value: c, label: c }))]
  }, [filas, dimension])

  // Aplica un preset: ajusta todos los selects, validando contra los datos disponibles.
  function aplicarPreset(p: Preset) {
    setDimension(p.dimension)
    // Re-derivar el dataset del preset para validar nombres.
    const ds: FilaNorm[] = p.dimension === 'funcion'
      ? (funcionDS.data ?? []).map((r) => ({ ubigeo: r.ubigeo, departamento: r.departamento, cat: r.funcion, nivel: r.nivel, pim: r.pim || 0, devengado: r.devengado || 0 }))
      : (fuenteDS.data ?? []).map((r) => ({ ubigeo: r.ubigeo, departamento: r.departamento, cat: r.fuente, nivel: r.nivel, pim: r.pim || 0, devengado: r.devengado || 0 }))

    const dep = p.departamento === TODOS
      ? TODOS
      : (ds.find((r) => norm(r.departamento) === norm(p.departamento))?.departamento ?? TODOS)
    const c = p.cat === TODOS
      ? TODOS
      : (ds.find((r) => norm(r.cat) === norm(p.cat))?.cat ?? TODOS)

    setDepartamento(dep)
    setCat(c)
    setNivel(p.nivel)
    setFase('pim')
  }

  // ¿Está cargando lo esencial? (los dos datasets de dimensión)
  const cargando = funcionDS.loading || fuenteDS.loading
  const errorPrincipal = (dimension === 'funcion' ? funcionDS.error : fuenteDS.error)

  // Filas que cumplen el filtro completo (dep + cat + nivel) — base de KPIs y tabla.
  const filasFiltradas = useMemo(() => {
    if (!filas) return []
    return filas.filter((r) =>
      (departamento === TODOS || r.departamento === departamento) &&
      (cat === TODOS || r.cat === cat) &&
      (nivel === 'Todos' || r.nivel === nivel),
    )
  }, [filas, departamento, cat, nivel])

  const totales = useMemo(() => {
    let pim = 0, dev = 0
    for (const r of filasFiltradas) { pim += r.pim; dev += r.devengado }
    return { pim, dev, frac: ejecucion(dev, pim), n: filasFiltradas.length }
  }, [filasFiltradas])

  if (cargando) return <Loading label="Cargando cruces presupuestales 2025…" />
  if (errorPrincipal && !filas) return <ErrorBox error={errorPrincipal} />
  if (!filas) return <Loading />

  return (
    <div className="space-y-5">
      {/* ── Panel de filtros sticky ── */}
      <div className="sticky top-0 z-30 -mx-2 px-2 py-2 backdrop-blur bg-white/80 dark:bg-ink-950/80 border-b border-ink-200 dark:border-ink-800 rounded-b-xl">
        <div className="flex flex-wrap items-end gap-3">
          <Select<Dimension>
            value={dimension}
            onChange={(d) => { setDimension(d); setCat(TODOS) }}
            options={DIM_OPTS}
            label="Dimensión a explorar"
          />
          <Select<string> value={departamento} onChange={setDepartamento} options={deptosOpts} label="Departamento" />
          <Select<NivelSel> value={nivel} onChange={setNivel} options={NIVEL_OPTS} label="Nivel de gobierno" />
          <Select<string>
            value={cat}
            onChange={setCat}
            options={catOpts}
            label={dimension === 'funcion' ? 'Función' : 'Fuente de financiamiento'}
          />
          <Select<Fase> value={fase} onChange={setFase} options={FASE_OPTS} label="Fase a mostrar" />
          <div className="flex items-end gap-1.5">
            <Select<Atribucion> value={atribucion} onChange={setAtribucion} options={ATRIB_OPTS} label="Atribución territorial" />
            <div className="pb-1.5">
              <HelpTip>
                <strong>Por destino (META)</strong>: a qué territorio llega el proyecto —es la lectura
                territorial correcta (recomendada). <strong>Por ejecutora</strong>: dónde está la entidad
                que administra el gasto; con esta lectura el <strong>Gobierno Nacional se concentra en
                Lima</strong> (sede de ministerios y programas), aunque las obras estén en todo el país.
                La dimensión «Por fuente» solo tiene datos por ejecutora.
              </HelpTip>
            </div>
          </div>
        </div>

        {/* Avisos de atribución */}
        {(metaNoDisponible || metaFallback) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {metaNoDisponible && (
              <Pill tone="warn">
                «Por fuente» solo existe por ejecutora — esta vista es por ejecutora (Gob. Nacional concentrado en Lima)
              </Pill>
            )}
            {metaFallback && (
              <Pill tone="warn">no se pudo cargar el dato por destino (META); mostrando por ejecutora</Pill>
            )}
          </div>
        )}

        {/* Casos de uso (presets) */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-ink-400">Casos de uso:</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => aplicarPreset(p)}
              className="text-xs rounded-full border border-ink-200 dark:border-ink-700 px-2.5 py-1 text-ink-700 dark:text-ink-200 hover:bg-brand-500 hover:text-white hover:border-brand-500 transition"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPIs ── */}
      <Kpis totales={totales} dimension={dimension} />

      {/* ── Ranking + Desglose por nivel ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RankingCard
          filas={filas}
          dimension={dimension}
          departamento={departamento}
          nivel={nivel}
          cat={cat}
          fase={fase}
        />
        <DesgloseNivelCard filasFiltradas={filasFiltradas} fase={fase} />
      </div>

      {/* ── Mapa por departamento ── */}
      <MapaCard
        geo={geo}
        filas={filas}
        dimension={dimension}
        departamento={departamento}
        nivel={nivel}
        cat={cat}
        fase={fase}
        atribucion={atribEfectiva}
      />

      {/* ── Tabla detalle ── */}
      <TablaDetalle
        filasFiltradas={filasFiltradas}
        dimension={dimension}
        fase={fase}
        orderDesc={orderDesc}
        onToggleOrder={() => setOrderDesc((v) => !v)}
      />

      {/* ── Cobertura de información ── */}
      <CoberturaCard geo={geo} distrito={distrito} />
    </div>
  )
}

/* ───────────────────────── KPIs ───────────────────────── */

function Kpis({ totales, dimension }: { totales: { pim: number; dev: number; frac: number; n: number }; dimension: Dimension }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Resumen del filtro actual</h3>
        <HelpTip>
          <strong>PIM</strong>: presupuesto modificado (vigente). <strong>Devengado</strong>: gasto
          reconocido. <strong>% ejecución</strong> = devengado / PIM (rojo &lt;50%, ámbar 50–80%, verde
          &gt;80%). <strong>Combinaciones</strong>: nº de celdas {dimension === 'funcion' ? 'función' : 'fuente'}×depto×nivel
          que cumplen el filtro (a más celdas, más agregado es el total).
        </HelpTip>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="PIM total" value={solesCompact(totales.pim)} sub="Asignado vigente" accent />
        <KPI label="Devengado total" value={solesCompact(totales.dev)} sub="Gasto reconocido" />
        <Card className="px-4 py-3">
          <p className="text-xs text-ink-400">% Ejecución</p>
          <p className="text-2xl font-bold tracking-tight" style={{ color: colorEjec(totales.frac) }}>{pct(totales.frac)}</p>
          <p className="text-xs mt-0.5">
            <Pill tone={toneEjec(totales.frac)}>{totales.frac >= 0.8 ? 'alta' : totales.frac >= 0.5 ? 'media' : 'baja'}</Pill>
          </p>
        </Card>
        <KPI label="Combinaciones" value={num(totales.n)} sub="celdas del cruce" />
      </div>
    </div>
  )
}

/* ───────────────────────── Ranking ───────────────────────── */

/**
 * Ranking de la dimensión NO fijada:
 * - Si hay una categoría concreta elegida (cat !== TODOS) → ranking de DEPARTAMENTOS.
 * - Si no → ranking de categorías (funciones/fuentes) dentro del depto/nivel filtrados.
 */
function RankingCard({
  filas, dimension, departamento, nivel, cat, fase,
}: {
  filas: FilaNorm[]
  dimension: Dimension
  departamento: string
  nivel: NivelSel
  cat: string
  fase: Fase
}) {
  const porDepartamentos = cat !== TODOS
  const titulo = porDepartamentos
    ? `Ranking de departamentos — ${cat}`
    : dimension === 'funcion'
      ? `Ranking de funciones${departamento !== TODOS ? ` en ${departamento}` : ''}`
      : `Ranking de fuentes${departamento !== TODOS ? ` en ${departamento}` : ''}`

  // Agregación
  const agg = useMemo(() => {
    const base = filas.filter((r) =>
      (nivel === 'Todos' || r.nivel === nivel) &&
      (porDepartamentos
        ? r.cat === cat // ranking de deptos para esa categoría
        : (departamento === TODOS || r.departamento === departamento)), // ranking de categorías
    )
    const m = new Map<string, { pim: number; dev: number }>()
    for (const r of base) {
      const k = porDepartamentos ? r.departamento : r.cat
      const cur = m.get(k) ?? { pim: 0, dev: 0 }
      cur.pim += r.pim
      cur.dev += r.devengado
      m.set(k, cur)
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, pim: v.pim, dev: v.dev, frac: ejecucion(v.dev, v.pim) }))
      .filter((d) => d[fase === 'pim' ? 'pim' : 'dev'] > 0)
      .sort((a, b) => b[fase === 'pim' ? 'pim' : 'dev'] - a[fase === 'pim' ? 'pim' : 'dev'])
      .slice(0, 15)
  }, [filas, dimension, departamento, nivel, cat, fase, porDepartamentos])

  const subtitle = porDepartamentos
    ? `Top 15 por ${FASE_LABEL[fase]} · resalta dónde está cada departamento`
    : `Top 15 por ${FASE_LABEL[fase]} · color = % ejecución`

  return (
    <Card>
      <CardHeader
        title={titulo}
        subtitle={subtitle}
        help={
          <HelpTip>
            Barras horizontales del {FASE_LABEL[fase]} {porDepartamentos ? 'por departamento, para la categoría elegida' : 'por categoría, dentro del filtro de departamento y nivel'}.
            El <strong>color</strong> indica la ejecución (rojo &lt;50%, ámbar 50–80%, verde &gt;80%).
            {porDepartamentos
              ? ' Así comparas cuánto recibe cada departamento (p. ej. Cajamarca frente al resto).'
              : ' Así ves en qué se concentra el presupuesto del territorio elegido.'}
            {' '}Recuerda: <strong>PIM ≠ gasto</strong>; lo gastado es el devengado (en el tooltip).
          </HelpTip>
        }
        right={cat !== TODOS && departamento !== TODOS ? <Pill tone="brand">resaltando {departamento}</Pill> : undefined}
      />
      <div className="px-4 pb-4">
        {agg.length === 0
          ? <p className="text-sm text-ink-400 py-8 text-center">No hay datos para esta combinación de filtros.</p>
          : <RankingChart data={agg} fase={fase} resaltar={porDepartamentos && departamento !== TODOS ? departamento : undefined} />}
      </div>
    </Card>
  )
}

function RankingChart({
  data, fase, resaltar,
}: {
  data: { name: string; pim: number; dev: number; frac: number }[]
  fase: Fase
  resaltar?: string
}) {
  const top = [...data].reverse() // mayor arriba en barra horizontal
  const cats = top.map((d) => d.name)
  const vals = top.map((d) => {
    const v = fase === 'pim' ? d.pim : d.dev
    const esResaltado = resaltar && d.name === resaltar
    return {
      value: v,
      pim: d.pim,
      dev: d.dev,
      ejec: d.frac,
      itemStyle: {
        color: colorEjec(d.frac),
        borderRadius: [0, 4, 4, 0] as [number, number, number, number],
        borderColor: esResaltado ? '#0ea5e9' : 'transparent',
        borderWidth: esResaltado ? 2 : 0,
      },
    }
  })

  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        const d = p.data
        return `<b>${p.name}</b><br>PIM: <b>${solesCompact(d.pim)}</b><br>Devengado: <b>${solesCompact(d.dev)}</b><br>Ejecución: <b>${pct(d.ejec)}</b>`
      },
    },
    grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
    yAxis: { type: 'category', data: cats, axisLabel: { fontSize: 10, width: 130, overflow: 'truncate' } },
    series: [
      {
        type: 'bar',
        data: vals,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => solesCompact(p.value) },
      },
    ],
  }
  return <Chart option={option} height={Math.max(280, top.length * 26)} />
}

/* ───────────────────────── Desglose por nivel ───────────────────────── */

function DesgloseNivelCard({ filasFiltradas, fase }: { filasFiltradas: FilaNorm[]; fase: Fase }) {
  const data = useMemo(() => {
    const m = new Map<string, { pim: number; dev: number }>()
    for (const r of filasFiltradas) {
      const cur = m.get(r.nivel) ?? { pim: 0, dev: 0 }
      cur.pim += r.pim
      cur.dev += r.devengado
      m.set(r.nivel, cur)
    }
    const orden = ['GOBIERNO NACIONAL', 'GOBIERNOS REGIONALES', 'GOBIERNOS LOCALES']
    return orden
      .filter((n) => m.has(n))
      .map((n) => {
        const v = m.get(n)!
        return { nivel: NIVEL_LABEL[n] ?? n, valor: fase === 'pim' ? v.pim : v.dev, pim: v.pim, dev: v.dev }
      })
      .filter((d) => d.valor > 0)
  }, [filasFiltradas, fase])

  return (
    <Card>
      <CardHeader
        title="Desglose por nivel de gobierno"
        subtitle={`Cuánto del filtro va por cada nivel · ${FASE_LABEL[fase]}`}
        help={
          <HelpTip>
            Reparto del {FASE_LABEL[fase]} del filtro actual entre Gobierno Nacional, Regional y Local.
            <strong> Ojo</strong>: el nivel nacional suele concentrarse en Lima por la sede de los pliegos
            (ministerios, programas nacionales), de modo que un monto «nacional» alto no significa que el
            gasto ocurra fuera de la capital. Lee el nivel <strong>Local</strong> para una señal territorial
            más fiel.
          </HelpTip>
        }
      />
      <div className="px-4 pb-4">
        {data.length === 0
          ? <p className="text-sm text-ink-400 py-8 text-center">Sin datos para el filtro.</p>
          : <DesgloseChart data={data} />}
      </div>
    </Card>
  )
}

function DesgloseChart({ data }: { data: { nivel: string; valor: number; pim: number; dev: number }[] }) {
  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        const d = p.data
        return `<b>${d.nivel}</b><br>${solesCompact(d.value)} (${p.percent}%)<br>PIM: ${solesCompact(d.pim)} · Dev: ${solesCompact(d.dev)}`
      },
    },
    legend: { bottom: 0, textStyle: { fontSize: 10 } },
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderWidth: 2 },
        label: { show: true, fontSize: 10, formatter: '{b}\n{d}%' },
        data: data.map((d) => ({ name: d.nivel, nivel: d.nivel, value: d.valor, pim: d.pim, dev: d.dev })),
      },
    ],
  }
  return <Chart option={option} height={300} />
}

/* ───────────────────────── Mapa por departamento ───────────────────────── */

function MapaCard({
  geo, filas, dimension, departamento, nivel, cat, fase, atribucion,
}: {
  geo: ReturnType<typeof useAsync<unknown>>
  filas: FilaNorm[]
  dimension: Dimension
  departamento: string
  nivel: NivelSel
  cat: string
  fase: Fase
  atribucion: Atribucion
}) {
  const atribTxt = atribucion === 'meta' ? 'destino (META)' : 'ejecutora'
  return (
    <Card>
      <CardHeader
        title={`Mapa por departamento — ${FASE_LABEL[fase]} 2025`}
        subtitle={`${dimension === 'funcion' ? 'Función' : 'Fuente'}: ${cat === TODOS ? 'todas' : cat} · ${nivel === 'Todos' ? 'todos los niveles' : NIVEL_LABEL[nivel]} · atribución por ${atribTxt}`}
        help={
          <HelpTip>
            Cada departamento se colorea por el {FASE_LABEL[fase]} agregado del filtro (todos sus distritos
            del mapa toman el mismo color, porque el dato del explorador es por departamento, no por distrito).
            Más intenso = más soles. Si filtras un departamento concreto, queda <strong>resaltado</strong>.
            La atribución <strong>por destino (META)</strong> reparte el gasto al territorio donde llega el
            proyecto; <strong>por ejecutora</strong> concentra el Gobierno Nacional en Lima. No es gasto por
            lugar de obra exacto ni per cápita.
          </HelpTip>
        }
        right={<Pill tone={atribucion === 'meta' ? 'good' : 'warn'}>por {atribTxt}</Pill>}
      />
      <div className="px-4 pb-4">
        <MapaInner geo={geo} filas={filas} departamento={departamento} nivel={nivel} cat={cat} fase={fase} />
      </div>
    </Card>
  )
}

function MapaInner({
  geo, filas, departamento, nivel, cat, fase,
}: {
  geo: ReturnType<typeof useAsync<unknown>>
  filas: FilaNorm[]
  departamento: string
  nivel: NivelSel
  cat: string
  fase: Fase
}) {
  if (geo.loading) return <Loading label="Cargando geografía…" />
  if (geo.error) return <ErrorBox error={geo.error} />
  if (!geo.data) return <Loading />

  // Agrega por ubigeo de departamento (2 dígitos).
  const porDepto = new Map<string, { pim: number; dev: number; departamento: string }>()
  for (const r of filas) {
    if (cat !== TODOS && r.cat !== cat) continue
    if (nivel !== 'Todos' && r.nivel !== nivel) continue
    const cur = porDepto.get(r.ubigeo) ?? { pim: 0, dev: 0, departamento: r.departamento }
    cur.pim += r.pim
    cur.dev += r.devengado
    porDepto.set(r.ubigeo, cur)
  }

  // ubigeo de depto seleccionado (para resaltar).
  const ubigeoSel = departamento === TODOS
    ? undefined
    : [...porDepto.entries()].find(([, v]) => v.departamento === departamento)?.[0]

  const values = new Map<string, MapValue>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feats: any[] = ((geo.data as any).features ?? [])
  for (const f of feats) {
    const dpto2 = String(f.properties?.IDDPTO ?? f.properties?.IDDIST?.slice(0, 2) ?? '')
    const a = porDepto.get(dpto2)
    if (!a) continue
    const valor = fase === 'pim' ? a.pim : a.dev
    const resaltado = ubigeoSel && dpto2 === ubigeoSel
    values.set(String(f.properties?.IDDIST), {
      value: valor,
      label: `${a.departamento} · ${solesCompact(valor)} · Ejec ${pct(ejecucion(a.dev, a.pim))}`,
      ...(resaltado ? { color: '#0ea5e9' } : {}),
    })
  }

  if (values.size === 0) {
    return <p className="text-sm text-ink-400 py-8 text-center">No hay montos para pintar con el filtro actual.</p>
  }

  return (
    <MapaDistrital
      geojson={geo.data}
      values={values}
      unitLabel={FASE_LABEL[fase]}
      formatValue={(v) => solesCompact(v)}
      height={520}
    />
  )
}

/* ───────────────────────── Tabla detalle ───────────────────────── */

function TablaDetalle({
  filasFiltradas, dimension, fase, orderDesc, onToggleOrder,
}: {
  filasFiltradas: FilaNorm[]
  dimension: Dimension
  fase: Fase
  orderDesc: boolean
  onToggleOrder: () => void
}) {
  const rows = useMemo(() => {
    const sorted = [...filasFiltradas].sort((a, b) => {
      const va = fase === 'pim' ? a.pim : a.devengado
      const vb = fase === 'pim' ? b.pim : b.devengado
      return orderDesc ? vb - va : va - vb
    })
    return sorted.slice(0, 200)
  }, [filasFiltradas, fase, orderDesc])

  const catHead = dimension === 'funcion' ? 'Función' : 'Fuente'

  return (
    <Card>
      <CardHeader
        title="Detalle del filtro"
        subtitle={`${num(filasFiltradas.length)} filas · ordenable por ${FASE_LABEL[fase]} (${orderDesc ? 'desc' : 'asc'})${filasFiltradas.length > 200 ? ' · mostrando 200' : ''}`}
        help={
          <HelpTip>
            Cada fila es una combinación {catHead.toLowerCase()} × departamento × nivel que cumple el filtro,
            con su PIM, devengado y % de ejecución. Pulsa la cabecera de {FASE_LABEL[fase]} para invertir el orden.
          </HelpTip>
        }
        right={<Pill tone="neutral">2025</Pill>}
      />
      <div className="px-4 pb-4 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400 py-8 text-center">No hay filas para esta combinación de filtros.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-400 border-b border-ink-200 dark:border-ink-800">
                <th className="text-left py-2 pr-2 font-medium">{catHead}</th>
                <th className="text-left py-2 px-2 font-medium">Departamento</th>
                <th className="text-left py-2 px-2 font-medium">Nivel</th>
                <th className="text-right py-2 px-2 font-medium">PIM</th>
                <th className="text-right py-2 px-2 font-medium">Devengado</th>
                <th className="text-right py-2 pl-2 font-medium">
                  <button type="button" onClick={onToggleOrder} className="hover:text-brand-500 underline-offset-2 hover:underline">
                    {FASE_LABEL[fase]} {orderDesc ? '▾' : '▴'}
                  </button>
                </th>
                <th className="text-right py-2 pl-2 font-medium">% Ejec.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const frac = ejecucion(r.devengado, r.pim)
                return (
                  <tr key={`${r.cat}-${r.departamento}-${r.nivel}-${i}`} className="border-b border-ink-100 dark:border-ink-800/60">
                    <td className="py-1.5 pr-2 text-ink-700 dark:text-ink-200">{r.cat}</td>
                    <td className="py-1.5 px-2 text-ink-700 dark:text-ink-200">{r.departamento}</td>
                    <td className="py-1.5 px-2 text-ink-400">{NIVEL_LABEL[r.nivel] ?? r.nivel}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-ink-700 dark:text-ink-200">{soles(r.pim)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-ink-700 dark:text-ink-200">{soles(r.devengado)}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums font-medium text-ink-900 dark:text-ink-50">{soles(fase === 'pim' ? r.pim : r.devengado)}</td>
                    <td className="py-1.5 pl-2 text-right font-semibold tabular-nums" style={{ color: colorEjec(frac) }}>{pct(frac)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}

/* ───────────────────────── Cobertura de información ───────────────────────── */

function CoberturaCard({
  geo, distrito,
}: {
  geo: ReturnType<typeof useAsync<unknown>>
  distrito: ReturnType<typeof useAsync<PorDistrito[]>>
}) {
  return (
    <Card>
      <CardHeader
        title="Cobertura de información"
        subtitle="Distritos del mapa con y sin dato presupuestal 2025"
        help={
          <HelpTip>
            Comparamos los distritos del mapa (geojson) contra los que aparecen en el archivo de
            ejecución por distrito 2025. Un distrito «sin información» no significa necesariamente
            «sin presupuesto»: puede ser que no tenga ejecución registrada como pliego/ejecutora con
            sede ahí, o que el dato no esté en la fuente con ese ubigeo. Distinguir ambos casos es un
            principio de honestidad del observatorio.
          </HelpTip>
        }
        right={<Pill tone="warn">honestidad de datos</Pill>}
      />
      <div className="px-4 pb-4">
        <CoberturaInner geo={geo} distrito={distrito} />
      </div>
    </Card>
  )
}

function CoberturaInner({
  geo, distrito,
}: {
  geo: ReturnType<typeof useAsync<unknown>>
  distrito: ReturnType<typeof useAsync<PorDistrito[]>>
}) {
  if (geo.loading || distrito.loading) return <Loading label="Calculando cobertura…" />
  if (geo.error) return <ErrorBox error={geo.error} />
  if (distrito.error) return <ErrorBox error={distrito.error} />
  if (!geo.data || !distrito.data) return <Loading />

  // ubigeos con dato presupuestal.
  const conDato = new Set<string>()
  for (const r of distrito.data) conDato.add(r.ubigeo)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feats: any[] = ((geo.data as any).features ?? [])
  const totalMapa = feats.length

  const sinDato: { ubigeo: string; distrito: string; provincia: string; departamento: string }[] = []
  let conInfo = 0
  for (const f of feats) {
    const u = String(f.properties?.IDDIST ?? '')
    if (conDato.has(u)) { conInfo += 1; continue }
    sinDato.push({
      ubigeo: u,
      distrito: String(f.properties?.NOMBDIST ?? '—'),
      provincia: String(f.properties?.NOMBPROV ?? '—'),
      departamento: String(f.properties?.NOMBDEP ?? '—'),
    })
  }
  const sinInfo = sinDato.length
  const cobertura = totalMapa > 0 ? conInfo / totalMapa : 0

  // Agrupa los sin-dato por departamento.
  const porDepto = new Map<string, { distrito: string; provincia: string }[]>()
  for (const s of sinDato) {
    const arr = porDepto.get(s.departamento) ?? []
    arr.push({ distrito: s.distrito, provincia: s.provincia })
    porDepto.set(s.departamento, arr)
  }
  const grupos = [...porDepto.entries()]
    .map(([dep, items]) => ({ dep, items: items.sort((a, b) => a.distrito.localeCompare(b.distrito)) }))
    .sort((a, b) => b.items.length - a.items.length)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Con información" value={num(conInfo)} sub="distritos del mapa con dato 2025" accent />
        <KPI label="Sin información" value={num(sinInfo)} sub="no aparecen en por-distrito 2025" />
        <Card className="px-4 py-3">
          <p className="text-xs text-ink-400">% Cobertura</p>
          <p className="text-2xl font-bold tracking-tight" style={{ color: colorEjec(cobertura) }}>{pct(cobertura)}</p>
          <p className="text-xs mt-0.5"><Pill tone={toneEjec(cobertura)}>{num(conInfo)}/{num(totalMapa)}</Pill></p>
        </Card>
        <KPI label="Marco oficial" value="1,845" sub="distritos INEI (referencia)" />
      </div>

      <p className="text-xs text-ink-400">
        El mapa contiene <strong>{num(totalMapa)}</strong> distritos (frente a los{' '}
        <strong>1,845</strong> del marco oficial INEI; la diferencia son distritos creados o sin
        geometría en la capa cartográfica disponible). <Pill tone="warn">«sin información» ≠ «sin presupuesto»</Pill>{' '}
        puede ser ausencia de ejecución registrada con ese ubigeo o ausencia del dato en la fuente.
      </p>

      {grupos.length > 0 && (
        <>
          <CoberturaChart grupos={grupos} />
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-2">
              Distritos sin información, por departamento ({num(sinInfo)})
            </p>
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {grupos.map((g) => (
                <div key={g.dep}>
                  <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                    {g.dep} <span className="text-ink-400 font-normal">· {num(g.items.length)} distritos</span>
                  </p>
                  <ul className="mt-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-ink-600 dark:text-ink-300">
                    {g.items.map((it, i) => (
                      <li key={`${g.dep}-${it.distrito}-${i}`} className="truncate">
                        {it.distrito} <span className="text-ink-400">({it.provincia})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function CoberturaChart({ grupos }: { grupos: { dep: string; items: { distrito: string; provincia: string }[] }[] }) {
  const top = [...grupos].slice(0, 15).reverse()
  const cats = top.map((g) => g.dep)
  const vals = top.map((g) => g.items.length)
  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        const a = Array.isArray(p) ? p[0] : p
        return `<b>${a.name}</b><br>${num(a.value)} distritos sin dato`
      },
    },
    grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    yAxis: { type: 'category', data: cats, axisLabel: { fontSize: 10, width: 130, overflow: 'truncate' } },
    series: [
      {
        type: 'bar',
        data: vals,
        itemStyle: { color: '#fbbf24', borderRadius: [0, 4, 4, 0] as [number, number, number, number] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => num(p.value) },
      },
    ],
  }
  return <Chart option={option} height={Math.max(240, top.length * 24)} />
}
