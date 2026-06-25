import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { soles, solesCompact, pct, ejecucion } from '../lib/format'
import { Card, CardHeader, HelpTip, Pill, Select, Loading } from './ui'
import { Chart } from '../components/Chart'
import { downloadCSV } from '../lib/download'

/* ───────────────────────── API (resolución local, sin importar de data.ts) ───────────────────────── */

function resolveApiBase(): string {
  if (typeof location !== 'undefined') {
    const h = location.hostname
    if (h === 'qhaway.org' || h === 'www.qhaway.org') return ''
  }
  return 'https://qhaway.tunky.net'
}
const API_BASE = resolveApiBase()
const API_TIMEOUT_MS = 8000

/** Resultado de un fetch tolerante: distingue 404 (función en preparación) de error real. */
type FetchState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'empty' }       // 200 pero sin filas
  | { status: 'missing' }     // 404 / endpoint no desplegado aún
  | { status: 'error'; msg: string }

async function apiJSON<T>(path: string, signal: AbortSignal): Promise<{ kind: 'ok'; data: T } | { kind: 'missing' } | { kind: 'error'; msg: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal })
    if (res.status === 404) return { kind: 'missing' }
    if (!res.ok) return { kind: 'error', msg: `HTTP ${res.status}` }
    return { kind: 'ok', data: (await res.json()) as T }
  } catch (e) {
    if (signal.aborted) return { kind: 'error', msg: 'timeout' }
    return { kind: 'error', msg: e instanceof Error ? e.message : 'fallo de red' }
  }
}

