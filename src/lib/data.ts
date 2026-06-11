// Carga de datos estáticos desde public/data/. Respeta el base path de Vite.
import type {
  Meta, SerieNacional, PorNivel, PorDepartamento, PorDistrito,
  PorFuncion, PorSector, FlujoFases, AltitudDistrito,
} from './types'

const BASE = import.meta.env.BASE_URL // '/qhaway-dashboard/'

const cache = new Map<string, unknown>()

export async function loadJSON<T>(path: string): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T
  const url = `${BASE}data/${path}`.replace(/\/{2,}/g, '/')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (HTTP ${res.status})`)
  const json = (await res.json()) as T
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
