import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getGeoJSON,
  getPorDepartamento,
  getPorSector,
  getPorFuncion,
  loadJSON,
} from '../lib/data'
import type { IndicadorDistrito, RiesgosData } from '../lib/types'
import { TODOS_PISOS, clasificarPiso } from '../lib/pisos'
import { solesCompact } from '../lib/format'

/**
 * <CommandSearch/> — Buscador global del dashboard (command palette).
 *
 * Componente autónomo: se monta una vez en el Layout. Se abre con Ctrl/Cmd+K
 * (listener global de teclado) y se cierra con Escape o clic en el overlay.
 * Indexa distritos, departamentos, sectores, funciones, pisos, riesgos y
 * secciones, y navega a la página correspondiente. Robusto: si un dataset
 * no carga, sigue funcionando con los que sí cargaron.
 */

type Cat = 'distrito' | 'departamento' | 'sector' | 'funcion' | 'piso' | 'riesgo' | 'seccion'

interface Item {
  id: string
  cat: Cat
  nombre: string
  subtitulo: string
  /** texto adicional indexable (no mostrado) */
  extra?: string
  /** ejecuta la navegación al seleccionar */
  go: (nav: ReturnType<typeof useNavigate>) => void
}

const CAT_META: Record<Cat, { label: string; icon: string; ring: string }> = {
  distrito: { label: 'Distrito', icon: '📍', ring: 'ring-teal-400/40 text-teal-600 dark:text-teal-300' },
  departamento: { label: 'Región', icon: '🗺️', ring: 'ring-sky-400/40 text-sky-600 dark:text-sky-300' },
  sector: { label: 'Sector', icon: '🏛️', ring: 'ring-indigo-400/40 text-indigo-600 dark:text-indigo-300' },
  funcion: { label: 'Función', icon: '⚙️', ring: 'ring-amber-400/40 text-amber-600 dark:text-amber-300' },
  piso: { label: 'Piso altitudinal', icon: '⛰️', ring: 'ring-emerald-400/40 text-emerald-600 dark:text-emerald-300' },
  riesgo: { label: 'Riesgo', icon: '⚠️', ring: 'ring-rose-400/40 text-rose-600 dark:text-rose-300' },
  seccion: { label: 'Sección', icon: '🧭', ring: 'ring-fuchsia-400/40 text-fuchsia-600 dark:text-fuchsia-300' },
}

// Orden de relevancia entre categorías (al empatar el score de texto).
const CAT_ORDER: Record<Cat, number> = {
  seccion: 0,
  departamento: 1,
  sector: 2,
  funcion: 3,
  piso: 4,
  riesgo: 5,
  distrito: 6,
}

/** Normaliza: minúsculas, sin tildes, sin signos extra. */
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Clases regex que casan cada vocal con su variante acentuada (para resaltar ignorando tildes).
const DEACCENT: Record<string, string> = {
  a: '[aáà]', e: '[eéè]', i: '[iíì]', o: '[oóò]', u: '[uúùü]', n: '[nñ]',
}

