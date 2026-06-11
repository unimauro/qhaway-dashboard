// Clasificación de pisos altitudinales según Javier Pulgar Vidal,
// "Las ocho regiones naturales del Perú" (1941). Rangos en metros sobre el nivel del mar.
// Para la Amazonía (Selva Alta / Rupa Rupa y Selva Baja / Omagua) la frontera altitudinal
// se cruza con la vertiente oriental: aquí usamos el criterio altitudinal estándar y marcamos
// la aproximación en la metodología (ver módulo de Inteligencia Territorial).

export interface Piso {
  id: string
  nombre: string
  quechua?: string
  min: number
  max: number
  color: string
  desc: string
}

// Orden de costa a cordillera (vertiente occidental) — la Selva se resuelve por vertiente.
export const PISOS: Piso[] = [
  { id: 'chala', nombre: 'Chala (Costa)', quechua: 'Chala', min: 0, max: 500, color: '#fcd34d', desc: 'Llanura costera, 0–500 msnm.' },
  { id: 'yunga', nombre: 'Yunga', quechua: 'Yunga', min: 500, max: 2300, color: '#fb923c', desc: 'Valles cálidos, 500–2300 msnm.' },
  { id: 'quechua', nombre: 'Quechua', quechua: 'Qhichwa', min: 2300, max: 3500, color: '#a3e635', desc: 'Clima templado, 2300–3500 msnm.' },
  { id: 'suni', nombre: 'Suni', quechua: 'Suni', min: 3500, max: 4000, color: '#34d399', desc: 'Frío, 3500–4000 msnm.' },
  { id: 'puna', nombre: 'Puna', quechua: 'Puna', min: 4000, max: 4800, color: '#22d3ee', desc: 'Altiplano frío, 4000–4800 msnm.' },
  { id: 'janca', nombre: 'Janca (Cordillera)', quechua: 'Janka', min: 4800, max: 7000, color: '#e0e7ff', desc: 'Nieves perpetuas, +4800 msnm.' },
]

// Pisos amazónicos (se asignan por vertiente oriental, no solo por altitud).
export const PISO_SELVA_ALTA: Piso = { id: 'selva_alta', nombre: 'Selva Alta (Rupa Rupa)', min: 400, max: 1000, color: '#4ade80', desc: 'Ceja de selva, 400–1000 msnm en la vertiente oriental.' }
export const PISO_SELVA_BAJA: Piso = { id: 'selva_baja', nombre: 'Selva Baja (Omagua)', min: 80, max: 400, color: '#16a34a', desc: 'Llano amazónico, 80–400 msnm.' }

export const TODOS_PISOS: Piso[] = [...PISOS, PISO_SELVA_ALTA, PISO_SELVA_BAJA]

// Departamentos predominantemente amazónicos (para resolver Selva vs Costa/Sierra
// cuando la altitud por sí sola es ambigua en la vertiente oriental).
const DEP_SELVA = new Set(['LORETO', 'UCAYALI', 'MADRE DE DIOS'])
const DEP_SELVA_PARCIAL = new Set(['AMAZONAS', 'SAN MARTIN', 'SAN MARTÍN', 'JUNIN', 'JUNÍN', 'PASCO', 'HUANUCO', 'HUÁNUCO', 'CUSCO', 'PUNO', 'AYACUCHO', 'CAJAMARCA'])

/**
 * Clasifica el piso altitudinal DOMINANTE de un distrito a partir de la altitud
 * de su capital y el departamento (para discriminar Selva).
 * Aproximación honesta del MVP: piso por altitud de la capital, no composición % por DEM.
 */
export function clasificarPiso(altitud: number | undefined, departamento: string): Piso | null {
  if (altitud === undefined || altitud === null || Number.isNaN(altitud)) return null
  const dep = (departamento || '').toUpperCase().trim()

  // Vertiente amazónica: altitud baja en departamentos de selva → Selva Baja/Alta.
  if (DEP_SELVA.has(dep) || DEP_SELVA_PARCIAL.has(dep)) {
    if (altitud < 400) return PISO_SELVA_BAJA
    if (altitud < 1000) return PISO_SELVA_ALTA
    // por encima de 1000 en estos deptos sigue la lógica andina (Yunga/Quechua/…)
  }
  for (const p of PISOS) {
    if (altitud >= p.min && altitud < p.max) return p
  }
  return altitud >= 4800 ? PISOS[PISOS.length - 1] : PISOS[0]
}
