import { useEffect, useMemo, useState } from 'react'
import { solesCompact, soles, pct, ejecucion, num } from '../lib/format'
import { Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox } from './ui'
import { Chart } from './Chart'
import { downloadCSV } from '../lib/download'

/* ───────────────────────── Esquema del clasificador temático MEF ───────────────────────── */

type Medida = 'Adaptación' | 'Mitigación' | 'Mitigación y Adaptación'
type Atribucion = 'Directa' | 'Indirecta'
type Corte = 'funcion' | 'departamento' | 'nivel'

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

/* ════════════════════════════════════════════════════════════════════ */

export default function ClimaOficial() {
  const [rows, setRows] = useState<FilaClima[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [year, setYear] = useState<number | null>(null)
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

  const porFuncion = useMemo(() => filtradas.filter((r) => r.corte === 'funcion'), [filtradas])
  const porDepartamento = useMemo(() => filtradas.filter((r) => r.corte === 'departamento'), [filtradas])

  // KPIs — usamos el corte FUNCIÓN como base nacional (cada corte suma el total por separado).
  // Si no hay corte función, caemos al corte departamento para no quedar en blanco.
  const baseKPI = porFuncion.length ? porFuncion : porDepartamento
  const totalPIM = useMemo(() => baseKPI.reduce((s, r) => s + (r.pim || 0), 0), [baseKPI])
  const totalDev = useMemo(() => baseKPI.reduce((s, r) => s + (r.devengado || 0), 0), [baseKPI])

  // Split por medida (categorías SEPARADAS — no se suman entre sí). Ignora el filtro de medida
  // para mostrar siempre la composición completa del año/atribución.
  const porMedida = useMemo(() => {
    const base = (rows ?? []).filter((r) =>
      r.year === year
      && r.corte === (porFuncion.length || !porDepartamento.length ? 'funcion' : 'departamento')
      && (filtroAtrib === 'todas' || r.atribucion === filtroAtrib),
    )
    const m = new Map<Medida, number>()
    for (const med of MEDIDAS) m.set(med, 0)
    for (const r of base) m.set(r.medida, (m.get(r.medida) ?? 0) + (r.pim || 0))
    return m
  }, [rows, year, filtroAtrib, porFuncion.length, porDepartamento.length])

  // Split por atribución (Directa vs Indirecta), respetando el filtro de medida.
  const porAtrib = useMemo(() => {
    const base = (rows ?? []).filter((r) =>
      r.year === year
      && r.corte === (porFuncion.length || !porDepartamento.length ? 'funcion' : 'departamento')
      && (filtroMedida === 'todas' || r.medida === filtroMedida),
    )
    let directa = 0
    let indirecta = 0
    for (const r of base) {
      if (r.atribucion === 'Directa') directa += r.pim || 0
      else indirecta += r.pim || 0
    }
    return { directa, indirecta }
  }, [rows, year, filtroMedida, porFuncion.length, porDepartamento.length])

  /* ───────────────────────── Gráfico: barras apiladas por función × medida ───────────────────────── */

  const funcionApilada = useMemo(() => {
    // Agrupa PIM por nombre de función y medida.
    const funcs = new Map<string, Map<Medida, number>>()
    for (const r of porFuncion) {
      if (!funcs.has(r.nombre)) funcs.set(r.nombre, new Map())
      const inner = funcs.get(r.nombre)!
      inner.set(r.medida, (inner.get(r.medida) ?? 0) + (r.pim || 0))
    }
    // Total por función para ordenar.
    const arr = [...funcs.entries()].map(([nombre, inner]) => {
      const total = [...inner.values()].reduce((s, v) => s + v, 0)
      return { nombre, inner, total }
    })
    arr.sort((a, b) => b.total - a.total)
    return arr
  }, [porFuncion])

  const funcionOption = useMemo(() => {
    const cats = funcionApilada.map((f) => f.nombre)
    // ECharts dibuja category de abajo hacia arriba: invertimos para que el mayor quede arriba.
    const catsRev = [...cats].reverse()
    const seriesMedidas = MEDIDAS.map((med) => ({
      name: ETIQUETA_MEDIDA[med],
      type: 'bar',
      stack: 'clima',
      itemStyle: { color: COLOR_MEDIDA[med] },
      data: catsRev.map((nombre) => {
        const f = funcionApilada.find((x) => x.nombre === nombre)
        return Math.round(f?.inner.get(med) ?? 0)
      }),
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
          return `<b>${ps[0].axisValue}</b><br/>${body}<br/>Total función: <b>${solesCompact(total)}</b>`
        },
      },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
      yAxis: { type: 'category', data: catsRev, axisLabel: { fontSize: 10, width: 130, overflow: 'truncate' } },
      series: seriesMedidas,
    }
  }, [funcionApilada])

  /* ───────────────────────── Gráfico: ranking por departamento ───────────────────────── */

  const deptoRanking = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of porDepartamento) {
      m.set(r.nombre, (m.get(r.nombre) ?? 0) + (r.pim || 0))
    }
    return [...m.entries()]
      .map(([nombre, pim]) => ({ nombre, pim }))
      .sort((a, b) => b.pim - a.pim)
  }, [porDepartamento])

  const deptoOption = useMemo(() => {
    const top = [...deptoRanking].reverse() // mayor arriba
    return {
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'item',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => `<b>${p.name}</b><br/>PIM: <b>${solesCompact(p.value)}</b>`,
      },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
      yAxis: { type: 'category', data: top.map((d) => d.nombre), axisLabel: { fontSize: 9 } },
      series: [{
        type: 'bar',
        data: top.map((d) => ({ value: d.pim, itemStyle: { color: '#0ea5e9', borderRadius: [0, 4, 4, 0] } })),
        barMaxWidth: 18,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 9, formatter: (p: any) => solesCompact(p.value) },
      }],
    }
  }, [deptoRanking])

  /* ───────────────────────── Descarga CSV ───────────────────────── */

  const descargar = () =>
    downloadCSV('qhaway-clima-tematico-oficial', [
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
    ], filtradas.map((r) => ({
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
            (Agropecuaria, Pesca, Energía, Transporte, Ambiente…), no solo Ambiente. <b>Ojo:</b> «Ambas»
            es una categoría propia — <b>no</b> es la suma de Adaptación + Mitigación; se presentan por
            separado. Fuente: {FUENTE}
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

              {/* Barras apiladas por función × medida */}
              <div className="px-4 py-2">
                <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1">
                  Gasto climático por función, coloreado por medida{' '}
                  <span className="text-ink-400">({num(funcionApilada.length)} funciones)</span>
                </p>
                {funcionApilada.length ? (
                  <Chart
                    option={funcionOption}
                    height={Math.max(260, funcionApilada.length * 26 + 50)}
                    exportName="clima-oficial-funcion"
                  />
                ) : (
                  <Pill tone="warn">Sin corte por función para este año/filtro.</Pill>
                )}
              </div>

              {/* Ranking por departamento */}
              <div className="px-4 py-2 pb-4">
                <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1">
                  Gasto climático por departamento (PIM){' '}
                  <span className="text-ink-400">({num(deptoRanking.length)} departamentos)</span>
                </p>
                {deptoRanking.length ? (
                  <Chart
                    option={deptoOption}
                    height={Math.max(260, deptoRanking.length * 22 + 40)}
                    exportName="clima-oficial-departamento"
                  />
                ) : (
                  <Pill tone="warn">Sin corte por departamento para este año/filtro.</Pill>
                )}
              </div>

              {/* Nota metodológica / fuente */}
              <div className="px-4 pb-4">
                <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                  <b>Fuente:</b> {FUENTE} Soles corrientes. Las medidas (Adaptación / Mitigación /
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