/** Hook genérico de carga tolerante a 404. */
function useApi<T>(path: string | null, deps: unknown[]): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ status: 'loading' })
  useEffect(() => {
    if (path == null) { setState({ status: 'empty' }); return }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    setState({ status: 'loading' })
    apiJSON<T>(path, ctrl.signal).then((r) => {
      clearTimeout(t)
      if (ctrl.signal.aborted) return
      if (r.kind === 'missing') setState({ status: 'missing' })
      else if (r.kind === 'error') setState({ status: 'error', msg: r.msg })
      else if (Array.isArray(r.data) && r.data.length === 0) setState({ status: 'empty' })
      else setState({ status: 'ok', data: r.data })
    })
    return () => { clearTimeout(t); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

/* ───────────────────────── Tipos del contrato ───────────────────────── */

interface DimValor { valor: string }
interface DimDepto { ubigeo: string; valor: string }
interface DimValues {
  categoria_ppto: DimValor[]
  tipo_gasto: DimValor[]
  funcion: DimValor[]
  nivel: DimValor[]
  departamento: DimDepto[]
  granularYears: number[]
}
interface PorCategoria { nivel: string; categoria: string; pim: number; devengado: number; girado: number }
interface PorDistritoRow {
  ubigeo: string
  departamento: string
  provincia: string
  distrito: string
  nivel: string
  pim: number
  devengado: number
  girado?: number
}

/* ───────────────────────── Modelo del drill ───────────────────────── */

// Pasos de la jerarquía. Cada paso muestra los "hijos" del nivel anterior.
type Step = 'nivel' | 'categoria' | 'funcion' | 'departamento' | 'provincia' | 'distrito'
const STEP_ORDER: Step[] = ['nivel', 'categoria', 'funcion', 'departamento', 'provincia', 'distrito']
const STEP_LABEL: Record<Step, string> = {
  nivel: 'Nivel de gobierno',
  categoria: 'Categoría presupuestal',
  funcion: 'Función',
  departamento: 'Departamento',
  provincia: 'Provincia',
  distrito: 'Distrito',
}
const STEP_SINGULAR: Record<Step, string> = {
  nivel: 'nivel', categoria: 'categoría', funcion: 'función',
  departamento: 'departamento', provincia: 'provincia', distrito: 'distrito',
}

interface Row { id: string; nombre: string; pim: number; dev: number; n: number }

const NIVELES_FIJOS = ['GOBIERNO NACIONAL', 'GOBIERNOS REGIONALES', 'GOBIERNOS LOCALES']

/* ───────────────────────── Componente ───────────────────────── */

export default function DrillPresupuesto() {
  // Dimensiones para selectores
  const dims = useApi<DimValues>('/api/dim-values', [])

  // Año: por defecto el último granular si existe; si no, 2025.
  const granularYears = dims.status === 'ok' ? (dims.data.granularYears ?? []) : []
  const defaultYear = granularYears.length ? Math.max(...granularYears) : 2025
  const [year, setYear] = useState<number>(defaultYear)
  // sincroniza el año por defecto cuando llegan las dimensiones
  useEffect(() => {
    if (dims.status === 'ok' && granularYears.length && !granularYears.includes(year)) {
      setYear(Math.max(...granularYears))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.status])

  // Filtros globales
  const [fNivel, setFNivel] = useState<string>('Todos')
  const [fCategoria, setFCategoria] = useState<string>('Todas')
  const [fTipoGasto, setFTipoGasto] = useState<string>('Todos')
  const [fFuncion, setFFuncion] = useState<string>('Todas')

  // Pila de navegación: cada entrada es {step, id, nombre} del valor elegido en ese paso.
  const [path, setPath] = useState<{ step: Step; id: string; nombre: string }[]>([])

  // El paso ACTUAL es el siguiente al último de la pila.
  const currentStep: Step = STEP_ORDER[path.length] ?? 'distrito'
  const isLeaf = currentStep === 'distrito' && path.length >= STEP_ORDER.length - 1

  // Selecciones efectivas (combinan filtros globales + ruta navegada)
  const sel = useMemo(() => {
    const get = (s: Step) => path.find((p) => p.step === s)?.nombre
    return {
      nivel: get('nivel') ?? (fNivel !== 'Todos' ? fNivel : undefined),
      categoria: get('categoria') ?? (fCategoria !== 'Todas' ? fCategoria : undefined),
      funcion: get('funcion') ?? (fFuncion !== 'Todas' ? fFuncion : undefined),
      departamentoUbigeo: path.find((p) => p.step === 'departamento')?.id,
      provinciaUbigeo: path.find((p) => p.step === 'provincia')?.id,
    }
  }, [path, fNivel, fCategoria, fFuncion])

  /* ── Carga de datos según el paso territorial vs. presupuestal ──
     - 'categoria' usa /api/por-categoria/{year}
     - 'departamento'/'provincia'/'distrito' usan /api/por-distrito/{year}
     - 'nivel' se deriva de cualquiera de los dos (lista fija)
     - 'funcion' usa la dimensión (dim-values) como lista, sin medida cruzada → aviso
  */
  const needCategoria = currentStep === 'categoria'
  const needDistrito = currentStep === 'departamento' || currentStep === 'provincia' || currentStep === 'distrito'

  const cat = useApi<PorCategoria[]>(needCategoria ? `/api/por-categoria/${year}` : null, [needCategoria, year])
  const dist = useApi<PorDistritoRow[]>(needDistrito ? `/api/por-distrito/${year}` : null, [needDistrito, year])

  // Para el paso 'nivel' tomamos los niveles fijos (siempre disponibles).
  // Para el total mostramos, si tenemos categoria/distrito cargado, el agregado por nivel.
  const nivelSource = useApi<PorCategoria[]>(currentStep === 'nivel' ? `/api/por-categoria/${year}` : null, [currentStep, year])

  /* ── Construcción de las filas del nivel actual ── */
  const built = useMemo<{ rows: Row[]; note?: string; missing?: boolean }>(() => {
    const filtNivel = (n: string) => !sel.nivel || n === sel.nivel

    if (currentStep === 'nivel') {
      // Agrega por nivel de gobierno. Usa categoria como fuente de medida si está; si no, lista fija.
      if (nivelSource.status === 'missing') return { rows: [], missing: true }
      const m = new Map<string, Row>()
      const src = nivelSource.status === 'ok' ? nivelSource.data : []
      for (const r of src) {
        const c = m.get(r.nivel) ?? { id: r.nivel, nombre: r.nivel, pim: 0, dev: 0, n: 0 }
        c.pim += r.pim || 0; c.dev += r.devengado || 0; c.n += 1; m.set(r.nivel, c)
      }
      // Garantiza que aparezcan los 3 niveles aunque la API no los traiga.
      for (const n of NIVELES_FIJOS) if (!m.has(n)) m.set(n, { id: n, nombre: n, pim: 0, dev: 0, n: 0 })
      return { rows: [...m.values()].sort((a, b) => b.pim - a.pim) }
    }

    if (currentStep === 'categoria') {
      if (cat.status === 'missing') return { rows: [], missing: true }
      if (cat.status !== 'ok') return { rows: [] }
      const m = new Map<string, Row>()
      for (const r of cat.data) {
        if (!filtNivel(r.nivel)) continue
        const c = m.get(r.categoria) ?? { id: r.categoria, nombre: r.categoria, pim: 0, dev: 0, n: 0 }
        c.pim += r.pim || 0; c.dev += r.devengado || 0; c.n += 1; m.set(r.categoria, c)
      }
      return { rows: [...m.values()].sort((a, b) => b.pim - a.pim) }
    }

    if (currentStep === 'funcion') {
      // No hay endpoint que cruce función×(nivel+categoría) con medida garantizada.
      // Mostramos la lista de funciones de la dimensión y dejamos avanzar al territorio.
      const fns = dims.status === 'ok' ? dims.data.funcion : []
      const rows: Row[] = fns.map((f) => ({ id: f.valor, nombre: f.valor, pim: 0, dev: 0, n: 0 }))
      return {
        rows: rows.sort((a, b) => a.nombre.localeCompare(b.nombre)),
        note: 'La función se muestra como dimensión de navegación; el desglose territorial de abajo no se recalcula por función (no hay tabla cruzada función×territorio). Elige una y continúa, o sáltala.',
      }
    }

    // Territoriales: por-distrito
    if (dist.status === 'missing') return { rows: [], missing: true }
    if (dist.status !== 'ok') return { rows: [] }
    const rowsAll = dist.data.filter((r) => filtNivel(r.nivel))

    if (currentStep === 'departamento') {
      const m = new Map<string, Row>()
      for (const r of rowsAll) {
        const id = r.ubigeo.slice(0, 2)
        const c = m.get(id) ?? { id, nombre: r.departamento, pim: 0, dev: 0, n: 0 }
        c.pim += r.pim || 0; c.dev += r.devengado || 0; c.n += 1; m.set(id, c)
      }
      return { rows: [...m.values()].sort((a, b) => b.pim - a.pim) }
    }
    if (currentStep === 'provincia') {
      const dep = sel.departamentoUbigeo
      const m = new Map<string, Row>()
      for (const r of rowsAll) {
        if (dep && r.ubigeo.slice(0, 2) !== dep) continue
        const id = r.ubigeo.slice(0, 4)
        const c = m.get(id) ?? { id, nombre: r.provincia, pim: 0, dev: 0, n: 0 }
        c.pim += r.pim || 0; c.dev += r.devengado || 0; c.n += 1; m.set(id, c)
      }
      return { rows: [...m.values()].sort((a, b) => b.pim - a.pim) }
    }
    // distrito (hoja)
    const prov = sel.provinciaUbigeo
    const m = new Map<string, Row>()
    for (const r of rowsAll) {
      if (prov && r.ubigeo.slice(0, 4) !== prov) continue
      const c = m.get(r.ubigeo) ?? { id: r.ubigeo, nombre: r.distrito, pim: 0, dev: 0, n: 0 }
      c.pim += r.pim || 0; c.dev += r.devengado || 0; c.n += 1; m.set(r.ubigeo, c)
    }
    return { rows: [...m.values()].sort((a, b) => b.pim - a.pim) }
  }, [currentStep, cat, dist, nivelSource, dims, sel])

  const rows = built.rows
  const totalPim = rows.reduce((s, r) => s + r.pim, 0)
  const totalDev = rows.reduce((s, r) => s + r.dev, 0)
  const maxPim = Math.max(1, ...rows.map((r) => r.pim))

  /* ── Estado de carga del paso actual ── */
  const activeState: FetchState<unknown> =
    currentStep === 'nivel' ? nivelSource
    : currentStep === 'categoria' ? cat
    : currentStep === 'funcion' ? dims
    : dist
  const loading = activeState.status === 'loading'
  const missing = built.missing || activeState.status === 'missing'
  const errored = activeState.status === 'error'

  /* ── Navegación ── */
  const bajar = useCallback((r: Row) => {
    if (isLeaf) return
    setPath((p) => [...p, { step: currentStep, id: r.id, nombre: r.nombre }])
  }, [currentStep, isLeaf])

  const irA = useCallback((depth: number) => {
    setPath((p) => p.slice(0, depth))
  }, [])

  const volver = useCallback(() => setPath((p) => p.slice(0, -1)), [])

  // Reset de la ruta al cambiar de año o filtros de cabecera
  useEffect(() => { setPath([]) }, [year, fNivel, fCategoria, fTipoGasto, fFuncion])

  /* ── Año granular: ¿pidió un año sin detalle? ── */
  const granularKnown = granularYears.length > 0
  const yearTieneGranular = !granularKnown || granularYears.includes(year)
  const necesitaGranular = currentStep === 'nivel' || currentStep === 'categoria'

  /* ── Selectores ── */
  const yearOpts = useMemo(() => {
    const ys = granularYears.length ? [...granularYears] : [defaultYear]
    return ys.sort((a, b) => b - a).map((y) => ({ value: y, label: String(y) }))
  }, [granularYears, defaultYear])

  const nivelOpts = useMemo(() => {
    const base = dims.status === 'ok' && dims.data.nivel.length
      ? dims.data.nivel.map((n) => n.valor)
      : NIVELES_FIJOS
    return [{ value: 'Todos', label: 'Todos los niveles' }, ...base.map((v) => ({ value: v, label: niceNivel(v) }))]
  }, [dims])
  const categoriaOpts = useMemo(() => {
    const base = dims.status === 'ok' ? dims.data.categoria_ppto.map((c) => c.valor) : []
    return [{ value: 'Todas', label: 'Todas las categorías' }, ...base.map((v) => ({ value: v, label: v }))]
  }, [dims])
  const tipoGastoOpts = useMemo(() => {
    const base = dims.status === 'ok' ? dims.data.tipo_gasto.map((t) => t.valor) : []
    return [{ value: 'Todos', label: 'Todos los tipos de gasto' }, ...base.map((v) => ({ value: v, label: v }))]
  }, [dims])
  const funcionOpts = useMemo(() => {
    const base = dims.status === 'ok' ? dims.data.funcion.map((f) => f.valor) : []
    return [{ value: 'Todas', label: 'Todas las funciones' }, ...base.map((v) => ({ value: v, label: v }))]
  }, [dims])

  /* ── CSV del nivel actual ── */
  const descargar = () => {
    const rutaTxt = path.map((p) => p.nombre).join('-').replace(/\s+/g, '_').slice(0, 60)
    downloadCSV(
      `qhaway-drill-${currentStep}${rutaTxt ? '-' + rutaTxt : ''}-${year}`,
      [
        { key: 'id', label: 'ID' },
        { key: 'nombre', label: STEP_LABEL[currentStep] },
        { key: 'pim', label: 'PIM' },
        { key: 'dev', label: 'Devengado' },
        { key: 'ejec', label: '% Ejecución' },
      ],
      rows.map((r) => ({
        id: r.id, nombre: r.nombre, pim: Math.round(r.pim), dev: Math.round(r.dev),
        ejec: pct(ejecucion(r.dev, r.pim)),
      })) as Record<string, unknown>[],
    )
  }

  const territorial = currentStep === 'departamento' || currentStep === 'provincia' || currentStep === 'distrito'

  return (
    <Card>
      <CardHeader
        title="Explorador de presupuesto — drill jerárquico"
        subtitle={`Nacional → nivel → categoría → función → departamento → provincia → distrito · ${year}`}
        help={
          <HelpTip>
            Navega el presupuesto encadenando niveles: haz clic en una fila para profundizar y usa
            las migas (o «volver») para retroceder. Cada paso muestra el <strong>PIM</strong> y el
            <strong> devengado</strong> de sus hijos. Los pasos de categoría y nivel solo existen para
            los años con detalle granular (p. ej. 2025). El desglose territorial es por
            <strong> unidad ejecutora</strong>, no por lugar de obra.
          </HelpTip>
        }
        right={
          <button
            onClick={descargar}
            disabled={rows.length === 0}
            className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
          >
            ⬇ CSV
          </button>
        }
      />

      <div className="px-4 pb-4">
        {/* Filtros */}
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50/60 dark:bg-ink-900/40 px-3 py-2">
          <Select<number> value={year} onChange={setYear} options={yearOpts} label="Año" />
          <Select<string> value={fNivel} onChange={setFNivel} options={nivelOpts} label="Nivel" />
          <Select<string> value={fCategoria} onChange={setFCategoria} options={categoriaOpts} label="Categoría" />
          <Select<string> value={fTipoGasto} onChange={setFTipoGasto} options={tipoGastoOpts} label="Tipo de gasto" />
          <Select<string> value={fFuncion} onChange={setFFuncion} options={funcionOpts} label="Función" />
        </div>

        {/* Aviso de año sin granularidad */}
        {granularKnown && !yearTieneGranular && necesitaGranular && (
          <p className="mb-3 text-xs">
            <Pill tone="warn">año sin detalle</Pill>{' '}
            <span className="text-ink-400">
              El desglose por nivel y categoría solo está disponible para {granularYears.join(', ')}.
              Para {year} ese detalle no existe; cambia de año arriba.
            </span>
          </p>
        )}

        {/* Breadcrumb */}
        <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
          <button
            onClick={() => irA(0)}
            className="font-medium text-brand-600 dark:text-brand-300 hover:underline"
          >
            Inicio
          </button>
          {path.map((p, i) => (
            <span key={p.step} className="inline-flex items-center gap-1">
              <span className="text-ink-300">›</span>
              {i < path.length - 1 ? (
                <button
                  onClick={() => irA(i + 1)}
                  className="font-medium text-brand-600 dark:text-brand-300 hover:underline"
                  title={STEP_LABEL[p.step]}
                >
                  {niceNivel(p.nombre)}
                </button>
              ) : (
                <span className="font-medium text-ink-700 dark:text-ink-200" title={STEP_LABEL[p.step]}>
                  {niceNivel(p.nombre)}
                </span>
              )}
            </span>
          ))}
          <span className="ml-auto inline-flex items-center gap-2">
            {path.length > 0 && (
              <button
                onClick={volver}
                className="rounded-md border border-ink-200 dark:border-ink-700 px-2 py-0.5 text-xs text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800 transition"
              >
                ← Volver
              </button>
            )}
            <span className="text-xs text-ink-400">
              {rows.length} {STEP_SINGULAR[currentStep]}{rows.length !== 1 ? 's' : ''}
              {totalPim > 0 && <> · PIM {solesCompact(totalPim)} · ejec {pct(ejecucion(totalDev, totalPim))}</>}
            </span>
          </span>
        </div>

        {/* Nota del paso (p. ej. función como dimensión) */}
        {built.note && (
          <p className="mb-3 text-[11px] text-ink-400">
            <Pill tone="neutral">nota</Pill> {built.note}
          </p>
        )}

        {/* Cuerpo: loading / missing / error / empty / datos */}
        {loading ? (
          <Loading label={`Cargando ${STEP_SINGULAR[currentStep]}s ${year}…`} />
        ) : missing ? (
          <EnPreparacion step={currentStep} />
        ) : errored ? (
          <p className="px-3 py-8 text-center text-sm text-ink-400">
            <Pill tone="warn">no disponible</Pill> No se pudo cargar este nivel ahora mismo. Intenta cambiar de año o reintenta en un momento.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-ink-400">Sin datos para este nivel con los filtros actuales.</p>
        ) : (
          <>
            {/* Mini gráfico de barras (top 12) */}
            {rows.some((r) => r.pim > 0) && (
              <div className="mb-3">
                <BarrasNivel rows={rows} step={currentStep} year={year} />
              </div>
            )}

            {/* Tabla clicable */}
            <div className="max-h-[460px] overflow-auto rounded-lg border border-ink-200 dark:border-ink-800 divide-y divide-ink-100 dark:divide-ink-800/60">
              {rows.map((r) => {
                const frac = ejecucion(r.dev, r.pim)
                return (
                  <button
                    key={r.id}
                    onClick={() => bajar(r)}
                    disabled={isLeaf}
                    className={`w-full text-left px-3 py-2 ${isLeaf ? 'cursor-default' : 'hover:bg-ink-50 dark:hover:bg-ink-800/50'} transition`}
                  >
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-ink-800 dark:text-ink-100 truncate">
                        {niceNivel(r.nombre)}
                        {!isLeaf && r.n > 0 && currentStep !== 'categoria' && currentStep !== 'nivel' && (
                          <span className="text-ink-400 font-normal"> · {r.n} reg.</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-900 dark:text-ink-50">{solesCompact(r.pim)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.pim / maxPim) * 100}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] text-ink-400 tabular-nums">
                        {r.pim > 0 ? <>{soles(r.dev)} dev · {pct(frac)}</> : 'dimensión'}
                      </span>
                      {!isLeaf && <span className="shrink-0 text-brand-500">›</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* Atribución territorial */}
        {territorial && (
          <p className="mt-2 text-[11px] text-ink-400">
            <Pill tone="warn">aprox. por ejecutora</Pill> Provincia y distrito reflejan la
            <strong> unidad ejecutora</strong> (dónde se administra el gasto), no necesariamente el
            lugar físico donde se ejecuta la obra.
          </p>
        )}
      </div>
    </Card>
  )
}

/* ───────────────────────── Subcomponentes ───────────────────────── */

function EnPreparacion({ step }: { step: Step }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-ink-400">
      <Pill tone="neutral">función en preparación</Pill>
      <p className="mt-2 max-w-md mx-auto">
        El desglose por <strong>{STEP_SINGULAR[step]}</strong> aún no está publicado en el servidor
        (el endpoint responde 404). Esta vista se activará en cuanto el backend lo despliegue; el
        resto del explorador sigue funcionando.
      </p>
    </div>
  )
}

function BarrasNivel({ rows, step, year }: { rows: Row[]; step: Step; year: number }) {
  const top = rows.filter((r) => r.pim > 0).slice(0, 12).reverse()
  if (top.length === 0) return null
  const cats = top.map((r) => niceNivel(r.nombre))
  const vals = top.map((r) => ({
    value: r.pim,
    dev: r.dev,
    ejec: ejecucion(r.dev, r.pim),
    itemStyle: { color: colorEjec(ejecucion(r.dev, r.pim)), borderRadius: [0, 4, 4, 0] as [number, number, number, number] },
  }))
  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        const d = p.data
        return `<b>${p.name}</b><br>PIM: <b>${solesCompact(d.value)}</b><br>Devengado: <b>${solesCompact(d.dev)}</b><br>Ejecución: <b>${pct(d.ejec)}</b>`
      },
    },
    grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
    yAxis: { type: 'category', data: cats, axisLabel: { fontSize: 10, width: 130, overflow: 'truncate' } },
    series: [
      {
        type: 'bar',
        data: vals,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => solesCompact(p.value) },
      },
    ],
  }
  return <Chart option={option} height={Math.max(180, top.length * 26)} exportName={`drill-${step}-${year}`} />
}

/* ───────────────────────── Helpers de presentación ───────────────────────── */

function niceNivel(s: string): string {
  switch (s) {
    case 'GOBIERNO NACIONAL': return 'Gobierno Nacional'
    case 'GOBIERNOS REGIONALES': return 'Gobiernos Regionales'
    case 'GOBIERNOS LOCALES': return 'Gobiernos Locales'
    default: return s
  }
}

function colorEjec(frac: number): string {
  if (frac < 0.5) return '#f87171'
  if (frac < 0.8) return '#fbbf24'
  return '#34d399'
}
