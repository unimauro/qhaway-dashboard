/* Utilidades y tipos compartidos de la vista El Niño (src/pages/ElNino.tsx).
 * Archivo aparte para no romper fast-refresh en los componentes. */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic']

/** '2026-11-13' → '13-nov-2026' ; '2026-03' → 'mar-2026' */
export function fechaCorta(iso: string | undefined | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m) return iso
  return d ? `${d}-${MESES[m - 1]}-${y}` : `${MESES[m - 1]}-${y}`
}

// ─── mitigacion-2021-2027.json ────────────────────────────────────────────
// Tabla plana `filas` (una fila por serie × año × ámbito × categoría) + `fuentes`.
// El esquema completo está en su clave `_doc`. No se suman series distintas: el
// clasificador climático y el PP 0068 se solapan.

export interface FilaMit {
  serie: 'total_sector_publico' | 'pp0068' | 'pp0068_region' | 'clima' | 'partida_2027' | 'el_nino_2027' | 'proyecto_2027_region' | string
  anio: number
  ambito: string
  ubigeo: string
  categoria: string
  atribucion?: string | null
  pia?: number | null
  pim?: number | null
  devengado?: number | null
  avance_pct?: number | null
  pct_pia_total?: number | null
  pct_pim_total?: number | null
  estado: 'ejecucion' | 'proyecto' | 'ley' | string
  corte_tipo?: string
  verificacion?: 'consulta_amigable' | 'clasificador_clima_mef' | 'documento_oficial' | 'prensa' | string
  fuente_url?: string | null
  fecha_corte?: string | null
  nota?: string | null
}

export interface FuenteMit {
  id: string
  titulo: string
  url: string
  fecha?: string
  tipo?: string
}

export interface FilaSerie {
  year: number
  pia?: number
  /** PIM; en años sin ejecución (2027) se usa el PIA del proyecto/ley */
  pim: number
  devengado?: number
  /** true si el monto es de proyecto o ley (no ejecución) */
  proyectado?: boolean
  pctPimTotal?: number
  nota?: string
}

export interface FilaMitAd {
  year: number
  mitigacion?: number
  adaptacion?: number
  ambas?: number
  parcial?: boolean
}

export interface Mitigacion {
  noVerificado2027?: string
  fechaCorte?: string
  serie0068: FilaSerie[]
  mitAd: FilaMitAd[]
  /** PP 0068 por departamento expuesto (2021–2026) */
  regiones: { year: number; ubigeo: string; nombre: string; pim: number; devengado?: number }[]
  /** filas 2027: pp0068, total_sector_publico, partida_2027, el_nino_2027, proyecto_2027_region */
  filas2027: FilaMit[]
  fuentes: FuenteMit[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// Nombres legibles (el MEF los publica en mayúsculas y sin tildes).
const NOMBRES: Record<string, string> = {
  '02': 'Áncash', '03': 'Apurímac', '07': 'Callao', '10': 'Huánuco', '12': 'Junín', '22': 'San Martín',
}
export function nombreDepto(ubigeo: string, raw: string): string {
  if (NOMBRES[ubigeo]) return NOMBRES[ubigeo]
  return raw.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, s: string, c: string) => s + c.toUpperCase()).replace(/ De /g, ' de ')
}

export function normalizarMitigacion(raw: unknown): Mitigacion | null {
  if (!isObj(raw) || !Array.isArray(raw.filas)) return null
  const filas = (raw.filas as unknown[]).filter(isObj) as unknown as FilaMit[]
  const doc = isObj(raw._doc) ? raw._doc : {}

  const serie0068: FilaSerie[] = filas
    .filter((f) => f.serie === 'pp0068' && f.ubigeo === '00')
    .map((f) => ({
      year: f.anio,
      pia: n(f.pia),
      pim: n(f.pim) ?? n(f.pia) ?? 0,
      devengado: n(f.devengado),
      proyectado: f.estado !== 'ejecucion',
      pctPimTotal: n(f.pct_pim_total) ?? n(f.pct_pia_total),
      nota: f.nota ?? undefined,
    }))
    .filter((f) => f.pim > 0)
    .sort((a, b) => a.year - b.year)

  const mitAdMap = new Map<number, FilaMitAd>()
  filas
    .filter((f) => f.serie === 'clima' && f.ubigeo === '00' && (f.atribucion ?? 'Total') === 'Total')
    .forEach((f) => {
      const cur = mitAdMap.get(f.anio) ?? { year: f.anio }
      const v = n(f.pim) ?? n(f.pia)
      if (/^mitigaci[oó]n y adaptaci/i.test(f.categoria)) cur.ambas = v
      else if (/^mitigaci/i.test(f.categoria)) cur.mitigacion = v
      else if (/^adaptaci/i.test(f.categoria)) cur.adaptacion = v
      if (f.corte_tipo === 'parcial') cur.parcial = true
      mitAdMap.set(f.anio, cur)
    })

  const regiones = filas
    .filter((f) => f.serie === 'pp0068_region')
    .map((f) => ({ year: f.anio, ubigeo: f.ubigeo, nombre: nombreDepto(f.ubigeo, f.ambito), pim: n(f.pim) ?? 0, devengado: n(f.devengado) }))

  const fuentes = Array.isArray(raw.fuentes) ? ((raw.fuentes as unknown[]).filter(isObj) as unknown as FuenteMit[]) : []

  return {
    noVerificado2027: typeof doc.no_verificado_2027 === 'string' ? doc.no_verificado_2027 : undefined,
    fechaCorte: typeof raw.fecha_corte === 'string' ? raw.fecha_corte : undefined,
    serie0068,
    mitAd: [...mitAdMap.values()].sort((a, b) => a.year - b.year),
    regiones,
    filas2027: filas.filter((f) => f.anio === 2027),
    fuentes,
  }
}
