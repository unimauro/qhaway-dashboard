import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { loadJSON, getGeoJSON } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { soles, solesCompact, pct, num, ejecucion } from '../lib/format'
import {
  Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro,
} from '../components/ui'
import { Chart } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'

/* ───────────────────────── Tipos y constantes ───────────────────────── */

interface DeptoHist {
  year: number
  ubigeo: string        // 2 dígitos
  departamento: string
  pia: number
  pim: number
  certificado: number
  devengado: number
  girado: number
}

type Fase = 'pim' | 'devengado'

const FASE_LABEL: Record<Fase, string> = { pim: 'PIM', devengado: 'Devengado' }

const FASE_OPTS: { value: Fase; label: string }[] = [
  { value: 'pim', label: 'PIM (asignado vigente)' },
  { value: 'devengado', label: 'Devengado (gastado)' },
]

// Ubigeos que NO son departamentos territoriales (se excluyen del análisis regional).
const UBIGEOS_NO_TERRITORIO = new Set(['00', '98'])

// Año desde el cual el devengado por departamento es confiable en la fuente.
// 2004-2011 traen valores espurios de devengado/girado (atribución territorial incompleta).
const DEVENGADO_DESDE = 2012

// Año de corte parcial (ejercicio en curso).
const ANIO_PARCIAL = 2026

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

/* ───────────────────────── Página ───────────────────────── */

export default function Historico() {
  const hist = useAsync<DeptoHist[]>(
    () => loadJSON<DeptoHist[]>('por-departamento-historico.json'),
    [],
  )
  const geo = useAsync<unknown>(getGeoJSON, [])

  if (hist.loading) return <Loading label="Cargando 22 años de presupuesto regional…" />
  if (hist.error) return <ErrorBox error={hist.error} />
  if (!hist.data) return <Loading />

  return <HistoricoBody hist={hist.data} geo={geo} />
}

