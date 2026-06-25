import type { ReactNode } from 'react'
import { Card, CardHeader, Pill } from './ui'

interface Props {
  titulo: string
  subtitulo?: string
  /** Fuente prevista (aún no cargada). */
  fuentePrevista: string
  /** Nota metodológica: cómo se construirá el indicador cuando llegue el dato. */
  metodologia: ReactNode
}

/**
 * Tarjeta para indicadores RECONOCIDOS pero todavía SIN dato distrital cargado.
 * En lugar de inventar cifras, declaramos la metodología y la fuente prevista
 * de forma transparente ("en preparación"). Anti-overclaiming.
 */
export default function IndicadorPendiente({ titulo, subtitulo, fuentePrevista, metodologia }: Props) {
  return (
    <Card className="border-dashed">
      <CardHeader title={titulo} subtitle={subtitulo} right={<Pill tone="warn">en preparación</Pill>} />
      <div className="px-4 pb-4 space-y-2">
        <div className="rounded-lg border border-dashed border-ink-300 dark:border-ink-700 bg-ink-50/50 dark:bg-ink-900/30 p-4 text-center">
          <p className="text-sm text-ink-500 dark:text-ink-300">
            Indicador en preparación. Aún no publicamos cifras para no inventar datos.
          </p>
          <p className="mt-1 text-xs text-ink-400">
            Mostraremos el mapa/ranking distrital en cuanto carguemos la fuente oficial.
          </p>
        </div>
        <div className="text-xs text-ink-500 dark:text-ink-300 space-y-1">
          <p>
            <strong>Fuente prevista:</strong> {fuentePrevista}
          </p>
          <div>
            <strong>Metodología documentada:</strong> {metodologia}
          </div>
        </div>
      </div>
    </Card>
  )
}
