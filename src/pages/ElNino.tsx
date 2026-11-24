import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadJSON, getGeoJSON } from '../lib/data'
import type { IndicadorDistrito, NivelRiesgo, RegionRiesgo, RiesgosContext, RiesgosData } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro } from '../components/ui'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'
import ElNinoEstado, { type NinoActual } from '../components/ElNinoEstado'
import ElNinoPresupuesto from '../components/ElNinoPresupuesto'
import { fechaCorta, nombreDepto, normalizarMitigacion } from '../components/ElNinoTipos'
import { num, pct, soles, solesCompact } from '../lib/format'

/* ════════════════════════════════════════════════════════════════════
 * El Niño 2026-27: riesgo × presupuesto.
 * Responde la pregunta de la propuesta (módulo 8.3): «¿Coincide la inversión
 * en gestión del riesgo con los territorios más expuestos?».
 *
 * Cruza la exposición a El Niño por departamento (riesgos.json) con el PP 0068
 * «Reducción de vulnerabilidad y atención de emergencias por desastres»
 * (programa-territorio-clima.json, por destino META) y su serie nacional
 * (por-programa-historico.json). Todas las cifras se leen de los JSON.
 * ════════════════════════════════════════════════════════════════════ */

const PP = '0068'

// Tipos propios (types.ts es de otro módulo): campos extra que esta vista lee.
type RegionNino = RegionRiesgo & { fuente?: Record<string, string> }
type RiesgosNino = Omit<RiesgosData, 'regions' | 'context'> & {
  regions: RegionNino[]
  context: RiesgosContext & { ninoActual?: NinoActual }
}
interface ProgTerritorio {
  year: number
  code: string
  programa: string
  ubigeo: string
  departamento: string
  pim: number
  devengado: number
}
interface ProgHistorico {
  year: number
  code: string
  programa: string
  pia: number
  pim: number
  certificado?: number
  devengado: number
  girado: number
}
type Cortes = Record<string, { fecha_corte?: string; fuente?: string; anios?: number[]; generado?: string }>

type Nivel = NivelRiesgo | 'ninguna'
const NIVEL_COLOR: Record<Nivel, string> = { alta: '#ef4444', media: '#f59e0b', baja: '#22c55e', ninguna: '#94a3b8' }
const NIVEL_LABEL: Record<Nivel, string> = { alta: 'Alta', media: 'Media', baja: 'Baja', ninguna: 'No señalada' }
const NIVEL_PESO: Record<Nivel, number> = { alta: 3, media: 2, baja: 1, ninguna: 0 }

// Índice de brecha 0–100 → color (secuencial ámbar→rojo; 0 = sin exposición).
const BRECHA_TRAMOS: { min: number; color: string; label: string }[] = [
  { min: 45, color: '#b91c1c', label: '≥ 45' },
  { min: 30, color: '#f97316', label: '30–45' },
  { min: 15, color: '#fbbf24', label: '15–30' },
  { min: 0.001, color: '#fde68a', label: '< 15' },
]
const brechaColor = (v: number) => BRECHA_TRAMOS.find((t) => v >= t.min)?.color ?? NIVEL_COLOR.ninguna

interface Fila {
  ubigeo: string
  nombre: string
  nivel: Nivel
  fuente?: string
  pim: number
  devengado: number
  ejec: number
  pob?: number
  pimPc?: number
  brecha: number // 0–100
  alerta: boolean // exposición alta con ejecución bajo el promedio nacional
}

async function cargar() {
  const [riesgos, territorio, historico, indicadores, geo, cortes, mitRaw] = await Promise.all([
    loadJSON<RiesgosNino>('riesgos.json'),
    loadJSON<ProgTerritorio[]>('programa-territorio-clima.json'),
    loadJSON<ProgHistorico[]>('por-programa-historico.json'),
    loadJSON<IndicadorDistrito[]>('indicadores-distrito.json').catch(() => [] as IndicadorDistrito[]),
    getGeoJSON(),
    loadJSON<Cortes>('cortes.json').catch(() => ({}) as Cortes),
    // Lo genera otro proceso del ETL; si aún no existe, la vista usa por-programa-historico.json.
    loadJSON<unknown>('mitigacion-2021-2027.json').catch(() => null),
  ])
  return { riesgos, territorio, historico, indicadores, geo, cortes, mit: normalizarMitigacion(mitRaw) }
}

