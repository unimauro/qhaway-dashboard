import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  getMeta, getPorFuncion, getPorDistrito, API_BASE,
} from '../lib/data'
import type { Meta, PorFuncion, PorDistrito } from '../lib/types'
import { soles, solesCompact, pct, ejecucion } from '../lib/format'
import { Card, CardHeader, HelpTip, Pill, Loading, ErrorBox } from './ui'
import { Chart } from './Chart'
import { downloadCSV } from '../lib/download'

// ── Cortes rápidos pedidos por Kely (FIEECS) ──────────────────────────────
// Dos grupos de chips: Análisis Territorial (Departamento·Provincia·Distrito)
// y Análisis Económico (Función·Categoría Presupuestal). Al elegir un corte
// se muestra el presupuesto desglosado por esa dimensión (barra + tabla + CSV)
// para el año seleccionado.

type Corte = 'departamento' | 'provincia' | 'distrito' | 'funcion' | 'categoria'

const TERRITORIAL: { value: Corte; label: string }[] = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'provincia', label: 'Provincia' },
  { value: 'distrito', label: 'Distrito' },
]
const ECONOMICO: { value: Corte; label: string }[] = [
  { value: 'funcion', label: 'Función' },
  { value: 'categoria', label: 'Categoría Presupuestal' },
]
const CORTE_LABEL: Record<Corte, string> = {
  departamento: 'departamento',
  provincia: 'provincia',
  distrito: 'distrito',
  funcion: 'función',
  categoria: 'categoría presupuestal',
}
const ES_TERRITORIAL = (c: Corte): boolean => c === 'departamento' || c === 'provincia' || c === 'distrito'

interface Fila {
  id: string
  nombre: string
  sub?: string
  pim: number
  dev: number
}

// Categoría presupuestal: solo años con detalle granular (vía API directa).
interface PorCategoria {
  nivel?: string
  categoria: string
  pim: number
  devengado: number
  girado?: number
}
async function getPorCategoria(year: number): Promise<PorCategoria[]> {
  const res = await fetch(`${API_BASE}/api/por-categoria/${year}`)
  if (!res.ok) throw new Error(`Categoría no disponible para ${year} (HTTP ${res.status}).`)
  return (await res.json()) as PorCategoria[]
}

export default function CortesPresupuesto() {
  const meta = useAsync<Meta>(getMeta, [])

  if (meta.loading) return <Card><Loading label="Cargando años disponibles…" /></Card>
  if (meta.error) return <Card><ErrorBox error={meta.error} /></Card>
  if (!meta.data) return <Card><Loading /></Card>

  return <CortesBody meta={meta.data} />
}

