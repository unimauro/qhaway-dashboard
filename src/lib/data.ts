// Carga de datos estáticos desde public/data/. Respeta el base path de Vite.
import type {
  Meta, SerieNacional, PorNivel, PorDepartamento, PorDistrito,
  PorFuncion, PorSector, FlujoFases, AltitudDistrito,
} from './types'

const BASE = import.meta.env.BASE_URL // '/qhaway-dashboard/'

// API (PostgreSQL) servida en el dominio canónico. Si está caída o un año no está
// cargado aún, se cae con gracia a los JSON estáticos del repo.
// En qhaway.org el propio Caddy proxea /api/* al backend → same-origin (''), sin CORS.
// En GitHub Pages / dev se usa la URL absoluta (CORS permite unimauro.github.io).
// ÚNICO lugar donde vive el dominio de la API: el resto de la app importa de aquí.
export const API_ORIGIN = 'https://qhaway.org'
export const API_DOCS_URL = `${API_ORIGIN}/docs`
export const API_REDOC_URL = `${API_ORIGIN}/redoc`

function resolveApiBase(): string {
  if (typeof location !== 'undefined') {
    const h = location.hostname
    if (h === 'qhaway.org' || h === 'www.qhaway.org') return ''
  }
  return API_ORIGIN
}
export const API_BASE = resolveApiBase()

const cache = new Map<string, unknown>()

/** De dónde salió realmente cada archivo pedido a loadJSON (para mostrar su corte). */
export type Origen = 'api' | 'estatico'
const origenes = new Map<string, Origen>()
export const origenDe = (path: string): Origen | undefined => origenes.get(path)

// Respaldo estático distinto al nombre lógico. serie-nacional.json (estático) es una
// muestra antigua e incompleta; el respaldo bueno de la serie es la histórica oficial.
const STATIC_FALLBACK: Record<string, string> = {
  'serie-nacional.json': 'serie-historica-oficial.json',
}

/** Mapea un archivo estático a su endpoint de la API (o null si solo es estático). */
function apiEndpoint(path: string): string | null {
  if (path === 'serie-nacional.json') return 'serie-nacional'
  if (path === 'por-departamento-historico.json') return 'por-departamento-historico'
  // Datasets scrapeados (Consulta Amigable / navegador clima) — ahora también en la DB.
  // Mismo JSON que el archivo estático; si el endpoint aún no existe (404) → estático.
  if (path === 'por-programa-historico.json') return 'por-programa-historico'
  if (path === 'programa-territorio-clima.json') return 'programa-territorio-clima'
  if (path === 'clima-tematico.json') return 'clima-tematico'
  if (path === 'mitigacion-2021-2027.json') return 'mitigacion'
  if (path === 'cortes.json') return 'cortes'
  if (path === 'riesgos.json') return 'riesgos'
  let m: RegExpMatchArray | null
  if ((m = path.match(/^por-distrito-(\d{4})\.json$/))) return `por-distrito/${m[1]}`
  if ((m = path.match(/^por-funcion-(\d{4})\.json$/))) return `por-funcion/${m[1]}`
  if ((m = path.match(/^por-sector-(\d{4})\.json$/))) return `por-sector/${m[1]}`
  if ((m = path.match(/^por-nivel-(\d{4})\.json$/))) return `por-nivel/${m[1]}`
  if ((m = path.match(/^flujo-fases-(\d{4})\.json$/))) return `flujo-fases/${m[1]}`
  if ((m = path.match(/^explorador-funcion-meta-(\d{4})\.json$/))) return `explorador-funcion-meta/${m[1]}`
  if ((m = path.match(/^explorador-fuente-meta-(\d{4})\.json$/))) return `explorador-fuente-meta/${m[1]}`
  return null
}