function HistoricoBody({
  hist,
  geo,
}: {
  hist: DeptoHist[]
  geo: ReturnType<typeof useAsync<unknown>>
}) {
  // Solo departamentos territoriales reales.
  const rows = useMemo(
    () => hist.filter((r) => !UBIGEOS_NO_TERRITORIO.has(r.ubigeo)),
    [hist],
  )

  // Años disponibles, descendente.
  const years = useMemo(
    () => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a),
    [rows],
  )

  // Lista de departamentos (para el selector de evolución), por nombre.
  const departamentos = useMemo(() => {
    const m = new Map<string, string>() // ubigeo -> nombre
    for (const r of rows) if (!m.has(r.ubigeo)) m.set(r.ubigeo, r.departamento)
    return [...m.entries()]
      .map(([ubigeo, nombre]) => ({ ubigeo, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [rows])

  const [year, setYear] = useState<number>(years[0])
  const [fase, setFase] = useState<Fase>('pim')
  const [deptoSel, setDeptoSel] = useState<string>(departamentos[0]?.ubigeo ?? '')
  const [mapSel, setMapSel] = useState<string | undefined>(undefined)

  // Registros del año seleccionado.
  const delAnio = useMemo(
    () => rows.filter((r) => r.year === year).sort((a, b) => b[fase] - a[fase]),
    [rows, year, fase],
  )

  const yearOpts = useMemo(
    () => years.map((y) => ({ value: y, label: y === ANIO_PARCIAL ? `${y} (parcial)` : String(y) })),
    [years],
  )
  const deptoOpts = useMemo(
    () => departamentos.map((d) => ({ value: d.ubigeo, label: d.nombre })),
    [departamentos],
  )

  const devengadoConfiable = year >= DEVENGADO_DESDE
  const faseEfectiva: Fase = fase === 'devengado' && !devengadoConfiable ? 'pim' : fase

  // KPIs nacionales del año (suma de departamentos).
  const totalPim = delAnio.reduce((a, r) => a + (r.pim || 0), 0)
  const totalDev = delAnio.reduce((a, r) => a + (r.devengado || 0), 0)
  const fracNac = ejecucion(totalDev, totalPim)
  const nDeptos = delAnio.length

  return (
    <div className="space-y-5">
      <SectionIntro title="Evolución Regional 2004-2026">
        El presupuesto público del Estado peruano <strong>por región / departamento</strong> para
        cada uno de los 22 ejercicios fiscales disponibles, atribuido por{' '}
        <strong>destino territorial</strong> (a dónde se dirige el gasto, no dónde está la entidad
        rectora). Elige un año para ver el mapa, el ranking y los KPIs de ese ejercicio; o elige un
        departamento para ver cómo creció su presupuesto en dos décadas. Cifras en{' '}
        <strong>soles corrientes</strong> (no ajustadas por inflación).{' '}
        <Pill tone="brand">Fuente: MEF · Consulta Amigable</Pill>{' '}
        <Pill tone="warn">aprox.</Pill> Los ejercicios previos a 2004 y el año 2005 presentan
        vacíos de atribución geográfica en la fuente; el devengado por región solo es confiable
        desde {DEVENGADO_DESDE}.
      </SectionIntro>

      {/* Controles */}
      <div className="sticky top-0 z-30 -mx-2 px-2 py-2 backdrop-blur bg-white/80 dark:bg-ink-950/80 border-b border-ink-200 dark:border-ink-800 rounded-b-xl space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Select<number> value={year} onChange={(y) => { setYear(y); setMapSel(undefined) }} options={yearOpts} label="Año" />
          <Select<Fase> value={fase} onChange={setFase} options={FASE_OPTS} label="Fase" />
          {fase === 'devengado' && !devengadoConfiable && (
            <Pill tone="warn">sin devengado confiable en {year} — se muestra PIM</Pill>
          )}
          {year === ANIO_PARCIAL && <Pill tone="warn">ejercicio en curso</Pill>}
        </div>
        {/* Salto rápido de año */}
        <YearStrip years={years} year={year} onPick={(y) => { setYear(y); setMapSel(undefined) }} />
      </div>

      {/* KPIs del año */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Resumen {year}</h3>
          <HelpTip>
            Suma de los {nDeptos} departamentos para el año {year}. <strong>PIM</strong>: presupuesto
            modificado (vigente). <strong>Devengado</strong>: gasto reconocido. <strong>% ejecución</strong>{' '}
            = devengado / PIM (rojo &lt;50%, ámbar 50–80%, verde &gt;80%). El total puede diferir del
            consolidado nacional porque excluye montos sin destino territorial.
          </HelpTip>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label={`PIM regional ${year}`} value={solesCompact(totalPim)} sub="Suma de departamentos" accent />
          <KPI
            label={`Devengado ${year}`}
            value={devengadoConfiable ? solesCompact(totalDev) : 's/d'}
            sub={devengadoConfiable ? 'Gasto reconocido' : `no confiable < ${DEVENGADO_DESDE}`}
          />
          <Card className="px-4 py-3">
            <p className="text-xs text-ink-400">% Ejecución</p>
            {devengadoConfiable ? (
              <>
                <p className="text-2xl font-bold tracking-tight" style={{ color: colorEjec(fracNac) }}>{pct(fracNac)}</p>
                <p className="text-xs mt-0.5">
                  <Pill tone={toneEjec(fracNac)}>{fracNac >= 0.8 ? 'alta' : fracNac >= 0.5 ? 'media' : 'baja'}</Pill>
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold tracking-tight text-ink-400">s/d</p>
            )}
          </Card>
          <KPI label="Departamentos" value={num(nDeptos)} sub="Con dato en el año" />
        </div>
      </div>

      {/* Mapa coroplético por departamento */}
      <MapaRegional
        geo={geo}
        delAnio={delAnio}
        year={year}
        fase={faseEfectiva}
        devengadoConfiable={devengadoConfiable}
        selected={mapSel}
        onSelect={setMapSel}
      />

      {/* Ranking + Participación */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RankingDeptos delAnio={delAnio} year={year} fase={faseEfectiva} devengadoConfiable={devengadoConfiable} />
        <Participacion delAnio={delAnio} year={year} fase={faseEfectiva} totalPim={totalPim} totalDev={totalDev} />
      </div>

      {/* Evolución de un departamento */}
      <EvolucionDepto
        rows={rows}
        deptoUbigeo={deptoSel}
        deptoOpts={deptoOpts}
        nombre={departamentos.find((d) => d.ubigeo === deptoSel)?.nombre ?? ''}
        onChange={setDeptoSel}
      />
    </div>
  )
}

/* ───────────────────────── Tira de años (salto rápido) ───────────────────────── */

function YearStrip({ years, year, onPick }: { years: number[]; year: number; onPick: (y: number) => void }) {
  // Mostrar ascendente para una línea de tiempo natural izquierda→derecha.
  const asc = [...years].sort((a, b) => a - b)
  return (
    <div className="flex flex-wrap gap-1 overflow-x-auto">
      {asc.map((y) => {
        const activo = y === year
        return (
          <button
            key={y}
            type="button"
            onClick={() => onPick(y)}
            className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition border ${
              activo
                ? 'bg-brand-500 text-white border-brand-500'
                : 'border-ink-200 dark:border-ink-800 text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800'
            }`}
          >
            {y === ANIO_PARCIAL ? `${y}*` : y}
          </button>
        )
      })}
    </div>
  )
}

/* ───────────────────────── Mapa coroplético por departamento ───────────────────────── */

function MapaRegional({
  geo,
  delAnio,
  year,
  fase,
  devengadoConfiable,
  selected,
  onSelect,
}: {
  geo: ReturnType<typeof useAsync<unknown>>
  delAnio: DeptoHist[]
  year: number
  fase: Fase
  devengadoConfiable: boolean
  selected?: string
  onSelect: (u: string | undefined) => void
}) {
  return (
    <Card>
      <CardHeader
        title={`Mapa regional — ${FASE_LABEL[fase]} ${year}`}
        subtitle="Coroplético por departamento (todos los distritos de una región comparten color)"
        help={
          <HelpTip>
            Cada distrito se pinta con el <strong>{FASE_LABEL[fase]} de su departamento</strong> en{' '}
            {year} (más intenso = más soles). <strong>No</strong> es presupuesto distrital ni per
            cápita: es el agregado regional replicado en todo el territorio del departamento. El
            popup muestra el monto y el % de ejecución de la región. Haz clic en un distrito para
            fijar su departamento.
          </HelpTip>
        }
        right={<Pill tone="warn">por departamento</Pill>}
      />
      <div className="px-4 pb-4">
        {geo.loading ? <Loading label="Cargando geografía…" />
          : geo.error ? <ErrorBox error={geo.error} />
          : !geo.data ? <Loading />
          : (
            <MapaInner
              geo={geo.data}
              delAnio={delAnio}
              fase={fase}
              devengadoConfiable={devengadoConfiable}
              selected={selected}
              onSelect={onSelect}
            />
          )}
      </div>
    </Card>
  )
}

function MapaInner({
  geo,
  delAnio,
  fase,
  devengadoConfiable,
  selected,
  onSelect,
}: {
  geo: unknown
  delAnio: DeptoHist[]
  fase: Fase
  devengadoConfiable: boolean
  selected?: string
  onSelect: (u: string | undefined) => void
}) {
  // Índice depto(2díg) -> registro.
  const porDpto = new Map<string, DeptoHist>()
  for (const r of delAnio) porDpto.set(r.ubigeo, r)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feats: any[] = (geo as any)?.features ?? []
  const values = new Map<string, MapValue>()

  for (const f of feats) {
    const idDist: string = String(f?.properties?.IDDIST ?? '')
    if (!idDist) continue
    const dpto2 = String(f?.properties?.IDDPTO ?? idDist.slice(0, 2))
    const r = porDpto.get(dpto2)
    if (!r) continue
    const valor = r[fase] || 0
    const frac = ejecucion(r.devengado, r.pim)
    const label = devengadoConfiable
      ? `${r.departamento} · ${solesCompact(valor)} · Ejec ${pct(frac)}`
      : `${r.departamento} · ${solesCompact(valor)}`
    values.set(idDist, { value: valor, label })
  }

  return (
    <MapaDistrital
      geojson={geo}
      values={values}
      unitLabel={FASE_LABEL[fase]}
      formatValue={(v) => solesCompact(v)}
      selected={selected}
      onSelect={(idDist) => onSelect(idDist?.slice(0, 2))}
      height={520}
    />
  )
}

/* ───────────────────────── Ranking de departamentos ───────────────────────── */

function RankingDeptos({
  delAnio,
  year,
  fase,
  devengadoConfiable,
}: {
  delAnio: DeptoHist[]
  year: number
  fase: Fase
  devengadoConfiable: boolean
}) {
  return (
    <Card>
      <CardHeader
        title={`Ranking regional ${year}`}
        subtitle={`Departamentos por ${FASE_LABEL[fase]} · color = % ejecución`}
        help={
          <HelpTip>
            Barras del <strong>{FASE_LABEL[fase]}</strong> por departamento, de mayor a menor. El{' '}
            <strong>color</strong> indica el % de ejecución (devengado/PIM): rojo &lt;50%, ámbar
            50–80%, verde &gt;80%
            {devengadoConfiable ? '' : ` (gris en ${year}: sin devengado confiable)`}. El tooltip
            muestra PIM y devengado. Recuerda: <strong>PIM ≠ gasto</strong>.
          </HelpTip>
        }
      />
      <div className="px-4 pb-4">
        {delAnio.length === 0
          ? <ErrorBox error={`Sin datos regionales para ${year}.`} />
          : <RankingChart delAnio={delAnio} fase={fase} devengadoConfiable={devengadoConfiable} />}
      </div>
    </Card>
  )
}

function RankingChart({
  delAnio,
  fase,
  devengadoConfiable,
}: {
  delAnio: DeptoHist[]
  fase: Fase
  devengadoConfiable: boolean
}) {
  const ordenado = [...delAnio].sort((a, b) => (a[fase] || 0) - (b[fase] || 0)) // asc → mayor arriba
  const cats = ordenado.map((r) => r.departamento)
  const vals = ordenado.map((r) => {
    const frac = ejecucion(r.devengado, r.pim)
    return {
      value: r[fase] || 0,
      pim: r.pim || 0,
      devengado: r.devengado || 0,
      ejec: frac,
      itemStyle: {
        color: devengadoConfiable ? colorEjec(frac) : '#64748b',
        borderRadius: [0, 4, 4, 0],
      },
    }
  })

  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        const d = p.data
        const ejecLine = devengadoConfiable ? `<br>Ejecución: <b>${pct(d.ejec)}</b>` : ''
        return `<b>${p.name}</b><br>${FASE_LABEL[fase]}: <b>${solesCompact(d.value)}</b><br>PIM: <b>${solesCompact(d.pim)}</b>${devengadoConfiable ? `<br>Devengado: <b>${solesCompact(d.devengado)}</b>` : ''}${ejecLine}`
      },
    },
    grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
    yAxis: { type: 'category', data: cats, axisLabel: { fontSize: 10, width: 120, overflow: 'truncate' } },
    series: [
      {
        type: 'bar',
        data: vals,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => solesCompact(p.value) },
      },
    ],
  }
  return <Chart option={option} height={Math.max(360, cats.length * 22)} />
}

/* ───────────────────────── Participación regional (% del total nacional) ───────────────────────── */

function Participacion({
  delAnio,
  year,
  fase,
  totalPim,
  totalDev,
}: {
  delAnio: DeptoHist[]
  year: number
  fase: Fase
  totalPim: number
  totalDev: number
}) {
  const total = fase === 'pim' ? totalPim : totalDev
  return (
    <Card>
      <CardHeader
        title={`Participación regional ${year}`}
        subtitle={`% que representa cada departamento del ${FASE_LABEL[fase]} regional total`}
        help={
          <HelpTip>
            Reparto del <strong>{FASE_LABEL[fase]} regional total</strong> de {year} entre los
            departamentos (suma = 100%). Útil para ver la <strong>concentración</strong> del gasto:
            Lima suele dominar. El tooltip muestra el monto y el porcentaje.
          </HelpTip>
        }
      />
      <div className="px-4 pb-4">
        {delAnio.length === 0 || total <= 0
          ? <ErrorBox error={`Sin datos de participación para ${year}.`} />
          : <ParticipacionChart delAnio={delAnio} fase={fase} total={total} />}
      </div>
    </Card>
  )
}

function ParticipacionChart({
  delAnio,
  fase,
  total,
}: {
  delAnio: DeptoHist[]
  fase: Fase
  total: number
}) {
  const top = [...delAnio]
    .filter((r) => (r[fase] || 0) > 0)
    .sort((a, b) => (b[fase] || 0) - (a[fase] || 0))
    .slice(0, 10)

  const data = top.map((r) => ({
    name: r.departamento,
    value: r[fase] || 0,
    share: (r[fase] || 0) / total,
  }))

  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => `<b>${p.name}</b><br>${FASE_LABEL[fase]}: <b>${solesCompact(p.value)}</b><br>Participación: <b>${pct(p.data.share)}</b>`,
    },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 10 } },
    series: [
      {
        type: 'pie',
        radius: ['38%', '66%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { formatter: (p: any) => `${p.name}\n${pct(p.data.share, 0)}`, fontSize: 10 },
        labelLine: { length: 8, length2: 6 },
        data,
      },
    ],
  }
  return <Chart option={option} height={360} />
}

/* ───────────────────────── Evolución de un departamento ───────────────────────── */

function EvolucionDepto({
  rows,
  deptoUbigeo,
  deptoOpts,
  nombre,
  onChange,
}: {
  rows: DeptoHist[]
  deptoUbigeo: string
  deptoOpts: { value: string; label: string }[]
  nombre: string
  onChange: (u: string) => void
}) {
  const serie = useMemo(
    () => rows.filter((r) => r.ubigeo === deptoUbigeo).sort((a, b) => a.year - b.year),
    [rows, deptoUbigeo],
  )

  return (
    <Card>
      <CardHeader
        title="Evolución de un departamento (2004-2026)"
        subtitle="Serie temporal del PIM y el devengado de la región elegida"
        help={
          <HelpTip>
            Cómo creció el presupuesto de una región en 22 años. Las barras son el{' '}
            <strong>PIM</strong> anual y la línea el <strong>devengado</strong> (gasto reconocido).
            Cifras en <strong>soles corrientes</strong>: el crecimiento incluye inflación, no es
            todo aumento real. El devengado regional solo es confiable desde {DEVENGADO_DESDE}; los
            años previos pueden aparecer en cero.
          </HelpTip>
        }
        right={
          <Select<string> value={deptoUbigeo} onChange={onChange} options={deptoOpts} label="Departamento" />
        }
      />
      <div className="px-4 pb-4">
        {serie.length === 0
          ? <ErrorBox error="Sin serie para el departamento elegido." />
          : <EvolucionChart serie={serie} nombre={nombre} />}
      </div>
    </Card>
  )
}

function EvolucionChart({ serie, nombre }: { serie: DeptoHist[]; nombre: string }) {
  const years = serie.map((r) => r.year)
  const pim = serie.map((r) => r.pim || 0)
  // Devengado solo confiable desde DEVENGADO_DESDE; antes lo dejamos vacío para no engañar.
  const dev = serie.map((r) => (r.year >= DEVENGADO_DESDE ? (r.devengado || 0) : null))

  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        const head = `<b>${nombre} · ${arr[0]?.axisValue}</b>`
        const lines = arr
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((s: any) => s.value != null)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((s: any) => `${s.marker}${s.seriesName}: <b>${solesCompact(Number(s.value))}</b>`)
        return [head, ...lines].join('<br>')
      },
    },
    legend: { data: ['PIM', 'Devengado'], top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: years, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
    series: [
      {
        name: 'PIM',
        type: 'bar',
        data: pim,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      },
      {
        name: 'Devengado',
        type: 'line',
        data: dev,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        connectNulls: false,
        lineStyle: { width: 2 },
      },
    ],
  }
  return (
    <div>
      <Chart option={option} height={340} />
      <p className="mt-2 text-[11px] text-ink-400">
        {nombre}: en {serie[0]?.year} su PIM fue {soles(serie[0]?.pim || 0)} y en{' '}
        {serie[serie.length - 1]?.year} fue {soles(serie[serie.length - 1]?.pim || 0)}.{' '}
        <Pill tone="warn">soles corrientes</Pill>
      </p>
    </div>
  )
}
