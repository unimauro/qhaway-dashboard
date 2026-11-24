// ECharts modular: solo se registran los tipos de serie y componentes que usa el repo
// (antes se importaba `echarts` completo → chunk de ~1,1 MB). Si una página nueva usa
// otro tipo de serie (p. ej. 'radar', 'gauge') o componente (dataZoom, polar…),
// hay que registrarlo aquí o ECharts lo ignora en silencio con un warning en consola.
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart, HeatmapChart, PieChart, TreemapChart, SankeyChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
  AriaComponent,
} from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { useRef } from 'react'
import { useTheme } from '../lib/theme'

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  PieChart,
  TreemapChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
  AriaComponent,
  LabelLayout,
  CanvasRenderer,
])

// Paletas QHAWAY
// eslint-disable-next-line react-refresh/only-export-components -- constante compartida (SerieChart); mover a src/lib rompería imports de otros módulos
export const PALETA = ['#14b8a6', '#fbbf24', '#0ea5e9', '#f472b6', '#a3e635', '#fb923c', '#818cf8', '#34d399', '#f87171', '#c084fc']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// Fusión profunda (solo objetos planos): lo que pasa la página gana, pero no borra los
// defaults del tema (p. ej. `tooltip: { trigger: 'axis' }` conserva fondo y colores).
function merge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base
  if (!isObj(base) || !isObj(over)) return over
  const out: Obj = { ...base }
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k])
  return out
}

export function Chart({ option, height = 320, onEvents, exportName }: {
  // Tipo permisivo: las páginas pasan objetos de opciones literales (ECharts
  // ensancha `type: 'category'` a string). El wrapper los fusiona con los
  // defaults tipados; ECharts valida en runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option: any
  height?: number | string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvents?: Record<string, (params: any) => void>
  // Nombre base del archivo al descargar el gráfico como PNG (para tesis/informes).
  exportName?: string
}) {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const axisColor = dark ? '#94a3b8' : '#475569'
  const gridColor = dark ? '#1e293b' : '#e2e8f0'

  const tema: EChartsOption = {
    color: PALETA,
    // Accesibilidad: ECharts genera una descripción textual (aria-label) del gráfico
    // para lectores de pantalla.
    aria: { enabled: true },
    textStyle: { fontFamily: 'inherit', color: axisColor },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: dark ? '#0f172a' : '#ffffff',
      borderColor: gridColor,
      textStyle: { color: dark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
    },
  }

  // Claves de tema que se fusionan en profundidad; el resto de `option` reemplaza tal cual.
  const base: Obj = { ...tema, ...option }
  for (const k of ['aria', 'textStyle', 'grid', 'tooltip'] as const) {
    if (option && k in option) base[k] = merge(tema[k], option[k])
  }
  // Un `grid` propio con márgenes en píxeles y sin containLabel (p. ej. Riesgos) ya
  // reserva el espacio de las etiquetas: no le heredamos containLabel:true del tema,
  // que duplicaría el margen. Sí hereda los lados que no especifique.
  if (isObj(option?.grid) && !('containLabel' in option.grid) && isObj(base.grid)) {
    base.grid = { ...base.grid, containLabel: false }
  }

  // Descarga del gráfico como PNG. Antes era el toolbox nativo de ECharts, pero
  // ToolboxComponent arrastra dataZoom, brush, dataView y magicType (~cientos de kB)
  // solo para un botón; ahora es un botón HTML que usa getDataURL (mismo resultado:
  // pixelRatio 2 y fondo según tema).
  const ref = useRef<ReactEChartsCore>(null)
  const descargar = () => {
    const inst = ref.current?.getEchartsInstance()
    if (!inst) return
    const a = document.createElement('a')
    a.href = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: dark ? '#0f172a' : '#ffffff' })
    a.download = `qhaway-${exportName || 'grafico'}.png`
    a.click()
  }

  return (
    <div className="relative group/chart">
      <ReactEChartsCore
        ref={ref}
        echarts={echarts}
        option={base}
        style={{ height, width: '100%' }}
        opts={{ renderer: 'canvas' }}
        onEvents={onEvents}
        notMerge
        lazyUpdate
      />
      <button
        type="button"
        onClick={descargar}
        title="Descargar PNG"
        aria-label="Descargar gráfico como PNG"
        className="absolute right-0 top-0 grid place-items-center w-6 h-6 rounded-md text-[13px] leading-none text-ink-400 opacity-60 hover:opacity-100 focus-visible:opacity-100 hover:text-brand-500 hover:bg-ink-100 dark:hover:bg-ink-800 transition"
      >
        <span aria-hidden>⤓</span>
      </button>
    </div>
  )
}
