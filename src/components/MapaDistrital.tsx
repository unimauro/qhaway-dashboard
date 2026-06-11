import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../lib/theme'

export interface MapValue {
  value: number          // valor a colorear
  label?: string         // texto extra para el popup
  color?: string         // color explícito (override de la escala)
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geojson: any
  // mapa ubigeo(6) -> valor/color
  values: Map<string, MapValue>
  // escala de color para valores numéricos (si no se da color explícito)
  colorScale?: (v: number, max: number) => string
  max?: number
  unitLabel?: string          // p.ej. "PIM"
  formatValue?: (v: number) => string
  onSelect?: (ubigeo: string, name: string) => void
  selected?: string
  height?: number
}

const DEFAULT_SCALE = (v: number, max: number) => {
  if (max <= 0 || v <= 0) return '#475569'
  const t = Math.min(1, Math.sqrt(v / max)) // sqrt para no aplastar la cola
  // teal claro -> teal oscuro -> dorado
  const stops = ['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e', '#fbbf24', '#d97706']
  const idx = Math.min(stops.length - 1, Math.floor(t * (stops.length - 1)))
  return stops[idx]
}

export default function MapaDistrital({
  geojson, values, colorScale = DEFAULT_SCALE, max, unitLabel = '', formatValue = (v) => String(v),
  onSelect, selected, height = 520,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.GeoJSON | null>(null)
  const { theme } = useTheme()

  // Inicializa el mapa una vez
  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, { center: [-9.2, -75.0], zoom: 5, zoomControl: true, attributionControl: true, preferCanvas: true })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO',
      maxZoom: 12, minZoom: 4,
    }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // (Re)dibuja la capa cuando cambian datos/tema
  useEffect(() => {
    const map = mapRef.current
    if (!map || !geojson) return
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null }

    const maxVal = max ?? Math.max(1, ...Array.from(values.values()).map((d) => d.value))

    const layer = L.geoJSON(geojson, {
      style: (feat) => {
        const ub = feat?.properties?.IDDIST as string
        const d = values.get(ub)
        const fill = d?.color ?? (d ? colorScale(d.value, maxVal) : (theme === 'dark' ? '#1e293b' : '#e2e8f0'))
        const isSel = selected && ub === selected
        return {
          fillColor: fill,
          fillOpacity: d ? 0.85 : 0.25,
          color: isSel ? '#fbbf24' : (theme === 'dark' ? '#0f172a' : '#ffffff'),
          weight: isSel ? 2.5 : 0.4,
        }
      },
      onEachFeature: (feat, lyr) => {
        const p = feat.properties
        const ub = p.IDDIST as string
        const d = values.get(ub)
        const valTxt = d ? `${unitLabel ? unitLabel + ': ' : ''}${formatValue(d.value)}` : 'Sin dato'
        lyr.bindPopup(
          `<div style="font:12px/1.4 system-ui"><strong>${p.NOMBDIST}</strong><br>` +
          `<span style="opacity:.7">${p.NOMBPROV}, ${p.NOMBDEP}</span><br>` +
          `<span style="opacity:.7">Ubigeo ${ub}</span><br>` +
          `<b>${valTxt}</b>${d?.label ? `<br><span style="opacity:.8">${d.label}</span>` : ''}</div>`,
          { maxWidth: 240 }
        )
        lyr.on('mouseover', () => (lyr as L.Path).setStyle({ weight: 2, color: '#fbbf24' }))
        lyr.on('mouseout', () => layer.resetStyle(lyr))
        lyr.on('click', () => onSelect?.(ub, p.NOMBDIST))
      },
    }).addTo(map)
    layerRef.current = layer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, values, theme, selected, max])

  return <div ref={ref} style={{ height }} className="w-full rounded-2xl overflow-hidden border border-ink-200 dark:border-ink-800 z-0" />
}