// Timeout también en los estáticos: si el VPS sirve lento o la conexión se corta a
// mitad de un archivo grande (geojson ~1.8 MB), no dejamos el spinner colgado para siempre.
const STATIC_TIMEOUT_MS = 20000
async function fromStatic<T>(path: string): Promise<T> {
  const url = `${BASE}data/${path}`.replace(/\/{2,}/g, '/')
  const res = await fetchWithTimeout(url, STATIC_TIMEOUT_MS)
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (HTTP ${res.status})`)
  return (await res.json()) as T
}

// Si la API está lenta (p. ej. mientras se migra el histórico y el VPS está saturado),
// abortamos y caemos al JSON estático en vez de dejar el spinner colgado.
const API_TIMEOUT_MS = 6000
function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
}

export async function loadJSON<T>(path: string): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T
  const ep = apiEndpoint(path)
  if (ep) {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/${ep}`, API_TIMEOUT_MS)
      if (res.ok) {
        const json = (await res.json()) as T
        // Si la API aún no tiene ese dato cargado (arreglo u objeto vacío), usa el estático.
        const vacio = Array.isArray(json)
          ? json.length === 0
          : json == null || (typeof json === 'object' && Object.keys(json as object).length === 0)
        if (!vacio) {
          cache.set(path, json)
          origenes.set(path, 'api')
          return json
        }
      }
    } catch {
      /* API caída → fallback a estático */
    }
  }
  const alt = STATIC_FALLBACK[path]
  let json: T
  try {
    json = await fromStatic<T>(alt ?? path)
  } catch (e) {
    if (!alt) throw e
    json = await fromStatic<T>(path)
  }
  cache.set(path, json)
  origenes.set(path, 'estatico')
  return json
}

export async function loadText(path: string): Promise<string> {
  const url = `${BASE}data/${path}`.replace(/\/{2,}/g, '/')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (HTTP ${res.status})`)
  return res.text()
}

// Helpers tipados
// getMeta combina el meta estático (sources/notas/fases — no están en la API) con el
// meta VIVO de la API (years, distritoYears, lastUpdate), que se actualiza solo conforme
// la migración carga años. Si la API está caída, usa solo el estático.
export async function getMeta(): Promise<Meta> {
  if (cache.has('__meta_merged')) return cache.get('__meta_merged') as Meta
  const stat = await loadJSON<Meta>('meta.json')
  let merged = stat
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/meta`, API_TIMEOUT_MS)
    if (res.ok) {
      const live = (await res.json()) as Partial<Meta>
      merged = {
        ...stat,
        years: live.years?.length ? live.years : stat.years,
        latestYear: live.latestYear ?? stat.latestYear,
        distritoYear: live.distritoYear ?? stat.distritoYear,
        distritoYears: live.distritoYears?.length ? live.distritoYears : stat.distritoYears,
        lastUpdate: live.lastUpdate ?? stat.lastUpdate,
        // Fecha de corte por año ({"2026": "2026-11-23"}); el backend nuevo la expone.
        cortes: live.cortes ?? stat.cortes,
      }
    }
  } catch {
    /* API caída → solo estático */
  }
  cache.set('__meta_merged', merged)
  return merged
}

/* ── Helpers de meta: años y fechas de corte ── */

/** Años con detalle distrital, ascendentes (API `distritoYears`; si falta, `distritoYear`). */
export function aniosDistritales(meta: Meta): number[] {
  const ys = meta.distritoYears?.length
    ? meta.distritoYears
    : meta.distritoYear != null ? [meta.distritoYear] : []
  return [...new Set(ys)].sort((a, b) => a - b)
}

/**
 * Año distrital "por defecto". `meta.distritoYear` (estático) solo se respeta si la API lo
 * confirma en `distritoYears`; si no, el más reciente cargado; si no hay nada, latestYear.
 */
export function anioDistrital(meta: Meta): number {
  const ys = aniosDistritales(meta)
  if (meta.distritoYear != null && (!meta.distritoYears?.length || ys.includes(meta.distritoYear))) {
    return meta.distritoYear
  }
  return ys.length ? ys[ys.length - 1] : meta.latestYear
}

