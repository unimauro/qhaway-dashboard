import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  getGeoJSON,
  getAltitudes,
  getPorDistrito,
  getMeta,
  loadJSON,
} from '../lib/data'
import type {
  AltitudDistrito,
  IndicadorDistrito,
  Meta,
  PorDistrito,
} from '../lib/types'
import { clasificarPiso, TODOS_PISOS, type Piso } from '../lib/pisos'
import { Card, CardHeader, HelpTip, Pill, Select, Loading, ErrorBox } from './ui'
import { Chart } from './Chart'
import { soles, solesCompact, num, pct } from '../lib/format'
import { downloadCSV } from '../lib/download'

// Geometría mínima que necesitamos del geojson para cortar por ámbito.
interface GeoProps {
  IDDIST: string
  NOMBDIST: string
  NOMBPROV: string
  NOMBDEP: string
}

// Cada distrito ya resuelto: a qué piso pertenece, cuánta población y cuánto PIM.
interface DistritoResuelto {
  ubigeo: string
  distrito: string
  provincia: string
  departamento: string
  piso: Piso
  pob: number | null
  pim: number
  devengado: number
}

interface FilaPiso {
  piso: Piso
  nDistritos: number
  pob: number
  tienePob: boolean
  pim: number
  devengado: number
}

const TODOS = '__all__'

