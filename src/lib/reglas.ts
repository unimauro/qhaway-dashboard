// Reglas de calidad del dato compartidas por todas las vistas presupuestales.

/**
 * Año desde el cual el devengado y el girado son confiables en la fuente MEF.
 * 2004-2011 traen valores espurios (miles de soles en lugar de miles de millones):
 * se tratan como "sin dato", nunca como 0 ni como 0.0% de ejecución.
 */
export const DEVENGADO_DESDE = 2012

/** ¿Este devengado/girado es un dato real? (año ≥ DEVENGADO_DESDE y valor > 0). */
export function faseEjecucionValida(year: number, v: number | null | undefined): v is number {
  return year >= DEVENGADO_DESDE && v != null && Number.isFinite(v) && v > 0
}

/** Devuelve el valor si es válido, o null (sin dato). */
export function devengadoONull(year: number, v: number | null | undefined): number | null {
  return faseEjecucionValida(year, v) ? v : null
}

/** % de ejecución (devengado/PIM) o null si no hay devengado confiable o PIM. */
export function ejecucionValida(
  year: number,
  devengado: number | null | undefined,
  pim: number | null | undefined,
): number | null {
  if (!faseEjecucionValida(year, devengado) || !pim || pim <= 0) return null
  return devengado / pim
}