/** "2012–2026" (o "2025" si es uno solo, "" si no hay). */
export function rangoAnios(ys: number[]): string {
  if (!ys.length) return ''
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  return min === max ? String(min) : `${min}–${max}`
}

/**
 * Ejercicio en curso (parcial): el último año si aún no terminó o si meta lo marca parcial.
 * undefined si el último año ya está cerrado.
 */
export function anioEnCurso(meta: Meta): number | undefined {
  const y = meta.latestYear
  if (meta.parcial && String(y) in meta.parcial) return y
  return y >= new Date().getFullYear() ? y : undefined
}

/**
 * Fecha de corte de los datos de la API para un año. Soporta el formato nuevo
 * (`meta.cortes = {"2026": "2026-11-23"}`) y el antiguo (solo `lastUpdate`, que aplica
 * al año en curso). Años cerrados sin corte explícito → undefined (cierre anual).
 */
export function corteApi(meta: Meta, year: number): string | undefined {
  const c = meta.cortes?.[String(year)]
  if (c) return c
  return year === meta.latestYear ? meta.lastUpdate : undefined
}

/** Fecha de corte de un dataset scrapeado según cortes.json (API /api/cortes o estático). */
export interface CorteArchivo { fecha_corte: string; anios?: number[]; fuente?: string; generado?: string }
export async function getCortesEstaticos(): Promise<Record<string, CorteArchivo>> {
  try {
    return await loadJSON<Record<string, CorteArchivo>>('cortes.json')
  } catch {
    return {}
  }
}
/** Corte de un archivo estático; si se da `year`, solo si ese año está entre sus `anios`. */
export async function getCorte(archivo: string, year?: number): Promise<string | undefined> {
  const c = (await getCortesEstaticos())[archivo]
  if (!c) return undefined
  if (year != null && c.anios?.length && !c.anios.includes(year)) return undefined
  return c.fecha_corte
}

/**
 * Serie nacional (API /api/serie-nacional; respaldo: serie-historica-oficial.json).
 * TODAS las vistas que muestran totales nacionales deben salir de aquí.
 */
export const getSerieNacional = () => loadJSON<SerieNacional[]>('serie-nacional.json')

export interface SerieConCorte {
  serie: SerieNacional[]
  origen: Origen
  /** Fecha de corte del año (undefined = cierre anual sin fecha publicada). */
  corte: (year: number) => string | undefined
}
/** Serie nacional + de dónde salió + su fecha de corte real por año. */
export async function getSerieNacionalConCorte(): Promise<SerieConCorte> {
  const [serie, meta] = await Promise.all([getSerieNacional(), getMeta()])
  const origen = origenDe('serie-nacional.json') ?? 'estatico'
  if (origen === 'api') {
    return { serie, origen, corte: (y) => corteApi(meta, y) }
  }
  const archivo = STATIC_FALLBACK['serie-nacional.json']
  const cortes = await getCortesEstaticos()
  const c = cortes[archivo]
  const ultimo = Math.max(...serie.map((r) => r.year))
  return {
    serie,
    origen,
    corte: (y) => {
      if (!c) return undefined
      if (c.anios?.length) return c.anios.includes(y) ? c.fecha_corte : undefined
      return y === ultimo ? c.fecha_corte : undefined
    },
  }
}
export const getPorNivel = () => loadJSON<PorNivel[]>('por-nivel-gobierno.json')
// Desglose por nivel de gobierno para un año concreto (API por-nivel/{año}; 2024-2025).
export const getPorNivelYear = (year: number) => loadJSON<PorNivel[]>(`por-nivel-${year}.json`)
// OJO: por-departamento.json solo trae regional+local (subestima ~10× el total). Usamos el
// histórico por destino META, que SÍ incluye el Gobierno Nacional → PIM por región completo.
// Año objetivo: el último AÑO CERRADO presente (no el ejercicio en curso), derivado de meta.
export const getPorDepartamento = async (): Promise<PorDepartamento[]> => {
  const [hist, meta] = await Promise.all([
    loadJSON<PorDepartamento[]>('por-departamento-historico.json'),
    getMeta().catch(() => undefined),
  ])
  const presentes = [...new Set(hist.map((r) => r.year ?? 0))].sort((a, b) => b - a)
  const enCurso = meta ? anioEnCurso(meta) : undefined
  const objetivo = presentes.find((y) => y !== enCurso) ?? presentes[0]
  return hist.filter((r) => r.year === objetivo)
}
export const getPorDistrito = (year: number) => loadJSON<PorDistrito[]>(`por-distrito-${year}.json`)
export const getPorFuncion = (year: number) => loadJSON<PorFuncion[]>(`por-funcion-${year}.json`)
export const getPorSector = (year: number) => loadJSON<PorSector[]>(`por-sector-${year}.json`)
export const getFlujoFases = (year: number) => loadJSON<FlujoFases>(`flujo-fases-${year}.json`)
export const getAltitudes = () => loadJSON<AltitudDistrito[]>('altitud-distritos.json')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getGeoJSON = () => loadJSON<any>('distritos.geojson')

