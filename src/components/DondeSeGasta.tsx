import { useMemo, useState } from 'react'
import type { PorDistrito } from '../lib/types'
import { soles, solesCompact, pct, ejecucion } from '../lib/format'
import { Card, CardHeader, HelpTip, Pill } from './ui'
import { downloadCSV } from '../lib/download'

type Nivel = 'Todos' | 'GOBIERNO NACIONAL' | 'GOBIERNOS REGIONALES' | 'GOBIERNOS LOCALES'

interface Item {
  id: string
  nombre: string
  pim: number
  dev: number
  n: number
}

// Drill "¿dónde se gasta?": departamento → provincia → distrito, agregando el gasto
// distrital (por ejecutora). Los "3 ojitos" que pidió Kely.
export default function DondeSeGasta({ data, year, nivel }: { data: PorDistrito[]; year: number; nivel: Nivel }) {
  const [dep, setDep] = useState<string | undefined>(undefined) // ubigeo 2
  const [prov, setProv] = useState<string | undefined>(undefined) // ubigeo 4

  const filtradas = useMemo(() => data.filter((r) => nivel === 'Todos' || r.nivel === nivel), [data, nivel])

  // Nombres para el breadcrumb
  const depNombre = useMemo(() => (dep ? filtradas.find((r) => r.ubigeo.slice(0, 2) === dep)?.departamento : undefined), [filtradas, dep])
  const provNombre = useMemo(() => (prov ? filtradas.find((r) => r.ubigeo.slice(0, 4) === prov)?.provincia : undefined), [filtradas, prov])

  const { items, nivelLabel, hojas } = useMemo(() => {
    const m = new Map<string, Item>()
    let label = 'departamento'
    let leaf = false
    if (!dep) {
      for (const r of filtradas) {
        const id = r.ubigeo.slice(0, 2)
        const c = m.get(id) ?? { id, nombre: r.departamento, pim: 0, dev: 0, n: 0 }
        c.pim += r.pim || 0; c.dev += r.devengado || 0; c.n += 1; m.set(id, c)
      }
    } else if (!prov) {
      label = 'provincia'
      for (const r of filtradas) {
        if (r.ubigeo.slice(0, 2) !== dep) continue
        const id = r.ubigeo.slice(0, 4)
        const c = m.get(id) ?? { id, nombre: r.provincia, pim: 0, dev: 0, n: 0 }
        c.pim += r.pim || 0; c.dev += r.devengado || 0; c.n += 1; m.set(id, c)
      }
    } else {
      label = 'distrito'; leaf = true
      for (const r of filtradas) {
        if (r.ubigeo.slice(0, 4) !== prov) continue
        const c = m.get(r.ubigeo) ?? { id: r.ubigeo, nombre: r.distrito, pim: 0, dev: 0, n: 0 }
        c.pim += r.pim || 0; c.dev += r.devengado || 0; m.set(r.ubigeo, c)
      }
    }
    return { items: [...m.values()].sort((a, b) => b.pim - a.pim), nivelLabel: label, hojas: leaf }
  }, [filtradas, dep, prov])

  const totalPim = items.reduce((s, i) => s + i.pim, 0)
  const totalDev = items.reduce((s, i) => s + i.dev, 0)
  const maxPim = Math.max(1, ...items.map((i) => i.pim))

  const bajar = (id: string) => {
    if (!dep) setDep(id)
    else if (!prov) setProv(id)
    // en distrito (hoja) no baja
  }

  const descargar = () =>
    downloadCSV(
      `qhaway-donde-se-gasta-${nivelLabel}${dep ? '-' + dep : ''}${prov ? '-' + prov : ''}-${year}`,
      [
        { key: 'id', label: 'UBIGEO' },
        { key: 'nombre', label: nivelLabel.charAt(0).toUpperCase() + nivelLabel.slice(1) },
        { key: 'pim', label: 'PIM' },
        { key: 'dev', label: 'Devengado' },
      ],
      items.map((i) => ({ id: i.id, nombre: i.nombre, pim: Math.round(i.pim), dev: Math.round(i.dev) })) as Record<string, unknown>[],
    )

  return (
    <Card>
      <CardHeader
        title="¿Dónde se gasta? — departamento → provincia → distrito"
        subtitle={`Haz clic para entrar; usa las migas para volver · ${year}`}
        help={
          <HelpTip>
            Navega el gasto por territorio: clic en un departamento para ver sus provincias, y en una provincia
            para ver sus distritos. La atribución es por <strong>unidad ejecutora</strong> (dónde se administra el
            gasto), significativa sobre todo en Gobiernos Locales donde municipalidad = distrito. Descarga el nivel
            actual en CSV.
          </HelpTip>
        }
        right={
          <button onClick={descargar} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700">
            ⬇ CSV
          </button>
        }
      />
      <div className="px-4 pb-4">
        {/* Breadcrumb */}
        <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => { setDep(undefined); setProv(undefined) }} className="font-medium text-brand-600 dark:text-brand-300 hover:underline">Perú</button>
          {depNombre && (<><span className="text-ink-300">›</span>
            <button onClick={() => setProv(undefined)} className="font-medium text-brand-600 dark:text-brand-300 hover:underline">{depNombre}</button></>)}
          {provNombre && (<><span className="text-ink-300">›</span><span className="font-medium text-ink-700 dark:text-ink-200">{provNombre}</span></>)}
          <span className="ml-auto text-xs text-ink-400">{items.length} {nivelLabel}{items.length !== 1 ? 's' : ''} · PIM {solesCompact(totalPim)} · ejec {pct(ejecucion(totalDev, totalPim))}</span>
        </div>

        {/* Lista del nivel actual con barra relativa */}
        <div className="max-h-[460px] overflow-auto rounded-lg border border-ink-200 dark:border-ink-800 divide-y divide-ink-100 dark:divide-ink-800/60">
          {items.map((i) => {
            const frac = ejecucion(i.dev, i.pim)
            return (
              <button
                key={i.id}
                onClick={() => bajar(i.id)}
                disabled={hojas}
                className={`w-full text-left px-3 py-2 ${hojas ? 'cursor-default' : 'hover:bg-ink-50 dark:hover:bg-ink-800/50'} transition`}
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-ink-800 dark:text-ink-100 truncate">
                    {i.nombre}{!hojas && <span className="text-ink-400 font-normal"> · {i.n} {nivelLabel === 'departamento' ? 'distritos' : 'distritos'}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-900 dark:text-ink-50">{solesCompact(i.pim)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(i.pim / maxPim) * 100}%` }} />
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-400 tabular-nums">{soles(i.dev)} dev · {pct(frac)}</span>
                  {!hojas && <span className="shrink-0 text-brand-500">›</span>}
                </div>
              </button>
            )
          })}
          {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-400">Sin datos para este nivel.</p>}
        </div>
        <p className="mt-2 text-[11px] text-ink-400"><Pill tone="warn">aprox. por ejecutora</Pill> El monto se atribuye a la unidad ejecutora, no necesariamente al lugar físico de la obra.</p>
      </div>
    </Card>
  )
}
