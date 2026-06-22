// Carga de datos estáticos desde public/data/. Respeta el base path de Vite.
import type {
  Meta, SerieNacional, PorNivel, PorDepartamento, PorDistrito,
  PorFuncion, PorSector, FlujoFases, AltitudDistrito,
} from './types'

const BASE = import.meta.env.BASE_URL // '/qhaway-dashboard/'

// API del VPS (PostgreSQL): sirve el histórico completo por año. Si está caída o un
// año no está cargado aún, se cae con gracia a los JSON estáticos del repo.
// En qhaway.org el propio Caddy proxquea /api/* al backend → usamos same-origin (''),
// sin CORS. En GitHub Pages / dev se usa la URL absoluta del VPS (con CORS + rate limit).
function resolveApiBase(): string {
  if (typeof location !== 'undefined') {
    const h = location.hostname
    if (h === 'qhaway.org' || h === 'www.qhaway.org') return ''
  }
  return 'https://qhaway.tunky.net'
}
export const API_BASE = resolveApiBase()

const cache = new Map<string, unknown>()

/** Mapea un archivo estático a su endpoint de la API (o null si solo es estático). */
function apiEndpoint(path: string): string | null {
  if (path === 'serie-nacional.json') return 'serie-nacional'
  if (path === 'por-departamento-historico.json') return 'por-departamento-historico'
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
        // Si la API aún no tiene ese dato cargado (arreglo vacío), usa el estático.
        if (!(Array.isArray(json) && json.length === 0)) {
          cache.set(path, json)
          return json
        }
      }
    } catch {
      /* API caída → fallback a estático */
    }
  }
  const json = await fromStatic<T>(path)
  cache.set(path, json)
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
        distritoYears: live.distritoYears ?? stat.distritoYears,
        lastUpdate: live.lastUpdate ?? stat.lastUpdate,
      }
    }
  } catch {
    /* API caída → solo estático */
  }
  cache.set('__meta_merged', merged)
  return merged
}
export const getSerieNacional = () => loadJSON<SerieNacional[]>('serie-nacional.json')
export const getPorNivel = () => loadJSON<PorNivel[]>('por-nivel-gobierno.json')
// Desglose por nivel de gobierno para un año concreto (API por-nivel/{año}; 2024-2025).
export const getPorNivelYear = (year: number) => loadJSON<PorNivel[]>(`por-nivel-${year}.json`)
// OJO: por-departamento.json solo trae regional+local (subestima ~10× el total). Usamos el
// histórico por destino META, que SÍ incluye el Gobierno Nacional → PIM por región completo.
export const getPorDepartamento = async (): Promise<PorDepartamento[]> => {
  const hist = await loadJSON<PorDepartamento[]>('por-departamento-historico.json')
  const objetivo = hist.some((r) => r.year === 2025) ? 2025 : Math.max(...hist.map((r) => r.year ?? 0))
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
