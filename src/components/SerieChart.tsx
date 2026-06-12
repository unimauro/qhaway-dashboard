import { useMemo, useState } from 'react'
import type { SerieNacional } from '../lib/types'
import { Chart, PALETA } from './Chart'
import { solesCompact, soles, pct, ejecucion } from '../lib/format'

export interface PuntoMensual {
  mes: number
  devengado: number
  pim?: number
}

interface SerieChartProps {
  serie: SerieNacional[]
  mensual?: PuntoMensual[]
  height?: number
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']

// Color por nivel de ejecución (devengado/pim): rojo <0.5, ámbar 0.5–0.8, verde >0.8
function colorEjecucion(frac: number): string {
  if (frac < 0.5) return '#f87171'
  if (frac < 0.8) return '#fbbf24'
  return '#34d399'
}

/**
 * Gráfico de serie presupuestal robusto:
 * - 1 año: barras de fases (PIA, PIM, Certificado, Devengado, Girado) + (opcional)
 *   línea de devengado acumulado mensual con PIM de referencia, conmutables por toggle.
 * - 2+ años: barras PIM + barras Devengado por año, % de ejecución en tooltip.
 * Nunca se ve vacío: con un solo año dibuja barras llenas en vez de puntos sueltos.
 */
export default function SerieChart({ serie, mensual, height = 340 }: SerieChartProps) {
  const tieneMensual = Boolean(mensual && mensual.length > 0)
  const unAnio = serie.length === 1
  // Vista por defecto: si hay un solo año y existe data mensual, partimos en "Por año"
  const [vista, setVista] = useState<'anual' | 'mensual'>('anual')

  // ---- Caso multi-año: barras PIM + Devengado por año ----
  const optMultiAnio = useMemo(() => {
    const ordenada = [...serie].sort((a, b) => a.year - b.year)
    const anios = ordenada.map((s) => String(s.year))
    const pims = ordenada.map((s) => s.pim)
    const devs = ordenada.map((s) => s.devengado)
    return {
      legend: { top: 0, data: ['PIM', 'Devengado'] },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          const idx = params[0]?.dataIndex ?? 0
          const s = ordenada[idx]
          const frac = ejecucion(s.devengado, s.pim)
          return [
            `<b>${s.year}</b>`,
            `PIM: ${soles(s.pim)}`,
            `Devengado: ${soles(s.devengado)}`,
            `Ejecución: <b>${pct(frac)}</b>`,
          ].join('<br/>')
        },
      },
      xAxis: { type: 'category', data: anios },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => solesCompact(v) },
      },
      series: [
        {
          name: 'PIM',
          type: 'bar',
          data: pims,
          itemStyle: { color: PALETA[2], borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 48,
        },
        {
          name: 'Devengado',
          type: 'bar',
          data: devs,
          itemStyle: { color: PALETA[0], borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 48,
        },
      ],
    }
  }, [serie])

  // ---- Caso un año: barras de fases ----
  const optFases = useMemo(() => {
    const s = serie[0]
    if (!s) return null
    const fases: { label: string; valor: number | undefined; color: string }[] = [
      { label: 'PIA', valor: s.pia, color: PALETA[6] },
      { label: 'PIM', valor: s.pim, color: PALETA[2] },
      { label: 'Certificado', valor: s.certificado, color: PALETA[1] },
      { label: 'Devengado', valor: s.devengado, color: PALETA[0] },
      { label: 'Girado', valor: s.girado, color: PALETA[7] },
    ].filter((f) => f.valor != null)
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          const p = params[0]
          const f = fases[p?.dataIndex ?? 0]
          const lineas = [`<b>${f.label}</b>`, soles(f.valor)]
          if (f.label === 'Devengado' && s.pim) {
            lineas.push(`Ejecución: <b>${pct(ejecucion(s.devengado, s.pim))}</b>`)
          }
          return lineas.join('<br/>')
        },
      },
      xAxis: { type: 'category', data: fases.map((f) => f.label) },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => solesCompact(v) },
      },
      series: [
        {
          type: 'bar',
          data: fases.map((f) => ({
            value: f.valor,
            itemStyle: { color: f.color, borderRadius: [4, 4, 0, 0] },
          })),
          barMaxWidth: 56,
          label: {
            show: true,
            position: 'top',
            formatter: (p: { value: number }) => solesCompact(p.value),
            fontSize: 11,
          },
        },
      ],
    }
  }, [serie])

  // ---- Caso un año: línea de devengado acumulado mensual + PIM de referencia ----
  const optMensual = useMemo(() => {
    if (!tieneMensual || !mensual) return null
    const ordenada = [...mensual].sort((a, b) => a.mes - b.mes)
    const labels = ordenada.map((m) => MESES[(m.mes - 1) % 12] ?? String(m.mes))
    let acum = 0
    const acumulado = ordenada.map((m) => {
      acum += m.devengado
      return acum
    })
    // PIM de referencia: el del año (serie[0]) o el último mensual reportado
    const pimRef = serie[0]?.pim ?? ordenada[ordenada.length - 1]?.pim
    const fracFinal = pimRef ? ejecucion(acum, pimRef) : 0
    return {
      tooltip: {
        trigger: 'axis',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          const idx = params[0]?.dataIndex ?? 0
          const dev = ordenada[idx].devengado
          const ac = acumulado[idx]
          const frac = pimRef ? ejecucion(ac, pimRef) : 0
          return [
            `<b>${labels[idx]}</b>`,
            `Devengado del mes: ${soles(dev)}`,
            `Acumulado: <b>${soles(ac)}</b>`,
            pimRef ? `Avance vs PIM: <b>${pct(frac)}</b>` : '',
          ]
            .filter(Boolean)
            .join('<br/>')
        },
      },
      xAxis: { type: 'category', boundaryGap: false, data: labels },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => solesCompact(v) },
      },
      series: [
        {
          name: 'Devengado acumulado',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: acumulado,
          lineStyle: { width: 3, color: colorEjecucion(fracFinal) },
          itemStyle: { color: colorEjecucion(fracFinal) },
          areaStyle: { opacity: 0.12, color: colorEjecucion(fracFinal) },
          ...(pimRef
            ? {
                markLine: {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { type: 'dashed', color: PALETA[2], width: 2 },
                  label: {
                    formatter: `PIM ${solesCompact(pimRef)}`,
                    position: 'insideEndTop',
                    fontSize: 11,
                  },
                  data: [{ yAxis: pimRef }],
                },
              }
            : {}),
        },
      ],
    }
  }, [tieneMensual, mensual, serie])

  // ---- Placeholder: sin datos ----
  if (!serie || serie.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-slate-400 dark:text-slate-500"
        style={{ height }}
      >
        Sin datos de serie
      </div>
    )
  }

  // ---- Multi-año: directo ----
  if (!unAnio) {
    return <Chart option={optMultiAnio} height={height} />
  }

  // ---- Un año con toggle anual/mensual ----
  const mostrarMensual = tieneMensual && vista === 'mensual'
  const opcionActiva = mostrarMensual ? optMensual : optFases
  const anio = serie[0].year

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {mostrarMensual ? `Evolución mensual ${anio}` : `Presupuesto y ejecución ${anio}`}
        </span>
        {tieneMensual && (
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs dark:border-slate-700">
            <button
              type="button"
              onClick={() => setVista('anual')}
              className={
                vista === 'anual'
                  ? 'bg-teal-500 px-3 py-1 font-medium text-white'
                  : 'bg-transparent px-3 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }
            >
              Por año
            </button>
            <button
              type="button"
              onClick={() => setVista('mensual')}
              className={
                vista === 'mensual'
                  ? 'bg-teal-500 px-3 py-1 font-medium text-white'
                  : 'bg-transparent px-3 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }
            >
              Evolución {anio}
            </button>
          </div>
        )}
      </div>
      {opcionActiva ? (
        <Chart option={opcionActiva} height={height} />
      ) : (
        <div
          className="flex items-center justify-center text-sm text-slate-400 dark:text-slate-500"
          style={{ height }}
        >
          Sin datos de serie
        </div>
      )}
    </div>
  )
}