/** Resalta en el texto original las porciones que casan con la consulta (ignora tildes). */
function highlight(text: string, query: string): React.ReactNode {
  const tokens = norm(query).split(' ').filter(Boolean)
  if (!tokens.length) return text
  const escaped = tokens
    .map((t) =>
      t
        .split('')
        .map((c) => DEACCENT[c] ?? c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join(''),
    )
    .join('|')
  let re: RegExp
  try {
    re = new RegExp(`(${escaped})`, 'gi')
  } catch {
    return text
  }
  // split con grupo de captura: los índices impares son las coincidencias.
  const parts = text.split(re)
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-transparent font-semibold text-teal-600 dark:text-teal-300">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

/** Score: -1 si no casa; menor es mejor. startsWith < includes. */
function scoreItem(it: Item, q: string): number {
  if (!q) return CAT_ORDER[it.cat] // sin consulta: orden por categoría
  const hay = norm(it.nombre)
  const haySub = norm(it.subtitulo) + ' ' + norm(it.extra || '')
  if (hay.startsWith(q)) return CAT_ORDER[it.cat]
  // match al inicio de alguna palabra
  if (hay.split(' ').some((w) => w.startsWith(q))) return 10 + CAT_ORDER[it.cat]
  if (hay.includes(q)) return 20 + CAT_ORDER[it.cat]
  if (haySub.includes(q)) return 40 + CAT_ORDER[it.cat]
  return -1
}

export default function CommandSearch() {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Índice de items (se carga perezosamente al primer abrir).
  const [items, setItems] = useState<Item[]>([])
  const [loaded, setLoaded] = useState(false)

  // Secciones siempre disponibles (no requieren datos).
  const secciones: Item[] = useMemo(
    () => [
      { id: 'sec-inicio', cat: 'seccion', nombre: 'Inicio', subtitulo: 'Resumen general del dashboard', extra: 'home inicio panorama', go: (n) => n('/') },
      { id: 'sec-presupuesto', cat: 'seccion', nombre: 'Presupuesto', subtitulo: 'Ejecución del gasto público (SIAF-MEF)', extra: 'pim pia gasto siaf', go: (n) => n('/presupuesto') },
      { id: 'sec-pisos', cat: 'seccion', nombre: 'Pisos altitudinales', subtitulo: 'Las ocho regiones naturales (Pulgar Vidal)', extra: 'altitud regiones naturales', go: (n) => n('/pisos') },
      { id: 'sec-riesgos', cat: 'seccion', nombre: 'Riesgos', subtitulo: 'Amenazas climáticas y geológicas', extra: 'desastres clima', go: (n) => n('/riesgos') },
      { id: 'sec-prosperidad', cat: 'seccion', nombre: 'Prosperidad', subtitulo: 'IDH, pobreza y vulnerabilidad distrital', extra: 'idh pobreza bienestar', go: (n) => n('/prosperidad') },
      { id: 'sec-metodologia', cat: 'seccion', nombre: 'Metodología', subtitulo: 'Fuentes, supuestos y notas', extra: 'fuentes notas', go: (n) => n('/metodologia') },
    ],
    [],
  )

  // Carga del índice de datos (una sola vez). Cada dataset es tolerante a fallos.
  const buildIndex = useCallback(async () => {
    const out: Item[] = [...secciones]

    // Distritos (geojson) + indicadores (idh, pobreza, altitud).
    const indMap = new Map<string, IndicadorDistrito>()
    try {
      const ind = await loadJSON<IndicadorDistrito[]>('indicadores-distrito.json')
      for (const r of ind) indMap.set(r.ubigeo, r)
    } catch { /* sin indicadores: el distrito igual navega */ }

    try {
      const geo = await getGeoJSON()
      const feats: any[] = geo?.features ?? []
      for (const f of feats) {
        const p = f?.properties ?? {}
        const ubigeo: string = p.IDDIST
        const dist: string = p.NOMBDIST
        if (!ubigeo || !dist) continue
        const prov: string = p.NOMBPROV || ''
        const dep: string = p.NOMBDEP || ''
        const ind = indMap.get(ubigeo)
        const piso = ind ? clasificarPiso(ind.altitud, dep) : null
        const partes: string[] = []
        if (ind) {
          if (Number.isFinite(ind.idh)) partes.push(`IDH ${ind.idh.toFixed(1)}`)
          if (Number.isFinite(ind.pobreza)) partes.push(`pobreza ${ind.pobreza.toFixed(0)}%`)
          if (Number.isFinite(ind.altitud)) partes.push(`${Math.round(ind.altitud).toLocaleString('es-PE')} msnm`)
          if (piso) partes.push(piso.nombre)
        }
        const sub = `Distrito · ${[prov, dep].filter(Boolean).join(', ')}`
        out.push({
          id: `dist-${ubigeo}`,
          cat: 'distrito',
          nombre: dist,
          subtitulo: partes.length ? `${sub} · ${partes.join(' · ')}` : sub,
          extra: `${prov} ${dep} ${ubigeo}`,
          go: (n) => n(`/prosperidad?d=${ubigeo}`),
        })
      }
    } catch { /* sin geojson: se omiten distritos */ }

    // Departamentos / regiones (agregando PIM de todos los niveles).
    try {
      const deps = await getPorDepartamento()
      const agg = new Map<string, { dep: string; ubigeo: string; pim: number }>()
      for (const d of deps) {
        const cur = agg.get(d.departamento) ?? { dep: d.departamento, ubigeo: d.ubigeo, pim: 0 }
        cur.pim += d.pim || 0
        agg.set(d.departamento, cur)
      }
      for (const v of agg.values()) {
        out.push({
          id: `dep-${v.ubigeo}`,
          cat: 'departamento',
          nombre: v.dep,
          subtitulo: `Región · ${solesCompact(v.pim)} PIM`,
          extra: v.ubigeo,
          go: (n) => n(`/presupuesto?dep=${v.ubigeo}`),
        })
      }
    } catch { /* sin departamentos */ }

    // Sectores.
    try {
      const secs = await getPorSector(2025)
      for (const s of secs) {
        out.push({
          id: `sec-data-${s.sector}`,
          cat: 'sector',
          nombre: s.sector,
          subtitulo: `Sector · ${solesCompact(s.pim)} PIM`,
          go: (n) => n('/presupuesto'),
        })
      }
    } catch { /* sin sectores */ }

    // Funciones.
    try {
      const funcs = await getPorFuncion(2025)
      for (const fn of funcs) {
        out.push({
          id: `fun-${fn.funcion}`,
          cat: 'funcion',
          nombre: fn.funcion,
          subtitulo: `Función · ${solesCompact(fn.pim)} PIM`,
          go: (n) => n('/presupuesto'),
        })
      }
    } catch { /* sin funciones */ }

    // Pisos altitudinales.
    for (const piso of TODOS_PISOS) {
      out.push({
        id: `piso-${piso.id}`,
        cat: 'piso',
        nombre: piso.nombre,
        subtitulo: `Piso altitudinal · ${piso.desc}`,
        extra: piso.quechua || '',
        go: (n) => n('/pisos'),
      })
    }

    // Riesgos (etiquetas).
    try {
      const r = await loadJSON<RiesgosData>('riesgos.json')
      for (const [key, label] of Object.entries(r.riskLabels || {})) {
        out.push({
          id: `risk-${key}`,
          cat: 'riesgo',
          nombre: label,
          subtitulo: 'Riesgo · amenaza territorial',
          extra: key,
          go: (n) => n('/riesgos'),
        })
      }
    } catch { /* sin riesgos */ }

    setItems(out)
    setLoaded(true)
  }, [secciones])

  // Abrir / cerrar con teclado global.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isToggle = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)
      if (isToggle) {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // También permitir que el header lo abra disparando este evento personalizado.
  useEffect(() => {
    const openHandler = () => setOpen(true)
    window.addEventListener('qhaway:open-search', openHandler)
    return () => window.removeEventListener('qhaway:open-search', openHandler)
  }, [])

  // Al abrir: cargar índice (perezoso), enfocar input, resetear estado.
  useEffect(() => {
    if (!open) return
    setActive(0)
    if (!loaded) void buildIndex()
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    // Bloquea el scroll del fondo mientras está abierto.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open, loaded, buildIndex])

  // Resultados filtrados y ordenados (máx 10 visibles, lista scrollable).
  const results = useMemo(() => {
    const q = norm(query)
    const scored: { it: Item; s: number }[] = []
    for (const it of items.length ? items : secciones) {
      const s = scoreItem(it, q)
      if (s >= 0) scored.push({ it, s })
    }
    scored.sort((a, b) => (a.s - b.s) || a.it.nombre.localeCompare(b.it.nombre, 'es'))
    return scored.slice(0, 30).map((x) => x.it)
  }, [query, items, secciones])

  // Mantén `active` dentro de rango cuando cambian los resultados.
  useEffect(() => {
    setActive((a) => (results.length ? Math.min(a, results.length - 1) : 0))
  }, [results.length])

  const choose = useCallback(
    (it: Item | undefined) => {
      if (!it) return
      setOpen(false)
      setQuery('')
      it.go(nav)
    },
    [nav],
  )

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (results.length ? (a + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Auto-scroll del item activo dentro de la lista.
  useEffect(() => {
    const ul = listRef.current
    if (!ul) return
    const el = ul.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Buscador global"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Caja central */}
      <div className="relative mt-[8vh] w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* Input */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-700">
          <span className="text-slate-400" aria-hidden>🔎</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onInputKey}
            placeholder="Busca distritos, regiones, sectores, pisos, riesgos…"
            className="w-full bg-transparent py-3.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            aria-label="Texto de búsqueda"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline dark:border-slate-600 dark:text-slate-400">
            Esc
          </kbd>
        </div>

        {/* Resultados */}
        <ul
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto py-1"
          role="listbox"
          aria-label="Resultados"
        >
          {!loaded && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">Cargando índice…</li>
          )}
          {loaded && results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">
              Sin resultados para “{query}”.
            </li>
          )}
          {results.map((it, i) => {
            const meta = CAT_META[it.cat]
            const isActive = i === active
            return (
              <li key={it.id} data-idx={i} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(it)}
                  className={
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ' +
                    (isActive
                      ? 'bg-teal-50 dark:bg-teal-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60')
                  }
                >
                  <span
                    className={
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ring-1 ' +
                      meta.ring +
                      ' bg-slate-50 dark:bg-slate-800'
                    }
                    aria-hidden
                  >
                    {meta.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {highlight(it.nombre, query)}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {it.subtitulo}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {meta.label}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {/* Pie con ayuda de teclas */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">↑</kbd>
            <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">↓</kbd>
            navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">Enter</kbd>
            abrir
          </span>
          <span className="hidden sm:inline">
            {results.length} resultado{results.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  )
}
