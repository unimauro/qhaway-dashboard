import { useEffect, useMemo, useState } from 'react'
import { solesCompact, soles, pct, ejecucion, num } from '../lib/format'
import { Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox } from './ui'
import { Chart } from './Chart'
import { downloadCSV } from '../lib/download'

/* ───────────────────────── Esquema del clasificador temático MEF ───────────────────────── */

type Medida = 'Adaptación' | 'Mitigación' | 'Mitigación y Adaptación'
type Atribucion = 'Directa' | 'Indirecta'
type Corte = 'funcion' | 'departamento' | 'categoria' | 'nivel'

interface FilaClima {
  year: number
  code: string
  nombre: string
  pia: number
  pim: number
  devengado: number
  girado: number
  medida: Medida
  atribucion: Atribucion
  corte: Corte
}

/* Colores por medida — categorías SEPARADAS (Ambas NO es la suma de las otras dos). */
const COLOR_MEDIDA: Record<Medida, string> = {
  'Adaptación': '#0ea5e9', // azul: adaptarse a los impactos
  'Mitigación': '#16a34a', // verde: reducir emisiones
  'Mitigación y Adaptación': '#a855f7', // violeta: ambas a la vez
}
const ETIQUETA_MEDIDA: Record<Medida, string> = {
  'Adaptación': 'Adaptación',
  'Mitigación': 'Mitigación',
  'Mitigación y Adaptación': 'Ambas (mit. + adapt.)',
}
const MEDIDAS: Medida[] = ['Adaptación', 'Mitigación', 'Mitigación y Adaptación']

/* ───────────────────────── Filtros ───────────────────────── */

type FiltroAtrib = 'todas' | Atribucion
type FiltroMedida = 'todas' | Medida

const ATRIB_OPTS: { value: FiltroAtrib; label: string }[] = [
  { value: 'todas', label: 'Todas las atribuciones' },
  { value: 'Directa', label: 'Solo Directa' },
  { value: 'Indirecta', label: 'Solo Indirecta' },
]
const MEDIDA_OPTS: { value: FiltroMedida; label: string }[] = [
  { value: 'todas', label: 'Todas las medidas' },
  { value: 'Adaptación', label: 'Solo Adaptación' },
  { value: 'Mitigación', label: 'Solo Mitigación' },
  { value: 'Mitigación y Adaptación', label: 'Solo Ambas' },
]

const FUENTE = 'MEF — Navegador de gasto en Adaptación y Mitigación ante el Cambio Climático (clasificador temático oficial).'

/* ───────────────────────── Dimensión / corte de análisis ───────────────────────── */

type Dimension = 'funcion' | 'departamento' | 'categoria'

const DIMENSION_OPTS: { value: Dimension; label: string }[] = [
  { value: 'funcion', label: 'Por Función' },
  { value: 'departamento', label: 'Por Departamento (territorialidad)' },
  { value: 'categoria', label: 'Por Categoría / Programa' },
]

/* Etiquetas humanas por dimensión (singular/plural), para títulos y notas. */
const DIM_LABEL: Record<Dimension, { uno: string; muchos: string; eje: string }> = {
  funcion: { uno: 'función', muchos: 'funciones', eje: 'función' },
  departamento: { uno: 'departamento', muchos: 'departamentos', eje: 'departamento' },
  categoria: { uno: 'programa presupuestal', muchos: 'programas presupuestales', eje: 'categoría / programa' },
}

/* ════════════════════════════════════════════════════════════════════ */