export default function ElNino() {
  const { data, loading, error } = useAsync(cargar, [])
  const [modo, setModo] = useState<'brecha' | 'exposicion'>('brecha')

  const calc = useMemo(() => {
    if (!data) return null
    const pp = data.territorio.filter((r) => r.code === PP)
    if (!pp.length) return null
    const anio = Math.max(...pp.map((r) => r.year))
    const filasAnio = pp.filter((r) => r.year === anio)

    // Población departamental = suma de la población distrital (indicadores-distrito.json)
    const pobDep = new Map<string, number>()
    data.indicadores.forEach((d) => {
      const k = d.ubigeo.slice(0, 2)
      pobDep.set(k, (pobDep.get(k) ?? 0) + (d.pob || 0))
    })
    const regionPor = new Map(data.riesgos.regions.map((r) => [r.ubigeo, r]))

    const pimTot = filasAnio.reduce((s, r) => s + r.pim, 0)
    const devTot = filasAnio.reduce((s, r) => s + r.devengado, 0)
    const ejecNac = pimTot ? devTot / pimTot : 0

    const filas: Fila[] = filasAnio.map((r) => {
      const reg = regionPor.get(r.ubigeo)
      const nivel: Nivel = (reg?.risks.nino as NivelRiesgo | undefined) ?? 'ninguna'
      const ejec = r.pim ? r.devengado / r.pim : 0
      const pob = pobDep.get(r.ubigeo) || undefined
      return {
        ubigeo: r.ubigeo,
        nombre: nombreDepto(r.ubigeo, r.departamento),
        nivel,
        fuente: reg?.fuente?.nino,
        pim: r.pim,
        devengado: r.devengado,
        ejec,
        pob,
        pimPc: pob ? r.pim / pob : undefined,
        // Brecha simple: peso de exposición (0–1) × fracción del PIM aún no devengada.
        brecha: Math.round((NIVEL_PESO[nivel] / 3) * (1 - Math.min(1, ejec)) * 100),
        alerta: nivel === 'alta' && ejec < ejecNac,
      }
    })
    filas.sort((a, b) => b.brecha - a.brecha || a.ejec - b.ejec)

    const pobTot = filas.reduce((s, f) => s + (f.pob ?? 0), 0)
    const alta = filas.filter((f) => f.nivel === 'alta')
    const pimAlta = alta.reduce((s, f) => s + f.pim, 0)
    const devAlta = alta.reduce((s, f) => s + f.devengado, 0)
    const pobAlta = alta.reduce((s, f) => s + (f.pob ?? 0), 0)

    const serie = data.historico.filter((r) => r.code === PP).sort((a, b) => a.year - b.year)
    return { anio, filas, pimTot, devTot, ejecNac, pobTot, alta, pimAlta, devAlta, pobAlta, serie }
  }, [data])

  const mapValues = useMemo(() => {
    const m = new Map<string, MapValue>()
    if (!data?.geo?.features || !calc) return m
    const porDep = new Map(calc.filas.map((f) => [f.ubigeo, f]))
    for (const feat of data.geo.features) {
      const idDist = feat?.properties?.IDDIST as string | undefined
      const idDpto = feat?.properties?.IDDPTO as string | undefined
      const f = idDpto ? porDep.get(idDpto) : undefined
      if (!idDist || !f) continue
      const label =
        `<b>${f.nombre}</b> (nivel departamental)<br>Exposición El Niño: ${NIVEL_LABEL[f.nivel]}` +
        `<br>PIM PP 0068: ${solesCompact(f.pim)} · ejecución ${pct(f.ejec)}<br>Brecha: ${f.brecha}`
      m.set(idDist, modo === 'brecha'
        ? { value: f.brecha, color: brechaColor(f.brecha), label }
        : { value: NIVEL_PESO[f.nivel], color: NIVEL_COLOR[f.nivel], label })
    }
    return m
  }, [data, calc, modo])

  if (loading) return <Loading label="Cargando El Niño y presupuesto…" />
  if (error) return <ErrorBox error={error} />
  if (!data || !calc) return <ErrorBox error="Sin datos del PP 0068 en programa-territorio-clima.json" />

  const nino = data.riesgos.context.ninoActual
  const corteTerr = data.cortes['programa-territorio-clima.json']?.fecha_corte
  const corteHist = data.cortes['por-programa-historico.json']?.fecha_corte
  const { anio, filas, pimTot, devTot, ejecNac, pobTot, alta, pimAlta, devAlta, pobAlta, serie } = calc
  const pimPcNac = pobTot ? pimTot / pobTot : undefined

  return (
    <div className="space-y-6">
      <SectionIntro title="El Niño 2026-27: riesgo × presupuesto">
        ¿Coincide la inversión en gestión del riesgo con los territorios más expuestos? Esta vista cruza
        la exposición a El Niño de cada departamento con el presupuesto del <b>PP 0068 «Reducción de
        vulnerabilidad y atención de emergencias por desastres»</b> del {anio} y su historia desde 2012.
      </SectionIntro>

      {nino && <ElNinoEstado nino={nino} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI label={`PIM PP 0068 · ${anio}`} value={solesCompact(pimTot)} sub="nacional, todos los niveles" accent />
        <KPI label="Devengado" value={solesCompact(devTot)} sub={`ejecución ${pct(ejecNac)}${corteTerr ? ` al ${fechaCorta(corteTerr)}` : ''}`} />
        <KPI
          label="Departamentos con exposición alta"
          value={num(alta.length)}
          sub={pobTot ? `${pct(pobAlta / pobTot)} de la población` : undefined}
        />
        <KPI
          label="Su parte del PIM PP 0068"
          value={pct(pimTot ? pimAlta / pimTot : 0)}
          sub={`ejecución ${pct(pimAlta ? devAlta / pimAlta : 0)}`}
        />
      </div>
      {corteTerr && (
        <p className="-mt-3 text-xs text-ink-400">
          Datos MEF (Consulta Amigable) con corte al <b>{fechaCorta(corteTerr)}</b>. El año {anio} está en
          curso: la ejecución sube hasta diciembre.
        </p>
      )}

      {/* Mapa */}
      <Card>
        <CardHeader
          title={modo === 'brecha' ? `Brecha: exposición a El Niño × ejecución del PP 0068 (${anio})` : 'Exposición a El Niño por departamento'}
          subtitle="Cada distrito toma el valor de su departamento"
          help={
            <HelpTip>
              <b>Brecha</b> (0–100) = peso de la exposición (alta 1, media ⅔, baja ⅓, no señalada 0) ×
              porcentaje del PIM del PP 0068 que aún no se ha devengado. Es alta cuando un departamento
              muy expuesto ha ejecutado poco. Es un indicador simple de alerta, no una medida de
              necesidad.
            </HelpTip>
          }
          right={
            <Select
              label="Colorear por"
              value={modo}
              onChange={setModo}
              options={[{ value: 'brecha', label: 'Brecha' }, { value: 'exposicion', label: 'Exposición' }]}
            />
          }
        />
        <div className="px-4 pb-4">
          <MapaDistrital
            geojson={data.geo}
            values={mapValues}
            unitLabel={modo === 'brecha' ? 'Brecha' : 'Exposición'}
            formatValue={(v) => (modo === 'brecha' ? String(v) : (['No señalada', 'Baja', 'Media', 'Alta'] as const)[v] ?? '—')}
            height={500}
          />
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-600 dark:text-ink-200">
            {modo === 'brecha'
              ? <>
                  {BRECHA_TRAMOS.map((t) => <Leyenda key={t.label} color={t.color} t={`Brecha ${t.label}`} />)}
                  <Leyenda color={NIVEL_COLOR.ninguna} t="Sin exposición señalada" />
                </>
              : (['alta', 'media', 'baja', 'ninguna'] as Nivel[]).map((n) => <Leyenda key={n} color={NIVEL_COLOR[n]} t={NIVEL_LABEL[n]} />)}
          </div>
        </div>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader
          title={`Departamentos ordenados por brecha · PP 0068 ${anio}`}
          subtitle={`PIM per cápita nacional: ${pimPcNac ? soles(pimPcNac) : '—'} · ejecución nacional: ${pct(ejecNac)}`}
          help={
            <HelpTip>
              Población: suma de la población distrital de indicadores-distrito.json. ⚠ marca los
              departamentos con exposición alta y ejecución por debajo del promedio nacional. Pasa el
              cursor sobre el nivel de exposición para ver su fuente.
            </HelpTip>
          }
          right={<Pill tone="warn">nivel departamental</Pill>}
        />
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-400">
                <th className="py-1.5 pr-3 font-medium">Departamento</th>
                <th className="py-1.5 pr-3 font-medium">Exposición</th>
                <th className="py-1.5 pr-3 text-right font-medium">PIM</th>
                <th className="py-1.5 pr-3 text-right font-medium">Devengado</th>
                <th className="py-1.5 pr-3 text-right font-medium">% ejec.</th>
                <th className="py-1.5 pr-3 text-right font-medium">PIM per cápita</th>
                <th className="py-1.5 text-right font-medium">Brecha</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.ubigeo} className={`border-t border-ink-200 dark:border-ink-800 ${f.alerta ? 'bg-red-50 dark:bg-red-900/20' : ''}`}>
                  <td className="py-1.5 pr-3 font-medium text-ink-900 dark:text-ink-50">
                    {f.alerta && <span title="Exposición alta con ejecución bajo el promedio nacional">⚠ </span>}
                    {f.nombre}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-center gap-1.5" title={f.fuente ?? ''}>
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NIVEL_COLOR[f.nivel] }} />
                      {NIVEL_LABEL[f.nivel]}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{solesCompact(f.pim)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{solesCompact(f.devengado)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${f.ejec < ejecNac ? 'text-red-600 dark:text-red-400' : ''}`}>{pct(f.ejec)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{f.pimPc != null ? soles(f.pimPc) : '—'}</td>
                  <td className="py-1.5 text-right">
                    <span className="inline-block min-w-[2.5rem] rounded-md px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-ink-900" style={{ backgroundColor: brechaColor(f.brecha) }}>
                      {f.brecha}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Serie 2021–2027 y presupuesto 2027 */}
      <ElNinoPresupuesto
        mit={data.mit}
        historico={serie}
        eventos={data.riesgos.context.ninoEventos}
        corte={corteHist}
        anioVigente={anio}
      />

      {/* Nota metodológica */}
      <Card>
        <CardHeader title="Nota metodológica" />
        <ul className="list-disc space-y-1.5 px-8 pb-4 text-sm text-ink-600 dark:text-ink-200">
          <li>
            <b>Territorio del gasto.</b> El departamento es el que el MEF registra para el gasto (campo
            «Departamento (Meta)» de la Consulta Amigable) y depende de lo que declara la unidad
            ejecutora; no es necesariamente el lugar de la obra. El gasto del gobierno nacional que no
            se asigna a una región se registra en Lima, por eso Lima concentra una parte grande del PP
            0068 y su PIM per cápita no es comparable con el resto.
          </li>
          <li>
            <b>Exposición.</b> Nivel cualitativo por departamento (riesgos.json), basado en el
            pronóstico del ENFEN para 2026-27 y en el impacto del evento de 2017. No es un escenario
            de riesgo distrital del CENEPRED.
          </li>
          <li>
            <b>Solo PP 0068.</b> Parte de la prevención y la reconstrucción se financia fuera de este
            programa (por ejemplo, la Autoridad para la Reconstrucción con Cambios y las asignaciones
            presupuestarias que no resultan en productos), así que esta vista no mide todo el gasto
            frente a El Niño.
          </li>
          <li>
            <b>Población.</b> Suma de la población distrital de indicadores-distrito.json.
          </li>
          <li>
            Fuentes: MEF, Consulta Amigable{corteTerr ? ` (corte ${fechaCorta(corteTerr)})` : ''}; ENFEN; NOAA CPC.
            Más peligros en <Link to="/riesgos" className="text-brand-600 hover:underline dark:text-brand-300">Riesgos territoriales</Link>.
          </li>
        </ul>
      </Card>
    </div>
  )
}

function Leyenda({ color, t }: { color: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      {t}
    </span>
  )
}
