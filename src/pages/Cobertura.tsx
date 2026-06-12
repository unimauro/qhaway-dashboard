import { useMemo, useState } from 'react'
import { getGeoJSON, getMeta, getPorDistrito, loadJSON } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { num, pct } from '../lib/format'
import { Chart } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'
import {
  Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro,
} from '../components/ui'

interface Demarcacion {
  ubigeo: string
  distrito: string
  provincia: string
  departamento: string
  anioCreacion: number | null
  norma: string
}

// Los 3 estados de cobertura territorial
const COLORES = {
  con_dato: '#34d399',   // verde
  sin_dato: '#f59e0b',   // ámbar
  no_existia: '#64748b', // gris
  existia: '#0ea5e9',    // azul (existía; cobertura distrital de ese año aún no disponible)
}

type Estado = keyof typeof COLORES

export default function Cobertura() {
  const meta = useAsync(getMeta, [])
  const geo = useAsync<unknown>(getGeoJSON, [])
  const demar = useAsync(() => loadJSON<Demarcacion[]>('demarcacion-distritos.json'), [])

  const years = meta.data?.years ?? [2025]
  const distYear = meta.data?.distritoYear ?? 2025
  const [year, setYear] = useState<number>(distYear)
  // Solo el año con detalle distrital permite distinguir con/sin dato real
  const distrito = useAsync(() => getPorDistrito(year), [year])

  if (meta.loading || geo.loading || demar.loading) return <Loading label="Cargando demarcación territorial…" />
  if (meta.error) return <ErrorBox error={meta.error} />
  if (geo.error) return <ErrorBox error={geo.error} />
  if (demar.error) return <ErrorBox error={demar.error} />
  if (!meta.data || !geo.data || !demar.data) return <Loading />

  // Años seleccionables: la ventana de la fuente abierta del MEF (2012+) hasta el último
  const yearOpts = (years.length > 1 ? years : [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025])
    .map((y) => ({ value: y, label: String(y) + (y === distYear ? ' (con detalle distrital)' : '') }))

  return (
    <div className="space-y-6">
      <SectionIntro title="Cobertura y demarcación territorial">
        Conocer <strong>qué territorios tienen información y cuáles no</strong> es parte del valor público
        del observatorio. Aquí distinguimos tres estados —porque un distrito en blanco no siempre significa
        lo mismo— y mostramos cuándo se creó cada distrito, ya que el mapa del Perú ha cambiado en el tiempo.
      </SectionIntro>

      <LeyendaEstados />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={year} onChange={setYear} options={yearOpts} label="Año" />
        <Pill tone={year === distYear ? 'good' : 'warn'}>
          {year === distYear
            ? `${year}: cobertura distrital real`
            : `${year}: detalle distrital en backfill (hoy solo ${distYear})`}
        </Pill>
      </div>

      <CoberturaBody
        geo={geo.data}
        demar={demar.data}
        distrito={distrito}
        year={year}
        distYear={distYear}
      />

      <Metodologia3Estados />
    </div>
  )
}