export default function ClimaOficial() {
  const [rows, setRows] = useState<FilaClima[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [year, setYear] = useState<number | null>(null)
  const [dimension, setDimension] = useState<Dimension>('funcion')
  const [filtroAtrib, setFiltroAtrib] = useState<FiltroAtrib>('todas')
  const [filtroMedida, setFiltroMedida] = useState<FiltroMedida>('todas')

  // Carga directa del JSON del clasificador temático (tolerante a datos parciales).
  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`${import.meta.env.BASE_URL}data/clima-tematico.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: unknown) => {
        if (!alive) return
        const arr = Array.isArray(data) ? (data as FilaClima[]) : []
        setRows(arr)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  // Años presentes en el JSON (puede llegar parcial, p. ej. solo 2026).
  const years = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a)
  }, [rows])

  // Selecciona el año más reciente apenas haya datos.
  useEffect(() => {
    if (year == null && years.length) setYear(years[0])
  }, [years, year])

  // Filas del año elegido tras aplicar filtros de atribución y medida.
  const filtradas = useMemo(() => {
    if (!rows || year == null) return []
    return rows.filter((r) =>
      r.year === year
      && (filtroAtrib === 'todas' || r.atribucion === filtroAtrib)
      && (filtroMedida === 'todas' || r.medida === filtroMedida),
    )
  }, [rows, year, filtroAtrib, filtroMedida])

  // Qué cortes (dimensiones) tienen datos para el año/filtros actuales — para deshabilitar
  // pestañas vacías y tolerar datasets parciales (p. ej. «categoria» llegando aún).
  const cortesDisponibles = useMemo(() => {
    const s = new Set<Dimension>()
    for (const r of filtradas) {
      if (r.corte === 'funcion' || r.corte === 'departamento' || r.corte === 'categoria') s.add(r.corte)
    }
    return s
  }, [filtradas])

  // Si la dimensión elegida no tiene datos este año, salta a la primera que sí los tenga.
  useEffect(() => {
    if (!filtradas.length) return
    if (cortesDisponibles.has(dimension)) return
    const fallback = (['funcion', 'departamento', 'categoria'] as Dimension[]).find((d) => cortesDisponibles.has(d))
    if (fallback) setDimension(fallback)
  }, [cortesDisponibles, dimension, filtradas.length])

  // Filas del corte (dimensión) activo.
  const filasDim = useMemo(() => filtradas.filter((r) => r.corte === dimension), [filtradas, dimension])

  // KPIs — sumamos el corte activo (cada corte suma el total nacional por separado).
  const totalPIM = useMemo(() => filasDim.reduce((s, r) => s + (r.pim || 0), 0), [filasDim])
  const totalDev = useMemo(() => filasDim.reduce((s, r) => s + (r.devengado || 0), 0), [filasDim])

  // Split por medida (categorías SEPARADAS — no se suman entre sí). Ignora el filtro de medida
  // para mostrar siempre la composición completa del año/atribución, dentro del corte activo.
  const porMedida = useMemo(() => {
    const base = (rows ?? []).filter((r) =>
      r.year === year
      && r.corte === dimension
      && (filtroAtrib === 'todas' || r.atribucion === filtroAtrib),
    )
    const m = new Map<Medida, number>()
    for (const med of MEDIDAS) m.set(med, 0)
    for (const r of base) m.set(r.medida, (m.get(r.medida) ?? 0) + (r.pim || 0))
    return m
  }, [rows, year, dimension, filtroAtrib])

  // Split por atribución (Directa vs Indirecta), respetando el filtro de medida.
  const porAtrib = useMemo(() => {
    const base = (rows ?? []).filter((r) =>
      r.year === year
      && r.corte === dimension
      && (filtroMedida === 'todas' || r.medida === filtroMedida),
    )
    let directa = 0
    let indirecta = 0
    for (const r of base) {
      if (r.atribucion === 'Directa') directa += r.pim || 0
      else indirecta += r.pim || 0
    }
    return { directa, indirecta }
  }, [rows, year, dimension, filtroMedida])

  /* ───────────────────────── Gráfico: barras apiladas por dimensión × medida ───────────────────────── */

  const apilada = useMemo(() => {
    // Agrupa PIM por nombre del ítem de la dimensión y por medida.
    const grupos = new Map<string, Map<Medida, number>>()
    for (const r of filasDim) {
      if (!grupos.has(r.nombre)) grupos.set(r.nombre, new Map())
      const inner = grupos.get(r.nombre)!
      inner.set(r.medida, (inner.get(r.medida) ?? 0) + (r.pim || 0))
    }
    const arr = [...grupos.entries()].map(([nombre, inner]) => {
      const total = [...inner.values()].reduce((s, v) => s + v, 0)
      return { nombre, inner, total }
    })
    arr.sort((a, b) => b.total - a.total)
    return arr
  }, [filasDim])

  const apiladaOption = useMemo(() => {
    const cats = apilada.map((f) => f.nombre)
    // ECharts dibuja category de abajo hacia arriba: invertimos para que el mayor quede arriba.
    const catsRev = [...cats].reverse()
    const lookup = new Map(apilada.map((x) => [x.nombre, x]))
    const ejeLabel = DIM_LABEL[dimension].eje
    const seriesMedidas = MEDIDAS.map((med) => ({
      name: ETIQUETA_MEDIDA[med],
      type: 'bar',
      stack: 'clima',
      itemStyle: { color: COLOR_MEDIDA[med] },
      data: catsRev.map((nombre) => Math.round(lookup.get(nombre)?.inner.get(med) ?? 0)),
    }))
    return {
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 8, right: 64, top: 30, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (ps: any[]) => {
          const total = ps.reduce((s, p) => s + (p.value || 0), 0)
          const body = ps
            .filter((p) => p.value > 0)
            .map((p) => `${p.marker}${p.seriesName}: <b>${solesCompact(p.value)}</b>`)
            .join('<br/>')
          return `<b>${ps[0].axisValue}</b><br/>${body}<br/>Total ${ejeLabel}: <b>${solesCompact(total)}</b>`
        },
      },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
      yAxis: { type: 'category', data: catsRev, axisLabel: { fontSize: 10, width: 150, overflow: 'truncate' } },
      series: seriesMedidas,
    }
  }, [apilada, dimension])

  /* ───────────────────────── Descarga CSV ───────────────────────── */

  const descargar = () =>
    downloadCSV(`qhaway-clima-tematico-oficial-${dimension}`, [
      { key: 'year', label: 'Anio' },
      { key: 'corte', label: 'Corte' },
      { key: 'code', label: 'Codigo' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'medida', label: 'Medida' },
      { key: 'atribucion', label: 'Atribucion' },
      { key: 'pia', label: 'PIA' },
      { key: 'pim', label: 'PIM' },
      { key: 'devengado', label: 'Devengado' },
      { key: 'girado', label: 'Girado' },
    ], filasDim.map((r) => ({
      year: r.year, corte: r.corte, code: r.code, nombre: r.nombre,
      medida: r.medida, atribucion: r.atribucion,
      pia: Math.round(r.pia || 0), pim: Math.round(r.pim || 0),
      devengado: Math.round(r.devengado || 0), girado: Math.round(r.girado || 0),
    })) as Record<string, unknown>[])

  /* ───────────────────────── Estados ───────────────────────── */

  if (loading) return <Card><Loading label="Cargando clasificador temático oficial (MEF)…" /></Card>
  if (error && !rows) return <ErrorBox error={error} />

  const sinDatos = !rows || !rows.length
  const sinAnio = !sinDatos && year != null && !filtradas.length

  const adaptacion = porMedida.get('Adaptación') ?? 0
  const mitigacion = porMedida.get('Mitigación') ?? 0
  const ambas = porMedida.get('Mitigación y Adaptación') ?? 0

  return (
    <Card>
      <CardHeader
        title="Gasto en cambio climático — clasificador temático oficial del MEF"
        subtitle={
          year != null
            ? `Dato oficial (adaptación/mitigación × directa/indirecta) · ${year}`
            : 'Dato oficial: adaptación/mitigación × directa/indirecta'
        }
        help={
          <HelpTip>
            A diferencia del proxy «función AMBIENTE», esta vista usa el <b>clasificador temático
            oficial</b> del MEF, que marca cada partida como <b>Adaptación</b> (azul, adaptarse a los
            impactos), <b>Mitigación</b> (verde, reducir emisiones) o <b>Ambas</b> (violeta), y como
            atribución <b>Directa</b> o <b>Indirecta</b>. El gasto climático <b>abarca muchas funciones</b>
            (Agropecuaria, Pesca, Energía, Transporte, Ambiente…), no solo Ambiente. Puedes verlo cortado
            por <b>función</b>, por <b>departamento</b> (territorialidad) o por <b>categoría / programa
            presupuestal</b> con las pestañas «Cortar por». <b>Ojo:</b> «Ambas» es una categoría propia —{' '}
            <b>no</b> es la suma de Adaptación + Mitigación; se presentan por separado. Fuente: {FUENTE}
          </HelpTip>
        }
        right={
          rows && rows.length
            ? <button onClick={descargar} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700">⬇ CSV</button>
            : undefined
        }
      />

      {sinDatos ? (
        <div className="px-4 pb-4">
          <Pill tone="warn">Aún no hay datos del clasificador temático.</Pill>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
            La migración del Navegador de gasto climático del MEF está en curso. Esta vista se poblará
            apenas el dataset esté disponible.
          </p>
        </div>
      ) : (
        <>
          {/* Pestañas de DIMENSIÓN/corte — mobile-first (botones que envuelven) */}
          <div className="px-4 pb-2">
            <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1.5">Cortar por</p>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Dimensión de análisis">
              {DIMENSION_OPTS.map((d) => {
                const hayDatos = cortesDisponibles.has(d.value)
                const activo = dimension === d.value
                return (
                  <button
                    key={d.value}
                    role="tab"
                    aria-selected={activo}
                    disabled={!hayDatos}
                    onClick={() => setDimension(d.value)}
                    className={[
                      'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                      activo
                        ? 'bg-brand-600 text-white'
                        : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700',
                      !hayDatos ? 'opacity-40 cursor-not-allowed' : '',
                    ].join(' ')}
                    title={hayDatos ? undefined : 'Sin datos para este año/filtro todavía'}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Controles: año + filtros */}
          <div className="flex flex-wrap items-end gap-4 px-4 pb-2">
            {years.length > 1 && year != null && (
              <Select
                label="Año"
                value={year}
                onChange={setYear}
                options={years.map((y) => ({ value: y, label: String(y) }))}
              />
            )}
            <Select
              label="Atribución"
              value={filtroAtrib}
              onChange={setFiltroAtrib}
              options={ATRIB_OPTS}
            />
            <Select
              label="Medida"
              value={filtroMedida}
              onChange={setFiltroMedida}
              options={MEDIDA_OPTS}
            />
            <Pill tone="good">dato oficial MEF</Pill>
            {years.length === 1 && (
              <Pill tone="neutral">único año disponible: {years[0]}</Pill>
            )}
          </div>

          {sinAnio ? (
            <div className="px-4 pb-4">
              <Pill tone="warn">Sin partidas para el año y filtros elegidos.</Pill>
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-2">
                <KPI label="Gasto climático (PIM)" value={solesCompact(totalPIM)} sub={`Año ${year}`} accent />
                <KPI label="Devengado" value={solesCompact(totalDev)} sub="gastado" />
                <KPI label="Ejecución" value={pct(ejecucion(totalDev, totalPIM))} sub="devengado / PIM" />
                <KPI
                  label="Directa / Indirecta"
                  value={`${pct(totalPIM2(porAtrib) ? porAtrib.directa / totalPIM2(porAtrib) : 0, 0)}`}
                  sub={`Directa ${solesCompact(porAtrib.directa)} · Indirecta ${solesCompact(porAtrib.indirecta)}`}
                />
              </div>

              {/* Split por medida — categorías separadas */}
              <div className="px-4 py-2">
                <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-2">
                  Composición por medida (categorías separadas — «Ambas» no es la suma)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <MedidaCard med="Adaptación" pim={adaptacion} />
                  <MedidaCard med="Mitigación" pim={mitigacion} />
                  <MedidaCard med="Mitigación y Adaptación" pim={ambas} />
                </div>
              </div>

              {/* Barras apiladas por dimensión activa × medida */}
              <div className="px-4 py-2">
                <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1">
                  Gasto climático por {DIM_LABEL[dimension].eje}, coloreado por medida{' '}
                  <span className="text-ink-400">({num(apilada.length)} {DIM_LABEL[dimension].muchos})</span>
                </p>
                {apilada.length ? (
                  <Chart
                    option={apiladaOption}
                    height={Math.max(260, apilada.length * 26 + 50)}
                    exportName={`clima-oficial-${dimension}`}
                  />
                ) : (
                  <Pill tone="warn">Sin corte por {DIM_LABEL[dimension].uno} para este año/filtro.</Pill>
                )}
              </div>

              {/* Tabla de detalle de la dimensión activa */}
              {apilada.length > 0 && (
                <div className="px-4 py-2 pb-2">
                  <div className="overflow-x-auto rounded-xl border border-ink-200 dark:border-ink-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-ink-50 text-left text-ink-500 dark:bg-ink-900 dark:text-ink-400">
                          <th className="px-3 py-2 font-medium capitalize">{DIM_LABEL[dimension].uno}</th>
                          <th className="px-3 py-2 text-right font-medium">PIM</th>
                          <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">% del total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apilada.map((f) => (
                          <tr key={f.nombre} className="border-t border-ink-100 dark:border-ink-800">
                            <td className="px-3 py-1.5">{f.nombre}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{solesCompact(f.total)}</td>
                            <td className="hidden px-3 py-1.5 text-right tabular-nums text-ink-500 sm:table-cell">
                              {pct(totalPIM ? f.total / totalPIM : 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Nota metodológica / fuente */}
              <div className="px-4 pb-4">
                <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                  <b>Fuente:</b> {FUENTE} Soles corrientes. Puedes cortar el gasto climático oficial por{' '}
                  <b>función</b>, por <b>departamento</b> (territorialidad) o por{' '}
                  <b>categoría / programa presupuestal</b>; cada corte suma el total nacional por
                  separado (no los compares sumando entre sí). Las medidas (Adaptación / Mitigación /
                  Ambas) son <b>categorías propias y no se suman entre sí</b>. Si un corte o año no
                  aparece, es que el dataset aún se está poblando.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  )
}

/* Helper local: total directa+indirecta para la proporción del KPI. */
function totalPIM2(a: { directa: number; indirecta: number }): number {
  return a.directa + a.indirecta
}

function MedidaCard({ med, pim }: { med: Medida; pim: number }) {
  return (
    <div className="rounded-xl border border-ink-200 dark:border-ink-800 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: COLOR_MEDIDA[med] }} />
        <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{ETIQUETA_MEDIDA[med]}</span>
      </div>
      <p className="mt-1 text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">{solesCompact(pim)}</p>
      <p className="text-[11px] text-ink-400">{soles(pim)}</p>
    </div>
  )
}
