// Carga de datos estáticos desde public/data/. Respeta el base path de Vite.
import type {
  Meta, SerieNacional, PorNivel, PorDepartamento, PorDistrito,
  PorFuncion, PorSector, FlujoFases, AltitudDistrito,
} from './types'

const BASE = import.meta.env.BASE_URL // '/qhaway-dashboard/'

// API del VPS (PostgreSQL): sirve el histórico completo por año. Si está caída o un
// año no está cargado aún, se cae con gracia a los JSON estáticos del repo.
// Seguridad: la protege CORS (solo este origen) + rate limiting en el servidor; no se
// embebe ninguna clave en el cliente (sería pública en un sitio estático).
const API_BASE = 'https://qhaway.tunky.net'

const cache = new Map<string, unknown>()

/** Mapea un archivo estático a su endpoint de la API (o null si solo es estático). */
function apiEndpoint(path: string): string | null {
  if (path === 'serie-nacional.json') return 'serie-nacional'
  if (path === 'por-departamento-historico.json') return 'por-departamento-historico'
  let m: RegExpMatchArray | null
  if ((m = path.match(/^por-distrito-(\d{4})\.json$/))) return `por-distrito/${m[1]}`
  if ((m = path.match(/^por-funcion-(\d{4})\.json$/))) return `por-funcion/${m[1]}`
  if ((m = path.match(/^por-sector-(\d{4})\.json$/))) return `por-sector/${m[1]}`
  if ((m = path.match(/^flujo-fases-(\d{4})\.json$/))) return `flujo-fases/${m[1]}`
  if ((m = path.match(/^explorador-funcion-meta-(\d{4})\.json$/))) return `explorador-funcion-meta/${m[1]}`
  if ((m = path.match(/^explorador-fuente-meta-(\d{4})\.json$/))) return `explorador-fuente-meta/${m[1]}`
  return null
}

async function fromStatic<T>(path: string): Promise<T> {
  const url = `${BASE}data/${path}`.replace(/\/{2,}/g, '/')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (HTTP ${res.status})`)
  return (await res.json()) as T
}

export async function loadJSON<T>(path: string): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T
  const ep = apiEndpoint(path)
  if (ep) {
    try {
      const res = await fetch(`${API_BASE}/api/${ep}`)
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
export const getMeta = () => loadJSON<Meta>('meta.json')
export const getSerieNacional = () => loadJSON<SerieNacional[]>('serie-nacional.json')
export const getPorNivel = () => loadJSON<PorNivel[]>('por-nivel-gobierno.json')
export const getPorDepartamento = () => loadJSON<PorDepartamento[]>('por-departamento.json')
export const getPorDistrito = (year: number) => loadJSON<PorDistrito[]>(`por-distrito-${year}.json`)
export const getPorFuncion = (year: number) => loadJSON<PorFuncion[]>(`por-funcion-${year}.json`)
export const getPorSector = (year: number) => loadJSON<PorSector[]>(`por-sector-${year}.json`)
export const getFlujoFases = (year: number) => loadJSON<FlujoFases>(`flujo-fases-${year}.json`)
export const getAltitudes = () => loadJSON<AltitudDistrito[]>('altitud-distritos.json')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getGeoJSON = () => loadJSON<any>('distritos.geojson')
