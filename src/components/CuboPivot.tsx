import { useMemo, useState } from 'react'
import { getCuboPivot, type CuboPivot } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { soles, solesCompact } from '../lib/format'
import { Card, CardHeader, HelpTip, Select, Loading, ErrorBox, Pill } from './ui'
import { Chart } from './Chart'

type Dim = 'funcion' | 'fuente'
type By = 'nivel' | 'departamento'
type Measure = 'pim' | 'devengado'

// Pivote OLAP EN VIVO: cruza dos dimensiones a la vez contra el backend (/api/cubo-pivot).
// Filas = dimensión (función/fuente), columnas = eje (nivel/departamento), color = medida.
// A diferencia del resto del Cubo (cruce socio-territorial precomputado), esto es una
// consulta arbitraria servida en vivo por la API — el "diferencial OLAP" del observatorio.
export default function CuboPivotView({ years }: { years: number[] }) {
  const yrs = years.length ? years : [2025]
  const [year, setYear] = useState<number>(yrs[0])
  const [dim, setDim] = useState<Dim>('funcion')
  const [by, setBy] = useState<By>('nivel')
  const [measure, setMeasure] = useState<Measure>('pim')

  const pivot = useAsync<CuboPivot>(() => getCuboPivot(year, dim, by, measure), [year, dim, by, measure])

  const { option, nFilas } = useMemo(() => {
    const d = pivot.data
    if (!d || !d.filas.length) return { option: null, nFilas: 0 }
    const filas = d.filas.slice(0, 28) // top filas por total (legibilidad)
    const yCats = filas.map((f) => f.clave).reverse() // la mayor arriba
    const xCats = d.columnas
    const data: [number, number, number][] = []
    for (const f of filas) {
      const yi = yCats.indexOf(f.clave)
      xCats.forEach((c, xi) => data.push([xi, yi, Math.round(f.valores[c] || 0)]))
    }
    const maxV = Math.max(1, ...data.map((p) => p[2]))
    const opt = {
      tooltip: {
        position: 'top',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) =>
          `${yCats[p.value[1]]} · ${xCats[p.value[0]]}<br/><b>${soles(p.value[2])}</b>`,
      },
      grid: { left: 4, right: 14, top: 8, bottom: 56, containLabel: true },
      xAxis: {
        type: 'category',
        data: xCats,
        axisLabel: { fontSize: 10, rotate: xCats.length > 5 ? 40 : 0, width: 90, overflow: 'truncate' },
        splitArea: { show: true },
      },
      yAxis: {
        type: 'category',
        data: yCats,
        axisLabel: { fontSize: 10, width: 140, overflow: 'truncate' },
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: maxV,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 6,
        itemWidth: 12,
        itemHeight: 120,
        inRange: { color: ['#ccfbf1', '#2dd4bf', '#0f766e'] },
        formatter: (v: number) => solesCompact(v),
        textStyle: { fontSize: 9 },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: false },
          emphasis: { itemStyle: { borderColor: '#0f172a', borderWidth: 1 } },
        },
      ],
    }
    return { option: opt, nFilas: yCats.length }
  }, [pivot.data])

  const sel = <K extends string>(
    value: K,
    onChange: (v: K) => void,
    label: string,
    options: { value: K; label: string }[],
  ) => <Select<K> value={value} onChange={onChange} options={options} label={label} />

  return (
    <Card>
      <CardHeader
        title="Pivote OLAP en vivo"
        subtitle="Cruza dos dimensiones a la vez · servido por la API en tiempo real"
        help={
          <HelpTip>
            Una <strong>tabla cruzada</strong> de verdad: elige qué va en las filas (función o fuente)
            y qué en las columnas (nivel de gobierno o departamento de destino), y la celda muestra el
            monto. El color es más intenso donde hay más gasto. Se calcula <strong>en vivo</strong> en el
            servidor (no es un archivo precomputado): responde a cualquier combinación de año, dimensión y
            medida. Atribución por destino territorial (META).
          </HelpTip>
        }
        right={<Pill tone="brand">en vivo</Pill>}
      />
      <div className="flex flex-wrap items-end gap-3 px-4 pb-1">
        {sel(String(year), (v) => setYear(Number(v)), 'Año', yrs.map((y) => ({ value: String(y), label: String(y) })))}
        {sel(dim, setDim, 'Filas', [
          { value: 'funcion', label: 'Función' },
          { value: 'fuente', label: 'Fuente' },
        ])}
        {sel(by, setBy, 'Columnas', [
          { value: 'nivel', label: 'Nivel de gobierno' },
          { value: 'departamento', label: 'Departamento (destino)' },
        ])}
        {sel(measure, setMeasure, 'Medida', [
          { value: 'pim', label: 'PIM' },
          { value: 'devengado', label: 'Devengado' },
        ])}
      </div>
      <div className="px-4 pb-4">
        {pivot.loading ? (
          <Loading label="Calculando el pivote…" />
        ) : pivot.error ? (
          <ErrorBox error={String(pivot.error)} />
        ) : !option ? (
          <p className="py-8 text-center text-sm text-ink-400">
            Sin datos para este año todavía (el detalle por destino llega con la migración).
          </p>
        ) : (
          <Chart option={option} height={Math.max(340, nFilas * 22 + 120)} />
        )}
      </div>
    </Card>
  )
}
