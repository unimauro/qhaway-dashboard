import { useMemo, useState } from 'react'
import { loadJSON, getGeoJSON } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { solesCompact, soles, pct, ejecucion } from '../lib/format'
import { Card, CardHeader, HelpTip, KPI, Pill, Select, Loading } from './ui'
import { Chart } from './Chart'
import MapaDistrital, { type MapValue } from './MapaDistrital'
import { downloadCSV } from '../lib/download'

interface FilaPT {
  year: number
  code: string
  programa: string
  ubigeo: string // 2 díg depto
  departamento: string
  pim: number
  devengado: number
}

// "Biodiversidad en Cusco": programa presupuestal climático × departamento (destino META).
export default function ClimaTerritorio() {
  const q = useAsync<FilaPT[]>(() => loadJSON<FilaPT[]>('programa-territorio-clima.json'), [])
  const geo = useAsync<unknown>(() => getGeoJSON(), [])
  const [code, setCode] = useState<string | undefined>(undefined)
  const [yearSel, setYearSel] = useState<number | undefined>(undefined)

  const data = q.data ?? []
  const programas = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of data) if (!m.has(r.code)) m.set(r.code, r.programa)
    return [...m.entries()].map(([c, n]) => ({ value: c, label: `${c} ${n}`.slice(0, 46) }))
  }, [data])
  const cod = code ?? programas[0]?.value
  const years = useMemo(() => [...new Set(data.filter((r) => r.code === cod).map((r) => r.year))].sort((a, b) => b - a), [data, cod])
  const year = yearSel && years.includes(yearSel) ? yearSel : years[0]

  const filas = useMemo(() => data.filter((r) => r.code === cod && r.year === year).sort((a, b) => b.pim - a.pim), [data, cod, year])
  const total = filas.reduce((s, r) => s + r.pim, 0)
  const totalDev = filas.reduce((s, r) => s + r.devengado, 0)
  const top = filas[0]
  const programaNombre = filas[0]?.programa ?? programas.find((p) => p.value === cod)?.label ?? ''

  const mapValues = useMemo(() => {
    const m = new Map<string, MapValue>()
    const byDep = new Map(filas.map((r) => [r.ubigeo, r]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feats = (geo.data as any)?.features as any[] | undefined
    if (!feats) return m
    for (const f of feats) {
      const dep2 = String(f.properties?.IDDPTO ?? f.properties?.IDDIST?.slice(0, 2) ?? '')
      const r = byDep.get(dep2)
      if (r) m.set(String(f.properties?.IDDIST), { value: r.pim, label: `${r.departamento}: ${solesCompact(r.pim)}` })
    }
    return m
  }, [filas, geo.data])

  const rankingOption = useMemo(() => {
    const t = filas.slice(0, 15).reverse()
    return {
      tooltip: { trigger: 'item', formatter: (p: { name: string; value: number }) => `<b>${p.name}</b><br/>PIM: <b>${soles(p.value)}</b>` },
      grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
      yAxis: { type: 'category', data: t.map((r) => r.departamento), axisLabel: { fontSize: 10 } },
      series: [{ type: 'bar', data: t.map((r) => r.pim), itemStyle: { color: '#16a34a', borderRadius: [0, 4, 4, 0] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 9, formatter: (p: any) => solesCompact(p.value) } }],
    }
  }, [filas])

  const descargar = () =>
    downloadCSV(`qhaway-clima-${cod}-territorio-${year}`, [
      { key: 'ubigeo', label: 'UBIGEO_depto' }, { key: 'departamento', label: 'Departamento' },
      { key: 'pim', label: 'PIM' }, { key: 'devengado', label: 'Devengado' },
    ], filas.map((r) => ({ ubigeo: r.ubigeo, departamento: r.departamento, pim: Math.round(r.pim), devengado: Math.round(r.devengado) })) as Record<string, unknown>[])

  if (q.loading) return <Card><Loading label="Cargando programas climáticos por territorio…" /></Card>
  if (!q.data || !q.data.length) return null

  return (
    <Card>
      <CardHeader
        title="Programa climático por territorio"
        subtitle="¿Dónde aterriza cada programa climático? (ej. biodiversidad en Cusco) · destino META"
        help={
          <HelpTip>
            Elige un <strong>programa presupuestal climático</strong> y mira su distribución por departamento de
            <strong> destino</strong> (META, a dónde se dirige el gasto). Responde preguntas como «¿cuánto de
            conservación de biodiversidad llega a Cusco?». <Pill tone="warn">aprox.</Pill> Atribución a nivel
            departamental (el SIAF solo georreferencia el destino hasta departamento).
          </HelpTip>
        }
        right={<button onClick={descargar} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700">⬇ CSV</button>}
      />
      <div className="flex flex-wrap items-end gap-3 px-4 pb-1">
        <Select<string> value={cod} onChange={setCode} options={programas} label="Programa climático" />
        <Select<number> value={year} onChange={setYearSel} options={years.map((y) => ({ value: y, label: String(y) }))} label="Año" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 py-2">
        <KPI label={`PIM ${year}`} value={solesCompact(total)} sub={programaNombre.slice(0, 30)} accent />
        <KPI label="Departamento líder" value={top?.departamento ?? '—'} sub={top ? solesCompact(top.pim) : ''} />
        <KPI label="Ejecución" value={pct(ejecucion(totalDev, total))} sub="devengado / PIM" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
        <div>
          {geo.loading ? <Loading label="Cargando mapa…" /> : geo.data ? (
            <MapaDistrital geojson={geo.data} values={mapValues} unitLabel="PIM" formatValue={(v) => solesCompact(v)} height={360} />
          ) : null}
        </div>
        <div>
          <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1">Ranking por departamento</p>
          <Chart option={rankingOption} height={360} />
        </div>
      </div>
    </Card>
  )
}
