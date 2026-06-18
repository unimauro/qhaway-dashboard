import { useMemo } from 'react'
import { loadJSON } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { type ProgramaRow, esClima } from '../lib/programas'
import { solesCompact, pct, ejecucion, num } from '../lib/format'
import { Card, CardHeader, HelpTip, KPI, Pill, Loading } from './ui'
import { Chart } from './Chart'
import { downloadCSV } from '../lib/download'

// Presupuesto climático MÁS PRECISO: por programa presupuestal (no solo función AMBIENTE).
// Usa los programas con componente ambiental/climático del MEF (ver lib/programas.ts).
export default function ClimaProgramas() {
  const q = useAsync<ProgramaRow[]>(() => loadJSON<ProgramaRow[]>('por-programa-historico.json'), [])

  const { porAnio, ultimo, breakdown } = useMemo(() => {
    const data = q.data ?? []
    const years = [...new Set(data.map((r) => r.year))].sort((a, b) => a - b)
    const porAnio = years.map((y) => {
      const del = data.filter((r) => r.year === y)
      const nac = del.reduce((s, r) => s + (r.pim || 0), 0)
      let nucleo = 0, relacionado = 0, dev = 0
      for (const r of del) {
        const c = esClima(r.code)
        if (c === 'nucleo') { nucleo += r.pim || 0; dev += r.devengado || 0 }
        else if (c === 'relacionado') { relacionado += r.pim || 0; dev += r.devengado || 0 }
      }
      return { year: y, nucleo, relacionado, total: nucleo + relacionado, dev, nac }
    })
    const ultimo = porAnio[porAnio.length - 1]
    const yU = ultimo?.year
    const breakdown = data
      .filter((r) => r.year === yU && esClima(r.code) !== false)
      .sort((a, b) => b.pim - a.pim)
    return { porAnio, ultimo, breakdown }
  }, [q.data])

  const trendOption = useMemo(() => ({
    legend: { data: ['Núcleo', 'Relacionado'], top: 0, textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: 'axis',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (ps: any[]) => `${ps[0].axisValue}<br/>` + ps.map((p) => `${p.marker}${p.seriesName}: <b>${solesCompact(p.value)}</b>`).join('<br/>'),
    },
    grid: { left: 8, right: 12, top: 30, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: porAnio.map((r) => r.year), axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
    series: [
      { name: 'Núcleo', type: 'bar', stack: 'c', data: porAnio.map((r) => Math.round(r.nucleo)), itemStyle: { color: '#16a34a' } },
      { name: 'Relacionado', type: 'bar', stack: 'c', data: porAnio.map((r) => Math.round(r.relacionado)), itemStyle: { color: '#2dd4bf' } },
    ],
  }), [porAnio])

  const breakdownOption = useMemo(() => {
    const top = [...breakdown].reverse()
    return {
      tooltip: {
        trigger: 'item',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => `<b>${p.name}</b><br/>PIM: <b>${solesCompact(p.value)}</b>`,
      },
      grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
      yAxis: { type: 'category', data: top.map((r) => `${r.code} ${r.programa}`.slice(0, 38)), axisLabel: { fontSize: 9, width: 200, overflow: 'truncate' } },
      series: [{
        type: 'bar',
        data: top.map((r) => ({ value: r.pim, itemStyle: { color: esClima(r.code) === 'nucleo' ? '#16a34a' : '#2dd4bf', borderRadius: [0, 4, 4, 0] } })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 9, formatter: (p: any) => solesCompact(p.value) },
      }],
    }
  }, [breakdown])

  const descargar = () =>
    downloadCSV('qhaway-presupuesto-climatico-por-programa', [
      { key: 'year', label: 'Anio' }, { key: 'code', label: 'Codigo' }, { key: 'programa', label: 'Programa' },
      { key: 'tipo', label: 'Tipo' }, { key: 'pim', label: 'PIM' }, { key: 'devengado', label: 'Devengado' },
    ], (q.data ?? []).filter((r) => esClima(r.code) !== false).map((r) => ({
      year: r.year, code: r.code, programa: r.programa, tipo: esClima(r.code), pim: Math.round(r.pim), devengado: Math.round(r.devengado),
    })) as Record<string, unknown>[])

  if (q.loading) return <Card><Loading label="Cargando presupuesto climático por programa…" /></Card>
  if (!q.data || !q.data.length || !ultimo) return null

  return (
    <Card>
      <CardHeader
        title="Presupuesto climático por programa presupuestal"
        subtitle={`Más preciso que la función AMBIENTE: usa los programas con componente ambiental/climático del MEF · ${ultimo.year}`}
        help={
          <HelpTip>
            Mientras el resto del módulo usa la <strong>función AMBIENTE</strong> como proxy, aquí identificamos el
            gasto climático por <strong>programa presupuestal</strong> (lo que el MEF financia para conservar
            biodiversidad, gestionar el riesgo de desastres, agua, residuos, bosques, suelos y aire). En{' '}
            <span className="text-green-600 font-semibold">verde</span> el núcleo ambiental/climático y en{' '}
            <span className="text-teal-500 font-semibold">turquesa</span> los relacionados. <Pill tone="warn">aprox.</Pill> Es
            una selección por programa, no el etiquetado oficial por marcadores de Río (mitigación/adaptación), que es el siguiente paso.
          </HelpTip>
        }
        right={<button onClick={descargar} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700">⬇ CSV</button>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-2">
        <KPI label={`PIM climático ${ultimo.year}`} value={solesCompact(ultimo.total)} sub={`${breakdown.length} programas`} accent />
        <KPI label="Núcleo" value={solesCompact(ultimo.nucleo)} sub="ambiental/climático directo" />
        <KPI label="% del presupuesto" value={pct(ultimo.nac > 0 ? ultimo.total / ultimo.nac : 0)} sub={`de ${solesCompact(ultimo.nac)}`} />
        <KPI label="Ejecución" value={pct(ejecucion(ultimo.dev, ultimo.total))} sub="devengado / PIM" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 px-4 pb-4">
        <div>
          <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1">Evolución 2012-{ultimo.year} (núcleo + relacionado)</p>
          <Chart option={trendOption} height={300} />
        </div>
        <div>
          <p className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1">Programas climáticos {ultimo.year} ({num(breakdown.length)})</p>
          <Chart option={breakdownOption} height={Math.max(300, breakdown.length * 26 + 30)} />
        </div>
      </div>
    </Card>
  )
}
