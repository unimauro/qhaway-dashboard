import { useMemo } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  getGeoJSON,
  getAltitudes,
  getPorDistrito,
  getMeta,
  loadJSON,
} from '../lib/data'
import type { AltitudDistrito, IndicadorDistrito, Meta, PorDistrito } from '../lib/types'
import { clasificarPiso, TODOS_PISOS, type Piso } from '../lib/pisos'
import {
  Card,
  CardHeader,
  HelpTip,
  KPI,
  Pill,
  Loading,
  ErrorBox,
  SectionIntro,
} from '../components/ui'
import { Chart } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'
import { soles, solesCompact, num, pct, ejecucion } from '../lib/format'

interface PisoFeature {
  IDDIST: string
  NOMBDIST: string
  NOMBDEP: string
}

interface FilaPiso {
  piso: Piso
  nDistritos: number
  pob: number
  tienePob: boolean
  pim: number
  devengado: number
  conPresupuesto: number
}

const colorEjecucion = (frac: number): string =>
  frac < 0.5 ? '#ef4444' : frac < 0.8 ? '#f59e0b' : '#22c55e'

export default function Pisos() {
  const geoRes = useAsync<unknown>(() => getGeoJSON(), [])
  const altRes = useAsync<AltitudDistrito[]>(() => getAltitudes(), [])
  const metaRes = useAsync<Meta>(() => getMeta(), [])
  const indRes = useAsync<IndicadorDistrito[]>(
    () => loadJSON<IndicadorDistrito[]>('indicadores-distrito.json'),
    [],
  )

  const latestYear = metaRes.data?.latestYear
  const distRes = useAsync<PorDistrito[]>(
    () => (latestYear ? getPorDistrito(latestYear) : Promise.resolve([])),
    [latestYear],
  )

  // --- Mapas auxiliares por ubigeo6 ---
  const altPorUbigeo = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of altRes.data ?? []) m.set(a.ubigeo, a.altitud)
    return m
  }, [altRes.data])

  const indPorUbigeo = useMemo(() => {
    const m = new Map<string, IndicadorDistrito>()
    for (const i of indRes.data ?? []) m.set(i.ubigeo, i)
    return m
  }, [indRes.data])

  const distPorUbigeo = useMemo(() => {
    const m = new Map<string, PorDistrito>()
    for (const d of distRes.data ?? []) m.set(d.ubigeo, d)
    return m
  }, [distRes.data])

  // --- Clasificar cada distrito del geojson a su piso (join por IDDIST) ---
  const pisoPorUbigeo = useMemo(() => {
    const m = new Map<string, Piso>()
    const geo = geoRes.data as { features?: { properties?: PisoFeature }[] } | undefined
    if (!geo?.features) return m
    for (const f of geo.features) {
      const p = f.properties
      if (!p?.IDDIST) continue
      // altitud preferente: capa altitudes; fallback indicadores
      const alt = altPorUbigeo.get(p.IDDIST) ?? indPorUbigeo.get(p.IDDIST)?.altitud
      const piso = clasificarPiso(alt, p.NOMBDEP ?? '')
      if (piso) m.set(p.IDDIST, piso)
    }
    return m
  }, [geoRes.data, altPorUbigeo, indPorUbigeo])

  // --- values para el mapa coloreado por piso ---
  const mapValues = useMemo(() => {
    const m = new Map<string, MapValue>()
    const geo = geoRes.data as { features?: { properties?: PisoFeature }[] } | undefined
    if (!geo?.features) return m
    for (const f of geo.features) {
      const ubi = f.properties?.IDDIST
      if (!ubi) continue
      const piso = pisoPorUbigeo.get(ubi)
      if (!piso) continue
      const alt = altPorUbigeo.get(ubi) ?? indPorUbigeo.get(ubi)?.altitud
      const altTxt = alt !== undefined ? `${num(alt)} msnm` : 's/d'
      m.set(ubi, {
        value: TODOS_PISOS.findIndex((p) => p.id === piso.id),
        color: piso.color,
        label: `${piso.nombre} · ${altTxt}`,
      })
    }
    return m
  }, [geoRes.data, pisoPorUbigeo, altPorUbigeo, indPorUbigeo])

  // --- Agregado presupuestal + distritos + población por piso ---
  const filas = useMemo<FilaPiso[]>(() => {
    const base = new Map<string, FilaPiso>()
    for (const p of TODOS_PISOS) {
      base.set(p.id, {
        piso: p,
        nDistritos: 0,
        pob: 0,
        tienePob: false,
        pim: 0,
        devengado: 0,
        conPresupuesto: 0,
      })
    }
    for (const [ubi, piso] of pisoPorUbigeo) {
      const fila = base.get(piso.id)
      if (!fila) continue
      fila.nDistritos += 1
      const ind = indPorUbigeo.get(ubi)
      if (ind?.pob) {
        fila.pob += ind.pob
        fila.tienePob = true
      }
      const d = distPorUbigeo.get(ubi)
      if (d) {
        fila.pim += d.pim
        fila.devengado += d.devengado
        fila.conPresupuesto += 1
      }
    }
    // Orden costa→cordillera→selva (orden de TODOS_PISOS)
    return TODOS_PISOS.map((p) => base.get(p.id)!).filter((f) => f.nDistritos > 0)
  }, [pisoPorUbigeo, indPorUbigeo, distPorUbigeo])

  const hayPresupuesto = useMemo(
    () => filas.some((f) => f.pim > 0),
    [filas],
  )

  const pimTotal = useMemo(() => filas.reduce((s, f) => s + f.pim, 0), [filas])

  // KPIs altoandino (Puna+Janca) y selva (Alta+Baja)
  const kpi = useMemo(() => {
    const sum = (ids: string[]) =>
      filas
        .filter((f) => ids.includes(f.piso.id))
        .reduce((s, f) => s + f.pim, 0)
    const altoandino = sum(['puna', 'janca'])
    const selva = sum(['selva_alta', 'selva_baja'])
    return { altoandino, selva }
  }, [filas])

  // --- Estados de carga / error (bloqueantes: geojson + altitudes) ---
  if (geoRes.loading || altRes.loading || metaRes.loading) return <Loading label="Cargando pisos altitudinales…" />
  if (geoRes.error) return <ErrorBox error={geoRes.error} />
  if (altRes.error) return <ErrorBox error={altRes.error} />
  if (metaRes.error) return <ErrorBox error={metaRes.error} />
  if (!geoRes.data || !altRes.data || !metaRes.data) return <Loading />
  if (pisoPorUbigeo.size === 0)
    return <ErrorBox error="No se pudo clasificar ningún distrito por piso altitudinal (sin datos de altitud)." />

  // --- Opciones ECharts ---
  const optBarrasPresupuesto = {
    grid: { left: 8, right: 16, bottom: 8, top: 16, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        return `${p.name}<br/>PIM: ${soles(p.value)}`
      },
    },
    xAxis: {
      type: 'value' as const,
      axisLabel: { formatter: (v: number) => solesCompact(v) },
    },
    yAxis: {
      type: 'category' as const,
      data: filas.map((f) => f.piso.nombre),
      inverse: true,
    },
    series: [
      {
        type: 'bar' as const,
        data: filas.map((f) => ({
          value: f.pim,
          itemStyle: { color: f.piso.color },
        })),
        barMaxWidth: 28,
      },
    ],
  }

  const optDistritos = {
    grid: { left: 8, right: 16, bottom: 8, top: 16, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        return `${p.name}<br/>${num(p.value)} distritos`
      },
    },
    xAxis: {
      type: 'value' as const,
      axisLabel: { formatter: (v: number) => num(v) },
    },
    yAxis: {
      type: 'category' as const,
      data: filas.map((f) => f.piso.nombre),
      inverse: true,
    },
    series: [
      {
        type: 'bar' as const,
        data: filas.map((f) => ({
          value: f.nDistritos,
          itemStyle: { color: f.piso.color },
        })),
        barMaxWidth: 28,
        label: {
          show: true,
          position: 'right' as const,
          formatter: (p: { value: number }) => num(p.value),
        },
      },
    ],
  }

  return (
    <div className="space-y-5">
      <SectionIntro title="Inteligencia territorial · Pisos altitudinales">
        El Perú no es un país plano: su territorio se organiza en{' '}
        <strong>regiones naturales según la altitud</strong>. Aquí cruzamos esa geografía
        con el presupuesto público para responder una pregunta que casi nadie hace:{' '}
        <em>¿cuánto presupuesto llega a cada piso altitudinal?</em>
      </SectionIntro>

      {/* 1. Metodología honesta */}
      <Card>
        <CardHeader
          title="Cómo clasificamos (y sus límites)"
          subtitle="Javier Pulgar Vidal · 8 regiones naturales"
          right={<Pill tone="warn">aprox.</Pill>}
        />
        <div className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2 px-1">
          <p>
            Usamos la clasificación clásica de{' '}
            <strong>Javier Pulgar Vidal</strong> («Las ocho regiones naturales del Perú»,
            1941): Chala, Yunga, Quechua, Suni, Puna, Janca, más Selva Alta y Selva Baja.
          </p>
          <p>
            <Pill tone="warn">MVP</Pill> A cada distrito le asignamos su{' '}
            <strong>piso DOMINANTE según la altitud de su capital</strong>, no la
            composición porcentual real por modelo de elevación (DEM). Un distrito
            altoandino con valles bajos puede tener varios pisos a la vez; eso lo
            resolveremos en el roadmap con análisis por DEM. La frontera amazónica
            (Selva Alta/Baja) se discrimina además por departamento.
          </p>
          <p className="text-xs text-zinc-500">
            Fuente de altitud: capa oficial de altitudes distritales (SIAF-MEF / INEI).
            La clasificación piso↔distrito es una <strong>aproximación metodológica</strong>,
            no un dato oficial cerrado.
          </p>
        </div>
      </Card>

      {/* 2. Mapa coloreado por piso + leyenda */}
      <Card>
        <CardHeader
          title="Mapa del Perú por piso altitudinal"
          subtitle={`${num(pisoPorUbigeo.size)} distritos clasificados`}
          help={
            <HelpTip>
              Cada distrito se pinta con el color de su piso dominante (no por monto de
              dinero). Pasa el cursor para ver el piso y la altitud de su capital en msnm.
              No interpretes la intensidad como presupuesto: aquí el color = geografía.
            </HelpTip>
          }
        />
        <MapaDistrital
          geojson={geoRes.data}
          values={mapValues}
          unitLabel="Piso"
          formatValue={(v) => TODOS_PISOS[v]?.nombre ?? '—'}
          height={520}
        />
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 px-1">
          {TODOS_PISOS.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block w-3 h-3 rounded-sm shrink-0 border border-black/10"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">{p.nombre}</span>
                <br />
                <span className="text-zinc-400">
                  {p.min === p.max ? `${num(p.min)}` : `${num(p.min)}–${num(p.max)}`} msnm
                </span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      {hayPresupuesto ? (
        <>
          {/* 4. KPIs destacados */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KPI
              label={`PIM altoandino (Puna + Janca) ${latestYear ?? ''}`}
              value={solesCompact(kpi.altoandino)}
              sub={
                pimTotal > 0
                  ? `${pct(kpi.altoandino / pimTotal)} del total clasificado`
                  : undefined
              }
              accent
            />
            <KPI
              label={`PIM Selva (Alta + Baja) ${latestYear ?? ''}`}
              value={solesCompact(kpi.selva)}
              sub={
                pimTotal > 0
                  ? `${pct(kpi.selva / pimTotal)} del total clasificado`
                  : undefined
              }
            />
            <KPI
              label="PIM total clasificado por piso"
              value={solesCompact(pimTotal)}
              sub={`${num(filas.reduce((s, f) => s + f.conPresupuesto, 0))} distritos con presupuesto`}
            />
          </div>
          <Card>
            <div className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2 px-1">
              <p>
                <Pill tone="warn">lectura honesta</Pill> Estas cifras{' '}
                <strong>no son “gasto por geografía pura”</strong>: un PIM alto en un piso
                puede reflejar dónde vive más gente o dónde hay grandes obras, no
                necesariamente equidad territorial. Para juzgar equidad mira el{' '}
                <strong>PIM per cápita</strong> de la tabla siguiente, no el monto absoluto.
              </p>
            </div>
          </Card>

          {/* 3a. Barras de presupuesto por piso */}
          <Card>
            <CardHeader
              title="¿Cuánto presupuesto recibe cada piso altitudinal?"
              subtitle={`PIM ${latestYear ?? ''} agregado por piso`}
              help={
                <HelpTip>
                  Sumamos el PIM de todos los distritos de cada piso. La barra mide soles
                  totales: los pisos donde vive más gente (Chala, Quechua) tienden a recibir
                  más en términos absolutos. Para comparar justicia distributiva usa la
                  columna PIM per cápita de la tabla.
                </HelpTip>
              }
            />
            <Chart option={optBarrasPresupuesto} height={Math.max(220, filas.length * 44)} />
          </Card>

          {/* 3b. Tabla detallada */}
          <Card>
            <CardHeader
              title="Presupuesto por piso: el cruce completo"
              subtitle={`Año ${latestYear ?? ''}`}
              right={<Pill tone="warn">piso por altitud de capital</Pill>}
              help={
                <HelpTip>
                  Cruzamos pisos altitudinales (geografía) con SIAF (presupuesto) y INEI
                  (población). % ejecución = devengado / PIM (rojo &lt;50%, ámbar 50–80%,
                  verde &gt;80%). PIM per cápita = PIM ÷ población; donde no hay población
                  oficial cargada, la celda muestra «s/d».
                </HelpTip>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                    <th className="py-2 pr-3">Piso</th>
                    <th className="py-2 px-3 text-right">Distritos</th>
                    <th className="py-2 px-3 text-right">Población</th>
                    <th className="py-2 px-3 text-right">PIM</th>
                    <th className="py-2 px-3 text-right">Devengado</th>
                    <th className="py-2 px-3 text-right">% Ejec.</th>
                    <th className="py-2 pl-3 text-right">PIM per cápita</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const frac = ejecucion(f.devengado, f.pim)
                    const perCapita = f.tienePob && f.pob > 0 ? f.pim / f.pob : null
                    return (
                      <tr
                        key={f.piso.id}
                        className="border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                      >
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block w-3 h-3 rounded-sm border border-black/10"
                              style={{ backgroundColor: f.piso.color }}
                            />
                            <span className="font-medium text-zinc-700 dark:text-zinc-200">
                              {f.piso.nombre}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{num(f.nDistritos)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {f.tienePob ? num(f.pob) : <span className="text-zinc-400">s/d</span>}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{solesCompact(f.pim)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{solesCompact(f.devengado)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {f.pim > 0 ? (
                            <span style={{ color: colorEjecucion(frac) }} className="font-medium">
                              {pct(frac)}
                            </span>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">
                          {perCapita !== null ? (
                            soles(perCapita)
                          ) : (
                            <span className="text-zinc-400">s/d</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-300 dark:border-zinc-600 font-medium">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {num(filas.reduce((s, f) => s + f.nDistritos, 0))}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {num(filas.reduce((s, f) => s + f.pob, 0))}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{solesCompact(pimTotal)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {solesCompact(filas.reduce((s, f) => s + f.devengado, 0))}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums" />
                    <td className="py-2 pl-3 text-right tabular-nums" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader
            title="Presupuesto por piso"
            right={<Pill tone="warn">sin datos de presupuesto distrital</Pill>}
          />
          <div className="text-sm text-zinc-600 dark:text-zinc-300 px-1">
            {distRes.loading
              ? 'Cargando presupuesto distrital…'
              : 'Aún no hay presupuesto distrital cargado para el último año. Se muestra el mapa de pisos y la distribución de distritos.'}
          </div>
        </Card>
      )}

      {/* 5. Distribución de distritos por piso */}
      <Card>
        <CardHeader
          title="¿Cuántos distritos hay en cada piso?"
          subtitle="Distribución del territorio por región natural"
          help={
            <HelpTip>
              Número de distritos clasificados en cada piso (no es población ni área).
              Muestra dónde se concentra la división política del país a lo largo de la
              gradiente altitudinal. La etiqueta a la derecha de cada barra es el conteo.
            </HelpTip>
          }
        />
        <Chart option={optDistritos} height={Math.max(220, filas.length * 44)} />
      </Card>
    </div>
  )
}
