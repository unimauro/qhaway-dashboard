import { Card, CardHeader, HelpTip, Pill } from './ui'
import { fechaCorta } from './ElNinoTipos'

/* Tarjeta «Estado actual» del evento El Niño en curso. Los textos, fechas y
 * enlaces viven en public/data/riesgos.json → context.ninoActual (no en el código),
 * para poder actualizarlos con cada comunicado del ENFEN sin tocar el frontend. */

export interface FuenteNino {
  fuente: string
  fecha: string // ISO yyyy-mm-dd
  url: string
  resumen: string
}

export interface NinoActual {
  titulo: string
  estado: string
  desde: string
  enfen: FuenteNino
  noaa?: FuenteNino
  pronostico?: {
    periodo: string
    lluvias?: string
    rios?: { rio: string; desde: string }[]
    oleajes?: string
    deficit?: string
  }
  aviso?: string
  avisoUrl?: string
}

function Fuente({ f }: { f: FuenteNino }) {
  return (
    <div className="rounded-xl border border-ink-200 dark:border-ink-800 p-3">
      <p className="text-xs text-ink-400">
        {f.fuente} · <span className="tabular-nums">{fechaCorta(f.fecha)}</span>
      </p>
      <p className="mt-1 text-sm text-ink-800 dark:text-ink-200">{f.resumen}</p>
      <a
        href={f.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
      >
        Ver fuente ↗
      </a>
    </div>
  )
}

export default function ElNinoEstado({ nino }: { nino: NinoActual }) {
  const p = nino.pronostico
  // Agrupa los ríos por el momento desde el que se esperan caudales muy altos.
  const rios = new Map<string, string[]>()
  p?.rios?.forEach((r) => rios.set(r.desde, [...(rios.get(r.desde) ?? []), r.rio]))

  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardHeader
        title={`Estado actual: ${nino.titulo}`}
        subtitle={`${nino.estado} · último comunicado ENFEN: ${fechaCorta(nino.enfen.fecha)}`}
        help={
          <HelpTip>
            Resumen del comunicado oficial del ENFEN (Comisión Multisectorial encargada del Estudio
            Nacional del Fenómeno El Niño) y del boletín de NOAA. Es un pronóstico: puede cambiar con
            cada comunicado nuevo.
          </HelpTip>
        }
        right={<Pill tone="warn">alerta vigente</Pill>}
      />
      <div className="grid gap-3 px-4 pb-3 md:grid-cols-2">
        <Fuente f={nino.enfen} />
        {nino.noaa && <Fuente f={nino.noaa} />}
      </div>
      {p && (
        <div className="px-4 pb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Pronóstico {p.periodo}
          </h4>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-800 dark:text-ink-200">
            {p.lluvias && <li>🌧 {p.lluvias}</li>}
            {[...rios.entries()].map(([desde, lista]) => (
              <li key={desde}>
                🌊 Ríos con caudales muy altos ({desde}): <b>{lista.join(', ')}</b>.
              </li>
            ))}
            {p.oleajes && <li>🌬 {p.oleajes}</li>}
            {p.deficit && <li>☀ {p.deficit}</li>}
          </ul>
        </div>
      )}
      {nino.aviso && (
        <div className="mx-4 mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          ⚠ {nino.aviso}{' '}
          {nino.avisoUrl && (
            <a href={nino.avisoUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
              Ir al ENFEN ↗
            </a>
          )}
        </div>
      )}
    </Card>
  )
}