function CortesBody({ meta }: { meta: Meta }) {
  const years = useMemo(() => [...meta.years].sort((a, b) => b - a), [meta.years])
  const [year, setYear] = useState<number>(meta.latestYear ?? years[0])
  const [corte, setCorte] = useState<Corte>('departamento')

  // Fuentes según el grupo del corte activo (se cargan según se necesiten).
  const territorial = ES_TERRITORIAL(corte)
  const distrito = useAsync<PorDistrito[]>(
    () => (territorial ? getPorDistrito(year) : Promise.resolve([])),
    [year, territorial],
  )
  const funcion = useAsync<PorFuncion[]>(
    () => (corte === 'funcion' ? getPorFuncion(year) : Promise.resolve([])),
    [year, corte],
  )
  const categoria = useAsync<PorCategoria[]>(
    () => (corte === 'categoria' ? getPorCategoria(year) : Promise.resolve([])),
    [year, corte],
  )

  // Construye las filas del corte activo.
  const { filas, fuente } = useMemo<{
    filas: Fila[]
    fuente: 'distrito' | 'funcion' | 'categoria'
  }>(() => {
    if (corte === 'funcion') {
      const rows = (funcion.data ?? [])
        .filter((r) => (r.pim || 0) > 0)
        .map<Fila>((r) => ({ id: r.funcion, nombre: r.funcion, pim: r.pim || 0, dev: r.devengado || 0 }))
      return { filas: rows.sort((a, b) => b.pim - a.pim), fuente: 'funcion' }
    }
    if (corte === 'categoria') {
      const rows = (categoria.data ?? [])
        .filter((r) => (r.pim || 0) > 0)
        .map<Fila>((r) => ({ id: r.categoria, nombre: r.categoria, pim: r.pim || 0, dev: r.devengado || 0 }))
      return { filas: rows.sort((a, b) => b.pim - a.pim), fuente: 'categoria' }
    }
    // Territoriales: agrega el por-distrito por prefijo de ubigeo (igual que DondeSeGasta).
    const len = corte === 'departamento' ? 2 : corte === 'provincia' ? 4 : 6
    const m = new Map<string, Fila>()
    for (const r of distrito.data ?? []) {
      const id = r.ubigeo.slice(0, len)
      const nombre = corte === 'departamento' ? r.departamento : corte === 'provincia' ? r.provincia : r.distrito
      const sub = corte === 'provincia'
        ? r.departamento
        : corte === 'distrito'
          ? `${r.provincia}, ${r.departamento}`
          : undefined
      const c = m.get(id) ?? { id, nombre, sub, pim: 0, dev: 0 }
      c.pim += r.pim || 0
      c.dev += r.devengado || 0
      m.set(id, c)
    }
    return {
      filas: [...m.values()].filter((f) => f.pim > 0).sort((a, b) => b.pim - a.pim),
      fuente: 'distrito',
    }
  }, [corte, funcion.data, categoria.data, distrito.data])

  const loading = corte === 'funcion'
    ? funcion.loading
    : corte === 'categoria'
      ? categoria.loading
      : distrito.loading
  const error = corte === 'funcion'
    ? funcion.error
    : corte === 'categoria'
      ? categoria.error
      : distrito.error

  const totalPim = filas.reduce((s, f) => s + f.pim, 0)
  const totalDev = filas.reduce((s, f) => s + f.dev, 0)

  const descargar = () =>
    downloadCSV(
      `qhaway-corte-${corte}-${year}`,
      [
        { key: 'nombre', label: CORTE_LABEL[corte].charAt(0).toUpperCase() + CORTE_LABEL[corte].slice(1) },
        { key: 'pim', label: 'PIM' },
        { key: 'dev', label: 'Devengado' },
        { key: 'ejec', label: '%Ejecucion' },
      ],
      filas.map((f) => ({
        nombre: f.sub ? `${f.nombre} (${f.sub})` : f.nombre,
        pim: Math.round(f.pim),
        dev: Math.round(f.dev),
        ejec: pct(ejecucion(f.dev, f.pim)),
      })) as Record<string, unknown>[],
    )

  return (
    <Card>
      <CardHeader
        title="Cortes rápidos: análisis territorial y económico"
        subtitle={`Elige un corte para ver el presupuesto desglosado por esa dimensión · ${year}`}
        help={
          <HelpTip>
            Atajos para cortar el presupuesto del Estado por una dimensión a la vez.
            <strong> Análisis territorial</strong>: departamento, provincia o distrito
            (atribución por <strong>unidad ejecutora</strong>). <strong>Análisis económico</strong>:
            función del gasto o categoría/programa presupuestal. Cada corte muestra barra (top 15),
            tabla con PIM, devengado y % de ejecución, y descarga en CSV.
          </HelpTip>
        }
        right={
          <button
            onClick={descargar}
            disabled={filas.length === 0}
            className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
          >
            ⬇ CSV
          </button>
        }
      />

      <div className="px-4 pb-4 space-y-4">
        {/* Selector de año */}
        <YearChips years={years} value={year} onChange={setYear} />

        {/* Grupos de cortes */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
          <CorteGroup titulo="Análisis territorial" opciones={TERRITORIAL} value={corte} onChange={setCorte} />
          <CorteGroup titulo="Análisis económico" opciones={ECONOMICO} value={corte} onChange={setCorte} />
        </div>

        {/* Aviso de atribución territorial (provincia/distrito) */}
        {(corte === 'provincia' || corte === 'distrito') && (
          <p className="text-[11px] text-ink-400">
            <Pill tone="warn">aprox. por ejecutora</Pill>{' '}
            El monto se atribuye a la unidad ejecutora, no necesariamente al lugar físico de la obra.
            Es más fiel a nivel de Gobierno Local (municipalidad = distrito).
          </p>
        )}

        {/* Resumen del corte */}
        {!loading && !error && filas.length > 0 && (
          <p className="text-xs text-ink-400">
            {filas.length} {CORTE_LABEL[corte]}{filas.length !== 1 ? 's' : ''} · PIM{' '}
            <strong className="text-ink-700 dark:text-ink-200">{solesCompact(totalPim)}</strong> · ejec{' '}
            {pct(ejecucion(totalDev, totalPim))}
          </p>
        )}

        {/* Cuerpo: loading / error / empty / datos */}
        {loading ? (
          <Loading label={`Cargando ${CORTE_LABEL[corte]} ${year}…`} />
        ) : error ? (
          corte === 'categoria' ? (
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-4 text-sm text-amber-800 dark:text-amber-200">
              <Pill tone="warn">sin detalle</Pill>{' '}
              Categoría disponible solo para años con detalle granular (2025).
              Elige 2025 o cambia de corte.
            </div>
          ) : (
            <ErrorBox error={error} />
          )
        ) : filas.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-400">
            Sin datos de {CORTE_LABEL[corte]} para {year}.
          </p>
        ) : (
          <>
            <BarraCorte filas={filas} corte={corte} />
            <TablaCorte filas={filas} fuente={fuente} />
          </>
        )}
      </div>
    </Card>
  )
}

