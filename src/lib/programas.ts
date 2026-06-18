// Categoría / Programa Presupuestal (de la Consulta Amigable del MEF, vía scraper).
// Datos nacionales por año en public/data/por-programa-historico.json.

export interface ProgramaRow {
  year: number
  code: string
  programa: string
  pia: number
  pim: number
  certificado: number
  devengado: number
  girado: number
}

// Curaduría de programas con componente AMBIENTAL / CLIMÁTICO (selección por código).
// OJO (anti-overclaiming): es una selección por programa presupuestal, NO el etiquetado
// oficial por marcadores de Río (mitigación/adaptación × directo/indirecto). Ese es el
// siguiente paso, con el dato de la metodología oficial.
export const PROGRAMAS_CLIMA: Record<string, 'nucleo' | 'relacionado'> = {
  '0057': 'nucleo', // Conservación de la diversidad biológica
  '0068': 'nucleo', // Reducción de vulnerabilidad y atención de emergencias por desastres (GRD)
  '0096': 'nucleo', // Gestión de la calidad del aire
  '0120': 'nucleo', // Remediación de pasivos ambientales mineros
  '0130': 'nucleo', // Recursos forestales y de fauna silvestre
  '0144': 'nucleo', // Conservación y uso sostenible de ecosistemas
  '0036': 'nucleo', // Gestión integral de residuos sólidos
  '0042': 'nucleo', // Aprovechamiento de recursos hídricos (uso agrario)
  '0089': 'nucleo', // Reducción de la degradación de los suelos agrarios
  '0082': 'relacionado', // Saneamiento urbano (agua/adaptación)
  '0083': 'relacionado', // Saneamiento rural
  '0046': 'relacionado', // Electrificación rural
  '0118': 'relacionado', // Hogares rurales en economías de subsistencia (adaptación)
  '0072': 'relacionado', // Desarrollo alternativo integral y sostenible
}

export function esClima(code: string): false | 'nucleo' | 'relacionado' {
  return PROGRAMAS_CLIMA[code] ?? false
}
