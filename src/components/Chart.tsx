import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useTheme } from '../lib/theme'

// Paletas QHAWAY
export const PALETA = ['#14b8a6', '#fbbf24', '#0ea5e9', '#f472b6', '#a3e635', '#fb923c', '#818cf8', '#34d399', '#f87171', '#c084fc']

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

  const base: EChartsOption = {
    color: PALETA,
    textStyle: { fontFamily: 'inherit', color: axisColor },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: dark ? '#0f172a' : '#ffffff',
      borderColor: gridColor,
      textStyle: { color: dark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
    },
    // Descarga del gráfico como PNG (toolbox nativo de ECharts). Los estudiantes
    // necesitan los cuadros como imagen para tesis/informes; el fondo respeta el tema.
    toolbox: {
      show: true,
      right: 6,
      top: -4,
      itemSize: 13,
      feature: {
        saveAsImage: {
          title: 'Descargar PNG',
          name: `qhaway-${exportName || 'grafico'}`,
          pixelRatio: 2,
          backgroundColor: dark ? '#0f172a' : '#ffffff',
          iconStyle: { borderColor: axisColor },
        },
      },
    },
    ...option,
  }

  return (
    <ReactECharts
      option={base}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
      onEvents={onEvents}
      notMerge
      lazyUpdate
    />
  )
}
