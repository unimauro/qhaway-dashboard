import { useMemo, useState } from 'react'
import { Card, CardHeader, HelpTip, Pill, Select } from './ui'
import MapaDistrital from './MapaDistrital'
import { downloadCSV } from '../lib/download'

// ───────────────────────── Tipos ─────────────────────────

export interface DistritoIndic {
  ubigeo: string
  nombre: string
  provincia: string
  departamento: string
  iddpto: string
  valor: number // valor del indicador para ESTE panel
  pob: number
}

interface Props {
  /** Título del indicador, p.ej. "Desarrollo Humano (IDH)". */
  titulo: string
  subtitulo?: string
  /** Tooltip de ayuda (lectura del mapa, definición). */
  help?: React.ReactNode
  /** Distritos con el valor de ESTE indicador ya resuelto. */
  filas: DistritoIndic[]
  /** GeoJSON para el mapa. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geojson: any
  /** Formatea el valor para mostrar (p.ej. v => v.toFixed(1) o v => pct(v/100)). */
  formatValor: (v: number) => string
  /** true ⇒ valores altos son MEJORES (verde). false ⇒ valores altos son PEORES (rojo, p.ej. pobreza). */
  mayorEsMejor: boolean
  /** Etiqueta de la unidad en el mapa, p.ej. "IDH", "% pobreza". */
  unidad: string
  /** Cita de la fuente al pie, p.ej. "PNUD, IDH distrital 2019". */
  fuente: string
  /** Nota metodológica breve al pie. */
  nota?: React.ReactNode
  /** Marca el indicador con un Pill de calidad (p.ej. "referencial"). */
  caveat?: string
  /** Nombre base para exportar el ranking a CSV. */
  exportName: string
  /** Distrito seleccionado (controlado por el padre). */
  seleccionado?: string
  onSelect?: (ubigeo: string) => void
}

// Escala roja→verde por percentil dentro del propio indicador.
// Devuelve un color según la posición normalizada 0..1 (0 = peor, 1 = mejor).
function colorPorRango(norm: number): string {
  if (norm < 0.2) return '#dc2626'
  if (norm < 0.4) return '#f97316'
  if (norm < 0.6) return '#f59e0b'
  if (norm < 0.8) return '#84cc16'
  return '#16a34a'
}

export default function IndicadorPanel({
  titulo, subtitulo, help, filas, geojson, formatValor, mayorEsMejor, unidad,
  fuente, nota, caveat, exportName, seleccionado, onSelect,
}: Props) {
  const [vista, setVista] = useState<'mapa' | 'ranking'>('mapa')

  // Rango min-max para normalizar el color (sobre los distritos con dato).
  const { min, max } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const f of filas) {
      if (!Number.isFinite(f.valor)) continue
      if (f.valor < lo) lo = f.valor
      if (f.valor > hi) hi = f.valor
    }
    return { min: lo, max: hi }
  }, [filas])

  // Normaliza 0..1 con dirección (mayorEsMejor) para el color.
  const norm = (v: number): number => {
    if (!Number.isFinite(min) || max === min) return 0.5
    const t = (v - min) / (max - min)
    return mayorEsMejor ? t : 1 - t
  }

  const mapValues = useMemo(() => {
    const m = new Map<string, { value: number; label?: string; color?: string }>()
    for (const f of filas) {
      if (!Number.isFinite(f.valor)) continue
      m.set(f.ubigeo, {
        value: f.valor,
        label: `${f.nombre}: ${formatValor(f.valor)}`,
        color: colorPorRango(norm(f.valor)),
      })
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, min, max, mayorEsMejor])

  // Ranking: mejores primero (según dirección).
  const ordenados = useMemo(() => {
    const ok = filas.filter((f) => Number.isFinite(f.valor))
    return [...ok].sort((a, b) => (mayorEsMejor ? b.valor - a.valor : a.valor - b.valor))
  }, [filas, mayorEsMejor])

  const top10 = ordenados.slice(0, 10)
  const bottom10 = ordenados.slice(-10).reverse()

  const exportar = () => {
    downloadCSV(
      `qhaway-${exportName}`,
      [
        { key: 'ubigeo', label: 'ubigeo' },
        { key: 'distrito', label: 'distrito' },
        { key: 'provincia', label: 'provincia' },
        { key: 'departamento', label: 'departamento' },
        { key: 'valor', label: titulo },
        { key: 'pob', label: 'poblacion' },
      ],
      ordenados.map((f) => ({
        ubigeo: f.ubigeo,
        distrito: f.nombre,
        provincia: f.provincia,
        departamento: f.departamento,
        valor: f.valor,
        pob: f.pob,
      })),
    )
  }

  return (
    <Card>
      <CardHeader
        title={titulo}
        subtitle={subtitulo}
        help={help ? <HelpTip>{help}</HelpTip> : undefined}
        right={
          <div className="flex items-center gap-2">
            {caveat && <Pill tone="warn">{caveat}</Pill>}
            <Select
              label=""
              value={vista}
              onChange={(v) => setVista(v as 'mapa' | 'ranking')}
              options={[
                { value: 'mapa', label: 'Mapa' },
                { value: 'ranking', label: 'Ranking' },
              ]}
            />
          </div>
        }
      />

      <div className="px-4 pb-4">
        {vista === 'mapa' ? (
          <MapaDistrital
            geojson={geojson}
            values={mapValues}
            unitLabel={unidad}
            formatValue={formatValor}
            colorScale={(v) => colorPorRango(norm(v))}
            onSelect={(ubigeo) => onSelect?.(ubigeo)}
            selected={seleccionado}
            height={460}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RankingMini titulo="Mejores 10" filas={top10} formatValor={formatValor} norm={norm} colorFn={colorPorRango} unidad={unidad} />
            <RankingMini titulo="Más rezagados 10" filas={bottom10} formatValor={formatValor} norm={norm} colorFn={colorPorRango} unidad={unidad} />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-400">
            <strong>Fuente:</strong> {fuente}
            {nota && <> · {nota}</>}
          </p>
          <button
            onClick={exportar}
            className="rounded-lg border border-ink-200 dark:border-ink-800 px-2.5 py-1 text-xs font-medium text-ink-600 dark:text-ink-200 hover:bg-brand-500 hover:text-white transition"
          >
            ↓ CSV
          </button>
        </div>
      </div>
    </Card>
  )
}

function RankingMini({
  titulo, filas, formatValor, norm, colorFn, unidad,
}: {
  titulo: string
  filas: DistritoIndic[]
  formatValor: (v: number) => string
  norm: (v: number) => number
  colorFn: (n: number) => string
  unidad: string
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-ink-500 dark:text-ink-300 mb-1">{titulo}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-ink-400 border-b border-ink-200 dark:border-ink-800">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Distrito</th>
            <th className="py-1 pr-2 text-right">{unidad}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.ubigeo} className="border-b border-ink-100 dark:border-ink-800/60">
              <td className="py-1 pr-2 text-ink-400">{i + 1}</td>
              <td className="py-1 pr-2">
                <div className="font-medium text-ink-800 dark:text-ink-100">{f.nombre}</div>
                <div className="text-[11px] text-ink-400">{f.departamento}</div>
              </td>
              <td className="py-1 pr-2 text-right">
                <span
                  className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: colorFn(norm(f.valor)) }}
                >
                  {formatValor(f.valor)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
