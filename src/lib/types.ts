// Contrato de datos compartido entre el ETL (Python) y el frontend.
// Las rutas viven en public/data/ y se sirven estáticas desde GitHub Pages.

export type Fase = 'pia' | 'pim' | 'certificado' | 'devengado' | 'girado'

export interface FuenteDato {
  name: string
  url: string
  endpoint?: string
}

export interface Meta {
  years: number[]
  latestYear: number
  distritoYear?: number
  distritoYears?: number[]  // años con detalle distrital cargado (API VPS)
  lastUpdate: string
  fases: Fase[]
  sources: FuenteDato[]
  notas: string
  parcial?: Record<string, string>
  resourceIds?: Record<string, string>
}

export interface SerieNacional {
  year: number
  pia: number
  pim: number
  certificado?: number
  devengado: number
  girado: number
}

export interface PorNivel {
  year: number
  nivel: string
  pia: number
  pim: number
  devengado: number
  girado: number
}

export interface PorDepartamento {
  year: number
  ubigeo: string // 2 dígitos
  departamento: string
  nivel: string
  pia: number
  pim: number
  devengado: number
  girado: number
}

export interface PorDistrito {
  ubigeo: string // 6 dígitos
  departamento: string
  provincia: string
  distrito: string
  nivel: string
  pia: number
  pim: number
  devengado: number
  girado: number
}

export interface PorFuncion {
  funcion: string
  pim: number
  devengado: number
  girado: number
}

export interface PorSector {
  sector: string
  pim: number
  devengado: number
}

export interface FlujoFases {
  pia: number
  pim: number
  certificado?: number
  devengado: number
  girado: number
}

export interface AltitudDistrito {
  ubigeo: string
  altitud: number
}

export interface IndicadorDistrito {
  ubigeo: string
  pob: number
  idh: number
  pobreza: number
  pobrezaExt: number
  vulnAlim: number
  altitud: number
  // ── Acceso a servicios (Censo 2017 INEI) — OPCIONALES, "en preparación" ──
  // % de viviendas particulares con el servicio. Quedan null hasta cargar el
  // dato distrital real (REDATAM no da descarga directa; ver nota metodológica).
  agua?: number | null          // % viviendas con agua por red pública
  desague?: number | null       // % viviendas con desagüe por red pública
  electricidad?: number | null  // % viviendas con alumbrado eléctrico por red
  internet?: number | null      // % viviendas con acceso a internet
  // ── Densidad del Estado IDE-4D (reconstrucción desde Censo 2017) ──
  // Cada dimensión 0..1. "salud" es referencial (médicos/10k por movilidad).
  ideSalud?: number | null
  ideEducacion?: number | null  // asistencia neta secundaria
  ideAgua?: number | null       // % viviendas agua+saneamiento
  ideElectricidad?: number | null
}

export type NivelRiesgo = 'alta' | 'media' | 'baja'

export interface RegionRiesgo {
  id: string
  name: string
  zona: 'Costa' | 'Sierra' | 'Selva'
  ciudad: string
  lat: number
  lon: number
  pob: number
  ubigeo: string // 2 dígitos
  risks: Record<string, NivelRiesgo>
}

export interface RiesgosContext {
  sismosHistoricos: { anio: number; nombre: string; mag: number; muertos: number }[]
  ninoEventos: { anio: string; intensidad: string }[]
  glaciaresKm2: { labels: number[]; km2: number[] }
  deforestacion2023: { region: string; ha: number }[]
  damnificadosPorAnio: { anio: number; cifra: number }[]
}

export interface RiesgosData {
  lastUpdate: string
  regions: RegionRiesgo[]
  riskLabels: Record<string, string>
  context: RiesgosContext
  fuentes: { name: string; url: string }[]
}

// --- Pisos altitudinales (clasificación de Javier Pulgar Vidal) ---
export interface DistritoGeoProps {
  OBJECTID: number
  IDDIST: string
  IDDPTO: string
  IDPROV: string
  NOMBDIST: string
  NOMBPROV: string
  NOMBDEP: string
  NOM_CAP: string
  AREA_MINAM: number
}
