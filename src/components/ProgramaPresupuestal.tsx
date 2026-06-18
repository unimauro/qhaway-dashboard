import { useMemo, useState } from 'react'
import { loadJSON } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { type ProgramaRow, esClima } from '../lib/programas'
import { solesCompact, pct, ejecucion } from '../lib/format'
import { Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox } from './ui'
import { Chart } from './Chart'
import { downloadCSV } from '../lib/download'

// "Categoría presupuestal" que pidió Kely: los ~90 programas presupuestales del MEF
// (Consulta Amigable), con resaltado de los programas AMBIENTALES / CLIMÁTICOS.
export default function ProgramaPresupuestal() {
  const q = useAsync<ProgramaRow[]>(() => loadJSON<ProgramaRow[]>('por-programa-historico.json'), [])
  const [soloClima, setSoloClima] = useState(false)
  const [yearSel, setYearSel] = useState<number | undefined>(undefined)

  const years = useMemo(() => [...new Set((q.data ?? []).map((r) => r.year))].sort((a, b) => b - a), [q.data])
  const year = yearSel ?? years[0]

  const delAnio = useMemo(() => (q.data ?? []).filter((r) => r.year === year), [q.data, year])
  const totalNac = useMemo(() => delAnio.reduce((s, r) => s + (r.pim || 0), 0), [delAnio])

  const clima = useMemo(() => delAnio.filter((r) => esClima(r.code) !== false), [delAnio])
  const totalClima = useMemo(() => clima.reduce((s, r) => s + (r.pim || 0), 0), [clima])
  const totalClimaDev = useMemo(() => clima.reduce((s, r) => s + (r.devengado || 0), 0), [clima])

  const lista = useMemo(() => {
    const base = soloClima ? clima : delAnio
    return [...base].sort((a, b) => b.pim - a.pim)
  }, [soloClima, clima, delAnio])

  const option = useMemo(() => {
    const top = lista.slice(0, soloClima ? lista.length : 20).reverse()
    const cats = top.map((r) => `${r.code} ${r.programa}`.slice(0, 42))
    const data = top.map((r) => {
      const c = esClima(r.code)
      return {
        value: r.pim,
        dev: r.devengado,
        ejec: ejecucion(r.devengado, r.pim),
        itemStyle: { color: c === 'nucleo' ? '#16a34a' : c === 'relacionado' ? '#2dd4bf' : '#94a3b8', borderRadius: [0, 4, 4, 0] },
      }
    })
    return {
      tooltip: {
        trigger: 'item',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => `<b>${p.name}</b><br/>PIM: <b>${solesCompact(p.value)}</b><br/>Devengado: ${solesCompact(p.data.dev)}<br/>Ejecución: ${pct(p.data.ejec)}`,
      },
      grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
      yAxis: { type: 'category', data: cats, axisLabel: { fontSize: 9, width: 230, overflow: 'truncate' } },
      series: [{
        type: 'bar', data,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 9, formatter: (p: any) => solesCompact(p.value) },
      }],
    }
  }, [lista, soloClima])

  const descargar = () =>
    downloadCSV(`qhaway-programa-presupuestal${soloClima ? '-clima' : ''}-${year}`, [
      { key: 'code', label: 'Codigo' },
      { key: 'programa', label: 'Programa presupuestal' },
      { key: 'clima', label: 'Ambiental/Climatico' },
      { key: 'pim', label: 'PIM' },
      { key: 'devengado', label: 'Devengado' },
    ], lista.map((r) => ({ code: r.code, programa: r.programa, clima: esClima(r.code) || 'no', pim: Math.round(r.pim), devengado: Math.round(r.devengado) })) as Record<string, unknown>[])

  if (q.loading) return <Card><Loading label="Cargando programas presupuestales…" /></Card>
  if (q.error) return <Card><ErrorBox error={String(q.error)} /></Card>
  if (!q.data || !q.data.length) return null

  return (
    <Card>
      <CardHeader
        title="Categoría / Programa Presupuestal"
        subtitle={`Los ~90 programas del MEF · resaltados los ambientales/climáticos · ${year}`}
        help={
          <HelpTip>
            La <strong>categoría presupuestal</strong> agrupa el gasto por <strong>programa presupuestal</strong>
            (qué resultado busca el dinero), no por sector ni territorio. En <span className="text-green-600 font-semibold">verde</span> los
            programas de <strong>componente ambiental/climático directo</strong> (biodiversidad, gestión de riesgo de
            desastres, recursos hídricos, residuos, bosques, calidad del aire, suelos) y en <span className="text-teal-500 font-semibold">turquesa</span> los
            relacionados (saneamiento, electrificación rural, adaptación). <Pill tone="warn">aprox.</Pill> Es una
            selección por programa, no el etiquetado oficial por marcadores de Río (mitigación/adaptación) — eso es el siguiente paso.
          </HelpTip>
        }
        right={
          <button onClick={descargar} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700">⬇ CSV</button>
        }
      />
      <div className="flex flex-wrap items-end gap-3 px-4 pb-1">
        <Select<number> value={year} onChange={setYearSel} options={years.map((y) => ({ value: y, label: String(y) }))} label="Año" />
        <Select<string> value={soloClima ? 'clima' : 'todos'} onChange={(v) => setSoloClima(v === 'clima')} label="Mostrar"
          options={[{ value: 'todos', label: 'Top 20 programas' }, { value: 'clima', label: 'Solo ambiental/climático' }]} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 py-2">
        <KPI label="PIM total (nacional)" value={solesCompact(totalNac)} sub={`${year}`} />
        <KPI label="PIM ambiental/climático" value={solesCompact(totalClima)} sub={`${clima.length} programas`} accent />
        <KPI label="% del presupuesto" value={pct(totalNac > 0 ? totalClima / totalNac : 0)} sub={`ejec ${pct(ejecucion(totalClimaDev, totalClima))}`} />
      </div>
      <div className="px-4 pb-4">
        <Chart option={option} height={Math.max(340, (soloClima ? lista.length : 20) * 22 + 40)} />
      </div>
    </Card>
  )
}
