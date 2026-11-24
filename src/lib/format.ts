// Formateo de cifras en soles, porcentajes y números, estilo Perú.

const nfSoles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 0 })
const nfNum = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 })
const nfDec = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 })

/** S/ 1,234,567 */
export const soles = (v: number | undefined | null): string =>
  v == null || Number.isNaN(v) ? '—' : nfSoles.format(v)

/** Soles compactos: S/ 1.2 mil M, S/ 345.6 M, S/ 12.3 k */
export function solesCompact(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `S/ ${nfDec.format(v / 1e9)} mil M`
  if (abs >= 1e6) return `S/ ${nfDec.format(v / 1e6)} M`
  if (abs >= 1e3) return `S/ ${nfDec.format(v / 1e3)} k`
  return `S/ ${nfNum.format(v)}`
}

export const num = (v: number | undefined | null): string =>
  v == null || Number.isNaN(v) ? '—' : nfNum.format(v)

/** 78.4% */
export function pct(v: number | undefined | null, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

/** Ejecución = devengado / pim (acotado [0,1] para color) */
export function ejecucion(devengado: number, pim: number): number {
  if (!pim) return 0
  return devengado / pim
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic']
/** '2026-11-23' → '23 nov 2026' (si no es ISO, devuelve el texto tal cual). */
export function fecha(iso: string | undefined | null): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MESES_CORTOS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}