// Pivote OLAP en vivo (solo API; sin respaldo estático). Cruza dim×by midiendo measure por año.
export interface CuboPivot {
  year: number
  dim: string
  by: string
  measure: string
  columnas: string[]
  filas: { clave: string; total: number; valores: Record<string, number> }[]
}
export async function getCuboPivot(
  year: number,
  dim: 'funcion' | 'fuente',
  by: 'nivel' | 'departamento',
  measure: 'pim' | 'devengado',
): Promise<CuboPivot> {
  const url = `${API_BASE}/api/cubo-pivot?year=${year}&dim=${dim}&by=${by}&measure=${measure}`
  const res = await fetchWithTimeout(url, API_TIMEOUT_MS)
  if (!res.ok) throw new Error(`El pivote en vivo no está disponible (HTTP ${res.status}).`)
  return (await res.json()) as CuboPivot
}

// ── Cubo n-dimensional en vivo (/api/cubo-n) ──
// Mismo shape que CuboPivot, pero dim y by aceptan las 6 dimensiones del allow-list del
// backend (no solo función/fuente × nivel/departamento). Solo años granulares.
export type CuboDim = 'funcion' | 'fuente' | 'nivel' | 'departamento' | 'categoria_ppto' | 'tipo_gasto'
export type CuboMeasure = 'pim' | 'devengado'

export async function getCuboN(
  year: number,
  dim: CuboDim,
  by: CuboDim,
  measure: CuboMeasure,
): Promise<CuboPivot> {
  const url = `${API_BASE}/api/cubo-n?year=${year}&dim=${dim}&by=${by}&measure=${measure}`
  const res = await fetchWithTimeout(url, API_TIMEOUT_MS)
  if (!res.ok) throw new Error(`El cubo n-dimensional no está disponible (HTTP ${res.status}).`)
  return (await res.json()) as CuboPivot
}

// Valores de dimensiones + años con detalle granular, para poblar selectores del cubo-n.
// El backend expone al menos `granularYears`; el resto de campos es opcional/flexible.
export interface DimValues {
  granularYears: number[]
  values?: Partial<Record<CuboDim, string[]>>
}
export async function getDimValues(): Promise<DimValues> {
  if (cache.has('__dim_values')) return cache.get('__dim_values') as DimValues
  const res = await fetchWithTimeout(`${API_BASE}/api/dim-values`, API_TIMEOUT_MS)
  if (!res.ok) throw new Error(`No se pudieron obtener los años granulares (HTTP ${res.status}).`)
  const json = (await res.json()) as DimValues
  cache.set('__dim_values', json)
  return json
}