function LeyendaEstados() {
  const items: { e: Estado; t: string; d: string }[] = [
    { e: 'con_dato', t: 'Con dato', d: 'El distrito tiene ejecución presupuestal registrada ese año.' },
    { e: 'sin_dato', t: 'Sin dato', d: 'El distrito existía ese año pero no figura ejecución (vacío de información o sin gasto registrado).' },
    { e: 'no_existia', t: 'No existía', d: 'El distrito fue creado después de ese año: no es un vacío de datos, es que aún no existía.' },
    { e: 'existia', t: 'Existía (cobertura por confirmar)', d: 'El distrito ya existía, pero el detalle distrital de ese año aún no se ha incorporado.' },
  ]
  return (
    <Card className="px-4 py-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {items.map((i) => (
          <div key={i.e} className="flex items-start gap-2">
            <span className="mt-1 w-3 h-3 rounded-sm shrink-0" style={{ background: COLORES[i.e] }} />
            <div>
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{i.t}</p>
              <p className="text-xs text-ink-400 leading-snug">{i.d}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function CoberturaBody({ geo, demar, distrito, year, distYear }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geo: any
  demar: Demarcacion[]
  distrito: ReturnType<typeof useAsync<import('../lib/types').PorDistrito[]>>
  year: number
  distYear: number
}) {
  const demarMap = useMemo(() => {
    const m = new Map<string, Demarcacion>()
    for (const d of demar) m.set(d.ubigeo, d)
    return m
  }, [demar])

  const conDato = useMemo(() => {
    const s = new Set<string>()
    if (year === distYear && distrito.data) for (const r of distrito.data) s.add(r.ubigeo)
    return s
  }, [distrito.data, year, distYear])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feats: any[] = geo.features ?? []

  const { values, conteo, sinDatoList, recientes } = useMemo(() => {
    const values = new Map<string, MapValue>()
    const conteo: Record<Estado, number> = { con_dato: 0, sin_dato: 0, no_existia: 0, existia: 0 }
    const sinDatoList: Demarcacion[] = []
    const recientes: Demarcacion[] = []
    const tieneDistrital = year === distYear

    for (const f of feats) {
      const ub = f.properties?.IDDIST as string
      const dem = demarMap.get(ub)
      const anio = dem?.anioCreacion ?? null
      let estado: Estado
      if (anio && anio > year) {
        estado = 'no_existia'
      } else if (tieneDistrital) {
        estado = conDato.has(ub) ? 'con_dato' : 'sin_dato'
        if (estado === 'sin_dato' && dem) sinDatoList.push(dem)
      } else {
        estado = 'existia'
      }
      conteo[estado]++
      if (anio && anio > 2000 && dem) recientes.push(dem)
      values.set(ub, {
        value: 1,
        color: COLORES[estado],
        label: estado === 'no_existia' && anio
          ? `Creado en ${anio} — no existía en ${year}`
          : estado === 'con_dato' ? 'Con ejecución registrada'
          : estado === 'sin_dato' ? 'Existía, sin dato ese año'
          : 'Existía (cobertura por confirmar)',
      })
    }
    recientes.sort((a, b) => (b.anioCreacion ?? 0) - (a.anioCreacion ?? 0))
    sinDatoList.sort((a, b) => a.departamento.localeCompare(b.departamento))
    return { values, conteo, sinDatoList, recientes }
  }, [feats, demarMap, conDato, year, distYear])

  const total = feats.length
  const existentes = total - conteo.no_existia
  const coberturaPct = existentes > 0 && year === distYear ? conteo.con_dato / existentes : null

  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KPI label="Distritos en el mapa" value={num(total)} sub="de 1,845 oficiales (INEI)" />
        <KPI label={`Existían en ${year}`} value={num(existentes)} sub={`${num(conteo.no_existia)} creados después`} />
        {year === distYear ? (
          <>
            <KPI label="Con dato" value={num(conteo.con_dato)} sub={coberturaPct != null ? `${pct(coberturaPct)} de cobertura` : ''} accent />
            <KPI label="Sin dato" value={num(conteo.sin_dato)} sub="existían, sin ejecución registrada" />
          </>
        ) : (
          <KPI label="Detalle distrital" value="Pendiente" sub={`solo ${distYear} disponible hoy`} />
        )}
      </div>

      <Card>
        <CardHeader
          title={`Mapa de cobertura — ${year}`}
          subtitle="Cada distrito coloreado por su estado de información"
          help={
            <HelpTip>
              Verde: tiene ejecución registrada. Ámbar: existía pero sin dato. Gris: aún no había sido creado
              ese año (no es un vacío de información). Azul: existía pero el detalle distrital de ese año todavía
              no se ha incorporado. Toca un distrito para ver su año de creación.
            </HelpTip>
          }
        />
        <div className="px-3 pb-3">
          <MapaDistrital geojson={geo} values={values} unitLabel="" formatValue={() => ''} height={520} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            title="Línea de tiempo de la demarcación"
            subtitle="Cuántos distritos existían acumuladamente, por década de creación"
            help={<HelpTip>El mapa del Perú no es fijo: los distritos se fueron creando por ley a lo largo del tiempo. Aquí, cuántos del dataset cartográfico existían hasta cada década. Las fechas provienen de la base cartográfica (puede no incluir las creaciones más recientes; el registro oficial es del INEI/PCM).</HelpTip>}
          />
          <div className="px-2 pb-3">
            <TimelineChart demar={demar} />
          </div>
        </Card>

        {recientes.length > 0 && (
          <Card>
            <CardHeader
              title="Distritos de creación reciente (post-2000)"
              subtitle="Tienen, por construcción, una historia de datos más corta"
              help={<HelpTip>Estos distritos no existían a inicios de la serie; comparar su trayectoria histórica con distritos antiguos requiere cuidado.</HelpTip>}
            />
            <div className="px-4 pb-4 max-h-[460px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-ink-400 text-left sticky top-0 bg-white dark:bg-ink-900">
                  <tr><th className="py-1">Distrito</th><th>Provincia · Depto.</th><th className="text-right">Creado</th></tr>
                </thead>
                <tbody>
                  {recientes.map((d) => (
                    <tr key={d.ubigeo} className="border-t border-ink-200 dark:border-ink-800">
                      <td className="py-1 font-medium text-ink-900 dark:text-ink-50">{d.distrito}</td>
                      <td className="text-ink-400">{d.provincia}, {d.departamento}</td>
                      <td className="text-right">{d.anioCreacion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {year === distYear && sinDatoList.length > 0 && (
        <Card>
          <CardHeader
            title={`Distritos sin dato en ${year} (${num(sinDatoList.length)})`}
            subtitle="Existían ese año pero no figura ejecución presupuestal registrada"
            help={<HelpTip>Puede deberse a que la unidad ejecutora reporta el gasto en otra ubicación, a un distrito sin proyecto/actividad ese año, o a un vacío real de la fuente. Visibilizarlo es parte de la transparencia.</HelpTip>}
          />
          <div className="px-4 pb-4 max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-400 text-left sticky top-0 bg-white dark:bg-ink-900">
                <tr><th className="py-1">Distrito</th><th>Provincia</th><th>Departamento</th></tr>
              </thead>
              <tbody>
                {sinDatoList.map((d) => (
                  <tr key={d.ubigeo} className="border-t border-ink-200 dark:border-ink-800">
                    <td className="py-1 font-medium text-ink-900 dark:text-ink-50">{d.distrito}</td>
                    <td className="text-ink-400">{d.provincia}</td>
                    <td className="text-ink-400">{d.departamento}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

function TimelineChart({ demar }: { demar: Demarcacion[] }) {
  const { labels, acumulado } = useMemo(() => {
    const decadas: Record<number, number> = {}
    let sinAnio = 0
    for (const d of demar) {
      if (!d.anioCreacion) { sinAnio++; continue }
      const dec = Math.floor(d.anioCreacion / 10) * 10
      decadas[dec] = (decadas[dec] || 0) + 1
    }
    const decs = Object.keys(decadas).map(Number).sort((a, b) => a - b)
    const labels = decs.map((d) => `${d}s`)
    let cum = sinAnio // los sin año son distritos antiguos: existían desde el inicio
    const acumulado = decs.map((d) => (cum += decadas[d]))
    return { labels, acumulado }
  }, [demar])

  return (
    <Chart
      height={300}
      option={{
        tooltip: { trigger: 'axis' },
        grid: { left: 8, right: 16, top: 20, bottom: 8, containLabel: true },
        xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10 } },
        yAxis: { type: 'value', name: 'Distritos existentes', nameTextStyle: { fontSize: 10 } },
        series: [{
          name: 'Distritos existentes (acumulado)',
          type: 'line', smooth: true, areaStyle: { opacity: 0.12 },
          data: acumulado, lineStyle: { width: 3 },
        }],
      }}
    />
  )
}

function Metodologia3Estados() {
  return (
    <Card>
      <CardHeader title="Metodología: los tres estados de cobertura" />
      <div className="px-4 pb-4 text-sm text-ink-600 dark:text-ink-200 space-y-2 max-w-3xl">
        <p>
          Para cada distrito y cada año distinguimos: <strong>(1) No existía</strong> —fue creado por ley
          después de ese año, dato tomado de la base cartográfica de demarcación—; <strong>(2) Sin dato</strong>
          —existía pero no figura ejecución registrada—; y <strong>(3) Con dato</strong> —tiene ejecución ese
          año—. Separarlos evita confundir un territorio que aún no existía con un vacío real de información.
        </p>
        <p>
          <Pill tone="warn">Alcance actual</Pill> El detalle distrital con datos reales está disponible para{' '}
          <strong>2025</strong>. Para años anteriores se conoce qué distritos existían (demarcación), y la
          cobertura con/sin dato se irá completando conforme avance el backfill histórico del presupuesto
          distrital. El marco territorial oficial del INEI es de 1,845 distritos; la base cartográfica vigente
          cubre 1,834, y la plataforma indica los que faltan.
        </p>
      </div>
    </Card>
  )
}