/* ── Tira de años (compacta, scrollable) ── */
function YearChips({ years, value, onChange }: { years: number[]; value: number; onChange: (y: number) => void }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400 shrink-0">Año</span>
      <div className="flex items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {years.map((y) => {
          const active = y === value
          return (
            <button
              key={y}
              type="button"
              onClick={() => onChange(y)}
              aria-pressed={active}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-sm font-semibold tabular-nums transition ${
                active ? 'bg-brand-500 text-white shadow-sm' : 'text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
              }`}
            >
              {y}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Grupo de chips de corte ── */
function CorteGroup({
  titulo, opciones, value, onChange,
}: {
  titulo: string
  opciones: { value: Corte; label: string }[]
  value: Corte
  onChange: (c: Corte) => void
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400 mb-1.5">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {opciones.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                active
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Gráfico de barras (top 15) ── */
function colorEjec(frac: number): string {
  if (frac < 0.5) return '#f87171'
  if (frac < 0.8) return '#fbbf24'
  return '#34d399'
}

function BarraCorte({ filas, corte }: { filas: Fila[]; corte: Corte }) {
  const top = filas.slice(0, 15).reverse() // mayor arriba en barra horizontal
  const cats = top.map((f) => (f.nombre.length > 34 ? f.nombre.slice(0, 33) + '…' : f.nombre))
  const data = top.map((f) => {
    const frac = ejecucion(f.dev, f.pim)
    return {
      value: f.pim,
      dev: f.dev,
      ejec: frac,
      itemStyle: { color: colorEjec(frac), borderRadius: [0, 4, 4, 0] },
    }
  })

  const option = {
    tooltip: {
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) =>
        `<b>${p.name}</b><br/>PIM: <b>${solesCompact(p.data.value)}</b><br/>Devengado: ${solesCompact(p.data.dev)}<br/>Ejecución: <b>${pct(p.data.ejec)}</b>`,
    },
    grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
    yAxis: { type: 'category', data: cats, axisLabel: { fontSize: 10, width: 130, overflow: 'truncate' } },
    series: [{
      type: 'bar',
      data,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => solesCompact(p.value) },
    }],
  }
  return <Chart option={option} height={Math.max(320, top.length * 26)} exportName={`corte-${corte}`} />
}

/* ── Tabla con PIM, devengado, %ejecución ── */
function TablaCorte({ filas, fuente }: { filas: Fila[]; fuente: 'distrito' | 'funcion' | 'categoria' }) {
  const colNombre = fuente === 'funcion' ? 'Función' : fuente === 'categoria' ? 'Categoría' : 'Territorio'
  return (
    <div className="max-h-[460px] overflow-auto rounded-lg border border-ink-200 dark:border-ink-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-50 dark:bg-ink-900 text-ink-500 dark:text-ink-400">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">{colNombre}</th>
            <th className="px-3 py-2 font-medium text-right">PIM</th>
            <th className="px-3 py-2 font-medium text-right hidden sm:table-cell">Devengado</th>
            <th className="px-3 py-2 font-medium text-right">% Ejec.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800/60">
          {filas.map((f) => {
            const frac = ejecucion(f.dev, f.pim)
            return (
              <tr key={f.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                <td className="px-3 py-2">
                  <span className="font-medium text-ink-800 dark:text-ink-100">{f.nombre}</span>
                  {f.sub && <span className="block text-[11px] text-ink-400">{f.sub}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-900 dark:text-ink-50">{soles(f.pim)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-700 dark:text-ink-200 hidden sm:table-cell">{soles(f.dev)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: colorEjec(frac) }}>{pct(frac)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