export default function CortesPisos() {
  const geoRes = useAsync<unknown>(() => getGeoJSON(), [])
  const altRes = useAsync<AltitudDistrito[]>(() => getAltitudes(), [])
  const metaRes = useAsync<Meta>(() => getMeta(), [])
  const indRes = useAsync<IndicadorDistrito[]>(
    () => loadJSON<IndicadorDistrito[]>('indicadores-distrito.json'),
    [],
  )

  // Años con detalle distrital (única granularidad que permite el cruce piso×presupuesto).
  const distYears = useMemo(() => {
    const ys = metaRes.data?.distritoYears
    return ys?.length ? [...ys].sort((a, b) => b - a) : [2025]
  }, [metaRes.data])
  const [yearSel, setYearSel] = useState<number | undefined>(undefined)
  const year = yearSel ?? distYears[0]
  const distRes = useAsync<PorDistrito[]>(
    () => (year ? getPorDistrito(year) : Promise.resolve([])),
    [year],
  )

  // Cortes elegidos por la stakeholder.
  const [depSel, setDepSel] = useState<string>(TODOS)
  const [provSel, setProvSel] = useState<string>(TODOS)

  // ── Índices auxiliares por ubigeo6 ──
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

  // ── Resolver TODOS los distritos (piso + población + presupuesto) ──
  // Se construye desde el geojson (única fuente con departamento+provincia por IDDIST).
  const distritos = useMemo<DistritoResuelto[]>(() => {
    const geo = geoRes.data as { features?: { properties?: GeoProps }[] } | undefined
    const out: DistritoResuelto[] = []
    if (!geo?.features) return out
    for (const f of geo.features) {
      const p = f.properties
      if (!p?.IDDIST) continue
      const alt = indPorUbigeo.get(p.IDDIST)?.altitud ?? altPorUbigeo.get(p.IDDIST)
      const piso = clasificarPiso(alt, p.NOMBDEP ?? '')
      if (!piso) continue
      const ind = indPorUbigeo.get(p.IDDIST)
      const d = distPorUbigeo.get(p.IDDIST)
      out.push({
        ubigeo: p.IDDIST,
        distrito: p.NOMBDIST || p.IDDIST,
        provincia: (p.NOMBPROV || '').trim(),
        departamento: (p.NOMBDEP || '').trim(),
        piso,
        pob: ind?.pob ?? null,
        pim: d?.pim ?? 0,
        devengado: d?.devengado ?? 0,
      })
    }
    return out
  }, [geoRes.data, altPorUbigeo, indPorUbigeo, distPorUbigeo])

  // ── Opciones de los selectores de ámbito ──
  const deptos = useMemo(() => {
    const s = new Set<string>()
    for (const d of distritos) if (d.departamento) s.add(d.departamento)
    return [...s].sort((a, b) => a.localeCompare(b, 'es'))
  }, [distritos])

  // Provincias dependientes del departamento elegido.
  const provincias = useMemo(() => {
    if (depSel === TODOS) return []
    const s = new Set<string>()
    for (const d of distritos)
      if (d.departamento === depSel && d.provincia) s.add(d.provincia)
    return [...s].sort((a, b) => a.localeCompare(b, 'es'))
  }, [distritos, depSel])

  // Al cambiar de departamento, la provincia seleccionada deja de ser válida.
  const provEfectiva = provincias.includes(provSel) ? provSel : TODOS

  // ── Distritos del ámbito elegido ──
  const ambito = useMemo(() => {
    return distritos.filter(
      (d) =>
        (depSel === TODOS || d.departamento === depSel) &&
        (provEfectiva === TODOS || d.provincia === provEfectiva),
    )
  }, [distritos, depSel, provEfectiva])

  // ── Tabla piso×presupuesto×población acotada al ámbito ──
  const filas = useMemo<FilaPiso[]>(() => {
    const base = new Map<string, FilaPiso>()
    for (const p of TODOS_PISOS)
      base.set(p.id, { piso: p, nDistritos: 0, pob: 0, tienePob: false, pim: 0, devengado: 0 })
    for (const d of ambito) {
      const fila = base.get(d.piso.id)
      if (!fila) continue
      fila.nDistritos += 1
      if (d.pob != null && d.pob > 0) {
        fila.pob += d.pob
        fila.tienePob = true
      }
      fila.pim += d.pim
      fila.devengado += d.devengado
    }
    return TODOS_PISOS.map((p) => base.get(p.id)!).filter((f) => f.nDistritos > 0)
  }, [ambito])

  const pimTotal = useMemo(() => filas.reduce((s, f) => s + f.pim, 0), [filas])
  const pobTotal = useMemo(() => filas.reduce((s, f) => s + f.pob, 0), [filas])
  const hayPresupuesto = pimTotal > 0
  const hayPoblacion = pobTotal > 0

  const ambitoLabel = useMemo(() => {
    if (depSel === TODOS) return 'Todo el Perú'
    if (provEfectiva === TODOS) return depSel
    return `${provEfectiva} (${depSel})`
  }, [depSel, provEfectiva])

  // ── Gráfico: % población vs % PIM por piso, en el ámbito ──
  const optEquidad = useMemo(
    () => ({
      grid: { left: 8, right: 16, bottom: 8, top: 36, containLabel: true },
      legend: { top: 4, data: ['% Población', '% Presupuesto (PIM)'] },
      tooltip: {
        trigger: 'axis' as const,
        formatter: (params: { name: string; seriesName: string; value: number }[]) => {
          const head = params[0]?.name ?? ''
          const body = params.map((p) => `${p.seriesName}: ${p.value.toFixed(1)}%`).join('<br/>')
          return `${head}<br/>${body}`
        },
      },
      xAxis: {
        type: 'category' as const,
        data: filas.map((f) => f.piso.nombre),
        axisLabel: { interval: 0, rotate: 28, fontSize: 10 },
      },
      yAxis: { type: 'value' as const, axisLabel: { formatter: (v: number) => `${v}%` } },
      series: [
        {
          name: '% Población',
          type: 'bar' as const,
          barGap: '10%',
          data: filas.map((f) => ({
            value: pobTotal > 0 ? (f.pob / pobTotal) * 100 : 0,
            itemStyle: { color: '#64748b' },
          })),
          barMaxWidth: 26,
        },
        {
          name: '% Presupuesto (PIM)',
          type: 'bar' as const,
          data: filas.map((f) => ({
            value: pimTotal > 0 ? (f.pim / pimTotal) * 100 : 0,
            itemStyle: { color: f.piso.color },
          })),
          barMaxWidth: 26,
        },
      ],
    }),
    [filas, pimTotal, pobTotal],
  )

  const descargar = () =>
    downloadCSV(
      `qhaway-pisos-corte-${depSel === TODOS ? 'peru' : depSel}${provEfectiva !== TODOS ? '-' + provEfectiva : ''}-${year}`,
      [
        { key: 'piso', label: 'Piso altitudinal' },
        { key: 'nDistritos', label: 'Distritos' },
        { key: 'pob', label: 'Poblacion' },
        { key: 'pctPob', label: '% poblacion' },
        { key: 'pim', label: 'PIM' },
        { key: 'pctPim', label: '% PIM' },
        { key: 'perCapita', label: 'PIM per capita' },
      ],
      filas.map((f) => ({
        piso: f.piso.nombre,
        nDistritos: f.nDistritos,
        pob: f.tienePob ? f.pob : '',
        pctPob: pobTotal > 0 ? ((f.pob / pobTotal) * 100).toFixed(1) : '',
        pim: Math.round(f.pim),
        pctPim: pimTotal > 0 ? ((f.pim / pimTotal) * 100).toFixed(1) : '',
        perCapita: f.tienePob && f.pob > 0 ? (f.pim / f.pob).toFixed(2) : '',
      })),
    )

  // ── Estados de carga / error ──
  if (geoRes.loading || metaRes.loading) return <Loading label="Cargando cortes por ámbito…" />
  if (geoRes.error) return <ErrorBox error={geoRes.error} />
  if (metaRes.error) return <ErrorBox error={metaRes.error} />
  if (distritos.length === 0)
    return (
      <ErrorBox error="No se pudo clasificar ningún distrito por piso altitudinal (sin datos de altitud)." />
    )

  const deptoOpts = [
    { value: TODOS, label: 'Todo el Perú' },
    ...deptos.map((d) => ({ value: d, label: d })),
  ]
  const provOpts = [
    { value: TODOS, label: depSel === TODOS ? '— elige depto. primero —' : 'Todas las provincias' },
    ...provincias.map((p) => ({ value: p, label: p })),
  ]

  return (
    <div className="space-y-4">
      {/* Controles de corte */}
      <div className="flex flex-wrap items-end gap-3 px-1">
        <Select<string> label="Departamento" value={depSel} onChange={(v) => { setDepSel(v); setProvSel(TODOS) }} options={deptoOpts} />
        <Select<string>
          label="Provincia"
          value={provEfectiva}
          onChange={setProvSel}
          options={provOpts}
        />
        <Select<number>
          label="Año presup."
          value={year}
          onChange={(y) => setYearSel(y)}
          options={distYears.map((y) => ({ value: y, label: String(y) }))}
        />
        <button
          onClick={descargar}
          disabled={!hayPresupuesto && !hayPoblacion}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ⬇ Descargar CSV
        </button>
      </div>

      {/* Chips de corte: estado honesto de cada dimensión */}
      <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
        <span className="text-ink-400">Cortes:</span>
        <Pill tone="good">Departamento ✓</Pill>
        <Pill tone="good">Provincia ✓</Pill>
        <ChipDeshabilitado
          label="Función"
          motivo="El gasto distrital (SIAF por ejecutora) no trae la función. La función×territorio solo llega a nivel departamento-destino, no a distrito×piso. Disponible en el módulo de Funciones."
        />
        <ChipDeshabilitado
          label="Categoría presupuestal"
          motivo="La categoría presupuestal solo está en el cubo OLAP (año 2025), no en el detalle distrital por piso. Disponible en el módulo del Cubo, no en este cruce piso×distrito."
        />
      </div>

      {/* Resumen del ámbito */}
      <p className="px-1 text-xs text-ink-500">
        Ámbito: <strong className="text-ink-700 dark:text-ink-200">{ambitoLabel}</strong> · {num(ambito.length)}{' '}
        distritos clasificados · año {year}.{' '}
        {!hayPresupuesto && (
          <span className="text-amber-600 dark:text-amber-400">
            Sin presupuesto distrital cargado para este ámbito/año.
          </span>
        )}
      </p>

      {distRes.loading && !distRes.data ? (
        <Loading label={`Cargando presupuesto distrital ${year}…`} />
      ) : filas.length === 0 ? (
        <Card>
          <div className="px-4 py-6 text-sm text-ink-500">
            No hay distritos clasificados en este ámbito.
          </div>
        </Card>
      ) : (
        <>
          {hayPresupuesto && (
            <Card>
              <CardHeader
                title="Equidad en el ámbito: % población vs % presupuesto por piso"
                subtitle={`${ambitoLabel} · año ${year}`}
                right={<Pill tone="warn">comparativo</Pill>}
                help={
                  <HelpTip>
                    Mismas dos barras que el análisis nacional, pero recalculadas SOLO con los
                    distritos del ámbito elegido. Si la barra de presupuesto es menor que la de
                    población, ese piso recibe proporcionalmente menos dinero del que su gente
                    representa dentro del ámbito.
                  </HelpTip>
                }
              />
              <Chart
                option={optEquidad}
                height={Math.max(260, filas.length * 38)}
                exportName={`pisos-corte-${depSel === TODOS ? 'peru' : depSel}`}
              />
            </Card>
          )}

          {/* Tabla acotada */}
          <Card>
            <CardHeader
              title="Presupuesto y población por piso (acotado al ámbito)"
              subtitle={`${ambitoLabel} · año ${year}`}
              right={<Pill tone="neutral">{num(filas.length)} pisos</Pill>}
              help={
                <HelpTip>
                  Para el ámbito elegido: qué pisos altitudinales existen, cuántos distritos,
                  su población (INEI), su PIM (SIAF) y el PIM per cápita. Los porcentajes son la
                  cuota de cada piso dentro del ámbito (no del país). «s/d» = sin dato.
                </HelpTip>
              }
            />
            <div className="overflow-x-auto px-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                    <th className="py-2 pr-3">Piso</th>
                    <th className="py-2 px-3 text-right">Distritos</th>
                    <th className="py-2 px-3 text-right">Población</th>
                    <th className="py-2 px-3 text-right">% pob.</th>
                    <th className="py-2 px-3 text-right">PIM</th>
                    <th className="py-2 px-3 text-right">% PIM</th>
                    <th className="py-2 pl-3 text-right">PIM per cápita</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const perCapita = f.tienePob && f.pob > 0 ? f.pim / f.pob : null
                    const pctPob = pobTotal > 0 ? f.pob / pobTotal : null
                    const pctPim = pimTotal > 0 ? f.pim / pimTotal : null
                    const subfinanciado =
                      pctPob !== null && pctPim !== null && f.pob > 0 && pctPim < pctPob
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
                        <td className="py-2 px-3 text-right tabular-nums">
                          {pctPob !== null ? pct(pctPob) : <span className="text-zinc-400">s/d</span>}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{solesCompact(f.pim)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {pctPim !== null ? (
                            <span
                              className="font-medium"
                              style={{ color: subfinanciado ? '#f59e0b' : undefined }}
                              title={
                                subfinanciado
                                  ? 'PIM% por debajo de Población% (subfinanciado per cápita)'
                                  : undefined
                              }
                            >
                              {pct(pctPim)}
                            </span>
                          ) : (
                            <span className="text-zinc-400">s/d</span>
                          )}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">
                          {perCapita !== null ? soles(perCapita) : <span className="text-zinc-400">s/d</span>}
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
                    <td className="py-2 px-3 text-right tabular-nums">{hayPoblacion ? num(pobTotal) : '—'}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{hayPoblacion ? '100%' : ''}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{solesCompact(pimTotal)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{hayPresupuesto ? '100%' : ''}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {hayPoblacion && hayPresupuesto ? soles(pimTotal / pobTotal) : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 px-1 text-xs text-zinc-500">
              Los porcentajes son la cuota de cada piso <strong>dentro del ámbito elegido</strong>,
              no sobre el total nacional. El número en{' '}
              <span className="font-medium text-amber-600 dark:text-amber-400">ámbar</span> marca pisos
              con % de presupuesto menor que su % de población (posible subfinanciamiento per cápita).
            </p>
          </Card>
        </>
      )}
    </div>
  )
}

// Chip de dimensión no disponible a nivel distrital×piso (anti-overclaiming).
function ChipDeshabilitado({ label, motivo }: { label: string; motivo: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-ink-100 dark:bg-ink-800/60 text-ink-400 dark:text-ink-500 cursor-help"
      title={`${label}: ${motivo}`}
    >
      <span className="line-through opacity-70">{label}</span>
      <HelpTip>
        <strong>{label}</strong> · {motivo}
      </HelpTip>
    </span>
  )
}
